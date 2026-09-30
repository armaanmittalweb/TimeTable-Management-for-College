// Rooms, teachers, batches and courses: a table with inline editing, an "add" row, and CSV import with a dry run.

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ImportReport, WorkspaceFull } from '../../contract';
import { api, ApiFailure, type ImportKind } from '../../api';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { toast } from '../../ui/Toast';
import { plural } from '../../lib/format';

type Kind = 'rooms' | 'teachers' | 'batches' | 'courses';
type Val = string;
interface Col { key: string; label: string; type: 'text' | 'number' | 'select' | 'color'; width?: string; placeholder?: string; options?: { value: string; label: string }[]; mono?: boolean; required?: boolean }
type Row = Record<string, Val> & { id: string };

const LEADS: Record<Kind, string> = {
  rooms: 'Every room classes can happen in. Capacity decides which rooms are offered when a class moves: a room is only suggested if the batch fits.',
  teachers: 'Teachers appear on the grid by their initials. Invite them in Codes and members so they can move their own classes.',
  batches: 'A batch is a group of students who share a timetable, like CSE-2A. Each gets a class code students use to follow it.',
  courses: 'Each course gets one of eight quiet colours so it’s easy to spot on the week. The teacher is the default for new classes.',
};
const SINGULAR: Record<Kind, string> = { rooms: 'room', teachers: 'teacher', batches: 'batch', courses: 'course' };

function config(kind: Kind, full: WorkspaceFull): { cols: Col[]; rows: Row[] } {
  const teacherOpts = [{ value: '', label: 'No teacher yet' }, ...full.teachers.map((t) => ({ value: String(t.id), label: `${t.name} (${t.short})` }))];
  if (kind === 'rooms')
    return {
      cols: [
        { key: 'name', label: 'Room', type: 'text', placeholder: 'CR-201', mono: true, required: true },
        { key: 'capacity', label: 'Seats', type: 'number', placeholder: '60', width: '90px', required: true },
        { key: 'building', label: 'Building', type: 'text', placeholder: 'Main Block' },
        { key: 'kind', label: 'Kind', type: 'select', width: '120px', options: [{ value: 'lecture', label: 'Lecture' }, { value: 'lab', label: 'Lab' }] },
      ],
      rows: full.rooms.map((r) => ({ id: String(r.id), name: r.name, capacity: String(r.capacity), building: r.building ?? '', kind: r.kind })),
    };
  if (kind === 'teachers')
    return {
      cols: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'Meera Iyer', required: true },
        { key: 'short', label: 'Initials', type: 'text', placeholder: 'MI', width: '90px', mono: true, required: true },
        { key: 'email', label: 'Email', type: 'text', placeholder: 'optional' },
      ],
      rows: full.teachers.map((t) => ({ id: String(t.id), name: t.name, short: t.short, email: t.email ?? '', account: t.hasAccount ? 'yes' : '' })),
    };
  if (kind === 'batches')
    return {
      cols: [
        { key: 'name', label: 'Batch', type: 'text', placeholder: 'CSE-2A', mono: true, required: true },
        { key: 'size', label: 'Students', type: 'number', placeholder: '58', width: '100px' },
      ],
      rows: full.batches.map((b) => ({ id: String(b.id), name: b.name, size: b.size ? String(b.size) : '', code: b.code })),
    };
  return {
    cols: [
      { key: 'color', label: 'Colour', type: 'color', width: '84px' },
      { key: 'code', label: 'Code', type: 'text', placeholder: 'CS201', width: '110px', mono: true, required: true },
      { key: 'name', label: 'Course', type: 'text', placeholder: 'Data Structures', required: true },
      { key: 'teacherId', label: 'Teacher', type: 'select', options: teacherOpts },
    ],
    rows: full.courses.map((c) => ({ id: String(c.id), code: c.code, name: c.name, color: String(c.color), teacherId: c.teacherId ? String(c.teacherId) : '' })),
  };
}

function toBody(kind: Kind, v: Record<string, string>) {
  if (kind === 'rooms') return { name: v.name.trim(), capacity: Number(v.capacity), building: v.building?.trim() || null, kind: (v.kind || 'lecture') as 'lecture' | 'lab' };
  if (kind === 'teachers') return { name: v.name.trim(), short: v.short.trim().toUpperCase(), email: v.email?.trim() || null };
  if (kind === 'batches') return { name: v.name.trim(), size: v.size ? Number(v.size) : null };
  return { code: v.code.trim().toUpperCase(), name: v.name.trim(), color: Number(v.color || 1), teacherId: v.teacherId ? Number(v.teacherId) : null };
}

