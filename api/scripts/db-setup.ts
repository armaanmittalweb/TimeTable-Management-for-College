// Loads db/schema.sql into an empty database, in one transaction. There is no seed:
// the demo college lives in db/demo.json and is copied per visitor by POST /api/demo.
// Usage: DATABASE_URL=postgresql://... npm run db:setup
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (use the direct, non-pooled Neon connection string).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('applied db/schema.sql');
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
