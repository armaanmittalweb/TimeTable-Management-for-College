// Workspaces, membership, invites.

import type { Invite, Member, Period, Role, WorkspaceFull, WorkspaceSummary } from '../contract';
import type { Db, Queryable } from '../db';
import type { Session, WorkspaceCtx } from '../env';
import { HM, ISO, SUMMARY } from './sql';

export const MAX_WORKSPACES_PER_USER = 5;

/** 09:00-17:00 in hourly periods, with lunch at 13:00. */
export const DEFAULT_PERIODS: Period[] = [9, 10, 11, 12, 13, 14, 15, 16].map((h, i) => ({
  idx: i + 1,
  start: `${String(h).padStart(2, '0')}:00`,
  end: `${String(h + 1).padStart(2, '0')}:00`,
  label: h === 13 ? 'Lunch' : null,
  isBreak: h === 13,
}));

export async function getSummary(db: Queryable, workspaceId: number): Promise<WorkspaceSummary> {
  const [row] = await db.query<{ s: WorkspaceSummary }>(`SELECT ${SUMMARY} AS s FROM workspaces w WHERE w.id = $1`, [
    workspaceId,
  ]);
  return row.s;
}

export async function slugTaken(db: Queryable, slug: string) {
  return (await db.query(`SELECT 1 FROM workspaces WHERE slug = $1`, [slug])).length > 0;
}

export async function replacePeriods(tx: Queryable, workspaceId: number, periods: Period[]) {
  await tx.query(`DELETE FROM periods WHERE workspace_id = $1`, [workspaceId]);
  await tx.query(
    `INSERT INTO periods (workspace_id, idx, start_time, end_time, label, is_break)
     SELECT $1, * FROM unnest($2::smallint[], $3::time[], $4::time[], $5::text[], $6::boolean[])`,
    [
      workspaceId,
      periods.map((p) => p.idx),
      periods.map((p) => p.start),
      periods.map((p) => p.end),
      periods.map((p) => p.label),
      periods.map((p) => p.isBreak),
    ],
  );
}

/** Creates the workspace with the caller as coordinator; null when they are at the limit. */
export function createWorkspace(
  db: Db,
  w: { slug: string; name: string; institution: string; timezone: string; userId: number },
): Promise<WorkspaceSummary | null> {
  return db.transaction(async (tx) => {
    // serialises one user's creates, so two at once cannot both pass the count
    await tx.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [w.userId]);
    const [{ n }] = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM workspaces WHERE created_by = $1 AND NOT is_demo`,
      [w.userId],
    );
    if (n >= MAX_WORKSPACES_PER_USER) return null;
    const [{ id }] = await tx.query<{ id: number }>(
      `INSERT INTO workspaces (slug, name, institution, timezone, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [w.slug, w.name, w.institution, w.timezone, w.userId],
    );
    await tx.query(`INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'coordinator')`, [id, w.userId]);
    await replacePeriods(tx, id, DEFAULT_PERIODS);
    return getSummary(tx, id);
  });
}

interface CtxRow {
  id: number;
  slug: string;
  name: string;
  institution: string;
  timezone: string;
  days: number[];
  published: boolean;
  is_demo: boolean;
  member_role: 'coordinator' | 'teacher' | null;
  member_teacher_id: number | null;
}

/**
 * The workspace behind a slug as this session sees it, or null when the session
 * may not see it at all (not a member, not their demo copy, expired). Callers
 * answer null with 404, so a workspace's existence never leaks.
 */
