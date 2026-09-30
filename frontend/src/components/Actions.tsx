import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, ClashError, Unreachable, type ClassRow, type Clash, type Room, type Slot } from '../api';
import { professorName } from '../board';
import { addDays, DAY_SHORT, fromMinutes, hhmm, isoWeekday, minutes, shortDate } from '../time';
import { HOUR_STARTS, professorBusy, type Demo } from '../useDemo';
import { ConflictPanel } from './ConflictPanel';

type Outcome =
  | { kind: 'ok'; text: string }
  | { kind: 'clash'; message: string; clashes: Clash[] }
  | { kind: 'error'; text: string };

type RoomsState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; rooms: Room[] }
  | { status: 'error'; key: string; text: string };

const slotKey = (s: Slot) => `${s.date}|${s.startTime}|${s.endTime}`;

function errorText(err: unknown) {
  if (err instanceof Unreachable) return 'SIGNAL FAILURE · API UNREACHABLE';
  if (err instanceof ApiError) return `REFUSED · ${err.status} · ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** First date from tomorrow (weekdays) with an hour slot the professor is free in, preferring the class's own hour. */
function suggestSlot(rows: ClassRow[], cls: ClassRow, today: string): { date: string; start: number } {
  const own = Number(cls.start_time.slice(0, 2));
  const hours = [own, ...HOUR_STARTS.filter((h) => h !== own && h >= 10), ...HOUR_STARTS.filter((h) => h < 10 && h !== own)];
  for (let d = 1; d <= 14; d++) {
    const date = addDays(today, d);
    if (isoWeekday(date) > 5) continue;
    for (const h of hours) {
      if (h < 8 || h > 17) continue;
      const slot = { date, startTime: fromMinutes(h * 60), endTime: fromMinutes(h * 60 + 60) };
      if (!professorBusy(rows, slot).length) return { date, start: h };
    }
  }
  return { date: addDays(today, 1), start: 10 };
}

interface Props {
  demo: Demo;
  selected: ClassRow | null;
  compact?: boolean;
}

export function Actions({ demo, selected, compact }: Props) {
  const uid = useId();
  const [mode, setMode] = useState<'choose' | 'cancel' | 'postpone'>('choose');
  const [date, setDate] = useState('');
  const [hour, setHour] = useState('10'); // '8'..'17' or 'custom'
  const [customStart, setCustomStart] = useState('10:00');
  const [customEnd, setCustomEnd] = useState('11:00');
  const [rooms, setRooms] = useState<RoomsState>({ status: 'idle' });
  const [roomId, setRoomId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const today = demo.today;

  // New selection: start over, with a suggested slot the professor is free in.
  useEffect(() => {
    setMode('choose');
    setOutcome(null);
    setRoomId(null);
    setRooms({ status: 'idle' });
    if (selected && demo.profRows) {
      const s = suggestSlot(demo.profRows, selected, today);
      setDate(s.date);
      setHour(String(s.start));
      setCustomStart(fromMinutes(s.start * 60));
      setCustomEnd(fromMinutes(s.start * 60 + 60));
    }
  }, [selected?.id]);

  const start = hour === 'custom' ? customStart : fromMinutes(Number(hour) * 60);
  const end = hour === 'custom' ? customEnd : fromMinutes(Number(hour) * 60 + 60);
  const slot: Slot = { date, startTime: start, endTime: end };
  const slotProblem =
    !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ? 'Pick a date.'
      : date < today
        ? 'The date cannot be in the past.'
        : !start || !end
          ? 'Pick a start and end time.'
          : minutes(end) <= minutes(start)
            ? 'The end time must be after the start time.'
            : null;
  const key = slotKey(slot);

  // Free rooms for exactly the slot on screen. A response for any older slot is dropped.
  useEffect(() => {
    if (mode !== 'postpone' || !selected || slotProblem) {
      setRooms({ status: 'idle' });
      return;
    }
    setRooms({ status: 'loading', key });
    setRoomId(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const list = await demo.findRooms(slot, selected.id);
        if (live) setRooms({ status: 'ready', key, rooms: list });
      } catch (err) {
        if (live) setRooms({ status: 'error', key, text: errorText(err) });
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mode, selected?.id, key, slotProblem]);

  if (!selected) {
    return (
      <div className="actions is-empty">
        <p className="panel-hint">Select one of your classes on the board to cancel or move it.</p>
      </div>
    );
  }

  const clsLabel = `${selected.course_code} ${DAY_SHORT[selected.day_of_week]} ${hhmm(selected.start_time)} · ${selected.batch}`;
  const changed = !!selected.modification_type;
  const ownClash = !slotProblem ? professorBusy(demo.profRows ?? [], slot).filter((r) => r.id !== selected.id) : [];
  const roomsReady = rooms.status === 'ready' && rooms.key === key ? rooms.rooms : null;

  async function doCancel() {
    setBusy(true);
    setOutcome(null);
    try {
      await demo.cancel(selected!.id);
      setOutcome({ kind: 'ok', text: `COMMITTED · ${selected!.course_code} ${DAY_SHORT[selected!.day_of_week]} ${hhmm(selected!.start_time)} CANCELLED THIS WEEK` });
      setMode('choose');
    } catch (err) {
      setOutcome({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function doPostpone() {
    const room = roomsReady?.find((r) => r.id === roomId);
    if (!room || slotProblem) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await demo.postpone({
        classId: selected!.id,
        newDate: date,
        newStartTime: start,
        newEndTime: end,
        newClassroomId: room.id,
      });
      setOutcome({
        kind: 'ok',
        text: `COMMITTED · ${res.status} · ${selected!.course_code} → ${shortDate(date)} ${start} · ${room.room_number}`,
      });
      setMode('choose');
    } catch (err) {
      if (err instanceof ClashError) setOutcome({ kind: 'clash', message: err.message, clashes: err.clashes });
      else setOutcome({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`actions${compact ? ' is-compact' : ''}`}>
      <div className="actions-head">
        <span className="label">SELECTED</span>
        <span className="actions-class">
          <span className="board-type">{clsLabel}</span>
          <span className="actions-name">{selected.course_name}</span>
        </span>
      </div>

      {changed ? (
        <p className="panel-hint">
          This class already has a {selected.modification_type === 'cancelled' ? 'cancellation' : 'move'} in force. Use RESET MY
          CHANGES to put it back.
        </p>
      ) : (
        <div className="actions-choose" role="group" aria-label={`Change ${clsLabel}`}>
          <button
            type="button"
            className={`btn btn-ghost btn-red${mode === 'cancel' ? ' is-on' : ''}`}
            aria-expanded={mode === 'cancel'}
            aria-controls={`${uid}-cancel`}
            onClick={() => {
              setMode(mode === 'cancel' ? 'choose' : 'cancel');
              setOutcome(null);
            }}
          >
            CANCEL THIS WEEK
          </button>
          <button
            type="button"
            className={`btn btn-ghost${mode === 'postpone' ? ' is-on' : ''}`}
            aria-expanded={mode === 'postpone'}
            aria-controls={`${uid}-postpone`}
            onClick={() => {
              setMode(mode === 'postpone' ? 'choose' : 'postpone');
              setOutcome(null);
            }}
          >
            POSTPONE
          </button>
        </div>
      )}

      {!changed && mode === 'cancel' && (
        <div id={`${uid}-cancel`} className="step">
          <p className="step-text">
            Cancel {selected.course_code} on {DAY_SHORT[selected.day_of_week]} {hhmm(selected.start_time)} for {selected.batch} until Sunday. The
            room is freed for that time.
          </p>
          <div className="step-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={doCancel}>
              {busy ? 'SENDING…' : 'CONFIRM CANCELLATION'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode('choose')}>
              KEEP IT
            </button>
          </div>
        </div>
      )}

      {!changed && mode === 'postpone' && (
        <form
          id={`${uid}-postpone`}
          className="step postpone"
          onSubmit={(e) => {
            e.preventDefault();
            void doPostpone();
          }}
        >
          <div className="fields">
            <label className="field">
              <span className="label">NEW DATE</span>
              <input ref={dateRef} type="date" value={date} min={today} required onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">SLOT</span>
              <select value={hour} onChange={(e) => setHour(e.target.value)}>
                {HOUR_STARTS.map((h) => (
                  <option key={h} value={String(h)}>
                    {fromMinutes(h * 60)}–{fromMinutes(h * 60 + 60)}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
            {hour === 'custom' && (
              <>
                <label className="field">
                  <span className="label">FROM</span>
                  <input type="time" step={300} value={customStart} required onChange={(e) => setCustomStart(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">TO</span>
                  <input type="time" step={300} value={customEnd} required onChange={(e) => setCustomEnd(e.target.value)} />
                </label>
              </>
            )}
          </div>

          {slotProblem ? (
            <p className="panel-hint is-warn">{slotProblem}</p>
          ) : (
            <fieldset className="rooms" aria-busy={rooms.status === 'loading'}>
              <legend className="label">
                FREE ROOMS · {shortDate(date)} {start}–{end}
              </legend>
              {rooms.status === 'loading' && <p className="board-type rooms-msg">CHECKING ROOMS…</p>}
              {rooms.status === 'error' && <p className="board-type rooms-msg is-fault">{rooms.text}</p>}
              {roomsReady && roomsReady.length === 0 && <p className="board-type rooms-msg">NO FREE ROOMS IN THIS SLOT</p>}
              {roomsReady && roomsReady.length > 0 && (
                <div className="room-grid">
                  {roomsReady.map((r) => (
                    <label key={r.id} className={`room${roomId === r.id ? ' is-on' : ''}`}>
                      <input type="radio" name={`${uid}-room`} value={r.id} checked={roomId === r.id} onChange={() => setRoomId(r.id)} />
                      <span className="room-no">{r.room_number}</span>
                      <span className="room-meta">
                        {r.capacity} SEATS · {(r.building ?? '').toUpperCase()}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {ownClash.length > 0 && (
            <p className="panel-hint is-warn">
              {professorName(selected.faculty_name)} already teaches {ownClash.map((r) => r.course_code).join(', ')} in this slot. The
              server will refuse it.
            </p>
          )}

          <div className="step-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !!slotProblem || roomId === null || !roomsReady}>
              {busy ? 'SENDING…' : 'CONFIRM POSTPONE'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode('choose')}>
              CLOSE
            </button>
          </div>
        </form>
      )}

      {outcome?.kind === 'ok' && (
        <p className="outcome is-ok board-type" role="status">
          {outcome.text}
        </p>
      )}
      {outcome?.kind === 'error' && (
        <p className="outcome is-fault board-type" role="alert">
          {outcome.text}
        </p>
      )}
      {outcome?.kind === 'clash' && (
        <ConflictPanel
          message={outcome.message}
          clashes={outcome.clashes}
          onRetry={() => {
            setOutcome(null);
            setMode('postpone');
            requestAnimationFrame(() => dateRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}
