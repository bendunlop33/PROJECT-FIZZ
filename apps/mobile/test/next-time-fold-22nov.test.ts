import { describe, expect, it } from 'vitest';

import type { ChangeSide, NextTimeRow } from '@fizz/domain';
import type { Load, NextSessionTargetRecord } from '@fizz/schemas';

import type { CoachAvailability } from '../src/coach/coach-service';
import { arrowParts, foldNextTime, nextTimeView, unchangedText } from '../src/coach/next-time-view';

/**
 * (Ben, 22 Nov; Summary v2) Next time shows only what changes, the new value bold, each row its own Undo; unchanged
 * rows fold into `+N unchanged`. A built-in rule change gets its own Undo (a hold of today's target) only where the
 * caller can write it. Pure.
 */

const AT = '2026-11-21T18:13:00.000Z';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const avail: CoachAvailability = { status: 'ok', model: 'gpt-6.1-sol' };
const side = (load: Load | null, reps: number, sets: number): ChangeSide => ({ target: { load, reps: { min: reps, max: reps } }, sets });

const CRUNCH = ID(2001);
const RAISE = ID(2002);
const FLY = ID(2003);
const SQUAT = ID(2004);
const from: Record<string, ChangeSide> = {
  [CRUNCH]: side(kg(80, 'stack'), 12, 3),
  [RAISE]: side(kg(10, 'per_hand'), 13, 3),
  [FLY]: side(kg(7, 'per_hand'), 17, 3),
  [SQUAT]: side(kg(100), 5, 1),
};

