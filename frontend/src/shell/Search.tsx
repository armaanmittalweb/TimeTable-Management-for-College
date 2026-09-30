// "/" search: batches, teachers, rooms and courses in this workspace. Picking one filters the week by it.

import { useMemo, useState, type KeyboardEvent } from 'react';
import type { WorkspaceFull } from '../contract';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { navigate } from '../lib/router';

interface Hit { id: string; kind: 'Batch' | 'Teacher' | 'Room' | 'Course'; title: string; sub: string; href: string; color?: number }

export function SearchDialog({ open, onClose, full }: { open: boolean; onClose: () => void; full: WorkspaceFull }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const base = `/w/${full.workspace.slug}`;

  const all = useMemo<Hit[]>(() => {
    const t = (id: number | null) => full.teachers.find((x) => x.id === id);
    const batchOfCourse = (courseId: number) => full.classes.find((c) => c.courseId === courseId)?.batchId;
    return [
      ...full.batches.map((b): Hit => ({ id: `b${b.id}`, kind: 'Batch', title: b.name, sub: b.size ? `${b.size} students` : 'Batch', href: `${base}?batch=${b.id}` })),
      ...full.teachers.map((x): Hit => ({ id: `t${x.id}`, kind: 'Teacher', title: x.name, sub: x.short, href: `${base}?teacher=${x.id}` })),
      ...full.rooms.map((r): Hit => ({ id: `r${r.id}`, kind: 'Room', title: r.name, sub: `${r.capacity} seats${r.kind === 'lab' ? ' · lab' : ''}${r.building ? ` · ${r.building}` : ''}`, href: `${base}?room=${r.id}` })),
      ...full.courses.map((c): Hit => {
        const b = batchOfCourse(c.id);
        return { id: `c${c.id}`, kind: 'Course', title: `${c.code} ${c.name}`, sub: t(c.teacherId)?.name ?? 'No teacher yet', href: b ? `${base}?batch=${b}&course=${c.id}` : `${base}?teacher=${c.teacherId ?? ''}`, color: c.color };
      }),
    ];
  }, [full, base]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.filter((h) => h.kind === 'Batch' || h.kind === 'Teacher').slice(0, 8);
    return all
      .map((h) => {
        const t = h.title.toLowerCase();
        const score = t.startsWith(s) ? 0 : t.split(/[\s-]/).some((w) => w.startsWith(s)) ? 1 : t.includes(s) || h.sub.toLowerCase().includes(s) ? 2 : 9;
        return { h, score };
      })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
      .map((x) => x.h);
  }, [q, all]);

  const go = (h: Hit) => {
    onClose();
    setQ('');
    navigate(h.href);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(hits.length - 1, a + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
    else if (e.key === 'Enter' && hits[active]) (e.preventDefault(), go(hits[active]));
  };

  return (
    <Dialog open={open} onClose={onClose} title="Search" variant="palette" size="md" initialFocus="#search-input">
      <div className="palette-field">
        <Icon name="search" />
        <input
          id="search-input"
          className="palette-input"
          placeholder="Batch, teacher, room or course"
          value={q}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={hits[active] ? `hit-${hits[active].id}` : undefined}
          aria-label="Search this workspace"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <kbd>Esc</kbd>
      </div>
      <ul id="search-results" className="palette-list" role="listbox" aria-label="Results">
        {hits.map((h, i) => (
          <li
            key={h.id}
            id={`hit-${h.id}`}
            role="option"
            aria-selected={i === active}
            className={`palette-item${i === active ? ' is-active' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => go(h)}
          >
            <span className="palette-kind">{h.kind}</span>
            {h.color && <span className={`swatch c${h.color}`} aria-hidden="true" />}
            <span className="palette-title">{h.title}</span>
            <span className="palette-sub">{h.sub}</span>
          </li>
        ))}
        {!hits.length && <li className="palette-empty">Nothing called “{q}” in {full.workspace.name}.</li>}
      </ul>
    </Dialog>
  );
}

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string[], string][] = [
    [['←', '→'], 'Previous / next week'],
    [['T'], 'Jump to today'],
    [['/'], 'Search batches, teachers, rooms, courses'],
    [['↑', '↓', '←', '→'], 'Move between classes in the grid'],
    [['Enter'], 'Open the selected class'],
    [['Esc'], 'Close a panel or cancel a move'],
    [['?'], 'This list'],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <dl className="keys">
        {rows.map(([k, d]) => (
          <div key={d} className="keys-row">
            <dt>{k.map((x) => <kbd key={x}>{x}</kbd>)}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
