// Loads db/schema.sql and db/seed.sql into an empty database, in one transaction.
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
  for (const file of ['schema.sql', 'seed.sql']) {
    await client.query(readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    console.log(`applied db/${file}`);
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