export function ResourceStep({ kind, full, onSaved }: { kind: Kind; full: WorkspaceFull; onSaved: () => void }) {
  const { cols, rows } = config(kind, full);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const blank = () => Object.fromEntries(cols.map((c) => [c.key, c.type === 'select' ? c.options?.[0]?.value ?? '' : c.type === 'color' ? String((rows.length % 8) + 1) : '']));
  const [fresh, setFresh] = useState<Record<string, string>>(blank);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const firstNew = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const w = api.w(full.workspace.slug)[kind] as unknown as {
    create: (b: unknown) => Promise<unknown>; update: (id: number, b: unknown) => Promise<unknown>; remove: (id: number) => Promise<unknown>;
  };

  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(done);
      onSaved();
      return true;
    } catch (x) {
      setErr({ id, msg: x instanceof ApiFailure ? x.message : 'Could not save.' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const missing = (v: Record<string, string>) => cols.some((c) => c.required && !v[c.key]?.trim());
  const saveEdit = async () => {
    if (!editing || missing(draft)) return;
    if (await run(editing, () => w.update(Number(editing), toBody(kind, draft)), `${draft.name || draft.code} saved.`)) setEditing(null);
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (missing(fresh)) return setErr({ id: 'new', msg: `Fill in ${cols.filter((c) => c.required && !fresh[c.key]?.trim()).map((c) => c.label.toLowerCase()).join(' and ')}.` });
    if (await run('new', () => w.create(toBody(kind, fresh)), `${fresh.name || fresh.code} added.`)) {
      setFresh(blank());
      requestAnimationFrame(() => firstNew.current?.focus());
    }
  };
  const onRowKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.preventDefault(), void saveEdit());
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setEditing(null));
  };

  const input = (c: Col, v: Record<string, string>, set: (k: string, x: string) => void, label: string, ref?: typeof firstNew) => {
    if (c.type === 'select')
      return (
        <select ref={ref as React.Ref<HTMLSelectElement>} className="select input-sm" value={v[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} aria-label={label}>
          {c.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    if (c.type === 'color')
      return (
        <select className={`select input-sm color-select c${v[c.key] || 1}`} value={v[c.key] || '1'} onChange={(e) => set(c.key, e.target.value)} aria-label={label}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{['Blue', 'Green', 'Amber', 'Violet', 'Rose', 'Teal', 'Olive', 'Slate'][n - 1]}</option>)}
        </select>
      );
    return (
      <input
        ref={ref as React.Ref<HTMLInputElement>}
        className={`input input-sm${c.mono ? ' mono' : ''}`}
        type={c.type === 'number' ? 'number' : 'text'}
        min={c.type === 'number' ? 1 : undefined}
        inputMode={c.type === 'number' ? 'numeric' : undefined}
        value={v[c.key] ?? ''}
        placeholder={c.placeholder}
        onChange={(e) => set(c.key, e.target.value)}
        aria-label={label}
      />
    );
  };

  const show = (c: Col, r: Row) => {
    if (c.type === 'color') return <span className={`swatch swatch-lg c${r.color}`} aria-label={`Colour ${r.color}`} />;
    if (c.type === 'select') return c.options!.find((o) => o.value === r[c.key])?.label ?? <span className="muted">–</span>;
    return r[c.key] ? r[c.key] : <span className="muted">–</span>;
  };

  return (
    <div className="setup-form">
      <p className="setup-lead">{LEADS[kind]}</p>
      <div className="tbl-tools">
        <span className="muted">{plural(rows.length, SINGULAR[kind], kind === 'batches' ? 'batches' : `${SINGULAR[kind]}s`)}</span>
        <button type="button" className="btn btn-sm" onClick={() => setImporting(true)}><Icon name="upload" /> Import CSV</button>
      </div>
      <form onSubmit={add}>
        <table className="tbl tbl-edit">
          <thead>
            <tr>
              {cols.map((c) => <th key={c.key} scope="col" style={{ width: c.width }}>{c.label}</th>)}
              {kind === 'batches' && <th scope="col">Class code</th>}
              {kind === 'teachers' && <th scope="col">Account</th>}
              <th scope="col" className="tbl-actions-h"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              editing === r.id ? (
                <tr key={r.id} className="is-editing" onKeyDown={onRowKey}>
                  {cols.map((c) => <td key={c.key}>{input(c, draft, (k, x) => setDraft((d) => ({ ...d, [k]: x })), `${c.label} for ${r.name || r.code}`)}</td>)}
                  {kind === 'batches' && <td className="mono muted">{r.code}</td>}
                  {kind === 'teachers' && <td />}
                  <td className="tbl-actions">
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy || missing(draft)} onClick={() => void saveEdit()}>Save</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.mono ? 'mono' : ''} onDoubleClick={() => (setEditing(r.id), setDraft(r), setErr(null))}>
                      {show(c, r)}
                    </td>
                  ))}
                  {kind === 'batches' && <td className="mono">{r.code}</td>}
                  {kind === 'teachers' && <td>{r.account ? <span className="chip chip-ok">Signed in</span> : <span className="muted">Not yet</span>}</td>}
                  <td className="tbl-actions">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => (setEditing(r.id), setDraft(r), setErr(null))} aria-label={`Edit ${r.name || r.code}`}>Edit</button>
                    <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirmDel(r)} aria-label={`Delete ${r.name || r.code}`}><Icon name="trash" /></button>
                  </td>
                </tr>
              ),
            )}
            <tr className="tbl-new">
              {cols.map((c, i) => <td key={c.key}>{input(c, fresh, (k, x) => setFresh((d) => ({ ...d, [k]: x })), `New ${SINGULAR[kind]}: ${c.label}`, i === 0 || (i === 1 && cols[0].type === 'color') ? firstNew : undefined)}</td>)}
              {kind === 'batches' && <td className="muted tbl-note">made for you</td>}
              {kind === 'teachers' && <td />}
              <td className="tbl-actions"><button type="submit" className="btn btn-sm" disabled={busy}><Icon name="plus" /> Add</button></td>
            </tr>
          </tbody>
        </table>
      </form>
      {err && <p className="form-error" role="alert">{err.msg}</p>}
      {!rows.length && <p className="tbl-empty">No {kind} yet. Type the first one in the row above, or import a spreadsheet.</p>}
      <p className="field-hint">Double-click a row to edit it. Enter saves, Esc cancels.</p>

      <Dialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={`Delete ${confirmDel?.name || confirmDel?.code}?`}
        size="sm"
        description={kind === 'batches' ? 'Its class code stops working. Students who follow it will see “code not found”.' : 'If anything still uses it, EduSched will say what, and nothing is deleted.'}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmDel(null)}>Keep it</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                const r = confirmDel!;
                setConfirmDel(null);
                try {
                  await w.remove(Number(r.id));
                  toast(`${r.name || r.code} deleted.`);
                  onSaved();
                } catch (x) {
                  toast(x instanceof ApiFailure ? x.message : 'Could not delete it.', { tone: 'error', ms: 8000 });
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} kind={kind} full={full} onDone={onSaved} />
    </div>
  );
}

