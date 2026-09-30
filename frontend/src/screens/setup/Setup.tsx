// Setup (coordinators): a step list with ticks on the left, the step on the right.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Period, WorkspaceFull } from '../../contract';
import { api, ApiFailure } from '../../api';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/Toast';
import { Link, navigate } from '../../lib/router';
import { useDocumentTitle } from '../../lib/hooks';
import { DAY_LONG, DAY_SHORT, toMin } from '../../lib/time';
import { plural } from '../../lib/format';
import { invalidate } from '../../state/query';
import { useSession } from '../../state/session';
import { TIMEZONES } from '../NewWorkspace';
import { ResourceStep } from './Tables';
import { TimetableStep } from './Timetable';
import { CodesStep } from './Codes';

export const STEPS = [
  ['basics', 'Basics'],
  ['periods', 'Periods'],
  ['rooms', 'Rooms'],
  ['teachers', 'Teachers'],
  ['batches', 'Batches'],
  ['courses', 'Courses'],
  ['timetable', 'Timetable'],
  ['codes', 'Codes and members'],
  ['publish', 'Publish'],
] as const;
export type StepId = (typeof STEPS)[number][0];

export function stepDone(full: WorkspaceFull): Record<StepId, boolean> {
  return {
    basics: !!full.workspace.name && !!full.workspace.institution && full.workspace.days.length > 0,
    periods: full.periods.some((p) => !p.isBreak),
    rooms: full.rooms.length > 0,
    teachers: full.teachers.length > 0,
    batches: full.batches.length > 0,
    courses: full.courses.length > 0 && full.courses.every((c) => c.teacherId),
    timetable: full.classes.length > 0,
    codes: full.teachers.some((t) => t.hasAccount),
    publish: full.workspace.published,
  };
}

