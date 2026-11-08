import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { BEHIND_COPY } from '@fizz/domain';

import { parsePrefs } from '../src/device/prefs';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { behindOfferView, behindRowView } from '../src/today/today-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';
import { benWithHistory, DAY, MONDAY, todayData, withPlan, type Ben } from './render/seed';

/**
 * (Ben, 8 Nov: MS1–MS9, docs/training-guides/missed-sessions.md) Real SQLite. Behind on a Set days plan: Today's
 * `N days behind · Adjust today?`, the tiles agreeing with the count, the built-in offer (no AI: the top missed day
 * whole, Apply = `Make next`, Undo), dismiss for the day, a force-close; and with a scripted coach, the whole-workout
 * proposal from the top day, with the coverage check (Ben, 8 Nov: the coach left biceps out).
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

/** Start a plan day by name and log every working set as planned, then finish. */
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
const row = (d: TodaySessionData, dismissedOn: string | null = null, coach = false) => behindRowView(d.behind, { today: d.localDate, dismissedOn, picked: false, coach });

describe('Behind this week: Today’s offer, no AI (MS1, MS2, MS6)', () => {
  // A 5-day PPL on Set days: Mon Push A, Tue Pull A, Wed Legs, Thu Push B, Sat Pull B. Legs done Monday; Thursday.
  async function thursday(): Promise<{ ben: Ben; d: TodaySessionData }> {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 5, split: 'ppl', schedule: 'set', days: [0, 1, 2, 3, 5] });
    await doDay(ben, 'Legs');
    h.clockMs = Date.parse(MONDAY) + 3 * DAY;
    return { ben, d: await todayData(ben.s) };
  }

  it('Thursday: 2 days behind · Adjust today?, the tiles show the two that don’t fit, nothing on the Friday rest day', async () => {
    const { ben, d } = await thursday();
    expect(d.behind).toMatchObject({ k: 2, line: '2 days behind', mode: 'set' });
    expect(row(d)).toEqual({ text: '2 days behind', adjust: 'Adjust today?', accessibilityLabel: '2 days behind. Adjust today?' });
    const tiles = ben.s.todaySession.week(d, nameOf(d, d.nextKey));
    expect(tiles.flatMap((t) => t.marks.filter((m) => m.shape === 'missed'))).toHaveLength(d.behind?.k ?? -1);
    expect(tiles[4]).toMatchObject({ state: 'plain', marks: [] });
    expect(d.week.missed.map((m) => m.name).sort()).toEqual(['Push A', 'Push B']);
    // The built-in pick: Push A (chest and triceps have no sets this week and none later), not Up next.
    expect(nameOf(d, d.nextKey)).toBe('Pull A');
    expect(d.behind?.builtIn).toMatchObject({ name: 'Push A', sets: 11 });
  });

  it('tap → the built-in proposal (the day whole, Built-in); Apply makes it today’s card; Undo restores; stale is refused', async () => {
    const { ben, d } = await thursday();
    const s = ben.s;
    const b = d.behind;
    const day = b?.builtIn;
    const controls = day == null ? undefined : d.initial[day.dayKey];
    if (b == null || day == null || controls === undefined || d.planVersion === null) throw new Error('no offer');
    const card = s.todaySession.card(d, { dayKey: day.dayKey, controls });
    expect(behindOfferView(b, card?.minutes ?? null)).toEqual({ title: 'Push A', line: `11 sets · ~${String(card?.minutes)} min`, label: 'Built-in' });
    // Apply (Make next): Up next and the card are Push A; the offer is gone (he chose today's day).
    const opId = h.ids();
    const applied = await s.plans.makeNext({ planId: b.planId, routineId: day.routineId, expectedVersion: d.planVersion, opId });
    if (!applied.ok) throw new Error(applied.message);
    const after = await todayData(s);
    expect(nameOf(after, after.nextKey)).toBe('Push A');
    expect(row(after)).toBeNull();
    const next = after.nextKey ?? '';
    const nextControls = after.initial[next];
    if (nextControls === undefined) throw new Error('no card');
    const c = await s.todaySession.commit(after, { dayKey: next, controls: nextControls }, h.ids());
    expect(c.ok).toBe(true);
    // The same op again replays; an Apply against the old version is refused (rule 5).
    expect(await s.plans.makeNext({ planId: b.planId, routineId: day.routineId, expectedVersion: d.planVersion, opId })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.plans.makeNext({ planId: b.planId, routineId: day.routineId, expectedVersion: d.planVersion, opId: h.ids() })).toMatchObject({ ok: false });
    // Undo: Up next and the offer come back.
    expect(await s.plans.undoControl({ planId: b.planId, targetOpId: opId, expectedVersion: applied.plan.version, opId: h.ids() })).toMatchObject({ ok: true });
    const undone = await todayData(s);
    expect(nameOf(undone, undone.nextKey)).toBe('Pull A');
    expect(row(undone)?.text).toBe('2 days behind');
  });

  it('dismiss hides it for the day (this phone’s prefs); tomorrow it is back; a force-close re-derives it', async () => {
    const { d } = await thursday();
    expect(row(d, d.localDate)).toBeNull();
    expect(parsePrefs(JSON.stringify({ behindDismissedOn: d.localDate })).behindDismissedOn).toBe(d.localDate);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await todayData(s2);
    expect(again.behind?.k).toBe(2);
    h.clockMs += DAY;
    const fri = await todayData(s2);
    // Friday: 4 still to do, Saturday only (Up next on the rest day isn't a slot) → 3 behind; yesterday's dismiss is gone.
    expect(fri.behind?.k).toBe(3);
    expect(row(fri, d.localDate)?.text).toBe('3 days behind');
  });

  it('no offer once he has trained today', async () => {
    const { ben } = await thursday();
    await doDay(ben, 'Pull A');
    const d = await todayData(ben.s);
    expect(row(d)).toBeNull();
  });
});

