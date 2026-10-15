import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRefusedDistanceSlot, removeExercise, routineIssues } from '@fizz/domain';
import type { RoutineExercise } from '@fizz/schemas';

import { conflictLines, conflictText, deleteConfirm, EDITOR_COPY, editorPrimary, editorSlotIssue, exerciseMenu, LIBRARY_COPY_UI, LIBRARY_TOASTS, mainChipLabel, restChoices, rowMenu } from '../src/workout/library-view';
import { allRows, pickerSections, SESSION_PICKER_COPY } from '../src/workout/session-picker';
import type { SessionList, SessionPickerRow } from '../src/services/workout-services';

/**
 * The Workouts library's screen rules and words (routines.md §A2–§A5):
 * menus, the editor's primary, conflicts, picker sections, and WL-A16's
 * "no string in the library says routine".
 */
const SRC = join(import.meta.dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('row menu, confirm and toasts (§A2.1, §A5)', () => {
  it('one menu for ⋯, long-press and VoiceOver; rotation reads by membership', () => {
    expect(rowMenu({ inRotation: true })).toEqual(['Edit workout', 'Duplicate', 'Remove from rotation', 'Delete']);
    expect(rowMenu({ inRotation: false })).toEqual(['Edit workout', 'Duplicate', 'Add to rotation', 'Delete']);
    expect(deleteConfirm('Push A')).toEqual({ title: 'Delete Push A?', message: 'Past workouts stay.', confirm: 'Delete' });
    expect(LIBRARY_TOASTS.saved('Push A')).toBe('Saved Push A');
    expect(LIBRARY_TOASTS.deleted('Push A')).toBe('Push A deleted');
    expect(LIBRARY_COPY_UI.savedLink('Legs')).toBe('Saved · Legs ›');
  });
});

describe('editor primary (§3.3)', () => {
  it('Add a name → Add an exercise → Save; clean reads No changes; other issues Fix N', () => {
    expect(editorPrimary({ issues: ['Add a name', 'Add an exercise'], dirty: true, isNew: true })).toEqual({ label: 'Add a name', disabled: true });
    expect(editorPrimary({ issues: ['Add an exercise'], dirty: true, isNew: true })).toEqual({ label: 'Add an exercise', disabled: true });
    expect(editorPrimary({ issues: [], dirty: true, isNew: true })).toEqual({ label: 'Save', disabled: false });
    expect(editorPrimary({ issues: [], dirty: false, isNew: false })).toEqual({ label: 'No changes', disabled: true });
    expect(editorPrimary({ issues: ['Reps: the first number must be the smaller one.'], dirty: true, isNew: false })).toEqual({ label: 'Fix 1 issue', disabled: true });
    expect(mainChipLabel(true)).toBe('Main lift, on');
  });

  it('exercise ⋯: Superset with next only with a next one outside its group; Move up/down at the ends', () => {
    const e = (id: string, g: string | null) => ({ id, supersetGroup: g }) as Pick<RoutineExercise, 'id' | 'supersetGroup'>;
    const list = [e('a', null), e('b', 'A'), e('c', 'A')];
    expect(exerciseMenu(list, 'a')).toEqual(['Replace', 'Exercise info', 'Superset with next', 'Move down', 'Remove']);
    expect(exerciseMenu(list, 'b')).toEqual(['Replace', 'Exercise info', 'Ungroup', 'Move up', 'Move down', 'Remove']);
    expect(exerciseMenu(list, 'c')).toEqual(['Replace', 'Exercise info', 'Ungroup', 'Move up', 'Remove']);
    expect(exerciseMenu(list, 'x')).toEqual([]);
  });

  it('conflict lines and choices; rest choices', () => {
    expect(conflictLines({ lines: ['Cable fly → Pec deck'], changedAtUtc: '2026-10-11T17:40:00.000Z', tz: 'Europe/London' })[0]).toMatch(/^Cable fly → Pec deck · 11.Oct, \S/);
    expect(conflictLines({ lines: [], changedAtUtc: '2026-10-11T17:40:00.000Z', tz: 'Europe/London' })[0]).toMatch(/^Changed 11.Oct, \S/);
    expect(conflictText({ kind: 'name', mine: 'Push B', theirs: 'Push C' }, () => '')).toEqual({ title: 'Name', mine: 'Push B', theirs: 'Push C' });
    expect(conflictText({ kind: 'slot', slotId: 's', exerciseId: 'x', mine: null, theirs: null }, () => 'Bench press')).toEqual({ title: 'Bench press', mine: 'Removed', theirs: 'Removed' });
    const c = restChoices([{ seconds: 180, presetName: 'Heavy' }]);
    expect(c.find((x) => x.seconds === 180)?.label).toBe('Heavy 3:00');
    expect(c.map((x) => x.seconds)).toEqual([...c.map((x) => x.seconds)].sort((a, b) => a - b));
  });
});

describe('picker sections (§A2.4, WL-A3)', () => {
  const row = (label: string): SessionPickerRow => ({ key: label, label, kind: 'routine', target: { kind: 'next' }, routineId: null, sourceSessionId: null, lastDone: null, exerciseCount: 1, recommended: false, edited: false });
  it('Up next first, then labelled sections; empty ones hidden; one section alone has no label', () => {
    const list: SessionList = { upNext: row('Legs A'), workouts: [row('Push A')], fromHistory: [row('Shoulders')], older: [row('Full body')], recommendedKey: 'Legs A' };
    expect(pickerSections(list).map((s) => [s.title, s.rows.map((r) => r.label)])).toEqual([
      [null, ['Legs A']],
      [SESSION_PICKER_COPY.yourWorkouts, ['Push A']],
      [SESSION_PICKER_COPY.fromHistory, ['Shoulders']],
      [SESSION_PICKER_COPY.older, ['Full body']],
    ]);
    expect(allRows(list).map((r) => r.label)).toEqual(['Legs A', 'Push A', 'Shoulders', 'Full body']);
    expect(pickerSections({ upNext: null, workouts: [row('Push A'), row('Arms')], fromHistory: [], older: [], recommendedKey: null }).map((s) => s.title)).toEqual([null]);
  });
});

describe('WL-A16: no string in the library says "routine"', () => {
  const files = ['screens/routines/WorkoutsScreen.tsx', 'screens/routines/WorkoutEditorScreen.tsx', 'screens/routines/SaveWorkoutSheet.tsx', 'workout/library-view.ts'];
  it('copy constants and literal strings use "workout"', () => {
    const words = [...Object.values(LIBRARY_COPY_UI), ...Object.values(EDITOR_COPY)].map((v) => (typeof v === 'function' ? (v as (...a: string[]) => string)('Push A', 'Push A') : v));
    expect(words.filter((w) => /routine/i.test(w))).toEqual([]);
    for (const f of files) {
      // String literals and JSX text only (identifiers such as `routineId` are code).
      const literals = read(f).match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) ?? [];
      expect(literals.filter((l) => /\broutines?\b/i.test(l) && !/^'(routine|session|next)'$/.test(l))).toEqual([]);
    }
  });
  it('every row button is at least 44pt and rows at least 64pt (source check)', () => {
    const list = read('screens/routines/WorkoutsScreen.tsx');
    expect(list).toContain('minHeight: 64');
    expect(list).toMatch(/width: 44, height: 44/);
  });
});

