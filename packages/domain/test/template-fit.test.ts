import { describe, expect, it } from 'vitest';
import type { RoutineExercise, SetTemplate } from '@fizz/schemas';

import { fitNoteOf, fitTemplateToMinutes, type TemplateFitInput } from '../src';

/**
 * (Ben, 26 Oct; app review finding 6) The one editor's `Time ±`: the template's sets and rests fit to the length,
 * the way Your workout's fit does, as page edits. A simple estimate here: 2:00 per working set plus its rest.
 */
let n = 0;
const id = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
const set = (setType: SetTemplate['setType'] = 'working', restOverrideS: number | null = null): SetTemplate => ({ id: id(), setType, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS });
const ex = (exerciseId: string, sets: number, opts: { rest?: number; group?: string | null } = {}): RoutineExercise => ({
  id: id(),
  exerciseId,
  equipmentId: null,
  order: 0,
  supersetGroup: opts.group ?? null,
  setTemplates: Array.from({ length: sets }, () => set()),
  restBySetType: opts.rest === undefined ? {} : { working: { seconds: opts.rest } },
  transitionRestS: null,
  progressionRuleId: null,
});
const DEFAULT_REST = 120;
const restOf = (e: RoutineExercise, t: SetTemplate) => t.restOverrideS ?? e.restBySetType[t.setType]?.seconds ?? DEFAULT_REST;
const estimateS = (list: readonly RoutineExercise[]) => list.reduce((s, e) => s + e.setTemplates.reduce((a, t) => a + 60 + restOf(e, t), 0), 0);
const COMPOUND = new Set(['bench', 'row']);
const input = (exercises: RoutineExercise[], minutes: number, main: boolean[]): TemplateFitInput => ({
  exercises,
  minutes,
  main,
  isCompound: (x) => COMPOUND.has(x),
  isCore: (x) => x === 'crunch',
  defaultRestS: DEFAULT_REST,
  estimateS,
  newId: id,
});
const working = (e: RoutineExercise | undefined) => e?.setTemplates.filter((t) => t.setType === 'working').length ?? 0;

describe('fitTemplateToMinutes (Ben, 26 Oct)', () => {
  // bench 4 × 3:00 = 12, row 3 × 3:00 = 9, fly 3 × 3:00 = 9, crunch 3 × 3:00 = 9 → 39 min
  const workout = () => [ex('bench', 4), ex('row', 3), ex('fly', 3), ex('crunch', 3)];

  it('already fits and nothing more fits: unchanged (`fits`)', () => {
    const w = workout();
    const r = fitTemplateToMinutes(input(w, 40, [true, false, false, false]));
    expect(r.status).toBe('fits');
    expect(r.exercises).toEqual(w);
    expect(r.steps).toEqual([]);
  });

  it('shorter: rests first, on the accessories only (compound 1:30, isolation 1:15)', () => {
    const w = workout();
    const r = fitTemplateToMinutes(input(w, 35, [true, false, false, false]));
    expect(r.status).toBe('fitted');
    expect(r.steps).toEqual([{ kind: 'rest', from: 'normal', to: 'shorter' }]);
    expect(r.exercises[0]?.restBySetType).toEqual({});
    expect(r.exercises[1]?.restBySetType.working?.seconds).toBe(90);
    expect(r.exercises[2]?.restBySetType.working?.seconds).toBe(75);
    expect(r.seconds).toBeLessThanOrEqual(35 * 60 + 29);
  });

  it('then the least training lost: isolation sets before compound ones, never the main lift, never below 2 sets', () => {
    const r = fitTemplateToMinutes(input(workout(), 30, [true, false, false, false]));
    expect(r.status).toBe('fitted');
    expect(working(r.exercises[0])).toBe(4);
    expect(working(r.exercises.find((e) => e.exerciseId === 'fly'))).toBe(2);
    expect(working(r.exercises.find((e) => e.exerciseId === 'row'))).toBe(3);
    for (const e of r.exercises) expect(working(e)).toBeGreaterThanOrEqual(2);
    const note = fitNoteOf(r.steps, (x) => ({ fly: 'Cable fly', row: 'Row', crunch: 'Crunch' })[x] ?? x, () => '');
    expect(note.lines[0]).toBe('Medium rest');
    expect(note.lines).toContain('Cable fly 3 → 2 sets');
    expect(note.note).toMatch(/^−\d sets?$/);
  });

  it('an accessory at 2 sets is left out whole; a superset it leaves is unlinked; the main lift stays', () => {
    const w = [ex('bench', 4), ex('fly', 2, { group: 'A' }), ex('crunch', 2, { group: 'A' })];
    const r = fitTemplateToMinutes(input(w, 15, [true, false, false]));
    expect(r.exercises[0]?.exerciseId).toBe('bench');
    expect(working(r.exercises[0])).toBe(4);
    expect(r.steps.some((s) => s.kind === 'drop')).toBe(true);
    expect(r.exercises.filter((e) => e.supersetGroup !== null)).toHaveLength(0);
  });

  it('can’t get there: `over`, the main lifts untouched, at least one exercise', () => {
    const r = fitTemplateToMinutes(input([ex('bench', 8), ex('fly', 3)], 15, [true, false]));
    expect(r.status).toBe('over');
    expect(working(r.exercises[0])).toBe(8);
    expect(r.exercises.length).toBeGreaterThanOrEqual(1);
  });

  it('longer: +1 set on the most valuable accessory first (compound), max 4, never the main lift', () => {
    const w = [ex('bench', 3), ex('row', 3), ex('fly', 3)];
    const r = fitTemplateToMinutes(input(w, 35, [true, false, false]));
    expect(r.status).toBe('fitted');
    expect(working(r.exercises[0])).toBe(3);
    expect(working(r.exercises[1])).toBe(4);
    const big = fitTemplateToMinutes(input(w, 180, [true, false, false]));
    expect(big.exercises.slice(1).map(working)).toEqual([4, 4]);
    expect(fitNoteOf(big.steps, (x) => x, () => '').note).toBe('+2 sets');
  });

  it('new sets copy the last working set with a fresh ID; warm-ups are never touched', () => {
    const w = [ex('bench', 3), { ...ex('row', 2), setTemplates: [set('warmup'), set(), set()] }];
    const r = fitTemplateToMinutes(input(w, 25, [true, false]));
    const row = r.exercises[1];
    expect(row?.setTemplates.filter((t) => t.setType === 'warmup')).toHaveLength(1);
    const ids = row?.setTemplates.map((t) => t.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
