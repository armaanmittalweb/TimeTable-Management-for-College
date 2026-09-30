// The hourly cron and the Switchboard's /internal routes.

import type { Queryable } from '../db';

export const CHANGE_RETENTION_DAYS = 180;

export interface CleanupReport {
  deleted: number;
  demoCopies: number;
  sessions: number;
  changes: number;
  codes: number;
}

/**
 * Deletes expired demo copies (their sessions, feeds and changes go with them),
 * expired sessions, changes older than 180 days, and spent or expired invites and
 * reset codes. One statement, so it is one round trip over Neon's HTTP driver.
 */
export async function cleanup(db: Queryable): Promise<CleanupReport> {
  const [row] = await db.query<Omit<CleanupReport, 'deleted'>>(
    `WITH demo AS (
       DELETE FROM workspaces WHERE is_demo AND expires_at < now() RETURNING 1
     ), sess AS (
       DELETE FROM sessions WHERE expires_at < now() RETURNING 1
     ), old AS (
       DELETE FROM changes
        WHERE occurs_on < current_date - ${CHANGE_RETENTION_DAYS}
          AND (to_date IS NULL OR to_date < current_date - ${CHANGE_RETENTION_DAYS})
       RETURNING 1
     ), inv AS (
       DELETE FROM invites WHERE expires_at < now() - interval '30 days' RETURNING 1
     ), rc AS (
       DELETE FROM reset_codes WHERE expires_at < now() - interval '1 day' RETURNING 1
     )
     SELECT (SELECT count(*)::int FROM demo) AS "demoCopies",
            (SELECT count(*)::int FROM sess) AS sessions,
            (SELECT count(*)::int FROM old) AS changes,
            (SELECT count(*)::int FROM inv) + (SELECT count(*)::int FROM rc) AS codes`,
  );
  return { deleted: row.demoCopies + row.sessions + row.changes + row.codes, ...row };
}

export async function stats(db: Queryable) {
  const [row] = await db.query<{ db_bytes: string; users: number; changes: number; demo_copies: number; workspaces: number }>(
    `SELECT pg_database_size(current_database())::bigint AS db_bytes,
            (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM changes) AS changes,
            (SELECT count(*)::int FROM workspaces WHERE is_demo AND expires_at > now()) AS demo_copies,
            (SELECT count(*)::int FROM workspaces WHERE NOT is_demo) AS workspaces`,
  );
  return {
    dbBytes: Number(row?.db_bytes ?? 0),
    users: row?.users ?? 0,
    changes: row?.changes ?? 0,
    demoCopies: row?.demo_copies ?? 0,
    workspaces: row?.workspaces ?? 0,
  };
}
