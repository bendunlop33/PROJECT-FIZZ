import { describe, expect, it } from 'vitest';
import {
  estimateBuilderSeconds,
  fitToMinutes,
  fitWorkoutToTime,
  growSecondaryGroup,
  liveTime,
  slotsOf,
  timeFitChanges,
  workingCount,
  type BuilderFitStep,
  type BuilderSlot,
  type BuilderWorkout,
} from '../src/index';
import { makeSlot } from '../src/builder/slot';
import { context } from './builder-v3-fixture';

/**
 * (Ben, 28 Oct) "+ makes a session longer properly": an explicit `+` goes, only as far as needed to reach the length,
 * rests back to normal → +1 set on accessories up to 4 each (a plan day's stored slots too; only slots Ben edited today
 * are not) → +1 set on the main lift up to 5 → add exercises (the day's main group, then the secondary group: arms on
 * a Chest/Back/Shoulders day) up to 8, no near-duplicates → else `Nothing more to add`. No plan buffer for `+`. Today's
 * workout only, with Undo.
 */

const ctx = context();
const slot = (exerciseId: string, opts: { main?: boolean; sets?: number; touched?: boolean } = {}): BuilderSlot => ({
  ...makeSlot(exerciseId, { main: opts.main ?? false, workingSets: opts.sets ?? 3 }, ctx),
  ...(opts.touched === true ? { touched: true as const } : {}),
});
const single = (s: BuilderSlot) => ({ slots: [s], auto: false });
const shape = (w: BuilderWorkout) => slotsOf(w.blocks).map((s) => `${s.exerciseId}×${String(workingCount(s))}`);
const mins = (w: BuilderWorkout) => estimateBuilderSeconds(w, ctx) / 60;

/** A short Push plan day as stored: bench (main), incline DB, pushdown, 3 sets each. */
function push(over: { touched?: string[]; restLevel?: BuilderWorkout['restLevel'] } = {}): BuilderWorkout {
  const t = new Set(over.touched ?? []);
  return { restLevel: over.restLevel ?? 'normal', blocks: [single(slot('bench', { main: true, touched: t.has('bench') })), single(slot('incline_db', { touched: t.has('incline_db') })), single(slot('pushdown', { touched: t.has('pushdown') }))] };
}
const CANDS = { mainGroup: ['incline_bb', 'machine_press', 'cable_fly', 'pec_deck', 'crossover'], arm: ['oh_ext', 'curl', 'hammer'] };
const grow = (w: BuilderWorkout, minutes: number, mainGroup: 'Chest' | 'Legs' | 'Back' = 'Chest', addCandidates = CANDS) => fitToMinutes(w, ctx, { minutes, mainGroup, grow: true, supersets: false, addCandidates });
const kinds = (steps: readonly BuilderFitStep[]) => steps.map((s) => s.kind);