export async function loadWorkspaceCtx(db: Queryable, slug: string, session: Session): Promise<WorkspaceCtx | null> {
  const [w] = await db.query<CtxRow>(
    `SELECT w.id, w.slug, w.name, w.institution, w.timezone, w.days, w.published_at IS NOT NULL AS published,
            w.is_demo, m.role AS member_role, m.teacher_id AS member_teacher_id
       FROM workspaces w
       LEFT JOIN members m ON m.workspace_id = w.id AND m.user_id = $2
      WHERE w.slug = $1 AND (w.expires_at IS NULL OR w.expires_at > now())`,
    [slug, session.userId],
  );
  if (!w) return null;
  const base = {
    id: w.id,
    slug: w.slug,
    name: w.name,
    institution: w.institution,
    timezone: w.timezone,
    days: w.days.map(Number),
    published: w.published,
    isDemo: w.is_demo,
  };
  if (session.demoWorkspaceId === w.id) {
    const role: Role = session.actingRole ?? 'coordinator';
    return {
      ...base,
      role,
      teacherId: role === 'teacher' ? session.actingId : null,
      batchId: role === 'student' ? session.actingId : null,
    };
  }
  if (!w.member_role) return null;
  return { ...base, role: w.member_role, teacherId: w.member_teacher_id, batchId: null };
}

export async function updateWorkspace(
  db: Queryable,
  id: number,
  p: { name?: string; institution?: string; timezone?: string; days?: number[] },
) {
  await db.query(
    `UPDATE workspaces SET name = COALESCE($2, name), institution = COALESCE($3, institution),
            timezone = COALESCE($4, timezone), days = COALESCE($5::smallint[], days)
      WHERE id = $1`,
    [id, p.name ?? null, p.institution ?? null, p.timezone ?? null, p.days ?? null],
  );
}

export async function setPublished(db: Queryable, id: number, published: boolean) {
  await db.query(
    `UPDATE workspaces SET published_at = CASE WHEN $2 THEN COALESCE(published_at, now()) END WHERE id = $1`,
    [id, published],
  );
}

export async function getWorkspaceFull(db: Queryable, ws: WorkspaceCtx): Promise<WorkspaceFull> {
  const [row] = await db.query<Omit<WorkspaceFull, 'workspace' | 'role' | 'teacherId' | 'batchId'>>(
    `SELECT
       COALESCE((SELECT json_agg(json_build_object('idx', idx, 'start', ${HM('start_time')}, 'end', ${HM('end_time')},
                                 'label', label, 'isBreak', is_break) ORDER BY idx)
                   FROM periods WHERE workspace_id = $1), '[]') AS periods,
       COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'capacity', capacity,
                                 'building', building, 'kind', kind) ORDER BY name)
                   FROM rooms WHERE workspace_id = $1), '[]') AS rooms,
       COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'short', t.short, 'email', t.email,
                                 'hasAccount', EXISTS (SELECT 1 FROM members m WHERE m.teacher_id = t.id)) ORDER BY t.name)
                   FROM teachers t WHERE t.workspace_id = $1), '[]') AS teachers,
       COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'size', size, 'code', code) ORDER BY name)
                   FROM batches WHERE workspace_id = $1), '[]') AS batches,
       COALESCE((SELECT json_agg(json_build_object('id', id, 'code', code, 'name', name, 'color', color,
                                 'teacherId', teacher_id) ORDER BY code)
                   FROM courses WHERE workspace_id = $1), '[]') AS courses,
       COALESCE((SELECT json_agg(json_build_object('id', id, 'courseId', course_id, 'batchId', batch_id,
                                 'teacherId', teacher_id, 'roomId', room_id, 'day', day_of_week,
                                 'start', ${HM('start_time')}, 'end', ${HM('end_time')})
                                 ORDER BY day_of_week, start_time, id)
                   FROM classes WHERE workspace_id = $1), '[]') AS classes`,
    [ws.id],
  );
  const { role, teacherId, batchId, days, ...summary } = ws;
  return {
    workspace: {
      id: summary.id,
      slug: summary.slug,
      name: summary.name,
      institution: summary.institution,
      timezone: summary.timezone,
      published: summary.published,
      isDemo: summary.isDemo,
      days,
    },
    role,
    teacherId,
    batchId,
    ...row,
  };
}

// ---------------------------------------------------------------- members

export function listMembers(db: Queryable, workspaceId: number): Promise<Member[]> {
  return db.query<Member>(
    `SELECT u.id AS "userId", u.name, u.email, m.role, m.teacher_id AS "teacherId"
       FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 ORDER BY m.role, u.name`,
    [workspaceId],
  );
}

