// The frame around every signed-in or following screen: demo bar, top bar with tabs, search and account,
// a bottom tab bar on phones, and the global shortcuts (/ search, ? shortcut list).

import { useState, type ReactNode } from 'react';
import type { Me, WorkspaceFull } from '../contract';
import { api } from '../api';
import { Icon, Mark } from '../ui/Icon';
import { MenuItem, Popover, usePopover } from '../ui/Menu';
import { Link, navigate } from '../lib/router';
import { useHotkey, useOnline, useTick } from '../lib/hooks';
import { useSession } from '../state/session';
import { useFollows } from '../state/follows';
import { invalidate } from '../state/query';
import { AccountMenu } from './AccountMenu';
import { SearchDialog, ShortcutSheet } from './Search';
import { toast } from '../ui/Toast';

export interface Tab { href: string; label: string; icon: string; active: boolean; dot?: boolean }

export function AppShell({ tabs, full, switcher, children, studentLabel }: {
  tabs: Tab[]; full?: WorkspaceFull; switcher: ReactNode; children: ReactNode; studentLabel?: string;
}) {
  const { me } = useSession();
  const online = useOnline();
  const [search, setSearch] = useState(false);
  const [keys, setKeys] = useState(false);
  useHotkey('/', (e) => {
    if (!full) return;
    e.preventDefault();
    setSearch(true);
  });
  useHotkey('?', (e) => {
    e.preventDefault();
    setKeys(true);
  });


  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to the timetable</a>
      {me?.demo && full && full.workspace.slug === me.demo.workspace && <DemoBar me={me} full={full} />}
      <header className="top">
        <Link className="top-brand" href="/" aria-label="EduSched home">
          <Mark />
          <span className="top-word">EduSched</span>
        </Link>
        <span className="top-sep" aria-hidden="true" />
        {switcher}
        <nav className="top-tabs" aria-label="Sections">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="top-tab" aria-current={t.active ? 'page' : undefined}>
              {t.label}
              {t.dot && <span className="dot" aria-label="new changes" />}
            </Link>
          ))}
        </nav>
        <div className="top-right">
          {!online && (
            <span className="chip" title="You are offline. Changes can’t be saved until you’re back.">
              <Icon name="offline" size={13} /> Offline
            </span>
          )}
          {full && (
            <button type="button" className="top-search" onClick={() => setSearch(true)} aria-label="Search (press /)">
              <Icon name="search" />
              <span className="top-search-text">Search</span>
              <kbd>/</kbd>
            </button>
          )}
          <AccountMenu onShortcuts={() => setKeys(true)} studentLabel={studentLabel} />
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="tabbar-item" aria-current={t.active ? 'page' : undefined}>
            <span className="tabbar-ico">
              <Icon name={t.icon} size={20} />
              {t.dot && <span className="dot" aria-hidden="true" />}
            </span>
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
      {full && <SearchDialog open={search} onClose={() => setSearch(false)} full={full} />}
      <ShortcutSheet open={keys} onClose={() => setKeys(false)} />
    </div>
  );
}

/** "Demo college · resets in 23 h · Viewing as: [Coordinator ▾]" */
function DemoBar({ me, full }: { me: Me; full: WorkspaceFull }) {
  const { setMe } = useSession();
  const now = useTick(60_000);
  const hours = Math.max(0, Math.ceil((new Date(me.demo!.expiresAt).getTime() - now) / 3_600_000));
  const a = me.demo!.actingAs;
  const value = a.role === 'teacher' ? `t${a.teacherId}` : a.role === 'student' ? `b${a.batchId}` : 'c';

  const change = async (v: string) => {
    const body = v === 'c' ? { role: 'coordinator' as const } : v[0] === 't' ? { role: 'teacher' as const, teacherId: +v.slice(1) } : { role: 'student' as const, batchId: +v.slice(1) };
    try {
      const next = await api.w(full.workspace.slug).actAs(body);
      setMe(next);
      invalidate();
      navigate(`/w/${full.workspace.slug}`);
      const who = body.role === 'coordinator' ? 'the coordinator' : body.role === 'teacher' ? full.teachers.find((t) => t.id === body.teacherId)?.name : `a student in ${full.batches.find((b) => b.id === (body as { batchId: number }).batchId)?.name}`;
      toast(`Now viewing as ${who}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not switch roles.', { tone: 'error' });
    }
  };

  return (
    <div className="demobar" role="region" aria-label="Demo">
      <span className="demobar-what"><b>Demo college</b><span className="demobar-dim"> · your private copy · resets in {hours} h</span></span>
      <label className="demobar-as">
        <span>Viewing as</span>
        <select className="demobar-select" value={value} onChange={(e) => void change(e.target.value)}>
          <option value="c">Coordinator</option>
          <optgroup label="Teacher">
            {full.teachers.map((t) => (
              <option key={t.id} value={`t${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
          <optgroup label="Student in">
            {full.batches.map((b) => (
              <option key={b.id} value={`b${b.id}`}>{b.name}</option>
            ))}
          </optgroup>
        </select>
      </label>
      <Link className="demobar-link" href="/signup">Set up your own department</Link>
    </div>
  );
}

/** The workspace name in the top bar; a menu to switch between workspaces and followed batches. */
export function Switcher({ title, sub }: { title: string; sub?: string }) {
  const { me } = useSession();
  const follows = useFollows();
  const pop = usePopover();
  const workspaces = me?.memberships ?? [];
  return (
    <>
      <button ref={pop.anchor} type="button" className="switcher" aria-haspopup="menu" aria-expanded={pop.open} onClick={pop.toggle}>
        <span className="switcher-title">{title}</span>
        {sub && <span className="switcher-sub">{sub}</span>}
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover open={pop.open} anchor={pop.anchor} onClose={pop.close} width={280} label="Switch timetable" role="menu">
        {me?.demo && (
          <>
            <div className="menu-group-label" aria-hidden="true">Demo</div>
            <MenuItem icon={<Icon name="grid" />} onSelect={() => (pop.close(false), navigate(`/w/${me.demo!.workspace}`))}>Demo college</MenuItem>
          </>
        )}
        {workspaces.length > 0 && <div className="menu-group-label" aria-hidden="true">Workspaces</div>}
        {workspaces.map((m) => (
          <MenuItem key={m.workspace.slug} icon={<Icon name="grid" />} onSelect={() => (pop.close(false), navigate(`/w/${m.workspace.slug}`))}>
            {m.workspace.name}
            <span className="menu-note">{m.workspace.institution} · {m.role}</span>
          </MenuItem>
        ))}
        {follows.length > 0 && <div className="menu-group-label" aria-hidden="true">Batches you follow</div>}
        {follows.map((f) => (
          <MenuItem key={f.code} icon={<Icon name="batch" />} onSelect={() => (pop.close(false), navigate(`/b/${f.code}`))}>
            {f.batch.name}
            <span className="menu-note">{f.workspace.name} · {f.workspace.institution}</span>
          </MenuItem>
        ))}
        <div className="menu-sep" role="separator" />
        <MenuItem icon={<Icon name="key" />} onSelect={() => (pop.close(false), navigate('/join'))}>Enter a class code</MenuItem>
        {me?.user && <MenuItem icon={<Icon name="plus" />} onSelect={() => (pop.close(false), navigate('/new'))}>New workspace</MenuItem>}
      </Popover>
    </>
  );
}
