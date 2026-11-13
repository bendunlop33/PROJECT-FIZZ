import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFromSetup, referenceE1rm, slotsOf, trainingOverviewView, type BuilderSetup, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { BuilderEditOpSchema, CoachToolNameSchema, EditTodayOpSchema, SessionCommandSchema } from '@fizz/schemas';
import { BUILDER_MANUAL_ACTIONS, BUILDER_SETUP_ACTIONS, LIVE_MANUAL_ACTIONS, applyBuilderEdits, asksBeyondBehind, checkBehindEdit, createBuilderLoadGuard, makeBuilderProposal, NO_NUMBERS, recheckBuilderProposal, type BuilderCoachEnv, type BuilderCoachSnapshot, type ParityEntry } from '../src/index';

/**
 * (Ben, 8 Nov: "the coach can do in today's workout anything I can do by hand") Every manual action, live and before
 * Start, maps to a coach op that exists, or is named as not a coach action (with why) or as a known gap. A new
 * workout command, builder edit or screen handler fails here until the coach gets it (or it is classified).
 */

const commandTypes = SessionCommandSchema.options.map((o) => o.shape.type.value);
const editOps = new Set<string>(EditTodayOpSchema.options.map((o) => o.shape.op.value));
const builderOps = new Set<string>(BuilderEditOpSchema.options.map((o) => o.shape.op.value));
const tools = new Set<string>(CoachToolNameSchema.options);

function checkEntry(name: string, e: ParityEntry, ops: Set<string>): void {
  if (e.kind === 'coach') {
    expect(tools.has(e.tool), `${name}: ${e.tool} is a coach tool`).toBe(true);
    for (const op of e.ops ?? []) expect(ops.has(op), `${name}: ${e.tool} has op ${op}`).toBe(true);
  } else {
    expect(e.reason.length, `${name}: a reason`).toBeGreaterThan(5);
  }
}

describe('coach parity inventory (8 Nov)', () => {
  it('every workout command is classified, and each coach mapping names a real edit_today op or tool', () => {
    expect(commandTypes.length).toBeGreaterThan(40);
    for (const t of commandTypes) {
      const e = LIVE_MANUAL_ACTIONS[t];
      expect(e, `${t} is in LIVE_MANUAL_ACTIONS`).toBeDefined();
      checkEntry(t, e, editOps);
    }
    expect(Object.keys(LIVE_MANUAL_ACTIONS).sort()).toEqual([...commandTypes].sort());
  });

  it('every edit to Your workout before Start maps to a propose_workout_edit op', () => {
    for (const [k, e] of Object.entries(BUILDER_MANUAL_ACTIONS)) checkEntry(k, e, builderOps);
    for (const [k, e] of Object.entries(BUILDER_SETUP_ACTIONS)) checkEntry(k, e, builderOps);
  });

  it('the screens’ handlers send only classified commands and builder edits', () => {
    const root = fileURLToPath(new URL('../../../apps/mobile/src/screens/', import.meta.url));
    const files = ['workout', 'builder'].flatMap((d) => readdirSync(`${root}${d}`).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(`${root}${d}/${f}`, 'utf8')));
    const known = new Set(commandTypes);
    const builderKinds = new Set(Object.keys(BUILDER_MANUAL_ACTIONS));
    const sent = new Set(files.flatMap((src) => [...src.matchAll(/\btype: '([a-z_]+)'/g)].map((m) => m[1] ?? '')).filter((t) => known.has(t as never)));
    expect(sent.size).toBeGreaterThan(10);
    for (const t of sent) expect(LIVE_MANUAL_ACTIONS[t as keyof typeof LIVE_MANUAL_ACTIONS]).toBeDefined();
    // Every builder edit kind a screen sends is in the builder inventory.
    const edits = new Set(files.flatMap((src) => [...src.matchAll(/edit\(\s*\{\s*kind: '([a-z_]+)'/g)].map((m) => m[1] ?? '')));
    for (const k of edits) expect(builderKinds.has(k), `builder edit ${k}`).toBe(true);
  });

  it('the known gaps are exactly these (a new one fails until the coach can do it)', () => {
    const gaps = [...Object.entries(LIVE_MANUAL_ACTIONS), ...Object.entries(BUILDER_SETUP_ACTIONS), ...Object.entries(BUILDER_MANUAL_ACTIONS)].filter(([, e]) => e.kind === 'gap').map(([k]) => k);
    expect(gaps.sort()).toEqual(['changeGym', 'change_gym', 'set_finish_by']);
  });
});

// ---------------------------------------------------------------------------

const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] };
const snapshotOf = (w: BuilderWorkout): BuilderCoachSnapshot => ({ draftId: 'd1', draftVersion: 3, dayName: 'Chest', minutes: 60, supersets: true, workout: w, revs: {} });
function benchRefs(): LoadReferences {
  const top = { value: 100, reps: 8, rpe: 8 };
  const s: RefSession = { sessionId: 's-bench', performedAtUtc: '2026-10-13T10:00:00Z', tz: 'Europe/London', source: 'app', sets: [top], top };
  return { exerciseId: 'bench', unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: [s], e1rm: referenceE1rm(s.sets), gapDays: 7, estOnly: false }, latest: s, all: [s], derived: null, patternE1rms: [], historyVersion: 'h1' };
}
function setup(asked: boolean) {
  const ctx = F.context();
  const w = buildFromSetup(chest, F.pool, ctx).workout;
  const pain = () => null;
  const env: BuilderCoachEnv = { ctx, usable: (id) => F.info(id) !== null, pain, loads: createBuilderLoadGuard({ ctx, refs: (id) => (id === 'bench' ? benchRefs() : null), pain }), askedHeavier: false, mainGroup: 'Chest', asked };
  const key = (id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id)?.key ?? `missing:${id}`;
  return { w, env, key, snap: snapshotOf(w) };
}

