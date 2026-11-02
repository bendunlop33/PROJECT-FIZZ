import { afterEach, describe, expect, it } from 'vitest';

import { expectTable } from '../../src/plan-builder/plan-builder-view';
import { PlanSummaryScreen } from '../../src/screens/progress/PlanSummaryScreen';
import { createHarness, type Harness } from '../harness';
import { bensPlanNoCurls } from '../muscles-seed';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 2 Nov; docs/design/plan-summary.md) The plan summary rendered over real SQLite (ADR 0037): Ben's 6-day PPL
 * (Muscle, Set days) applied on a Sunday: title, the lead-in line with the end date, the strip, the facts, the six days
 * with their main lift and count, Next, the ten Muscles bars (the same service and numbers as Plan › Muscles)
 * and `Muscles ›`; no lift history, so no Main lifts. A day opens the plan day; Edit plan opens Plan setup's Gym goals.
 */

let h: Harness | null = null;
afterEach(async () => {
  await h?.cleanup();
  h = null;
});

describe('Plan summary', () => {
  it('lays out the plan in use; a day, Muscles and Edit plan go where they should', async () => {
    h = createHarness('2026-11-01T10:00:00.000Z');
    const ben = await bensPlanNoCurls(h);
    const r = await renderScreen(h, ben.launched, PlanSummaryScreen, { name: 'ProgressPlan' }, (t) => t.includes('SETS PER WEEK') || t.includes('Sets per week'));
    const text = r.text();
    expect(text).toContain('Muscle · ');
    expect(text).toMatch(/Starts Mon 2\u00A0Nov · ends Sun \d+\u00A0Dec/);
    for (const w of ['days / week', 'min', 'effort', 'Set days', 'Push A', 'Pull A', 'Legs A', 'Next', 'Muscles ›', 'Edit plan', 'Biceps']) expect(text).toContain(w);
    expect(text).toMatch(/exercises/);
    expect(text).not.toContain('Main lifts');
    expect(r.all((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('plan-week-'))).toHaveLength(Number(/· (\d+) weeks/.exec(text)?.[1] ?? '0'));
    // The same bars as Plan › Muscles (one service): ten groups.
    expect(r.all((n) => n.props.testID === 'muscle-bar')).toHaveLength(10);
    // Each group's number is Plan › Muscles' own for this week (the lead-in: neutral there and here).
    const muscles = await ben.s.planMuscles.muscles(null);
    const bars = muscles?.view.bars ?? [];
    expect(bars).toHaveLength(10);
    for (const b of bars) expect(text).toContain(`${b.label}|${b.valueText}`);
    expect(r.nav.some((c) => c.method === 'setOptions')).toBe(true);

    const pushA = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Push A,'))[0];
    if (pushA === undefined) throw new Error('no Push A row');
    (pushA.props.onPress as () => void)();
    expect(JSON.stringify(r.nav)).toContain('ProgressPlanDay');
    expect(JSON.stringify(r.nav)).toContain(ben.days.get('Push A') ?? 'none');

    await r.press('Muscles ›');
    expect(JSON.stringify(r.nav)).toContain('ProgressPlanMuscles');

    await r.press('Edit plan');
    const editCall = r.nav.find((c) => c.method === 'dispatch' && JSON.stringify(c.args).includes('PlanSetup'));
    expect(JSON.stringify(editCall?.args)).toContain('"start":"goals"');
    expectHealthy(r);
    await r.unmount();
  });

  it('Main lifts: the Gym goals table’s own now → week N numbers, est.', async () => {
    h = createHarness('2026-11-02T10:00:00.000Z');
    const launched = await h.launch();
    const s = launched.services;
    await s.setup.saveUnits('kg');
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
    await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
    await s.setup.complete();
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    const lifts = { 'barbell-bench-press': { kind: 'entered' as const, value: 80, unit: 'kg' as const, reps: 6 }, 'barbell-back-squat': { kind: 'entered' as const, value: 100, unit: 'kg' as const, reps: 6 } };
    const built = await s.planBuilder.save(session, { ...session.answers, focus: 'balanced' as const, weeks: 6 as const, effort: 'standard' as const, lifts }, null, h.ids());
    if (!built.ok) throw new Error('not built');
    const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
    if (!applied.ok) throw new Error('not applied');
    // What Gym goals shows for this plan (Edit plan opens it with the plan's answers).
    const edit = await s.planBuilder.open({ editPlanId: built.planId });
    if (edit === null) throw new Error('no edit session');
    const kit = (k: string) => {
      const x = edit.kitOf(k);
      return x === null || x === 'bodyweight' ? null : x.unit;
    };
    const table = expectTable(edit.expect(edit.answers), edit.answers.weeks, edit.nameOf, kit, edit.unit);
    expect(table.rows.length).toBeGreaterThan(0);

    const r = await renderScreen(h, launched, PlanSummaryScreen, { name: 'ProgressPlan' }, (t) => t.includes('MAIN LIFTS') || t.includes('Main lifts'));
    const text = r.text();
    expect(text).toContain('Now → week 6');
    expect(text).toContain('Balanced · 6 weeks');
    for (const row of table.rows) {
      const [name, now, end] = row.cells;
      expect(text).toContain(`${name}|${now}| → |${end} kg × ${String(edit.expect(edit.answers).reps)}| est.`);
    }
    expect(text).toContain('Bench press');
    expectHealthy(r);
    await r.unmount();
  });
});
