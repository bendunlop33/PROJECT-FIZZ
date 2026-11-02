import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activityRow, type PlannedLinkState } from '@fizz/domain';
import type { ActionRecord, Activity } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { daySheetRows, pairedDaySheetRows } from '../src/today/today-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { FakeHealth } from './fake-health';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov: "should be able to link a planned run which then updates it to an actual run (on the same day) otherwise
 * its just missed") End to end on real SQLite with a fake HealthKit (made-up runs, never Ben's): the day sheet's Link /
 * Unlink on a planned run, the same day only, Ben picking when two ran; the coach's pair / unpair as an Apply / Undo
 * card through the same write; stale and repeated writes change nothing (rule 5); a past planned run with nothing
 * linked or matched reads Missed.
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

const THU = '2026-10-29';
const MON_2_NOV = Date.parse('2026-11-02T09:00:00.000Z');
const RUN = 37;
const launch = async () => (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;

async function read(s: AppServices): Promise<void> {
  await s.health.setSwitch('readActivities', true);
  await s.health.readNow();
}

async function plannedRun(s: AppServices, date = THU, distanceM = 8000): Promise<string> {
  const id = h.ids();
  expect(await s.activities.add({ id, fields: { kind: 'run', status: 'planned', date, durationS: null, distanceM, effort: 'easy' }, opId: `plan-${id}` })).toMatchObject({ ok: true });
  return id;
}

/** Two made-up Garmin runs on Thursday: 07:00–07:30 (5 km) and 18:00–18:50 (10 km), London time. */
function twoRuns(): { morning: string; evening: string } {
  const morning = fake.addGarmin({ activityType: RUN, startMs: Date.parse(`${THU}T07:00:00.000Z`), endMs: Date.parse(`${THU}T07:30:00.000Z`), distanceM: 5000 });
  const evening = fake.addGarmin({ activityType: RUN, startMs: Date.parse(`${THU}T18:00:00.000Z`), endMs: Date.parse(`${THU}T18:50:00.000Z`), distanceM: 10000 });
  return { morning, evening };
}

const thursday = (s: AppServices) => s.activities.between(THU, '2026-10-30');
const mine = async (s: AppServices, id: string): Promise<Activity | undefined> => (await thursday(s)).find((a) => a.id === id);
const stored = async (s: AppServices, id: string): Promise<Activity> => {
  const a = await s.activities.get(id);
  if (a === null) throw new Error('no activity');
  return a;
};
/** Values carry no-break spaces (`5\u00a0km`); compared as plain spaces. */
const sp = (t: string | undefined) => t?.replaceAll('\u00a0', ' ');
const open = (st: PlannedLinkState | undefined) => {
  if (st?.state !== 'open') throw new Error(`not open: ${st?.state ?? 'none'}`);
  return st;
};

describe('day sheet: Link / Unlink a planned run', () => {
  it('two runs that day: Ben picks one; the planned run reads done with that run as recorded (provenance kept); the other stays on its own; Unlink puts it back', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const plan = await plannedRun(s);
    const { morning, evening } = twoRuns();
    h.clockMs = MON_2_NOV;
    await read(s);

    // Two runs: no automatic match, so the plan is open with both, earliest first.
    expect((await mine(s, plan))?.fields.status).toBe('planned');
    const st = open((await s.activities.links(THU))[plan]);
    expect(st.choices.map((c) => [c.healthUuid, sp(c.label)])).toEqual([
      [morning, 'Garmin · 07:00 · 5 km · 30 min'],
      [evening, 'Garmin · 18:00 · 10 km · 50 min'],
    ]);

    const before = await stored(s, plan);
    const r = await s.activities.linkHealth({ activityId: plan, expectedVersion: before.version, healthUuid: evening, opId: 'link-1' });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    // A double tap writes once (rule 5).
    expect(await s.activities.linkHealth({ activityId: plan, expectedVersion: before.version, healthUuid: evening, opId: 'link-1' })).toMatchObject({ ok: true, duplicate: true });

    const shown = await mine(s, plan);
    // As recorded: Health's distance and time, never the planned 8 km (rule 6); his effort word stays his.
    expect(shown?.fields).toEqual({ kind: 'run', status: 'done', date: THU, durationS: 3000, distanceM: 10000, effort: 'easy' });
    expect(shown?.health).toMatchObject({ uuid: evening, sourceName: 'Garmin', startUtc: `${THU}T18:00:00.000Z` });
    // His record underneath is as he planned it, with the link.
    const after = await stored(s, plan);
    expect(after.fields).toEqual(before.fields);
    expect(after.healthLink?.healthUuid).toBe(evening);
    // The linked run shows nowhere else; the other one stays its own row.
    expect((await thursday(s)).filter((a) => a.source === 'health').map((a) => a.id)).toEqual([morning]);
    expect((await s.activities.links(THU))[plan]).toEqual({ state: 'linked', activityId: plan, version: after.version, healthUuid: evening });

    // A stale Unlink (the version before) changes nothing.
    expect(await s.activities.unlinkHealth({ activityId: plan, expectedVersion: before.version, healthUuid: evening, opId: 'unlink-stale' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.activities.unlinkHealth({ activityId: plan, expectedVersion: after.version, healthUuid: evening, opId: 'unlink-1' })).toMatchObject({ ok: true });
    expect((await mine(s, plan))?.fields.status).toBe('planned');
    expect((await stored(s, plan)).healthLink).toBeUndefined();
    expect(open((await s.activities.links(THU))[plan]).choices).toHaveLength(2);
    // Back to no match, its day passed: Missed.
    expect(sp(activityRow((await mine(s, plan)) as Activity, '2026-11-02').detail)).toMatch(/^Missed · /);
  });

  it('one run that day matches on its own (nothing to link); a manual link survives a restart', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const plan = await plannedRun(s);
    const run = fake.addGarmin({ activityType: RUN, startMs: Date.parse(`${THU}T07:00:00.000Z`), endMs: Date.parse(`${THU}T07:40:00.000Z`), distanceM: 7000 });
    h.clockMs = MON_2_NOV;
    await read(s);
    expect((await s.activities.links(THU))[plan]).toEqual({ state: 'matched' });
    expect((await mine(s, plan))?.health?.uuid).toBe(run);
    // Not offered, so not written.
    const v = (await stored(s, plan)).version;
    expect(await s.activities.linkHealth({ activityId: plan, expectedVersion: v, healthUuid: run, opId: 'link-auto' })).toMatchObject({ ok: false, reason: 'stale' });

    // A second run shows up (a watch's late sync): no automatic match any more; Ben links one and it holds after a restart.
    const second = fake.addGarmin({ activityType: RUN, startMs: Date.parse(`${THU}T19:00:00.000Z`), endMs: Date.parse(`${THU}T19:20:00.000Z`), distanceM: 3000 });
    await s.health.readNow();
    expect((await mine(s, plan))?.fields.status).toBe('planned');
    expect(await s.activities.linkHealth({ activityId: plan, expectedVersion: v, healthUuid: run, opId: 'link-2' })).toMatchObject({ ok: true });
    await h.forceClose();
    const s2 = await launch();
    expect((await mine(s2, plan))?.health?.uuid).toBe(run);
    expect((await thursday(s2)).filter((a) => a.source === 'health').map((a) => a.id)).toEqual([second]);
  });

  it('another day’s run is never offered or linked; with nothing on its day a past planned run reads Missed', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const plan = await plannedRun(s);
    const wed = fake.addGarmin({ activityType: RUN, startMs: Date.parse('2026-10-28T07:00:00.000Z'), endMs: Date.parse('2026-10-28T07:30:00.000Z'), distanceM: 5000 });
    // 00:30 Friday in London (GMT): the next day, never Thursday's.
    const fri = fake.addGarmin({ activityType: RUN, startMs: Date.parse('2026-10-30T00:30:00.000Z'), endMs: Date.parse('2026-10-30T01:00:00.000Z'), distanceM: 5000 });
    h.clockMs = MON_2_NOV;
    await read(s);
    expect(open((await s.activities.links(THU))[plan]).choices).toEqual([]);
    const v = (await stored(s, plan)).version;
    for (const uuid of [wed, fri]) expect(await s.activities.linkHealth({ activityId: plan, expectedVersion: v, healthUuid: uuid, opId: `link-${uuid}` })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await stored(s, plan)).version).toBe(v);

    const a = (await mine(s, plan)) as Activity;
    expect(sp(activityRow(a, '2026-11-02').detail)).toBe('Missed · 8 km · easy');
    expect(sp(activityRow(a, THU).detail)).toBe('Planned · 8 km · easy');
    // The day sheet: `missed` once the tile's day has passed, `planned` before; no Link with nothing to link.
    const tile = { items: [{ kind: 'activity' as const, text: 'Run', activityId: plan, planned: true }], marks: [{ shape: 'ring' as const, colour: 'activity' as const, planned: true }] };
    expect(daySheetRows({ ...tile, past: true }, [], () => null)[0]?.detail).toBe('missed');
    expect(daySheetRows({ ...tile, past: false }, [], () => null)[0]?.detail).toBe('planned');
    const rows = pairedDaySheetRows(daySheetRows({ ...tile, past: true }, [], () => null), { unpaired: {}, paired: {} }, await s.activities.links(THU));
    expect(rows[0]?.runLink).toBeNull();
  });

  it('the day sheet row: one run is one-tap Link, two are a choice, a linked one has Unlink', () => {
    const tile = { items: [{ kind: 'activity' as const, text: 'Run', activityId: 'p1', planned: true }], marks: [{ shape: 'ring' as const, colour: 'activity' as const, planned: true }] };
    const base = daySheetRows(tile, [], () => null);
    const pairs = { unpaired: {}, paired: {} };
    const one = { healthUuid: 'h1', label: 'Garmin · 07:00 · 5 km · 30 min', startUtc: `${THU}T07:00:00.000Z` };
    const two = { healthUuid: 'h2', label: 'Garmin · 18:00 · 10 km · 50 min', startUtc: `${THU}T18:00:00.000Z` };
    expect(pairedDaySheetRows(base, pairs, { p1: { state: 'open', activityId: 'p1', version: 2, choices: [one] } })[0]?.runLink).toEqual({ activityId: 'p1', version: 2, choices: [one] });
    expect(pairedDaySheetRows(base, pairs, { p1: { state: 'open', activityId: 'p1', version: 2, choices: [one, two] } })[0]?.runLink?.choices).toHaveLength(2);
    const linked = pairedDaySheetRows(base, pairs, { p1: { state: 'linked', activityId: 'p1', version: 3, healthUuid: 'h2' } })[0];
    expect([linked?.runLink, linked?.runUnlink]).toEqual([null, { activityId: 'p1', version: 3, healthUuid: 'h2' }]);
    expect(pairedDaySheetRows(base, pairs, { p1: { state: 'matched' } })[0]?.runLink).toBeNull();
  });
});

