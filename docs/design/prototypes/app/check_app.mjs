// Click-through consistency check for the whole-app prototype (V1). Run by build_app.py after the static checks:
//   node check_app.mjs OUT_DIR
// It opens the built app headless and checks that one session reads the same on every screen: Today with and without a
// plan, the plan overview (this week), the builder (Edit, Open in builder, Build your own), the active workout and the
// Summary (name, exercises, sets, reps, kg, main-lift line, minutes, date). Any page or console error fails it too.
// Ben's decisions of 22 and 23 Oct are checked as well: Start always just starts and the Summary asks Keep for next time?
// only for Ben's own structure changes, never the fit's cuts, pairing, the deload or the coach (D1; review B1); weekly-
// review stall resets and unasked sets are offers, and a coach offer goes stale when its exercise changes (D2, rule 5);
// Today with a plan is lean, its other controls are on Your workout, and edits made there stay when Ben goes back
// (D3); back-offs: the shared rule for every focus and kit step, never the top (D4; review B2), in the plan's focus
// band (S7), Strength and Muscle with a dumbbell main lift; the builder picks by broad groups and a named part is the
// one added (D5); a stale lift confirmed Still right starts at full weight (D6); plan setup, one back control, Profile
// opening Your plan, Any days (D7); the fit never loses less training for less time (D9; review S2).
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

// D4 (review B2): the shared back-off rule, tested on its own for every focus band, kit step and top-set reps. A back-off
// is a real load below the top; inside the band when a real load is there, else the real load nearest the band.
const BAND = { Strength: [0.02, 0.08], Balanced: [0.04, 0.1], Muscle: [0.08, 0.15] };
function backOffWrong(top, back, focus, step) {
  if (typeof back !== 'number' || !(back < top - 1e-9)) return `${back} is not below the top ${top}`;
  if (Math.abs(back / step - Math.round(back / step)) > 1e-6) return `${back} is not a real load (${step} kg steps)`;
  const [lo, hi] = BAND[focus], L = top * (1 - hi), U = top * (1 - lo), grid = [];
  for (let k = Math.ceil(L / step - 1e-9); k * step <= U + 1e-9; k++) if (k > 0 && k * step < top - 1e-9) grid.push(k * step);
  if (grid.length) return back >= L - 1e-9 && back <= U + 1e-9 ? null : `${back} is outside ${focus}'s band below ${top} though ${grid.join(', ')} is inside`;
  const cands = [Math.floor(L / step + 1e-9) * step, Math.ceil(U / step - 1e-9) * step].filter((kg) => kg > 0 && kg < top - 1e-9);
  const off = (kg) => (kg < L ? L - kg : kg - U), best = Math.min(...cands.map(off));
  return cands.some((kg) => Math.abs(kg - back) < 1e-9) && off(back) <= best + 1e-9 ? null : `${back} is not the real load nearest ${focus}'s band below ${top}`;
}
{ const src = /\/\/ BACKOFF-START[\s\S]*?\/\/ BACKOFF-END/.exec(html)?.[0];
  if (!src) bad.push('app.html: no shared back-off code (// BACKOFF-START … // BACKOFF-END)');
  else {
    const { backOff, lowerBackOff } = new Function(`${src}\nreturn { backOff, lowerBackOff };`)(); let n = 0;
    for (const focus of Object.keys(BAND)) for (const step of [1, 1.25, 2, 2.5, 5]) for (const topReps of [5, 6, 7, 8]) for (let k = 3; k * step <= 250; k++) {
      const why = backOffWrong(k * step, backOff(k * step, topReps, 8, focus, step), focus, step);
      if (why && n++ < 8) bad.push(`backOff(${k * step}, ${topReps}, 8, ${focus}, ${step}): ${why} (D4, review B2)`);
    }
    // The fixture and the examples in the specs.
    same('backOff 102.5 × 6, Balanced', backOff(102.5, 6, 8), 95);
    same('backOff 26 × 6 each, Muscle, 2 kg dumbbells (nearest the band)', backOff(26, 6, 8, 'Muscle', 2), 24);
    same('backOff 24 × 7 each, Strength, 2 kg dumbbells (never the top)', backOff(24, 7, 8, 'Strength', 2), 22);
    // A lowered top lowers its back-offs by the same % (SS4, HT8): bench held at 100 → 92.5; a deload's −10 % → 87.5.
    same('lowerBackOff(95, 100 / 102.5, 100)', lowerBackOff(95, 100 / 102.5, 100), 92.5);
    same('lowerBackOff(97.5, 0.9, 92.5)', lowerBackOff(97.5, 0.9, 92.5), 87.5);
  } }
