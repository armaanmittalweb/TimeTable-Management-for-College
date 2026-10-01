# EduSched app

The timetable a department runs on. The home screen is the week grid: one batch, teacher or room per view, with
cancelled and moved classes shown for that day only. Coordinators set the department up (rooms, teachers, batches,
courses, the week, codes, publish); teachers reschedule their own classes with clash-checked free slots; students
follow their batch with a class code and need no account.

React 19, TypeScript and Vite, plain CSS on the tokens in `src/styles/tokens.css` (IBM Plex, self-hosted). No UI
kit, no router library, no animation library. The API contract is `../docs/rebuild/contract.md`; `src/contract.ts`
is a copy of its Shapes block.

## Run locally

```sh
npm install
VITE_API=mock npm run dev                              # everything in the browser: an in-memory API with a demo college
VITE_API_URL=http://localhost:8787 npm run dev         # against the real API (cd ../api && npm run dev:local)
```

The dev server must stay on port 5173 (the API's CORS list). With the mock, sign in as
`priya.menon@riverside.edu` (coordinator) or `meera.iyer@riverside.edu` (teacher), password `timetable-demo`, or open
the demo from the front page. The mock keeps its state in `localStorage` (`edusched.mock.*`); `window.__esMock.reset()`
starts over. It is only bundled when `VITE_API=mock`.

| script            | what it does                                                                    |
|-------------------|---------------------------------------------------------------------------------|
| `npm run build`   | typecheck, then build to `dist/`                                                |
| `npm run shots`   | screenshots + axe of every screen against a running mock dev server (below)     |

`npm run shots` drives Chromium through every screen at 1440×900 and 390×844, light and dark, with the clock pinned to
Wed 30 Sep 2026 11:20 IST, and writes `shots/<scene>-<size>-<theme>.png` (gitignored) plus `shots/axe.json`. It
exits non-zero on any axe violation. `ONLY=<regex>` runs some scenes, `THEMES=light`, `SIZES=phone`, `AXE=0` narrow it.
Chromium once: `npx playwright install chromium`.

## Routes

`/` front page (the demo college's week, read-only) · `/demo` opens a private 24-hour copy · `/w/:slug` week (Today on
phones) with `/week`, `/today`, `/changes`, `/rooms`, `/setup/:step` · `/b/:code` a followed batch (week, today,
changes) · `/join[/:code]` · `/signin`, `/signup`, `/forgot`, `/settings`, `/new` · `/embed` · anything else is a 404.
The week takes `?week=YYYY-MM-DD&batch|teacher|room=ID`.

Keyboard: `←`/`→` week, `T` today, `/` search, `?` shortcuts, `Esc` closes; in the grid, arrows move between
classes and Enter opens one.

## Offline

`public/sw.js` keeps the app shell (HTML, hashed assets, fonts, icons). Data is not cached by the worker: the app keeps
the last-seen copy of each week in `localStorage` (`edusched.cache.<code>.<weekStart>` for students,
`edusched.cache.w.<slug>.<filter>.<weekStart>` for members) and shows "Offline · showing the copy from 10:42".
Followed batches live in `localStorage['edusched.follows']` and sync to the account after sign-in.

## Environment

| name                        | value                                                                     |
|-----------------------------|---------------------------------------------------------------------------|
| `VITE_API_URL`              | the API's URL, no trailing slash. Default `https://edusched-api.amittal.dev` |
| `VITE_API`                  | `mock` to use the in-memory API                                           |
| `VITE_EMBED_PARENT_ORIGINS` | who may frame `/embed`. Default `https://www.amittal.dev,http://localhost:5173` |

`vercel.json` sends only app routes to `index.html` (real files such as `robots.txt` and `sitemap.xml` are served as
they are; unknown paths get `public/404.html`), sets a one-year cache on `/assets` and `/fonts`, and a CSP whose
`connect-src` allows the API and `https://api.amittal.dev` (page-view counts). Only `https://www.amittal.dev` may frame
`/embed`.

## /embed

A compact, read-only week of the demo college for the portfolio (noindex). Parent to embed:
`{type:'theme', tokens:{bg}}` picks light or dark from the parent's background. Embed to parent: `{type:'ready'}` and
`{type:'height', px}`. Messages are exchanged only with the origins above.
