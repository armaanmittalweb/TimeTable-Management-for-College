// Users, sessions, reset codes and followed batches.

import type { FollowedBatch, Me, Role, SessionInfo } from '../contract';
import type { Db, Queryable } from '../db';
import type { Session } from '../env';
import { HM, ISO, SUMMARY } from './sql';

export const SESSION_DAYS = 30;

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
}

export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | undefined> {
  const [row] = await db.query<UserRow>(`SELECT id, email, name, password_hash FROM users WHERE email = $1`, [email]);
  return row;
}

export async function getUser(db: Queryable, id: number): Promise<UserRow | undefined> {
  const [row] = await db.query<UserRow>(`SELECT id, email, name, password_hash FROM users WHERE id = $1`, [id]);
  return row;
}

/** The new user's id, or null when the email is taken. */
export async function createUser(db: Queryable, u: { email: string; name: string; passwordHash: string }) {
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [u.email, u.name, u.passwordHash],
  );
  return row?.id ?? null;
}

/** 'ok', or 'taken' when the new email belongs to another account. */
export async function updateProfile(db: Queryable, userId: number, p: { name?: string; email?: string }) {
  try {
    await db.query(`UPDATE users SET name = COALESCE($2, name), email = COALESCE($3, email) WHERE id = $1`, [
      userId,
      p.name ?? null,
      p.email ?? null,
    ]);
    return 'ok' as const;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'taken' as const;
    throw err;
  }
}

export async function setPassword(db: Queryable, userId: number, passwordHash: string) {
  await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash]);
}

// ---------------------------------------------------------------- sessions

export async function createSession(
  db: Queryable,
  s: { id: string; userId?: number; demoWorkspaceId?: number; expiresAt?: string; userAgent: string | null },
) {
  await db.query(
    `INSERT INTO sessions (id, user_id, demo_workspace_id, acting_role, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now() + make_interval(days => ${SESSION_DAYS})), $6)`,
    [
      s.id,
      s.userId ?? null,
      s.demoWorkspaceId ?? null,
      s.demoWorkspaceId ? 'coordinator' : null,
      s.expiresAt ?? null,
      s.userAgent?.slice(0, 300) ?? null,
    ],
  );
}

/**
 * The live session with this id, touching last_seen_at at most every five minutes
 * (so reading a page is not a write every time). One round trip.
 */
