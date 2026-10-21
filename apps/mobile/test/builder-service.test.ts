import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { latestCommittedSetId, slotsOf, toMs, workingCount } from '@fizz/domain';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, SetupInput } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { buildRounds } from '../src/workout/rounds';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Workout builder v3 S3 (§2.1–§2.8, §4.4, §4.6) on real SQLite, no network
 * and no coach: Set up → Your workout → Start; idempotent writes by op ID,
 * staleness by slot revision, Undo that survives a force-close, Set up
 * changes merged or rebuilt.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Tuesday 20 Oct 2026, 17:00 in London. The coach is only used to build the plan; the builder never calls it.
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function ben(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId };
}

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((sl) => snap.facts[sl.exerciseId]?.name ?? '?');
const slotNamed = (snap: BuilderSnapshot, name: string) => {
  const sl = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === name);
  if (sl === undefined) throw new Error(`no ${name} in ${names(snap).join(', ')}`);
  return sl;
};

async function pushSetup(s: AppServices, over: Partial<SetupInput> = {}): Promise<SetupInput> {
  const base = await s.builder.initialSetup({ dayId: 'push' });
  return { ...base, ...over };
}

describe('Set up main lift with no plan day (Ben, 21 Oct)', () => {
  it('a day with no main lift of its own opens with its main compound (Pull → Barbell row), first and alone', async () => {
    const { s } = await ben();
    const setup = await s.builder.initialSetup({ dayId: 'pull' });
    const facts = await s.builder.setupFacts(setup);
    expect(facts.mainLifts[0]).toMatchObject({ name: 'Barbell row', fromProfile: false });
    expect(setup.mainLiftExerciseId).toBe(facts.mainLifts[0]?.id);
    const snap = ok(await s.builder.create({ ...setup, minutes: 40, supersets: true }, 'c-pull')).snapshot;
    expect(snap.workout.blocks[0]?.slots.map((x) => [snap.facts[x.exerciseId]?.name, x.main])).toEqual([['Barbell row', true]]);
    expect(snap.workout.blocks.slice(1).every((b) => b.slots.every((x) => !x.main))).toBe(true);
  });
});

describe('one default main lift for Set up and the coach (review builder-order S2)', () => {
  it('for every day, the coach’s day change brings the main lift Set up opens with, which leads Set up’s list', async () => {
    for (const make of [ben, benWithPlan]) {
      const { s } = await make();
      const base = await s.builder.initialSetup({ dayId: 'push' });
      const { ctx } = await s.builder.coachSetupContext(base);
      expect(ctx.days.length).toBeGreaterThan(0);
      for (const d of ctx.days) {
        const opened = await s.builder.initialSetup({ dayId: d.id });
        expect(d.defaultMainLiftExerciseId, d.id).toBe(opened.mainLiftExerciseId);
        const facts = await s.builder.setupFacts(opened);
        if (opened.mainLiftExerciseId !== null) expect(facts.mainLifts[0]?.id, d.id).toBe(opened.mainLiftExerciseId);
      }
    }
  });
});