export function ImportDialog({ open, onClose, kind, full, onDone }: { open: boolean; onClose: () => void; kind: ImportKind; full: WorkspaceFull; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const w = api.w(full.workspace.slug);
  const reset = () => {
    setCsv('');
    setFile(null);
    setReport(null);
    setErr(null);
  };
  const template = async () => {
    try {
      const text = await w.template(kind);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `edusched-${kind}-template.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not download the template.');
    }
  };
  const check = async (dryRun: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await w.import({ kind, csv, dryRun });
      if (!dryRun && r.ok) {
        toast(`Imported ${plural(r.created + r.updated, 'row')}: ${r.created} new, ${r.updated} updated.`);
        onDone();
        reset();
        onClose();
      } else setReport(r);
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };
  const rowsIn = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;
  return (
    <Dialog
      open={open}
      onClose={() => (reset(), onClose())}
      title={`Import ${kind} from CSV`}
      size="lg"
      description="Nothing is saved until you import. EduSched checks the whole file first, and if any line has a problem, nothing is written."
      footer={
        report?.ok ? (
          <>
            <button type="button" className="btn" onClick={() => setReport(null)}>Back</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void check(false)}>{busy ? 'Importing…' : `Import ${plural(report.created + report.updated, 'row')}`}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => (reset(), onClose())}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !csv.trim()} onClick={() => void check(true)}>{busy ? 'Checking…' : 'Check the file'}</button>
          </>
        )
      }
    >
      {!report && (
        <div className="import">
          <div className="import-step">
            <span className="import-n mono">1</span>
            <div>
              <p>Start from the template so the columns match.</p>
              <button type="button" className="btn btn-sm" onClick={() => void template()}><Icon name="download" /> Download {kind}-template.csv</button>
            </div>
          </div>
          <div className="import-step">
            <span className="import-n mono">2</span>
            <div className="import-grow">
              <p>Choose the filled-in file, or paste the rows.</p>
              <label className="btn btn-sm import-file">
                <Icon name="upload" /> {file ?? 'Choose a CSV file'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 512 * 1024) return setErr('That file is over 512 KB. Split it into smaller files.');
                    setFile(f.name);
                    setCsv(await f.text());
                  }}
                />
              </label>
              <label className="sr-only" htmlFor="csv-text">CSV rows</label>
              <textarea id="csv-text" className="textarea mono import-text" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={kind === 'classes' ? 'day,start,end,course,batch,room,teacher\nMon,09:00,10:00,CS201,CSE-2A,CR-201,' : 'Paste CSV here'} spellCheck={false} />
              <span className="field-hint">{rowsIn ? `${plural(rowsIn, 'row')} after the header` : 'The first line must be the header.'}</span>
            </div>
          </div>
        </div>
      )}
      {report && report.ok && (
        <div className="report is-ok" role="status">
          <Icon name="check" />
          <div>
            <b>Every line checks out.</b>
            <p>{report.created} new and {report.updated} updated {kind}. Nothing has been saved yet.</p>
          </div>
        </div>
      )}
      {report && !report.ok && (
        <div className="report" role="alert">
          <p className="report-h"><Icon name="alert" /> {plural(report.errors.length, 'problem')} found. Nothing was saved. Fix the file and check it again.</p>
          <table className="tbl tbl-report">
            <thead><tr><th scope="col">Line</th><th scope="col">Column</th><th scope="col">Problem</th></tr></thead>
            <tbody>
              {report.errors.map((e, i) => (
                <tr key={i}><td className="mono">{e.line}</td><td className="mono">{e.column ?? '–'}</td><td>{e.message}</td></tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => setReport(null)}>Edit the rows</button>
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </Dialog>
  );
}