export async function loadSession(db: Queryable, id: string): Promise<Session | null> {
  const [row] = await db.query<Session>(
    `WITH touch AS (
       UPDATE sessions SET last_seen_at = now()
        WHERE id = $1 AND last_seen_at < now() - interval '5 minutes' AND expires_at > now()
     )
     SELECT s.id, s.user_id AS "userId", u.name AS "userName", s.demo_workspace_id AS "demoWorkspaceId",
            s.acting_role AS "actingRole", s.acting_id AS "actingId", ${ISO('s.expires_at')} AS "expiresAt"
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  return row ?? null;
}

export async function deleteSession(db: Queryable, id: string, userId?: number) {
  const rows = await db.query(
    `DELETE FROM sessions WHERE id = $1 AND ($2::int IS NULL OR user_id = $2) RETURNING 1`,
    [id, userId ?? null],
  );
  return rows.length > 0;
}

export async function deleteOtherSessions(db: Queryable, userId: number, keepId: string | null) {
  await db.query(`DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2`, [userId, keepId]);
}

export async function listSessions(db: Queryable, userId: number, currentId: string): Promise<SessionInfo[]> {
  return db.query<SessionInfo>(
    `SELECT id, id = $2 AS current, user_agent AS "userAgent",
            ${ISO('created_at')} AS "createdAt", ${ISO('last_seen_at')} AS "lastSeenAt"
       FROM sessions WHERE user_id = $1 AND expires_at > now()
      ORDER BY last_seen_at DESC`,
    [userId, currentId],
  );
}

export async function setActing(db: Queryable, sessionId: string, role: Role, actingId: number | null) {
  await db.query(`UPDATE sessions SET acting_role = $2, acting_id = $3 WHERE id = $1`, [sessionId, role, actingId]);
}

// ---------------------------------------------------------------- me

export type MeSource = Pick<Session, 'userId' | 'demoWorkspaceId' | 'actingRole' | 'actingId'>;

export async function getMe(db: Queryable, session: MeSource): Promise<Me> {
  if (session.demoWorkspaceId) {
    const [w] = await db.query<{ slug: string; expires_at: string }>(
      `SELECT slug, ${ISO('expires_at')} AS expires_at FROM workspaces WHERE id = $1`,
      [session.demoWorkspaceId],
    );
    const role = session.actingRole ?? 'coordinator';
    const actingAs: NonNullable<Me['demo']>['actingAs'] = { role };
    if (role === 'teacher' && session.actingId) actingAs.teacherId = session.actingId;
    if (role === 'student' && session.actingId) actingAs.batchId = session.actingId;
    return { user: null, demo: { workspace: w.slug, actingAs, expiresAt: w.expires_at }, memberships: [] };
  }
  const [row] = await db.query<{ user: Me['user']; memberships: Me['memberships'] }>(
    `SELECT json_build_object('id', u.id, 'name', u.name, 'email', u.email) AS user,
            COALESCE((SELECT json_agg(json_build_object('workspace', ${SUMMARY}, 'role', m.role, 'teacherId', m.teacher_id)
                                      ORDER BY w.name, w.id)
                        FROM members m JOIN workspaces w ON w.id = m.workspace_id
                       WHERE m.user_id = u.id), '[]') AS memberships
       FROM users u WHERE u.id = $1`,
    [session.userId],
  );
  return { user: row.user, demo: null, memberships: row.memberships };
}

// ---------------------------------------------------------------- account deletion

/** Workspaces where this user is the only coordinator and someone else is a member. */
export async function blockingWorkspaces(db: Queryable, userId: number) {
  return db.query<{ name: string }>(
    `SELECT w.name FROM workspaces w
      WHERE EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = w.id AND m.user_id = $1 AND m.role = 'coordinator')
        AND NOT EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = w.id AND m.user_id <> $1 AND m.role = 'coordinator')
        AND EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = w.id AND m.user_id <> $1)`,
    [userId],
  );
}

/** Deletes the user and every workspace they are the only member of. */
export function deleteAccount(db: Db, userId: number) {
  return db.transaction(async (tx) => {
    await tx.query(
      `DELETE FROM workspaces w
        WHERE EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = w.id AND m.user_id = $1)
          AND NOT EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = w.id AND m.user_id <> $1)`,
      [userId],
    );
    await tx.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
}

// ---------------------------------------------------------------- reset codes

export async function createResetCode(db: Queryable, r: { codeHash: string; userId: number; workspaceId: number }) {
  const [row] = await db.query<{ expires_at: string }>(
    `INSERT INTO reset_codes (code_hash, user_id, workspace_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING ${ISO('expires_at')} AS expires_at`,
    [r.codeHash, r.userId, r.workspaceId],
  );
  return row.expires_at;
}

/**
 * Spends a reset code: sets the password and signs out every device, atomically.
 * False when the code is wrong, used or expired.
 */
export function redeemResetCode(db: Db, r: { email: string; codeHash: string; passwordHash: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ user_id: number }>(
      `UPDATE reset_codes rc SET used_at = now()
         FROM users u
        WHERE rc.code_hash = $2 AND rc.user_id = u.id AND u.email = $1
          AND rc.used_at IS NULL AND rc.expires_at > now()
       RETURNING rc.user_id`,
      [r.email, r.codeHash],
    );
    if (!row) return false;
    await setPassword(tx, row.user_id, r.passwordHash);
    await tx.query(`DELETE FROM sessions WHERE user_id = $1`, [row.user_id]);
    return true;
  });
}

// ---------------------------------------------------------------- follows and class codes

const FOLLOWED = `json_build_object(
  'code', b.code,
  'workspace', json_build_object('name', w.name, 'institution', w.institution, 'timezone', w.timezone, 'days', w.days),
  'batch', json_build_object('id', b.id, 'name', b.name),
  'periods', COALESCE((SELECT json_agg(json_build_object('idx', p.idx, 'start', ${HM('p.start_time')},
                               'end', ${HM('p.end_time')}, 'label', p.label, 'isBreak', p.is_break) ORDER BY p.idx)
                         FROM periods p WHERE p.workspace_id = w.id), '[]'))`;

/** Published, unexpired workspaces only: codes work once a coordinator publishes. */
const LIVE = `w.published_at IS NOT NULL AND (w.expires_at IS NULL OR w.expires_at > now())`;

export interface PublicBatch {
  followed: FollowedBatch;
  workspaceId: number;
  batchId: number;
}

export async function findBatchByCode(db: Queryable, code: string): Promise<PublicBatch | null> {
  const [row] = await db.query<{ followed: FollowedBatch; workspace_id: number; batch_id: number }>(
    `SELECT ${FOLLOWED} AS followed, w.id AS workspace_id, b.id AS batch_id
       FROM batches b JOIN workspaces w ON w.id = b.workspace_id
      WHERE b.code = $1 AND ${LIVE}`,
    [code],
  );
  return row ? { followed: row.followed, workspaceId: row.workspace_id, batchId: row.batch_id } : null;
}

export async function listFollows(db: Queryable, userId: number): Promise<FollowedBatch[]> {
  const rows = await db.query<{ f: FollowedBatch }>(
    `SELECT ${FOLLOWED} AS f
       FROM follows fo JOIN batches b ON b.id = fo.batch_id JOIN workspaces w ON w.id = b.workspace_id
      WHERE fo.user_id = $1 AND ${LIVE}
      ORDER BY w.name, b.name`,
    [userId],
  );
  return rows.map((r) => r.f);
}

/** Replaces the user's follows with the batches these codes name; unknown codes are dropped. */
export function replaceFollows(db: Db, userId: number, codes: string[]) {
  return db.transaction(async (tx) => {
    await tx.query(`DELETE FROM follows WHERE user_id = $1`, [userId]);
    await tx.query(
      `INSERT INTO follows (user_id, batch_id)
       SELECT $1, b.id FROM batches b JOIN workspaces w ON w.id = b.workspace_id
        WHERE b.code = ANY($2::text[]) AND ${LIVE}
       ON CONFLICT DO NOTHING`,
      [userId, codes],
    );
  });
}
