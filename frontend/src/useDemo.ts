// Holds both demo sessions (control room = professor, platform = student),
// both boards, and every action. Shared by the full page and /embed.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  ClashError,
  decodeToken,
  dropSandbox,
  getSandboxId,
  Unreachable,
  type ClassRow,
  type Clash,
  type PostponeInput,
  type Role,
  type Room,
  type Slot,
} from './api';
import { describeChange } from './board';
import { addDays, boardWeek, collegeToday, fromMinutes, isoWeekday, minutes } from './time';

export const DEMO_PASSWORD = 'edusched-demo';
export const DEMO_PROFESSOR = 'prof.meera';
export const DEMO_STUDENT = 'student.aarav';

export const STAGES = ['JWT login', 'Base timetable', 'Change overlay', 'Free-room query', 'Clash checks', 'Commit change'];
export type StageListener = (stage: { i: number; name: string; ms: number; ok: boolean; lane?: 'A' | 'B' }) => void;

export type Conn = 'connecting' | 'ready' | 'unreachable' | 'error';

export interface Session {
  token: string;
  username: string;
  id: number;
  role: Role;
  batch: string | null;
}

export interface RaceLane {
  lane: 'A' | 'B';
  row: ClassRow;
  ok: boolean;
  status: number;
  ms: number;
  clashes?: Clash[];
  error?: string;
}