describe('Set up → Your workout → Start, offline (§8 S3)', () => {
  it('builds Push from Set up, starts with no network, and the first set logs at the top set Ben saw', async () => {
    const { s, gymId } = await ben();
    const setup = await pushSetup(s, { minutes: 60, supersets: true });
    expect(setup.dayName).toBe('Push');
    const facts = await s.builder.setupFacts(setup);
    expect(facts.recommended.count).toBeGreaterThan(0);
    expect(facts.recommended.count).toBeLessThanOrEqual(7);
    expect(facts.days.ppl.map((d) => d.id)).toEqual(['push', 'pull', 'legs']);

    const created = ok(await s.builder.create(setup, 'create-1'));
    const snap = created.snapshot;
    expect(slotsOf(snap.workout.blocks).length).toBeGreaterThan(0);
    expect(snap.minutes).toBeGreaterThan(0);
    expect(snap.startable).toBe(true);
    expect(snap.planDay).toBeNull();

    // Not a plan day: no prompt (§2.8).
    expect(await s.builder.startPrompt(snap.draftId)).toBeNull();
    const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-1', expectedVersion: snap.version, gymId });
    expect(started).toMatchObject({ ok: true, duplicate: false, planChange: null });
    if (!started.ok) return;
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    expect(a?.session.status).toBe('active');
    // Each slot's first working target is the builder's (loads stand as built, §3.1).
    for (const slot of slotsOf(snap.workout.blocks)) {
      const row = slot.rows.find((r) => r.type !== 'warmup');
      const ex = a?.exercises.find((e) => e.exerciseId === slot.exerciseId);
      const first = a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup').sort((x, y) => x.index - y.index)[0];
      if (row?.load != null) expect(first?.planned.load?.value).toBe(row.load);
    }
    const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
    if (a === undefined || set === undefined) throw new Error('no set');
    const ex = a.exercises.find((e) => e.id === set.sessionExerciseId);
    const logged = await s.workout.dispatch(a.session.id, { type: 'log_set', at: h.now(), opId: 'log-first', setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: ex?.loadConvention ?? 'total' }, reps: 6, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    // The retried Start returns the same session; nothing more is written.
    const again = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-1', expectedVersion: snap.version, gymId });
    expect(again).toMatchObject({ ok: true, duplicate: true, sessionId: started.sessionId });
  });

  it('the bench top set is the one the history gives, rounded down at this gym', async () => {
    const { s } = await ben();
    const snap = ok(await s.builder.create(await pushSetup(s, { mainLiftExerciseId: null }), 'c-bench')).snapshot;
    const setup = { ...snap.setup };
    const bench = (await s.builder.setupFacts(setup)).mainLifts.find((m) => m.name === 'Bench press');
    expect(bench).toBeDefined();
    const withBench = ok(await s.builder.changeSetup(snap.draftId, { ...setup, mainLiftExerciseId: bench?.id ?? null }, { opId: 'main-1', expectedVersion: snap.version })).snapshot;
    const main = slotsOf(withBench.workout.blocks).find((x) => x.main);
    expect(main?.exerciseId).toBe(bench?.id);
    const top = main?.rows.find((r) => r.type === 'top');
    // 100 × 6 @ 8 last time: the built-in rule's next target; every warm-up is lighter and loadable.
    expect(main?.source).toBe('rule');
    expect(top?.load).toBe(102.5);
    const warm = main?.rows.filter((r) => r.type === 'warmup').map((r) => r.load ?? 0) ?? [];
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.every((w) => w < (top?.load ?? 0))).toBe(true);
    expect(await s.builder.whyWeight(withBench.draftId, main?.key ?? '')).toEqual(['Last time + 2.5']);
  });
});

