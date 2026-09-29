import { createApp, DEFAULT_TIMEZONE } from './app';
import { cleanupOverlays } from './data';
import { todayIn } from './dates';
import { neonDb } from './db';
import type { Bindings } from './env';

const app = createApp((env) => neonDb(env.DATABASE_URL));

export default {
  fetch: app.fetch,
  // Cron trigger (wrangler.jsonc): drop expired overlays and day-old sandbox overlays.
  async scheduled(_event, env, ctx) {
    const today = todayIn(env.TIMEZONE || DEFAULT_TIMEZONE);
    ctx.waitUntil(
      cleanupOverlays(neonDb(env.DATABASE_URL), today).then((n) => console.log(`cleanup: deleted ${n} overlays`)),
    );
  },
} satisfies ExportedHandler<Bindings>;