export interface RaceResult {
  slot: Slot;
  room: Room;
  lanes: RaceLane[];
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  minutes(aStart) < minutes(bEnd) && minutes(aEnd) > minutes(bStart);

/** Classes of this professor that occupy `slot`, as far as the control-room board knows. */
export function professorBusy(rows: ClassRow[], slot: Slot): ClassRow[] {
  const dow = isoWeekday(slot.date);
  return rows.filter((r) => {
    const movedHere = r.modification_type === 'postponed' && r.new_date === slot.date;
    if (movedHere && overlaps(r.new_start_time!, r.new_end_time!, slot.startTime, slot.endTime)) return true;
    return r.day_of_week === dow && !r.modification_type && overlaps(r.start_time, r.end_time, slot.startTime, slot.endTime);
  });
}

/** Hour slots in the order we try them: late morning first, early morning last. */
export const HOUR_STARTS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const RACE_ORDER = [10, 11, 12, 14, 15, 16, 13, 17, 9, 8];

export function useDemo(onStage?: StageListener) {
  const [conn, setConn] = useState<Conn>('connecting');
  const [problem, setProblem] = useState('');
  const [control, setControl] = useState<Session | null>(null);
  const [platform, setPlatform] = useState<Session | null>(null);
  const [profRows, setProfRows] = useState<ClassRow[] | null>(null);
  const [studentRows, setStudentRows] = useState<ClassRow[] | null>(null);
  const [sandbox, setSandbox] = useState<string | null>(getSandboxId());
  const [announcement, setAnnouncement] = useState('');
  /** Bumped when the platform's classes change: the platform jumps to the day of the change. */
  const [platformFollow, setPlatformFollow] = useState<{ day: number; n: number } | null>(null);
  const [today, setToday] = useState(collegeToday);

  const sessions = useRef<{ control: Session | null; platform: Session | null }>({ control: null, platform: null });
  const rows = useRef<{ prof: ClassRow[] | null; student: ClassRow[] | null }>({ prof: null, student: null });
  const timings = useRef({ login: 0, prof: 0, student: 0, rooms: 0 });
  const stageRef = useRef(onStage);
  stageRef.current = onStage;

  const stage = (i: number, ms: number, ok: boolean, lane?: 'A' | 'B') =>
    stageRef.current?.({ i, name: STAGES[i], ms, ok, ...(lane ? { lane } : {}) });

  const say = useCallback((text: string) => {
    // A trailing no-break space toggles so a repeated sentence is still announced.
    setAnnouncement((prev) => (prev === text ? `${text} ` : text));
  }, []);

  // "Today" rolls over at midnight in the college's timezone.
  useEffect(() => {
    const t = setInterval(() => setToday(collegeToday()), 60_000);
    return () => clearInterval(t);
  }, []);

  const fail = useCallback((err: unknown) => {
    if (err instanceof Unreachable) {
      setConn('unreachable');
      setProblem(err.message);
    } else {
      setConn('error');
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }, []);

  async function login(username: string, password: string): Promise<Session> {
    const res = await api.login(username, password);
    const claims = decodeToken(res.data.token);
    // Stage 0 ("JWT login") is the control room's sign-in: that is the session that makes changes.
    if (claims.role === 'professor') timings.current.login = res.ms;
    return { token: res.data.token, username, id: claims.id, role: claims.role, batch: claims.batch };
  }

  /** Re-reads both boards. Returns sentences describing what changed since the last read. */
  const refresh = useCallback(async (): Promise<string[]> => {
    const { control: c, platform: p } = sessions.current;
    const [pr, sr] = await Promise.all([c ? api.timetable(c.token) : null, p ? api.timetable(p.token) : null]);
    const before = new Map<number, ClassRow>();
    for (const r of [...(rows.current.prof ?? []), ...(rows.current.student ?? [])]) before.set(r.id, r);

    const said = new Set<number>();
    const messages: string[] = [];
    let followDay = 0;
    for (const r of [...(sr?.data ?? []), ...(pr?.data ?? [])]) {
      if (said.has(r.id)) continue;
      said.add(r.id);
      const msg = before.size ? describeChange(before.get(r.id), r) : null;
      if (!msg) continue;
      messages.push(msg);
      if (!followDay && sr?.data.some((x) => x.id === r.id)) followDay = r.day_of_week;
    }

    if (pr) timings.current.prof = pr.ms;
    if (sr) timings.current.student = sr.ms;
    rows.current = { prof: pr?.data ?? null, student: sr?.data ?? null };
    setProfRows(rows.current.prof);
    setStudentRows(rows.current.student);
    setSandbox(getSandboxId());
    if (followDay) setPlatformFollow((f) => ({ day: followDay, n: (f?.n ?? 0) + 1 }));
    return messages;
  }, []);

  const connect = useCallback(async () => {
    setConn('connecting');
    setProblem('');
    try {
      const [c, p] = await Promise.all([login(DEMO_PROFESSOR, DEMO_PASSWORD), login(DEMO_STUDENT, DEMO_PASSWORD)]);
      sessions.current = { control: c, platform: p };
      setControl(c);
      setPlatform(p);
      await refresh();
      setConn('ready');
      stage(0, timings.current.login, true);
      stage(1, timings.current.prof, true);
      stage(2, timings.current.student, true);
    } catch (err) {
      fail(err);
    }
  }, [refresh, fail]);

  useEffect(() => {
    void connect();
  }, [connect]);

  /**
   * refresh(), but a 401/403 (token expired after 24 h, or the secret rotated) signs both
   * sessions in again and retries once. Manual sign-ins fall back to the demo account for that role.
   */
  const refreshWithReauth = useCallback(async (): Promise<string[]> => {
    try {
      return await refresh();
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) throw err;
      const [c, p] = await Promise.all([login(DEMO_PROFESSOR, DEMO_PASSWORD), login(DEMO_STUDENT, DEMO_PASSWORD)]);
      sessions.current = { control: c, platform: p };
      setControl(c);
      setPlatform(p);
      return await refresh();
    }
  }, [refresh]);

  /** After a write: re-read both boards and announce what changed. */
  const afterWrite = useCallback(
    async (extraMessage?: string) => {
      try {
        const messages = await refreshWithReauth();
        say([extraMessage, ...messages].filter(Boolean).join(' '));
      } catch (err) {
        fail(err);
      }
    },
    [refreshWithReauth, say, fail],
  );

  const token = () => {
    const c = sessions.current.control;
    if (!c) throw new Error('Control room is not signed in');
    return c.token;
  };

  const cancel = useCallback(
    async (classId: number) => {
      await api.cancel(token(), classId);
      await afterWrite();
    },
    [afterWrite],
  );

  const findRooms = useCallback(async (slot: Slot, classId?: number): Promise<Room[]> => {
    const res = await api.availableRooms(token(), slot, classId);
    timings.current.rooms = res.ms;
    return res.data;
  }, []);

  const emitLeadIn = () => {
    stage(0, timings.current.login, true);
    stage(1, timings.current.prof, true);
    stage(2, timings.current.student, true);
    stage(3, timings.current.rooms, true);
  };

  const postpone = useCallback(
    async (input: PostponeInput) => {
      emitLeadIn();
      try {
        const res = await api.postpone(token(), input);
        stage(4, res.ms, true);
        stage(5, res.ms, true);
        await afterWrite();
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          stage(4, err.ms, false);
          stage(5, err.ms, false);
        }
        throw err;
      }
    },
    [afterWrite],
  );

