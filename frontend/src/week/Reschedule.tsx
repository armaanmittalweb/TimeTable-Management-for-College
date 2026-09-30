// Reschedule mode: free slots light up, busy ones go hatched with the reason on hover; drag the class or click a
// slot, pick a room, confirm. A 409 shows who took the slot and offers the API's suggestion.

import { useCallback, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Occurrence, SlotAvailability, WorkspaceFull } from '../contract';
import { api, ApiFailure } from '../api';
import { Icon } from '../ui/Icon';
import { DAY_LONG, DAY_SHORT, dayLabel, dow, fromMin, toMin } from '../lib/time';
import type { Column } from './TimeGrid';

export interface ReschedState {
  occ: Occurrence;
  weekStart: string;
  slots: SlotAvailability[] | null;
  slotsError: ApiFailure | null;
  pick: SlotAvailability | null;
  roomId: number | null;
  reason: string;
  saving: boolean;
  error: ApiFailure | null;
}

export const slotId = (s: { date: string; start: string }) => `${s.date}T${s.start}`;
export const isFree = (s: SlotAvailability) => !s.teacherBusy && !s.batchBusy && s.freeRooms.length > 0;
const isCurrent = (s: SlotAvailability, o: Occurrence) => s.date === o.date && s.start === o.start;

export function useReschedule(full: WorkspaceFull | undefined) {
  const [st, setSt] = useState<ReschedState | null>(null);
  const slug = full?.workspace.slug;

  const loadSlots = useCallback(
    async (occ: Occurrence, weekStart: string) => {
      if (!slug) return;
      try {
        const slots = await api.w(slug).slots(occ.classId, weekStart, occ.date);
        setSt((s) => (s && s.occ.key === occ.key && s.weekStart === weekStart ? { ...s, slots, slotsError: null } : s));
      } catch (e) {
        setSt((s) => (s && s.occ.key === occ.key ? { ...s, slots: [], slotsError: e instanceof ApiFailure ? e : new ApiFailure(0, null, true) } : s));
      }
    },
    [slug],
  );

  const start = useCallback(
    (occ: Occurrence, weekStart: string) => {
      setSt({ occ, weekStart, slots: null, slotsError: null, pick: null, roomId: null, reason: '', saving: false, error: null });
      void loadSlots(occ, weekStart);
    },
    [loadSlots],
  );
  const setWeek = useCallback(
    (weekStart: string) => {
      setSt((s) => {
        if (!s || s.weekStart === weekStart) return s;
        void loadSlots(s.occ, weekStart);
        return { ...s, weekStart, slots: null, pick: null, roomId: null, error: null };
      });
    },
    [loadSlots],
  );
  const pick = useCallback((slot: SlotAvailability) => {
    setSt((s) => {
      if (!s) return s;
      const current = slot.freeRooms.find((r) => r.id === s.occ.room.id);
      return { ...s, pick: slot, roomId: (current ?? slot.freeRooms[0])?.id ?? null, error: null };
    });
  }, []);
  const refreshSlots = useCallback(() => {
    setSt((s) => {
      if (s) void loadSlots(s.occ, s.weekStart);
      return s;
    });
  }, [loadSlots]);
  return { st, setSt, start, setWeek, pick, stop: useCallback(() => setSt(null), []), refreshSlots };
}
export type Resched = ReturnType<typeof useReschedule>;

function busyReason(s: SlotAvailability, o: Occurrence, full: WorkspaceFull) {
  const size = full.batches.find((b) => b.id === o.batch.id)?.size;
  if (s.batchBusy && s.teacherBusy) return `${o.batch.name} and ${o.teacher.name} both have classes`;
  if (s.batchBusy) return `${o.batch.name} has another class`;
  if (s.teacherBusy) return `${o.teacher.name} is teaching another batch`;
  return size ? `No free room seats ${size}` : 'No free room';
}

