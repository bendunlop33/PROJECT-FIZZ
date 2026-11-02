import { describe, expect, it } from 'vitest';

import type { PbBlockDay, PbBlockStripCell, PlanMuscleBar } from '@fizz/domain';

import { planSummaryView, type PlanSummaryExpect, type PlanSummaryOverview } from '../src/progress/plan-summary-view';
import { createPlanSummaryService } from '../src/services/plan-summary-service';

/**
 * (Ben, 2 Nov; docs/design/plan-summary.md) The plan summary's view: title and week line, the strip (done, now, deload
 * ↓, a lighter week too), facts, days with main lift and count (done dot, Next), main lifts now → end est. (kg, lb,
 * per hand), sets per week with below-range flagged, Edit's route; a coach-built plan shows only what it has.
 */

const cell = (week: number, state: PbBlockStripCell['state'], deload = false): PbBlockStripCell => ({ week, state, deload, selected: false, accessibilityLabel: '' });
const row = (name: string, main = false) => ({ key: name, exerciseId: name, name, main, line: '3 × 8', kg: null, est: false, superset: null });
const day = (index: number, name: string, rows: ReturnType<typeof row>[], weekday: number | null = null): PbBlockDay => ({ index, name, weekday, done: false, doneOn: null, rows });

const strip = [cell(1, 'done'), cell(2, 'done'), cell(3, 'current'), cell(4, 'todo'), cell(5, 'todo'), cell(6, 'todo', true)];
const days = [
  day(0, 'Push A', [row('Bench press', true), row('Incline DB press'), row('Cable fly'), row('Lateral raise'), row('Pushdown')]),
  day(1, 'Pull A', [row('Barbell row', true), row('Lat pulldown'), row('Face pull'), row('Curl'), row('Hammer curl')]),
  day(2, 'Legs A', [row('Back squat', true), row('RDL'), row('Leg press'), row('Leg curl'), row('Calf raise')]),
  day(3, 'Upper B', [row('Overhead press', true), row('Pull-up'), row('DB bench'), row('Cable row'), row('Lateral raise'), row('Curl')]),
];

function overview(over: Partial<PlanSummaryOverview> = {}, block: Partial<NonNullable<PlanSummaryOverview['block']>> = {}): PlanSummaryOverview {
  return {
    planId: 'plan-1',
    name: 'Balanced plan',
    since: 'Since 2 Nov',
    paused: null,
    days: [
      { routineId: 'r0', name: 'Push A', state: 'done', next: false, dayIndex: 0 },
      { routineId: 'r1', name: 'Pull A', state: 'done', next: false, dayIndex: 1 },
      { routineId: 'r2', name: 'Legs A', state: 'next', next: true, dayIndex: 2 },
      { routineId: 'r3', name: 'Upper B', state: 'todo', next: false, dayIndex: 3 },
    ],
    block: {
      views: [{ strip, days }, { strip, days }, { strip, days }],
      current: 3,
      done: false,
      editable: true,
      answers: { focus: 'balanced', weeks: 6, effort: 'standard', sessions: 4, minutes: 60, schedule: 'any' },
      startsOn: null,
      endsOn: '2026-12-06',
      ...block,
    },
    ...over,
  };
}

const bar = (group: string, direct: number, status: PlanMuscleBar['status']): PlanMuscleBar =>
  ({ group, label: group, direct, valueText: String(direct), assistedText: null, range: { min: 6, max: 10, why: 'goal' }, status, done: null, look: { fill: 0.4, band: { from: 0.3, to: 0.5 }, marker: null, tone: status === 'in' ? 'in' : 'out' }, why: '', words: `${group}, ${String(direct)} sets a week` }) as unknown as PlanMuscleBar;

