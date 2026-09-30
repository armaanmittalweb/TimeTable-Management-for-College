import { defineConfig } from 'vitest/config';

// Each test file boots its own PGlite (Postgres in WASM); when files run in
// parallel that can take longer than vitest's 10 s default for a hook.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 60_000 },
});