describe('writes: idempotent by op ID, one open draft per day, staleness by slot revision (rule 5)', () => {
  it('the same op twice writes once; another Next for the same day and date resumes the open draft', async () => {
    const { s } = await ben();
    const setup = await pushSetup(s);
    const a = ok(await s.builder.create(setup, 'c-1')).snapshot;
    const b = await s.builder.create(setup, 'c-1');
    expect(b.status).toBe('replayed');
    const c = ok(await s.builder.create(setup, 'c-2'));
    expect(c.snapshot.draftId).toBe(a.draftId);

    const first = slotsOf(a.workout.blocks).find((x) => !x.main);
    if (first === undefined) throw new Error('no accessory');
    const e1 = ok(await s.builder.edit(a.draftId, { kind: 'add_set', slotKey: first.key }, { opId: 'e-1', basis: { version: a.version } }));
    expect(e1.status).toBe('written');
    const e1again = await s.builder.edit(a.draftId, { kind: 'add_set', slotKey: first.key }, { opId: 'e-1', basis: { version: a.version } });
    expect(e1again.status).toBe('replayed');
    const read = await s.builder.read(a.draftId);
    expect(workingCount(slotsOf(read?.workout.blocks ?? []).find((x) => x.key === first.key) ?? { rows: [] })).toBe(workingCount(first) + 1);
    expect(read?.version).toBe(e1.snapshot.version);
  });

  it('an edit naming only its slot applies after an edit elsewhere; one on a moved slot or an old version is refused', async () => {
    const { s } = await ben();
    const snap = ok(await s.builder.create(await pushSetup(s, { supersets: false }), 'c-1')).snapshot;
    const [x, y] = slotsOf(snap.workout.blocks).filter((sl) => !sl.main);
    if (x === undefined || y === undefined) throw new Error('need two accessories');
    const xRev = snap.revs[x.key] ?? 1;
    ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: y.key }, { opId: 'y-1', basis: { slots: [{ slotKey: y.key, rev: snap.revs[y.key] ?? 1 }] } }));
    // Only x's revision is named: y's change doesn't make it stale.
    const xEdit = await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: x.key }, { opId: 'x-1', basis: { slots: [{ slotKey: x.key, rev: xRev }] } });
    expect(xEdit.status).toBe('written');
    // x moved: the same revision again is refused and nothing changes.
    const before = await s.builder.read(snap.draftId);
    const stale = await s.builder.edit(snap.draftId, { kind: 'delete_set', slotKey: x.key, index: 0 }, { opId: 'x-2', basis: { slots: [{ slotKey: x.key, rev: xRev }] } });
    expect(stale.status).toBe('stale');
    const old = await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: y.key }, { opId: 'v-old', basis: { version: snap.version } });
    expect(old.status).toBe('stale');
    expect((await s.builder.read(snap.draftId))?.version).toBe(before?.version);
  });
});

describe('Undo survives a force-close (§4.4, §8 S3)', () => {
  it('three edits, force-close, reopen: the edits are there and Undo of the last one still works once', async () => {
    const { s } = await ben();
    let snap = ok(await s.builder.create(await pushSetup(s, { supersets: false }), 'c-1')).snapshot;
    const acc = slotsOf(snap.workout.blocks).filter((x) => !x.main);
    const [a, b] = acc;
    if (a === undefined || b === undefined) throw new Error('need accessories');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: a.key }, { opId: 'e-1', basis: { version: snap.version } })).snapshot;
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'move', slotKey: b.key, dir: 'up' }, { opId: 'e-2', basis: { version: snap.version } })).snapshot;
    const del = ok(await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: b.key }, { opId: 'e-3', basis: { version: snap.version } }));
    expect(del.toast?.text).toMatch(/^Deleted /);
    expect(del.toast?.undoOpId).toBe('e-3');
    const after = names(del.snapshot);

    await h.forceClose();
    const { services: s2 } = await h.launch();
    const reopened = await s2.builder.read(snap.draftId);
    expect(reopened && names(reopened)).toEqual(after);
    expect(reopened?.undo).toEqual({ opId: 'e-3' });
    const undone = ok(await s2.builder.undo(snap.draftId, 'e-3', 'u-1'));
    expect(names(undone.snapshot)).toEqual(names(snap));
    expect(undone.snapshot.undo).toBeNull();
    const twice = await s2.builder.undo(snap.draftId, 'e-3', 'u-2');
    expect(twice.status).toBe('refused');
  });

  it('Undo is refused once something changed since that edit', async () => {
    const { s } = await ben();
    let snap = ok(await s.builder.create(await pushSetup(s), 'c-1')).snapshot;
    const a = slotsOf(snap.workout.blocks).find((x) => !x.main);
    if (a === undefined) throw new Error('no accessory');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: a.key }, { opId: 'e-1', basis: { version: snap.version } })).snapshot;
    ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: a.key }, { opId: 'e-2', basis: { version: snap.version } }));
    const r = await s.builder.undo(snap.draftId, 'e-1', 'u-1');
    expect(r).toMatchObject({ status: 'refused' });
  });
});

