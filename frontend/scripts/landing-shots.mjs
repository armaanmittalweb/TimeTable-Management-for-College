// The screenshots on the front page's "How it works". Start the mock app first:
//   VITE_API=mock npm run dev      (then, in another shell)   npm run landing-shots
// For each step of each role it writes public/landing/<step>.desktop.webp (1440x900 shot, 1200px wide) and
// <step>.phone.webp (390x844 at 2x, 600px wide), light theme, clock pinned like scripts/shots.mjs.
// Env: BASE_URL (default http://localhost:5173), ONLY=<regex of step names>.

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = fileURLToPath(new URL('../public/landing/', import.meta.url));
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const NOW = new Date('2026-09-30T11:20:00+05:30');
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
import sharp from 'sharp';
await mkdir(OUT, { recursive: true });

const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function startDemo(page, phone) {
  await page.goto(`${BASE}/demo`);
  await page.waitForURL(/\/w\/demo-/);
  await page.locator('.blk, .dayl, .today-empty').first().waitFor();
  await settle(page);
}
async function signIn(page) {
  await page.goto(`${BASE}/signin`);
  await page.fill('#email', 'priya.menon@riverside.edu');
  await page.fill('#password', 'timetable-demo');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/w\//);
  await settle(page);
}
/** As Meera Iyer in the demo, with Friday's CS201 open in Reschedule. */
async function rescheduling(page, phone) {
  await startDemo(page);
  await page.selectOption('.demobar-select', { label: 'Meera Iyer' });
  await page.locator('.toast').first().waitFor();
  await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  if (phone) await page.goto(page.url().replace(/\/(week|today)$/, '') + '/week');
  await page.locator('.blk[aria-label^="CS201"][aria-label*="Friday"]').first().click();
  await settle(page, 200);
  await page.getByRole('button', { name: 'Reschedule' }).click();
  await page.locator('.slot.is-free').first().waitFor();
  await settle(page);
}
async function picked(page, phone) {
  await rescheduling(page, phone);
  await page.locator('.slot.is-free[data-slot^="2026-10-01"]').first().click();
  await settle(page, 300);
  const reason = page.getByPlaceholder('Reason students will see (optional)');
  if (await reason.count()) await reason.fill('Lab exam on Friday');
  await settle(page, 200);
}

const STEPS = {
  async 'coord-1'(page) {
    await signIn(page);
    await page.goto(`${BASE}/w/riverside-cs/setup/rooms`);
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.fill('#csv-text', 'name,capacity,building,kind\nCR-204,60,Main Block,lecture\nCR-205,sixty,Main Block,lecture\nLAB-303,40,Tech Block,workshop\n,30,,lecture');
    await page.getByRole('button', { name: 'Check the file' }).click();
    await page.locator('.report').waitFor();
    await settle(page, 250);
  },
  async 'coord-2'(page) {
    await signIn(page);
    await page.goto(`${BASE}/w/riverside-cs/setup/timetable`);
    await page.locator('.setup-body').waitFor();
    await settle(page, 500);
  },
  async 'coord-3'(page) {
    await signIn(page);
    await page.goto(`${BASE}/w/riverside-cs/setup/codes`);
    await page.locator('.setup-body').waitFor();
    await settle(page, 400);
  },
  async 'teacher-1'(page, phone) { await rescheduling(page, phone); },
  async 'teacher-2'(page, phone) { await picked(page, phone); },
  async 'teacher-3'(page, phone) {
    await picked(page, phone);
    const slot = await page.locator('.slot.is-picked').getAttribute('data-slot');
    const roomName = (await page.locator('#move-room option:checked').textContent()).split(' ·')[0];
    await page.evaluate(({ slot, roomName }) => {
      // Another coordinator moves ECE-2A's Friday class into the same room at the same time, a moment earlier.
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
  },
  async 'student-1'(page) {
    await page.goto(`${BASE}/join/cse2a-k7qd`);
    await page.getByRole('button', { name: 'Follow this batch' }).waitFor();
    await settle(page);
  },
  async 'student-2'(page) {
    await page.goto(`${BASE}/join/cse2a-k7qd`);
    await page.getByRole('button', { name: 'Follow this batch' }).click();
    await page.waitForURL(/\/b\//);
    await page.locator('.blk, .dayl, .today-empty').first().waitFor();
    await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
    await settle(page);
  },
  async 'student-3'(page) {
    await page.goto(`${BASE}/b/CSE2A-K7QD/week`);
    await page.locator('.blk').first().waitFor();
    await page.getByRole('button', { name: 'Add to calendar' }).click();
    await page.getByRole('dialog').waitFor();
    await settle(page, 400);
  },
};

const browser = await chromium.launch();
let failed = 0;
for (const [name, run] of Object.entries(STEPS)) {
  if (ONLY && !ONLY.test(name)) continue;
  for (const size of ['desktop', 'phone']) {
    const phone = size === 'phone';
    const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(NOW);
    try {
      await run(page, phone);
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot();
      await sharp(png).resize({ width: phone ? 600 : 1200 }).webp({ quality: 80 }).toFile(`${OUT}${name}.${size}.webp`);
      console.log(`ok   ${name} ${size}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name} ${size}: ${e.message.split('\n')[0]}`);
      await page.screenshot({ path: fileURLToPath(new URL(`../shots/FAILED-landing-${name}-${size}.png`, import.meta.url)) }).catch(() => undefined);
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();
process.exitCode = failed ? 1 : 0;
