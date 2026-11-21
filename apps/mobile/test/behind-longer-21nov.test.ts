import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { BEHIND_COPY, BEHIND_LONGER, BEHIND_LONGER_COPY } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { applyBehindLonger } from '../src/today/behind-apply';
import { behindChoicesView, behindRowView } from '../src/today/today-view';
import { CONNECTED, replyWith, StepModel } from './coach-model';
import { createHarness, type Harness } from './harness';
import { benWithHistory, DAY, MONDAY, todayData, withPlan, type Ben } from './render/seed';

/**
 * (Ben, 21 Nov: MS3 amended) Real SQLite. `2 days behind · Adjust today?` opens two choices, `Usual · ~N min` and
 * `Longer · ~M min · + …`. No AI: the built-in longer proposal (Apply → today's draft has the extras; Undo puts the
 * draft and Up next back). With the coach: the tap's words carry the choice, and the longer one the extras.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness(MONDAY, { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function doDay(ben: Ben, name: string): Promise<void> {
  const s: AppServices = ben.s;
  const d = await todayData(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId: ben.gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  const id = r.aggregate.session.id;
  for (;;) {
    const a = (await s.workout.load(id))?.aggregate;
    const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
    if (a === undefined || set === undefined) break;
    const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: conv === 'bodyweight' ? 0 : 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
  }
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

const nameOf = (d: TodaySessionData, key: string | null) => d.days.find((x) => x.key === key)?.name ?? null;

// A 5-day PPL on Set days: Mon Push A, Tue Pull A, Wed Legs, Thu Push B, Sat Pull B. Legs done Monday; Thursday.
async function thursday(): Promise<{ ben: Ben; d: TodaySessionData }> {
  const ben = await benWithHistory(h);
  await withPlan(h, ben, { sessions: 5, split: 'ppl', schedule: 'set', days: [0, 1, 2, 3, 5] });
  await doDay(ben, 'Legs');
  h.clockMs = Date.parse(MONDAY) + 3 * DAY;
  return { ben, d: await todayData(ben.s) };
}

/** Every exercise in a draft's current workout. */
async function draftIds(s: AppServices, draftId: string): Promise<string[]> {
  const snap = await s.builder.read(draftId);
  return snap?.workout.blocks.flatMap((b) => b.slots.map((x) => x.exerciseId)) ?? [];
}

