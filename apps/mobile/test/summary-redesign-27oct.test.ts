import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { WorkoutSummary } from '@fizz/domain';

import { newBestLastLine, summaryDoneRows, summaryMenu, summarySavedLine, summaryShownRows, summaryStatItems, SUMMARY_EXERCISES_SHOWN } from '../src/workout/summary-view';

/**
 * (Ben, 27 Oct; redesign-27oct.md §E2) The Summary: Saved line, New best card, Time / Sets / Exercises, one Next time
 * list (Undo all; Why? / Undo per line; offers Skip / Apply), Exercises done, Feel, Health line, Ask about this
 * workout, Done. Edit times, Save as workout and Delete in ⋯.
 */

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'screens', 'workout', 'SummaryScreen.tsx'), 'utf8');
const body = src.slice(src.indexOf('  return (\n    <View style={{ flex: 1, backgroundColor'), src.indexOf('      {nameSheet !== null ? ('));

type Ex = WorkoutSummary['exercises'][number];
const ex = (n: number, over: Partial<Ex> = {}): Ex => ({ sessionExerciseId: `se${String(n)}`, exerciseId: `e${String(n)}`, name: `Exercise ${String(n)}`, setsText: '3 sets', results: '80×8 · 80×8 · 80×7', skipped: 0, sides: null, unitNote: '', ...over });

describe('the order on screen', () => {
  it('Saved, New best, the stat strip, Next time, Exercises · done, check-in and pain lines, Feel, Health, Ask, Done', () => {
    const at = (needle: string) => {
      const i = body.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = ['summarySavedLine(', '<HeroHeader', 'New best</AppText>', '<StatStrip', '<NextRow', '<MainLiftRow', '<KeepRow', 'title="Exercises · done"', '<FeelRow', '<LinkedActivityRow', 'label="Ask about this workout"', '<PrimaryButton label="Done"'];
    const pos = order.map(at);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it('Undo all sits at the top of Next time; Edit times, Save to Workouts and the rename pencil are no longer on the page', () => {
    const next = body.slice(body.indexOf('{nextOpen ? ('), body.indexOf('<NextRow'));
    expect(next).toContain('label="Undo all"');
    expect(body).not.toContain('label="Edit times"');
    expect(body).not.toContain('LIBRARY_COPY_UI.saveToWorkouts');
    expect(body).not.toContain('name="pencil"');
    expect(body).not.toContain('Workout saved on this phone');
    expect(body).not.toContain('<Comparison');
    // The backup failure still says so (honest state).
    expect(body).toContain('Backup didn’t save ›');
  });
});

describe('summary-view helpers', () => {
  it('`Saved 18:49`; a date-only workout: `Saved`', () => {
    expect(summarySavedLine(1000, () => '18:49')).toBe('Saved 18:49');
    expect(summarySavedLine(null, () => '18:49')).toBe('Saved');
  });

  it('Time / Sets / Exercises: sets done of planned with a plan, else the sets logged; no Time for a date-only workout', () => {
    const facts = { activeText: '47 min', exercisesDone: 5, exercisesTotal: 5, workingSets: 15 };
    expect(summaryStatItems(facts, { doneSets: 15, plannedSets: 16 })).toEqual([
      { label: 'Time', value: '47 min' },
      { label: 'Sets', value: '15/16' },
      { label: 'Exercises', value: '5/5' },
    ]);
    expect(summaryStatItems({ ...facts, activeText: null }, null)).toEqual([
      { label: 'Sets', value: '15' },
      { label: 'Exercises', value: '5/5' },
    ]);
  });

  it('Exercises · done: done of planned (`4/4`), else the count; the unit note on the results line; 3 shown, then `N more`', () => {
    const rows = summaryDoneRows([ex(1), ex(2, { setsText: '2 sets (kg each)', unitNote: '(kg each)', results: '24×8 · 26×8', skipped: 1 }), ex(3), ex(4), ex(5)], [{ sessionExerciseId: 'se1', doneSets: 4, plannedSets: 4 }]);
    expect(rows[0]).toMatchObject({ name: 'Exercise 1', count: '4/4', results: '80×8 · 80×8 · 80×7' });
    expect(rows[0]?.spoken).toBe('Exercise 1, 4 of 4 sets, 80×8 · 80×8 · 80×7');
    expect(rows[1]).toMatchObject({ count: '2 sets · 1 skipped', results: '24×8 · 26×8 (kg each)' });
    expect(SUMMARY_EXERCISES_SHOWN).toBe(3);
    expect(summaryShownRows(rows, false)).toMatchObject({ more: '2 more' });
    expect(summaryShownRows(rows, false).shown).toHaveLength(3);
    expect(summaryShownRows(rows, true)).toEqual({ shown: rows, more: null });
    expect(summaryShownRows(rows.slice(0, 3), false).more).toBeNull();
  });

  it('⋯: Edit times, Save as workout (until saved), Rename, Link activity from Health (when one can be), Delete (last, destructive)', () => {
    const all = summaryMenu({ dateOnly: false, saved: false, canDelete: true, healthChoices: 1, linkLabel: 'Link activity from Health' });
    expect(all.map((m) => m.label)).toEqual(['Edit times', 'Save as workout', 'Rename', 'Link activity from Health', 'Delete workout']);
    expect(all.at(-1)?.destructive).toBe(true);
    expect(summaryMenu({ dateOnly: true, saved: true, canDelete: false, healthChoices: 0, linkLabel: 'x' }).map((m) => m.id)).toEqual(['rename']);
  });

  it('New best: `Last: 80 × 6 · 20 Oct` under it; nothing when no earlier set is named', () => {
    expect(newBestLastLine({ set: '80 × 6', atMs: 1 }, () => '20 Oct')).toBe('Last: 80 × 6 · 20 Oct');
    expect(newBestLastLine(undefined, () => '20 Oct')).toBeNull();
  });
});
