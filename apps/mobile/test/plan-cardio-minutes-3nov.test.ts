import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, pbRowLine } from '@fizz/domain';
import type { ActionRecord, Routine } from '@fizz/schemas';

import { workoutView } from '../src/builder/builder-view';
import { planSwapLines } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { applyTemplateEdit, openTemplate, saveTemplate, templatePopupView, templateTableView, type TemplateEditorCtx } from '../src/workout/template-editor';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 3 Nov, from his iPhone) He asked the coach for an 8-minute bike warm-up on leg days. Library › Plan › Legs A
 * then read `Exercise bike 1 × 12 BW` (week 3 picked), the week's day sheet didn't list the bike at all, and the coach
 * said it couldn't change the bike's time. Real SQLite, a scripted model, made-up data:
 * - propose_plan_add bike 8 min first (warm-up) on Legs A and Legs B → Apply → the plan day screen, a picked week, the
 *   day sheet, Today's card and Your workout all have `Exercise bike · 8 min` first (Warm-up), never reps or `BW`;
 * - "make the bike 10 min" → propose_plan_day_edit for both leg days on one card → Apply → 10 min everywhere, also
 *   after a force-close; Undo → 8 min; a double Apply writes once; a stale card is refused and writes nothing;
 * - the plan day editor shows the bike's time (no reps, no kg) and Ben can set it by hand.
 */

const BIKE = catalogueExerciseId('exercise-bike');
const LEG_DAYS = ['Legs A', 'Legs B'];

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 26 Oct 2026, 07:00 in London: the plan is applied, a workout that week, then Tuesday 3 Nov (week 2).
  h = createHarness('2026-10-26T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

/** A five-day plan (Push A, Pull A, Legs A, Upper B, Legs B), week 1 trained, now Tuesday of week 2. */
async function fivedays(s: AppServices, gymId: string): Promise<Map<string, string>> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 5, schedule: 'set' as const, days: [0, 1, 2, 3, 4] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const names: Record<string, string> = { Legs: 'Legs A', 'Push B': 'Upper B', 'Pull B': 'Legs B' };
  for (const d of (await s.plans.active())?.days ?? []) {
    const to = names[d.name];
    if (to === undefined) continue;
    const t = await template(s, d.routineId);
    const r = await s.routines.rename({ routineId: d.routineId, name: to, expectedVersion: t.version, opId: h.ids() });
    if (!r.ok) throw new Error(`rename ${d.name}`);
  }
  h.clockMs = Date.parse('2026-10-27T18:00:00.000Z');
  await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] }]);
  h.clockMs = Date.parse('2026-11-03T08:00:00.000Z');
  return new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
}

