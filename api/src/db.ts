import { neon, Pool } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` between BEGIN and COMMIT on a single connection; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Anything shaped like a node-postgres Pool: `pg.Pool`, or Neon's WebSocket `Pool`. */
export interface PoolLike {
  query: QueryFn;
  connect(): Promise<{ query: QueryFn; release(): void }>;
}

const rowsOf = (query: QueryFn): Queryable => ({
  query: async (text, params) => (await query(text, params)).rows,
});

export function poolDb(pool: PoolLike): Db {
  return {
    ...rowsOf((t, p) => pool.query(t, p)),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(rowsOf((t, p) => client.query(t, p)));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Neon from a Worker: one-shot queries go over HTTP (no connection handshake),
 * transactions open a WebSocket Pool that lives only for that transaction
 * (Workers must not reuse sockets across requests).
 */
export function neonDb(connectionString: string): Db {
  const sql = neon(connectionString);
  return {
    query: (text, params) => sql.query(text, params) as Promise<any[]>,
    async transaction(fn) {
      const pool = new Pool({ connectionString });
      try {
        return await poolDb(pool as unknown as PoolLike).transaction(fn);
      } finally {
        await pool.end();
      }
    },
  };
}
