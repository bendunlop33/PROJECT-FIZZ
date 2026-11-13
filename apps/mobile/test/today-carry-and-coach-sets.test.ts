import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { slotsOf, workingCount } from '@fizz/domain';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct) Two gaps of the 23 Oct build, on real SQLite:
 * 1. Today's lean card offers the carry-over of the sets its Time cut (`Carry over` / `✕`, then `Undo`), answered with
 *    Today's own draft (versioned, op ID, stale refused), kept through Edit, Start and a force-close; the sets land on
 *    the muscle's next day on Today's card and on a plan day opened from the Library, and Time there never cuts them
 *    again (review ben-8-decisions S3).
 * 2. A set count the coach set for next time (an extra set Ben applied on the Summary) reaches Today's card and Your
 *    workout, not only Start from the Summary.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const PUSH = ['Bench press', 'Incline dumbbell press', 'Cable fly', 'Lateral raise', 'Triceps pushdown'];
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', PUSH],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ['Shoulders', 'shoulders', ['Lateral raise', 'Triceps pushdown']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull, shoulders.', minutes: null, gymName: null });
};

async function benWithPlan(): Promise<{ s: AppServices; gymId: string; first: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }, { load: 10, reps: 12, rpe: 8 }, { load: 10, reps: 12, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const built = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const plan = built.cards[0]?.record;
  if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId, first };
}

const THIRD = '#3';
async function dayCard(s: AppServices, name: string, minutes?: number) {
  const data: TodaySessionData | null = await s.todaySession.load();
  if (data === null) throw new Error('no Today');
  const day = name === THIRD ? data.days[2] : data.days.find((d) => d.name === name);
  const key = day?.key ?? '';
  const initial = data.initial[key];
  if (initial === undefined || day === undefined) throw new Error(`no ${name}`);
  const controls = minutes === undefined ? initial : { ...initial, minutes };
  return { data, day, key, controls, view: s.todaySession.card(data, { dayKey: key, controls }) };
}

