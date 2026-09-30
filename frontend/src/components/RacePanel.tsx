import { forwardRef, useImperativeHandle, useState } from 'react';
import { ApiError, Unreachable } from '../api';
import { DAY_SHORT, hhmm, shortDate } from '../time';
import type { Demo, RaceResult } from '../useDemo';

export interface RaceHandle {
  run: () => Promise<void>;
}

/** Two postpones to one room, date and time, fired together. Exactly one commits. */
export const RacePanel = forwardRef<RaceHandle, { demo: Demo }>(function RacePanel({ demo }, ref) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [fault, setFault] = useState('');
  const [runs, setRuns] = useState(0);

  async function run() {
    if (running) return;
    setRunning(true);
    setFault('');
    setResult(null);
    try {
      setResult(await demo.race());
      setRuns((n) => n + 1);
    } catch (err) {
      setFault(
        err instanceof Unreachable
          ? 'SIGNAL FAILURE · API UNREACHABLE'
          : err instanceof ApiError
            ? `REFUSED · ${err.status} · ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err),
      );
    } finally {
      setRunning(false);
    }
  }

  useImperativeHandle(ref, () => ({ run }));

  return (
    <section className="race" aria-labelledby="race-h">
      <div className="race-head">
        <h3 id="race-h" className="section-label">
          <span className="tag">DEMONSTRATION</span> RACE
        </h3>
        <button type="button" className="btn btn-ghost" onClick={run} disabled={running || demo.conn !== 'ready'}>
          {running ? 'RUNNING…' : result ? 'RUN AGAIN' : 'RUN RACE'}
        </button>
      </div>
      <p className="race-text">
        Sends two postpones of Prof. Meera's classes into the same free room, date and time at once. The server locks the room and
        professor inside a transaction, so exactly one can win.
      </p>

      {fault && (
        <p className="outcome is-fault board-type" role="alert">
          {fault}
        </p>
      )}

      {result && (
        <div className="race-result" key={runs} role="status">
          <p className="race-slot board-type">
            TARGET {shortDate(result.slot.date)} {result.slot.startTime}–{result.slot.endTime} · {result.room.room_number}
            <span className="race-slot-note"> free for both when checked</span>
          </p>
          <ol className="tracks">
            {result.lanes.map((l, i) => {
              const clash = l.clashes?.find((c) => c.type === 'room') ?? l.clashes?.[0];
              return (
                <li key={l.lane} className={`track ${l.ok ? 'is-won' : 'is-held'}`} style={{ ['--i' as string]: i }}>
                  <span className="track-lane board-type" aria-hidden="true">
                    {l.lane}
                  </span>
                  <span className="track-class board-type">
                    {l.row.course_code} {DAY_SHORT[l.row.day_of_week]} {hhmm(l.row.start_time)}
                  </span>
                  <span className="track-rail" aria-hidden="true">
                    <span className="track-train" />
                  </span>
                  <span className="track-verdict board-type">{l.ok ? `COMMITTED · ${l.status}` : `HELD · ${l.status} CLASH`}</span>
                  <span className="track-ms board-type">{l.ms} ms</span>
                  {!l.ok && (
                    <span className="track-why">
                      {clash
                        ? `${clash.room_number} already taken by ${clash.course_code} ${hhmm(clash.start_time)}–${hhmm(clash.end_time)}, committed a moment earlier by the other request.`
                        : l.error}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
});
