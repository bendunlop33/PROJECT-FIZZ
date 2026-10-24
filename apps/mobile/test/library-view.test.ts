import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRefusedDistanceSlot, removeExercise, routineIssues } from '@fizz/domain';
import type { RoutineExercise } from '@fizz/schemas';

import { conflictLines, conflictText, deleteConfirm, EDITOR_COPY, editorPrimary, LIBRARY_COPY_UI, LIBRARY_TOASTS, restChoices, rowMenu } from '../src/workout/library-view';
import { TEMPLATE_COPY, templateTableView, type TemplateEditorCtx } from '../src/workout/template-editor';

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

describe('WL-A16: no string in the library says "routine"', () => {
  const files = ['screens/routines/WorkoutsScreen.tsx', 'screens/builder/EditWorkoutScreen.tsx', 'workout/template-editor.ts', 'screens/routines/SaveWorkoutSheet.tsx', 'workout/library-view.ts'];
  it('copy constants and literal strings use "workout"', () => {
    const words = [...Object.values(LIBRARY_COPY_UI), ...Object.values(EDITOR_COPY), ...Object.values(TEMPLATE_COPY)].map((v) => (typeof v === 'function' ? (v as (...a: string[]) => string)('Push A', 'Push A') : v));
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
    // (Ben, 23 Oct: one editor) The rows are Your workout's: a stored carry's row shows nothing.
    const ctx = (list: readonly RoutineExercise[]): TemplateEditorCtx => ({
      info: Object.fromEntries(list.map((e) => [e.exerciseId, { id: e.exerciseId, name: e.exerciseId, measurement: measurement[e.exerciseId] ?? 'reps', laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: [], defaultRestS: null, compound: false, defaultShape: { workingSets: 3, warmups: 0, reps: null, durationS: null, targetRpe: null } }])),
      facts: {},
      gym: null,
      unit: 'kg',
      globalDefault: { seconds: 120 },
      effortScale: 'rpe',
      stored,
    });
    const rows = (list: readonly RoutineExercise[]) => templateTableView(list, ctx(list)).rounds.flatMap((r) => r.rows);
    expect(rows(legacy).map((r) => r.issue)).toEqual([null, null]);

    // A new carry slot: refused; its row says why, and swipe or its menu has Delete and Swap.
    const fresh = slot('s3', 'carry', 2);
    const added = [...legacy, fresh];
    const issues = routineIssues({ name: 'Legs B', exercises: added }, isDistance, stored);
    expect(issues).toEqual(['Can’t save distance yet']);
    expect(editorPrimary({ issues, dirty: true, isNew: false })).toEqual({ label: 'Can’t save distance yet', disabled: true });
    expect(rows(added).map((r) => r.issue)).toEqual([null, null, 'Can’t save distance yet']);
    expect(rows(added)[2]?.actions.map((a) => a.name)).toEqual(expect.arrayContaining(['delete', 'swap']));
    expect(added.filter((e) => isRefusedDistanceSlot(e, isDistance, stored)).map((e) => e.id)).toEqual(['s3']);

    const after = removeExercise(added, 's3');
    expect(routineIssues({ name: 'Legs B', exercises: after }, isDistance, stored)).toEqual([]);
  });

  it('with another issue as well, the primary still counts them', () => {
    expect(editorPrimary({ issues: ['Can’t save distance yet', 'Reps: the first number must be the smaller one.'], dirty: true, isNew: false })).toEqual({ label: 'Fix 2 issues', disabled: true });
  });

  it('the editor blocks Save from routineIssues with the stored slots, and the shared table shows the row’s issue', () => {
    expect(read('screens/builder/EditWorkoutScreen.tsx')).toContain("routineIssues(edit, (id) => info[id]?.measurement === 'distance', ctx.stored)");
    expect(read('screens/builder/WorkoutTable.tsx')).toContain('{r.issue}');
  });
});
