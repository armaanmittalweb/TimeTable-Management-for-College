import { useEffect, type ReactNode } from 'react';
import type { FollowedBatch, WorkspaceFull } from './contract';
import { api } from './api';
import { match, navigate, useLocation } from './lib/router';
import { useMedia } from './lib/hooks';
import { load } from './lib/store';
import { useQuery } from './state/query';
import { homeFor, useSession } from './state/session';
import { useFollows } from './state/follows';
import { WorkspaceProvider } from './state/workspace';
import { memberScope, studentScope, type Scope } from './state/scope';
import { AppShell, Switcher, type Tab } from './shell/AppShell';
import { Toaster } from './ui/Toast';
import { WeekScreen } from './screens/Week';
import { TodayScreen } from './screens/Today';
import { ChangesScreen } from './screens/Changes';
import { RoomsScreen } from './screens/Rooms';
import { SetupScreen } from './screens/setup/Setup';
import { Front } from './screens/Front';
import { ForgotScreen, SignInScreen, SignUpScreen } from './screens/Auth';
import { JoinScreen } from './screens/Join';
import { SettingsScreen } from './screens/Settings';
import { NewWorkspaceScreen } from './screens/NewWorkspace';
import { NotFound, Blocked } from './screens/NotFound';
import { StartDemo } from './screens/StartDemo';
import { GridSkeleton } from './week/TimeGrid';
import { StudentWeek } from './screens/StudentWeek';

export default function App() {
  const { path } = useLocation();
  let page: ReactNode;
  let m: Record<string, string> | null;
  if (path === '/') page = <Home />;
  else if (path === '/signin') page = <SignInScreen />;
  else if (path === '/signup') page = <SignUpScreen />;
  else if (path === '/forgot') page = <ForgotScreen />;
  else if (path === '/settings') page = <SettingsScreen />;
  else if (path === '/new') page = <NewWorkspaceScreen />;
  else if (path === '/demo') page = <StartDemo />;
  else if ((m = match('/join/:code?', path))) page = <JoinScreen code={m.code} />;
  else if ((m = match('/w/:slug/:tab?/:step?', path))) page = <WorkspaceRoute slug={m.slug} tab={m.tab} step={m.step} />;
  else if ((m = match('/b/:code/:tab?', path))) page = <BatchRoute code={m.code.toUpperCase()} tab={m.tab} />;
  else page = <NotFound />;
  return (
    <>
      {page}
      <Toaster />
    </>
  );
}

/** "/": your timetable if you have one on this device, the front page otherwise. */
function Home() {
  const { me, ready } = useSession();
  const follows = useFollows();
  const target = homeFor(me) ?? (follows[0] ? `/b/${follows[0].code}` : null);
  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);
  if (target || (!ready && load('edusched.me', null))) return <div className="boot" aria-busy="true" />;
  return <Front />;
}