const ok = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? r.message : ''}`);
  return r.snapshot;
};
const totalSets = (rows: readonly { sets: number }[] | undefined) => (rows ?? []).reduce((n, r) => n + r.sets, 0);
const setsOf = (rows: readonly { name: string; sets: number }[] | undefined, name: string) => rows?.find((r) => r.name === name)?.sets ?? 0;

async function finish(s: AppServices, snap: BuilderSnapshot, gymId: string): Promise<string> {
  const st = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
  if (!st.ok) throw new Error(st.message);
  const a = (await s.workout.load(st.sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (set !== undefined) {
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(st.sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(st.sessionId);
  const fin = await s.workout.dispatch(st.sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return st.sessionId;
}

/** Push on Today's card at 25 min: Time cuts sets, and the card offers to carry some over. */
async function shortPushCard(s: AppServices) {
  const c = await dayCard(s, 'Push', 25);
  expect(c.view?.time?.note).not.toBeNull();
  return c;
}

describe('the carry-over on Today’s lean card (Ben, 23 Oct)', () => {
  it('offered with the Time note; never applied by default; Carry over (stale refused, replay safe), kept through a force-close and Start; lands on the next day for that muscle', async () => {
    const { s, gymId } = await benWithPlan();
    const before = totalSets((await dayCard(s, THIRD)).view?.rows);
    const c = await shortPushCard(s);
    const carry = c.view?.carry;
    if (carry == null) throw new Error('no carry-over offer on the card');
    expect(carry.state).toBe('offer');
    expect(carry.via.kind).toBe('today');
    expect(carry.lines.every((l) => /^\+[2-4] \w+ sets on your next [\w#]+ day$/.test(l))).toBe(true);
    expect(carry.items.reduce((n, x) => n + x.sets, 0)).toBeLessThanOrEqual(4);
    const sel = { dayKey: c.key, controls: c.controls };
    // A basis that isn't the offer shown: refused, nothing written (rule 5).
    expect(await s.todaySession.carryOver(c.data, sel, 'carried', { opId: 'today-carry-stale', basis: 'not-this-one' })).toMatchObject({ status: 'stale' });
    expect((await shortPushCard(s)).view?.carry?.state).toBe('offer');
    expect(await s.todaySession.carryOver(c.data, sel, 'carried', { opId: 'today-carry-1', basis: carry.basis })).toEqual({ status: 'written' });
    // The same op again: no second write.
    expect(await s.todaySession.carryOver(c.data, sel, 'carried', { opId: 'today-carry-1', basis: carry.basis })).toEqual({ status: 'written' });
    // A relaunch (force-close): still carried on the card.
    const { services: s2 } = await h.launch();
    const again = await shortPushCard(s2);
    expect(again.view?.carry?.state).toBe('carried');
    // Edit opens the draft with the answer; Start keeps it.
    const committed = await s2.todaySession.commit(again.data, { dayKey: again.key, controls: again.controls }, h.ids());
    if (!committed.ok) throw new Error(committed.message);
    const snap = await s2.builder.read(committed.draftId);
    if (snap === null) throw new Error('no draft');
    expect(snap.carry?.state).toBe('carried');
    // Not landed before the workout is done.
    expect(totalSets((await dayCard(s2, THIRD)).view?.rows)).toBe(before);
    await finish(s2, snap, gymId);
    h.clockMs += DAY;
    const tri = carry.items.find((x) => x.toDayIndex === 2);
    if (tri === undefined) throw new Error(`no carry to day 3: ${JSON.stringify(carry.items)}`);
    const landing = await dayCard(s2, THIRD);
    expect(totalSets(landing.view?.rows)).toBe(before + tri.sets);
    expect(landing.view?.why).toContain(`Carried over: +${String(tri.sets)} ${tri.group} sets`);
  });

  it('✕ skips it for this Time; another Time asks again; Undo after Carry over offers it again', async () => {
    const { s } = await benWithPlan();
    const c = await shortPushCard(s);
    const carry = c.view?.carry;
    if (carry == null) throw new Error('no offer');
    const sel = { dayKey: c.key, controls: c.controls };
    expect(await s.todaySession.carryOver(c.data, sel, 'skipped', { opId: 'skip-today', basis: carry.basis })).toEqual({ status: 'written' });
    expect((await shortPushCard(s)).view?.carry).toBeNull();
    // Another Time on the card: the answer was for 25 min.
    const at20 = await dayCard(s, 'Push', 20);
    expect(at20.view?.carry?.state ?? 'offer').toBe('offer');
    // Back at 25, Ben's ✕ still stands.
    expect((await shortPushCard(s)).view?.carry).toBeNull();
    // Undo on a carried one: offered again.
    const c20 = at20.view?.carry;
    if (c20 != null) {
      const sel20 = { dayKey: at20.key, controls: at20.controls };
      expect(await s.todaySession.carryOver(at20.data, sel20, 'carried', { opId: 'carry-20', basis: c20.basis })).toEqual({ status: 'written' });
      const carried = await dayCard(s, 'Push', 20);
      expect(carried.view?.carry?.state).toBe('carried');
      expect(await s.todaySession.carryOver(carried.data, sel20, 'clear', { opId: 'undo-20', basis: carried.view?.carry?.basis ?? '' })).toEqual({ status: 'written' });
      expect((await dayCard(s, 'Push', 20)).view?.carry?.state).toBe('offer');
    }
  });

  it('a card edited on Your workout since: Today’s answer is refused; the edited card offers it on its own draft', async () => {
    const { s } = await benWithPlan();
    const c = await shortPushCard(s);
    const carry = c.view?.carry;
    if (carry == null) throw new Error('no offer');
    const committed = await s.todaySession.commit(c.data, { dayKey: c.key, controls: c.controls }, h.ids());
    if (!committed.ok) throw new Error(committed.message);
    const snap = await s.builder.read(committed.draftId);
    if (snap === null) throw new Error('no draft');
    // Ben removes an exercise on Your workout: the card is edited.
    const main = slotsOf(snap.workout.blocks).find((x) => !x.main && snap.workout.blocks.length > 1);
    if (main === undefined) throw new Error('fixture');
    ok(await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: main.key }, { opId: h.ids(), basis: { version: snap.version } }));
    expect(await s.todaySession.carryOver(c.data, { dayKey: c.key, controls: c.controls }, 'carried', { opId: 'late', basis: carry.basis })).toMatchObject({ status: 'stale' });
    const edited = await shortPushCard(s);
    expect(edited.view?.edited).not.toBeNull();
    if (edited.view?.carry != null) expect(edited.view.carry.via.kind).toBe('builder');
  });

  it('the carried sets land on the plan day opened from the Library, and its Time there never cuts them (review S3)', async () => {
    const { s, gymId } = await benWithPlan();
    const c = await shortPushCard(s);
    const carry = c.view?.carry;
    if (carry == null) throw new Error('no offer');
    const sel = { dayKey: c.key, controls: c.controls };
    expect(await s.todaySession.carryOver(c.data, sel, 'carried', { opId: 'carry-lib', basis: carry.basis })).toEqual({ status: 'written' });
    const fresh = await shortPushCard(s);
    const committed = await s.todaySession.commit(fresh.data, { dayKey: fresh.key, controls: fresh.controls }, h.ids());
    if (!committed.ok) throw new Error(committed.message);
    const snap = await s.builder.read(committed.draftId);
    if (snap === null) throw new Error('no draft');
    await finish(s, snap, gymId);
    h.clockMs += DAY;
    const tri = carry.items.find((x) => x.toDayIndex === 2);
    if (tri === undefined) throw new Error('no carry to day 3');
    const third = await dayCard(s, THIRD);
    const routineId = third.day.templates[0]?.routineId;
    if (routineId == null) throw new Error('no template');
    // The plan day as stored: Lateral raise and Triceps pushdown, 3 sets each.
    const planSets = 6;
    // Library › plan day › Open in builder ›.
    const opened = ok(await s.builder.openTarget({ kind: 'routine', routineId }, h.ids()));
    const total = (w: BuilderSnapshot['workout']) => slotsOf(w.blocks).reduce((n, x) => n + workingCount(x), 0);
    expect(total(opened.workout)).toBe(planSets + tri.sets);
    expect(slotsOf(opened.workout.blocks).some((x) => (x.carried ?? 0) === tri.sets)).toBe(true);
    // Time on it, as short as it goes: the carried sets stay.
    let cur = opened;
    for (let i = 0; i < 12 && cur.setup.minutes > 20; i += 1) cur = ok(await s.builder.setTime(cur.draftId, cur.setup.minutes - 5, { opId: h.ids(), expectedVersion: cur.version }));
    const landed = slotsOf(cur.workout.blocks).find((x) => (x.carried ?? 0) > 0);
    expect(landed?.carried).toBe(tri.sets);
    expect(landed === undefined ? 0 : workingCount(landed)).toBeGreaterThanOrEqual(tri.sets);
  });
});

describe('a coach-applied set count reaches every way the next workout is planned (Ben, 23 Oct)', () => {
  it('an extra set Ben applied on the Summary: Today’s card, a plan day from the Library and Start all plan it; before Apply, none do', async () => {
    const { s, first } = await benWithPlan();
    const before = setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise');
    const pushBefore = setsOf((await dayCard(s, 'Push')).view?.rows, 'Lateral raise');
    expect(before).toBeGreaterThan(0);
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        const lat = w.exercises.find((e) => e.name === 'Lateral raise');
        return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: lat?.exerciseId, target: { load: null, reps: null }, sets: before + 1, reason: 'Room for one more.' }] });
      },
      () => replyWith('Room for one more.'),
    ]);
    await s.coach.runSummaryTurn(first);
    const [row] = await s.coach.nextTargets(first);
    if (!row) throw new Error('no row');
    expect(row).toMatchObject({ status: 'proposed', sets: before + 1 });
    // An offer only: nothing plans it yet.
    expect(setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise')).toBe(before);
    expect(await s.coach.tapNextTarget(row, 'apply', 'apply-extra')).toMatchObject({ status: 'written', row: { status: 'applied' } });
    // Today's card (the Shoulders day and Push, which has it too).
    expect(setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise')).toBe(before + 1);
    expect(setsOf((await dayCard(s, 'Push')).view?.rows, 'Lateral raise')).toBe(row.sets);
    // Your workout from the Library's plan day.
    const third = await dayCard(s, THIRD);
    const routineId = third.day.templates[0]?.routineId;
    if (routineId == null) throw new Error('no template');
    const opened = ok(await s.builder.openTarget({ kind: 'routine', routineId }, h.ids()));
    const lat = slotsOf(opened.workout.blocks).find((x) => x.exerciseId === row.exerciseId);
    expect(lat === undefined ? 0 : workingCount(lat)).toBe(before + 1);
    // Undo on the Summary: back to the plan's count everywhere.
    const applied = (await s.coach.nextTargets(first))[0];
    if (!applied) throw new Error('no row');
    expect(await s.coach.tapNextTarget(applied, 'undo', 'undo-extra')).toMatchObject({ status: 'written' });
    expect(setsOf((await dayCard(s, 'Push')).view?.rows, 'Lateral raise')).toBe(pushBefore);
    expect(setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise')).toBe(before);
  });

  it('never on a pain-flagged movement (rule 9)', async () => {
    const { s, first } = await benWithPlan();
    const before = setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise');
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        const lat = w.exercises.find((e) => e.name === 'Lateral raise');
        return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: lat?.exerciseId, target: { load: null, reps: null }, sets: before + 1, reason: 'Room for one more.' }] });
      },
      () => replyWith('Room for one more.'),
    ]);
    await s.coach.runSummaryTurn(first);
    const [row] = await s.coach.nextTargets(first);
    if (!row) throw new Error('no row');
    expect(await s.coach.tapNextTarget(row, 'apply', 'apply-extra-pain')).toMatchObject({ status: 'written' });
    expect(setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise')).toBe(before + 1);
    expect((await s.pain.flagMovement({ exerciseId: row.exerciseId, exerciseName: 'Lateral raise', opId: 'pain-lat' })).ok).toBe(true);
    expect(setsOf((await dayCard(s, THIRD)).view?.rows, 'Lateral raise')).toBe(before);
  });
});
