# EduSched: design brief

The owner's words: "edusched should look like a timetable … they all should feel like products, not some animated picture … PLEASE DON'T GIVE ME AI SLOP that just looks like any other site."

## The feel

A campus office tool that a department actually runs on: white paper, navy ink, dense and calm. Think of a good school information system or a well-made calendar (Fantastical, Google Calendar's week view, Linear's density), not a SaaS landing page. The **week grid is the home screen** and the product's face.

## Hard rules (a reviewer checks every one)

- No hero sections, no feature-card grids, no gradients, no glows, no glassmorphism, no emoji, no stock illustrations, no "Welcome back 👋", no marketing copy inside the app.
- No split-flap letters, fake clocks, sound effects or decorative animation. The current `FlapText`, `sound.ts`, `motion.ts`, board styles are deleted.
- Motion only to explain a change: a class sliding to its new slot after a move (≤ 200 ms, `prefers-reduced-motion` → none), a sheet opening.
- Colour means something: one quiet colour per course (8 hues, tokens below), red for "now" and destructive actions, amber for "changed". Chrome is grey and navy only.
- Rounded corners 6 px (cards 8 px). Borders 1 px `--line`. Shadows only on floating things (menus, popovers, the drag ghost).
- Type: IBM Plex Sans (UI) and IBM Plex Mono (times, codes, counts, tabular numbers). Self-host the woff2 files (latin subset) in `frontend/public/fonts`; no Google Fonts request. Base size 14 px on desktop, 15 px on phones; line-height 1.4.
- Every string is something a person would say: "Class moved to Thu 10:00, CR-204", "Cancel Tuesday's class", "No classes today. Next: Mon 09:00 CS201". Never "overlay", "entity", "record", "success!".
- Every screen has designed first-run, empty, loading (skeletons in the grid's shape), offline (cached week with "Offline · showing the copy from 10:42"), and error-with-a-way-out states.
- Keyboard: `←`/`→` previous/next week, `T` today, `/` search (batch, teacher, room, course), `?` shortcut sheet, `Esc` closes. Visible focus rings.
- 360 px phone works: the phone default is the **Today** view and a one-day week strip; the full week scrolls horizontally with the time rail sticky.
- Light and dark themes; the dark theme is its own palette (below), not an inversion. 0 axe violations. Print stylesheet: the current week on one A4 landscape page.
- PWA: manifest, icons, offline cache of the app shell and the last-seen weeks.

## Tokens

Copy into `frontend/src/styles/tokens.css`.

```css
:root {
  --bg: #ffffff; --bg-rail: #f6f7f9; --bg-today: #f3f6fd; --bg-hover: #f1f3f6; --bg-sunken: #eef0f3;
  --ink: #172033; --ink-2: #3a4458; --muted: #667085; --faint: #98a2b3;
  --line: #e4e7ec; --line-strong: #d0d5dd;
  --navy: #1f3a6e; --navy-ink: #ffffff; --focus: #3b5bab;
  --now: #d92d20; --danger: #b42318; --changed: #b54708; --changed-bg: #fef6e7; --ok: #067647;
  /* course colours: background / border+text */
  --c1: #dbe6fb; --c1-ink: #2c4a94;  --c2: #e3f1e6; --c2-ink: #2b6b40;  --c3: #f6ead9; --c3-ink: #8a5210;  --c4: #efe4f6; --c4-ink: #6d3a8a;
  --c5: #fbe3e1; --c5-ink: #9b2c24;  --c6: #dff2f2; --c6-ink: #1f6464;  --c7: #f3efd6; --c7-ink: #6b5e14;  --c8: #e7e9ee; --c8-ink: #3f4a5e;
  --radius: 6px; --radius-lg: 8px;
  --f-sans: 'IBM Plex Sans', system-ui, sans-serif; --f-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --row: 56px;        /* one hour in the week grid */
  color-scheme: light;
}
[data-theme="dark"] {
  --bg: #12161f; --bg-rail: #171c27; --bg-today: #1a2335; --bg-hover: #1d2330; --bg-sunken: #0e121a;
  --ink: #e6e9f0; --ink-2: #c3c9d5; --muted: #98a2b3; --faint: #667085;
  --line: #262d3b; --line-strong: #323b4d;
  --navy: #9db4ea; --navy-ink: #0e1422; --focus: #9db4ea;
  --now: #f97066; --danger: #f97066; --changed: #f5b453; --changed-bg: #2e2413; --ok: #75e0a7;
  --c1: #22335a; --c1-ink: #b3c8f7;  --c2: #1d3727; --c2-ink: #9ad8ae;  --c3: #3a2c19; --c3-ink: #f0c68a;  --c4: #33253e; --c4-ink: #d7b3ee;
  --c5: #3d2220; --c5-ink: #f4aaa3;  --c6: #173434; --c6-ink: #93d6d6;  --c7: #34301a; --c7-ink: #e3d58e;  --c8: #262b36; --c8-ink: #c3c9d5;
  color-scheme: dark;
}
```

Theme follows the system until the user picks one in the account menu (stored in `localStorage['edusched.theme']`).

## Anatomy of the week grid

- Top bar (48 px): product mark (a small navy square with a white grid glyph, SVG), workspace name, tabs (Week, Today, Changes, Rooms, Setup for coordinators), search, account menu (name, theme, settings, sign out).
- Sub bar (44 px): `‹ 28 Sep – 2 Oct 2026 ›`, `Today` button, the filter as a segmented control (Batch / Teacher / Room) plus a picker, and "2 changes this week" linking to Changes.
- Grid: time rail 56 px (Plex Mono 11 px), one column per shown day with the date head (today's head tinted and its date in navy), hour lines, period breaks as hatched bands labelled "Lunch", a red now-line with a dot. Class blocks: course colour background, 3 px left border in the course ink colour, course code bold, name, then room · teacher initials. Blocks shorter than 45 minutes show code and room only.
- States of a block: `cancelled` (hatched, struck-through, "Cancelled" tag), `moved-away` (dashed outline where it was, "→ Thu 10:00"), `moved-here` (solid, amber "Moved from Tue" tag).
- Clicking a block opens a right-side panel (a bottom sheet on phones): course, when, room with capacity, batch with size, teacher, this week's change if any, and actions for whoever may act: **Reschedule**, **Cancel this class**, **Undo change**.
- Reschedule mode: the grid dims every slot where the teacher or batch is busy or no room fits (reason on hover), highlights free slots; drag the block or click a slot, then pick a room from the short list of free rooms; a confirm bar at the bottom shows "Move CS201 from Tue 09:00 to Thu 10:00 in CR-204" with Confirm and Cancel. A 409 shows who took the slot and offers the suggestion.

## Screens beyond the week

- **Signed-out front page** (`/`): not a landing page. The real week grid of the demo college, read-only, with a slim bar: "EduSched · the timetable your department runs on", **Open the demo college**, **Sign in**, and a field "Have a class code?". Real text below the fold for search engines: three short paragraphs (what it does, for coordinators, for students), and a link to the case study.
- **Today** (phone default): the next class as a large card with room, time left and teacher; the rest of the day as a list; changes affecting today on top in amber.
- **Changes**: a feed grouped by day, each row "CS205 moved Tue 09:00 → Thu 10:00, CR-204 · N. Rao · 2 h ago", filterable, new-since-last-visit dot.
- **Rooms**: the week grid with rooms as columns for a chosen day, or "free now" list.
- **Setup** (coordinator): a left step list (Basics, Periods, Rooms, Teachers, Batches, Courses, Timetable, Codes and members, Publish) with a completion tick each; tables with inline editing; CSV import with a template download, a dry-run report of errors by line, and a confirm; the timetable step is the week grid in edit mode with a palette of courses to drop in.
- **Join**: `/join/:code` or the code field → a student follows the batch (stored on the device) or a teacher links their account.
- **Account**: sign in, create account (name, email, password), forgot password (enter the code your coordinator gives you), settings (profile, password, sessions with "sign out", theme, delete account), and the calendar feed link with copy button and instructions for Google and Apple Calendar.
- **Demo**: a thin amber bar across the top: "Demo college · resets in 23 h · Viewing as: [Coordinator ▾]" with the role switcher (coordinator, a teacher, a batch).
