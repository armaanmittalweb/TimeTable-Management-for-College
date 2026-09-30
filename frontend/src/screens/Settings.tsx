// Account settings: profile, password, devices, theme, calendar feeds, delete account.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SessionInfo } from '../contract';
import { api, ApiFailure, batchFeedUrl } from '../api';
import { Icon, Mark } from '../ui/Icon';
import { Dialog } from '../ui/Dialog';
import { toast } from '../ui/Toast';
import { Link, navigate } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { setTheme, useTheme, type ThemeChoice } from '../lib/theme';
import { ago } from '../lib/time';
import { homeFor, useSession } from '../state/session';
import { useFollows } from '../state/follows';
import { useQuery, invalidate } from '../state/query';
import { AccountMenu } from '../shell/AccountMenu';
import { ShortcutSheet } from '../shell/Search';

export function PlainTop({ back }: { back?: { href: string; label: string } }) {
  const [keys, setKeys] = useState(false);
  return (
    <header className="top top-plain">
      <Link className="top-brand" href="/" aria-label="EduSched home">
        <Mark />
        <span className="top-word">EduSched</span>
      </Link>
      {back && (
        <>
          <span className="top-sep" aria-hidden="true" />
          <Link className="top-back" href={back.href}><Icon name="chevron-left" size={14} /> {back.label}</Link>
        </>
      )}
      <div className="top-right">
        <AccountMenu onShortcuts={() => setKeys(true)} />
      </div>
      <ShortcutSheet open={keys} onClose={() => setKeys(false)} />
    </header>
  );
}

function Section({ id, title, desc, children }: { id: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="set-sec" aria-labelledby={`${id}-h`}>
      <div className="set-sec-head">
        <h2 id={`${id}-h`}>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      <div className="set-sec-body">{children}</div>
    </section>
  );
}

export function SettingsScreen() {
  useDocumentTitle('Settings');
  const { me, ready, setMe, signOut } = useSession();
  useEffect(() => {
    if (ready && !me?.user) navigate('/signin?next=/settings', { replace: true });
  }, [ready, me]);
  if (!me?.user) return <div className="boot" aria-busy="true" />;
  const home = homeFor(me);
  return (
    <div className="app">
      <PlainTop back={home ? { href: home, label: 'Back to the timetable' } : undefined} />
      <main id="main" className="main settings" tabIndex={-1}>
        <nav className="set-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          <a href="#profile">Profile</a>
          <a href="#password">Password</a>
          <a href="#sessions">Signed-in devices</a>
          <a href="#appearance">Appearance</a>
          <a href="#calendar">Calendar feed</a>
          <a href="#workspaces">Workspaces</a>
          <a href="#delete">Delete account</a>
        </nav>
        <div className="set-body">
          <Profile name={me.user.name} email={me.user.email} onSaved={setMe} />
          <Password />
          <Sessions />
          <Appearance />
          <Calendar />
          <Section id="workspaces" title="Workspaces" desc="Departments you belong to.">
            {me.memberships.length ? (
              <ul className="set-list">
                {me.memberships.map((m) => (
                  <li key={m.workspace.slug}>
                    <span><b>{m.workspace.name}</b> <span className="muted">· {m.workspace.institution}</span></span>
                    <span className="chip">{m.role === 'coordinator' ? 'Coordinator' : 'Teacher'}</span>
                    {!m.workspace.published && <span className="chip">Draft</span>}
                    <Link className="btn btn-sm" href={`/w/${m.workspace.slug}`}>Open</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">You’re not in a workspace yet.</p>
            )}
            <div className="set-actions">
              <Link className="btn" href="/new"><Icon name="plus" /> New workspace</Link>
              <Link className="btn btn-ghost" href="/join">Use an invite code</Link>
            </div>
          </Section>
          <DeleteAccount onDeleted={async () => { await signOut(); navigate('/'); }} />
        </div>
      </main>
    </div>
  );
}

function Profile({ name, email, onSaved }: { name: string; email: string; onSaved: (m: import('../contract').Me) => void }) {
  const [n, setN] = useState(name);
  const [e, setE] = useState(email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = n.trim() !== name || e.trim().toLowerCase() !== email;
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.updateMe({ name: n.trim(), email: e.trim() }));
      toast('Profile saved.');
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="profile" title="Profile" desc="Your name is shown on changes you make, like “moved by Priya Menon”.">
      <form className="set-form" onSubmit={save}>
        <div className="field"><label htmlFor="p-name">Name</label><input id="p-name" className="input" value={n} onChange={(x) => setN(x.target.value)} autoComplete="name" /></div>
        <div className="field"><label htmlFor="p-email">Email</label><input id="p-email" className="input" type="email" value={e} onChange={(x) => setE(x.target.value)} autoComplete="email" /></div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="set-actions"><button className="btn btn-primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
      </form>
    </Section>
  );
}

function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (next.length < 10) return setErr('Use at least 10 characters for the new password.');
    setBusy(true);
    setErr(null);
    try {
      await api.changePassword({ current, next });
      setCurrent('');
      setNext('');
      invalidate();
      toast('Password changed. Other devices were signed out.');
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="password" title="Password" desc="Changing it signs you out on every other device.">
      <form className="set-form" onSubmit={save}>
        <input type="text" autoComplete="username" hidden readOnly />
        <div className="field"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(x) => setCurrent(x.target.value)} /></div>
        <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(x) => setNext(x.target.value)} aria-describedby="pw-new-hint" /><span id="pw-new-hint" className="field-hint">At least 10 characters.</span></div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="set-actions"><button className="btn btn-primary" disabled={!current || !next || busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </Section>
  );
}

