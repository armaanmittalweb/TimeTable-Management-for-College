import { useEffect, useState, type Ref } from 'react';
import type { ClassRow } from '../api';
import { professorName, rowsForDay } from '../board';
import { collegeNow, DAY_SHORT, hhmm, shortDate } from '../time';
import type { Demo } from '../useDemo';
import { Actions } from './Actions';
import { Board } from './Board';
import { FlapText } from './FlapText';
import { RacePanel, type RaceHandle } from './RacePanel';

interface ControlProps {
  demo: Demo;
  week: string[];
  day: number;
  onDay: (d: number) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  raceRef?: Ref<RaceHandle>;
  compact?: boolean;
  hidden?: boolean;
}

export function ControlRoom({ demo, week, day, onDay, selectedId, onSelect, raceRef, compact, hidden }: ControlProps) {
  const selected = demo.profRows?.find((r) => r.id === selectedId) ?? null;
  const who = demo.control ? professorName(demo.control.username) : 'SIGNING IN';
  const courses = [...new Set((demo.profRows ?? []).map((r) => r.course_code))].join(' · ');
  return (
    <section className={`view view-control${hidden ? ' is-off' : ''}`} aria-labelledby="control-h" id="view-control">
      <div className="view-head">
        <h2 id="control-h" className="view-title">
          CONTROL ROOM
        </h2>
        <span className="view-who">
          {who}
          {courses && <span className="view-who-sub"> · {courses}</span>}
        </span>
      </div>
      <Board
        name="control"
        rows={demo.profRows}
        week={week}
        today={demo.today}
        day={day}
        onDay={onDay}
        conn={demo.conn}
        problem={demo.problem}
        onRetry={demo.connect}
        caption={`Classes taught by ${who}`}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <Actions demo={demo} selected={selected} compact={compact} />
      <RacePanel demo={demo} ref={raceRef} />
    </section>
  );
}

interface PlatformProps {
  demo: Demo;
  week: string[];
  day: number;
  onDay: (d: number) => void;
  hidden?: boolean;
  compact?: boolean;
}

export function Platform({ demo, week, day, onDay, hidden, compact }: PlatformProps) {
  const batch = demo.platform?.batch ?? '';
  return (
    <section className={`view view-platform${hidden ? ' is-off' : ''}`} aria-labelledby="platform-h" id="view-platform">
      <div className="view-head">
        <h2 id="platform-h" className="view-title">
          PLATFORM
        </h2>
        <span className="view-who">
          {batch || 'SIGNING IN'}
          {demo.platform && <span className="view-who-sub"> · {demo.platform.username.toUpperCase()}</span>}
        </span>
      </div>
      {!compact && <NextDeparture rows={demo.studentRows} week={week} today={demo.today} />}
      <Board
        name="platform"
        rows={demo.studentRows}
        week={week}
        today={demo.today}
        day={day}
        onDay={onDay}
        conn={demo.conn}
        problem={demo.problem}
        onRetry={demo.connect}
        caption={`Timetable for ${batch}`}
      />
      <ServiceChanges rows={demo.studentRows} />
    </section>
  );
}

/** The next class that will actually run: skips cancelled and moved-away ones, counts moved-in ones. */
function NextDeparture({ rows, week, today }: { rows: ClassRow[] | null; week: string[]; today: string }) {
  const [now, setNow] = useState(() => collegeNow().time.slice(0, 5));
  useEffect(() => {
    const t = setInterval(() => setNow(collegeNow().time.slice(0, 5)), 20_000);
    return () => clearInterval(t);
  }, []);
  if (!rows) return null;

  let next: { date: string; time: string; code: string; room: string } | null = null;
  for (let d = 1; d <= 5 && !next; d++) {
    const date = week[d - 1];
    if (date < today) continue;
    const hit = rowsForDay(rows, d, week).find(
      (r) => (r.state === 'on' || r.state === 'arrival') && (date > today || r.time > now),
    );
    if (hit) next = { date, time: hit.time, code: hit.code, room: hit.room };
  }
  const text = next ? `${next.date === today ? 'TODAY' : DAY_SHORT[week.indexOf(next.date) + 1]} ${next.time} ${next.code} ${next.room}` : 'NO MORE SERVICES THIS WEEK';
  const spoken = next ? `Next class: ${next.code}, ${shortDate(next.date)} at ${next.time}, room ${next.room}` : 'No more classes this week';

  return (
    <div className="next">
      <span className="label next-label">NEXT</span>
      <FlapText className="next-flap" text={text} memo="platform:next" label={spoken} />
    </div>
  );
}

function ServiceChanges({ rows }: { rows: ClassRow[] | null }) {
  if (!rows) return null;
  const changed = rows.filter((r) => r.modification_type);
  return (
    <div className="notices">
      <h3 className="section-label">SERVICE CHANGES</h3>
      {changed.length === 0 ? (
        <p className="notices-empty board-type">NO CHANGES · ALL CLASSES RUNNING TO TIMETABLE</p>
      ) : (
        <ul className="notices-list">
          {changed.map((r) => (
            <li key={r.id} className={r.modification_type === 'cancelled' ? 'is-cancelled' : 'is-moved'}>
              <span className="board-type notice-what">
                {r.course_code} {DAY_SHORT[r.day_of_week]} {hhmm(r.start_time)}
              </span>
              <span className="board-type notice-state">
                {r.modification_type === 'cancelled'
                  ? 'CANCELLED THIS WEEK'
                  : `MOVED → ${shortDate(r.new_date!)} ${hhmm(r.new_start_time)} · ${r.new_room_number}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
