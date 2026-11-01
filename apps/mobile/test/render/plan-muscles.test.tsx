import { afterEach, describe, expect, it } from 'vitest';

import { LibraryScreen } from '../../src/screens/library/LibraryScreen';
import { PlanMusclesScreen } from '../../src/screens/library/PlanMusclesScreen';
import { createHarness, type Harness } from '../harness';
import { bensPlanNoCurls } from '../muscles-seed';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 1 Nov; docs/design/plan-muscles.md) Plan › Muscles and Library's line rendered over real SQLite (ADR 0037):
 * Ben's PPL with no curls shows `Muscles · … Biceps … low ›` on Library › Plan; the Muscles screen has the week chips,
 * one bar per group, the gap line and Rebalance; Rebalance opens one card with each change a line and Apply.
 */

let h: Harness | null = null;
afterEach(async () => {
  await h?.cleanup();
  h = null;
});

describe('Plan › Muscles', () => {
  it('Library › Plan shows the muscles line; a tap opens Muscles', async () => {
    h = createHarness('2026-11-01T10:00:00.000Z');
    const ben = await bensPlanNoCurls(h);
    const r = await renderScreen(h, ben.launched, LibraryScreen, { name: 'LibraryHome', params: { segment: 'plan' } }, (t) => t.includes('Muscles ·'));
    expect(r.text()).toMatch(/Muscles · [^|]*Biceps[^|]* low/);
    const row = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Muscles ·'))[0];
    if (row === undefined) throw new Error('no line');
    (row.props.onPress as () => void)();
    expect(JSON.stringify(r.nav)).toContain('LibraryPlanMuscles');
    expectHealthy(r);
    await r.unmount();
  });

  it('the screen: week chips with Block avg, the ten groups, the gap line, Rebalance → one card with Apply', async () => {
    h = createHarness('2026-11-01T10:00:00.000Z');
    const ben = await bensPlanNoCurls(h);
    const r = await renderScreen(h, ben.launched, PlanMusclesScreen, { name: 'LibraryPlanMuscles' }, (t) => t.includes('Sets per week') || t.includes('SETS PER WEEK'));
    const text = r.text();
    for (const w of ['Lead-in', 'Block avg', 'Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Glutes', 'Triceps', 'Biceps', 'Calves', 'Core', 'Biceps 0/wk · below 6–10', 'Rebalance', 'Pull A', 'Pull B']) expect(text).toContain(w);
    expect(r.all((n) => n.props.testID === 'muscle-bar')).toHaveLength(10);
    expect(text).not.toContain('Planned');
    await r.press('Rebalance');
    await r.waitFor((t) => t.includes('Apply changes'), 'the Rebalance card');
    expect(r.text()).toMatch(/Pull A: \+ [^|]*curl/i);
    expect(r.text()).toContain('Biceps 0 → 2');
    expectHealthy(r);
    await r.unmount();
  });
});