function Sessions() {
  const q = useQuery<SessionInfo[]>('me:sessions', () => api.sessions());
  const end = async (s: SessionInfo) => {
    try {
      await api.endSession(s.id);
      toast(`Signed out ${s.userAgent ?? 'that device'}.`);
      q.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not sign that device out.', { tone: 'error' });
    }
  };
  return (
    <Section id="sessions" title="Signed-in devices" desc="Sign out a device you no longer use. Sessions last 30 days.">
      {!q.data ? (
        <div className="skel" style={{ height: 100 }} />
      ) : (
        <ul className="set-list">
          {q.data.map((s) => (
            <li key={s.id}>
              <span><b>{s.userAgent ?? 'Unknown device'}</b> <span className="muted">· signed in {ago(s.createdAt)}{s.current ? '' : ` · last seen ${ago(s.lastSeenAt)}`}</span></span>
              {s.current ? <span className="chip chip-ok">This device</span> : <button type="button" className="btn btn-sm" onClick={() => void end(s)}>Sign out</button>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Appearance() {
  const theme = useTheme();
  const opts: [ThemeChoice, string][] = [['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']];
  return (
    <Section id="appearance" title="Appearance" desc="Saved on this device.">
      <fieldset className="set-radios">
        <legend className="sr-only">Theme</legend>
        {opts.map(([v, l]) => (
          <label key={v} className={`set-radio${theme === v ? ' is-on' : ''}`}>
            <input type="radio" name="theme" value={v} checked={theme === v} onChange={() => setTheme(v)} />
            <span className={`theme-swatch is-${v}`} aria-hidden="true" />
            {l}
          </label>
        ))}
      </fieldset>
    </Section>
  );
}

function Calendar() {
  const { me } = useSession();
  const follows = useFollows();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const teaching = (me?.memberships ?? []).filter((m) => m.teacherId);
  const make = async (slug: string, teacherId: number) => {
    try {
      const r = await api.w(slug).feed({ kind: 'teacher', targetId: teacherId });
      setUrls((u) => ({ ...u, [slug]: r.url }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not make a calendar address.', { tone: 'error' });
    }
  };
  const copy = (u: string) => void navigator.clipboard?.writeText(u).then(() => toast('Calendar address copied.'));
  const rows: { key: string; label: string; url: string | null; action?: () => void }[] = [
    ...teaching.map((m) => ({ key: m.workspace.slug, label: `Your teaching timetable · ${m.workspace.name}`, url: urls[m.workspace.slug] ?? null, action: () => void make(m.workspace.slug, m.teacherId!) })),
    ...follows.map((f) => ({ key: f.code, label: `${f.batch.name} · ${f.workspace.name}`, url: batchFeedUrl(f.code) })),
  ];
  return (
    <Section
      id="calendar"
      title="Calendar feed"
      desc={<>Subscribe in Google Calendar (Other calendars → <b>From URL</b>) or Apple Calendar (<b>Add Subscribed Calendar</b>). Cancelled and moved classes update there within a few hours.</>}
    >
      {rows.length ? (
        <ul className="set-list">
          {rows.map((r) => (
            <li key={r.key} className="set-feed">
              <span className="set-feed-label">{r.label}</span>
              {r.url ? (
                <span className="copyfield">
                  <input className="input mono" readOnly value={r.url} aria-label={`Calendar address for ${r.label}`} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn" onClick={() => copy(r.url!)}><Icon name="copy" /> Copy</button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={r.action}>Make a private address</button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Follow a batch or teach in a workspace to get a calendar address. Coordinators can make one for any batch, teacher or room from the week’s ⋯ menu.</p>
      )}
    </Section>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteAccount({ password });
      setOpen(false);
      toast('Your account is deleted.');
      onDeleted();
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not delete the account.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="delete" title="Delete account" desc="Removes your account and any workspace where you are the only member. Workspaces with other members stay; make someone else a coordinator first.">
      <div className="set-actions">
        <button type="button" className="btn btn-quiet-danger" onClick={() => setOpen(true)}><Icon name="trash" /> Delete my account</button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        size="sm"
        description="This can’t be undone. Changes you made stay on the timetable, still showing your name."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Keep my account</button>
            <button type="button" className="btn btn-danger" disabled={!password || busy} onClick={() => void go()}>{busy ? 'Deleting…' : 'Delete account'}</button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="del-pw">Your password</label>
          <input id="del-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus />
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
      </Dialog>
    </Section>
  );
}