describe('Your workout: his ask goes past the coach load ceilings (8 Nov)', () => {
  it('a 30% jump he asks for is proposed (rounded down to the plates) with the trade-off; a review suggestion stays capped', () => {
    const a = setup(true);
    const ops = [{ op: 'load' as const, slotKey: a.key('bench'), direction: null, value: 145, unit: 'kg' as const }];
    const asked = applyBuilderEdits(a.snap, ops, a.env);
    const top = (w: BuilderWorkout) => slotsOf(w.blocks).find((s) => s.exerciseId === 'bench')?.rows.find((r) => r.type !== 'warmup')?.load;
    expect(top(asked.workout)).toBe(145);
    expect(asked.tradeOff).toEqual(['Barbell bench press +45% · above what recent sets support']);
    const b = setup(false);
    const capped = applyBuilderEdits(b.snap, ops, b.env);
    expect(top(capped.workout) ?? 0).toBeLessThan(145);
    expect(capped.tradeOff).toEqual([]);
  });

  it('Apply’s re-check runs the same way (the proposal remembers it was his ask)', () => {
    const a = setup(true);
    const made = makeBuilderProposal({ id: 'p1', snapshot: a.snap, ops: [{ op: 'load', slotKey: a.key('bench'), direction: null, value: 145, unit: 'kg' }], words: null, check: NO_NUMBERS, env: a.env });
    expect(made.proposal?.asked).toBe(true);
    expect(made.proposal?.tradeOff?.length).toBe(1);
    if (made.proposal === null) throw new Error('no proposal');
    expect(recheckBuilderProposal(made.proposal, a.snap, { ...a.env, asked: false }).ok).toBe(true);
  });

  it('the parity ops: main lift, warm-ups as set, a drop set', () => {
    const a = setup(true);
    const fly = slotsOf(a.w.blocks).find((s) => !s.main && F.info(s.exerciseId)?.group === 'Chest');
    if (fly === undefined) throw new Error('no chest accessory');
    const out = applyBuilderEdits(a.snap, [{ op: 'warmups', slotKey: a.key('bench'), sets: [{ load: 40, reps: 8 }, { load: 61, reps: 3 }] }, { op: 'drop_set', slotKey: fly.key }], { ...a.env, benLoads: [{ value: 61, unit: 'kg' }] });
    const bench = slotsOf(out.workout.blocks).find((s) => s.exerciseId === 'bench');
    expect(bench?.rows.filter((r) => r.type === 'warmup').map((r) => r.load)).toEqual([40, 61]);
    expect(slotsOf(out.workout.blocks).find((s) => s.key === fly.key)?.rows.some((r) => r.type === 'drop')).toBe(true);
    const main = applyBuilderEdits(a.snap, [{ op: 'main', slotKey: fly.key }], a.env);
    expect(slotsOf(main.workout.blocks).find((s) => s.key === fly.key)?.main).toBe(true);
    expect(slotsOf(main.workout.blocks).find((s) => s.exerciseId === 'bench')?.main).toBe(false);
  });
});

