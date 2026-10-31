import { afterEach, describe, expect, it } from 'vitest';

import { BlockScreen, BlocksScreen, LiftBlockScreen } from '../../src/screens/progress/BlockScreens';
import { ProgressScreen } from '../../src/screens/progress/ProgressScreen';
import { benWithBlocks, type BlockBen } from '../block-seed';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Block progress rendered over real SQLite (ADR 0037): Progress › Lifts'
 * `This block` list, a lift's block detail and the Blocks screen; a row tap navigates; no React warning on the way
 * (no hook after an early return).
 */

let ben: BlockBen | null = null;
afterEach(async () => {
  await ben?.h.cleanup();
  ben = null;
});

describe('block progress screens', () => {
  it('Progress › Lifts: This block · Week 3 of 6 · Blocks ›, the main lift Stalled, the legend, the charts below', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, ProgressScreen, { name: 'ProgressHome' }, (t) => t.includes('This block') && t.includes('Week 3 of 6'));
    const text = r.text();
    for (const w of ['This block', 'Week 3 of 6', 'Blocks ›', 'Stalled', 'Up / held', 'Deload']) expect(text).toContain(w);
    expect(text.indexOf('This block')).toBeLessThan(text.lastIndexOf('Bench press'));
    expectHealthy(r);
    await r.unmount();
  });

  it('a past block opens the same view; a row tap opens the lift’s block detail', async () => {
    ben = await benWithBlocks();
    const key = (await ben.s.blockProgress.blocks())?.rows[1]?.key ?? '';
    const r = await renderScreen(ben.h, ben.launched, BlockScreen, { name: 'ProgressBlock', params: { blockKey: key } }, (t) => t.includes('Block 2 · Muscle'));
    expect(r.text()).toContain('7 Sep – 4 Oct');
    expect(r.text()).toContain('60×8 → 65×8 kg');
    expect(r.text()).not.toContain('Blocks ›');
    const row = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes('60×8 to 65×8 kg'))[0];
    if (row === undefined) throw new Error('no row');
    const onPress = row.props.onPress as () => void;
    onPress();
    expect(JSON.stringify(r.nav)).toContain('ProgressLiftBlock');
    expectHealthy(r);
    await r.unmount();
  });

  it('a lift’s block detail: Stalled 2 weeks, its line, the weekly chart, Week · Top set · Sets · Est. 1RM with est.', async () => {
    ben = await benWithBlocks();
    const mainId = ben.plans[2]?.mainId ?? '';
    const r = await renderScreen(ben.h, ben.launched, LiftBlockScreen, { name: 'ProgressLiftBlock', params: { blockKey: null, exerciseId: mainId, name: 'Bench press' } }, (t) => t.includes('Stalled 2 weeks'));
    const text = r.text();
    for (const w of ['Stalled 2 weeks', 'Top set 70×6 kg, 3 weeks running.', 'W1', 'W3', 'Week', 'Top set', 'Sets', 'Est. 1RM', '70×2 kg', ' est.']) expect(text).toContain(w);
    // No fix offered for a top/back-off main lift (nothing invented).
    expect(text).not.toContain('Apply');
    expectHealthy(r);
    await r.unmount();
  });

  it('Blocks: every block with Now on the current, Earlier blocks’ sessions, and the comparison table', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, BlocksScreen, { name: 'ProgressBlocks' }, (t) => t.includes('Block 1 · Strength'));
    const text = r.text();
    for (const w of ['Block 3 · Muscle', 'Now', 'Block 2 · Muscle', '4 of 12 sessions', 'Block 1 · Strength', 'by block', 'Block', 'Start', 'End', 'Change']) expect(text).toContain(w);
    const row = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Block 2 · Muscle'))[0];
    if (row === undefined) throw new Error('no Block 2 row');
    (row.props.onPress as () => void)();
    expect(JSON.stringify(r.nav)).toContain('ProgressBlock');
    // The comparison shows best sets, or Est. 1RM labelled est. when rep ranges differ.
    expect(text).toMatch(/×\d+ kg|est\./);
    expectHealthy(r);
    await r.unmount();
  });
});
