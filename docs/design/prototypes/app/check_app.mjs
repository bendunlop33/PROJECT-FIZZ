// Click-through consistency check for the whole-app prototype (V1). Run by build_app.py after the static checks:
//   node check_app.mjs OUT_DIR
// It opens the built app headless and checks that one session reads the same on every screen: Today with and without a
// plan, the plan overview (this week), the builder (Edit, Open in builder, Build your own), the active workout and the
// Summary (name, exercises, sets, reps, kg, main-lift line, minutes, date). Any page or console error fails it too.
// Exit 0 = ok, 1 = problems (listed), 3 = Playwright not available (build_app.py reports the check as skipped).
// Playwright: PLAYWRIGHT=<path to playwright/index.mjs> and CHROMIUM=<browser executable> override the defaults.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = path.resolve(process.argv[2] ?? '.');
let chromium;
for (const m of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { ({ chromium } = await import(m.startsWith('/') ? pathToFileURL(m).href : m)); break; } catch { /* next */ }
}
if (!chromium) { console.error('Playwright not found'); process.exit(3); }
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 460, height: 920 } });
const bad = [], errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const html = fs.readFileSync(path.join(out, 'app.html'), 'utf8');
const FIXTURE = JSON.parse(/const FIXTURE = (\{.*?\});/.exec(html)[1]);
const DAYS = ['Chest', 'Back', 'Legs', 'Shoulders'];
const wait = (ms = 300) => page.waitForTimeout(ms);
const fr = async (src) => { for (let i = 0; i < 40; i++) { const f = page.frames().find((x) => { const u = new URL(x.url()); return u.pathname.endsWith('/' + src.split('#')[0]) && (u.hash || '') === (src.includes('#') ? '#' + src.split('#')[1] : ''); }); if (f && await f.evaluate(() => document.readyState === 'complete').catch(() => false)) return f; await wait(100); } throw new Error(`no frame ${src}`); };
const same = (what, a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) bad.push(`${what}:\n      ${x}\n   vs ${y}`); };
const num = (t) => { const v = parseFloat(t); return Number.isNaN(v) ? 'BW' : v; };
const reset = async (plan) => { await page.click('#reset'); await wait(150); if (plan) { await page.click('#withPlan'); await wait(400); } };

// The active workout as shown: name, minutes, each exercise (work sets, first work set kg and reps, main-lift line).
async function active() {
  const f = await fr('workout-active-v3.html'); await wait(300);
  const rounds = await f.locator('.rd').count(), ex = [];
  for (let i = 0; i < rounds; i++) {
    await f.locator('.rd').nth(i).click(); await wait(60);
    // Why?: a target always; Last time only the history the app has (the shared fixture's), never made up (rule 6).
    for (let k = 0; k < await f.locator('.ex').count(); k++) {
      await f.locator('.ex').nth(k).locator('[data-a="why"]').click(); await wait(40);
      const why = await f.evaluate(() => document.querySelector('.sheet').innerText);
      const tg = /Target\s+(.*)/.exec(why)?.[1]?.trim(), last = /Last time\s+(.*)/.exec(why)?.[1]?.trim();
      if (!tg) bad.push(`Why? with no target: ${why.split('\n')[0]}`);
      if (last && last !== FIXTURE.last) bad.push(`Why? shows a last time the app doesn't have: ${why.split('\n')[0]} · ${last}`);
      await f.locator('.sheet .ghost[data-a="close"]').click(); await wait(30);
    }
    ex.push(...await f.evaluate(() => [...document.querySelectorAll('.ex')].map((b) => {
      const rows = [...b.querySelectorAll('.tr:not(.wu)')], first = rows[0], small = b.querySelector('.exh small').textContent;
      return { name: b.querySelector('.exh .nm').firstChild.textContent, sets: rows.length, kg: first ? first.querySelector('[data-f="kg"]').value : null, reps: first ? first.querySelector('[data-f="r"]').value : null, small };
    })));
  }
  await f.locator('.rd').first().click();
  await f.locator('[data-a="sheet"]').click(); await wait(80);
  const sheet = await f.evaluate(() => ({ title: document.querySelector('.sheet h3').textContent, tops: [...document.querySelectorAll('.ovr')].map((r) => r.querySelectorAll('.c')[1].textContent) }));
  await f.locator('.sheet .ghost[data-a="close"]').click();
  const name = await f.evaluate(() => document.querySelector('.hdr .t').textContent);
  return { name, sheet, ex: ex.map((e) => ({ name: e.name, sets: e.sets, kg: num(e.kg), reps: +e.reps, ...(/^\d+ × \d+|^1 × /.test(e.small) ? { line: e.small } : {}) })) };
}
async function finish(day) {
  const f = await fr('workout-active-v3.html');
  await f.locator('[data-a="log"]').click(); await wait(60);
  await f.locator('[data-a="menu"]').click(); await f.locator('.mi', { hasText: 'Finish workout' }).click(); await wait(250);
  const s = await page.evaluate(() => ({ h1: document.querySelector('#summary h1')?.textContent, date: document.querySelector('#summary h1')?.nextElementSibling?.textContent }));
  same(`Summary for ${day}: name`, s.h1, day);
  if (!s.date?.startsWith(FIXTURE.today)) bad.push(`Summary for ${day}: date "${s.date}" is not ${FIXTURE.today}`);
  await page.click('#sumDone'); await wait(150);
}
// Today with a plan (training-blocks.html): the card's rows and its minutes.
async function todayPlan(day) {
  const f = await fr('training-blocks.html');
  await f.locator(`[data-a="dayp"][data-v="${day}"]`).click(); await wait(80);
  if (!await f.locator('.card.open').count()) { await f.locator('[data-a="toggle"]').click(); await wait(80); }
  return f.evaluate(() => ({ meta: document.querySelector('.card .meta span').textContent, ex: [...document.querySelectorAll('.exl .ex')].map((r) => {
    const c = r.querySelectorAll('.c'), small = r.querySelector('small')?.textContent ?? '';
    return { name: r.querySelector('span:nth-child(2)').firstChild.textContent, sets: +c[0].textContent, kg: c[1].firstChild.textContent, line: /^\d+ × \d+|^1 × /.test(small) ? small : null };
  }) }));
}
const cardSig = (t) => t.ex.map((e) => ({ name: e.name, sets: e.sets, kg: num(e.kg), ...(e.line ? { line: e.line } : {}) }));
const actSig = (a) => a.ex.map(({ name, sets, kg, line }) => ({ name, sets, kg, ...(line ? { line } : {}) }));
const mins = (t) => +/~(\d+) min/.exec(t)[1];

