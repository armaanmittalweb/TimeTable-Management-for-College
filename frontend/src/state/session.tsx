// Who is here: the signed-in account, a demo guest, or nobody (a student with followed batches, or a visitor).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Me } from '../contract';
import { api, ApiFailure } from '../api';
import { load, save } from '../lib/store';
import { clearQueries } from './query';
import { syncFollows } from './follows';

interface SessionValue {
  me: Me | null;
  ready: boolean;
  /** true when the API could not be reached at start and `me` is the last saved copy. */
  offline: boolean;
  refresh: () => Promise<Me | null>;
  setMe: (me: Me | null) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);
const ME_KEY = 'edusched.me';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(() => load<Me | null>(ME_KEY, null));
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  const setMe = useCallback((m: Me | null) => {
    setMeState(m);
    save(ME_KEY, m);
    if (m?.user) void syncFollows();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      setMeState(m);
      save(ME_KEY, m);
      setOffline(false);
      return m;
    } catch (e) {
      if (e instanceof ApiFailure && e.offline) {
        setOffline(true);
        return load<Me | null>(ME_KEY, null);
      }
      setMeState(null);
      save(ME_KEY, null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh().then((m) => {
      if (m?.user) void syncFollows();
    });
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the cookie may already be gone; either way we forget it here */
    }
    clearQueries();
    setMeState(null);
    save(ME_KEY, null);
  }, []);

  const value = useMemo(() => ({ me, ready, offline, refresh, setMe, signOut }), [me, ready, offline, refresh, setMe, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Where a signed-in person lands: the demo copy, their first workspace, or null. */
export function homeFor(me: Me | null): string | null {
  if (!me) return null;
  if (me.demo) return `/w/${me.demo.workspace}`;
  const first = me.memberships[0];
  return first ? `/w/${first.workspace.slug}` : null;
}
