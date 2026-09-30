import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ClassRow } from '../api';
import { rowsForDay, type BoardRow } from '../board';
import { DAY_LONG, DAY_SHORT, longDate } from '../time';
import type { Conn } from '../useDemo';
import { FlapText } from './FlapText';

interface Props {
  /** Prefix for remembered flap cells, so the two boards never share tiles. */
  name: 'platform' | 'control';
  rows: ClassRow[] | null;
  week: string[];
  today: string;
  day: number;
  onDay: (day: number) => void;
  conn: Conn;
  problem?: string;
  onRetry?: () => void;
  caption: string;
  selectedId?: number | null;
  onSelect?: (classId: number) => void;
}

const STATE_WORD: Record<BoardRow['state'], string> = {
  on: 'on',
  cancelled: 'cancelled',
  moved: 'moved',
  arrival: 'arrival',
};

export function Board(props: Props) {
  const { name, rows, week, today, day, onDay, conn, caption, selectedId, onSelect } = props;
  const uid = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const control = name === 'control';
  const list = rows ? rowsForDay(rows, day, week) : [];
  const date = week[day - 1];
  const cols = 5;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = { ArrowRight: day + 1, ArrowLeft: day - 1, Home: 1, End: 5 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const d = ((next - 1 + 5) % 5) + 1;
    onDay(d);
    tabs.current[d - 1]?.focus();
  };

  let message: ReactNode = null;
  if (conn === 'connecting' && !rows) {
    message = (
      <span className="board-msg-text">
        BOARD CONNECTING<span className="cursor" aria-hidden="true" />
      </span>
    );
  } else if ((conn === 'unreachable' || conn === 'error') && !rows) {
    message = (
      <span className="board-msg-text is-fault">
        <span>SIGNAL FAILURE · {conn === 'unreachable' ? 'API UNREACHABLE' : 'SERVICE ERROR'}</span>
        {props.problem && <span className="board-msg-detail">{props.problem}</span>}
        {props.onRetry && (
          <button type="button" className="btn btn-ghost" onClick={props.onRetry}>
            RETRY
          </button>
        )}
      </span>
    );
  } else if (rows && list.length === 0) {
    message = <span className="board-msg-text">NO SERVICES {date === today ? 'TODAY' : `ON ${DAY_LONG[day].toUpperCase()}`}</span>;
  }

  return (
    <div className={`board board-${name}`}>
      <div className="day-tabs" role="tablist" aria-label="Day">
        {week.map((d, i) => {
          const n = i + 1;
          const selected = n === day;
          return (
            <button
              key={d}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${n}`}
              aria-selected={selected}
              aria-controls={`${uid}-panel`}
              tabIndex={selected ? 0 : -1}
              className={`day-tab${d === today ? ' is-today' : ''}`}
              onClick={() => onDay(n)}
              onKeyDown={onTabKey}
            >
              <span className="day-tab-name">{DAY_SHORT[n]}</span>
              <span className="day-tab-date">{d.slice(8, 10)}</span>
              <span className="sr-only">{d === today ? ', today' : ''}</span>
            </button>
          );
        })}
      </div>

      <div id={`${uid}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${uid}-tab-${day}`} className="board-panel">
        <table className="board-table">
          <caption className="sr-only">
            {caption}, {longDate(date)}
          </caption>
          <colgroup>
            <col className="col-time" />
            <col className="col-course" />
            <col className="col-aux" />
            <col className="col-room" />
            <col className="col-status" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">TIME</th>
              <th scope="col">COURSE</th>
              <th scope="col" className="c-aux">
                {control ? 'BATCH' : 'PROFESSOR'}
              </th>
              <th scope="col">ROOM</th>
              <th scope="col">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {message ? (
              <tr className="board-msg">
                <td colSpan={cols}>{message}</td>
              </tr>
            ) : (
              list.map((r, i) => (
                <Row
                  key={`${day}:${r.key}`}
                  row={r}
                  index={i}
                  prefix={`${name}:${r.key}`}
                  control={control}
                  group={`${uid}-select`}
                  selected={selectedId === r.classId && r.state !== 'arrival'}
                  onSelect={onSelect}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  row: BoardRow;
  index: number;
  prefix: string;
  control: boolean;
  group: string;
  selected: boolean;
  onSelect?: (classId: number) => void;
}

function Row({ row, index, prefix, control, group, selected, onSelect }: RowProps) {
  const inputId = useId();
  const delay = index * 70;
  const selectable = control && row.state !== 'arrival' && !!onSelect;
  const trRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (selected) trRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return (
    <tr
      ref={trRef}
      className={`row is-${STATE_WORD[row.state]}${selected ? ' is-selected' : ''}${selectable ? ' is-selectable' : ''}`}
      onClick={selectable ? () => onSelect!(row.classId) : undefined}
    >
      <td className="c-time">
        <FlapText text={row.time} memo={`${prefix}:time`} delay={delay} label={`${row.time} to ${row.end}`} />
      </td>
      <th scope="row" className="c-course">
        {selectable ? (
          <span className="pick">
            <input
              id={inputId}
              type="radio"
              name={group}
              className="pick-input"
              checked={selected}
              onChange={() => onSelect!(row.classId)}
            />
            <label htmlFor={inputId} className="course">
              <span className="course-code">{row.code}</span>
              <span className="course-name">{row.name}</span>
            </label>
          </span>
        ) : (
          <span className="course">
            <span className="course-code">{row.code}</span>
            <span className="course-name">{row.name}</span>
          </span>
        )}
      </th>
      <td className="c-aux">{control ? row.batch : row.professor}</td>
      <td className={`c-room${row.roomChanged ? ' is-changed' : ''}`}>
        <FlapText
          text={row.room}
          memo={`${prefix}:room`}
          delay={delay + 60}
          label={row.roomChanged ? `${row.room}, changed from ${row.source.room_number}` : row.room}
        />
      </td>
      <td className="c-status">
        <FlapText text={row.status} memo={`${prefix}:status`} delay={delay + 120} label={row.spoken} />
      </td>
    </tr>
  );
}