describe('the + ladder (fitToMinutes grow)', () => {
  it('rests back to normal first, a level at a time, before any set is added', () => {
    const w = push({ restLevel: 'shortest' });
    const normal = { ...w, restLevel: 'normal' as const };
    const r = grow(w, Math.ceil(mins(normal)));
    expect(r.steps[0]).toMatchObject({ kind: 'rest', from: 'shortest', to: 'shorter' });
    expect(r.workout.restLevel).toBe('normal');
    expect(shape(r.workout)).toEqual(shape(w));
  });

  it('then +1 set on each accessory, round by round in workout order, up to 4; the main lift waits', () => {
    const w = push();
    // About one accessory set more.
    const one = grow(w, Math.round(mins(w)) + 3);
    expect(one.steps).toEqual([expect.objectContaining({ kind: 'sets', exerciseId: 'incline_db', from: 3, to: 4 })]);
    // Enough for both accessories at 4: the main lift is still at 3.
    const both = grow(w, Math.round(mins(w)) + 5);
    expect(shape(both.workout)).toEqual(['bench×3', 'incline_db×4', 'pushdown×4']);
  });

  it('then the main lift, up to 5 working sets', () => {
    const w = push();
    const r = grow(w, Math.round(mins(w)) + 14, 'Chest', { mainGroup: [], arm: [] });
    expect(shape(r.workout)).toEqual(['bench×5', 'incline_db×4', 'pushdown×4']);
    expect(r.steps.flatMap((s) => (s.kind === 'sets' ? [s.exerciseId] : []))).toEqual(['incline_db', 'pushdown', 'bench']);
  });

  it('then exercises: the day’s main group first, then arms (Chest day), never a near-duplicate, up to 8', () => {
    const r = grow(push(), 180);
    const ids = slotsOf(r.workout.blocks).map((s) => s.exerciseId);
    expect(ids).toHaveLength(8);
    // Incline barbell press near-duplicates the incline DB press: never added.
    expect(ids).not.toContain('incline_bb');
    const adds = r.steps.flatMap((s) => (s.kind === 'add' ? [s] : []));
    expect(adds.map((a) => a.why)).toEqual(['main_group', 'main_group', 'main_group', 'main_group', 'arm']);
    expect(adds.slice(0, 4).map((a) => a.exerciseId)).toEqual(['machine_press', 'cable_fly', 'pec_deck', 'crossover']);
    expect(adds[4]?.exerciseId).toBe('oh_ext');
    // Sets before exercises: every accessory first went to 4 and the main lift to 5.
    const firstAdd = r.steps.findIndex((s) => s.kind === 'add');
    expect(r.steps.slice(0, firstAdd).every((s) => s.kind === 'sets')).toBe(true);
  });

  it('a Legs day adds from Legs only (no arms); the secondary group is arms only on Chest, Back or Shoulders', () => {
    expect([growSecondaryGroup('Chest'), growSecondaryGroup('Back'), growSecondaryGroup('Shoulders')]).toEqual(['Arms', 'Arms', 'Arms']);
    expect([growSecondaryGroup('Legs'), growSecondaryGroup('Arms'), growSecondaryGroup('Core'), growSecondaryGroup(null)]).toEqual([null, null, null, null]);
    const legs: BuilderWorkout = { restLevel: 'normal', blocks: [single(slot('squat', { main: true })), single(slot('leg_curl'))] };
    const r = grow(legs, 180, 'Legs', { mainGroup: ['leg_ext', 'calf'], arm: ['curl', 'oh_ext'] });
    const ids = slotsOf(r.workout.blocks).map((s) => s.exerciseId);
    expect(ids).toEqual(expect.arrayContaining(['leg_ext', 'calf']));
    expect(ids).not.toContain('curl');
    expect(r.full).toBeUndefined();
  });

  it('only as far as needed: it stops once the length is reached (the last step may land past it, never two)', () => {
    const w = push();
    for (const extra of [3, 7, 12, 20, 30]) {
      const target = Math.round(mins(w)) + extra;
      const r = grow(w, target);
      expect(mins(r.workout)).toBeGreaterThan(target - 3);
      // Without its last step it was still short.
      expect(r.steps.length).toBeGreaterThan(0);
    }
  });

  it('a plan day’s stored slots grow for today; a slot Ben edited today never does', () => {
    const r = grow(push({ touched: ['incline_db'] }), 180, 'Chest', { mainGroup: [], arm: [] });
    expect(shape(r.workout)).toEqual(['bench×5', 'incline_db×3', 'pushdown×4']);
    const mainTouched = grow(push({ touched: ['bench'] }), 180, 'Chest', { mainGroup: [], arm: [] });
    expect(shape(mainTouched.workout)[0]).toBe('bench×3');
  });

  it('no plan buffer for +: the whole length is filled (the buffer only holds back when the caller gives one)', () => {
    const w = push();
    const target = Math.round(mins(w)) + 10;
    const plus = grow(w, target);
    const held = fitToMinutes(w, ctx, { minutes: target, mainGroup: 'Chest', grow: true, supersets: false, planBufferMin: 10, addCandidates: CANDS });
    expect(mins(plus.workout)).toBeGreaterThan(target - 3);
    expect(held.steps).toEqual([]);
  });

  it('nothing more to add: no step, `full`', () => {
    const maxed = grow(push(), 180, 'Chest', { mainGroup: [], arm: [] }).workout;
    const r = grow(maxed, 180, 'Chest', { mainGroup: [], arm: [] });
    expect(r.steps).toEqual([]);
    expect(r.full).toBe(true);
    // Every slot edited by Ben: nothing to grow either.
    const mine = grow(push({ touched: ['bench', 'incline_db', 'pushdown'] }), 90, 'Chest', { mainGroup: [], arm: [] });
    expect(mine.full).toBe(true);
  });

  it('a step that overshoots is still taken when nothing else moves it (every + moves something)', () => {
    // Accessories at 4, main at 5: only an exercise is left, longer than the 1 minute asked.
    const maxed = grow(push(), 180, 'Chest', { mainGroup: [], arm: [] }).workout;
    const r = grow(maxed, Math.round(mins(maxed)) + 1, 'Chest', { mainGroup: ['cable_fly'], arm: [] });
    expect(kinds(r.steps)).toEqual(['add']);
  });
});

