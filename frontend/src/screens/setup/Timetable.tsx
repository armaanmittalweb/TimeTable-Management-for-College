// The timetable step: the week grid in edit mode for one batch, with a palette of courses to drop in.

import { useMemo, useState, type DragEvent } from 'react';
import type { ClassRow, Occurrence, WorkspaceFull } from '../../contract';
import { api, ApiFailure } from '../../api';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { toast } from '../../ui/Toast';
import { DAY_LONG, DAY_SHORT, fromMin, overlaps, toMin } from '../../lib/time';
import { plural } from '../../lib/format';
import { TimeGrid, type Column } from '../../week/TimeGrid';
import { ImportDialog } from './Tables';

type Draft = { id: number | null; day: number; start: string; end: string; courseId: number | ''; roomId: number | ''; teacherId: number | '' };

/** A weekly class drawn as an occurrence so the normal grid can show it. */
function asOcc(full: WorkspaceFull, c: ClassRow): Occurrence {
  const course = full.courses.find((x) => x.id === c.courseId)!;
  const t = full.teachers.find((x) => x.id === c.teacherId)!;
  const r = full.rooms.find((x) => x.id === c.roomId)!;
  const b = full.batches.find((x) => x.id === c.batchId)!;
  return {
    key: `c${c.id}`, classId: c.id, date: `2000-01-0${c.day + 2}`, start: c.start, end: c.end,
    course: { id: course.id, code: course.code, name: course.name, color: course.color },
    teacher: { id: t.id, name: t.name, short: t.short }, room: { id: r.id, name: r.name }, batch: { id: b.id, name: b.name },
    status: 'scheduled', change: null,
  };
}

