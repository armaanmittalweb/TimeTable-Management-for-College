import type { Role } from './contract';
import type { Db } from './db';

export interface Bindings {
  DATABASE_URL: string;
  /** Shared with the Switchboard; unlocks /internal/* (admin stats and cleanup). Unset = those routes 404. */
  INTERNAL_KEY?: string;
  /** Workers rate limit bindings (wrangler.jsonc `ratelimits`). Missing in tests and dev-local: no limit. */
  AUTH_LIMITER?: RateLimit;
  PUBLIC_LIMITER?: RateLimit;
}

/** The signed-in party: an account, or a demo guest acting inside their own copy. */
export interface Session {
  id: string;
  userId: number | null;
  userName: string | null;
  demoWorkspaceId: number | null;
  actingRole: Role | null;
  actingId: number | null;
  expiresAt: string;
}

/** The workspace a /api/w/:slug request is about, and who the caller is inside it. */
export interface WorkspaceCtx {
  id: number;
  slug: string;
  name: string;
  institution: string;
  timezone: string;
  days: number[];
  published: boolean;
  isDemo: boolean;
  role: Role;
  teacherId: number | null;
  batchId: number | null;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    db: Db;
    session: Session | null;
    ws: WorkspaceCtx;
  };
}