function WorkspaceRoute({ slug, tab, step }: { slug: string; tab?: string; step?: string }) {
  const { me, ready } = useSession();
  const phone = useMedia('(max-width: 720px)');
  const q = useQuery<WorkspaceFull>(`ws:${slug}`, () => api.w(slug).get(), { persist: `edusched.cache.ws.${slug}` });
  const full = q.data && q.data.workspace.slug === slug ? q.data : undefined;

  useEffect(() => {
    if (q.error?.code === 'unauthenticated' && ready) navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  }, [q.error, ready]);

  if (!full) {
    if (q.error && !q.error.offline && q.error.code !== 'unauthenticated') return <Blocked error={q.error} />;
    return (
      <div className="app">
        <header className="top" aria-hidden="true" />
        <main className="main"><div className="sub" /><GridSkeleton label="Loading the timetable" /></main>
      </div>
    );
  }

  const base = `/w/${slug}`;
  const student = full.role === 'student';
  const home = !tab;
  const showToday = tab === 'today' || (home && phone);
  const tabs: (Tab & { show: boolean })[] = [
    { href: `${base}/week`, label: 'Week', icon: 'grid', show: true, active: false },
    { href: `${base}/today`, label: 'Today', icon: 'today', show: true, active: false },
    { href: `${base}/changes`, label: 'Changes', icon: 'changes', show: true, active: false },
    { href: `${base}/rooms`, label: 'Rooms', icon: 'room', show: !student, active: false },
    { href: `${base}/setup`, label: 'Setup', icon: 'setup', show: full.role === 'coordinator', active: false },
  ];
  const active = showToday ? 'Today' : home || tab === 'week' ? 'Week' : tab === 'changes' ? 'Changes' : tab === 'rooms' ? 'Rooms' : tab === 'setup' ? 'Setup' : '';
  const shownTabs = tabs.filter((t) => t.show).map((t) => ({ ...t, active: t.label === active }));

  let screen: ReactNode;
  const title = full.workspace.name;
  if (showToday) screen = <TodayScreen key="today" scope={memberScopeOf(full)} full={full} title={title} />;
  else if (home || tab === 'week') screen = <WeekScreen scope={memberScopeOf(full)} full={full} title={title} />;
  else if (tab === 'changes') screen = <ChangesScreen scope={memberScopeOf(full)} full={full} />;
  else if (tab === 'rooms' && !student) screen = <RoomsScreen scope={memberScopeOf(full)} full={full} />;
  else if (tab === 'setup' && full.role === 'coordinator') screen = <SetupScreen full={full} step={step} reload={q.reload} />;
  else screen = <NotFound inline />;

  const isDemo = me?.demo?.workspace === slug;
  return (
    <WorkspaceProvider full={full} reload={q.reload} offlineSince={q.offlineSince}>
      <AppShell tabs={shownTabs} full={full} switcher={<Switcher title={isDemo ? 'Demo college' : full.workspace.name} sub={full.workspace.institution} />}>
        {screen}
      </AppShell>
    </WorkspaceProvider>
  );
}

// One scope object per workspace object, so screens don't refetch on every render.
const scopes = new WeakMap<WorkspaceFull, Scope>();
function memberScopeOf(full: WorkspaceFull) {
  let s = scopes.get(full);
  if (!s) scopes.set(full, (s = memberScope(full)));
  return s;
}

/** A student's view of a batch they follow by code: no account needed. */
function BatchRoute({ code, tab }: { code: string; tab?: string }) {
  const phone = useMedia('(max-width: 720px)');
  const follows = useFollows();
  const known = follows.find((f) => f.code === code);
  const q = useQuery<FollowedBatch>(`public:${code}`, () => api.publicBatch(code));
  const fb = q.data ?? known;
  useEffect(() => {
    // Keep the saved copy's details (name, periods) fresh.
    if (q.data && known && JSON.stringify(q.data) !== JSON.stringify(known)) {
      import('./state/follows').then(({ follow }) => follow(q.data!));
    }
  }, [q.data, known]);

  if (!fb) {
    if (q.error && !q.error.offline) return <Blocked error={q.error} code={code} />;
    return <div className="app"><header className="top" aria-hidden="true" /><main className="main"><GridSkeleton /></main></div>;
  }
  const scope = studentScopeOf(fb);
  const base = `/b/${code}`;
  const home = !tab;
  const showToday = tab === 'today' || (home && phone);
  const active = showToday ? 'Today' : home || tab === 'week' ? 'Week' : tab === 'changes' ? 'Changes' : '';
  const tabs: Tab[] = [
    { href: `${base}/week`, label: 'Week', icon: 'grid', active: false },
    { href: `${base}/today`, label: 'Today', icon: 'today', active: false },
    { href: `${base}/changes`, label: 'Changes', icon: 'changes', active: false },
  ].map((t) => ({ ...t, active: t.label === active }));
  const title = fb.batch.name;
  let screen: ReactNode;
  if (showToday) screen = <TodayScreen scope={scope} title={title} />;
  else if (home || tab === 'week') screen = <StudentWeek scope={scope} fb={fb} following={!!known} />;
  else if (tab === 'changes') screen = <ChangesScreen scope={scope} />;
  else screen = <NotFound inline />;
  return (
    <AppShell tabs={tabs} switcher={<Switcher title={fb.batch.name} sub={`${fb.workspace.name} · ${fb.workspace.institution}`} />} studentLabel={`Following ${follows.length || 1} ${follows.length > 1 ? 'batches' : 'batch'}`}>
      {screen}
    </AppShell>
  );
}

const sScopes = new Map<string, Scope>();
function studentScopeOf(fb: FollowedBatch) {
  let s = sScopes.get(fb.code);
  if (!s || s.timezone !== fb.workspace.timezone) sScopes.set(fb.code, (s = studentScope(fb)));
  return s;
}