describe('Back to Set up: merge or rebuild (§2.3)', () => {
  it('a length or group change keeps an earlier swap; a main lift change rebuilds and Undo restores both pages', async () => {
    const { s } = await ben();
    let snap = ok(await s.builder.create(await pushSetup(s, { supersets: false, minutes: 60 }), 'c-1')).snapshot;
    const acc = slotsOf(snap.workout.blocks).find((x) => !x.main);
    if (acc === undefined) throw new Error('no accessory');
    const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: acc.key });
    const to = choices?.sections.flatMap((sec) => sec.items).find((i) => !i.mayHurt);
    if (to === undefined) throw new Error('no swap choice');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: acc.key, exerciseId: to.exerciseId }, { opId: 'swap-1', basis: { version: snap.version } })).snapshot;
    expect(names(snap)).toContain(to.name);

    const longer = ok(await s.builder.changeSetup(snap.draftId, { ...snap.setup, minutes: 75 }, { opId: 'len-1', expectedVersion: snap.version })).snapshot;
    expect(longer.setup.minutes).toBe(75);
    expect(names(longer)).toContain(to.name);

    const facts = await s.builder.setupFacts(longer.setup);
    const other = facts.mainLifts.find((m) => m.id !== longer.setup.mainLiftExerciseId);
    if (other === undefined) throw new Error('no other main lift');
    const rebuilt = ok(await s.builder.changeSetup(longer.draftId, { ...longer.setup, mainLiftExerciseId: other.id }, { opId: 'main-1', expectedVersion: longer.version }));
    expect(rebuilt.toast).toEqual({ text: 'Rebuilt', undoOpId: 'main-1', why: null });
    expect(slotsOf(rebuilt.snapshot.workout.blocks).find((x) => x.main)?.exerciseId).toBe(other.id);
    const back = ok(await s.builder.undo(longer.draftId, 'main-1', 'u-1')).snapshot;
    expect(back.setup).toEqual(longer.setup);
    expect(names(back)).toEqual(names(longer));
  });

  it('pairing two exercises that share a muscle stays, with the reason and Undo', async () => {
    const { s } = await ben();
    const snap = ok(await s.builder.create(await pushSetup(s, { supersets: false }), 'c-1')).snapshot;
    const singles = snap.workout.blocks.filter((b) => b.slots.length === 1 && b.slots[0]?.main !== true);
    let advised = false;
    for (const b of singles) {
      const sl = b.slots[0];
      if (sl === undefined) continue;
      const r = await s.builder.edit(snap.draftId, { kind: 'superset_next', slotKey: sl.key }, { opId: `pair-${sl.key}`, basis: { version: (await s.builder.read(snap.draftId))?.version ?? 0 } });
      if (r.status === 'written' && r.toast !== null) {
        expect(r.toast.text).toMatch(/^Not recommended: /);
        expect(r.toast.why).not.toBeNull();
        expect(r.toast.undoOpId).toBe(`pair-${sl.key}`);
        advised = true;
        break;
      }
    }
    expect(advised).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plan days: templates, the Start prompt, variations (§2.8, §4.2, §4.3, §4.6)

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', ['Bench press', 'Incline dumbbell press', 'Triceps pushdown']],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ['Legs', 'legs', ['Back squat', 'Leg curl']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

async function benWithPlan(): Promise<{ s: AppServices; gymId: string; push: string }> {
  const { s, gymId } = await ben();
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = result.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const active = await s.plans.active();
  const push = active?.days[0]?.routineId;
  if (push === undefined) throw new Error('no push day');
  return { s, gymId, push };
}

const template = async (s: AppServices, id: string) => (await s.routines.editor({ routineId: id, gymId: null }))?.routine ?? null;

/** Log one set and finish, so the next Start can run (one workout at a time). */
async function finish(s: AppServices, sessionId: string): Promise<void> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (a === undefined || set === undefined) throw new Error('no set');
  const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
  h.clockMs += 60_000;
  expect((await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() })).ok).toBe(true);
  h.clockMs += 60_000;
  const now = await s.workout.load(sessionId);
  expect((await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null })).ok).toBe(true);
  await h.settle(s);
  h.clockMs += DAY;
}

