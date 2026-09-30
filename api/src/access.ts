// Who may do what inside a workspace (contract "Roles and access").

import type { Context, MiddlewareHandler } from 'hono';
import type { Queryable } from './db';
import { loadWorkspaceCtx } from './data/workspaces';
import type { AppEnv, WorkspaceCtx } from './env';
import { forbidden, notFound } from './http';
import { requireSession } from './session';

/**
 * Resolves /api/w/:slug for this session. Anything the caller is not a member of is
 * 404, never 403, so one tenant cannot even learn that another's slug exists.
 */
export const workspaceMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = requireSession(c);
  const ws = await loadWorkspaceCtx(c.var.db, c.req.param('slug') ?? '', session);
  if (!ws) throw notFound('No workspace at this address, or you are not a member of it.');
  c.set('ws', ws);
  await next();
};

export function requireCoordinator(c: Context<AppEnv>): WorkspaceCtx {
  const ws = c.var.ws;
  if (ws.role !== 'coordinator') throw forbidden('Only a coordinator can do that.');
  return ws;
}

export function requireStaff(c: Context<AppEnv>): WorkspaceCtx {
  const ws = c.var.ws;
  if (ws.role !== 'coordinator' && ws.role !== 'teacher') throw forbidden('Only teachers and coordinators can do that.');
  return ws;
}

/** Coordinators change any class; a teacher only the classes they teach. */
export function requireOwnClass(ws: WorkspaceCtx, classTeacherId: number) {
  if (ws.role === 'coordinator') return;
  if (ws.role === 'teacher' && ws.teacherId !== null && ws.teacherId === classTeacherId) return;
  throw forbidden(ws.role === 'teacher' ? 'You can only change your own classes.' : 'Only teachers and coordinators can do that.');
}

/** The name a change is signed with: the account, or who a demo guest is acting as. */
export async function actorName(c: Context<AppEnv>, db: Queryable): Promise<string> {
  const s = requireSession(c);
  if (s.userName) return s.userName;
  const ws = c.var.ws;
  if (ws.role === 'teacher' && ws.teacherId) {
    const [t] = await db.query<{ name: string }>(`SELECT name FROM teachers WHERE id = $1`, [ws.teacherId]);
    if (t) return t.name;
  }
  return 'Demo coordinator';
}