describe('Your workout’s + (fitWorkoutToTime grow)', () => {
  const at = (current: BuilderWorkout, fit: Parameters<typeof fitWorkoutToTime>[0]['fit'], to: number, grow?: boolean) =>
    fitWorkoutToTime({ current, fit, minutes: 60, to, ctx, mainGroup: 'Chest', supersets: false, ...(grow === true ? { grow: true } : {}), addCandidates: CANDS });

  it('+ grows today’s draft past its own length, recorded as a fill with the original as base; Undo gives it back', () => {
    const w = push();
    const est = Math.round(mins(w));
    const plus = at(w, null, est + 5, true);
    expect(mins(plus.workout)).toBeGreaterThan(mins(w));
    expect(plus.fit?.filledTo).toBe(est + 5);
    expect(plus.fit?.base).toBe(w);
    expect(plus.fit?.fromMinutes).toBe(est);
    // The note lists what + did (sets raised), nothing cut.
    const changes = timeFitChanges(plus.fit ?? { base: w, fromMinutes: est, dropped: [] }, plus.workout);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => (c.kind === 'sets' && c.to > c.from) || c.kind === 'add')).toBe(true);
    // The detail's Undo (Time back to where it was): the original, no record.
    const undo = at(plus.workout, plus.fit, est);
    expect(shape(undo.workout)).toEqual(shape(w));
    expect(undo.fit).toBeNull();
  });

  it('each + adds to the last; − on a fill fills less, from the original', () => {
    const w = push();
    const est = Math.round(mins(w));
    const a = at(w, null, est + 5, true);
    const b = at(a.workout, a.fit, est + 15, true);
    expect(mins(b.workout)).toBeGreaterThan(mins(a.workout));
    // Everything the first + did is still there.
    for (const s of slotsOf(a.workout.blocks)) expect(workingCount(slotsOf(b.workout.blocks).find((x) => x.key === s.key) ?? { rows: [] })).toBeGreaterThanOrEqual(workingCount(s));
    const less = at(b.workout, b.fit, est + 5);
    expect(mins(less.workout)).toBeLessThan(mins(b.workout));
    expect(shape(less.workout)).toEqual(shape(at(w, null, est + 5, true).workout));
  });

  it('after a cut, + first brings back what was cut, then grows', () => {
    const w = push();
    const est = Math.round(mins(w));
    const cut = at(w, null, 20);
    expect(mins(cut.workout)).toBeLessThan(mins(w));
    const back = at(cut.workout, cut.fit, est, true);
    expect(shape(back.workout)).toEqual(shape(w));
    const more = at(cut.workout, cut.fit, est + 5, true);
    expect(mins(more.workout)).toBeGreaterThan(mins(w));
  });

  it('nothing more to add: `full`, nothing changes', () => {
    // Grown until nothing is left: 8 exercises, accessories at 4, the main lift at 5.
    let maxed = push();
    for (let i = 0; i < 10; i += 1) maxed = fitToMinutes(maxed, ctx, { minutes: 180, mainGroup: 'Chest', grow: true, supersets: false, addCandidates: CANDS }).workout;
    expect(slotsOf(maxed.blocks)).toHaveLength(8);
    const r = at(maxed, null, 180, true);
    expect(r.full).toBe(true);
    expect(shape(r.workout)).toEqual(shape(maxed));
  });

  it('without + (Undo, Set up), a longer Time still only gives back cuts (unchanged)', () => {
    const w = push();
    const r = at(w, null, 90);
    expect(shape(r.workout)).toEqual(shape(w));
    expect(r.fit).toBeNull();
  });
});

describe('liveTime: Your workout’s + steps from the estimate', () => {
  it('at least 3 minutes more, to the next 5; elsewhere + still goes past the length', () => {
    expect(liveTime({ estimate: 32, length: 60, growFromEstimate: true }).more).toBe(35);
    expect(liveTime({ estimate: 34, length: 35, growFromEstimate: true }).more).toBe(40);
    expect(liveTime({ estimate: 33, length: 60, growFromEstimate: true }).more).toBe(40);
    expect(liveTime({ estimate: 180, length: 180, growFromEstimate: true }).more).toBeNull();
    expect(liveTime({ estimate: 32, length: 60 }).more).toBe(65);
    // A cut live (a fit landed under its length): past the length, so more Time always gives something back.
    expect(liveTime({ estimate: 42, length: 45, growFromEstimate: true, cutLive: true }).more).toBe(50);
    expect(liveTime({ estimate: 42, length: 45, growFromEstimate: true }).more).toBe(45);
  });
});