const expectKg: PlanSummaryExpect = {
  reps: 6,
  unit: 'kg',
  rows: [
    { key: 'bench', name: 'Bench press', now: 80, end: 85, perHand: false, unit: 'kg' },
    { key: 'squat', name: 'Back squat', now: 100, end: 107.5, perHand: false, unit: null },
    { key: 'db', name: 'DB press', now: 22.5, end: 25, perHand: true, unit: 'kg' },
    { key: 'ohp', name: 'Overhead press', now: 115, end: 120, perHand: false, unit: 'lb' },
    { key: 'none', name: 'Deadlift', now: null, end: null, perHand: false, unit: 'kg' },
  ],
};

describe('plan summary view', () => {
  it('title, week line with the end date, strip with the deload ↓, three facts', () => {
    const v = planSummaryView({ overview: overview(), muscles: null, expect: null });
    expect(v.title).toBe('Balanced · 6 weeks');
    expect(v.line).toBe('Week 3 of 6 · ends Sun 6\u00A0Dec');
    expect(v.weeks?.map((w) => [w.label, w.state, w.deload])).toEqual([
      ['1', 'done', false],
      ['2', 'done', false],
      ['3', 'current', false],
      ['4', 'todo', false],
      ['5', 'todo', false],
      ['6 ↓', 'todo', true],
    ]);
    expect(v.weeksLabel).toContain('Week 3 now');
    expect(v.weeksLabel).toContain('Week 6 deload');
    expect(v.facts).toEqual([
      { key: 'days', value: '4', label: 'days / week' },
      { key: 'min', value: '~60', label: 'min' },
      { key: 'effort', value: 'Standard', label: 'effort' },
    ]);
  });

  it('a lighter (or skipped) deload week reads from the block strip as the plan has it', () => {
    const lighter = [cell(1, 'done'), cell(2, 'current'), cell(3, 'todo', true), cell(4, 'todo'), cell(5, 'todo'), cell(6, 'todo')];
    const v = planSummaryView({ overview: overview({}, { views: [{ strip: lighter, days }], current: 2 }), muscles: null, expect: null });
    expect(v.weeks?.filter((w) => w.deload).map((w) => w.week)).toEqual([3]);
  });

  it('days: main lift · exercise count, done this week, Next on Up next; Any days on the section', () => {
    const v = planSummaryView({ overview: overview(), muscles: null, expect: null });
    expect(v.days.meta).toBe('Any days');
    expect(v.days.rows.map((d) => [d.name, d.meta, d.done, d.next, d.weekday])).toEqual([
      ['Push A', 'Bench press · 5 exercises', true, false, null],
      ['Pull A', 'Barbell row · 5 exercises', true, false, null],
      ['Legs A', 'Back squat · 5 exercises', false, true, null],
      ['Upper B', 'Overhead press · 6 exercises', false, false, null],
    ]);
    expect(v.days.rows[0]?.accessibilityLabel).toBe('Push A, Bench press · 5 exercises, done this week');
  });

  it('Set days: the section says so and each day shows its weekday', () => {
    const set = days.map((d, i) => ({ ...d, weekday: [0, 1, 3, 4][i] ?? null }));
    const v = planSummaryView({ overview: overview({}, { views: [{ strip, days: set }, { strip, days: set }, { strip, days: set }], answers: { focus: 'strength', weeks: 6, effort: 'push', sessions: 4, minutes: 45, schedule: 'set' } }), muscles: null, expect: null });
    expect(v.days.meta).toBe('Set days');
    expect(v.days.rows.map((d) => d.weekday)).toEqual(['Mon', 'Tue', 'Thu', 'Fri']);
    expect(v.title).toBe('Strength · 6 weeks');
    expect(v.facts?.[2]?.value).toBe('Push');
  });

  it('main lifts: now → end est. at the focus reps; kg, lb and per-hand say their unit; none-at-all rows dropped', () => {
    const v = planSummaryView({ overview: overview(), muscles: null, expect: expectKg });
    expect(v.lifts?.meta).toBe('Now → week 6');
    expect(v.lifts?.rows.map((r) => [r.name, r.now, r.end])).toEqual([
      ['Bench press', '80', '85 kg × 6'],
      ['Back squat', '100', '107.5 kg × 6'],
      ['DB press', '22.5', '25 kg each × 6'],
      ['Overhead press', '115', '120 lb × 6'],
    ]);
    expect(v.lifts?.rows[0]?.accessibilityLabel).toContain('est.');
  });

  it('main lifts omitted when there are none', () => {
    expect(planSummaryView({ overview: overview(), muscles: null, expect: { reps: 6, unit: 'kg', rows: [] } }).lifts).toBeNull();
    expect(planSummaryView({ overview: overview(), muscles: null, expect: null }).lifts).toBeNull();
  });

  it('sets per week: the Muscles bars as given, below range flagged (amber), above not', () => {
    const v = planSummaryView({ overview: overview(), muscles: [bar('Chest', 9, 'in'), bar('Biceps', 2, 'below'), bar('Quads', 14, 'above')], expect: null });
    expect(v.muscles?.map((m) => [m.bar.group, m.low])).toEqual([
      ['Chest', false],
      ['Biceps', true],
      ['Quads', false],
    ]);
    expect(planSummaryView({ overview: overview(), muscles: [], expect: null }).muscles).toBeNull();
  });

  it('paused: the pause in the line and no end date, no Next', () => {
    const v = planSummaryView({ overview: overview({ paused: { text: 'Paused · until 9 Nov' } }), muscles: null, expect: null });
    expect(v.line).toBe('Week 3 of 6 · Paused · until 9 Nov');
    expect(v.days.rows.some((d) => d.next)).toBe(false);
  });

  it('lead-in, done block and Edit routes', () => {
    const lead = planSummaryView({ overview: overview({}, { current: 1, startsOn: '2026-11-09', endsOn: '2026-12-20' }), muscles: null, expect: null });
    expect(lead.line).toBe('Starts Mon 9\u00A0Nov · ends Sun 20\u00A0Dec');
    expect(lead.edit).toEqual({ kind: 'edit', label: 'Edit plan' });
    const done = planSummaryView({ overview: overview({}, { done: true, editable: false, current: 6 }), muscles: null, expect: null });
    expect(done.line).toBe('Block done');
    expect(done.edit).toEqual({ kind: 'next', label: 'Start next block' });
  });

  it('a coach-built plan: its name and since line, days without meta; no strip, facts, lifts or day labels', () => {
    const v = planSummaryView({ overview: overview({ name: 'Coach PPL', block: null }), muscles: [bar('Chest', 9, 'in')], expect: expectKg });
    expect(v.title).toBe('Coach PPL');
    expect(v.line).toBe('Since 2 Nov');
    expect(v.weeks).toBeNull();
    expect(v.facts).toBeNull();
    expect(v.lifts).toBeNull();
    expect(v.days.meta).toBeNull();
    expect(v.days.rows.map((d) => [d.name, d.meta, d.done, d.next])).toEqual([
      ['Push A', null, true, false],
      ['Pull A', null, true, false],
      ['Legs A', null, false, true],
      ['Upper B', null, false, false],
    ]);
    expect(v.muscles).toHaveLength(1);
    expect(v.edit.kind).toBe('plan');
  });
});

describe('plan summary service', () => {
  it('reads expect only for a builder plan; a failed part hides, never fails the read', async () => {
    const asked: string[] = [];
    const s = createPlanSummaryService({
      overview: () => Promise.resolve(overview()),
      muscles: () => Promise.reject(new Error('no')),
      expect: (id) => {
        asked.push(id);
        return Promise.resolve(expectKg);
      },
    });
    const v = await s.read();
    expect(asked).toEqual(['plan-1']);
    expect(v?.muscles).toBeNull();
    expect(v?.lifts?.rows).toHaveLength(4);
    const coach = createPlanSummaryService({ overview: () => Promise.resolve(overview({ block: null })), muscles: () => Promise.resolve(null), expect: () => Promise.reject(new Error('never')) });
    expect((await coach.read())?.lifts).toBeNull();
    expect(await createPlanSummaryService({ overview: () => Promise.resolve(null), muscles: () => Promise.resolve(null), expect: () => Promise.resolve(null) }).read()).toBeNull();
  });
});