export function TimetableStep({ full, onSaved }: { full: WorkspaceFull; onSaved: () => void }) {
  const [batchId, setBatchId] = useState<number | null>(full.batches[0]?.id ?? null);
  const [paletteCourse, setPaletteCourse] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const days = full.workspace.days.slice().sort();
  const teaching = full.periods.filter((p) => !p.isBreak);
  const batch = full.batches.find((b) => b.id === batchId);

  const classes = useMemo(() => full.classes.filter((c) => c.batchId === batchId), [full.classes, batchId]);
  const columns: Column[] = days.map((d) => {
    const items = classes.filter((c) => c.day === d).map((c) => asOcc(full, c));
    return {
      key: String(d), label: `${DAY_LONG[d]}, ${plural(items.length, 'class', 'classes')}`, items,
      head: <><span className="tg-dow">{DAY_SHORT[d]}</span><span className="tg-count">{items.length || ''}</span></>,
    };
  });

  if (!full.batches.length || !full.courses.length || !full.rooms.length) {
    return (
      <div className="setup-form">
        <p className="setup-lead">Place each batch’s classes on the week.</p>
        <div className="empty">
          <h2>Add the pieces first</h2>
          <p>The timetable needs at least one room, batch and course (with a teacher). {[!full.rooms.length && 'Rooms', !full.batches.length && 'Batches', !full.courses.length && 'Courses'].filter(Boolean).join(', ')} still empty.</p>
        </div>
      </div>
    );
  }

  const openNew = (day: number, start: string, courseId?: number | null) => {
    const course = full.courses.find((c) => c.id === (courseId ?? paletteCourse));
    const p = full.periods.find((x) => x.start === start);
    const end = p ? p.end : fromMin(toMin(start) + 60);
    setErr(null);
    setDraft({ id: null, day, start, end, courseId: course?.id ?? '', teacherId: course?.teacherId ?? '', roomId: bestRoom(day, start, end) ?? '' });
  };
  const bestRoom = (day: number, start: string, end: string, exclude?: number) => {
    const taken = new Set(full.classes.filter((c) => c.day === day && c.id !== exclude && overlaps(c.start, c.end, start, end)).map((c) => c.roomId));
    const fits = full.rooms.filter((r) => !taken.has(r.id) && r.capacity >= (batch?.size ?? 0)).sort((a, b) => a.capacity - b.capacity);
    return fits[0]?.id;
  };
  const save = async () => {
    if (!draft || !batchId || draft.courseId === '' || draft.roomId === '' || draft.teacherId === '') return;
    setBusy(true);
    setErr(null);
    const body = { courseId: draft.courseId, batchId, teacherId: draft.teacherId, roomId: draft.roomId, day: draft.day, start: draft.start, end: draft.end };
    try {
      const w = api.w(full.workspace.slug).classes;
      await (draft.id ? w.update(draft.id, body) : w.create(body));
      const code = full.courses.find((c) => c.id === draft.courseId)?.code;
      toast(draft.id ? `${code} updated.` : `${code} added on ${DAY_SHORT[draft.day]} ${draft.start}.`);
      setDraft(null);
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not save the class.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await api.w(full.workspace.slug).classes.remove(draft.id);
      toast('Class removed from the timetable.');
      setDraft(null);
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not remove the class.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent, day: number, start: string) => {
    e.preventDefault();
    setDropOver(null);
    const id = Number(e.dataTransfer.getData('text/x-course'));
    if (id) openNew(day, start, id);
  };

  const hoursOf = (courseId: number) => classes.filter((c) => c.courseId === courseId).reduce((h, c) => h + (toMin(c.end) - toMin(c.start)) / 60, 0);

  return (
    <div className="setup-form tt">
      <p className="setup-lead">Pick a batch, then drag a course onto a period (or click an empty period). EduSched checks the room, the teacher and the batch before saving, so a double booking can’t get in.</p>
      <div className="tbl-tools">
        <label className="tt-batch">
          <span className="field-label">Batch</span>
          <select className="select select-sm" value={batchId ?? ''} onChange={(e) => setBatchId(Number(e.target.value))}>
            {full.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <span className="muted">{plural(classes.length, 'class', 'classes')} · {classes.reduce((h, c) => h + (toMin(c.end) - toMin(c.start)) / 60, 0)} h a week</span>
        <button type="button" className="btn btn-sm" onClick={() => setImporting(true)}><Icon name="upload" /> Import classes CSV</button>
      </div>
      <div className="tt-layout">
        <aside className="palette" aria-label="Courses">
          <h3 className="cp-h3">Courses</h3>
          <p className="field-hint">Drag onto the grid, or select one and click a period.</p>
          <ul>
            {full.courses.map((c) => {
              const t = full.teachers.find((x) => x.id === c.teacherId);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/x-course', String(c.id));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className={`pal c${c.color}${paletteCourse === c.id ? ' is-on' : ''}`}
                    aria-pressed={paletteCourse === c.id}
                    onClick={() => setPaletteCourse(paletteCourse === c.id ? null : c.id)}
                  >
                    <span className="pal-code">{c.code}</span>
                    <span className="pal-name">{c.name}</span>
                    <span className="pal-meta mono">{t?.short ?? 'no teacher'} · {hoursOf(c.id)} h</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="tt-grid">
          <TimeGrid
            periods={full.periods}
            columns={columns}
            meta="teacher"
            label={`Weekly timetable for ${batch?.name}`}
            colMin={120}
            onOpen={(o) => {
              const c = full.classes.find((x) => x.id === o.classId)!;
              setErr(null);
              setDraft({ id: c.id, day: c.day, start: c.start, end: c.end, courseId: c.courseId, roomId: c.roomId, teacherId: c.teacherId });
            }}
            overlay={(col, pos) =>
              teaching
                .filter((p) => !col.items.some((o) => overlaps(o.start, o.end, p.start, p.end)))
                .map((p) => {
                  const id = `${col.key}-${p.start}`;
                  return (
                    <button
                      key={p.start}
                      type="button"
                      className={`addcell${dropOver === id ? ' is-over' : ''}${paletteCourse ? ' is-armed' : ''}`}
                      style={{ top: pos(p.start, p.end).top + 1, height: pos(p.start, p.end).height - 2 }}
                      onClick={() => openNew(Number(col.key), p.start)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropOver(id);
                      }}
                      onDragLeave={() => setDropOver(null)}
                      onDrop={(e) => onDrop(e, Number(col.key), p.start)}
                      aria-label={`Add a class on ${DAY_LONG[Number(col.key)]} at ${p.start}`}
                    >
                      <Icon name="plus" size={14} />
                      <span>{paletteCourse ? full.courses.find((c) => c.id === paletteCourse)?.code : 'Add'}</span>
                    </button>
                  );
                })
            }
          />
        </div>
      </div>

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft ? `${draft.id ? 'Edit' : 'Add'} a class · ${DAY_LONG[draft.day]} ${draft.start}` : ''}
        size="sm"
        description={batch ? `For ${batch.name}${batch.size ? `, ${batch.size} students` : ''}. This repeats every week.` : undefined}
        footer={
          <>
            {draft?.id && <button type="button" className="btn btn-quiet-danger dlg-left" onClick={() => void remove()} disabled={busy}><Icon name="trash" /> Remove</button>}
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !draft || draft.courseId === '' || draft.roomId === '' || draft.teacherId === ''}>
              {busy ? 'Checking…' : draft?.id ? 'Save class' : 'Add class'}
            </button>
          </>
        }
      >
        {draft && (
          <div className="form">
            <div className="field">
              <label htmlFor="d-course">Course</label>
              <select
                id="d-course"
                className="select"
                value={draft.courseId}
                data-autofocus
                onChange={(e) => {
                  const c = full.courses.find((x) => x.id === Number(e.target.value));
                  setDraft({ ...draft, courseId: c?.id ?? '', teacherId: c?.teacherId ?? draft.teacherId });
                }}
              >
                <option value="">Choose a course</option>
                {full.courses.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
              </select>
            </div>
            <div className="form-grid form-grid-2">
              <div className="field">
                <label htmlFor="d-start">Starts</label>
                <select id="d-start" className="select mono" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })}>
                  {teaching.map((p) => <option key={p.start} value={p.start}>{p.start}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="d-end">Ends</label>
                <select id="d-end" className="select mono" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })}>
                  {teaching.filter((p) => p.end > draft.start).map((p) => <option key={p.end} value={p.end}>{p.end}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="d-room">Room</label>
              <select id="d-room" className="select" value={draft.roomId} onChange={(e) => setDraft({ ...draft, roomId: Number(e.target.value) })}>
                <option value="">Choose a room</option>
                {full.rooms.map((r) => {
                  const taken = full.classes.some((c) => c.day === draft.day && c.id !== draft.id && c.roomId === r.id && overlaps(c.start, c.end, draft.start, draft.end));
                  const small = batch?.size && r.capacity < batch.size;
                  return <option key={r.id} value={r.id}>{r.name} · {r.capacity} seats{taken ? ' · booked' : small ? ' · too small' : ''}</option>;
                })}
              </select>
            </div>
            <div className="field">
              <label htmlFor="d-teacher">Teacher</label>
              <select id="d-teacher" className="select" value={draft.teacherId} onChange={(e) => setDraft({ ...draft, teacherId: Number(e.target.value) })}>
                <option value="">Choose a teacher</option>
                {full.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {err && <p className="form-error" role="alert"><Icon name="alert" size={14} /> {err}</p>}
          </div>
        )}
      </Dialog>
      <ImportDialog open={importing} onClose={() => setImporting(false)} kind="classes" full={full} onDone={onSaved} />
    </div>
  );
}