describe('Behind this week with the coach (MS5, MS9; Ben, 8 Nov: biceps left out)', () => {
  /** YOUR DATA as the model sees it. */
  function yourData(req: ModelRequest): { behind?: { behindBy: number; pickOrder: string[]; uncovered: string[]; use: string }; build?: { usable: { catalogueId: string; name: string }[] } } {
    const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    return block?.type === 'message' ? (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as ReturnType<typeof yourData>) : {};
  }
  const ex = (catalogueId: string, workingSets: number) => ({ catalogueId, warmups: null, workingSets, reps: { min: 8, max: 12 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
  const pick = (req: ModelRequest, re: RegExp) => yourData(req).build?.usable.find((u) => re.test(u.name))?.catalogueId ?? 'missing';

  // 4-day PPL on Set days: Mon Push A, Tue Pull, Wed Legs, Fri Push B. Push A Mon, Legs Wed; Thursday: Pull missed.
  async function pullMissed(): Promise<Ben> {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, split: 'ppl', schedule: 'set', days: [0, 1, 2, 4] });
    await doDay(ben, 'Push A');
    h.clockMs = Date.parse(MONDAY) + 2 * DAY;
    await doDay(ben, 'Legs');
    h.clockMs = Date.parse(MONDAY) + 3 * DAY;
    return ben;
  }

  it('a proposal without curls gets the coverage note back; the second includes curls and lands', async () => {
    const ben = await pullMissed();
    expect((await todayData(ben.s)).behind).toMatchObject({ k: 1, coach: { pickOrder: ['Pull'], uncovered: ['Back', 'Biceps'] } });
    let firstOutput = '';
    model = new StepModel([
      (req): ModelEvent[] => {
        const facts = yourData(req).behind;
        expect(facts).toMatchObject({ behindBy: 1, pickOrder: ['Pull'], uncovered: ['Back', 'Biceps'] });
        expect(facts?.use).toContain('propose_workout');
        return toolCall('propose_workout', { name: 'Pull', exercises: [ex(pick(req, /row/i), 3), ex(pick(req, /pulldown|pull-up/i), 3)], message: 'Back first.' });
      },
      (req): ModelEvent[] => {
        const out = req.input.filter((i) => i.type === 'function_call_output').at(-1);
        firstOutput = out?.type === 'function_call_output' ? out.output : '';
        return toolCall('propose_workout', { name: 'Pull', exercises: [ex(pick(req, /row/i), 3), ex(pick(req, /pulldown|pull-up/i), 3), ex(pick(req, /curl/i), 3)], message: 'Back first, then curls.' });
      },
      () => replyWith('Pull today, curls included.'),
    ]);
    const r = await ben.s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: BEHIND_COPY.ask(1), spoken: false }, turnId: h.ids() });
    expect(firstOutput).toContain('Biceps get 0 sets this week and none later');
    const card = r.cards.find((c) => c.record.detail.kind === 'build_workout' && c.record.status === 'committed')?.record;
    if (card?.detail.kind !== 'build_workout') throw new Error(`no draft: ${JSON.stringify(r.toolLog)}`);
    expect(card.detail.exerciseCount).toBe(3);
    expect(card.guardNotes.map((n) => n.text).join(' ')).not.toContain('None this week');
  });

  it('built again still without curls: it lands with the gap named on the card (never silently dropped)', async () => {
    const ben = await pullMissed();
    const backOnly = (req: ModelRequest): ModelEvent[] => toolCall('propose_workout', { name: 'Pull', exercises: [ex(pick(req, /row/i), 4), ex(pick(req, /pulldown|pull-up/i), 4)], message: 'Back only today.' });
    model = new StepModel([backOnly, backOnly, () => replyWith('Back only today.')]);
    const r = await ben.s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: BEHIND_COPY.ask(1), spoken: false }, turnId: h.ids() });
    const card = r.cards.find((c) => c.record.detail.kind === 'build_workout' && c.record.status === 'committed')?.record;
    if (card?.detail.kind !== 'build_workout') throw new Error(`no draft: ${JSON.stringify(r.toolLog)}`);
    expect(card.guardNotes.map((n) => n.text)).toContain('None this week: Biceps');
    expect(card.reason).toContain('None this week: Biceps.');
  });
});