async function swapOne(s: AppServices, snap: BuilderSnapshot, name: string, opId: string): Promise<{ snap: BuilderSnapshot; to: string }> {
  const from = slotNamed(snap, name);
  const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: from.key });
  const to = choices?.sections.flatMap((x) => x.items).find((i) => !i.mayHurt);
  if (to === undefined) throw new Error('no swap');
  return { snap: ok(await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: from.key, exerciseId: to.exerciseId }, { opId, basis: { version: snap.version } })).snapshot, to: to.name };
}

describe('plan-day templates and the Start prompt (§2.8, Q11)', () => {
  it('Edit opens the template with no rebuild; load-only edits skip the prompt; Today only leaves the template alone and records the plan day', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    expect(names(snap)).toEqual(['Bench press', 'Incline dumbbell press', 'Triceps pushdown']);
    expect(snap.planDay).toMatchObject({ splitDayId: 'push', dayIndex: 0, templateRoutineId: push, templateVersion: before?.version });
    expect(await s.builder.startPrompt(snap.draftId)).toBeNull();

    // A typed kg is a load-only edit: still no prompt.
    const pd = slotNamed(snap, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: pd.key, index: pd.rows.findIndex((r) => r.type !== 'warmup'), patch: { kind: 'load', value: 30 } }, { opId: 'kg-1', basis: { version: snap.version } })).snapshot;
    expect(await s.builder.startPrompt(snap.draftId)).toBeNull();

    // Swapping a template main (the plan marks Bench and Incline DB as main) can't be a variation:
    // the ops never remove a main (review S3), so only Today only / Update are offered.
    const mainSwap = await swapOne(s, snap, 'Incline dumbbell press', 'swap-main');
    expect((await s.builder.startPrompt(mainSwap.snap.draftId))?.canSaveVariation).toBe(false);
    snap = ok(await s.builder.undo(snap.draftId, 'swap-main', 'undo-main')).snapshot;

    const swapped = await swapOne(s, snap, 'Triceps pushdown', 'swap-1');
    snap = swapped.snap;
    const prompt = await s.builder.startPrompt(snap.draftId);
    expect(prompt?.lines).toEqual([`Triceps pushdown → ${swapped.to}`]);
    expect(prompt?.updateLabel).toMatch(/^Update Push · .+ in your plan$/);
    expect(prompt?.canSaveVariation).toBe(true);
    expect(prompt?.variationLimitReached).toBe(false);

    const r = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-today', expectedVersion: snap.version, gymId });
    expect(r).toMatchObject({ ok: true, planChange: null });
    if (!r.ok) return;
    expect((await template(s, push))?.version).toBe(before?.version);
    const a = (await s.workout.load(r.sessionId))?.aggregate;
    expect(a?.session.planDay).toMatchObject({ splitDayId: 'push', dayIndex: 0, templateRoutineId: push, templateVersion: before?.version, variationId: null });
    expect(a?.exercises.map((e) => e.exerciseName)).toContain(swapped.to);
  });

  it('Save as new variation: the variation and the session land together; a retry writes neither again', async () => {
    const { s, gymId, push } = await benWithPlan();
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: null, group: 'Biceps' });
    const curl = choices?.sections.flatMap((x) => x.items).find((i) => !i.mayHurt);
    if (curl === undefined) throw new Error('no biceps exercise');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: curl.exerciseId }, { opId: 'add-1', basis: { version: snap.version } })).snapshot;
    const pd = slotNamed(snap, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'superset_next', slotKey: pd.key }, { opId: 'pair-1', basis: { version: snap.version } })).snapshot;
    const prompt = await s.builder.startPrompt(snap.draftId);
    expect(prompt?.lines).toEqual([`Add ${curl.name}`, `Superset Triceps pushdown with ${curl.name}`]);
    expect(prompt?.suggestedLabel).toBe('arms superset');

    const r = await s.builder.start(snap.draftId, { choice: { kind: 'variation', label: 'arms superset' }, opId: 'start-var', expectedVersion: snap.version, gymId });
    expect(r).toMatchObject({ ok: true, planChange: { kind: 'variation_new' } });
    if (!r.ok) return;
    const variations = (await s.builder.setupFacts(snap.setup)).variations;
    expect(variations.map((v) => v.label)).toEqual(['arms superset']);
    const a = (await s.workout.load(r.sessionId))?.aggregate;
    expect(a?.session.planDay?.variationId).not.toBeNull();
    const again = await s.builder.start(snap.draftId, { choice: { kind: 'variation', label: 'arms superset' }, opId: 'start-var', expectedVersion: snap.version, gymId });
    expect(again).toMatchObject({ ok: true, duplicate: true, sessionId: r.sessionId });
    expect((await s.builder.setupFacts(snap.setup)).variations).toHaveLength(1);

    // Opening the variation later: the template plus its extras.
    await finish(s, r.sessionId);
    const variationId = variations[0]?.id ?? null;
    const reopened = ok(await s.builder.openTemplate({ routineId: push, variationId }, 'open-2')).snapshot;
    expect(names(reopened)).toContain(curl.name);
    expect(reopened.workout.blocks.some((b) => b.slots.length === 2)).toBe(true);
    expect(reopened.variationLabel).toBe('arms superset');
    expect(await s.builder.startPrompt(reopened.draftId)).toBeNull();
  });

  it('Update in your plan: the template and the session in one write; Undo restores it and is refused once it changed again', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const pd = slotNamed(snap, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: pd.key }, { opId: 'set-1', basis: { version: snap.version } })).snapshot;
    expect((await s.builder.startPrompt(snap.draftId))?.lines).toEqual(['Triceps pushdown: 3 → 4 sets']);
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'update' }, opId: 'start-up', expectedVersion: snap.version, gymId });
    expect(r).toMatchObject({ ok: true, planChange: { kind: 'template', routineId: push } });
    if (!r.ok || r.planChange === null) return;
    const after = await template(s, push);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    const pushdown = after?.exercises.find((e) => e.exerciseId === pd.exerciseId);
    expect(pushdown?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(4);
    // Loads stay the rules' each week (Q6): no load is stored on the template.
    expect(after?.exercises.every((e) => e.setTemplates.every((t) => t.targetLoad === null))).toBe(true);
    expect(after?.planDay).toMatchObject({ splitDayId: 'push', dayIndex: 0 });
    expect((await s.workout.load(r.sessionId))?.aggregate.session.planDay).toMatchObject({ templateRoutineId: push, templateVersion: after?.version });

    expect(await s.builder.undoPlanChange(r.planChange, 'undo-plan-1')).toEqual({ ok: true });
    const restored = await template(s, push);
    expect(restored?.exercises.find((e) => e.exerciseId === pd.exerciseId)?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(3);
    expect(await s.builder.undoPlanChange(r.planChange, 'undo-plan-2')).toEqual({ ok: false, message: 'Changed since · can’t undo' });
  });

  it('a template changed since it was opened refuses the update and starts nothing (rule 5); at 5 variations the save says Limit reached', async () => {
    const { s, gymId, push } = await benWithPlan();
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const pd = slotNamed(snap, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: pd.key }, { opId: 'set-1', basis: { version: snap.version } })).snapshot;
    // The template moves elsewhere (the library editor, a coach plan change).
    const t = await template(s, push);
    if (t === null) throw new Error('no template');
    const renamed = await s.routines.rename({ routineId: push, name: 'Push A', expectedVersion: t.version, opId: 'rename-1' });
    expect(renamed.ok).toBe(true);
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'update' }, opId: 'start-up', expectedVersion: snap.version, gymId });
    expect(r).toEqual({ ok: false, reason: 'plan_changed', message: 'Your plan changed. Today only?' });
    expect(await s.sessions.active()).toBeNull();
    const stale = await s.builder.read(snap.draftId);
    expect(stale?.startable).toBe(true);
    // A variation is refused too (made on the old template, review S2); Reload opens the new one, with Undo.
    expect(await s.builder.start(snap.draftId, { choice: { kind: 'variation', label: 'v0' }, opId: 'start-v0', expectedVersion: snap.version, gymId })).toMatchObject({ ok: false, reason: 'plan_changed' });
    expect(stale?.planDayChanged?.text).toMatch(/ changed$/);
    expect(stale?.planDayChanged?.silent).toBe(false);
    const reloaded = ok(await s.builder.reloadPlanDay(snap.draftId, { opId: 'reload-1', expectedVersion: stale?.version ?? 0 }));
    expect(reloaded.toast).toEqual({ text: 'Reloaded', undoOpId: 'reload-1', why: null });
    expect(reloaded.snapshot.planDayChanged).toBeNull();
    const p1 = slotNamed(reloaded.snapshot, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: p1.key }, { opId: 'set-1-again', basis: { version: reloaded.snapshot.version } })).snapshot;

    // Five saved variations: the sixth is refused in the write, and nothing starts.
    for (let i = 1; i <= 5; i += 1) {
      const fresh = await s.builder.read(snap.draftId);
      if (fresh === null) throw new Error('draft');
      const sv = await s.builder.start(fresh.draftId, { choice: { kind: 'variation', label: `v${String(i)}` }, opId: `var-${String(i)}`, expectedVersion: fresh.version, gymId });
      expect(sv.ok).toBe(true);
      if (!sv.ok) return;
      await finish(s, sv.sessionId);
      const next = ok(await s.builder.openTemplate({ routineId: push }, `reopen-${String(i)}`)).snapshot;
      const p2 = slotNamed(next, 'Triceps pushdown');
      ok(await s.builder.edit(next.draftId, { kind: 'add_set', slotKey: p2.key }, { opId: `set-${String(i)}-b`, basis: { version: next.version } }));
      snap = next;
    }
    const last = await s.builder.read(snap.draftId);
    if (last === null) throw new Error('draft');
    expect((await s.builder.startPrompt(last.draftId))?.variationLimitReached).toBe(true);
    const sixth = await s.builder.start(last.draftId, { choice: { kind: 'variation', label: 'v6' }, opId: 'var-6', expectedVersion: last.version, gymId });
    expect(sixth).toEqual({ ok: false, reason: 'variation_limit', message: 'Limit reached' });
    expect(await s.sessions.active()).toBeNull();
  });
});

