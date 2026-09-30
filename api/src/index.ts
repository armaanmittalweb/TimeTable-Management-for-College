import { createApp } from './app';
import { cleanup } from './data/maintenance';
import { neonDb } from './db';
import type { Bindings } from './env';

const app = createApp((env) => neonDb(env.DATABASE_URL));

export default {
  fetch: app.fetch,
  // Cron trigger (wrangler.jsonc): expired demo copies and sessions, old changes, spent codes.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(neonDb(env.DATABASE_URL)).then((r) => console.log('cleanup', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Bindings>;