describe('a workout with a distance slot (review library-browse r3 S1)', () => {
  const slot = (id: string, exerciseId: string, order: number, sets = 3): RoutineExercise => ({
    id,
    exerciseId,
    equipmentId: null,
    order,
    supersetGroup: null,
    setTemplates: Array.from({ length: sets }, (_, n) => ({ id: `${id}-${String(n)}`, setType: 'working' as const, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null })),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  });
  const measurement: Record<string, 'reps' | 'distance'> = { squat: 'reps', carry: 'distance' };
  const isDistance = (exerciseId: string) => measurement[exerciseId] === 'distance';

  it('a stored carry slot shows nothing and the workout saves; a newly added carry gets the card line and blocks Save', () => {
    const stored = [slot('s1', 'squat', 0), slot('s2', 'carry', 1)];
    // Legacy: rename and another exercise's sets change, carry kept as it was.
    const legacy = [slot('s1', 'squat', 0, 4), slot('s2', 'carry', 1)];
    expect(routineIssues({ name: 'Legs B', exercises: legacy }, isDistance, stored)).toEqual([]);
    expect(editorPrimary({ issues: [], dirty: true, isNew: false })).toEqual({ label: 'Save', disabled: false });
    for (const e of legacy) expect(editorSlotIssue(isRefusedDistanceSlot(e, isDistance, stored))).toBeNull();

    // A new carry slot: refused, the card says why and offers Replace / Remove.
    const fresh = slot('s3', 'carry', 2);
    const added = [...legacy, fresh];
    const issues = routineIssues({ name: 'Legs B', exercises: added }, isDistance, stored);
    expect(issues).toEqual(['Can’t save distance yet']);
    expect(editorPrimary({ issues, dirty: true, isNew: false })).toEqual({ label: 'Can’t save distance yet', disabled: true });
    const line = editorSlotIssue(isRefusedDistanceSlot(fresh, isDistance, stored));
    expect(line).toEqual({ text: 'Can’t save distance yet', actions: [EDITOR_COPY.replace, EDITOR_COPY.remove] });
    expect(added.filter((e) => isRefusedDistanceSlot(e, isDistance, stored)).map((e) => e.id)).toEqual(['s3']);
    // Every card action is a real menu action, so the screen runs it as from ⋯.
    for (const a of line?.actions ?? []) expect(exerciseMenu(added, 's3')).toContain(a);

    const after = removeExercise(added, 's3');
    expect(routineIssues({ name: 'Legs B', exercises: after }, isDistance, stored)).toEqual([]);
  });

  it('with another issue as well, the primary still counts them', () => {
    expect(editorPrimary({ issues: ['Can’t save distance yet', 'Reps: the first number must be the smaller one.'], dirty: true, isNew: false })).toEqual({ label: 'Fix 2 issues', disabled: true });
  });

  it('the editor renders the card line from editorSlotIssue', () => {
    expect(read('screens/routines/WorkoutEditorScreen.tsx')).toContain('editorSlotIssue(isRefusedDistanceSlot(slot, isDistance, stored))');
    expect(read('screens/routines/WorkoutEditorScreen.tsx')).toContain('routineIssues(edit, isDistance, stored)');
  });
});