describe('Behind: the longer choice, no AI (MS3 amended 21 Nov)', () => {
  it('the offer shows both choices; the longer one is ≤ +20 min with its extras named', async () => {
    const { ben, d } = await thursday();
    const longer = ben.s.todaySession.behindLonger(d);
    if (longer === null) throw new Error('no longer choice');
    expect(longer.dayKey).toBe(d.behind?.builtIn?.dayKey);
    expect(longer.addedMinutes).toBeGreaterThan(0);
    expect(longer.addedMinutes).toBeLessThanOrEqual(BEHIND_LONGER.maxMinutes);
    expect(longer.minutes).toBe(longer.usualMinutes + longer.addedMinutes);
    const card = ben.s.todaySession.card(d, { dayKey: longer.dayKey, controls: d.initial[longer.dayKey] ?? (() => { throw new Error('no controls'); })() });
    expect(longer.usualMinutes).toBe(card?.minutes);
    // Nothing already in Push A comes in again.
    const inDay = new Set(card?.draft?.workout.blocks.flatMap((b) => b.slots.map((x) => x.exerciseId)) ?? []);
    expect(longer.extras.every((x) => !inDay.has(x.exerciseId))).toBe(true);
    const v = behindChoicesView(d.behind, longer, { coach: false });
    expect(v?.title).toBe('Push A');
    expect(v?.label).toBe('Built-in');
    expect(v?.rows.map((r) => r.choice)).toEqual(['usual', 'longer']);
    expect(v?.rows[0]?.text).toBe(`Usual · ~${String(longer.usualMinutes)} min`);
    expect(v?.rows[1]?.text).toBe(BEHIND_LONGER_COPY.longer(longer.minutes, longer.extras.map((x) => x.name)));
    expect(v?.rows[1]?.text.startsWith(`Longer · ~${String(longer.minutes)} min · + `)).toBe(true);
    expect(behindRowView(d.behind, { today: d.localDate, dismissedOn: null, picked: false, coach: false, longer: true })?.adjust).toBe('Adjust today?');
  });

  it('Apply → Push A is today’s card and its draft has the extras; the same op ID never writes twice; Undo puts both back', async () => {
    const { ben, d } = await thursday();
    const s = ben.s;
    const longer = s.todaySession.behindLonger(d);
    if (longer === null) throw new Error('no longer choice');
    const r = await applyBehindLonger(s, d, longer, h.ids);
    if (!r.ok) throw new Error(r.message);
    const after = await todayData(s);
    expect(nameOf(after, after.nextKey)).toBe('Push A');
    const ids = await draftIds(s, r.draftId);
    for (const x of longer.extras) expect(ids).toContain(x.exerciseId);
    const snap = await s.builder.read(r.draftId);
    const sets = (id: string) => snap?.workout.blocks.flatMap((b) => b.slots).find((x) => x.exerciseId === id)?.rows.filter((row) => row.type !== 'warmup').length;
    for (const x of longer.extras) expect(sets(x.exerciseId)).toBe(x.sets);
    // Today's card is that draft (one Start).
    const card = s.todaySession.card(after, { dayKey: after.nextKey ?? '', controls: after.initial[after.nextKey ?? ''] ?? (() => { throw new Error('no controls'); })() });
    expect(card?.edited?.draftId ?? card?.nudged?.draftId).toBe(r.draftId);
    expect(await r.undo()).toBe(true);
    const undone = await todayData(s);
    expect(nameOf(undone, undone.nextKey)).toBe('Pull A');
    for (const x of longer.extras) expect(await draftIds(s, r.draftId)).not.toContain(x.exerciseId);
  });

  it('a stale offer (the plan moved since) is refused, nothing written', async () => {
    const { ben, d } = await thursday();
    const s = ben.s;
    const longer = s.todaySession.behindLonger(d);
    const b = d.behind;
    if (longer === null || b?.builtIn == null || d.planVersion === null) throw new Error('no offer');
    const moved = await s.plans.makeNext({ planId: b.planId, routineId: b.builtIn.routineId, expectedVersion: d.planVersion, opId: h.ids() });
    expect(moved.ok).toBe(true);
    const r = await applyBehindLonger(s, d, longer, h.ids);
    expect(r.ok).toBe(false);
  });
});

describe('Behind: the longer choice with the coach (MS3 amended 21 Nov)', () => {
  function yourData(req: ModelRequest): { behind?: { longer?: { addMinutes: number; add: string[] }; use: string } } {
    const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    return block?.type === 'message' ? (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as ReturnType<typeof yourData>) : {};
  }

  it('the Longer tap carries the extra minutes; the coach is told the extras and the budget; the Usual tap isn’t', async () => {
    const { ben, d } = await thursday();
    const longer = ben.s.todaySession.behindLonger(d);
    const b = d.behind;
    if (longer === null || b === null) throw new Error('no offer');
    const seen: ReturnType<typeof yourData>[] = [];
    const step = (req: ModelRequest): ModelEvent[] => {
      seen.push(yourData(req));
      return replyWith('Ready when you are.');
    };
    model = new StepModel([step, step, step, step, step, step]);
    const words = BEHIND_LONGER_COPY.askLonger(b.line, longer.addedMinutes);
    expect(words).toBe(`2 days behind. Build today's workout, a bit longer (+${String(longer.addedMinutes)} min).`);
    await ben.s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: words, spoken: false }, turnId: h.ids() });
    expect(seen[0]?.behind?.longer).toEqual({ addMinutes: longer.addedMinutes, add: longer.extras.map((x) => `${x.name} ${String(x.sets)}`) });
    expect(seen[0]?.behind?.use).toContain('Ben chose Longer');
    const first = seen.length;
    await ben.s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: BEHIND_COPY.ask(b.k), spoken: false }, turnId: h.ids() });
    const usual = seen.slice(first);
    expect(usual.length).toBeGreaterThan(0);
    for (const x of usual) {
      expect(x.behind).toBeDefined();
      expect(x.behind?.longer).toBeUndefined();
      expect(x.behind?.use).not.toContain('Longer');
    }
  });
});
