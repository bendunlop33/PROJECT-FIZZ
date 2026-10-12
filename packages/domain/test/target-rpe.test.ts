import { describe, expect, it } from 'vitest';
import type { PlannedSet } from '@fizz/schemas';

import { builtInTargetRpe, PLAYBOOK_DEFAULT_MAX_RPE, ruleTargetRpes, starterExercises, targetRpeOf, targetRpeText, targetText } from '../src/index';
import { barbell, dumbbells, kg } from './fixtures';

/** CHANGELOG 2026-10-11 "Offers follow the target RPE" (b): every working set carries a target RPE. */

const plan = (over: Partial<PlannedSet> = {}): PlannedSet => ({ load: kg(100), reps: { min: 3, max: 6 }, durationS: null, rpe: null, rir: null, ...over });

describe('builtInTargetRpe', () => {
  it('is the rep-range profile value, never above the playbook default ceiling (rule 3)', () => {
    expect(builtInTargetRpe('main_barbell')).toBe(8.5);
    expect(builtInTargetRpe('compound')).toBe(9);
    expect(builtInTargetRpe('isolation')).toBe(9);
    expect(PLAYBOOK_DEFAULT_MAX_RPE).toBe(9);
  });
});

describe('targetRpeOf: Ben, then the coach or plan, then the built-in rule', () => {
  it.each([
    ['Ben’s override wins', plan({ rpe: 8, rpeOverride: 10, source: 'coach' }), 8.5, { rpe: 10, source: 'ben' }],
    ['the coach’s recommendation', plan({ rpe: 8, source: 'coach' }), 8.5, { rpe: 8, source: 'coach' }],
    ['the routine’s RPE', plan({ rpe: 7.5 }), 8.5, { rpe: 7.5, source: 'plan' }],
    ['the routine’s RIR as 10 − RIR', plan({ rir: 2 }), 8.5, { rpe: 8, source: 'plan' }],
    ['else the built-in rule', plan({ source: 'built_in_rule' }), 8.5, { rpe: 8.5, source: 'rule' }],
    ['no rule value known: none', plan(), null, null],
  ] as const)('%s', (_n, planned, rule, want) => {
    expect(targetRpeOf({ setType: 'working', planned }, rule)).toEqual(want);
  });

  it('warm-up and drop sets carry no target', () => {
    expect(targetRpeOf({ setType: 'warmup', planned: plan({ rpe: 8 }) }, 8.5)).toBeNull();
    expect(targetRpeOf({ setType: 'drop', planned: plan({ rpe: 8 }) }, 8.5)).toBeNull();
    expect(targetRpeOf({ setType: 'top', planned: plan() }, 8.5)?.rpe).toBe(8.5);
    expect(targetRpeOf({ setType: 'backoff', planned: plan() }, 9)?.rpe).toBe(9);
  });
});

describe('ruleTargetRpes', () => {
  const starters = new Map(starterExercises('2026-10-09T00:00:00.000Z').map((e) => [e.id, e]));
  const byName = new Map(starterExercises('2026-10-09T00:00:00.000Z').map((e) => [e.name, e]));
  const bench = byName.get('Bench press');
  const curl = byName.get('Dumbbell curl');
  if (bench === undefined || curl === undefined) throw new Error('fixture');
  const bar = barbell();
  const db = dumbbells();
  const row = (id: string, exerciseId: string, equipmentId: string | null, loadConvention: 'total' | 'per_hand') => ({
    id, sessionId: 's', exerciseId, exerciseName: 'x', measurement: 'reps' as const, laterality: 'bilateral' as const, equipmentId, loadConvention, unit: 'kg' as const, order: 0, supersetGroup: null, transitionRestS: null, progressionRuleId: null,
  });

  it('reads each row’s category from the catalogue and its equipment', () => {
    const agg = {
      session: { equipmentSnapshot: [bar, db] } as never,
      exercises: [row('a', bench.id, bar.id, 'total'), row('b', curl.id, db.id, 'per_hand'), row('c', 'unknown', null, 'total')],
    };
    expect(ruleTargetRpes(agg, (id) => starters.get(id) ?? null)).toEqual({ a: 8.5, b: 9, c: 9 });
  });
});

describe('target line', () => {
  it('shows `@ RPE 8` after the target (minimal copy)', () => {
    expect(targetRpeText(8).replaceAll('\u00a0', ' ')).toBe('@ RPE 8');
    expect(targetRpeText(8.5).replaceAll('\u00a0', ' ')).toBe('@ RPE 8.5');
    expect(targetText(plan(), { convention: 'total', rpe: 8 })?.replaceAll('\u00a0', ' ')).toBe('Target 100 kg · 3–6 reps @ RPE 8');
    expect(targetText(plan(), { convention: 'total' })?.replaceAll('\u00a0', ' ')).toBe('Target 100 kg · 3–6 reps');
    expect(targetText(plan({ load: null, reps: null }), { convention: 'total', rpe: 8 })).toBeNull();
  });
});