/**
 * b3 merge: a workout started from the builder reads the same in the v3
 * round page (workout-table-v3 §1–§2): one round per builder block, supersets
 * as `3a` / `3b`, warm-ups as `W` (not counted), `Top` / `Back-off` under the
 * number, the builder's target RPE as `@9`, its loads and its load source.
 */
describe('builder Start → the v3 rounds (b3 merge)', () => {
  it('rounds, labels, set types, target RPE and loads are the builder’s', async () => {
    const { s, gymId } = await ben();
    // Arm isolations: something the builder may pair (heavy lifts never pair, Ben 21 Oct).
    const groups = [
      { group: 'Chest' as const, count: 2 },
      { group: 'Triceps' as const, count: 2 },
      { group: 'Biceps' as const, count: 1 },
    ];
    const snap = ok(await s.builder.create(await pushSetup(s, { minutes: 60, supersets: true, groups, groupsEdited: true }), 'c-v3')).snapshot;
    const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-v3', expectedVersion: snap.version, gymId });
    if (!started.ok) throw new Error('not started');
    const data = await s.workout.load(started.sessionId);
    if (!data) throw new Error('no workout');
    const table = s.workout.tableView(data, toMs(h.now().utc), null);
    const rounds = buildRounds(table, (id) => data.worksLines?.[id] ?? null, latestCommittedSetId(data.aggregate));

    // One round per builder block; a superset's members are `Na` / `Nb`.
    expect(rounds.map((r) => r.exercises.map((e) => e.label))).toEqual(snap.workout.blocks.map((b, i) => (b.slots.length > 1 ? b.slots.map((_, j) => `${String(i + 1)}${String.fromCharCode(97 + j)}`) : [String(i + 1)])));
    expect(snap.workout.blocks.some((b) => b.slots.length > 1)).toBe(true);

    for (const [i, block] of snap.workout.blocks.entries()) {
      for (const [j, slot] of block.slots.entries()) {
        const ex = rounds[i]?.exercises[j];
        expect(ex?.exerciseId).toBe(slot.exerciseId);
        expect(ex?.subline).not.toBeNull();
        expect(ex?.rows.map((r) => r.warmup)).toEqual(slot.rows.map((r) => r.type === 'warmup'));
        expect(ex?.rows.filter((r) => r.warmup).every((r) => r.label === 'W' && r.number === null && r.rpe === null)).toBe(true);
        expect(ex?.rows.filter((r) => !r.warmup).map((r) => r.number)).toEqual(slot.rows.filter((r) => r.type !== 'warmup').map((_, k) => k + 1));
        expect(ex?.rows.map((r) => r.typeLabel)).toEqual(slot.rows.map((r) => (r.type === 'top' ? 'Top' : r.type === 'backoff' ? 'Back-off' : r.type === 'drop' ? 'Drop' : null)));
        expect(ex?.rows.map((r) => r.rpe)).toEqual(slot.rows.map((r) => (r.type === 'warmup' || r.rpe === null ? null : `@${String(r.rpe)}`)));
        expect(ex?.progress).toEqual({ done: 0, total: slot.rows.filter((r) => r.type !== 'warmup').length });
        // The builder's load stands, with its source kept on the set.
        const sets = data.aggregate.sets.filter((x) => x.sessionExerciseId === ex?.sessionExerciseId).sort((x, y) => x.index - y.index);
        expect(sets.map((x) => x.planned.load?.value ?? null)).toEqual(slot.rows.map((r) => r.load));
      }
    }
    // The main lift's Top set and back-offs, as built.
    const main = slotsOf(snap.workout.blocks).find((x) => x.main);
    expect(main?.rows.some((r) => r.type === 'top' || r.type === 'backoff') ?? true).toBe(true);
  });

  it('a plan-day Start keeps its provenance, and the +N min fit never trims the plan’s main lifts', async () => {
    const { s, gymId, push } = await benWithPlan();
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-v3')).snapshot;
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-v3-plan', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error('not started');
    const data = await s.workout.load(r.sessionId);
    if (!data) throw new Error('no workout');
    expect(data.aggregate.session.planDay).toMatchObject({ splitDayId: 'push', dayIndex: 0, templateRoutineId: push });
    const offer = s.workout.timeFit(data, 30);
    const mains = new Set(slotsOf(snap.workout.blocks).filter((x) => x.main).map((x) => x.exerciseId));
    const mainRows = new Set(data.aggregate.exercises.filter((e) => mains.has(e.exerciseId)).map((e) => e.id));
    for (const l of offer?.lines ?? []) if (l.kind === 'sets' || l.kind === 'drop') expect(mainRows.has(l.sessionExerciseId)).toBe(false);
  });
});
