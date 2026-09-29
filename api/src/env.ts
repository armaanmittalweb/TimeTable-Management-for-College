import type { Context } from 'hono';
import type { Db } from './db';
import type { Role } from './data';

export interface Bindings {
  DATABASE_URL: string;
  JWT_SECRET: string;
  /** "false" turns off per-visitor sandboxes and re-opens registration. Anything else = public demo. */
  DEMO_MODE?: string;
  /** IANA zone used for "today" (expiry, earliest postpone date). Default Asia/Kolkata. */
  TIMEZONE?: string;
}

export interface TokenUser {
  id: number;
  role: Role;
  batch: string | null;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    db: Db;
    today: string;
    user: TokenUser;
    /** Overlay layer this request reads and writes; null = shared layer only. */
    sandboxId: string | null;
  };
}

export const isDemo = (env: Bindings) => env.DEMO_MODE !== 'false';

/** JSON body, or {} when missing/invalid, so handlers can validate fields uniformly. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

/** Positive integer id from a number or numeric string (the frontend sends <select> values as strings). */
export function toId(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}
