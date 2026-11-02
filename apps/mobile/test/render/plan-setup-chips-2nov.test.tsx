import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlanSetupScreen } from '../../src/screens/plan/PlanSetupScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { benWithHistory, harness } from './seed';

/**
 * (Ben, 2 Nov, screenshot of Plan setup › Gym goals: "This page formatting is broken. I don't think we need ticks
 * either.") Rendered over real SQLite: no chip shows a tick, selection is VoiceOver's `selected`, every answer chip's
 * label is one line (`numberOfLines={1}`), the ✦ is its own small inline glyph (not in the label, never stacked),
 * the four-chip groups are a 2 × 2 grid at phone width, and the table's value headers stay on one line.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});


describe('Plan setup chips (2 Nov)', () => {
  it('Gym goals and Check your lifts: no ticks, one-line labels, inline ✦, 2 × 2 grids, one-line table headers', async () => {
    const ben = await benWithHistory(h);
    const r = await renderScreen(h, ben.launched, PlanSetupScreen, { name: 'PlanSetup' }, (t) => t.includes('Gym goals') || t.includes('Check your lifts'));
    await r.layout();

    {
      // Ben has history: setup opens on Check your lifts first.
      expect(r.text()).toContain('Check your lifts');
      // `1RM est. (kg)`: the value header is one line.
      const head = r.all((n) => n.props.numberOfLines === 1 && typeof n.props.children === 'string' && /^1RM est\./.test(n.props.children));
      expect(head.length).toBeGreaterThan(0);
      await r.press('Next');
      await r.waitFor((t) => t.includes('Gym goals'), 'Gym goals');
      await r.layout();
    }

    // No ticks anywhere on the page.
    expect(r.all((n) => n.props.name === 'checkmark')).toHaveLength(0);
    expect(r.text()).not.toContain('✓');

    // The answer chips: buttons with a selected state.
    const chips = r.all((n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityState === 'object' && n.props.accessibilityState !== null && 'selected' in n.props.accessibilityState && typeof n.props.onPress === 'function');
    const labelled = (re: RegExp) => chips.filter((c) => re.test(String(c.props.accessibilityLabel)));
    for (const name of [/^4 weeks$/, /^6 weeks, suggested$/, /^Standard, suggested$/, /^Strength$/, /^Balanced, suggested$/, /^No$/]) expect(labelled(name), String(name)).toHaveLength(1);
    // Selection is exposed to VoiceOver.
    expect(labelled(/^6 weeks/)[0]?.props.accessibilityState).toMatchObject({ selected: true });
    expect(labelled(/^4 weeks$/)[0]?.props.accessibilityState).toMatchObject({ selected: false });

    for (const re of [/^4 weeks$/, /^6 weeks/, /^Strength$/, /^Balanced/, /^Standard/]) {
      const c = labelled(re)[0];
      if (c === undefined) throw new Error(String(re));
      // The label is one Text, one line; the ✦ is a separate glyph before it.
      const label = c.queryAll((x) => x.props.numberOfLines === 1 && typeof x.props.children === 'string' && x.props.children !== '✦');
      expect(label.map((x) => x.props.children as string), String(re)).toEqual([String(c.props.accessibilityLabel).replace(', suggested', '')]);
      expect(label[0]?.props.adjustsFontSizeToFit).toBe(true);
      const mark = c.queryAll((x) => x.props.children === '✦');
      expect(mark.length > 0, String(re)).toBe(/suggested/.test(String(c.props.accessibilityLabel)));
    }

    // At phone width (393 pt) the four-chip groups are 2 × 2: 4 weeks and 6 weeks share a row, 8 weeks starts the next.
    const rowOf = (re: RegExp) => {
      const c = labelled(re)[0];
      let p = c?.parent ?? null;
      while (p !== null && (p.props.style as { flexDirection?: string } | undefined)?.flexDirection !== 'row') p = p.parent;
      return p;
    };
    expect(rowOf(/^4 weeks$/)).toBe(rowOf(/^6 weeks/));
    expect(rowOf(/^8 weeks$/)).not.toBe(rowOf(/^4 weeks$/));
    expect(rowOf(/^Strength$/)).toBe(rowOf(/^Muscle$/));
    expect(rowOf(/^Balanced/)).not.toBe(rowOf(/^Strength$/));
    // Effort keeps three across.
    expect(rowOf(/^Maintain$/)).toBe(rowOf(/^Push$/));

    // What to expect: `Week 6 (est.)` is one line.
    {
      expect(r.text()).toContain('What to expect');
      const head = r.all((n) => n.props.numberOfLines === 1 && typeof n.props.children === 'string' && /^Week \d+ \(est\.\)$/.test(n.props.children));
      expect(head.length).toBeGreaterThan(0);
    }
    expectHealthy(r);
    await r.unmount();
  });
});
