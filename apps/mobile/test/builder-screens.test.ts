import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BuilderSlot, BuilderWorkout } from '@fizz/domain';

import type { BuilderSnapshot, SetupFacts, SetupInput, StartPrompt } from '../src/builder/builder-service';
import { adviceToast, ruleLine } from '../src/builder/builder-service';
import {
  addGroup,
  applyRecommended,
  coachBarWord,
  coachStatusOf,
  editsFromText,
  loadText,
  nextField,
  popupView,
  promptView,
  setupView,
  stepGroup,
  stepMinutes,
  withRecommendation,
  sameIdentity,
  workoutView,
} from '../src/builder/builder-view';
import { countText, reviewFacts, reviewHeaderWord, runReview, setBuilderReviewProvider, builderReviewProvider, type BuilderReview, type BuilderReviewProvider } from '../src/builder/review';

/**
 * The builder's screens (workout-builder-v3 §2.2–§2.9) through their view
 * models, and source checks for what must hold on the phone: VoiceOver
 * actions for every gesture, minimal copy, honest coach status (rule 1).
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const setup = (over: Partial<SetupInput> = {}): SetupInput => ({ dayId: 'chest', dayName: 'Chest', dayParts: ['Chest', 'Triceps'], minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 4 }, { group: 'Triceps', count: 1 }, { group: 'Abs', count: 1 }], variationId: null, groupsEdited: false, ...over });
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ days: { split: [], ppl: [] }, mainLifts: [{ id: 'bench', name: 'Bench press', fromProfile: true }], variations: [], recommended: { count: 7, groups: [{ group: 'Chest', count: 4 }, { group: 'Triceps', count: 2 }, { group: 'Abs', count: 1 }] }, total: 6, template: null, loaded: null, addable: ['Back', 'Shoulders', 'Legs', 'Biceps'], canBuild: true, ...over });

describe('Set up (§2.2)', () => {
  it('Total vs `Recommended for 60 min · 7`, the tag, and Next', () => {
    const v = setupView(setup(), facts(), 'Bench press');
    expect(v.dayValue).toBe('Chest');
    expect(v.mainLiftValue).toBe('Bench press');
    expect(v.variationValue).toBeNull();
    expect(v.lengthText).toBe('60 min');
    expect(v.totalText).toBe('6 exercises');
    expect(v.recommendedLine).toBe('Recommended for 60 min · 7');
    expect(v.groupsTag).toEqual({ kind: 'tag', text: 'Recommended' });
    expect(v.groups.map((g) => g.countText)).toEqual(['4 exercises', '1 exercise', '1 exercise']);
    expect(v.groups[0]?.canPlus).toBe(false);
    expect(v.nextEnabled).toBe(true);
    // Total equal to the recommendation: no line.
    expect(setupView(applyRecommended(setup(), facts().recommended), facts(), null).recommendedLine).toBeNull();
    expect(setupView(setup(), facts(), null).mainLiftValue).toBe('None');
  });

  it('the Variation row shows only when saved variations exist', () => {
    const f = facts({ variations: [{ id: 'v1', label: 'arms superset', version: 1 }] });
    expect(setupView(setup(), f, null).variationValue).toBe('Standard');
    expect(setupView(setup({ variationId: 'v1' }), f, null).variationValue).toBe('arms superset');
  });

  it('length any minute 15–180; group counts 1–4; once edited the tag becomes Use recommended', () => {
    expect(stepMinutes(setup({ minutes: 15 }), -1).minutes).toBe(15);
    expect(stepMinutes(setup({ minutes: 179 }), 5).minutes).toBe(180);
    expect(stepMinutes(setup(), 1).minutes).toBe(61);
    const more = stepGroup(setup(), 'Triceps', 1);
    expect(more.groups.find((g) => g.group === 'Triceps')?.count).toBe(2);
    expect(more.groupsEdited).toBe(true);
    expect(setupView(more, facts(), null).groupsTag).toEqual({ kind: 'link', text: 'Use recommended' });
    expect(stepGroup(setup(), 'Abs', -1).groups.map((g) => g.group)).toEqual(['Chest', 'Triceps']);
    expect(stepGroup(setup(), 'Chest', 1).groups[0]?.count).toBe(4);
    // Rows follow the recommendation until edited.
    expect(withRecommendation(setup(), facts()).groups[1]?.count).toBe(2);
    expect(withRecommendation(more, facts())).toBe(more);
    // A loaded template's own groups, not the recommendation (review B2); an open draft's rows stay.
    const loaded = facts({ loaded: [{ group: 'Chest', count: 2 }, { group: 'Triceps', count: 1 }] });
    expect(withRecommendation(setup(), loaded).groups).toEqual([{ group: 'Chest', count: 2 }, { group: 'Triceps', count: 1 }]);
    expect(withRecommendation(setup(), facts(), true)).toEqual(setup());
    expect(sameIdentity(setup(), setup({ minutes: 45 }))).toBe(true);
    expect(sameIdentity(setup(), setup({ mainLiftExerciseId: 'incline' }))).toBe(false);
    expect(addGroup(setup(), 'Biceps').groups.at(-1)).toEqual({ group: 'Biceps', count: 1 });
  });

  it('Custom with no groups: Next disabled with `Add a muscle group`', () => {
    const custom = setup({ dayId: 'custom', dayName: 'Custom', dayParts: [], groups: [], mainLiftExerciseId: null, groupsEdited: true });
    const v = setupView(custom, facts({ canBuild: false, recommended: { count: 0, groups: [] } }), null);
    expect(v.nextEnabled).toBe(false);
    expect(v.hint).toBe('Add a muscle group');
    expect(v.recommendedLine).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Your workout

const slot = (key: string, exerciseId: string, over: Partial<BuilderSlot> = {}): BuilderSlot => ({
  key,
  exerciseId,
  main: false,
  repRange: { min: 8, max: 12 },
  rows: [
    { type: 'working', reps: 8, load: 20, rpe: 8 },
    { type: 'working', reps: 8, load: 20, rpe: 8 },
    { type: 'working', reps: 8, load: 20, rpe: 9 },
  ],
  unit: 'kg',
  convention: 'stack',
  source: 'calc',
  startLight: null,
  anchorE1rm: 25,
  ...over,
});

const bench = slot('k-bench', 'bench', {
  main: true,
  repRange: { min: 6, max: 8 },
  convention: 'total',
  rows: [
    { type: 'warmup', reps: 10, load: 20, rpe: null },
    { type: 'warmup', reps: 5, load: 50, rpe: null },
    { type: 'warmup', reps: 3, load: 70, rpe: null },
    { type: 'warmup', reps: 1, load: 85, rpe: null },
    { type: 'top', reps: 6, load: 100, rpe: 8 },
    { type: 'backoff', reps: 8, load: 95, rpe: 8 },
    { type: 'backoff', reps: 8, load: 95, rpe: 8 },
    { type: 'backoff', reps: 8, load: 95, rpe: 8 },
  ],
});
const incline = slot('k-incline', 'incline', { convention: 'per_hand', rows: [{ type: 'warmup', reps: 8, load: 17.5, rpe: null }, { type: 'working', reps: 8, load: 30, rpe: 8 }, { type: 'working', reps: 8, load: 30, rpe: 8 }, { type: 'working', reps: 8, load: 30, rpe: 9 }] });
const fly = slot('k-fly', 'fly');
const crunch = slot('k-crunch', 'crunch', { rows: [{ type: 'working', reps: 10, load: 45, rpe: 8 }, { type: 'working', reps: 10, load: 45, rpe: 8 }, { type: 'working', reps: 10, load: 45, rpe: 9 }] });
const pullup = slot('k-pull', 'pullup', { convention: 'assistance', rows: [{ type: 'working', reps: 8, load: 25, rpe: 8 }] });

function snapshot(w: BuilderWorkout, over: Partial<BuilderSnapshot> = {}): BuilderSnapshot {
  const f = (name: string, works: string | null, group: BuilderSnapshot['facts'][string]['group'], compound = false) => ({ name, works, group, compound, mayHurt: false, notHere: false });
  return {
    draftId: 'd1',
    version: 3,
    setup: setup(),
    workout: w,
    minutes: 58,
    over: false,
    planDayChanged: null,
    gymChanged: false,
    name: 'Chest · Bench press',
    planDay: null,
    variationLabel: null,
    undo: null,
    facts: {
      bench: f('Bench press', 'Chest, front delts, triceps', 'Chest', true),
      incline: f('Incline DB press', 'Upper chest, front delts, triceps', 'Chest', true),
      fly: f('Cable fly', 'Chest', 'Chest'),
      crunch: f('Cable crunch', 'Abs', 'Abs'),
      pullup: f('Assisted pull-up', 'Lats, biceps', 'Back', true),
    },
    unit: 'kg',
    skipped: [],
    revs: {},
    rests: { 'k-bench': { warmup: 60, top: 210, backoff: 180 }, 'k-fly': { working: 90, round: 90 }, 'k-crunch': { working: 90, round: 90 }, 'k-incline': { warmup: 60, working: 120 } },
    items: {},
    startable: true,
    ...over,
  };
}

const W: BuilderWorkout = {
  restLevel: 'normal',
  blocks: [
    { slots: [bench], auto: false },
    { slots: [incline], auto: false },
    { slots: [fly, crunch], auto: true },
    { slots: [pullup], auto: false },
  ],
};

describe('Your workout (§2.3)', () => {
  it('title, columns, numbered rounds, superset 3a/3b with the line, sets with + W, top set targets', () => {
    const v = workoutView(snapshot(W));
    expect(v.title).toBe('Chest · about 58 min');
    expect(v.overLine).toBeNull();
    expect(v.topHeader).toBe('Top set (kg)');
    const rows = v.rounds.flatMap((r) => r.rows);
    expect(rows.map((r) => r.label)).toEqual(['1', '2', '3a', '3b', '4']);
    expect(rows.map((r) => [r.name, r.setsText, r.warmText, r.topText])).toEqual([
      ['Bench press', '4', '+4 W', '100'],
      ['Incline DB press', '3', '+1 W', '30 each'],
      ['Cable fly', '3', null, '20'],
      ['Cable crunch', '3', null, '45'],
      ['Assisted pull-up', '1', null, '25 assist'],
    ]);
    expect(rows.map((r) => r.linkedToNext)).toEqual([false, false, true, false, false]);
    expect(v.rounds.map((r) => r.superset)).toEqual([false, false, true, false]);
    expect(rows[0]?.main).toBe(true);
    expect(rows[0]?.works).toBe('Chest, front delts, triceps');
  });

  it('every gesture has a VoiceOver action; the main lift never offers a superset (Q5)', () => {
    const rows = workoutView(snapshot(W)).rounds.flatMap((r) => r.rows);
    const names = (i: number) => rows[i]?.actions.map((a) => a.label);
    expect(names(0)).toEqual(['Delete', 'Swap', 'Move down']);
    expect(names(1)).toEqual(['Delete', 'Swap', 'Move up', 'Move down', 'Superset with next']);
    expect(names(2)).toEqual(['Delete', 'Swap', 'Move up', 'Move down', 'Superset with next', 'Unlink']);
    expect(names(4)).toEqual(['Delete', 'Swap', 'Move up']);
    expect(rows[2]?.accessibilityLabel).toBe('3a, Cable fly, superset, 3 sets, top set 20 kilograms');
    expect(rows[1]?.accessibilityLabel).toBe('2, Incline DB press, 3 sets, plus 1 warm-up, top set 30 kilograms each');
  });

  it('loads: each, assist, BW, BW+10, — and another unit inline', () => {
    expect(loadText(30, 'kg', 'per_hand', 'kg')).toBe('30 each');
    expect(loadText(25, 'kg', 'assistance', 'kg')).toBe('25 assist');
    expect(loadText(0, 'kg', 'bodyweight', 'kg')).toBe('BW');
    expect(loadText(10, 'kg', 'added', 'kg')).toBe('BW+10');
    expect(loadText(null, 'kg', 'stack', 'kg')).toBe('—');
    expect(loadText(45, 'lb', 'stack', 'kg')).toBe('45 lb');
    expect(loadText(102.5, 'kg', 'total', 'kg')).toBe('102.5');
  });

  it('empty: Start disabled; over the length: `⚠ Over 20 min`', () => {
    const empty = workoutView(snapshot({ restLevel: 'normal', blocks: [] }, { startable: false }));
    expect(empty.empty).toBe(true);
    expect(empty.startEnabled).toBe(false);
    const over = workoutView(snapshot({ restLevel: 'shortest', blocks: [{ slots: [bench], auto: false }] }, { minutes: 26, over: true, setup: setup({ minutes: 20 }) }));
    expect(over.title).toBe('Chest · about 26 min');
    expect(over.overLine).toBe('⚠ Over 20 min');
  });

  it('`Edits from Mon 19 Oct`', () => {
    expect(editsFromText('2026-10-19')).toBe('Edits from Mon 19 Oct');
    expect(editsFromText('2026-10-20')).toBe('Edits from Tue 20 Oct');
  });
});

describe('Exercise pop-up and keyboard (§2.4, §2.7)', () => {
  it('per-set table # · Type · Reps · Kg · RPE, rest per set type, moves', () => {
    const snap = snapshot(W);
    const p = popupView(snap, 'k-bench', (k) => snap.rests['k-bench']?.[k] ?? 0);
    expect(p?.kgHeader).toBe('Kg');
    expect(p?.rows.map((r) => [r.mark, r.typeText, r.reps, r.kgText, r.rpeText])).toEqual([
      ['W', 'Warm-up', 10, '20', '–'],
      ['W', 'Warm-up', 5, '50', '–'],
      ['W', 'Warm-up', 3, '70', '–'],
      ['W', 'Warm-up', 1, '85', '–'],
      ['1', 'Top set', 6, '100', '8'],
      ['2', 'Back-off', 8, '95', '8'],
      ['3', 'Back-off', 8, '95', '8'],
      ['4', 'Back-off', 8, '95', '8'],
    ]);
    expect(p?.rests.map((r) => [r.label, r.text])).toEqual([
      ['Warm-ups', '1:00'],
      ['Top set', '3:30'],
      ['Back-offs', '3:00'],
    ]);
    expect(p?.canAddWarmup).toBe(false);
    expect(p?.canSupersetNext).toBe(false);
    expect(p?.rows[4]?.accessibilityLabel).toBe('Set 1, Top set, 6 reps, 100 kilograms, RPE 8');
    // Each cell says whose it is (`Warm-up 2, reps`, `Set 1, reps`; N6).
    expect(p?.rows.map((r) => r.spokenName)).toEqual(['Warm-up 1', 'Warm-up 2', 'Warm-up 3', 'Warm-up 4', 'Set 1', 'Set 2', 'Set 3', 'Set 4']);
    expect(p?.rests.every((r) => r.canMinus && r.canPlus)).toBe(true);
    // At the floor `−` is off: no write that changes nothing (N7).
    expect(popupView(snap, 'k-bench', () => 0)?.rests.every((r) => !r.canMinus)).toBe(true);
  });

  it('in a superset: one rest row, `After each round`; the last working set can’t be deleted', () => {
    const snap = snapshot(W);
    const p = popupView(snap, 'k-fly', (k) => snap.rests['k-fly']?.[k] ?? 0);
    expect(p?.rests).toEqual([{ kind: 'round', label: 'After each round', seconds: 90, text: '1:30', canMinus: true, canPlus: true }]);
    expect(p?.canUnlink).toBe(true);
    const one = popupView(snap, 'k-pull', () => 90);
    expect(one?.rows[0]?.canDelete).toBe(false);
  });

  it('Next goes Reps → Kg → RPE → next set; warm-ups skip RPE', () => {
    const rpe = (i: number) => i > 0;
    expect(nextField(0, 'reps', 3, rpe)).toEqual({ row: 0, field: 'kg' });
    expect(nextField(0, 'kg', 3, rpe)).toEqual({ row: 1, field: 'reps' });
    expect(nextField(1, 'kg', 3, rpe)).toEqual({ row: 1, field: 'rpe' });
    expect(nextField(2, 'rpe', 3, rpe)).toBeNull();
  });
});

describe('Start prompt, advice, coach status and review (§2.6, §2.8, §2.9, §3.8)', () => {
  const prompt: StartPrompt = { lines: ['Cable fly → Incline barbell press'], updateLabel: 'Update Chest · bench press in your plan', variationLimitReached: false, suggestedLabel: 'with chest', canSaveVariation: true };
  it('the three choices, and Limit reached at 5 variations', () => {
    const v = promptView(prompt);
    expect([v.title, v.today, v.update, v.variation.label, v.cancel]).toEqual(['Use these changes for', 'Today only', 'Update Chest · bench press in your plan', 'Save as new variation', 'Cancel']);
    expect(v.variation.enabled).toBe(true);
    const full = promptView({ ...prompt, variationLimitReached: true, updateLabel: null });
    expect(full.variation).toEqual({ label: 'Save as new variation', enabled: false, note: 'Limit reached' });
    expect(full.update).toBeNull();
  });

  it('advice after Ben’s own move: a short toast, the full reason behind Why?', () => {
    const a = adviceToast({ kind: 'shared_muscle', key: 'k', a: { slotKey: 'x', exerciseId: 'x', name: 'Lat pulldown' }, b: { slotKey: 'y', exerciseId: 'y', name: 'Assisted pull-up' }, muscle: 'lats', reason: 'Both work your lats, so the second one suffers.', fix: { kind: 'unlink', slotKey: 'y', label: 'Unlink' } });
    expect(a).toEqual({ text: 'Not recommended: both work your lats', why: 'Both work your lats, so the second one suffers.' });
    expect(ruleLine({ value: 100 }, 102.5)).toBe('Last time + 2.5');
    expect(ruleLine({ value: 100 }, 100)).toBe('Last time');
  });

  it('coach status is honest: Offline / Coach not connected, nothing when connected', () => {
    expect(coachBarWord(coachStatusOf('ok'))).toBeNull();
    expect(coachBarWord(coachStatusOf('offline'))).toBe('Offline');
    expect(coachBarWord(coachStatusOf('expired'))).toBe('Coach not connected');
  });

  it('with no review provider: code counts and the mix, no verdict, no suggestions, no notes (rule 1)', () => {
    setBuilderReviewProvider(null);
    expect(builderReviewProvider()).toBeNull();
    const r = reviewFacts(snapshot(W), 'not_connected');
    expect(r.verdict).toBeNull();
    expect(r.suggestions).toEqual([]);
    expect(r.nextNotes).toEqual([]);
    expect(reviewHeaderWord(r.status)).toBe('Coach not connected');
    expect(r.counts.map(countText)).toEqual(['✓ Chest 10', '· Triceps', '✓ Abs 3', '✓ Back 1']);
    expect(r.variety).toBe('3 compound · 2 isolation');
    expect(reviewHeaderWord(reviewFacts(snapshot(W), 'offline').status)).toBe('Offline');
  });

  it('connected with no provider, or a review that fails: `Not reviewed` with Why?, never `● Coach` (review B5)', async () => {
    const shown: BuilderReview[] = [];
    const none = await runReview(snapshot(W), 'ok', null, (r) => shown.push(r));
    expect(none.status).toBe('not_reviewed');
    expect(reviewHeaderWord(none.status)).toBe('Not reviewed');
    expect(none.whyNot).not.toBeNull();
    expect(shown.map((r) => r.status)).toEqual(['not_reviewed']);

    const failing: BuilderReviewProvider = { review: () => Promise.reject(new Error('down')), apply: () => Promise.resolve({ ok: false, message: 'x' }), saveNotes: () => Promise.resolve({ ok: false }) };
    shown.length = 0;
    const failed = await runReview(snapshot(W), 'ok', failing, (r) => shown.push(r));
    expect(shown.map((r) => reviewHeaderWord(r.status))).toEqual(['Reviewing…', 'Not reviewed']);
    expect(failed.verdict).toBeNull();
    expect(failed.suggestions).toEqual([]);

    const good: BuilderReviewProvider = { ...failing, review: () => Promise.resolve({ ...reviewFacts(snapshot(W), 'reviewed'), verdict: 'Balanced' }) };
    const reviewed = await runReview(snapshot(W), 'ok', good, () => undefined);
    expect(reviewHeaderWord(reviewed.status)).toBe('● Coach');
    // Offline: the provider isn't called.
    let called = false;
    await runReview(snapshot(W), 'offline', { ...good, review: () => { called = true; return good.review('x'); } }, () => undefined);
    expect(called).toBe(false);
  });
});

describe('source checks', () => {
  const screens = ['screens/builder/BuilderSetupScreen.tsx', 'screens/builder/BuilderWorkoutScreen.tsx', 'screens/builder/BuilderSheets.tsx', 'screens/builder/BuilderParts.tsx'].map(read).join('\n');
  it('both routes are registered and typed', () => {
    const nav = read('navigation/AppNavigator.tsx');
    expect(nav).toContain('name="BuilderSetup"');
    expect(nav).toContain('name="BuilderWorkout"');
    const types = read('navigation/types.ts');
    expect(types).toMatch(/BuilderWorkout: \{ draftId: string;/);
  });
  it('swipes and steppers carry VoiceOver actions; the keyboard bar has − + Next Done', () => {
    expect(screens).toContain('accessibilityActions');
    expect(screens).toContain("accessibilityRole=\"adjustable\"");
    expect(screens).toContain('InputAccessoryView');
    expect(screens).toContain("name: 'delete_set', label: 'Delete set'");
  });
  it('pop-up set rows aren’t one VoiceOver element: # and Type carry the actions, the fields stay reachable (review B6)', () => {
    const sheets = read('screens/builder/BuilderSheets.tsx');
    const parts = read('screens/builder/BuilderParts.tsx');
    expect(parts).toMatch(/container\s*\?\s*\{ accessible: false \}/);
    expect(sheets).toMatch(/<SwipeRow[\s\S]{0,120}container/);
    expect(sheets).toContain('`${r.spokenName}, reps`');
    expect(sheets).toContain('`${r.spokenName}, target RPE`');
    expect(sheets).toMatch(/accessibilityActions=\{actions\}/);
  });
  it('edits run one at a time on the latest snapshot; a held stepper keeps adding (review S4, S5)', () => {
    const ws = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(ws).toContain('queue.current.then(run, run)');
    expect(ws).toContain('const cur = snapRef.current;');
    const parts = read('screens/builder/BuilderParts.tsx');
    expect(parts).toContain('step.current = onStep;');
    expect(parts).toContain('step.current(delta)');
    expect(parts).toContain('sides.current.left');
  });
  it('Start asks the check-in when it’s due, reuses a recent one, and passes it on (review S10)', () => {
    const ws = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(ws).toContain('services.checkIns.gate()');
    expect(ws).toContain('<CheckInScale');
    expect(ws).toMatch(/services\.builder\.start\([^)]*checkIn \}/);
    expect(ws).toContain('alertsAsk.ensureAsked()');
  });
  it('Your workout reloads a changed plan day, moves to a new gym, and offers Add anyway (review S10)', () => {
    const ws = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(ws).toContain('services.builder.reloadPlanDay(');
    expect(ws).toContain('services.builder.changeGym(');
    expect(ws).toContain('WORKOUT_COPY.addAnyway');
    expect(ws).toContain('WORKOUT_COPY.notHere');
    const su = read('screens/builder/BuilderSetupScreen.tsx');
    expect(su).toContain('services.builder.renameVariation(');
    expect(su).toContain('services.builder.deleteVariation(');
    expect(su).toContain('services.builder.undoDeleteVariation(');
  });
  it('minimal copy: no rule labels or reassurance in the builder; no est. 1RM on Swap', () => {
    for (const banned of ['built-in rule', 'snapped to', 'Nothing changes', 'Est. 1RM', 'est. 1RM']) expect(screens).not.toContain(banned);
  });
  it('screens compute no progression or rounding: they call services.builder', () => {
    for (const fn of ['builderLoad', 'setRowsFor', 'fitToMinutes', 'roundDownHere', 'buildFromSetup', 'expectedLoad']) expect(screens).not.toContain(fn);
    expect(screens).toContain('services.builder.');
  });
});