await page.goto(pathToFileURL(path.join(out, 'app.html')).href); await wait(400);
// Up next is the same session with and without a plan.
await reset(false);
same('No plan: Up next vs shared fixture', await page.evaluate(() => document.querySelector('#todayNo .card span[style*="28px"]').textContent), FIXTURE.session);
await reset(true);
same('With a plan: today vs shared fixture', await (await fr('training-blocks.html')).evaluate(() => document.querySelector('.card .big').textContent), FIXTURE.session);
// This week's days, in order, and which are done: Today's week strip (Mon 19 on), the plan overview and Library.
{ const week = await (await fr('training-blocks.html')).evaluate(() => [...document.querySelectorAll('.week .day')].slice(2).flatMap((d) => [...d.querySelectorAll('.pip.plift, .pip.pliftp')].map((x) => (x.classList.contains('plift') ? '✓ ' : '') + x.textContent)));
  await page.evaluate(() => { A.tab = 'library'; A.stack = []; show(); }); await wait(100);
  const lib = await page.evaluate(() => document.querySelector('[data-go="planview"] .sub')?.textContent);
  await page.evaluate(() => { A.stack = ['planview']; show(); }); await wait(500);
  const plan = await (await fr('plan-builder.html#view')).evaluate(() => [...document.querySelectorAll('.dcard .dtop')].map((d) => (d.querySelector('.sub').textContent.includes('✓ Done') ? '✓ ' : '') + d.querySelector('.nm').textContent.split(' · ').pop()));
  same('This week: Today strip vs plan overview', week, plan);
  same('This week: plan overview vs Library', plan.map((x) => x.replace('✓ ', '')).join(' / '), lib?.split(' · ')[0]); }
