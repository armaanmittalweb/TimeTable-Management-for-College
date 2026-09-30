// What you see after clicking a class: when and where, who, this week's change, and the actions you may take.

import { forwardRef } from 'react';
import type { Occurrence, Week, WorkspaceFull } from '../contract';
import { Icon } from '../ui/Icon';
import { ago, DAY_LONG, dayLabel, dow, duration, toMin } from '../lib/time';

export interface PanelActions {
  onReschedule?: () => void;
  onCancel?: () => void;
  onUndo?: () => void;
  onClose: () => void;
}

export const ClassPanel = forwardRef<HTMLHeadingElement, {
  o: Occurrence; week: Week; full?: WorkspaceFull; may: boolean; past: boolean; actions: PanelActions; busy?: boolean;
}>(function ClassPanel({ o, week, full, may, past, actions, busy }, headingRef) {
  const room = full?.rooms.find((r) => r.id === o.room.id);
  const batch = full?.batches.find((b) => b.id === o.batch.id);
  const cls = full?.classes.find((c) => c.id === o.classId);
  const regularRoom = cls && full?.rooms.find((r) => r.id === cls.roomId);
  const others = week.occurrences.filter((x) => x.course.id === o.course.id && x.batch.id === o.batch.id && x.key !== o.key && x.status !== 'moved-away');
  const ch = o.change;
  const len = toMin(o.end) - toMin(o.start);

  return (
    <div className={`cp c${o.course.color}`}>
      <div className="cp-head">
        <span className="cp-code mono">{o.course.code}</span>
        {o.status === 'cancelled' && <span className="chip">Cancelled</span>}
        {o.status === 'moved-here' && <span className="chip chip-changed">Moved here</span>}
        {o.status === 'moved-away' && <span className="chip chip-changed">Moved away</span>}
        <button type="button" className="btn btn-ghost btn-icon btn-sm cp-x" onClick={actions.onClose} aria-label="Close class details">
          <Icon name="x" />
        </button>
      </div>
      <h2 className="cp-title" ref={headingRef} tabIndex={-1}>{o.course.name}</h2>

      <dl className="cp-facts">
        <div>
          <dt><Icon name="clock" /> When</dt>
          <dd>
            {dayLabel(o.date)}, <span className="mono">{o.start}–{o.end}</span>
            <span className="cp-note">{duration(len)}</span>
          </dd>
        </div>
        <div>
          <dt><Icon name="room" /> Room</dt>
          <dd>
            {o.room.name}
            {room && <span className="cp-note">{room.capacity} seats{room.kind === 'lab' ? ' · lab' : ''}{room.building ? ` · ${room.building}` : ''}</span>}
          </dd>
        </div>
        <div>
          <dt><Icon name="batch" /> Batch</dt>
          <dd>
            {o.batch.name}
            {batch?.size ? <span className="cp-note">{batch.size} students</span> : null}
          </dd>
        </div>
        <div>
          <dt><Icon name="teacher" /> Teacher</dt>
          <dd>{o.teacher.name}</dd>
        </div>
      </dl>

      {ch && (
        <div className="cp-change" role="note">
          <p className="cp-change-what">
            {ch.kind === 'cancelled'
              ? `Cancelled for ${DAY_LONG[dow(ch.from.date)]} ${ch.from.date.slice(8)} only.`
              : o.status === 'moved-here'
                ? `Moved here from ${dayLabel(ch.from.date)}, ${ch.from.start} in ${ch.from.room}.`
                : `Moved to ${dayLabel(ch.to!.date)}, ${ch.to!.start} in ${ch.to!.room}.`}
          </p>
          {ch.reason && <p className="cp-change-reason">“{ch.reason}”</p>}
          <p className="cp-change-by">{ch.by} · {ago(ch.at)}</p>
        </div>
      )}

      {may && !past && (
        <div className="cp-actions">
          {!ch && (
            <>
              <button type="button" className="btn btn-primary" onClick={actions.onReschedule} disabled={busy}>
                <Icon name="move" /> Reschedule
              </button>
              <button type="button" className="btn btn-quiet-danger" onClick={actions.onCancel} disabled={busy}>
                Cancel this class
              </button>
            </>
          )}
          {ch && (
            <button type="button" className="btn" onClick={actions.onUndo} disabled={busy}>
              <Icon name="undo" /> {ch.kind === 'cancelled' ? 'Undo the cancellation' : 'Undo the move'}
            </button>
          )}
        </div>
      )}
      {may && past && <p className="cp-hint">This class has already happened, so it can’t be changed.</p>}
      {!may && full && full.role !== 'student' && (
        <p className="cp-hint">Only {o.teacher.name} or a coordinator can change this class.</p>
      )}

      <div className="cp-section">
        <h3 className="cp-h3">Every week</h3>
        <p className="cp-regular">
          {cls ? (
            <>
              {DAY_LONG[cls.day]}s, <span className="mono">{cls.start}–{cls.end}</span>, {regularRoom?.name}
            </>
          ) : (
            <>
              {DAY_LONG[dow(ch?.from.date ?? o.date)]}s, <span className="mono">{ch?.from.start ?? o.start}</span>
            </>
          )}
        </p>
        {others.length > 0 && (
          <>
            <h3 className="cp-h3">Other {o.course.code} classes this week</h3>
            <ul className="cp-others">
              {others.map((x) => (
                <li key={x.key} className={x.status === 'cancelled' ? 'is-cancelled' : ''}>
                  <span>{dayLabel(x.date)}</span>
                  <span className="mono">{x.start}</span>
                  <span className="mono">{x.room.name}</span>
                  {x.status === 'cancelled' && <span className="chip">Cancelled</span>}
                  {x.status === 'moved-here' && <span className="chip chip-changed">Moved</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
});