// Today with a plan: its card's rows (name, sets), its Time, and Your workout's rows.
const cardRows = (tb) => tb.evaluate(() => [...document.querySelectorAll('.card .exl .ex')].map((r) => ({ name: r.querySelector('span:nth-child(2)').firstChild.textContent, sets: +r.querySelectorAll('.c')[0].textContent })));
const toMin = async (tb, m) => { for (let i = 0; i < 30; i++) { const now = parseInt(await tb.evaluate(() => document.querySelector('.card .tv').textContent), 10); if (now === m) return; await tb.locator(`.card [data-a="min"][data-v="${now > m ? -5 : 5}"]`).click(); await wait(40); } };
const builderRows = (b) => b.evaluate(() => [...document.querySelectorAll('.er')].map((r) => ({ name: r.querySelector('.nm').firstChild.textContent, sets: parseInt(r.querySelector('.sets').firstChild.textContent, 10) })));
// Your workout opens an exercise's sheet on pointerdown + pointerup, not on click, so a synthetic DOM click() never opens
// it (review R3). Tap the row whose name matches exactly with a real pointer click; returns whether its sheet opened.
async function tapRow(b, name) {
  const i = await b.evaluate((n) => [...document.querySelectorAll('.er')].findIndex((x) => x.querySelector('.nm').firstChild.textContent === n), name);
  if (i < 0) return false;
  await b.locator('.er').nth(i).click(); await wait(150);
  return (await b.locator('.sheet').count()) > 0;
}
// Your workout: open an exercise and add sets until it has n (＋ Set), then Done.
async function addSetsTo(b, name, n) {
  await tapRow(b, name);
  for (let i = 0; i < 6; i++) { const r = (await builderRows(b)).find((x) => x.name === name); if (!r || r.sets >= n) break; await b.locator('.sheet [data-a="sets"][data-v="1"]').click(); await wait(60); }
  await b.locator('.sheet .pill[data-a="close"]').click(); await wait(100);
}

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
// keep = null: the Summary must not ask Keep for next time? (no structure change of Ben's, D1); a string: the text it
// must list; an array: exactly these change lines (review B1).
async function finish(day, keep = null, what = day) {
  const f = await fr('workout-active-v3.html');
  await f.locator('[data-a="log"]').click(); await wait(60);
  await f.locator('[data-a="menu"]').click(); await f.locator('.mi', { hasText: 'Finish workout' }).click(); await wait(250);
  const s = await page.evaluate(() => ({ h1: document.querySelector('#summary h1')?.textContent, date: document.querySelector('#summary h1')?.nextElementSibling?.textContent, keep: document.querySelector('#keep')?.innerText ?? null, lines: [...document.querySelectorAll('#keep .sub')].map((x) => x.textContent) }));
  same(`Summary for ${what}: name`, s.h1, day);
  if (!s.date?.startsWith(FIXTURE.today)) bad.push(`Summary for ${what}: date "${s.date}" is not ${FIXTURE.today}`);
  if (keep === null && s.keep) bad.push(`Summary for ${what}: asks Keep for next time? with no structure change of Ben's (D1): ${s.keep.replace(/\n/g, ' · ')}`);
  if (Array.isArray(keep)) same(`Summary for ${what}: Keep for next time? lines (D1, review B1)`, s.lines, keep);
  if (keep !== null) {
    if (!s.keep?.includes('Keep for next time?') || !(Array.isArray(keep) ? keep.every((k) => s.keep.includes(k)) : s.keep.includes(keep))) bad.push(`Summary for ${what}: Keep for next time? should list ${JSON.stringify(keep)} (D1), got ${JSON.stringify(s.keep)}`);
    else {
      await page.click('#keepApply'); await wait(80);
      if (!(await page.evaluate(() => document.querySelector('#keep')?.innerText ?? '')).includes('Kept for next')) bad.push(`Summary for ${day}: Apply on Keep for next time? didn't keep it (D1)`);
      await page.click('#keepUndo'); await wait(80);
      if (!await page.locator('#keepApply').count()) bad.push(`Summary for ${day}: Undo on Keep for next time? didn't bring the offer back (D1)`);
    }
  }
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
// D7: no chip row under the no-plan card (Full body, Upper, Push, Empty workout are in ⋯).
if (await page.locator('[data-tnother]').count()) bad.push('No-plan Today still has the chip row under the card (D7)');
await reset(true);
same('With a plan: today vs shared fixture', await (await fr('training-blocks.html')).evaluate(() => document.querySelector('.card .big').textContent), FIXTURE.session);
// D3: Today with a plan is lean: the session rows, Start, Time (with its fit note) and Edit. No main lift, accessories,
// abs or supersets controls, no Today only tag, no Start prompt.
{ const lean = await (await fr('training-blocks.html')).evaluate(() => ({ ctl: document.querySelectorAll('[data-a="main"], [data-a="style"], [data-a="abs"], [data-a="ss"], .todayonly, .startask').length, time: !!document.querySelector('.card [data-a="min"]'), start: !!document.querySelector('.card [data-a="start"]'), edit: !!document.querySelector('.card [data-a="edit"]'), rows: document.querySelectorAll('.card.open .exl .ex').length }));
  if (lean.ctl) bad.push('Today with a plan still shows today-only controls, the Today only tag or the Start prompt (D3, D1)');
  if (!lean.time || !lean.start || !lean.edit || !lean.rows) bad.push(`Today with a plan needs its rows, Time, Start and Edit (D3): ${JSON.stringify(lean)}`); }
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
  // D4: back-offs come from their reps and effort, under the top and inside Balanced's 4–10 % band.
  { const m = /· ([\d.]+) \/ ([\d.]+)/.exec(A[day].ex[0].line ?? '');
    if (m) { const top = +m[1], back = +m[2], d = (top - back) / top;
      if (back > top || d < 0.04 - 1e-9 || d > 0.1 + 1e-9) bad.push(`${day}: back-off ${back} is not 4–10 % under the top set ${top} (D4)`); } }
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

// D1/D9: a Time change alone never asks anything: Start starts, and the Summary has no Keep for next time?.
await reset(true);
{ const tb = await fr('training-blocks.html');
  for (let i = 0; i < 3; i++) { await tb.locator('.card [data-a="min"][data-v="-5"]').click(); await wait(60); }
  await tb.locator('.card [data-a="start"]').click(); await wait(400);
  if (await page.evaluate(() => A.stack.at(-1)) !== 'active') bad.push('Today: Start after a Time change did not start the workout (D1)');
  else await finish('Chest'); }

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
  // D5: Set up picks by the broad groups (Chest, Back, Shoulders, Legs, Arms, Core).
  { const picks = await bf.evaluate(() => [...document.querySelectorAll('[data-a="grp"][data-v="1"]')].map((b) => b.dataset.g));
    if (!picks.length || picks.some((g) => !['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core'].includes(g))) bad.push(`Builder Set up should pick broad groups (D5): ${picks}`); }
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

// D3 + D1: Your workout from Today's Edit has main lift, accessories, abs and supersets. Abs off there changes the
// workout's structure, so the Summary asks Keep for next time? once, listing it; Apply keeps it and Undo brings it back.
await reset(true);
await (await fr('training-blocks.html')).locator('[data-a="edit"]').click(); await wait(500);
bf = await fr('workout-builder-v3.html#draft');
{ const ctl = await bf.evaluate(() => [...document.querySelectorAll('[data-a="tmain"], [data-a="tstyle"], [data-a="tabs"], [data-a="tss"]')].map((b) => b.dataset.a));
  for (const k of ['tmain', 'tstyle', 'tabs', 'tss']) if (!ctl.includes(k)) bad.push(`Your workout from Edit: no ${k} control (D3)`);
  if (ctl.includes('tabs')) {
    await bf.locator('[data-a="tabs"]').click(); await wait(150);
    if (await bf.evaluate(() => [...document.querySelectorAll('.er .nm')].some((n) => n.textContent.startsWith('Cable crunch')))) bad.push('Your workout: Abs off kept Cable crunch (D3)');
    await bf.locator('[data-a="start"]').click(); await wait(400);
    await finish('Chest', 'Cable crunch');
  } }

// Review B1: Keep for next time? lists only Ben's own changes, measured against the plan day's template: never the fit's
// cuts or what it gives back, pairing, the coach's applied offer or the deload. His control choices count.
for (const [min, a, v, keep] of [[45, 'tss', null, null], [40, 'tabs', null, ['− Cable crunch']], [35, 'tabs', null, ['− Cable crunch']],
  [40, 'tstyle', 'Varied', ['− Cable fly', '+ Cable crossover · 2 sets', '+ Dips · 2 sets', 'Incline dumbbell press 3 → 2 sets']]]) {
  await reset(true);
  const tb = await fr('training-blocks.html'); await toMin(tb, min);
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  const b = await fr('workout-builder-v3.html#draft');
  await b.locator(`[data-a="${a}"]${v ? `[data-v="${v}"]` : ''}`).click(); await wait(150);
  await b.locator('[data-a="start"]').click(); await wait(400);
  await finish('Chest', keep, `Chest at ${min} min, ${a}${v ? ` ${v}` : ''} on Your workout`);
}
// (a) The coach's offer applied on Today, then Ben puts Cable fly back to the plan's 3 sets: nothing to keep. Apply does
// exactly what its line says, and nothing else (rule 2, rule 5).
await reset(true);
{ const tb = await fr('training-blocks.html');
  await tb.evaluate(() => document.querySelector('[data-a="revoff"]').click()); await wait(100);
  if (!await tb.locator('[data-a="rApply"]').count()) bad.push('Today: no coach offer line with the review offer on (D2)');
  else {
    const before = await cardRows(tb);
    await tb.locator('[data-a="rApply"]').click(); await wait(100);
    same('Today: the coach offer\'s Apply changes only Cable fly 3 → 2 (rule 2)', await cardRows(tb), before.map((r) => (r.name === 'Cable fly' ? { ...r, sets: 2 } : r)));
    await tb.evaluate(() => document.querySelector('.card [data-a="edit"]').click()); await wait(500); // under the Undo toast
    const b = await fr('workout-builder-v3.html#draft');
    await addSetsTo(b, 'Cable fly', 3);
    await b.locator('[data-a="start"]').click(); await wait(400);
    await finish('Chest', null, 'Chest after the coach offer, Cable fly back to 3 on Your workout');
  } }
// (b) A deload week: Cable fly back to the template's own 3 sets is not a change.
await reset(true);
{ const tb = await fr('training-blocks.html');
  await tb.evaluate(() => document.querySelector('[data-a="st"][data-v="deload"]').click()); await wait(150);
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  const b = await fr('workout-builder-v3.html#draft');
  await addSetsTo(b, 'Cable fly', 3);
  await b.locator('[data-a="start"]').click(); await wait(400);
  await finish('Chest', null, 'Chest in a deload week, Cable fly back to 3 on Your workout');
}
// D2 + rule 5: the offer reads against the workout as shown. Ben's edit withdraws it on Your workout and on Today; the
// edit itself stays on Today's card (D3).
await reset(true);
{ const tb = await fr('training-blocks.html');
  await tb.evaluate(() => document.querySelector('[data-a="revoff"]').click()); await wait(100);
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  const b = await fr('workout-builder-v3.html#draft');
  if (!await b.locator('.offer [data-a="oapply"]').count()) bad.push('Your workout from Edit: no coach offer line (D2)');
  await addSetsTo(b, 'Cable fly', 4);
  if (await b.locator('.offer [data-a="oapply"]').count()) bad.push('Your workout: the coach offer still shows after Ben set Cable fly to 4 (rule 5)');
  await page.click('#backBtn'); await wait(400);
  if (await tb.locator('[data-a="rApply"]').count()) bad.push('Today: the coach offer still shows after Ben set Cable fly to 4 on Your workout (rule 5)');
  const fly = (await cardRows(tb)).find((r) => r.name === 'Cable fly');
  if (fly?.sets !== 4) bad.push(`Today: Cable fly has ${fly?.sets} sets after Ben set 4 on Your workout (D3: his edits stay)`); }
// … and when the fit changes that exercise: at 30 min Cable fly is cut to 2, so neither screen offers 3 → 2. At 35 min it
// is kept at 3 (the fit drops Triceps pushdown and pairs Cable fly with Cable crunch), and Apply changes only it.
await reset(true);
{ const tb = await fr('training-blocks.html');
  await tb.evaluate(() => document.querySelector('[data-a="revoff"]').click()); await wait(100);
  await toMin(tb, 35);
  const rows35 = await cardRows(tb);
  same('Today at 35 min (Chest): the fit drops Triceps pushdown only (D9, review S2)', rows35.map((r) => r.name), ['Barbell bench press', 'Incline dumbbell press', 'Cable fly', 'Cable crunch']);
  if (!await tb.locator('[data-a="rApply"]').count()) bad.push('Today at 35 min: no coach offer though Cable fly still has 3 sets (D2)');
  else { await tb.locator('[data-a="rApply"]').click(); await wait(100);
    same('Today at 35 min: the coach offer\'s Apply changes only Cable fly (rule 2)', await cardRows(tb), rows35.map((r) => (r.name === 'Cable fly' ? { ...r, sets: 2 } : r))); }
  await tb.locator('[data-a="uRev"]').click().catch(() => {}); await wait(100);
  await tb.evaluate(() => { const s = document.querySelector('[data-a="revoff"]'); if (s.getAttribute('aria-pressed') !== 'true') s.click(); }); await wait(60);
  await toMin(tb, 30);
  if ((await cardRows(tb)).find((r) => r.name === 'Cable fly')?.sets === 3) bad.push('Today at 30 min: Cable fly still has 3 sets (fit check)');
  if (await tb.locator('[data-a="rApply"]').count()) bad.push('Today at 30 min: the coach offer shows though the fit changed Cable fly (rule 5)');
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  const b = await fr('workout-builder-v3.html#draft');
  if (await b.locator('.offer [data-a="oapply"]').count()) bad.push('Your workout at 30 min: the coach offer shows though the fit changed Cable fly (rule 5)'); }
// D3 (review): Your workout's choices and edits stay on Today's draft when Ben goes back; Edit reopens them; Start
// starts them; the Summary offers what he changed.
await reset(true);
{ const tb = await fr('training-blocks.html');
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  let b = await fr('workout-builder-v3.html#draft');
  await b.locator('[data-a="tabs"]').click(); await wait(200);
  await page.click('#backBtn'); await wait(400);
  if ((await cardRows(tb)).some((r) => r.name === 'Cable crunch')) bad.push('Today: Abs off on Your workout was lost going back to Today (D3)');
  if (!(await tb.evaluate(() => document.querySelector('.card .meta').innerText)).includes('Edited')) bad.push('Today: the edited draft doesn\'t say Edited');
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  b = await fr('workout-builder-v3.html#draft');
  if (await b.evaluate(() => document.querySelector('[data-a="tabs"]')?.getAttribute('aria-checked')) !== 'false') bad.push('Your workout: Abs is on again after going back to Today (D3)');
  await page.click('#backBtn'); await wait(400);
  await tb.locator('.card [data-a="start"]').click(); await wait(400);
  if ((await active()).ex.some((e) => e.name === 'Cable crunch')) bad.push('Start from Today after Abs off on Your workout still has Cable crunch (D3)');
  await finish('Chest', ['− Cable crunch'], 'Chest, Abs off on Your workout, started from Today');
}
// Review R1 (re-review 1): Add, sheet Swap, swipe Swap, the coach chat's swap and a review suggestion (Add or Swap) on Your
// workout opened from Today's Edit and from a plan day's Open in builder ›: no page error, the change on Today's card
// marked Edited (from Edit), and Keep for next time? on the Summary lists it.
async function openDraft(from) {
  await reset(true);
  if (from === 'Edit') await (await fr('training-blocks.html')).locator('.card [data-a="edit"]').click();
  else {
    await page.evaluate(() => { A.tab = 'library'; A.stack = ['planview']; show(); }); await wait(500);
    const pv = await fr('plan-builder.html#view'); const i = await pv.evaluate(() => [...document.querySelectorAll('.dcard')].findIndex((c) => c.querySelector('.dtop .nm').textContent.endsWith('Chest')));
    await pv.locator(`[data-toggle="${i}"]`).first().click(); await wait(80); await pv.locator(`[data-open="${i}"]`).click();
  }
  await wait(500); return fr('workout-builder-v3.html#draft');
}
const rowEl = (name) => [...document.querySelectorAll('.er')].find((x) => x.querySelector('.nm').firstChild.textContent === name);
const EDIT_ACTS = {
  'Add': async (b) => { await b.locator('[data-a="sheet-pick"]').click(); await wait(100);
    await b.evaluate(() => (document.querySelector('.sheet [data-a="pick"][data-v="Machine chest press"]') ?? document.querySelector('.sheet [data-a="pick"]')).click()); },
  'sheet Swap': async (b) => { if (!(await tapRow(b, 'Cable fly'))) return 'tapping Cable fly didn\'t open its sheet';
    if (!(await b.locator('.sheet [data-a="to-swap"]').count())) return 'no Swap on Cable fly\'s sheet';
    await b.locator('.sheet [data-a="to-swap"]').click(); await wait(100);
    await b.evaluate(() => document.querySelector('.sheet [data-a="swap"]').click()); },
  'swipe Swap': async (b) => { await b.evaluate(`(${rowEl})('Cable fly').parentElement.querySelector('[data-a="qswap"]').click()`); await wait(100);
    await b.evaluate(() => document.querySelector('.sheet [data-a="swap"]').click()); },
  'chat swap': async (b) => { await b.evaluate(() => document.querySelector('[data-a="chat"]').click()); await wait(100);
    await b.evaluate(() => document.querySelector('.sheet [data-a="chip"][data-v="Swap cable fly"]').click()); await wait(150);
    const ok = await b.evaluate(() => { const x = [...document.querySelectorAll('.sheet [data-a="papply"]')].at(-1); x?.click(); return !!x; }); await wait(100);
    await b.evaluate(() => document.querySelector('.scrim')?.click()); return ok ? null : 'no Apply on the chat\'s swap'; },
  'review suggestion': async (b) => { await b.locator('[data-a="review"]').click(); await wait(150);
    const ok = await b.evaluate(() => { const g = [...document.querySelectorAll('.sheet .sug')].find((x) => /^(Swap|Add) /.test(x.firstElementChild.textContent)); g?.querySelector('[data-a="sy"]').click(); return !!g; }); await wait(100);
    await b.evaluate(() => document.querySelector('.scrim')?.click()); return ok ? null : 'no Add or Swap suggestion'; },
};
for (const from of ['Edit', 'Open in builder']) for (const [what, act] of Object.entries(EDIT_ACTS)) {
  const label = `Your workout from ${from}, ${what}`;
  const b = await openDraft(from), e0 = errors.length;
  const before = (await builderRows(b)).map((r) => r.name);
  const why = await act(b).catch((err) => `threw: ${String(err.message ?? err).split('\n')[0]}`); await wait(200);
  // Review S6: a failing case closes any sheet it left open, so the failure names this case, not a later wait.
  const closeSheet = () => b.evaluate(() => document.querySelector('.scrim')?.click()).then(() => wait(100));
  if (errors.length > e0) { bad.push(`${label}: page error "${errors[e0]}" (review R1)`); await closeSheet(); continue; }
  if (why) { bad.push(`${label}: ${why} (review R1)`); await closeSheet(); continue; }
  const after = await builderRows(b), names = after.map((x) => x.name);
  const gone = before.filter((n) => !names.includes(n)), added = after.filter((x) => !before.includes(x.name));
  if (added.length !== 1 || gone.length > 1) { bad.push(`${label}: expected one exercise in (and at most one out), got in ${JSON.stringify(added.map((x) => x.name))}, out ${JSON.stringify(gone)} (review R1)`); continue; }
  const line = gone.length ? `${gone[0]} → ${added[0].name}` : `+ ${added[0].name} · ${added[0].sets} sets`;
  if (from === 'Edit') {
    await page.click('#backBtn'); await wait(400);
    const tb = await fr('training-blocks.html'), rows = (await cardRows(tb)).map((x) => x.name);
    if (!rows.includes(added[0].name) || gone.some((n) => rows.includes(n))) bad.push(`${label}: Today's card doesn't show "${line}": ${rows.join(', ')} (review R1, D3)`);
    if (!(await tb.evaluate(() => document.querySelector('.card .meta').innerText)).includes('Edited')) bad.push(`${label}: Today's card doesn't say Edited (review R1)`);
    await tb.locator('.card [data-a="start"]').click();
  } else await b.locator('[data-a="start"]').click();
  await wait(400);
  await finish('Chest', [line], label);
}
// Review R2: the shared edits code on its own. At Time 40 the fit trims Triceps pushdown 3 → 2; Ben swaps it. Today's
// draft has 2 sets of the new exercise, the template keeps 3 (Time never asks, D1), and a count Ben sets himself is his
// and is shown on the swap line.
{ const here = path.dirname(new URL(import.meta.url).pathname);
  const src = [path.join(out, 'training-blocks.html'), path.join(here, '..', 'training-blocks.html')].filter((p) => fs.existsSync(p)).map((p) => /\/\/ EDITS-START[\s\S]*?\/\/ EDITS-END/.exec(fs.readFileSync(p, 'utf8'))?.[0]).find(Boolean);
  if (!src) bad.push('training-blocks.html: no shared edits code (// EDITS-START … // EDITS-END)');
  else {
    const { replayEdits, structureLines } = new Function(`${src}\nreturn { replayEdits, structureLines };`)();
    const tpl = [{ name: 'Barbell bench press', kind: 'main', sets: 3 }, { name: 'Incline dumbbell press', kind: 'acc', sets: 3 }, { name: 'Cable fly', kind: 'acc', sets: 3 }, { name: 'Triceps pushdown', kind: 'extra', sets: 3 }, { name: 'Cable crunch', kind: 'abs', sets: 3 }];
    const fitted = tpl.map((e) => (e.name === 'Triceps pushdown' ? { ...e, sets: 2 } : e)), OH = 'Overhead triceps extension';
    const bl = (l) => l.map((e) => [{ ...e }]), setsOf = (x) => x.flat().find((e) => e.name === OH)?.sets;
    for (const [what, op, today, kept, line] of [
      ['swap', { op: 'swap', from: 'Triceps pushdown', row: { name: OH, sets: 2 } }, 2, 3, `Triceps pushdown → ${OH}`],
      ['swap, then Ben sets 4', { op: 'swap', from: 'Triceps pushdown', row: { name: OH, sets: 4 }, n: 4 }, 4, 4, `Triceps pushdown → ${OH} · 3 → 4 sets`],
      ['swap, then Ben sets 2', { op: 'swap', from: 'Triceps pushdown', row: { name: OH, sets: 2 }, n: 2 }, 2, 2, `Triceps pushdown → ${OH} · 3 → 2 sets`]]) {
      same(`Edits at Time 40, ${what}: today's draft (review R2)`, setsOf(replayEdits(bl(fitted), [op], tpl)), today);
      const now = replayEdits(bl(tpl), [op], tpl);
      same(`Edits at Time 40, ${what}: the template Keep would write (review R2)`, setsOf(now), kept);
      same(`Edits at Time 40, ${what}: Keep for next time? lines (review R2)`, structureLines(tpl, now.flat(), [op]), [line]);
    }
    // N-a: a set count on an exercise the fit dropped brings it back in its template place, not at the end.
    same('Edits: a set count brings a dropped exercise back in its place (re-review N-a)', replayEdits(bl(tpl.filter((e) => e.name !== 'Triceps pushdown')), [{ op: 'sets', name: 'Triceps pushdown', n: 3 }], tpl).flat().map((e) => e.name), tpl.map((e) => e.name));
  } }
// … and through the app: Time 40 on Today, Edit, swap the trimmed Triceps pushdown (2 sets today). Keep lists the swap
// alone; after Ben sets the new exercise to 4, the line shows 3 → 4 sets.
for (const n of [null, 4]) {
  await reset(true);
  const tb = await fr('training-blocks.html'); await toMin(tb, 40);
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  const b = await fr('workout-builder-v3.html#draft');
  const tp = (await builderRows(b)).find((r) => r.name === 'Triceps pushdown');
  if (tp?.sets !== 2) { bad.push(`Your workout at Time 40: Triceps pushdown has ${tp?.sets} sets, expected the fit's 2 (review R2 setup)`); continue; }
  await b.evaluate(`(${rowEl})('Triceps pushdown').parentElement.querySelector('[data-a="qswap"]').click()`); await wait(100);
  const to = await b.evaluate((oh) => { const x = document.querySelector(`.sheet [data-a="swap"][data-v="${oh}"]`) ?? document.querySelector('.sheet [data-a="swap"]'); x.click(); return x.dataset.v; }, 'Overhead triceps extension'); await wait(150);
  const got = (await builderRows(b)).find((r) => r.name === to);
  if (got?.sets !== 2) bad.push(`Your workout at Time 40: ${to} swapped in with ${got?.sets} sets, expected the slot's 2 today (review R2)`);
  if (n) await addSetsTo(b, to, n);
  await b.locator('[data-a="start"]').click(); await wait(400);
  await finish('Chest', [`Triceps pushdown → ${to}${n ? ` · 3 → ${n} sets` : ''}`], `Chest at Time 40, Triceps pushdown swapped${n ? `, ${n} sets` : ''} (review R2)`);
}
// Review S2: a lighter top Ben types on Your workout lowers its back-offs by the same % (102.5 → 100: 95 → 92.5, as
// Today's held top); typing the planned top back brings back 95.
{ const b = await openDraft('Edit');
  if (!(await tapRow(b, FIXTURE.main))) bad.push(`Your workout: tapping ${FIXTURE.main} didn't open its sheet (review S2 setup)`);
  const i = await b.evaluate(() => [...document.querySelectorAll('.sheet select[data-f="type"]')].find((x) => x.value === 'T')?.dataset.i);
  for (const [kg, want] of [['100', '1 × 6 + 2 × 8 · 100 / 92.5'], ['102.5', FIXTURE.mainLine]]) {
    await b.locator(`.sheet .cell[data-f="kg"][data-i="${i}"]`).fill(kg); await wait(60);
    await b.locator('.sheet .pill[data-a="close"]').click(); await wait(100);
    same(`Your workout: bench top typed ${kg}, its line (review S2; SS4, HT8)`, await b.evaluate(`(${rowEl})('${FIXTURE.main}').querySelector('.nm small').textContent`), want);
    await tapRow(b, FIXTURE.main);
  }
  await b.locator('.sheet .pill[data-a="close"]').click(); await wait(100); }
// Review S1 (partial): what the fit cut from an exercise Ben then removed isn't offered as carry-over or listed as the
// fit's: Triceps pushdown removed on Your workout, Time 35 on Today → no "triceps" carry-over, no "Dropped Triceps pushdown".
await reset(true);
{ const tb = await fr('training-blocks.html');
  await tb.locator('.card [data-a="edit"]').click(); await wait(500);
  const b = await fr('workout-builder-v3.html#draft');
  await b.evaluate(`(${rowEl})('Triceps pushdown').parentElement.querySelector('[data-a="qdel"]').click()`); await wait(150);
  await page.click('#backBtn'); await wait(400);
  await toMin(tb, 35);
  await tb.evaluate(() => document.querySelector('.card [data-a="fitwhy"]')?.click()); await wait(100);
  const t = await tb.evaluate(() => document.querySelector('.fitwhy')?.innerText ?? '');
  if (/triceps/i.test(t)) bad.push(`Today at 35 min after Ben removed Triceps pushdown: the fit still lists or carries it over: ${t.replace(/\n/g, ' · ')} (review S1)`); }
// D9 (review S2): on every plan day, less time never loses less training (sets lost from 60 min down to 20), and the
// fit fits whenever it can (down to 25 min here).
for (const day of DAYS) {
  await reset(true);
  const tb = await fr('training-blocks.html');
  await tb.locator(`[data-a="dayp"][data-v="${day}"]`).click(); await wait(80);
  const total = async () => (await cardRows(tb)).reduce((x, r) => x + r.sets, 0);
  const full = await total(); let prev = 0;
  for (let m = 55; m >= 20; m -= 5) {
    await tb.locator('.card [data-a="min"][data-v="-5"]').click(); await wait(40);
    const lost = full - await total(), est = mins(await tb.evaluate(() => document.querySelector('.card .meta span').textContent));
    if (lost < prev) bad.push(`${day}: at ${m} min the fit loses ${lost} sets, fewer than ${prev} at ${m + 5} min (D9, review S2)`);
    if (m >= 25 && est > m) bad.push(`${day}: ~${est} min at Time ${m} min (D9)`);
    prev = Math.max(prev, lost);
  }
}
// D4 (review B2): every focus and effort, every week, every main lift in the plan builder, including the dumbbell one.
// Deload weeks lower the top and the back-offs by the same −10 % (SS4, HT8), so they only need to stay below the top.
await reset(false); await page.click('#tnSetup'); await wait(500);
{ const pb = await fr('plan-builder.html'); await wait(150);
  const rows = await pb.evaluate(() => { const out = [], keep = { focus: S.focus, effort: S.effort };
    for (const focus of ['Strength', 'Balanced', 'Muscle']) for (const effort of ['Maintain', 'Standard', 'Push']) {
      Object.assign(S, { focus, effort });
      for (const n of MAIN) { if (!HIST[n] || HIST[n].none) continue; const e = mkEx(n, 'X', 'main'); if (e.bw) continue;
        for (let w = 1; w <= S.weeks; w++) { const x = atWeek(e, w); out.push({ focus, effort, n, w, top: x.top, back: x.back, dl: !!x.dl, each: !!HIST[n].each, line: x.line }); } } }
    Object.assign(S, keep); return out; });
  for (const f of ['Strength', 'Muscle']) if (!rows.some((r) => r.each && r.focus === f)) bad.push(`Plan back-off check: no dumbbell main lift for ${f} (D4)`);
  let n = 0;
  for (const r of rows) { const step = r.each ? 2 : 2.5, why = r.dl ? (r.back < r.top - 1e-9 ? null : `${r.back} is not below the top ${r.top}`) : backOffWrong(r.top, r.back, r.focus, step);
    if (why && n++ < 8) bad.push(`Your plan, ${r.focus} / ${r.effort}, ${r.n} week ${r.w} (${r.line}): ${why} (D4, review B2)`); } }
// SS4/HT8 (review): a held top lowers its back-offs by the same % (bench pain hold 102.5 → 100: back-offs 92.5); a
// repeat after hard sessions (100 planned) works them out from 100 (95); a deload takes 10 % off both.
await reset(true);
{ const tb = await fr('training-blocks.html');
  for (const [st, want] of [['pain', '1 × 6 + 2 × 8 · 100 / 92.5'], ['early', '1 × 6 + 2 × 8 · 100 / 95'], ['deload', '1 × 6 + 1 × 8 · 92.5 / 87.5']]) {
    await tb.evaluate((v) => document.querySelector(`[data-a="st"][data-v="${v}"]`).click(), st); await wait(120);
    same(`Today, ${st}: bench line (SS4, HT8)`, await tb.evaluate(() => document.querySelector('.card .exl .ex small')?.textContent), want);
  } }
// D7 (review): Any days builds as many days as Sessions a week, whatever the day row last held.
await reset(false); await page.click('#tnSetup'); await wait(500);
{ const pb = await fr('plan-builder.html'); await wait(150);
  const r = await pb.evaluate(() => { S.page = 'week'; render(); document.querySelector('[data-sch="fixed"]').click(); document.querySelector('[data-day][aria-pressed="true"]').click(); document.querySelector('[data-sch="flexible"]').click(); document.querySelector('#build').click(); return { plan: S.plan.length, freq: S.freq }; });
  if (r.plan !== r.freq) bad.push(`Plan setup: Any days built ${r.plan} days for ${r.freq} a week (review)`); }
// S7: a Muscle plan's back-offs on Today and in the workout use Muscle's band (bench 102.5 → 92.5).
await reset(false); await page.click('#tnSetup'); await wait(500);
{ const pb = await fr('plan-builder.html'); await wait(150);
  await pb.evaluate(() => { S.focus = 'Muscle'; startPlan(); }); await wait(200);
  await pb.locator('#apply').click(); await wait(700);
  const tb = await fr('training-blocks.html'); await wait(300);
  same('Muscle plan: Today\'s bench line (D4, review S7)', await tb.evaluate(() => document.querySelector('.card .exl .ex small')?.textContent), '1 × 6 + 2 × 8 · 102.5 / 92.5');
  await tb.evaluate(() => document.querySelector('.card [data-a="start"]').click()); await wait(400); // the shell's Plan applied toast may cover it
  same('Muscle plan: the workout\'s bench line (S7)', (await active()).ex[0].line, '1 × 6 + 2 × 8 · 102.5 / 92.5');
  await finish('Chest', null, 'Chest on a Muscle plan'); }
// D7 (review): a page opened from Your plan's rows shows one back control, its own; Done goes back to the overview.
await reset(true); await page.evaluate(() => { A.tab = 'library'; A.stack = ['planview']; show(); }); await wait(500);
{ const pv = await fr('plan-builder.html#view'); await wait(150);
  await pv.locator('[data-setup="goals"]').click(); await wait(300);
  if (await page.locator('#backBtn').count()) bad.push('Library › Your plan › Goals shows the app\'s back as well as its own (D7: one back control)');
  const own = await pv.evaluate(() => (document.getElementById('topbar').style.display !== 'none' && getComputedStyle(document.getElementById('back')).visibility === 'visible' ? document.getElementById('back').textContent : null));
  same('Library › Your plan › Goals: its back control (D7)', own, '‹ Your plan');
  await pv.locator('#done').click(); await wait(300);
  same('Your plan after Goals › Done: the app\'s back and the page (D7)', [await page.evaluate(() => document.getElementById('backBtn')?.textContent ?? null), await pv.evaluate(() => document.querySelector('#scroll h1')?.textContent)], ['‹ Library', 'Your plan']); }
// D7: with a plan, Profile › Split opens Library › Your plan, whatever Library tab was open before.
await reset(true); await page.evaluate(() => { A.tab = 'library'; LIB.tab = 'exercises'; A.stack = []; show(); A.tab = 'profile'; show(); }); await wait(150);
await page.locator('#profile .row', { hasText: 'Split' }).first().click(); await wait(400);
same('Profile › Split with a plan opens Library › Your plan (D7)', await page.evaluate(() => ({ tab: A.tab, top: A.stack.at(-1) ?? null })), { tab: 'library', top: 'planview' });
// D5 (review): a part Ben names in Set up's chat is the one added ("add hamstrings" adds a hamstring exercise).
const PART = { Triceps: ['Triceps pushdown', 'Overhead triceps extension'], Biceps: ['EZ-bar curl', 'Hammer curl'], Hamstrings: ['Romanian deadlift', 'Leg curl', 'Hip thrust'] };
async function builtFrom(day, text) {
  await reset(false); await page.click('#tnBuild'); await wait(500);
  const b = await fr('workout-builder-v3.html');
  if (text) { await b.evaluate(() => document.querySelector('[data-a="chat"]').click()); await wait(100); await b.locator('#chatq').fill(text); await b.locator('#chatq').press('Enter'); await wait(150); }
  else if (day !== 'Chest') { await b.evaluate(() => document.querySelector('[data-a="sheet-day"]').click()); await wait(80); await b.evaluate((d) => document.querySelector(`[data-a="day"][data-v="${d}"]`).click(), day); await wait(80); }
  await b.evaluate(() => document.querySelector('[data-a="build"]').click()); await wait(200);
  return b.evaluate(() => [...document.querySelectorAll('.er .nm')].map((x) => x.firstChild.textContent));
}
for (const [day, part] of [['Chest', 'Triceps'], ['Back', 'Biceps'], ['Legs', 'Hamstrings']]) {
  const count = (names) => names.filter((x) => PART[part].includes(x)).length;
  const before = count(await builtFrom(day)), after = count(await builtFrom(day, `${day.toLowerCase()}, add ${part.toLowerCase()}`));
  if (after !== before + 1) bad.push(`Builder Set up chat "${day.toLowerCase()}, add ${part.toLowerCase()}": ${part} exercises ${before} → ${after}, expected one more (D5)`);
}

// D2: a weekly review's stall reset and an extra set Ben didn't ask for are offers (Apply / Skip), never applied by
// themselves; the small load change stays applied with Undo.
const changeRows = (f) => f.evaluate(() => [...document.querySelectorAll('.chg')].map((r) => ({ t: r.querySelector('.t')?.textContent ?? '', apply: !!r.querySelector('[data-a="cApply"]'), undo: !!r.querySelector('[data-a="undo"]') })));
await reset(false); await page.evaluate(() => { A.tab = 'progress'; A.stack = []; show(); }); await wait(500);
{ const pf = await fr('progress-simple.html'); await wait(150); const rows = await changeRows(pf);
  for (const n of ['Row', 'Lateral raise']) { const r = rows.find((x) => x.t.startsWith(n)); if (!r || !r.apply || r.undo) bad.push(`Progress (no plan): ${n} should be an offer with Apply (D2)`); }
  const sq = rows.find((x) => x.t.startsWith('Squat')); if (!sq || !sq.undo) bad.push('Progress (no plan): the small Squat change should be applied with Undo (D2)'); }
await reset(true); await page.evaluate(() => { A.tab = 'progress'; A.stack = []; show(); }); await wait(500);
{ const pf = await fr('training-blocks.html#progress'); await wait(300); const rows = await changeRows(pf);
  const r = rows.find((x) => x.t.startsWith('Row')); if (!r || !r.apply || r.undo) bad.push('Progress (plan): the Row stall reset should be an offer with Apply (D2)'); }

// D7: one split source. Without a plan Profile's split is used; with a plan Split and Workout defaults read Set by your plan.
for (const plan of [false, true]) {
  await reset(plan); await page.evaluate(() => { A.tab = 'profile'; A.stack = []; show(); }); await wait(100);
  const t = await page.evaluate(() => document.querySelector('#profile').innerText);
  const set = /Split\s+Set by your plan/.test(t) && /Workout defaults\s+Set by your plan/.test(t);
  if (set !== plan) bad.push(`Profile ${plan ? 'with' : 'without'} a plan: Split and Workout defaults ${plan ? 'should' : 'should not'} read Set by your plan (D7)`);
}

// D7: plan setup has no step counter and Build plan on its first step (✦ answers start selected). D6: a stale squat
// confirmed with Still right starts at full weight (117.5 × 6, not a step lighter). The plan has no day chips, no Swap
// day, and Any preferences is an optional row.
await reset(false); await page.click('#tnSetup'); await wait(500);
{ const pb = await fr('plan-builder.html'); await wait(150);
  const first = await pb.evaluate(() => ({ counter: /\d+ of \d+/.test(document.querySelector('#topbar')?.innerText ?? ''), build: !!document.querySelector('#build'), page: document.querySelector('#scroll h1')?.textContent }));
  if (first.counter) bad.push('Plan setup still shows a step counter (D7)');
  if (!first.build) bad.push(`Plan setup: no Build plan on "${first.page}" (D7)`);
  await pb.evaluate(() => document.querySelector('[data-lift="Back squat"]')?.click()); await wait(100);
  await pb.evaluate(() => document.querySelector('#okL')?.click()); await wait(100);
  await pb.evaluate(() => document.querySelector('#build')?.click()); await wait(400);
  const plan = await pb.evaluate(() => ({ chips: document.querySelectorAll('.chip[data-toggle]').length, swap: document.querySelectorAll('[data-swap]').length, prefs: !!document.querySelector('[data-setup="prefs"]'), legs: [...document.querySelectorAll('.dcard')].findIndex((c) => c.querySelector('.dtop .nm')?.textContent.endsWith('Legs')) }));
  if (plan.chips || plan.swap) bad.push('Your plan still has day chips or Swap day (D7)');
  if (!plan.prefs) bad.push('Your plan: no Any preferences row (D7)');
  if (plan.legs < 0) bad.push('Your plan: no Legs day to check the squat (D6)');
  else {
    await pb.evaluate((i) => document.querySelector(`.dtop[data-toggle="${i}"]`)?.click(), plan.legs); await wait(100);
    const line = await pb.evaluate((i) => document.querySelectorAll('.dcard')[i]?.querySelector('[data-exw] small')?.textContent ?? '', plan.legs);
    if (!line.startsWith('1 × 6 + 2 × 8 · 117.5 / ')) bad.push(`Your plan: a stale squat confirmed Still right should start at 117.5 × 6 (D6), got "${line}"`);
  } }

await browser.close();
for (const e of errors) bad.push(`page error: ${e}`);
if (bad.length) { console.error(`CLICK-THROUGH CHECK FAILED: ${bad.length} problem(s)\n  ` + bad.join('\n  ')); process.exit(1); }
console.log('click-through check: ok');
