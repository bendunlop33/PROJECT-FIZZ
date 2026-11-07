import { describe, expect, it } from 'vitest';

import type { ChangeSide, NextTimeRow } from '@fizz/domain';
import type { Load, NextSessionTargetRecord } from '@fizz/schemas';

import type { CoachAvailability } from '../src/coach/coach-service';
import { nextTimeView } from '../src/coach/next-time-view';

/**
 * (Ben, 30 Oct; redesign-27oct §E2) "The changes should be cleaner and more succinct. Ie show from and to and then the
 * show why so it can all be one line." Each Next time row is the name, from → to, `Why?` and a compact action; the
 * source, %, note and reasons only behind `Why?`. Presentation only: the same rows and taps as before.
 */

const AT = '2026-10-30T08:00:00.000Z';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const avail: CoachAvailability = { status: 'ok', model: 'gpt-6.1-sol' };
const side = (load: Load | null, reps: number, sets: number): ChangeSide => ({ target: { load, reps: { min: reps, max: reps } }, sets });

const BENCH = ID(1001);
const PULLDOWN = ID(1002);
const INCLINE = ID(1003);
const from: Record<string, ChangeSide> = {
  [BENCH]: side(kg(100), 5, 3),
  [PULLDOWN]: side(kg(59, 'stack'), 10, 3),
  [INCLINE]: side(kg(24, 'per_hand'), 10, 3),
};

const ruleRow = (exerciseId: string, name: string, to: ChangeSide | null, over: Partial<NextTimeRow> = {}): NextTimeRow => ({
  exerciseId,
  exerciseName: name,
  kind: 'change',
  target: 'Target …',
  summary: 'Hit the top of the range.',
  facts: [],
  ruleName: 'Double progression',
  decision: 'increase_load',
  from: from[exerciseId] ?? null,
  to,
  ...over,
});

const coach = (exerciseId: string, name: string, status: NextSessionTargetRecord['status'], over: Partial<NextSessionTargetRecord> = {}): NextSessionTargetRecord => ({
  id: ID(500 + Number(exerciseId.slice(-4))),
  ownerId: ID(1),
  version: 1,
  createdAtUtc: AT,
  updatedAtUtc: AT,
  sourceSessionId: ID(9),
  sourceVersion: 3,
  exerciseId,
  exerciseName: name,
  actionId: ID(77),
  target: { load: kg(102.5), reps: { min: 5, max: 5 } },
  sets: null,
  builtIn: { load: kg(100), reps: { min: 5, max: 5 } },
  builtInSets: 3,
  size: status === 'proposed' ? 'bigger' : 'small',
  status,
  reason: 'Every set was RIR 3.',
  guardNotes: [],
  pctChange: 2.5,
  usedBySessionId: null,
  ...over,
});

const view = (rows: NextTimeRow[], coachRows: NextSessionTargetRecord[] = [], ruleRows: NextSessionTargetRecord[] = []) =>
  nextTimeView({ title: 'Push A', builtIn: { sourceTag: 'Rule', rows, emptyText: null }, coachRows, ruleRows, availability: avail, reviewing: false, from });