  /**
   * Two of the professor's classes, postponed into the same room, date and time
   * at the same moment. The slot is checked first (room free, professor free),
   * so the only thing that can refuse the second request is the first one.
   */
  const race = useCallback(async (): Promise<RaceResult> => {
    const t = token();
    const mine = (rows.current.prof ?? []).filter((r) => !r.modification_type);
    const batch = sessions.current.platform?.batch;
    const ordered = [...mine.filter((r) => r.batch === batch), ...mine.filter((r) => r.batch !== batch)];
    if (ordered.length < 2) throw new Error('Fewer than two unchanged classes left. Reset your changes and run it again.');
    const [a, b] = ordered;

    // Prefer a weekday still ahead on the board this week, then the weeks after.
    const todayNow = collegeToday();
    const week = boardWeek(todayNow);
    const dates: string[] = [];
    for (let d = 1; d <= 21; d++) {
      const date = addDays(todayNow, d);
      if (isoWeekday(date) <= 5) dates.push(date);
    }
    dates.sort((x, y) => Number(week.includes(y)) - Number(week.includes(x)) || x.localeCompare(y));

    let found: { slot: Slot; room: Room } | null = null;
    let tries = 0;
    for (const date of dates) {
      for (const h of RACE_ORDER) {
        const slot = { date, startTime: fromMinutes(h * 60), endTime: fromMinutes(h * 60 + 60) };
        const busy = professorBusy(rows.current.prof ?? [], slot).length > 0;
        const lanesBusy = [a, b].some((r) => r.day_of_week === isoWeekday(date) && overlaps(r.start_time, r.end_time, slot.startTime, slot.endTime));
        if (busy || lanesBusy) continue;
        const rooms = await findRooms(slot);
        tries++;
        if (rooms.length) {
          found = { slot, room: rooms.find((r) => r.room_number === 'LT-101') ?? rooms[0] };
          break;
        }
        if (tries > 12) break;
      }
      if (found || tries > 12) break;
    }
    if (!found) throw new Error('No slot found where both the room and the professor are free.');

    emitLeadIn();
    const { slot, room } = found;
    const fire = async (row: ClassRow, lane: 'A' | 'B'): Promise<RaceLane> => {
      const input = { classId: row.id, newDate: slot.date, newStartTime: slot.startTime, newEndTime: slot.endTime, newClassroomId: room.id };
      try {
        const res = await api.postpone(t, input);
        return { lane, row, ok: true, status: res.status, ms: res.ms };
      } catch (err) {
        if (err instanceof ClashError) return { lane, row, ok: false, status: 409, ms: err.ms, clashes: err.clashes, error: err.message };
        if (err instanceof ApiError) return { lane, row, ok: false, status: err.status, ms: err.ms, error: err.message };
        throw err;
      }
    };
    const lanes = await Promise.all([fire(a, 'A'), fire(b, 'B')]);
    for (const l of lanes) {
      stage(4, l.ms, l.status !== 409, l.lane);
      stage(5, l.ms, l.ok, l.lane);
    }
    const winner = lanes.find((l) => l.ok);
    await afterWrite(
      winner
        ? `Race finished: ${winner.row.course_code} committed, the other request was held with a 409 clash.`
        : 'Race finished: neither request committed.',
    );
    return { slot, room, lanes };
  }, [afterWrite, findRooms]);

  const reset = useCallback(async () => {
    dropSandbox();
    setSandbox(null);
    try {
      await refreshWithReauth();
      say('All your changes are cleared. The boards show the regular timetable.');
    } catch (err) {
      fail(err);
    }
  }, [refreshWithReauth, say, fail]);

  /** Manual sign-in: a professor takes over the control room, a student the platform. */
  const signIn = useCallback(
    async (username: string, password: string) => {
      const s = await login(username, password);
      sessions.current = s.role === 'professor' ? { ...sessions.current, control: s } : { ...sessions.current, platform: s };
      if (s.role === 'professor') setControl(s);
      else setPlatform(s);
      rows.current = { prof: null, student: null };
      await refresh();
      setConn('ready');
      say(`Signed in as ${username}. ${s.role === 'professor' ? 'Control room' : 'Platform'} updated.`);
      return s;
    },
    [refresh, say],
  );

  return {
    conn,
    problem,
    control,
    platform,
    profRows,
    studentRows,
    sandbox,
    announcement,
    platformFollow,
    today,
    connect,
    refresh: afterWrite,
    cancel,
    findRooms,
    postpone,
    race,
    reset,
    signIn,
  };
}

export type Demo = ReturnType<typeof useDemo>;
