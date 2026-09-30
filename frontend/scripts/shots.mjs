// Screenshots + axe check of a RUNNING dev setup. Starts nothing itself:
//   (cd ../api && npm run dev:local) & npm run dev & npm run shots
// Writes PNGs to scripts/shots/ and prints axe violations. BASE_URL overrides http://localhost:5173.

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
await mkdir(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FLIP_MS = 2600; // longest flip on a full board, plus margin

const browser = await chromium.launch();
const axeReport = [];
let failures = 0;

async function open(viewport, path = '/') {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`  page error: ${e.message}`));
  await page.goto(BASE + path);
  await page.locator('tr.row:visible').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(FLIP_MS);
  return { context, page };
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true, ...opts });
  console.log(`  ${name}.png`);
}

async function axe(page, label) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  axeReport.push({ label, violations });
}

/** The next weekday date after today (college time) with the given ISO weekday. */
function nextWeekday(dow) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while ((d.getUTCDay() || 7) !== dow);
  return d.toISOString().slice(0, 10);
}

async function postpone(page, { date, hour } = {}) {
  const control = page.locator('#view-control');
  await control.getByRole('button', { name: 'POSTPONE', exact: true }).click();
  if (date) await control.locator('input[type=date]').fill(date);
  if (hour) await control.locator('select').selectOption(String(hour));
  await control.locator('.room').first().waitFor({ timeout: 10000 });
  await control.locator('.room').first().click();
  await control.getByRole('button', { name: 'CONFIRM POSTPONE' }).click();
}

async function selectUnchanged(page) {
  await page.locator('#view-control tr.row.is-on .pick-input').first().check();
}

try {
  console.log('desktop 1440x900');
  {
    const { context, page } = await open(DESKTOP);
    await shot(page, '01-desktop-initial');
    await axe(page, 'desktop /');

    await postpone(page);
    await page.locator('#view-control .outcome.is-ok').waitFor({ timeout: 10000 });
    await page.waitForTimeout(FLIP_MS);
    await shot(page, '02-desktop-postponed');

    // Prof. Meera teaches CS207 on Thursday 10:00, so moving another class there is a professor clash.
    await selectUnchanged(page);
    await postpone(page, { date: nextWeekday(4), hour: 10 });
    await page.locator('.conflict').waitFor({ timeout: 10000 });
    await page.locator('.conflict').scrollIntoViewIfNeeded();
    await shot(page, '03-desktop-conflict', { fullPage: false });
    await axe(page, 'desktop / with 409 panel');

    await page.getByRole('button', { name: /RUN RACE/ }).click();
    await page.locator('.race-result').waitFor({ timeout: 15000 });
    await page.waitForTimeout(FLIP_MS);
    await page.locator('.race').scrollIntoViewIfNeeded();
    await shot(page, '04-desktop-race', { fullPage: false });
    await shot(page, '04b-desktop-race-full');
    await context.close();
  }

  console.log('phone 390x844');
  {
    const { context, page } = await open(PHONE);
    await shot(page, '05-phone-platform');
    await axe(page, 'phone /');
    await page.getByRole('button', { name: 'CONTROL ROOM' }).click();
    await page.waitForTimeout(600);
    await shot(page, '06-phone-control');
    await postpone(page);
    await page.locator('#view-control .outcome.is-ok').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /^PLATFORM/ }).click();
    await page.waitForTimeout(FLIP_MS);
    await shot(page, '07-phone-platform-after-postpone');
    await context.close();
  }

  console.log('embed');
  for (const [name, viewport] of [['08-embed-desktop', { width: 1200, height: 800 }], ['09-embed-phone', PHONE]]) {
    const { context, page } = await open(viewport, '/embed');
    await shot(page, name);
    await axe(page, `${name} /embed`);
    await context.close();
  }
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await browser.close();
}

console.log('\naxe');
for (const { label, violations } of axeReport) {
  console.log(`  ${label}: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.log(`    [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
  }
}
process.exit(failures ? 1 : 0);