const A = {}, T = {};
for (const day of DAYS) {
  // Today with a plan → Start → Summary.
  await reset(true);
  T[day] = await todayPlan(day);
  await (await fr('training-blocks.html')).locator('[data-a="start"]').click(); await wait(400);
  A[day] = await active();
  same(`${day}: Today (plan) rows vs active workout`, cardSig(T[day]), actSig(A[day]));
  same(`${day}: active workout name`, A[day].name, day);
  same(`${day}: active minutes vs Today`, A[day].sheet.title, `${day} · about ${mins(T[day].meta)} min`);
  if (A[day].sheet.tops.some((x) => /NaN/.test(x))) bad.push(`${day}: NaN in the active overview`);
  await finish(day);
  // Your plan, this week: the same day.
  await page.evaluate(() => { A.tab = 'library'; A.stack = ['planview']; show(); }); await wait(500);
  const pv = await fr('plan-builder.html#view');
  const plan = await pv.evaluate((d) => { const i = [...document.querySelectorAll('.dcard')].findIndex((c) => c.querySelector('.dtop .nm').textContent.endsWith(d)); const c = document.querySelectorAll('.dcard')[i];
    return { i, min: c?.querySelector('.rt')?.textContent, ex: c ? [...c.querySelectorAll('[data-exw]')].map((r) => { const sp = r.querySelectorAll(':scope > span'), small = r.querySelector('small');
      return small ? { name: small.previousSibling.textContent, line: small.textContent } : { name: sp[sp.length - 3].textContent, short: sp[sp.length - 2].textContent, kg: sp[sp.length - 1].textContent }; }) : [] }; }, day);
  same(`${day}: plan overview (this week) vs Today`, plan.ex.map((e) => e.line ? { name: e.name, line: e.line } : { name: e.name, sets: +e.short.split(' × ')[0], reps: +e.short.split(' × ')[1], kg: num(e.kg) }),
    A[day].ex.map((e) => e.line ? { name: e.name, line: e.line } : { name: e.name, sets: e.sets, reps: e.reps, kg: e.kg }));
  if (!plan.min?.includes(`~${mins(T[day].meta)}′`)) bad.push(`${day}: plan overview minutes "${plan.min}" vs Today "${T[day].meta}"`);
  // No plan: the same day.
  await reset(false);
  await page.click(`[data-tnday="${day}"]`); await wait(80);
  const np = await page.evaluate(() => ({ line: document.querySelector('#tnMainLine div').textContent, meta: document.querySelector('#todayNo .card span[style*="flex-end"] span').textContent }));
  same(`${day}: Today (no plan) count and minutes vs Today (plan)`, np.meta, T[day].meta);
  await page.click('#tnStart'); await wait(400);
  const an = await active();
  same(`${day}: no-plan active workout vs plan`, an, A[day]);
  same(`${day}: no-plan Today main line vs active`, np.line, an.ex[0].line);
  await finish(day);
}
same('Chest main lift line vs shared fixture', A.Chest.ex[0].line, FIXTURE.mainLine);
same('Chest main lift name vs shared fixture', A.Chest.ex[0].name, FIXTURE.main);

// Builder: Edit (Today with a plan), Open in builder (plan), Build your own (no plan) — Start opens the same Chest.
await reset(true);
await (await fr('training-blocks.html')).locator('[data-a="edit"]').click(); await wait(500);
let bf = await fr('workout-builder-v3.html#draft');
same('Edit → builder title', await bf.evaluate(() => document.querySelector('h2').textContent), `Chest · about ${mins(T.Chest.meta)} min`);
await bf.locator('[data-a="start"]').click(); await wait(400);
same('Edit → builder → Start vs Today Start', await active(), A.Chest);
await reset(true);
await page.evaluate(() => { A.tab = 'library'; A.stack = ['planview']; show(); }); await wait(500);
{ const pv = await fr('plan-builder.html#view'); const i = await pv.evaluate(() => [...document.querySelectorAll('.dcard')].findIndex((c) => c.querySelector('.dtop .nm').textContent.endsWith('Chest')));
  await pv.locator(`[data-toggle="${i}"]`).first().click(); await wait(80); await pv.locator(`[data-open="${i}"]`).click(); await wait(500); }
bf = await fr('workout-builder-v3.html#draft');
same('Plan › Open in builder title', await bf.evaluate(() => document.querySelector('h2').textContent), `Chest · about ${mins(T.Chest.meta)} min`);
await bf.locator('[data-a="start"]').click(); await wait(400);
same('Plan › Open in builder → Start vs Today Start', await active(), A.Chest);
// Build your own opens on the shared session (Chest). Other days fill the length by the builder's own time model, so
// they can hold more exercises than Today's template (open: one time model for the app).
for (const day of [FIXTURE.session]) {
  await reset(false);
  await page.click('#tnBuild'); await wait(500);
  bf = await fr('workout-builder-v3.html');
  if (day !== FIXTURE.session) { await bf.locator('[data-a="sheet-day"]').click(); await bf.locator(`[data-a="day"][data-v="${day}"]`).click(); await wait(80); }
  await bf.locator('[data-a="build"]').click(); await wait(200);
  await bf.locator('[data-a="start"]').click(); await wait(400);
  const a = await active(); same(`Build your own (${day}) → Start vs Today Start: exercises`, a.ex, A[day].ex); same(`Build your own (${day}) name`, a.name, day);
}

// A bodyweight main lift reads the same on Today and in the workout.
await reset(false);
await page.click('[data-tnday="Back"]'); await wait(60); await page.click('[data-tn="main"][data-v="Pull-up"]'); await wait(60);
{ const line = await page.evaluate(() => document.querySelector('#tnMainLine div').textContent);
  await page.click('#tnStart'); await wait(400); const a = await active();
  same('Bodyweight main lift: Today vs active', line, a.ex[0].line);
  if (a.sheet.tops.some((x) => /NaN/.test(x))) bad.push('Bodyweight main lift: NaN in the active overview'); }

await browser.close();
for (const e of errors) bad.push(`page error: ${e}`);
if (bad.length) { console.error(`CLICK-THROUGH CHECK FAILED: ${bad.length} problem(s)\n  ` + bad.join('\n  ')); process.exit(1); }
console.log('click-through check: ok');
