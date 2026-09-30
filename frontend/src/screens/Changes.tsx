// Every cancellation and move, newest first, grouped by the day it was made, with who did it.

import { useEffect, useMemo, useState } from 'react';
import type { Change, WorkspaceFull } from '../contract';
import { api } from '../api';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { toast } from '../ui/Toast';
import { Link } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { ago, clockIn, dateIn, dayLabel, mondayOf, nowIn, addDays } from '../lib/time';
import { changeWhat, plural, savedAt } from '../lib/format';
import { load, save } from '../lib/store';
import { invalidate, useQuery } from '../state/query';
import type { Scope } from '../state/scope';
import { ErrorState } from './Week';

type Kind = 'all' | 'cancelled' | 'moved';

export function ChangesScreen({ scope, full }: { scope: Scope; full?: WorkspaceFull }) {
  useDocumentTitle('Changes');
  const q = useQuery<Change[]>(`${scope.id}:changes`, () => scope.changes(), { persist: `edusched.cache.changes.${scope.id}` });
  const [kind, setKind] = useState<Kind>('all');
  const [batch, setBatch] = useState<string>('all');
  const seenKey = `edusched.seen.${scope.id}`;
  const [lastSeen] = useState(() => load<string>(seenKey, ''));
  useEffect(() => {
    const t = setTimeout(() => save(seenKey, new Date().toISOString()), 1500);
    return () => clearTimeout(t);
  }, [seenKey]);

  const list = useMemo(() => (q.data ?? []).filter((c) => (kind === 'all' || c.kind === kind) && (batch === 'all' || String(c.batch.id) === batch)), [q.data, kind, batch]);
  const today = nowIn(scope.timezone).date;
  const groups = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of list) {
      const d = dateIn(c.at, scope.timezone);
      m.set(d, [...(m.get(d) ?? []), c]);
    }
    return [...m.entries()];
  }, [list, scope.timezone]);
  const newCount = (q.data ?? []).filter((c) => lastSeen && c.at > lastSeen).length;
  const batches = full ? full.batches : [];

  const undo = async (c: Change) => {
    if (!full) return;
    try {
      await api.w(full.workspace.slug).undo(c.id);
      toast(`${c.course.code} is back on ${dayLabel(c.from.date)}, ${c.from.start}.`);
      invalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not undo that.', { tone: 'error' });
    }
  };
  const may = (c: Change) => {
    if (!full) return false;
    if (full.role === 'coordinator') return true;
    const cls = full.classes.find((x) => x.id === c.classId);
    return full.role === 'teacher' && cls?.teacherId === full.teacherId;
  };
  const dayName = (d: string) => (d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : dayLabel(d));

  return (
    <div className="page changes">
      <header className="page-head">
        <div>
          <h1>Changes</h1>
          <p className="page-sub">
            {q.data ? plural(q.data.length, 'change') : 'Loading'}
            {newCount > 0 && <> · <span className="new-note"><span className="dot" aria-hidden="true" /> {newCount} new since your last visit</span></>}
          </p>
        </div>
        <div className="page-tools">
          <Segmented<Kind> label="Show" value={kind} onChange={setKind} size="sm" options={[{ value: 'all', label: 'All' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'moved', label: 'Moved' }]} />
          {batches.length > 1 && (
            <>
              <label className="sr-only" htmlFor="changes-batch">Batch</label>
              <select id="changes-batch" className="select select-sm" value={batch} onChange={(e) => setBatch(e.target.value)}>
                <option value="all">All batches</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </>
          )}
        </div>
      </header>
      {q.offlineSince && <p className="banner" role="status"><Icon name="offline" /> Offline · showing the copy from {savedAt(q.offlineSince)}</p>}
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <div aria-busy="true" className="feed-skel">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 56, marginBottom: 8 }} />)}</div>
      ) : !list.length ? (
        <div className="empty">
          <h2>{q.data.length ? 'Nothing matches that filter' : 'No changes yet'}</h2>
          <p>{q.data.length ? 'Try All, or another batch.' : 'When a class is cancelled or moved, it shows up here with who changed it and why.'}</p>
        </div>
      ) : (
        groups.map(([d, items]) => (
          <section key={d} className="feed-day" aria-labelledby={`day-${d}`}>
            <h2 id={`day-${d}`} className="feed-date">{dayName(d)}</h2>
            <ul className="feedlist">
              {items.map((c) => {
                const fresh = !!lastSeen && c.at > lastSeen;
                const weekOf = mondayOf(c.to?.date ?? c.from.date);
                return (
                  <li key={c.id} className={`feedrow${fresh ? ' is-new' : ''}`}>
                    <span className="feedrow-time mono">{clockIn(c.at, scope.timezone)}</span>
                    <span className={`feedrow-ico is-${c.kind}`} aria-hidden="true"><Icon name={c.kind === 'cancelled' ? 'ban' : 'changes'} size={14} /></span>
                    <div className="feedrow-main">
                      <p className="feedrow-what">
                        {fresh && <span className="dot" aria-label="New" />}
                        <span className={`swatch c${c.course.color}`} aria-hidden="true" />
                        <b>{c.course.code}</b> {changeWhat(c)}
                        <span className="chip">{c.batch.name}</span>
                      </p>
                      <p className="feedrow-meta">
                        {c.course.name} · {c.by} · {ago(c.at)}
                        {c.reason && <span className="feedrow-reason"> · “{c.reason}”</span>}
                      </p>
                    </div>
                    <div className="feedrow-actions">
                      {scope.kind === 'member' && (
                        <Link className="btn btn-sm btn-ghost" href={`${scope.base}/week?week=${weekOf}&batch=${c.batch.id}`}>Show in week</Link>
                      )}
                      {scope.kind === 'student' && <Link className="btn btn-sm btn-ghost" href={`${scope.base}/week?week=${weekOf}`}>Show in week</Link>}
                      {may(c) && (
                        <button type="button" className="btn btn-sm" onClick={() => void undo(c)}>
                          <Icon name="undo" /> Undo
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