describe('behind on the plan: propose_workout_edit keeps MS3/MS5 (8 Nov)', () => {
  const before = [{ exerciseId: 'squat', sets: 4, main: true }, { exerciseId: 'leg_press', sets: 3, main: false }, { exerciseId: 'curl', sets: 3, main: false }];
  const rules = { uncovered: ['Biceps'], groupOf: (id: string) => (id === 'curl' ? 'Biceps' : 'Legs') };
  it('refuses a longer day, a lost main lift or 3 days’ worth swapped in, unless Ben asked for more', () => {
    const shape = { before, after: [{ exerciseId: 'leg_press', sets: 3, main: true }, { exerciseId: 'a', sets: 2, main: false }, { exerciseId: 'b', sets: 2, main: false }, { exerciseId: 'c', sets: 2, main: false }, { exerciseId: 'curl', sets: 3, main: false }], minutesBefore: 60, minutesAfter: 75 };
    const v = checkBehindEdit(shape, rules, { askedMore: false, coverageAsked: false });
    expect(v.kind === 'refuse' && v.line).toBe('Not proposed: his usual length is 60 min; keep the day’s main lift; at most 2 exercises from other days. Call again within these.');
    expect(checkBehindEdit(shape, rules, { askedMore: true, coverageAsked: false }).kind).toBe('ok');
    expect(asksBeyondBehind('2 days behind. Build today\'s workout.')).toBe(false);
    expect(asksBeyondBehind('make it 75 min and do both days')).toBe(true);
  });
  it('an uncovered group dropped is sent back once, then named on the card', () => {
    const shape = { before, after: before.filter((s) => s.exerciseId !== 'curl'), minutesBefore: 60, minutesAfter: 55 };
    const first = checkBehindEdit(shape, rules, { askedMore: false, coverageAsked: false });
    expect(first.kind).toBe('refuse');
    const second = checkBehindEdit(shape, rules, { askedMore: false, coverageAsked: first.coverageAsked });
    expect(second.kind === 'ok' && second.notes).toEqual(['None this week: Biceps']);
  });
});

describe('get_training_overview counts Garmin-only strength sessions (8 Nov)', () => {
  it('a Health-only session is a workout in the count and the list, with no sets or loads', () => {
    const nowUtc = '2026-11-08T12:00:00Z';
    const v = trainingOverviewView({
      weeks: 4,
      nowUtc,
      tz: 'Europe/London',
      sessions: [],
      gymNames: {},
      healthSessions: [{ sessionId: 'health:abc', name: 'Strength', date: '2026-11-05', startedMs: Date.parse('2026-11-05T18:00:00Z'), fromHealth: { activityId: 'abc', sourceName: 'Garmin', activityType: 50 } }],
    });
    expect(v.workouts).toBe(1);
    expect(v.perWeek).toBeGreaterThan(0);
    expect(v.sessions[0]).toMatchObject({ sessionId: 'health:abc', source: 'Health', recordedBy: 'Garmin', exercises: [] });
    expect(v.trends).toEqual([]);
  });
});