/** Slot cells for one day column. Each cell is one period tall; hovering shows the class's full length. */
export function SlotOverlay({ col, r, pos, full, over, onPick, periodLen }: {
  col: Column; r: ReschedState; pos: (s: string, e: string) => { top: number; height: number }; full: WorkspaceFull;
  over: string | null; onPick: (s: SlotAvailability) => void; periodLen: (start: string) => number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (!r.slots) return null;
  const mine = r.slots.filter((s) => s.date === col.key && !isCurrent(s, r.occ));
  const show = hover ?? over ?? (r.pick && r.pick.date === col.key ? slotId(r.pick) : null);
  const shown = show ? mine.find((s) => slotId(s) === show) : null;
  return (
    <>
      {mine.map((s) => {
        const p = pos(s.start, s.end);
        const cellH = Math.min(p.height, pos(s.start, fromMin(toMin(s.start) + periodLen(s.start))).height);
        const id = slotId(s);
        const style = { top: p.top + 1, height: cellH - 2 };
        if (!isFree(s)) {
          const why = busyReason(s, r.occ, full);
          return (
            <span key={id} className="slot is-busy" style={style} title={why} aria-hidden="true">
              <span className="slot-why">{why}</span>
            </span>
          );
        }
        const picked = r.pick && slotId(r.pick) === id;
        const room = picked ? s.freeRooms.find((x) => x.id === r.roomId)?.name : null;
        return (
          <button
            key={id}
            type="button"
            className={`slot is-free${picked ? ' is-picked' : ''}${over === id ? ' is-over' : ''}`}
            style={style}
            data-slot={id}
            aria-label={`Move to ${DAY_LONG[dow(s.date)]} ${s.start} to ${s.end}. ${s.freeRooms.length} rooms free.`}
            aria-pressed={!!picked}
            onClick={() => onPick(s)}
            onPointerEnter={() => setHover(id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(id)}
            onBlur={() => setHover(null)}
          >
            <span>{picked ? `${s.start} · ${room}` : 'Free'}</span>
            {!picked && <span className="slot-rooms">{s.freeRooms.length} {s.freeRooms.length === 1 ? 'room' : 'rooms'}</span>}
          </button>
        );
      })}
      {shown && toMin(shown.end) - toMin(shown.start) > periodLen(shown.start) && (
        <span className={`slot-ghost c${r.occ.course.color}`} style={{ top: pos(shown.start, shown.end).top + 1, height: pos(shown.start, shown.end).height - 2 }} />
      )}
    </>
  );
}

/** Pointer drag of the moving block onto a free slot. Returns handlers for the block and the ghost to render. */
export function useDrag(onDrop: (slotKey: string) => void) {
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number; w: number; over: string | null } | null>(null);
  const moved = useRef(false);
  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    moved.current = false;
    el.setPointerCapture(e.pointerId);
    const hit = (x: number, y: number) => {
      const under = document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.slot);
      return (under as HTMLElement | undefined)?.dataset.slot ?? null;
    };
    const move = (ev: PointerEvent) => {
      if (!moved.current && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      moved.current = true;
      setDrag({ x: ev.clientX, y: ev.clientY, dx: startX - rect.left, dy: startY - rect.top, w: rect.width, over: hit(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved.current) {
        const target = hit(ev.clientX, ev.clientY);
        if (target) onDrop(target);
      }
      setDrag(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  /** Swallow the click that follows a drag so it doesn't reopen the panel. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  };
  return { drag, onPointerDown, onClickCapture };
}

/** The bar pinned to the bottom while rescheduling. */
export function ConfirmBar({ r, onRoom, onReason, onConfirm, onCancel, onSuggestion }: {
  r: ReschedState; onRoom: (id: number) => void; onReason: (s: string) => void; onConfirm: () => void; onCancel: () => void; onSuggestion: () => void;
}) {
  const o = r.occ;
  const from = `${DAY_SHORT[dow(o.date)]} ${o.start}`;
  const sug = r.error?.suggestion;
  if (r.error) {
    return (
      <div className="confirm is-error" role="alert">
        <Icon name="alert" className="confirm-ico" />
        <div className="confirm-text">
          <b>{r.error.message}</b>
          <span>{r.error.code === 'clash' ? 'Someone booked that slot a moment ago.' : 'Nothing was changed.'}</span>
        </div>
        <div className="confirm-actions">
          {sug && (
            <button type="button" className="btn btn-primary" onClick={onSuggestion}>
              Use {DAY_SHORT[dow(sug.date)]} {sug.start} in {sug.freeRooms[0]?.name}
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel}>Stop moving</button>
        </div>
      </div>
    );
  }
  if (!r.pick) {
    const free = r.slots?.filter(isFree).length ?? 0;
    return (
      <div className="confirm" role="region" aria-label="Reschedule">
        <span className={`swatch c${o.course.color}`} aria-hidden="true" />
        <div className="confirm-text">
          <b>Pick a new time for {o.course.code} ({from})</b>
          <span>
            {r.slots === null ? 'Finding free slots…' : r.slotsError ? r.slotsError.message : free ? `${free} free slots this week. Drag the class or click a highlighted slot.` : 'No free slots left this week. Try next week with →.'}
          </span>
        </div>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
        </div>
      </div>
    );
  }
  const p = r.pick;
  return (
    <div className="confirm" role="region" aria-label="Confirm the move">
      <span className={`swatch c${o.course.color}`} aria-hidden="true" />
      <div className="confirm-text">
        <b>
          Move {o.course.code} from {from} to {DAY_SHORT[dow(p.date)]} {p.start} in{' '}
          <label className="sr-only" htmlFor="move-room">Room</label>
          <select id="move-room" className="confirm-room" value={r.roomId ?? ''} onChange={(e) => onRoom(Number(e.target.value))}>
            {p.freeRooms.map((x) => (
              <option key={x.id} value={x.id}>{x.name} · {x.capacity}</option>
            ))}
          </select>
        </b>
        <input className="input confirm-reason" placeholder="Reason students will see (optional)" value={r.reason} maxLength={200} onChange={(e) => onReason(e.target.value)} aria-label="Reason (optional)" />
      </div>
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={r.saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={r.saving || !r.roomId} data-autofocus>
          {r.saving ? 'Moving…' : 'Confirm move'}
        </button>
      </div>
    </div>
  );
}

/** Side panel in reschedule mode: every free slot as a button (the keyboard way to pick one). */
export function FreeSlotList({ r, onPick, onCancel }: { r: ReschedState; onPick: (s: SlotAvailability) => void; onCancel: () => void }) {
  const o = r.occ;
  const free = (r.slots ?? []).filter((s) => isFree(s) && !isCurrent(s, o));
  const days = [...new Set(free.map((s) => s.date))];
  return (
    <div className="cp">
      <div className="cp-head">
        <span className="cp-code mono">{o.course.code}</span>
        <span className="chip chip-changed">Rescheduling</span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm cp-x" onClick={onCancel} aria-label="Stop rescheduling">
          <Icon name="x" />
        </button>
      </div>
      <h2 className="cp-title" tabIndex={-1} data-panel-heading>Move {dayLabel(o.date)}, {o.start}</h2>
      <p className="cp-hint">{o.batch.name} with {o.teacher.name}. Grey slots are taken; hover one to see why.</p>
      {r.slots === null && <p className="cp-hint">Finding free slots…</p>}
      {r.slots && !free.length && <p className="cp-hint">Nothing is free for the rest of this week. Use → to look at next week.</p>}
      <div className="freelist">
        {days.map((d) => (
          <div key={d} className="freelist-day">
            <h3 className="cp-h3">{dayLabel(d)}</h3>
            <div className="freelist-slots">
              {free
                .filter((s) => s.date === d)
                .map((s) => (
                  <button
                    key={slotId(s)}
                    type="button"
                    className={`freelist-slot${r.pick && slotId(r.pick) === slotId(s) ? ' is-picked' : ''}`}
                    onClick={() => onPick(s)}
                    aria-pressed={!!r.pick && slotId(r.pick) === slotId(s)}
                    aria-label={`${DAY_LONG[dow(s.date)]} ${s.start}, ${s.freeRooms.length} rooms free`}
                  >
                    <span className="mono">{s.start}</span>
                    <span className="freelist-rooms">{s.freeRooms.length}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <dl className="legend">
        <div><dt><span className="lg lg-free" /></dt><dd>Free for {o.batch.name}, {o.teacher.short} and a room</dd></div>
        <div><dt><span className="lg lg-busy" /></dt><dd>Taken: batch, teacher or rooms busy</dd></div>
      </dl>
    </div>
  );
}
