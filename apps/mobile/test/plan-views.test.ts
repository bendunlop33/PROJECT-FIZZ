import { describe, expect, it } from 'vitest';

import { consistency, toMs } from '@fizz/domain';

import { planCardView, planDayView, PLAN_COPY } from '../src/coach/plan-view';
import { consistencyCardView } from '../src/progress/consistency-view';
import type { PlanCardData } from '../src/services/plan-services';

/**
 * The plan card and the consistency card as the screens draw them (Ben,
 * 19 Oct): values and actions only (minimal copy), a word or mark with
 * every number (never colour alone), never "missed".
 */

const card = (over: Partial<PlanCardData> = {}): PlanCardData => ({
  planId: 'p',
  versionN: 1,
  planVersion: 1,
  name: '4-day plan',
  days: [
    { index: 0, name: 'Push', line: '3 exercises · 9 sets · 60 min', leftOut: 0 },
    { index: 1, name: 'Legs', line: '1 exercise · 3 sets · 60 min', leftOut: 1 },
  ],
  rationale: 'Push first.',
  gymName: 'Main Gym',
  state: { kind: 'open' },
  replaces: ['Push A', 'Pull A'],
  ...over,
});

describe('planCardView', () => {
  it('open: Apply, the days with their counts, what Replace takes out', () => {
    const v = planCardView(card());
    expect(v).toMatchObject({ title: '4-day plan', subtitle: '2 days · Main Gym', action: { kind: 'apply' }, replaces: 'Push A, Pull A', rationale: 'Push first.' });
    expect(v.days.map((d) => [d.name, d.line, d.leftOut])).toEqual([
      ['Push', '3 exercises · 9 sets · 60 min', null],
      ['Legs', '1 exercise · 3 sets · 60 min', '1 left out'],
    ]);
    expect(v.days[1]?.accessibilityLabel).toBe('Legs, 1 exercise · 3 sets · 60 min, 1 left out. Show the day.');
  });

  it('applied: Undo; a newer version or an expired plan: no button, its state in a word', () => {
    expect(planCardView(card({ state: { kind: 'applied', mode: 'replace', atUtc: '2026-10-19T08:00:00.000Z' } })).action).toEqual({ kind: 'undo', text: 'Applied' });
    expect(planCardView(card({ state: { kind: 'replaced', byN: 2 } })).action).toEqual({ kind: 'ended', text: 'Replaced by version 2' });
    expect(planCardView(card({ state: { kind: 'expired' } })).action).toEqual({ kind: 'ended', text: 'Expired' });
    // A newer plan applied since (review S3): ended, no Undo.
    expect(planCardView(card({ state: { kind: 'superseded' } })).action).toEqual({ kind: 'ended', text: 'Replaced by a newer plan' });
    // Review planview S4: an ended plan offers `Use again` unless another plan is in use.
    expect(planCardView(card({ state: { kind: 'ended', canResume: true } })).action).toEqual({ kind: 'resume', text: 'Ended' });
    expect(planCardView(card({ state: { kind: 'ended', canResume: false } })).action).toEqual({ kind: 'ended', text: 'Ended' });
    expect(planCardView(card({ replaces: [] })).replaces).toBeNull();
  });

  it('the copy is values and actions only', () => {
    expect(Object.values(PLAN_COPY).join(' ')).not.toMatch(/nothing changes|built-in rule|snapped|don’t worry|guardrail/i);
  });
});

describe('planDayView', () => {
  it('rows with est. and held marks, and Edit only after Apply', () => {
    const v = planDayView({
      planId: 'p',
      versionN: 1,
      index: 0,
      name: 'Push',
      minutes: 60,
      rows: [
        { exerciseId: 'a', name: 'Bench press', scheme: '3 × 6–8', load: '100 kg', estimate: false, held: false, main: true, superset: null },
        { exerciseId: 'b', name: 'Cable fly', scheme: '3 × 12–15', load: '25 kg stack', estimate: true, held: false, main: false, superset: null },
        { exerciseId: 'c', name: 'Overhead press', scheme: '3 × 6–8', load: '50 kg', estimate: false, held: true, main: false, superset: null },
        { exerciseId: 'd', name: 'Dip', scheme: '3 × 8–10', load: '—', estimate: false, held: false, main: false, superset: null },
      ],
      checks: [],
      routineId: null,
    });
    expect(v.title).toBe('Push · 60 min');
    expect(v.rows.map((r) => r.marks)).toEqual([[], ['est.'], ['held'], []]);
    expect(v.rows[3]?.accessibilityLabel).toBe('Dip, 3 × 8–10, no load yet');
    expect(v.routineId).toBeNull();
  });
});

describe('consistencyCardView', () => {
  const nowMs = toMs('2026-10-08T06:00:00.000Z');
  it('with an aim: this week, 8 weeks with a mark at the aim, weeks at the aim, the plan’s days; never “missed”', () => {
    const c = consistency({ workouts: [{ sessionId: 'a', routineId: 'r1', startedAtUtc: '2026-10-06T06:00:00.000Z' }, { sessionId: 'b', routineId: null, startedAtUtc: '2026-09-30T06:00:00.000Z' }], nowMs, tz: 'Europe/London', aim: 1, plan: { days: [{ routineId: 'r1' }, { routineId: 'r2' }], appliedAtUtc: '2026-09-01T00:00:00.000Z' } });
    const v = consistencyCardView(c, '2026-10-08');
    expect(v.thisWeek).toBe('This week 1/1');
    expect(v.weeks).toHaveLength(8);
    expect(v.weeks.at(-1)).toMatchObject({ value: '1/1', atAim: true, accessibilityLabel: 'Week of 28 September: 1 of 1 days, at your aim' });
    expect(v.atAim).toBe('Weeks at your aim: 1 of 8');
    expect(v.plan).toBe('Plan this week 1 of 2');
    expect(JSON.stringify(v)).not.toMatch(/miss/i);
  });

  it('two workouts on one day are one day against the aim, and the label says days (review S2)', () => {
    const two = [
      { sessionId: 'a', routineId: null, startedAtUtc: '2026-09-30T06:00:00.000Z' },
      { sessionId: 'b', routineId: null, startedAtUtc: '2026-09-30T17:00:00.000Z' },
    ];
    const v = consistencyCardView(consistency({ workouts: two, nowMs, tz: 'Europe/London', aim: 2, plan: null }), '2026-10-08');
    expect(v.weeks.at(-1)).toMatchObject({ value: '1/2', atAim: false, accessibilityLabel: 'Week of 28 September: 1 of 2 days' });
    expect(v.atAim).toBe('Weeks at your aim: 0 of 8');
    // With no aim: workouts, labelled as workouts.
    const none = consistencyCardView(consistency({ workouts: two, nowMs, tz: 'Europe/London', aim: null, plan: null }), '2026-10-08');
    expect(none.weeks.at(-1)).toMatchObject({ value: '2', accessibilityLabel: 'Week of 28 September: 2 workouts' });
  });

  it('no aim: counts only', () => {
    const v = consistencyCardView(consistency({ workouts: [], nowMs, tz: 'Europe/London', aim: null, plan: null }), '2026-10-08');
    expect(v.thisWeek).toBe('This week 0');
    expect(v.atAim).toBeNull();
    expect(v.plan).toBeNull();
    expect(v.weeks[0]?.accessibilityLabel).toBe('Week of 10 August: 0 workouts');
  });
});
