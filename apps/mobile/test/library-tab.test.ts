import { StackRouter, type ParamListBase, type StackNavigationState } from '@react-navigation/routers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NBSP, NO_FILTERS, type AddDestination } from '@fizz/domain';

import { backFromEditor, openLibrary, openYourPlan, popToFromEditor } from '../src/navigation/actions';
import { addEffortRow, addPrimary, addRepsRow, initialAddShape, posterSize, repsDraftOfShape, slotShapeOfAdd } from '../src/workout/exercise-info-view';
import { filterChipLabel, filterOptions, toggled, withFilter } from '../src/workout/library-browse-view';
import { countSteps, effortChoices, SET_BAR, setShapeStacked, shapeEffortRow, shapeRepsText, slotRepsDraft, stepperLimits } from '../src/workout/set-shape-view';
import { AX_FONT_SCALE } from '../src/workout/overview';
import { handOffLibraryToast, takeLibraryToast } from '../src/workout/library-toast';
import { beginSaveEdit, saveEditRequest, settleSaveEdit, type SaveEditOutcome } from '../src/workout/save-edit-handoff';

/**
 * The Library tab and the one sets control on the screen side
 * (exercise-library §9–§10, design-system §9.88–9.91): filter chips, the
 * `Sets [−] 3 [+]` steps and words, the Add sheet's rules, navigation to
 * and from the tab, and source checks that every creation path sends the
 * count, nothing here animates or calls the coach, and the poster never
 * runs a clock.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const plain = (s: string) => s.replaceAll(NBSP, ' ');

describe('filters (§2.3)', () => {
  it('an active chip shows its choice, or how many', () => {
    expect(filterChipLabel(NO_FILTERS, 'muscle')).toBe('Muscle');
    expect(filterChipLabel({ ...NO_FILTERS, muscles: ['Hamstrings'] }, 'muscle')).toBe('Muscle: Hamstrings');
    expect(filterChipLabel({ ...NO_FILTERS, muscles: ['Hamstrings', 'Glutes'] }, 'muscle')).toBe('Muscle: 2');
    expect(filterChipLabel({ ...NO_FILTERS, movements: ['vertical_pull'] }, 'movement')).toBe('Movement: Vertical pull');
    expect(filterChipLabel({ ...NO_FILTERS, equipment: ['cable_stack'] }, 'equipment')).toBe('Equipment: Cable / stack');
  });

  it('sheet options in order; toggling; setting one filter keeps the others and drops unknown keys', () => {
    expect(filterOptions('muscle').map((o) => o.label)).toEqual(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Forearms']);
    expect(filterOptions('equipment').map((o) => o.label)).toEqual(['Barbell', 'Dumbbells', 'Cable / stack', 'Plate-loaded', 'Bodyweight', 'Assisted', 'Cardio']);
    expect(filterOptions('movement').map((o) => o.label)).toContain('Lunge / single leg');
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
    const f = withFilter({ ...NO_FILTERS, atGym: true, muscles: ['Chest'] }, 'equipment', ['dumbbells', 'nope']);
    expect(f).toEqual({ ...NO_FILTERS, atGym: true, muscles: ['Chest'], equipment: ['dumbbells'] });
  });
});

describe('the sets control (§10.5)', () => {
  it('the bar starts at 3 and steps 1–10; a button at a limit is dimmed (null)', () => {
    expect(SET_BAR.start).toBe(3);
    expect(countSteps(3, SET_BAR.limits)).toEqual({ down: 2, up: 4 });
    expect(countSteps(1, SET_BAR.limits)).toEqual({ down: null, up: 2 });
    expect(countSteps(10, SET_BAR.limits)).toEqual({ down: 9, up: null });
    // The card uses the domain's next values: a slot above 10 may only go down.
    expect(countSteps(12, stepperLimits(12, 11, null))).toEqual({ down: 11, up: null });
    expect(countSteps(0, stepperLimits(0, null, 1))).toEqual({ down: null, up: 1 });
  });

  it('reps, per side, timed and Mixed; Target RPE / RIR, hidden with the scale off', () => {
    expect(plain(shapeRepsText({ reps: { min: 8, max: 10 }, durationS: null }, false))).toBe('8–10');
    expect(plain(shapeRepsText({ reps: { min: 8, max: 10 }, durationS: null }, true))).toBe('8–10 per side');
    expect(shapeRepsText({ reps: null, durationS: 45 }, false)).toBe('0:45');
    expect(shapeRepsText({ reps: 'mixed', durationS: null }, false)).toBe('Mixed');
    expect(shapeEffortRow({ targetRpe: null, targetRir: null }, 'rpe')).toEqual({ label: 'Target RPE', text: 'None' });
    expect(shapeEffortRow({ targetRpe: 7.5, targetRir: null }, 'rpe')).toEqual({ label: 'Target RPE', text: '7.5' });
    expect(shapeEffortRow({ targetRpe: null, targetRir: 'mixed' }, 'rir')).toEqual({ label: 'Target RIR', text: 'Mixed' });
    expect(shapeEffortRow({ targetRpe: 8, targetRir: null }, null)).toBeNull();
    expect(effortChoices('rpe').map((c) => c.label)).toEqual(['None', '6', '7', '7.5', '8', '8.5', '9', '9.5', '10']);
    expect(effortChoices('rir').map((c) => c.label)).toEqual(['None', '0', '1', '2', '3', '4']);
  });

  it('the card’s Reps sheet starts from the plain working sets, else the first non-warm-up set, else time', () => {
    expect(slotRepsDraft([{ setType: 'warmup', targetReps: { min: 5, max: 5 }, targetDurationS: null }, { setType: 'top', targetReps: { min: 4, max: 6 }, targetDurationS: null }, { setType: 'working', targetReps: { min: 8, max: 8 }, targetDurationS: null }])).toEqual({ kind: 'reps', exact: true, min: 8, max: 8 });
    expect(slotRepsDraft([{ setType: 'top', targetReps: { min: 4, max: 6 }, targetDurationS: null }])).toEqual({ kind: 'reps', exact: false, min: 4, max: 6 });
    expect(slotRepsDraft([{ setType: 'working', targetReps: null, targetDurationS: 30 }])).toEqual({ kind: 'time', seconds: 30 });
  });
});

describe('Add to a workout sheet (§9.5)', () => {
  const def = { workingSets: 3, warmups: 0, reps: { min: 6, max: 10 }, durationS: null, targetRpe: null };
  const dest = (over: Partial<AddDestination>): AddDestination => ({ kind: 'routine', id: 'r', label: 'Pull B', detail: null, disabled: false, disabledText: null, version: 4, primary: 'Add to Pull B', ...over });

  it('starts at the exercise’s default shape with effort None; nothing preselected; the primary names the destination', () => {
    const shape = initialAddShape(def, 'rpe');
    expect(shape).toEqual({ workingSets: 3, warmups: 0, reps: { min: 6, max: 10 }, durationS: null, effort: { scale: 'rpe', value: null }, repsTouched: false });
    expect(addPrimary(null)).toEqual({ label: 'Choose a workout', disabled: true });
    expect(addPrimary(dest({}))).toEqual({ label: 'Add to Pull B', disabled: false });
    expect(addPrimary(dest({ disabled: true, disabledText: 'Already in it' }))).toEqual({ label: 'Choose a workout', disabled: true });
    expect(plain(addRepsRow(shape, true).text)).toBe('6–10 per side');
    expect(addRepsRow({ ...shape, reps: null, durationS: 45 }, false)).toEqual({ label: 'Work time', text: '0:45' });
    expect(addEffortRow({ ...shape, effort: { scale: 'rpe', value: 8 } }, 'rpe')).toEqual({ label: 'Target RPE', text: '8' });
    expect(addEffortRow(shape, null)).toBeNull();
    expect(repsDraftOfShape(shape)).toEqual({ kind: 'reps', exact: false, min: 6, max: 10 });
  });

  it('New workout starts the editor card with the sheet’s shape (RIR goes to RIR)', () => {
    expect(slotShapeOfAdd({ ...initialAddShape(def, 'rir'), workingSets: 4, warmups: 1, effort: { scale: 'rir', value: 2 } })).toEqual({ workingSets: 4, warmups: 1, reps: { min: 6, max: 10 }, durationS: null, targetRpe: null, targetRir: 2 });
  });

  it('the poster is 240pt at most and never under 160pt', () => {
    expect(posterSize(390, 16, 12)).toBe(240);
    expect(posterSize(320, 16, 12)).toBe(240);
    expect(posterSize(200, 16, 12)).toBe(160);
  });

  it('the editor’s toast reaches Exercise detail once', () => {
    handOffLibraryToast({ key: 'k', text: 'Saved Legs', undo: null });
    expect(takeLibraryToast()).toEqual({ key: 'k', text: 'Saved Legs', undo: null });
    expect(takeLibraryToast()).toBeNull();
  });
});

describe('navigation (EL10)', () => {
  const routeNames = ['Tabs', 'WorkoutOverview', 'WorkoutEditor', 'Workout', 'ExerciseInfo'];
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  type State = StackNavigationState<ParamListBase>;
  const apply = (state: State, action: Parameters<typeof router.getStateForAction>[1]): State => {
    const next = router.getStateForAction(state, action, options);
    if (next === null || next.stale) throw new Error(`action not handled: ${action.type}`);
    return next as State;
  };
  const navigate = (name: string, params: object = {}) => ({ type: 'NAVIGATE', payload: { name, params } }) as const;
  const toast = { key: 'k', text: 'Saved Push A', undo: null };

  it('Edit workouts and the editor’s Save land on Library › Workouts on the one Tabs, with the toast', () => {
    let s = apply(router.getInitialState(options), navigate('WorkoutOverview', { target: { kind: 'next' } }));
    s = apply(s, openLibrary('workouts'));
    expect(s.routes.map((r) => r.name)).toEqual(['Tabs']);
    expect(s.routes[0]?.params).toEqual({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'workouts' }, pop: true } });
    s = apply(s, navigate('WorkoutEditor', { routineId: null, from: 'Library' }));
    s = apply(s, popToFromEditor('Library', toast));
    expect(s.routes.map((r) => r.name)).toEqual(['Tabs']);
    expect(s.routes[0]?.params).toEqual({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'workouts', toast }, pop: true } });
  });

  it('Today’s `Day 2 of 4 ›` lands on Library › Workouts (Your plan at the top) on the one Tabs, once per tap (Ben, 19 Oct)', () => {
    let s = apply(router.getInitialState(options), navigate('WorkoutOverview', { target: { kind: 'next' } }));
    s = apply(s, openYourPlan('tap-1'));
    expect(s.routes.map((r) => r.name)).toEqual(['Tabs']);
    expect(s.routes[0]?.params).toEqual({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'workouts', plan: 'tap-1' }, pop: true } });
  });

  it('from Exercise detail, the editor’s Save and Cancel go back to it', () => {
    let s = apply(router.getInitialState(options), navigate('WorkoutEditor', { routineId: null, from: 'ExerciseInfo' }));
    s = apply(s, popToFromEditor('ExerciseInfo', toast));
    expect(s.routes.map((r) => r.name)).toEqual(['Tabs']);
    s = apply(apply(router.getInitialState(options), navigate('WorkoutEditor', { routineId: null, from: 'ExerciseInfo' })), backFromEditor('ExerciseInfo', undefined));
    expect(s.routes.map((r) => r.name)).toEqual(['Tabs']);
  });

  it('the tab is registered second with the dumbbell icon; Today no longer links to Workouts; the picker’s Edit workouts opens the Library', () => {
    const nav = read('navigation/AppNavigator.tsx');
    const tabs = [...nav.matchAll(/<TabNav\.Screen name="(\w+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['Today', 'Library', 'Progress', 'Profile']);
    expect(nav).toContain("Library: ['dumbbell', 'dumbbell.fill']");
    const today = code(read('screens/TodayScreen.tsx'));
    expect(today).not.toMatch(/navigate\('Workouts'\)/);
    expect(today).toMatch(/screen: 'Library', params: \{ screen: 'LibraryHome', params: \{ segment: 'workouts' \} \}/);
    expect(code(read('screens/workout/WorkoutOverviewScreen.tsx'))).toMatch(/openLibrary\('workouts'\)/);
  });
});

describe('source checks (EL-B16, EL-B24, rules 1 and 2)', () => {
  it('every creation path sends the Sets count', () => {
    expect(code(read('screens/workout/ExercisePickerScreen.tsx'))).toMatch(/shape: \{ workingSets: sets \}/);
    expect(code(read('screens/workout/ExercisePickerScreen.tsx'))).toMatch(/<SetCountBar /);
    expect(code(read('screens/workout/WorkoutOverviewScreen.tsx'))).toMatch(/kind: 'add', exerciseId: row\.exerciseId, workingSets: addSets/);
    expect(code(read('screens/workout/OverviewEditSheets.tsx'))).toMatch(/<SetCountBar /);
    const editor = code(read('screens/routines/WorkoutEditorScreen.tsx'));
    expect(editor).toMatch(/\{ \.\.\.x\.defaultShape, workingSets: sets \}/);
    expect(editor).toMatch(/<SetShapeControl/);
    expect(editor).toMatch(/setWorkingSetCount\(l, slot\.id, n, newUuid\)/);
    // `+ Warm-up` / `+ Working` retire: the steppers do the same.
    expect(editor).not.toMatch(/EDITOR_COPY\.addWarmup|EDITOR_COPY\.addWorking/);
    const info = code(read('screens/library/ExerciseInfoScreen.tsx'));
    expect(info).toMatch(/<SetShapeControl/);
    expect(info).toMatch(/services\.library\.addToWorkout\(/);
  });

  it('the Library screens compute no progression, never call the coach, and never animate; the poster runs no clock', () => {
    for (const f of ['screens/library/LibraryScreen.tsx', 'screens/library/ExerciseInfoScreen.tsx', 'ui/set-shape.tsx']) {
      const src = code(read(f));
      expect(src).not.toMatch(/services\.coach|calculateNextTargets|nextTargetsFor|roundToAvailableLoad|Animated\.|useSharedValue/);
    }
    const info = code(read('screens/library/ExerciseInfoScreen.tsx'));
    expect(info).toMatch(/<Player guide=\{view\.guide\} size=\{size\} visible=\{focused\} poster \/>/);
    const player = code(read('guide/GuidePlayer.tsx'));
    expect(player).toMatch(/const stillsOnly = stillsOnlyProp \|\| posterOnly;/);
    expect(player).toMatch(/if \(posterOnly\) return canvas;/);
  });

  it('steppers and rows are at least 44pt; values are tabular', () => {
    const ui = read('ui/set-shape.tsx');
    expect(ui).toMatch(/width: 44,\s+height: 44,/);
    expect(ui).toMatch(/minHeight: 52/);
    expect(ui).toMatch(/minHeight: 64/);
    expect(ui).toMatch(/variant="headline" numeric/);
  });
});

describe('review library-browse B1: New workout from Library › Workouts', () => {
  it('the header’s ＋ opens New workout on the Workouts segment whatever the list holds; the old root Workouts route is gone', () => {
    const lib = code(read('screens/library/LibraryScreen.tsx'));
    // Shown on the segment, not tied to the list being empty.
    expect(lib).toMatch(/segment === 'workouts' \? <NewWorkoutButton from="Library" \/> : null/);
    const list = code(read('screens/routines/WorkoutsScreen.tsx'));
    expect(list).toMatch(/navigation\.navigate\('WorkoutEditor', \{ routineId: null, from \}\)/);
    expect(list).toMatch(/accessibilityLabel=\{LIBRARY_COPY_UI\.newWorkout\}/);
    const nav = code(read('navigation/AppNavigator.tsx'));
    expect(nav).not.toMatch(/name="Workouts"/);
    expect(code(read('navigation/actions.ts'))).not.toMatch(/replaceWithWorkouts/);
  });
});

describe('review library-browse B2: Save to Workouts → Edit ›', () => {
  it('the handoff settles once: saved, or cancelled when the editor closes without a Save', () => {
    const got: SaveEditOutcome[] = [];
    const req = { from: { kind: 'session' as const, sessionId: 's' }, addToRotation: true, opId: 'op-1' };
    beginSaveEdit('op-1', req, (o) => got.push(o));
    expect(saveEditRequest('op-1')).toEqual(req);
    const routine = { id: 'r' } as never;
    expect(settleSaveEdit('op-1', { kind: 'saved', routine })).toBe(true);
    // The editor's unmount after a Save: nothing more.
    expect(settleSaveEdit('op-1', { kind: 'cancelled' })).toBe(false);
    expect(saveEditRequest('op-1')).toBeNull();
    beginSaveEdit('op-2', { ...req, opId: 'op-2' }, (o) => got.push(o));
    expect(settleSaveEdit('op-2', { kind: 'cancelled' })).toBe(true);
    expect(got).toEqual([{ kind: 'saved', routine }, { kind: 'cancelled' }]);
  });

  it('the sheet offers Edit › and hands its opId and rotation over; the editor saves through saveFrom with the edit, and Cancel or unmount re-shows the sheet', () => {
    const sheet = code(read('screens/routines/SaveWorkoutSheet.tsx'));
    expect(sheet).toMatch(/label=\{`\$\{LIBRARY_COPY_UI\.edit\} ›`\}/);
    expect(sheet).toMatch(/onEdit\(\{ name: name\.trim\(\), addToRotation: rotation, opId: opId\.current \}\)/);
    expect(sheet).toMatch(/beginSaveEdit\(held\.opId, \{ from: state\.from, addToRotation: held\.addToRotation, opId: held\.opId \}/);
    expect(sheet).toMatch(/navigation\.navigate\('WorkoutEditor', \{ routineId: null, from: 'SaveSheet', draft: \{ name: e\.name, exercises: state\.exercises \}, saveAs: e\.key \}\)/);
    // Re-showing keeps the sheet's opId: it only starts afresh on a new opening.
    expect(sheet).toMatch(/\}, \[openKey, initialName\]\);/);
    const editor = code(read('screens/routines/WorkoutEditorScreen.tsx'));
    expect(editor).toMatch(/services\.routines\.saveFrom\(\{ from: req\.from, name: next\.name\.trim\(\), addToRotation: req\.addToRotation, opId: req\.opId, edit: next \}\)/);
    expect(editor).toMatch(/settleSaveEdit\(saveAs, \{ kind: 'cancelled' \}\)/);
    expect(editor).toMatch(/settleSaveEdit\(saveAs, \{ kind: 'saved', routine: r\.routine \}\)/);
  });
});

describe('review library-browse S3: the sets control stacks at AX sizes (EL-B24)', () => {
  it('stacks at AX1 and above unless a caller says otherwise', () => {
    expect(setShapeStacked(undefined, 1, AX_FONT_SCALE)).toBe(false);
    expect(setShapeStacked(undefined, 1.35, AX_FONT_SCALE)).toBe(false);
    expect(setShapeStacked(undefined, AX_FONT_SCALE, AX_FONT_SCALE)).toBe(true);
    expect(setShapeStacked(undefined, 3.1, AX_FONT_SCALE)).toBe(true);
    expect(setShapeStacked(false, 3.1, AX_FONT_SCALE)).toBe(false);
    expect(setShapeStacked(true, 1, AX_FONT_SCALE)).toBe(true);
  });

  it('SetShapeControl and the Sets bar both use it, so every caller (editor card, Add sheet, pick sheets) stacks', () => {
    const ui = code(read('ui/set-shape.tsx'));
    expect(ui).toMatch(/const stacked = useStacked\(p\.stacked\);/);
    expect(ui).toMatch(/const stacked = useStacked\(undefined\);/);
    expect(ui).toMatch(/moreLabel=\{SET_SHAPE_COPY\.moreSets\} stacked=\{stacked\} \/>/);
  });
});