const rule = (exerciseId: string, name: string, to: ChangeSide | null, over: Partial<NextTimeRow> = {}): NextTimeRow => ({
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

const hold = (exerciseId: string, name: string, status: NextSessionTargetRecord['status'], over: Partial<NextSessionTargetRecord> = {}): NextSessionTargetRecord => ({
  id: ID(700 + Number(exerciseId.slice(-4))),
  ownerId: ID(1),
  version: 1,
  createdAtUtc: AT,
  updatedAtUtc: AT,
  sourceSessionId: ID(9),
  sourceVersion: 3,
  exerciseId,
  exerciseName: name,
  actionId: ID(78),
  target: from[exerciseId]?.target ?? { load: null, reps: null },
  sets: null,
  builtIn: { load: kg(85, 'stack'), reps: { min: 12, max: 12 } },
  builtInSets: 3,
  size: 'small',
  status,
  reason: null,
  guardNotes: [],
  pctChange: null,
  usedBySessionId: null,
  origin: 'hold',
  ...over,
});

const rows = [
  rule(CRUNCH, 'Cable crunch', side(kg(85, 'stack'), 12, 3)),
  rule(RAISE, 'Lateral raise', side(kg(10, 'per_hand'), 14, 3), { decision: 'increase_reps' }),
  rule(FLY, 'Rear-delt fly', side(kg(7, 'per_hand'), 17, 3), { kind: 'held', decision: 'hold' }),
];
const view = (holdRows?: NextSessionTargetRecord[], stale: ReadonlySet<string> = new Set()) =>
  nextTimeView({ title: 'Pull B', builtIn: { sourceTag: 'Rule', rows, emptyText: null }, coachRows: [], ruleRows: [], ...(holdRows === undefined ? {} : { holdRows }), stale, availability: avail, reviewing: false, from });

describe('Next time v2 (Ben, 22 Nov)', () => {
  it('each rule change has its own Undo (only where holds can be written); unchanged rows fold into `+N unchanged`', () => {
    const v = view([]);
    const fold = foldNextTime(v?.rows ?? []);
    expect(fold.changed.map((r) => [r.exerciseName, r.line.text, r.actions.map((a) => a.label)])).toEqual([
      ['Cable crunch', '80 → 85 kg', ['Undo']],
      ['Lateral raise', '3×13 → 3×14', ['Undo']],
    ]);
    expect(fold.unchanged.map((r) => r.exerciseName)).toEqual(['Rear-delt fly']);
    expect(unchangedText(fold.unchanged.length)).toBe('+1 unchanged');
    expect(unchangedText(0)).toBeNull();
    // Undo holds today's target, against the rule's; Why? keeps the rule's reason (behind a tap).
    const crunch = fold.changed[0];
    expect(crunch?.hold).toMatchObject({ exerciseId: CRUNCH, hold: { load: kg(80, 'stack') }, rule: { load: kg(85, 'stack') }, sets: 3, row: null });
    expect(crunch?.info).toEqual(['Rule', 'Hit the top of the range']);
    expect(crunch?.actions[0]?.accessibilityLabel).toBe('Undo: keep Cable crunch as it was');
    // No hold rows given (e.g. Progress' Next week card): no Undo offered on a rule row.
    expect(view()?.rows.every((r) => r.hold === undefined && r.actions.length === 0)).toBe(true);
  });

  it('held: today’s target with Redo (the rule’s change behind Why?); Redo’d: Undo again; used: no buttons', () => {
    const held = view([hold(CRUNCH, 'Cable crunch', 'applied')])?.rows[0];
    expect(held?.line.text).toBe('Same · 80×12 kg');
    expect(held?.actions.map((a) => [a.label, a.tap])).toEqual([['Redo', 'use_coach']]);
    expect(held?.info).toContain('Rule: 80 → 85 kg');
    // It has a button, so it stays in view (never folded away).
    expect(foldNextTime(held === undefined ? [] : [held]).changed).toHaveLength(1);
    const redone = view([hold(CRUNCH, 'Cable crunch', 'proposed', { version: 2 })])?.rows[0];
    expect(redone?.line.text).toBe('80 → 85 kg');
    expect(redone?.actions.map((a) => [a.label, a.tap])).toEqual([['Undo', 'undo']]);
    expect(redone?.hold?.row?.version).toBe(2);
    const used = view([hold(CRUNCH, 'Cable crunch', 'applied', { usedBySessionId: ID(99) })])?.rows[0];
    expect(used?.actions).toEqual([]);
    expect(used?.trailing).toBe('Used');
  });

  it('a hold the workout no longer fits (stale): the rule’s line with Undo again, at that row’s version', () => {
    const h = hold(CRUNCH, 'Cable crunch', 'applied');
    const r = view([h], new Set([h.id]))?.rows[0];
    expect(r?.line.text).toBe('80 → 85 kg');
    expect(r?.hold).toMatchObject({ again: true, row: { id: h.id, version: 1 } });
  });

  it('no Undo on a stall reset offer or a top set + back-offs lift (their own taps / not holdable)', () => {
    const offer = rule(CRUNCH, 'Cable crunch', side(kg(70, 'stack'), 12, 3), { decision: 'reduce_load', resetOffer: { text: 'Reset to 70 kg × 12?', load: kg(70, 'stack'), reps: { min: 12, max: 12 }, hold: { load: kg(80, 'stack'), reps: { min: 12, max: 12 } } } });
    const top = rule(SQUAT, 'Back squat', side(kg(102.5), 5, 1), { topBackoff: { from: kg(85), to: kg(87.5) } });
    const v = nextTimeView({ title: 'Legs', builtIn: { sourceTag: 'Rule', rows: [offer, top], emptyText: null }, coachRows: [], ruleRows: [], holdRows: [], availability: avail, reviewing: false, from });
    expect(v?.rows.map((r) => [r.exerciseName, r.hold === undefined, r.actions.map((a) => a.label)])).toEqual([
      ['Cable crunch', true, ['Skip', 'Apply']],
      ['Back squat', true, []],
    ]);
  });

  it('the new value bold: `80 → ` and `85 kg`; no arrow: none', () => {
    expect(arrowParts('80 → 85 kg')).toEqual({ before: '80 → ', after: '85 kg' });
    expect(arrowParts('3×10–13 → 3×14')).toEqual({ before: '3×10–13 → ', after: '3×14' });
    expect(arrowParts('Same · 80×12 kg')).toBeNull();
  });
});