async function propose(s: AppServices, text: string, tool: 'propose_plan_add' | 'propose_plan_day_edit', args: object): Promise<ActionRecord> {
  model = new StepModel([() => toolCall(tool, args), () => replyWith('Here it is for your plan.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
  expect(r.status).toBe('completed');
  const rec = r.cards[0]?.record;
  if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
  return rec;
}

const ADD = { add: 'exercise-bike', days: LEG_DAYS, after: null, workingSets: 1, reps: null, load: null, position: 'first', before: null, minutes: 8, distanceM: null, warmup: true, also: null, notIncluded: null, reason: 'Bike warm-up first on leg days.' };
const EDIT = (minutes: number) => ({ day: 'Legs A', alsoDays: ['Legs B'], order: null, changes: [{ exercise: 'exercise-bike', workingSets: null, reps: null, targetRpe: null, main: null, load: null, minutes, distanceM: null, warmup: null, first: null }], reason: 'Longer bike warm-up.' });

async function today(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** Every view of one plan day: `[name, time]` of its first row, and that no row reads reps or BW for the bike. */
async function views(s: AppServices, routineId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Library › Plan › Legs A (this week's plan day screen).
  const day = await s.plans.planDay(routineId);
  out.planDay = `${day?.rows[0]?.name ?? ''} · ${day?.rows[0]?.line ?? ''} · ${day?.rows[0]?.sub ?? ''}`;
  // The same day opened from week 3 on the strip.
  const w3 = await s.plans.planDay(routineId, { targetsHit: false, week: 3 });
  const r3 = w3?.week?.rows[0];
  out.week3 = `${r3?.name ?? ''} · ${r3 === undefined ? '' : pbRowLine(r3)} · ${r3?.kg ?? 'no kg'}`;
  out.week3Header = w3?.week?.header ?? '';
  // Today's card and the week's day sheet (EXERCISE / SETS / TARGET).
  const d = await today(s);
  const key = d.days.find((x) => x.templates.some((t) => t.routineId === routineId))?.key ?? '';
  const controls = d.initial[key];
  if (controls === undefined) throw new Error('no controls');
  const card = s.todaySession.card(d, { dayKey: key, controls });
  out.card = (card?.list.slice(0, 1) ?? []).map((r) => `${r.fullName} | ${r.sets} | ${r.target}`.replace(/\u00a0/g, ' ')).join(' / ');
  const sheet = s.todaySession.daySheet(d, { dayKey: key }, d.nextKey, (x) => x);
  out.sheet = sheet.list.slice(0, 1).map((r) => `${r.fullName} | ${r.sets} | ${r.target}`.replace(/\u00a0/g, ' ')).join(' / ');
  // Your workout from Today's card (the draft Start uses).
  const committed = await s.todaySession.commit(d, { dayKey: key, controls }, h.ids());
  if (!committed.ok) throw new Error(committed.message);
  const snap = await s.builder.read(committed.draftId);
  const yw = snap === null ? [] : workoutView(snap).rounds.flatMap((r) => r.rows);
  out.yourWorkout = `${yw[0]?.name ?? ''} · ${yw[0]?.topText ?? ''} · ${yw[0]?.works?.endsWith('Warm-up') === true ? 'Warm-up' : ''}`;
  return out;
}

const at = (minutes: number) => ({
  planDay: `Exercise bike · ${String(minutes)} min · Warm-up`,
  week3: `Exercise bike · ${String(minutes)} min · Warm-up · no kg`,
  week3Header: 'Week 3 of 6 · Next week',
  card: `Exercise bike | ${String(minutes)} min | —`,
  sheet: `Exercise bike | ${String(minutes)} min | —`,
  yourWorkout: `Exercise bike · ${String(minutes)}:00 · Warm-up`,
});

describe('Ben’s bike warm-up on leg days: the same minutes in every view of the plan day, and the coach can change them', () => {
  it('add 8 min first → every view; make it 10 min (one card, both leg days) → Apply, restart, Undo, double Apply, stale', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await fivedays(s, gymId);
    const legsA = days.get('Legs A') ?? '';
    const legsB = days.get('Legs B') ?? '';

    const add = await propose(s, 'Pls add cycling as a 8 min warm-up on leg days', 'propose_plan_add', ADD);
    expect(await s.planSwap.apply(add.actionId)).toEqual({ ok: true });
    // Stored as 8 minutes (480 s), one working bout, marked.
    for (const id of [legsA, legsB]) {
      const head = [...(await template(s, id)).exercises].sort((a, b) => a.order - b.order)[0];
      expect([head?.exerciseId, head?.warmup, head?.setTemplates.map((t) => [t.setType, t.targetReps, t.targetDurationS])]).toEqual([BIKE, true, [['working', null, 480]]]);
    }
    expect(await views(s, legsA)).toEqual(at(8));
    expect(await views(s, legsB)).toEqual(at(8));

    // "make the bike 10 min": the plan-day edit, both leg days on one card.
    const edit = await propose(s, 'Make the bike 10 min on leg days', 'propose_plan_day_edit', EDIT(10));
    expect(edit.status).toBe('proposed');
    const tool = model.requests[0]?.tools.find((t) => t.name === 'propose_plan_day_edit');
    expect(JSON.stringify(tool)).toContain('alsoDays');
    expect(JSON.stringify(model.requests[0])).toContain('Never tell Ben to edit it himself');
    expect(planSwapLines(edit)).toEqual({ head: 'Legs A, Legs B', days: ['Legs A: Exercise bike · 8 min → 10 min', 'Legs B: Exercise bike · 8 min → 10 min'] });
    const before = await Promise.all([legsA, legsB].map(async (id) => (await template(s, id)).version));
    expect(await s.planSwap.apply(edit.actionId)).toEqual({ ok: true });
    // A double tap (or a retry after a restart) writes once.
    expect(await s.planSwap.apply(edit.actionId)).toEqual({ ok: true });
    expect(await Promise.all([legsA, legsB].map(async (id) => (await template(s, id)).version))).toEqual(before.map((v) => v + 1));
    expect(await s.planSwap.card(edit.actionId)).toMatchObject({ kind: 'applied' });
    expect(await views(s, legsA)).toEqual(at(10));

    // Force-close: the stored minutes survive.
    await h.settle(s);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await views(s2, legsB)).toEqual(at(10));

    // Undo: back to 8 min on both days.
    expect(await s2.planSwap.undo(edit.actionId, h.ids())).toBe(true);
    expect(await views(s2, legsA)).toEqual(at(8));
    expect(await views(s2, legsB)).toEqual(at(8));

    // A card proposed before Legs B changed is refused (rule 5): nothing written on either day.
    const stale = await propose(s2, 'Make the bike 12 min on leg days', 'propose_plan_day_edit', EDIT(12));
    const other = await propose(s2, 'Make the bike 9 min on Legs B', 'propose_plan_day_edit', { ...EDIT(9), day: 'Legs B', alsoDays: null });
    expect(await s2.planSwap.apply(other.actionId)).toEqual({ ok: true });
    const versionA = (await template(s2, legsA)).version;
    expect(await s2.planSwap.apply(stale.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect((await template(s2, legsA)).version).toBe(versionA);
    const minutesOf = async (id: string) => [...(await template(s2, id)).exercises].sort((a, b) => a.order - b.order)[0]?.setTemplates[0]?.targetDurationS;
    expect([await minutesOf(legsA), await minutesOf(legsB)]).toEqual([480, 540]);
  });

  it('the coach can put an existing bike first and mark it a warm-up; a lift can’t be given minutes', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await fivedays(s, gymId);
    const legsA = days.get('Legs A') ?? '';
    const last = await propose(s, 'Add 8 min on the bike at the end of Legs A', 'propose_plan_add', { ...ADD, days: ['Legs A'], position: 'last', warmup: null });
    expect(await s.planSwap.apply(last.actionId)).toEqual({ ok: true });
    const moved = await propose(s, 'Put the bike first on Legs A as a warm-up', 'propose_plan_day_edit', { day: 'Legs A', order: null, changes: [{ exercise: 'exercise-bike', workingSets: null, reps: null, targetRpe: null, main: null, load: null, minutes: null, distanceM: null, warmup: true, first: true }], reason: 'Warm-up first.' });
    expect(planSwapLines(moved)).toEqual({ head: 'Legs A', days: ['Exercise bike: first, warm-up'] });
    expect(await s.planSwap.apply(moved.actionId)).toEqual({ ok: true });
    const head = [...(await template(s, legsA)).exercises].sort((a, b) => a.order - b.order)[0];
    expect([head?.exerciseId, head?.warmup, head?.setTemplates[0]?.targetDurationS]).toEqual([BIKE, true, 480]);
    expect((await views(s, legsA)).planDay).toBe('Exercise bike · 8 min · Warm-up');

    // Minutes on a lift: refused with one honest line, nothing proposed.
    const lift = await propose(s, 'Make the squat 10 min', 'propose_plan_day_edit', { ...EDIT(10), alsoDays: null, changes: [{ ...EDIT(10).changes[0], exercise: 'barbell-back-squat' }] });
    expect([lift.status, lift.failure]).toEqual(['rejected', 'Back squat is done for reps, not time']);
  });

  it('Edit on the plan day: the bike shows its time (no reps, no kg) and Ben sets 10 min by hand', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await fivedays(s, gymId);
    const legsA = days.get('Legs A') ?? '';
    const add = await propose(s, 'Pls add cycling as a 8 min warm-up on leg days', 'propose_plan_add', ADD);
    expect(await s.planSwap.apply(add.actionId)).toEqual({ ok: true });
    const o = await openTemplate(s, { routineId: legsA });
    if (o === null) throw new Error('editor did not open');
    const ctx: TemplateEditorCtx = { info: o.info, facts: o.facts, gym: o.data.gym, unit: o.data.unit, globalDefault: o.data.globalDefault, effortScale: o.data.effortScale, stored: o.data.routine?.exercises ?? [] };
    const bike = o.list.find((e) => e.exerciseId === BIKE);
    if (bike === undefined) throw new Error('no bike');
    expect(templateTableView(o.list, ctx).rounds[0]?.rows[0]).toMatchObject({ name: 'Exercise bike', topText: '8:00' });
    const pop = templatePopupView(o.list, bike.id, ctx);
    expect(pop?.rows.map((r) => [r.repsText, r.kgText, r.kgPlaceholder, r.kgEditable])).toEqual([['8:00', '—', '—', false]]);
    expect(pop?.options.reps.label).toBe('Time');
    const set = bike.setTemplates[0];
    if (set === undefined) throw new Error('no set');
    const edited = applyTemplateEdit(o.list, { kind: 'set_time', slotId: bike.id, setId: set.id, seconds: 600 }, ctx, () => h.ids()).list;
    const t = await template(s, legsA);
    const saved = await saveTemplate(s.routines, { target: { kind: 'edit', routineId: legsA, copy: false }, edit: { name: o.name, exercises: edited }, expectedVersion: t.version, opId: h.ids() });
    expect(saved.kind).toBe('saved');
    expect((await views(s, legsA)).planDay).toBe('Exercise bike · 10 min · Warm-up');
  });
});
