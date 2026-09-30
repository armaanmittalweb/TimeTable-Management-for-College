// Screenshots + axe of every screen against the in-memory mock. Start the app first:
//   VITE_API=mock npm run dev      (then, in another shell)   npm run shots
// Writes PNGs to shots/ (gitignored): <scene>-<desktop|phone>-<light|dark>.png, and prints axe violations.
// The clock is pinned to Wednesday 30 Sep 2026, 11:20 IST so the now-line and "this week" are stable.
// Env: BASE_URL (default http://localhost:5173), ONLY=<regex of scene names>, AXE=0 to skip axe.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const RUN_AXE = process.env.AXE !== '0';
const NOW = new Date('2026-09-30T11:20:00+05:30');
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const axeReport = [];

async function context(size, theme) {
  const phone = size.startsWith('phone');
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  page.on('pageerror', (e) => console.error(`  page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && console.error(`  console: ${m.text()}`));
  return { ctx, page };
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: opts.full ?? false });
  console.log(`  ${name}.png`);
}
async function axe(page, label) {
  if (!RUN_AXE) return;
  const { violations } = await new AxeBuilder({ page }).disableRules(['region']).analyze();
  axeReport.push({ label, violations });
}

async function startDemo(page) {
  await page.goto(`${BASE}/demo`);
  await page.waitForURL(/\/w\/demo-/);
  await page.locator('.blk, .dayl, .today-empty').first().waitFor();
  await settle(page);
}
async function signIn(page, email = 'priya.menon@riverside.edu') {
  await page.goto(`${BASE}/signin`);
  await page.fill('#email', email);
  await page.fill('#password', 'timetable-demo');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/w\//);
  await settle(page);
}

// Each scene gets a fresh browser context (fresh mock database) per size and theme.
const scenes = {
  async front(page, size) {
    await page.goto(BASE + '/');
    await page.locator('.blk').first().waitFor();
    await settle(page);
    await shot(page, `front-${size}`, { full: size.startsWith('desktop') });
  },
  async week(page, size) {
    await startDemo(page);
    if (size.startsWith('phone')) await page.goto(page.url() + '/week');
    await page.locator('.blk').first().waitFor();
    await settle(page);
    await shot(page, `week-${size}`);
  },
  async panel(page, size) {
    await startDemo(page);
    if (size.startsWith('phone')) await page.goto(page.url() + '/week');
    await page.locator('.blk.is-moved-here').first().click();
    await settle(page);
    await shot(page, `panel-${size}`);
  },
  async reschedule(page, size) {
    await startDemo(page);
    if (size.startsWith('phone')) await page.goto(page.url() + '/week');
    const fri = page.locator('.blk[aria-label^="CS201"][aria-label*="Friday"]').first();
    await fri.click();
    await settle(page, 200);
    await page.getByRole('button', { name: 'Reschedule' }).click();
    await page.locator('.slot.is-free').first().waitFor();
    await settle(page);
    await shot(page, `reschedule-${size}`);
    // Pick Thursday 12:00? It's taken by the moved CS205 — pick the first free Thursday slot instead.
    await page.locator('.slot.is-free[data-slot^="2026-10-01"]').first().click();
    await settle(page, 300);
    await shot(page, `reschedule-confirm-${size}`);
    // Someone else takes that room at that time, then we confirm: a 409 with a suggestion.
    const slot = await page.locator('.slot.is-picked').getAttribute('data-slot');
    const roomName = (await page.locator('#move-room option:checked').textContent()).split(' ·')[0];
    await page.evaluate(({ slot, roomName }) => {
      // Another coordinator moves ECE-2A's Friday HS201 into the same room at the same time, a moment earlier.
      const m = window.__esMock;
      const ws = m.db().workspaces.find((w) => w.slug.startsWith('demo-'));
      const [date, start] = slot.split('T');
      const room = ws.rooms.find((r) => r.name === roomName);
      const batch = ws.batches.find((b) => b.name === 'ECE-2A');
      const other = ws.classes.find((c) => c.batchId === batch.id && c.day === 5 && c.start === '10:00');
      const end = `${String(+start.slice(0, 2) + 1).padStart(2, '0')}:00`;
      ws.changes.push({ id: 99999, classId: other.id, occursOn: '2026-10-02', kind: 'moved', toDate: date, toStart: start, toEnd: end, toRoomId: room.id, reason: null, createdBy: 'Kabir Sethi', createdAt: new Date().toISOString() });
    }, { slot, roomName });
    await page.getByRole('button', { name: 'Confirm move' }).click();
    await page.locator('.confirm.is-error').waitFor();
    await settle(page, 300);
    await shot(page, `reschedule-409-${size}`);
    await page.locator('.confirm.is-error .btn-primary').click();
    await page.locator('.toast').first().waitFor();
    await settle(page, 400);
    await shot(page, `moved-${size}`);
  },
  async cancel(page, size) {
    await startDemo(page);
    if (size.startsWith('phone')) await page.goto(page.url() + '/week');
    await page.locator('.blk[aria-label^="CS203"][aria-label*="Friday"]').first().click();
    await settle(page, 200);
    await page.getByRole('button', { name: 'Cancel this class' }).click();
    await settle(page, 300);
    await shot(page, `cancel-dialog-${size}`);
  },
  async today(page, size) {
    await startDemo(page);
    await page.goto(page.url().replace(/\/(week|today)$/, '') + '/today');
    await page.locator('.dayl, .today-empty').first().waitFor();
    await settle(page);
    await shot(page, `today-${size}`, { full: true });
  },
  async changes(page, size) {
    await startDemo(page);
    await page.goto(page.url().replace(/\/(week|today)$/, '') + '/changes');
    await page.locator('.feedrow').first().waitFor();
    await settle(page);
    await shot(page, `changes-${size}`, { full: true });
  },
  async rooms(page, size) {
    await startDemo(page);
    const base = page.url().replace(/\/(week|today)$/, '');
    await page.goto(base + '/rooms');
    await page.locator('.blk').first().waitFor();
    await settle(page);
    await shot(page, `rooms-${size}`);
    await page.goto(base + '/rooms?view=free');
    await page.locator('.roomlist').first().waitFor();
    await settle(page);
    await shot(page, `rooms-free-${size}`, { full: true });
  },
  async teacher(page, size) {
    await startDemo(page);
    await page.selectOption('.demobar-select', { label: 'Nisha Rao' });
    await page.locator('.toast').first().waitFor();
    if (size.startsWith('phone')) await page.goto(page.url() + '/week');
    await page.locator('.blk').first().waitFor();
    await settle(page);
    await shot(page, `teacher-week-${size}`);
  },
  async search(page, size) {
    if (size.startsWith('phone')) return;
    await startDemo(page);
    await page.keyboard.press('/');
    await page.keyboard.type('ra');
    await settle(page, 250);
    await shot(page, `search-${size}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await settle(page, 250);
    await shot(page, `shortcuts-${size}`);
  },
  async setup(page, size) {
    await signIn(page);
    const base = '/w/riverside-cs/setup';
    for (const step of ['basics', 'periods', 'rooms', 'courses', 'timetable', 'codes', 'publish']) {
      await page.goto(BASE + `${base}/${step}`);
      await page.locator('.setup-body').waitFor();
      await settle(page, 350);
      await shot(page, `setup-${step}-${size}`, { full: true });
    }
    await page.goto(BASE + `${base}/rooms`);
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.fill('#csv-text', 'name,capacity,building,kind\nCR-204,60,Main Block,lecture\nCR-205,sixty,Main Block,lecture\nLAB-303,40,Tech Block,workshop\n,30,,lecture');
    await page.getByRole('button', { name: 'Check the file' }).click();
    await page.locator('.report').waitFor();
    await settle(page, 250);
    await shot(page, `setup-import-report-${size}`);
  },
  async newworkspace(page, size) {
    await page.goto(`${BASE}/signup`);
    await page.fill('#name', 'Asha Kulkarni');
    await page.fill('#email', 'asha@college.edu');
    await page.fill('#password', 'correct-horse-9');
    await page.click('button[type=submit]');
    await page.waitForURL(/\/new/);
    await settle(page);
    await shot(page, `new-workspace-${size}`);
    await page.fill('#ws-name', 'Mechanical Engineering');
    await page.fill('#ws-inst', 'Deccan College of Engineering');
    await page.click('button[type=submit]');
    await page.waitForURL(/\/setup/);
    await settle(page);
    await shot(page, `setup-first-run-${size}`, { full: true });
    await page.goto(page.url().replace(/\/setup.*$/, '/week'));
    await settle(page);
    await shot(page, `week-empty-workspace-${size}`);
  },
  async student(page, size) {
    await page.goto(`${BASE}/join/cse2a-k7qd`);
    await page.getByRole('button', { name: 'Follow this batch' }).waitFor();
    await settle(page);
    await shot(page, `join-${size}`);
    await page.getByRole('button', { name: 'Follow this batch' }).click();
    await page.waitForURL(/\/b\//);
    await page.locator('.blk, .dayl, .today-empty').first().waitFor();
    await settle(page);
    await shot(page, `student-home-${size}`);
    await page.goto(`${BASE}/b/CSE2A-K7QD/week`);
    await page.locator('.blk').first().waitFor();
    await settle(page);
    await shot(page, `student-week-${size}`);
    // Offline: this week was seen, so it shows the saved copy; next week was never loaded.
    await page.context().setOffline(true);
    await page.keyboard.press('ArrowRight');
    await page.locator('.errstate').waitFor();
    await settle(page, 300);
    await shot(page, `student-offline-nocopy-${size}`);
    await page.keyboard.press('ArrowLeft');
    await page.locator('.sub-offline').waitFor();
    await settle(page, 300);
    await shot(page, `student-offline-${size}`);
    await page.context().setOffline(false);
  },
  async auth(page, size) {
    for (const p of ['signin', 'signup', 'forgot', 'join']) {
      await page.goto(`${BASE}/${p}`);
      await page.locator('.auth-card').waitFor();
      await settle(page, 250);
      await shot(page, `auth-${p}-${size}`);
    }
    await page.goto(`${BASE}/join/NOPE-1234`);
    await page.locator('.form-error').waitFor();
    await shot(page, `join-bad-code-${size}`);
  },
  async settings(page, size) {
    await signIn(page);
    await page.goto(`${BASE}/settings`);
    await page.locator('.set-sec').first().waitFor();
    await settle(page);
    await shot(page, `settings-${size}`, { full: true });
  },
  async notfound(page, size) {
    await page.goto(`${BASE}/no/such/page`);
    await page.locator('.notfound').waitFor();
    await shot(page, `404-${size}`);
  },
  async loading(page, size) {
    await page.addInitScript(() => localStorage.setItem('edusched.mock.latency', '60000'));
    await page.goto(`${BASE}/`);
    await page.locator('.tg.is-skeleton').waitFor();
    await settle(page, 300);
    await shot(page, `loading-${size}`);
  },
  async embed(page, size) {
    await page.goto(`${BASE}/embed`);
    await page.locator('.blk').first().waitFor();
    await settle(page);
    await shot(page, `embed-${size}`, { full: true });
  },
};

const themes = (process.env.THEMES || 'light,dark').split(',');
const sizes = (process.env.SIZES || 'desktop,phone').split(',');
for (const [name, run] of Object.entries(scenes)) {
  if (ONLY && !ONLY.test(name)) continue;
  console.log(name);
  for (const theme of themes) {
    for (const size of sizes) {
      const { ctx, page } = await context(size, theme);
      try {
        await run(page, `${size}-${theme}`);
        if (theme === 'light') await axe(page, `${name} ${size}`);
      } catch (e) {
        console.error(`  FAILED ${name} ${size} ${theme}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: `${OUT}FAILED-${name}-${size}-${theme}.png` }).catch(() => undefined);
      } finally {
        await ctx.close();
      }
    }
  }
}

await browser.close();
let total = 0;
for (const { label, violations } of axeReport) {
  for (const v of violations) {
    total++;
    console.log(`axe ${label}: ${v.id} (${v.impact}) ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }
}
await writeFile(`${OUT}axe.json`, JSON.stringify(axeReport, null, 2));
console.log(RUN_AXE ? `axe: ${total} violations across ${axeReport.length} checks` : 'axe skipped');
process.exitCode = total ? 1 : 0;
