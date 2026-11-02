import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localDateOf, toMs, type HealthDayLine, type RecentSessionsView } from '@fizz/domain';
import type { ModelRequest } from '@fizz/coach';
import type { ActionRecord, SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * (Ben, 2 Nov) Fixing past workouts from the coach, end to end on real SQLite with a scripted model and a fake
 * HealthKit (synthetic data, never Ben's): the coach reads the day (`get_recent_sessions` with a date: its workouts and
 * its Health workouts with their pairing), proposes the fix as a card, and nothing changes until Apply; Undo puts it
 * back; Apply on a workout or pairing changed since is refused (rule 5); a restart keeps the card's state.
 */

let h: Harness;
let model: StepModel;
let fake: FakeHealth;
beforeEach(() => {
  model = new StepModel([]);
  fake = new FakeHealth();
  h = createHarness('2026-10-27T18:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const MIN = 60_000;
const MON_2_NOV = Date.parse('2026-11-02T09:00:00.000Z');
const launch = async () => (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;

/** The data of the last read the coach was sent back (a `function_call_output`). */
function lastRead(req: ModelRequest): RecentSessionsView {
  const out = [...req.input].reverse().find((i) => i.type === 'function_call_output');
  if (out?.type !== 'function_call_output') throw new Error('no read output');
  return (JSON.parse(out.output) as { data: RecentSessionsView }).data;
}

async function load(s: AppServices, id: string): Promise<SessionAggregate> {
  const a = (await s.workout.load(id))?.aggregate;
  if (a === undefined) throw new Error('no workout');
  return a;
}

/** A finished workout at `startIso`, named `name` (the coach reads it by name). */
async function workoutAt(s: AppServices, gymId: string, startIso: string, name: string, sets = 3): Promise<string> {
  h.clockMs = Date.parse(startIso);
  const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: Array.from({ length: sets }, () => ({ load: 60, reps: 8 })) }]);
  const a = await load(s, id);
  const r = await s.workout.dispatch(id, { type: 'rename_session', at: h.now(), opId: `name-${id}`, name, expectedVersion: a.session.version });
  if (!r.ok) throw new Error(r.error.message);
  return id;
}

async function ask(s: AppServices, text: string, steps: ConstructorParameters<typeof StepModel>[0]) {
  model = new StepModel(steps);
  return s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
}

const dayOf = (a: SessionAggregate) => localDateOf(toMs(a.session.startedAt.utc), a.session.startedAt.tz);
const doneTimes = (a: SessionAggregate) => a.sets.filter((x) => x.status === 'completed').map((x) => toMs(x.completedAt?.utc ?? ''));
const feedDates = async (s: AppServices, id: string) => (await s.history.feed({ from: '2026-10-26' })).items.filter((i) => i.kind === 'workout' && i.sessionId === id).map((i) => i.localDate);
const lastDaysWith = async (s: AppServices, title: string) => ((await s.coach.lastDays())?.days ?? []).filter((d) => d.workouts.some((w) => JSON.stringify(w).includes(title))).map((d) => d.date);

function card(r: { cards: { record: ActionRecord; rendered: { text: string } }[] }): ActionRecord {
  const c = r.cards[0];
  if (c === undefined) throw new Error('no card');
  return c.record;
}

describe('“that Tuesday pull was actually Monday” (move a workout’s date)', () => {
  it('reads the day, proposes the move, changes nothing until Apply; Apply moves it (sets with it) and every view follows; Undo puts it back', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    const id = await workoutAt(s, gymId, '2026-10-27T18:00:00.000Z', 'Pull A');
    const before = await load(s, id);
    expect(await feedDates(s, id)).toEqual(['2026-10-27']);
    h.clockMs = MON_2_NOV;

    const r = await ask(s, 'that Tuesday pull was actually Monday', [
      () => toolCall('get_recent_sessions', { count: 5, date: '2026-10-27', daysAgo: null }),
      (req) => {
        const day = lastRead(req);
        const pull = day.sessions.find((x) => x.title === 'Pull A');
        expect(pull?.time).toMatch(/^18:00–18:\d\d$/);
        return toolCall('propose_workout_fix', { op: 'move', workoutId: pull?.sessionId ?? '', healthId: null, date: '2026-10-26', start: null, end: null, reason: 'Moved to Monday.' });
      },
      () => replyWith('Moved to Monday once you apply it.'),
    ]);
    // The tool and its line come only with these words (the trimmed context).
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_workout_fix');
    expect(model.requests[0]?.instructions).toContain('Fixing past workouts');
    const proposal = card(r);
    expect(proposal.status).toBe('proposed');
    expect(r.cards[0]?.rendered.text).toMatch(/^Pull A · Tue 27 Oct · 18:00–18:\d\d → Mon 26 Oct · 18:00–18:\d\d$/);
    // Nothing changed yet (rule 2).
    expect(await load(s, id)).toEqual(before);
    expect(await s.workoutFix.card(proposal.actionId)).toEqual({ kind: 'open' });

    expect(await s.workoutFix.apply(proposal.actionId)).toEqual({ ok: true });
    const moved = await load(s, id);
    expect(dayOf(moved)).toBe('2026-10-26');
    expect(moved.session.startedAt.tz).toBe(TZ);
    expect(doneTimes(moved)).toEqual(doneTimes(before).map((t) => t - 24 * 60 * MIN));
    expect(moved.sets.map((x) => x.actual)).toEqual(before.sets.map((x) => x.actual));
    // A double tap writes once (rule 5).
    expect(await s.workoutFix.apply(proposal.actionId)).toEqual({ ok: true });
    expect((await load(s, id)).session.version).toBe(moved.session.version);
    expect(await s.workoutFix.card(proposal.actionId)).toEqual({ kind: 'applied' });
    // Derived views read it on Monday: History, the coach's last days.
    expect(await feedDates(s, id)).toEqual(['2026-10-26']);
    expect(await lastDaysWith(s, 'Pull A')).toEqual(['2026-10-26']);

    expect(await s.workoutFix.undo(proposal.actionId, 'undo-move')).toBe(true);
    const back = await load(s, id);
    expect(back.session.startedAt).toEqual(before.session.startedAt);
    expect(back.session.endedAt).toEqual(before.session.endedAt);
    expect(doneTimes(back)).toEqual(doneTimes(before));
    expect(await feedDates(s, id)).toEqual(['2026-10-27']);
    expect(await s.workoutFix.card(proposal.actionId)).toEqual({ kind: 'undone' });
  });

  it('a workout changed since the proposal is refused (stale); an applied fix survives a restart and still undoes', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    const id = await workoutAt(s, gymId, '2026-10-27T18:00:00.000Z', 'Pull A');
    h.clockMs = MON_2_NOV;
    const propose = () =>
      ask(s, 'that Tuesday pull was actually Monday', [() => toolCall('propose_workout_fix', { op: 'move', workoutId: id, healthId: null, date: '2026-10-26', start: null, end: null, reason: 'Monday.' }), () => replyWith('Here it is.')]);
    const stale = card(await propose());
    // Ben renames it on its Summary before tapping Apply: the version moved on.
    const a = await load(s, id);
    expect((await s.workout.dispatch(id, { type: 'rename_session', at: h.now(), opId: 'rename-2', name: 'Pull B', expectedVersion: a.session.version })).ok).toBe(true);
    expect(await s.workoutFix.apply(stale.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect(dayOf(await load(s, id))).toBe('2026-10-27');
    expect(await s.workoutFix.card(stale.actionId)).toEqual({ kind: 'open' });

    const fresh = card(await propose());
    expect(await s.workoutFix.apply(fresh.actionId)).toEqual({ ok: true });
    await h.forceClose();
    const s2 = await launch();
    expect(await s2.workoutFix.card(fresh.actionId)).toEqual({ kind: 'applied' });
    expect(dayOf(await load(s2, id))).toBe('2026-10-26');
    expect(await s2.workoutFix.undo(fresh.actionId, 'undo-after-restart')).toBe(true);
    expect(dayOf(await load(s2, id))).toBe('2026-10-27');
  });
});

describe('“delete the duplicate push workout from Saturday”', () => {
  it('a soft delete behind Apply: gone from History, in Recently deleted; Undo restores it; a stale one is refused', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    const first = await workoutAt(s, gymId, '2026-10-31T10:00:00.000Z', 'Push A');
    const copy = await workoutAt(s, gymId, '2026-10-31T11:30:00.000Z', 'Push A', 2);
    h.clockMs = MON_2_NOV;

    const r = await ask(s, 'delete the duplicate push workout from Saturday', [
      () => toolCall('get_recent_sessions', { count: 5, date: '2026-10-31', daysAgo: null }),
      (req) => {
        const day = lastRead(req);
        expect(day.sessions.map((x) => x.title)).toEqual(['Push A', 'Push A']);
        // The later one, with fewer sets, is the copy.
        return toolCall('propose_workout_fix', { op: 'delete', workoutId: day.sessions[0]?.sessionId ?? '', healthId: null, date: null, start: null, end: null, reason: 'The later copy.' });
      },
      () => replyWith('Delete the 11:30 copy?'),
    ]);
    const proposal = card(r);
    expect(r.cards[0]?.rendered.text).toMatch(/^Push A · Sat 31 Oct · 11:30–11:\d\d · 2 sets → Deleted$/);
    expect(await feedDates(s, copy)).toEqual(['2026-10-31']);

    expect(await s.workoutFix.apply(proposal.actionId)).toEqual({ ok: true });
    expect(await feedDates(s, copy)).toEqual([]);
    expect(await feedDates(s, first)).toEqual(['2026-10-31']);
    expect((await s.history.recentlyDeleted()).rows.map((x) => x.sessionId)).toEqual([copy]);
    // Its sets are untouched: a restore brings back exactly what was logged.
    expect(await s.workoutFix.undo(proposal.actionId, 'undo-delete')).toBe(true);
    expect(await feedDates(s, copy)).toEqual(['2026-10-31']);
    expect((await s.history.recentlyDeleted()).rows).toEqual([]);
    expect(await s.workoutFix.card(proposal.actionId)).toEqual({ kind: 'undone' });

    // Deleted from History meanwhile: the coach's Apply is out of date and writes nothing.
    const again = card(await ask(s, 'delete the duplicate push workout from Saturday', [() => toolCall('propose_workout_fix', { op: 'delete', workoutId: copy, healthId: null, date: null, start: null, end: null, reason: 'Copy.' }), () => replyWith('Here.')]));
    const row = (await s.history.feed({ from: '2026-10-26' })).workouts[copy];
    expect((await s.history.deleteWorkouts([{ sessionId: copy, expectedVersion: row?.version ?? 0 }], 'history-delete')).ok).toBe(true);
    expect(await s.workoutFix.apply(again.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
  });
});

describe('Health pairing (Garmin)', () => {
  async function read(s: AppServices): Promise<void> {
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
  }

  it('“pair my Garmin run on Thursday with the planned run”: the day read says it already counts as the planned run; nothing to pair', async () => {
    const s = await launch();
    await setUpGym(h, s);
    expect(await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'planned', date: '2026-10-29', durationS: null, distanceM: 6000, effort: null }, opId: 'plan-run' })).toMatchObject({ ok: true });
    const run = fake.addGarmin({ activityType: 37, startMs: Date.parse('2026-10-29T07:00:00.000Z'), endMs: Date.parse('2026-10-29T07:35:00.000Z'), distanceM: 6000 });
    h.clockMs = MON_2_NOV;
    await read(s);

    const r = await ask(s, 'pair my Garmin run on Thursday with the planned run', [
      () => toolCall('get_recent_sessions', { count: 5, date: '2026-10-29', daysAgo: null }),
      (req) => {
        const day = lastRead(req);
        expect(day.sessions).toEqual([]);
        expect(day.health).toEqual([{ healthId: run, source: 'Garmin', type: 'Run', time: '07:00–07:35', minutes: 35, distanceKm: 6, link: 'counts_as_planned', workoutId: null } satisfies HealthDayLine]);
        return toolCall('propose_workout_fix', { op: 'pair', workoutId: null, healthId: run, date: null, start: null, end: null, reason: 'Pair with the planned run.' });
      },
      () => replyWith('It already counts as your planned run.'),
    ]);
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', 'Not changed: Already counts as your run that day.']]);
  });

  it('a Garmin strength workout paired with the app workout: Apply links it the way the day sheet does; Undo unpairs; a pairing changed since is stale', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    const push = await workoutAt(s, gymId, '2026-10-28T17:00:00.000Z', 'Push A');
    // Recorded later that evening, not overlapping: never auto-linked.
    const g = fake.addGarmin({ activityType: 50, startMs: Date.parse('2026-10-28T19:30:00.000Z'), endMs: Date.parse('2026-10-28T20:10:00.000Z') });
    h.clockMs = MON_2_NOV;
    await read(s);
    expect((await s.health.forWorkout(push)).kind).not.toBe('linked');

    const propose = () =>
      ask(s, 'pair my Garmin workout on Wednesday with Push A', [
        () => toolCall('get_recent_sessions', { count: 5, date: '2026-10-28', daysAgo: null }),
        (req) => {
          const day = lastRead(req);
          expect(day.health?.map((x) => [x.healthId, x.link])).toEqual([[g, 'not_paired']]);
          return toolCall('propose_workout_fix', { op: 'pair', workoutId: push, healthId: g, date: null, start: null, end: null, reason: 'Same session.' });
        },
        () => replyWith('Pair it?'),
      ]);
    const r = await propose();
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['proposed', 'Garmin Strength · Not paired → Paired with Push A']]);
    expect((await s.health.forWorkout(push)).kind).not.toBe('linked');
    const proposal = card(r);
    expect(await s.workoutFix.apply(proposal.actionId)).toEqual({ ok: true });
    expect(await s.health.forWorkout(push)).toMatchObject({ kind: 'linked', healthUuid: g });
    expect(await s.workoutFix.undo(proposal.actionId, 'undo-pair')).toBe(true);
    expect((await s.health.forWorkout(push)).kind).not.toBe('linked');

    // Ben pairs and unpairs it himself on the day sheet after the coach's card: its link version moved on.
    const next = card(await propose());
    const linked = await s.health.link({ healthUuid: g, sessionId: push, opId: 'sheet-pair' });
    if (!linked.ok) throw new Error(linked.message);
    expect((await s.health.unlink({ healthUuid: g, expectedVersion: linked.version, opId: 'sheet-unpair' })).ok).toBe(true);
    expect(await s.workoutFix.apply(next.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect((await s.health.forWorkout(push)).kind).not.toBe('linked');
  });

  it('“these two strength sessions are the same workout”: the second Garmin session joins the pairing (Same workout); Undo splits it again', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    const push = await workoutAt(s, gymId, '2026-10-28T17:00:00.000Z', 'Push A');
    const a = await load(s, push);
    const startMs = toMs(a.session.startedAt.utc);
    const endMs = toMs(a.session.endedAt?.utc ?? '');
    const g = fake.addGarmin({ activityType: 50, startMs: startMs - 3 * MIN, endMs: endMs + MIN });
    h.clockMs = endMs + 60 * MIN;
    await read(s);
    // Later that evening, a second Garmin strength session (read after the first one paired).
    const evening = fake.addGarmin({ activityType: 50, startMs: endMs + 120 * MIN, endMs: endMs + 160 * MIN });
    h.clockMs = MON_2_NOV;
    await read(s);
    const wedHealth = async () => (await s.activities.between('2026-10-28', '2026-10-29')).filter((x) => x.source === 'health').map((x) => x.id);
    expect(await wedHealth()).toEqual([evening]);

    const r = await ask(s, 'these two strength sessions are the same workout', [
      () => toolCall('get_recent_sessions', { count: 5, date: '2026-10-28', daysAgo: null }),
      (req) => {
        const day = lastRead(req);
        expect(day.health?.map((x) => [x.healthId, x.link, x.workoutId])).toEqual([
          [g, 'paired', push],
          [evening, 'not_paired', null],
        ]);
        return toolCall('propose_workout_fix', { op: 'pair', workoutId: push, healthId: evening, date: null, start: null, end: null, reason: 'One session.' });
      },
      () => replyWith('Join them?'),
    ]);
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['proposed', 'Garmin Strength · Not paired → Same workout as Push A']]);
    const proposal = card(r);
    expect(await s.workoutFix.apply(proposal.actionId)).toEqual({ ok: true });
    expect(await wedHealth()).toEqual([]);
    expect(await s.workoutFix.undo(proposal.actionId, 'undo-same')).toBe(true);
    expect(await wedHealth()).toEqual([evening]);
  });

  it('unpair: Apply unlinks, Undo pairs it back', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    const push = await workoutAt(s, gymId, '2026-10-28T17:00:00.000Z', 'Push A');
    const a = await load(s, push);
    const g = fake.addGarmin({ activityType: 50, startMs: toMs(a.session.startedAt.utc) - 3 * MIN, endMs: toMs(a.session.endedAt?.utc ?? '') + MIN });
    h.clockMs = MON_2_NOV;
    await read(s);
    expect(await s.health.forWorkout(push)).toMatchObject({ kind: 'linked', healthUuid: g });
    const r = await ask(s, 'unpair the Garmin workout from Wednesday', [() => toolCall('propose_workout_fix', { op: 'unpair', workoutId: null, healthId: g, date: null, start: null, end: null, reason: 'Wrong one.' }), () => replyWith('Unpair it?')]);
    expect(r.cards[0]?.rendered.text).toBe('Garmin Strength · Paired with Push A → Not paired');
    const proposal = card(r);
    expect(await s.workoutFix.apply(proposal.actionId)).toEqual({ ok: true });
    expect((await s.health.forWorkout(push)).kind).not.toBe('linked');
    expect(await s.workoutFix.undo(proposal.actionId, 'undo-unpair')).toBe(true);
    expect(await s.health.forWorkout(push)).toMatchObject({ kind: 'linked', healthUuid: g });
  });
});

describe('the tool stays out of ordinary turns', () => {
  it('“Bench felt heavy today” carries neither the tool nor its line', async () => {
    const s = await launch();
    await setUpGym(h, s);
    await ask(s, 'Bench felt heavy today', [() => replyWith('Noted.')]);
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('propose_workout_fix');
    expect(model.requests[0]?.instructions).not.toContain('Fixing past workouts');
  });
});
