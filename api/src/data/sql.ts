// Shared SQL fragments. Dates and times are formatted in SQL, not by the driver:
// node-postgres and Neon turn a `date` into a JS Date at local midnight, which
// shifts the day depending on where the code runs.

/** time → 'HH:MM' */
export const HM = (col: string) => `to_char(${col}, 'HH24:MI')`;

/** timestamptz → ISO 8601 in UTC, e.g. 2026-09-29T04:30:00Z */
export const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** A WorkspaceSummary built in SQL from alias `w`. */
export const SUMMARY = `json_build_object(
  'id', w.id, 'slug', w.slug, 'name', w.name, 'institution', w.institution,
  'timezone', w.timezone, 'published', w.published_at IS NOT NULL, 'isDemo', w.is_demo)`;

/**
 * Transaction-scoped advisory lock. Released automatically at COMMIT/ROLLBACK,
 * which also makes it safe behind Neon's transaction-mode pooler.
 */
export const LOCK = `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`;