describe('coach: pair / unpair a Health run with the planned run', () => {
  async function ask(s: AppServices, text: string, steps: ConstructorParameters<typeof StepModel>[0]) {
    model = new StepModel(steps);
    return s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
  }
  function card(r: { cards: { record: ActionRecord; rendered: { text: string } }[] }): { record: ActionRecord; text: string } {
    const c = r.cards[0];
    if (c === undefined) throw new Error('no card');
    return { record: c.record, text: c.rendered.text };
  }
  const pairCall = (healthId: string, op: 'pair' | 'unpair' = 'pair') => [() => toolCall('propose_workout_fix', { op, workoutId: null, healthId, date: null, start: null, end: null, reason: 'Ben asked.' }), () => replyWith('Here it is.')] as ConstructorParameters<typeof StepModel>[0];

  it('a card; nothing changes until Apply; Apply links it as the day sheet does; Undo unlinks; a restart keeps it; unpair is the Unlink', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const plan = await plannedRun(s);
    const { morning, evening } = twoRuns();
    h.clockMs = MON_2_NOV;
    await read(s);
    const v = (await stored(s, plan)).version;

    const c = card(await ask(s, 'link my Thursday morning Garmin run with the planned run', pairCall(morning)));
    expect(c.record.status).toBe('proposed');
    expect(sp(c.text)).toBe('Garmin Run · Planned Run · 8 km · easy → Done · 5 km · 30 min');
    expect((await stored(s, plan)).version).toBe(v);
    expect((await mine(s, plan))?.fields.status).toBe('planned');

    expect(await s.workoutFix.apply(c.record.actionId)).toEqual({ ok: true });
    expect(await s.workoutFix.apply(c.record.actionId)).toEqual({ ok: true });
    expect((await stored(s, plan)).version).toBe(v + 1);
    expect((await mine(s, plan))?.health?.uuid).toBe(morning);
    expect((await s.activities.links(THU))[plan]).toMatchObject({ state: 'linked', healthUuid: morning });

    await h.forceClose();
    const s2 = await launch();
    expect(await s2.workoutFix.card(c.record.actionId)).toEqual({ kind: 'applied' });
    expect(await s2.workoutFix.undo(c.record.actionId, 'undo-link')).toBe(true);
    expect((await mine(s2, plan))?.fields.status).toBe('planned');
    expect((await stored(s2, plan)).healthLink).toBeUndefined();

    // Linked again by hand; the coach's unpair is its Unlink, with Undo.
    expect(await s2.activities.linkHealth({ activityId: plan, expectedVersion: v + 2, healthUuid: evening, opId: 'hand' })).toMatchObject({ ok: true });
    const u = card(await ask(s2, 'unpair that evening Garmin run', pairCall(evening, 'unpair')));
    expect(sp(u.text)).toBe('Garmin Run · Linked to your planned run → Not linked');
    expect(await s2.workoutFix.apply(u.record.actionId)).toEqual({ ok: true });
    expect((await mine(s2, plan))?.fields.status).toBe('planned');
    expect(await s2.workoutFix.undo(u.record.actionId, 'undo-unlink')).toBe(true);
    expect((await mine(s2, plan))?.health?.uuid).toBe(evening);
  });

  it('stale: Ben links the other run on the day sheet before Apply; the card is refused and nothing changes', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const plan = await plannedRun(s);
    const { morning, evening } = twoRuns();
    h.clockMs = MON_2_NOV;
    await read(s);
    const c = card(await ask(s, 'pair my morning Garmin run with the planned run', pairCall(morning)));
    const v = (await stored(s, plan)).version;
    expect(await s.activities.linkHealth({ activityId: plan, expectedVersion: v, healthUuid: evening, opId: 'hand' })).toMatchObject({ ok: true });
    expect(await s.workoutFix.apply(c.record.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect((await mine(s, plan))?.health?.uuid).toBe(evening);
    expect((await stored(s, plan)).version).toBe(v + 1);
  });

  it('honest refusals: no planned run that day; a run that counts on its own has nothing to unlink', async () => {
    const s = await launch();
    await setUpGym(h, s);
    const run = fake.addGarmin({ activityType: RUN, startMs: Date.parse(`${THU}T07:00:00.000Z`), endMs: Date.parse(`${THU}T07:30:00.000Z`), distanceM: 5000 });
    h.clockMs = MON_2_NOV;
    await read(s);
    const none = card(await ask(s, 'pair my Garmin run with the planned run', pairCall(run)));
    expect([none.record.status, none.text]).toEqual(['rejected', 'Not changed: No planned run that day to link it to.']);

    await plannedRun(s);
    const auto = card(await ask(s, 'unpair my Garmin run', pairCall(run, 'unpair')));
    expect([auto.record.status, auto.text]).toEqual(['rejected', 'Not changed: Counts as your run on its own (the only one that day).']);
  });
});
