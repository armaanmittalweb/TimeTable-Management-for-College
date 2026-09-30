# EduSched frontend

The college timetable as a railway departures board. The **control room** on the left is Prof. Meera's view,
where classes are cancelled or moved. The **platform** on the right is student CSE-2A's view, and it flips when
a change lands. Both demo accounts are signed in on load. `/embed` is a compact version for the portfolio's Lab.

TypeScript, React 19 and Vite, with plain CSS custom properties. There is no UI kit and no animation or chart
library. The split-flap animation uses CSS transforms, and the flap sound is synthesized with Web Audio.

## Run locally

```sh
cd api && npm install && npm run dev:local      # API on http://localhost:8787 (PGlite in memory, seeded)
cd frontend && npm install && npm run dev       # http://localhost:5173
```

The dev server has to run on port 5173 because that is the local origin the API's CORS allows. Copy
`.env.example` to `.env` to point at a different API.

| script           | what it does                                                     |
|------------------|------------------------------------------------------------------|
| `npm run build`  | typecheck, then build to `dist/`                                 |
| `npm run shots`  | screenshots + axe check of a running dev server (see below)      |

`scripts/shots.mjs` starts nothing itself. With the API and `npm run dev` running, it drives Chromium through the
initial board, a postpone, a 409, the race, the phone control room and `/embed`. It writes PNGs to
`scripts/shots/` (gitignored) and prints any axe violations. It needs Chromium installed once with
`npx playwright install chromium`.

## Environment

| name                        | required | value                                                         |
|-----------------------------|----------|---------------------------------------------------------------|
| `VITE_API_URL`              | yes      | the API's public URL, no trailing slash                       |
| `VITE_EMBED_PARENT_ORIGINS` | no       | who may frame `/embed` and exchange messages with it. Default `https://www.amittal.dev,http://localhost:5173` |

Both are read at build time. `vercel.json` sets up the SPA rewrite, a one-year immutable cache for `/assets` and
`/fonts`, and security headers. Its CSP uses `frame-ancestors 'none'` everywhere except `/embed`, which only
`https://www.amittal.dev` may frame. The CSP's `connect-src` allows `https://*.amittal.dev` and
`https://*.workers.dev`. Narrow it to the API's exact host once that host is known. If you change
`VITE_EMBED_PARENT_ORIGINS`, update the `/embed` `frame-ancestors` to match.

## /embed messages

Parent to embed: `{type:'theme', tokens:{bg, ink, accent, muted, line}}` and `{type:'command', name:'race'|'reset'}`.
Embed to parent: `{type:'ready'}`, `{type:'height', px}` and `{type:'stage', i, name, ms, ok, lane?}`. The stage
indexes are 0 JWT login, 1 Base timetable, 2 Change overlay, 3 Free-room query, 4 Clash checks and 5 Commit change.
Every `ms` is a real browser-side request time:

- 0 is the professor's login.
- 1 and 2 are the professor's and the student's timetable reads.
- 3 is the latest free-room query.
- 4 and 5 both come from the single postpone request, because the server runs the clash checks and the commit in one transaction.

During a race, stages 4 and 5 are sent once per request, marked with `lane: 'A'` or `'B'`.

The origin is checked on every message in both directions. Theme tokens are used only if the board stays
readable: a light `bg` is ignored, and `ink` and `accent` must keep AA contrast.