describe('one line per Next time change (Ben, 30 Oct)', () => {
  it('the coach’s saved change: `Bench press  100 → 102.5 kg`, Why? holds Coach · +2.5% and the reason, Undo trails', () => {
    const r = view([], [coach(BENCH, 'Bench press', 'saved')])?.rows[0];
    expect(r?.exerciseName).toBe('Bench press');
    expect(r?.line).toEqual({ text: '100 → 102.5 kg', spoken: '100 to 102.5 kilograms' });
    expect(r?.info[0]).toBe('Coach · +2.5%');
    expect(r?.info).toContain('“Every set was RIR 3.”');
    expect(r?.actions).toEqual([{ label: 'Undo', tap: 'undo' }]);
    expect(r?.trailing).toBeNull();
  });

  it('reps: `Lat pulldown  3×10 → 3×12`; per hand: `Incline DB press  24 → 26 kg ea`', () => {
    const rows = view([
      ruleRow(PULLDOWN, 'Lat pulldown', side(kg(59, 'stack'), 12, 3), { decision: 'increase_reps' }),
      ruleRow(INCLINE, 'Incline DB press', side(kg(26, 'per_hand'), 10, 3)),
    ])?.rows;
    expect(rows?.map((r) => `${r.exerciseName}  ${r.line.text}`)).toEqual(['Lat pulldown  3×10 → 3×12', 'Incline DB press  24 → 26 kg ea']);
    expect(rows?.[1]?.line.spoken).toBe('24 to 26 kilograms each');
    // The rule row: no buttons, Why? says it is the rule's and why.
    expect(rows?.[0]).toMatchObject({ actions: [], trailing: null, info: ['Rule', 'Hit the top of the range'] });
  });

  it('load and reps together, and a set change', () => {
    const both = view([], [coach(BENCH, 'Bench press', 'saved', { target: { load: kg(102.5), reps: { min: 6, max: 6 } } })])?.rows[0];
    expect(both?.line.text).toBe('100×5 → 102.5×6 kg');
    const sets = view([], [coach(BENCH, 'Bench press', 'proposed', { target: { load: kg(100), reps: { min: 5, max: 5 } }, sets: 4, pctChange: 0 })])?.rows[0];
    expect(sets?.line.text).toBe('3 → 4 sets');
    // A bigger change stays a proposal: Skip / Apply, compact.
    expect(sets?.actions.map((a) => a.label)).toEqual(['Skip', 'Apply']);
    expect(sets?.info[0]).toBe('Suggested · 0%');
  });

  it('undone: the rule’s line back, with Redo (VoiceOver: Use coach target)', () => {
    const r = view([ruleRow(BENCH, 'Bench press', side(kg(102.5), 5, 3))], [coach(BENCH, 'Bench press', 'undone', { target: { load: kg(105), reps: { min: 5, max: 5 } } })])?.rows[0];
    expect(r?.line.text).toBe('100 → 102.5 kg');
    expect(r?.actions).toEqual([{ label: 'Redo', tap: 'use_coach', accessibilityLabel: 'Use coach target' }]);
    expect(r?.info[0]).toBe('Rule');
  });

  it('nothing moves: `Same · 100×5 kg`', () => {
    const r = view([ruleRow(BENCH, 'Bench press', side(kg(100), 5, 3), { kind: 'held', decision: 'hold_after_miss' })])?.rows[0];
    expect(r?.line.text).toBe('Same · 100×5 kg');
  });

  it('no load target keeps the rule’s own words', () => {
    const r = view([ruleRow(BENCH, 'Bench press', null, { kind: 'no_load', target: 'No load target · 8–10 reps', from: null })])?.rows[0];
    expect(r?.line.text).toBe('No load target · 8–10 reps');
  });

  it('the rule’s stall reset offered: the reset as the line, Skip / Apply; its question behind Why?', () => {
    const offer = { text: 'Reset to 90 kg × 5?', load: kg(90), reps: { min: 5, max: 5 }, hold: { load: kg(100), reps: { min: 5, max: 5 } } };
    const r = view([ruleRow(BENCH, 'Bench press', side(kg(100), 5, 3), { kind: 'held', decision: 'hold_after_miss', resetOffer: offer })])?.rows[0];
    expect(r?.line.text).toBe('100 → 90 kg');
    expect(r?.actions.map((a) => a.label)).toEqual(['Skip', 'Apply']);
    expect(r?.info).toContain('Reset to 90 kg × 5?');
  });

  it('used: no buttons, `Used` where they were', () => {
    const r = view([], [coach(BENCH, 'Bench press', 'saved', { usedBySessionId: ID(99) })])?.rows[0];
    expect(r).toMatchObject({ actions: [], trailing: 'Used' });
    expect(r?.info).not.toContain('Used');
  });

  it('the same rows and taps as before: only the presentation changed', () => {
    const v = view([ruleRow(PULLDOWN, 'Lat pulldown', side(kg(59, 'stack'), 12, 3))], [coach(BENCH, 'Bench press', 'saved'), coach(INCLINE, 'Incline DB press', 'saved', { target: { load: kg(26, 'per_hand'), reps: { min: 10, max: 10 } } })]);
    expect(v?.rows.map((r) => r.exerciseName)).toEqual(['Lat pulldown', 'Bench press', 'Incline DB press']);
    expect(v?.undoAll?.rows).toHaveLength(2);
    expect(v?.rows[2]?.line.text).toBe('24 → 26 kg ea');
  });
});
