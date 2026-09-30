// Calendar feed tokens: a secret URL per (workspace, kind, target, creator).

import type { Queryable } from '../db';

export interface Feed {
  workspaceId: number;
  kind: 'batch' | 'teacher' | 'room';
  targetId: number;
  timezone: string;
  days: number[];
  workspaceName: string;
  targetName: string;
}

/** The caller's existing token for this target, or a new one, so repeated clicks do not pile up rows. */
export async function findOrCreateFeed(
  db: Queryable,
  f: { workspaceId: number; kind: Feed['kind']; targetId: number; userId: number | null; token: string },
): Promise<string> {
  const [row] = await db.query<{ token: string }>(
    `WITH found AS (
       SELECT token FROM feeds
        WHERE workspace_id = $1 AND kind = $2 AND target_id = $3 AND created_by IS NOT DISTINCT FROM $4
        LIMIT 1
     ), made AS (
       INSERT INTO feeds (token, workspace_id, kind, target_id, created_by)
       SELECT $5, $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM found)
       RETURNING token
     )
     SELECT token FROM found UNION ALL SELECT token FROM made`,
    [f.workspaceId, f.kind, f.targetId, f.userId, f.token],
  );
  return row.token;
}

const TARGET_NAME = `CASE f.kind
  WHEN 'batch' THEN (SELECT name FROM batches WHERE id = f.target_id AND workspace_id = f.workspace_id)
  WHEN 'teacher' THEN (SELECT name FROM teachers WHERE id = f.target_id AND workspace_id = f.workspace_id)
  WHEN 'room' THEN (SELECT name FROM rooms WHERE id = f.target_id AND workspace_id = f.workspace_id) END`;

/** A feed whose target still exists in a live workspace. */
export async function getFeed(db: Queryable, token: string): Promise<Feed | null> {
  const [row] = await db.query<Feed>(
    `SELECT f.workspace_id AS "workspaceId", f.kind, f.target_id AS "targetId", w.timezone, w.days,
            w.name AS "workspaceName", ${TARGET_NAME} AS "targetName"
       FROM feeds f JOIN workspaces w ON w.id = f.workspace_id
      WHERE f.token = $1 AND (w.expires_at IS NULL OR w.expires_at > now())`,
    [token],
  );
  return row && row.targetName ? { ...row, days: row.days.map(Number) } : null;
}