export type MemberChange = 'ok' | 'not_found' | 'last_coordinator';

/**
 * Removes a member or changes their role, refusing to leave the workspace without
 * a coordinator. The workspace row lock serialises two coordinators demoting each other.
 */
export function changeMember(
  db: Db,
  workspaceId: number,
  userId: number,
  to: 'coordinator' | 'teacher' | null,
): Promise<MemberChange> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE`, [workspaceId]);
    const [m] = await tx.query<{ role: string }>(`SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2`, [
      workspaceId,
      userId,
    ]);
    if (!m) return 'not_found';
    if (m.role === 'coordinator' && to !== 'coordinator') {
      const [{ n }] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'coordinator'`,
        [workspaceId],
      );
      if (n <= 1) return 'last_coordinator';
    }
    if (to) {
      await tx.query(`UPDATE members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId, to]);
    } else {
      await tx.query(`DELETE FROM members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
    }
    return 'ok';
  });
}

export async function isMember(db: Queryable, workspaceId: number, userId: number) {
  return (await db.query(`SELECT 1 FROM members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId])).length > 0;
}

// ---------------------------------------------------------------- invites

export async function createInvite(
  db: Queryable,
  i: { code: string; workspaceId: number; role: 'coordinator' | 'teacher'; teacherId: number | null; userId: number | null },
) {
  const [row] = await db.query<{ expires_at: string }>(
    `INSERT INTO invites (code, workspace_id, role, teacher_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '7 days') RETURNING ${ISO('expires_at')} AS expires_at`,
    [i.code, i.workspaceId, i.role, i.teacherId, i.userId],
  );
  return row.expires_at;
}

/** Unused, unexpired invites, newest first. */
export function listInvites(db: Queryable, workspaceId: number) {
  return db.query<Invite>(
    `SELECT code, role, teacher_id AS "teacherId", ${ISO('expires_at')} AS "expiresAt", ${ISO('created_at')} AS "createdAt"
       FROM invites
      WHERE workspace_id = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC, code`,
    [workspaceId],
  );
}

/** True when an unused invite was revoked. */
export async function revokeInvite(db: Queryable, workspaceId: number, code: string) {
  const rows = await db.query(`DELETE FROM invites WHERE workspace_id = $1 AND code = $2 AND used_at IS NULL RETURNING 1`, [
    workspaceId,
    code,
  ]);
  return rows.length > 0;
}

export type InviteResult =
  | { status: 'ok'; workspace: WorkspaceSummary }
  | { status: 'not_found' }
  | { status: 'member'; name: string }
  | { status: 'teacher_taken' };

/** Spends an invite on this user, creating the membership. Locks the invite row so it is used once. */
export function redeemInvite(db: Db, code: string, userId: number): Promise<InviteResult> {
  return db.transaction(async (tx) => {
    const [inv] = await tx.query<{ workspace_id: number; role: string; teacher_id: number | null; name: string }>(
      `SELECT i.workspace_id, i.role, i.teacher_id, w.name
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.code = $1 AND i.used_at IS NULL AND i.expires_at > now() AND NOT w.is_demo
        FOR UPDATE OF i`,
      [code],
    );
    if (!inv) return { status: 'not_found' };
    if (await isMember(tx, inv.workspace_id, userId)) return { status: 'member', name: inv.name };
    if (inv.teacher_id) {
      const taken = await tx.query(`SELECT 1 FROM members WHERE teacher_id = $1`, [inv.teacher_id]);
      if (taken.length) return { status: 'teacher_taken' };
    }
    await tx.query(`INSERT INTO members (workspace_id, user_id, role, teacher_id) VALUES ($1, $2, $3, $4)`, [
      inv.workspace_id,
      userId,
      inv.role,
      inv.teacher_id,
    ]);
    await tx.query(`UPDATE invites SET used_by = $2, used_at = now() WHERE code = $1`, [code, userId]);
    return { status: 'ok', workspace: await getSummary(tx, inv.workspace_id) };
  });
}
