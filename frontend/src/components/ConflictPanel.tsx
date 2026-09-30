import { useEffect, useRef } from 'react';
import type { Clash } from '../api';
import { hhmm } from '../time';

interface Props {
  message: string;
  clashes: Clash[];
  onRetry?: () => void;
  /** Heading level context: the race uses a smaller variant. */
  compact?: boolean;
}

/** 409 from the server, drawn as a signal fault: one line per clash. */
export function ConflictPanel({ message, clashes, onRetry, compact }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!compact) ref.current?.focus();
  }, [compact]);

  return (
    <div ref={ref} className={`conflict${compact ? ' is-compact' : ''}`} role="alert" tabIndex={-1}>
      <div className="conflict-head">
        <span className="lamp is-red" aria-hidden="true" />
        <span className="conflict-title">SIGNAL · CONFLICT</span>
        <span className="conflict-code board-type">409</span>
      </div>
      {!compact && <p className="conflict-text">Postpone refused. Nothing was changed. {message}.</p>}
      <table className="conflict-table">
        <caption className="sr-only">Clashes</caption>
        <thead>
          <tr>
            <th scope="col">CLASH</th>
            <th scope="col">COURSE</th>
            <th scope="col">ROOM</th>
            <th scope="col">TIME</th>
          </tr>
        </thead>
        <tbody>
          {clashes.map((c, i) => (
            <tr key={`${c.type}-${c.class_id}-${i}`}>
              <th scope="row" className="board-type conflict-type">
                {c.type === 'room' ? 'ROOM' : 'PROFESSOR'}
              </th>
              <td>
                <span className="board-type">{c.course_code}</span> <span className="conflict-name">{c.course_name}</span>
              </td>
              <td className="board-type">{c.room_number ?? '—'}</td>
              <td className="board-type">
                {hhmm(c.start_time)}–{hhmm(c.end_time)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          CHOOSE ANOTHER SLOT
        </button>
      )}
    </div>
  );
}
