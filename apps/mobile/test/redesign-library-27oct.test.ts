import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, routineOptionsState } from '@fizz/domain';

import { changePlanView, daysAndTimeLine, endPlanLine, goalLine } from '../src/library/change-plan-view';
import { libraryAfterPlanChange, openPlanChange } from '../src/navigation/actions';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Redesign 27 Oct, section D (Library): Change plan's words and routing, Days and time / Goal ending on the Changes
 * review and back on Library with Undo; the shared workout editor opening a card in place on one tap (plan day, saved
 * workout, Your workout) with `Last` / `Best` above the sets; the Options card (Abs, Supersets); and the services
 * behind them on real SQLite (offline).
 */

const SRC = join(import.meta.dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-19T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

describe('Change plan (D4)', () => {
  it('lines: `3 a week · 45 min · Mon Wed Sat`, Any days, the goal, `Week 3 of 6 · history kept`', () => {
    expect(daysAndTimeLine({ sessions: 3, minutes: 45, schedule: 'set', days: [5, 0, 2] })).toBe('3 a week · 45 min · Mon Wed Sat');
    expect(daysAndTimeLine({ sessions: 4, minutes: 60, schedule: 'any', days: [] })).toBe('4 a week · 60 min · Any days');
    expect(goalLine({ focus: 'muscle', priorities: [] })).toBe('Muscle');
    expect(goalLine({ focus: 'strength', priorities: ['Chest', 'Back'] })).toBe('Strength · Chest, Back');
    expect(endPlanLine({ current: 3, of: 6 })).toBe('Week 3 of 6 · history kept');
    expect(endPlanLine(null)).toBe('History kept');
  });

  it('a coach plan (no builder answers): no Days and time; Goal opens Profile; each day once', () => {
    const v = changePlanView({ answers: null, editable: false, goalText: 'Goal: Muscle · 3 days a week', days: [{ name: 'Push', routineId: 'a' }, { name: 'Push', routineId: 'a' }, { name: 'Pull', routineId: null }], block: null });
    expect(v).toMatchObject({ daysAndTime: null, goal: 'Muscle · 3 days a week', goalOpens: 'profile', days: [{ name: 'Push', routineId: 'a' }] });
  });

  it('routing: Days and time / Goal open that page of the plan in use; Apply lands on Library › Plan with the toast', () => {
    expect(openPlanChange('p1', 'week')).toEqual({ type: 'NAVIGATE', payload: { name: 'PlanSetup', params: { editPlanId: 'p1', start: 'week' } } });
    const t = { key: 'k', planId: 'p1', version: 4, edit: true as const };
    expect(libraryAfterPlanChange(t)).toEqual({ type: 'POP_TO', payload: { name: 'Tabs', params: { screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'plan', plan: 'k', planApplied: t }, pop: true } } } });
    const setup = code(read('screens/plan/PlanSetupScreen.tsx'));
    expect(setup).toContain('label={CHANGE_PLAN_COPY.reviewChanges}');
    expect(setup).toContain('start !== undefined ? libraryAfterPlanChange(applied) : todayAfterPlanApplied(applied)');
    const tab = code(read('screens/library/PlanTab.tsx'));
    expect(tab).toContain('services.planBuilder.undoEdit({ planId: planApplied.planId, expectedVersion: planApplied.version, opId: undoOp })');
  });
});

describe('the shared workout editor (D6): one tap opens a card in place', () => {
  it('plan day / saved workout and Your workout: a tap toggles the row open, with Last / Best above the sets; no pop-up sheet', () => {
    for (const f of ['screens/builder/EditWorkoutScreen.tsx', 'screens/builder/BuilderWorkoutScreen.tsx']) {
      const src = code(read(f));
      expect(src).toContain('setPopup((k) => (k === r.slotKey ? null : r.slotKey));');
      expect(src).toContain('expandedKey={popup}');
      expect(src).toContain('<RecapLines recap={recap}');
      expect(src).toMatch(/inline\n/);
      // A drag closes the open card.
      expect(src).toContain('if (active) setPopup(null);');
    }
    const table = code(read('screens/builder/WorkoutTable.tsx'));
    expect(table).toContain('{open && !dragging ? renderExpanded(r) : null}');
    // The active workout keeps its sheet.
    expect(code(read('screens/workout/WorkoutEdits.tsx'))).not.toMatch(/\binline\b/);
  });

  it('the Options card (Abs, Supersets) on a stored workout, applied as page edits with Undo', () => {
    const src = code(read('screens/builder/EditWorkoutScreen.tsx'));
    expect(src).toContain('editor.routine !== null ? (');
    expect(src).toContain('<OptionsCard');
    expect(src).toContain('routineSupersetsOn(before, lookup, {');
    expect(src).toContain('routineAbsOff(before, lookup, {');
    expect(src).toContain('showToast({ text: TEMPLATE_COPY.optionDone(word, on, editor.routine?.planDay !== undefined), before });');
  });
});

describe('services behind the editor (real SQLite, offline)', () => {
  it('exerciseRecaps: Last · date with that workout’s sets and Best; none for an exercise never done', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 82.5, reps: 6 }] }]);
    h.clockMs += 3 * 86_400_000;
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }, { load: 80, reps: 7 }] }]);
    const bench = (await s.workout.load(second))?.aggregate.exercises[0]?.exerciseId ?? '';
    const r = await s.routines.exerciseRecaps([bench, 'not-an-exercise']);
    expect(plain(r[bench]?.lastLabel)).toMatch(/^Last · /);
    expect(plain(r[bench]?.lastText)).toBe('80 × 8, 8, 7');
    expect(plain(r[bench]?.bestText)).toBe('82.5 × 6');
    expect(r['not-an-exercise']).toBeUndefined();
  });

  it('templateOptionsInfo: each exercise’s group for Abs, and this gym’s ab and arm picks', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const done = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const bench = (await s.workout.load(done))?.aggregate.exercises[0]?.exerciseId ?? '';
    const o = await s.builder.templateOptionsInfo({ gymId, exerciseIds: [bench] });
    expect(o.info[bench]?.group).toBe('Chest');
    expect(o.core.length).toBeGreaterThan(0);
    expect(o.arms.length).toBeGreaterThan(0);
    expect(o.core.every((id) => o.info[id]?.group === 'Core')).toBe(true);
    expect(routineOptionsState([], (id) => o.info[id] ?? null)).toEqual({ abs: false, supersets: false });
  });
});