export function SetupScreen({ full, step, reload }: { full: WorkspaceFull; step?: string; reload: () => void }) {
  const done = stepDone(full);
  const current = (STEPS.find(([id]) => id === step)?.[0] ?? STEPS.find(([id]) => !done[id])?.[0] ?? 'basics') as StepId;
  const base = `/w/${full.workspace.slug}/setup`;
  const label = STEPS.find(([id]) => id === current)![1];
  useDocumentTitle(`Setup · ${label}`);
  const count = Object.values(done).filter(Boolean).length;
  const idx = STEPS.findIndex(([id]) => id === current);
  const next = STEPS[idx + 1];
  const saved = () => {
    invalidate();
    reload();
  };

  let body: ReactNode;
  if (current === 'basics') body = <Basics full={full} onSaved={saved} />;
  else if (current === 'periods') body = <Periods full={full} onSaved={saved} />;
  else if (current === 'rooms' || current === 'teachers' || current === 'batches' || current === 'courses') body = <ResourceStep kind={current} full={full} onSaved={saved} />;
  else if (current === 'timetable') body = <TimetableStep full={full} onSaved={saved} />;
  else if (current === 'codes') body = <CodesStep full={full} onSaved={saved} />;
  else body = <Publish full={full} done={done} onSaved={saved} />;

  return (
    <div className="setup">
      <nav className="steps" aria-label="Setup steps">
        <div className="steps-head">
          <h1>Setup</h1>
          <p className="mono">{count} of {STEPS.length} done</p>
          <div className="steps-bar" aria-hidden="true"><span style={{ width: `${(count / STEPS.length) * 100}%` }} /></div>
        </div>
        <ol>
          {STEPS.map(([id, name], i) => (
            <li key={id}>
              <Link href={`${base}/${id}`} className={`step${id === current ? ' is-on' : ''}${done[id] ? ' is-done' : ''}`} aria-current={id === current ? 'step' : undefined}>
                <span className="step-mark" aria-hidden="true">{done[id] ? <Icon name="check" size={12} /> : i + 1}</span>
                <span>{name}</span>
                <span className="sr-only">{done[id] ? ' (done)' : ' (to do)'}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <div className="setup-body">
        <div className="setup-step-head">
          <p className="setup-kicker mono">Step {idx + 1} of {STEPS.length}</p>
          <h2>{label}</h2>
        </div>
        {body}
        {next && (
          <div className="setup-next">
            <Link className="btn" href={`${base}/${next[0]}`}>Next: {next[1]} <Icon name="arrow-right" /></Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Basics({ full, onSaved }: { full: WorkspaceFull; onSaved: () => void }) {
  const w = full.workspace;
  const [name, setName] = useState(w.name);
  const [institution, setInstitution] = useState(w.institution);
  const [timezone, setTimezone] = useState(w.timezone);
  const [days, setDays] = useState<number[]>(w.days);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { refresh } = useSession();
  const dirty = name !== w.name || institution !== w.institution || timezone !== w.timezone || days.slice().sort().join() !== w.days.slice().sort().join();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.w(w.slug).patch({ name: name.trim(), institution: institution.trim(), timezone, days: days.slice().sort() });
      toast('Basics saved.');
      onSaved();
      void refresh();
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="setup-form" onSubmit={save}>
      <p className="setup-lead">What the department is called, where it is, and which days classes run. Students see the name next to their batch.</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="b-name">Department</label><input id="b-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="b-inst">Institution</label><input id="b-inst" className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="b-tz">Timezone</label>
          <select id="b-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {[...new Set([timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>
      <fieldset className="field daypick">
        <legend className="field-label">Teaching days</legend>
        <div className="daypick-row">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className={`daypick-day${days.includes(d) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays((x) => (e.target.checked ? [...x, d] : x.filter((y) => y !== d)))} aria-label={DAY_LONG[d]} />
              {DAY_SHORT[d]}
            </label>
          ))}
        </div>
      </fieldset>
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="set-actions"><button className="btn btn-primary" disabled={!dirty || busy || !days.length}>{busy ? 'Saving…' : 'Save basics'}</button></div>
    </form>
  );
}

function Periods({ full, onSaved }: { full: WorkspaceFull; onSaved: () => void }) {
  const [rows, setRows] = useState<Period[]>(full.periods);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setRows(full.periods), [full.periods]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(full.periods);
  const set = (i: number, patch: Partial<Period>) => setRows((r) => r.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const problems = rows.map((p, i) => (toMin(p.end) <= toMin(p.start) ? 'Ends before it starts' : i && toMin(p.start) < toMin(rows[i - 1].end) ? 'Overlaps the one above' : null));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.w(full.workspace.slug).putPeriods(rows);
      toast('Periods saved.');
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not save the periods.');
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const last = rows[rows.length - 1];
    const s = last ? toMin(last.end) : 9 * 60;
    const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    setRows([...rows, { idx: rows.length + 1, start: f(s), end: f(Math.min(s + 60, 23 * 60 + 59)), label: null, isBreak: false }]);
  };
  return (
    <div className="setup-form">
      <p className="setup-lead">The bells of the day. Classes snap to these in the grid, and breaks show as hatched bands. Changing periods doesn’t move existing classes.</p>
      <table className="tbl">
        <thead>
          <tr><th scope="col">#</th><th scope="col">Starts</th><th scope="col">Ends</th><th scope="col">Label</th><th scope="col">Break</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={i} className={p.isBreak ? 'is-break' : ''}>
              <td className="mono muted">{p.isBreak ? '–' : rows.slice(0, i + 1).filter((x) => !x.isBreak).length}</td>
              <td><input className="input input-sm mono" type="time" value={p.start} onChange={(e) => set(i, { start: e.target.value })} aria-label={`Period ${i + 1} starts`} /></td>
              <td>
                <input className="input input-sm mono" type="time" value={p.end} onChange={(e) => set(i, { end: e.target.value })} aria-label={`Period ${i + 1} ends`} aria-invalid={!!problems[i]} />
                {problems[i] && <span className="cell-error">{problems[i]}</span>}
              </td>
              <td><input className="input input-sm" value={p.label ?? ''} placeholder={p.isBreak ? 'Lunch' : ''} onChange={(e) => set(i, { label: e.target.value || null })} aria-label={`Period ${i + 1} label`} /></td>
              <td><input type="checkbox" className="cbx" checked={p.isBreak} onChange={(e) => set(i, { isBreak: e.target.checked, label: e.target.checked ? p.label ?? 'Break' : p.label })} aria-label={`Period ${i + 1} is a break`} /></td>
              <td><button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove period ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-foot">
        <button type="button" className="btn btn-sm" onClick={add}><Icon name="plus" /> Add a period</button>
        <span className="muted">{plural(rows.filter((p) => !p.isBreak).length, 'teaching period')}, {plural(rows.filter((p) => p.isBreak).length, 'break')}</span>
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="set-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy || problems.some(Boolean)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save periods'}</button>
        {dirty && <button type="button" className="btn btn-ghost" onClick={() => setRows(full.periods)}>Discard changes</button>}
      </div>
    </div>
  );
}

function Publish({ full, done, onSaved }: { full: WorkspaceFull; done: Record<StepId, boolean>; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const w = full.workspace;
  const go = async (publish: boolean) => {
    setBusy(true);
    try {
      await (publish ? api.w(w.slug).publish() : api.w(w.slug).unpublish());
      toast(publish ? 'Published. Class codes work now.' : 'Unpublished. Class codes stop working until you publish again.');
      onSaved();
      void refresh();
      if (publish) navigate(`/w/${w.slug}/week`);
    } catch (x) {
      toast(x instanceof ApiFailure ? x.message : 'Could not change that.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const checks: [StepId, string, string][] = [
    ['periods', 'Periods', plural(full.periods.filter((p) => !p.isBreak).length, 'teaching period')],
    ['rooms', 'Rooms', plural(full.rooms.length, 'room')],
    ['teachers', 'Teachers', plural(full.teachers.length, 'teacher')],
    ['batches', 'Batches', plural(full.batches.length, 'batch', 'batches')],
    ['courses', 'Courses', `${plural(full.courses.length, 'course')}${full.courses.some((c) => !c.teacherId) ? `, ${full.courses.filter((c) => !c.teacherId).length} without a teacher` : ''}`],
    ['timetable', 'Timetable', plural(full.classes.length, 'class', 'classes') + ' a week'],
    ['codes', 'Teacher accounts', plural(full.teachers.filter((t) => t.hasAccount).length, 'teacher') + ' signed in'],
  ];
  return (
    <div className="setup-form">
      <p className="setup-lead">
        Publishing lets students open their batch with its class code and turns on calendar feeds. Teachers and coordinators can use the timetable either way. You can keep editing after publishing; changes show up straight away.
      </p>
      <ul className="checklist">
        {checks.map(([id, name, detail]) => (
          <li key={id} className={done[id] ? 'is-done' : ''}>
            <span className="step-mark" aria-hidden="true">{done[id] ? <Icon name="check" size={12} /> : '!'}</span>
            <span className="checklist-name">{name}</span>
            <span className="checklist-detail">{detail}</span>
            {!done[id] && <Link className="btn btn-sm btn-ghost" href={`/w/${w.slug}/setup/${id}`}>Open</Link>}
          </li>
        ))}
      </ul>
      {w.published ? (
        <div className="publish-box is-live">
          <p><span className="chip chip-ok">Published</span> Students with a class code can see this timetable.</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void go(false)}>Unpublish</button>
        </div>
      ) : (
        <div className="publish-box">
          <p>{done.timetable ? 'Ready when you are.' : 'Add at least one class to the timetable first.'}</p>
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || !done.timetable} onClick={() => void go(true)}>{busy ? 'Publishing…' : 'Publish the timetable'}</button>
        </div>
      )}
    </div>
  );
}
