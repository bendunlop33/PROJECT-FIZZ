import { afterEach, describe, expect, it } from 'vitest';

import { BlockScreen, BlocksScreen, LiftBlockScreen } from '../../src/screens/progress/BlockScreens';
import { ProgressScreen } from '../../src/screens/progress/ProgressScreen';
import { LibraryScreen } from '../../src/screens/library/LibraryScreen';
import { benWithBlocks, type BlockBen } from '../block-seed';
import type { Harness } from '../harness';
import { benWithHistory, harness, withPlan } from './seed';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Block progress rendered over real SQLite (ADR 0037): Progress › Lifts'
 * `This block` list, a lift's block detail and the Blocks screen; a row tap navigates; no React warning on the way
 * (no hook after an early return).
 */

let ben: BlockBen | null = null;

type Rendered = Awaited<ReturnType<typeof renderScreen>>;
/** The `Block | Overall` strip's tab, selected or not. */
const tabSelected = (r: Rendered, label: string) => {
  const tab = r.all((n) => n.props.accessibilityRole === 'tab' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(`${label}, `))[0];
  if (tab === undefined) throw new Error(`no ${label} tab`);
  return (tab.props.accessibilityState as { selected?: boolean } | undefined)?.selected === true;
};
/** The shared period bar is on screen (its `‹` step). */
const periodBar = (r: Rendered) => r.all((n) => n.props.accessibilityLabel === 'Previous period').length > 0;
let solo: Harness | null = null;
afterEach(async () => {
  await ben?.h.cleanup();
  ben = null;
  await solo?.cleanup();
  solo = null;
});

describe('block progress screens', () => {
  it('Progress › Lifts with a block running opens on Block: Week 4 of 6 · All blocks ›, no period bar, no charts', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, ProgressScreen, { name: 'ProgressHome' }, (t) => t.includes('Week 4 of 6') && t.includes('Stalled'));
    const text = r.text();
    // (Ben, 2 Nov) The `Block | Overall` strip, Block selected; the block's lifts only.
    for (const w of ['Block', 'Overall', 'Week 4 of 6', 'All blocks ›', 'Stalled', 'Up / held', 'Deload']) expect(text).toContain(w);
    expect(text).not.toContain('This block');
    expect(tabSelected(r, 'Block')).toBe(true);
    expect(tabSelected(r, 'Overall')).toBe(false);
    expect(periodBar(r)).toBe(false);
    expect(text).not.toContain('Est. 1RM');
    // (Ben, 2 Nov) The current block's `Week 4 of 6 ›` opens Library › Plan (one plan screen).
    await r.press('Week 4 of 6 ›');
    const open = r.nav.find((c) => c.method === 'dispatch' && JSON.stringify(c.args).includes('"Library"'));
    expect(JSON.stringify(open?.args)).toContain('"segment":"plan"');
    expect(JSON.stringify(r.nav)).not.toContain('ProgressPlan');
    await r.press('All blocks ›');
    expect(JSON.stringify(r.nav)).toContain('ProgressBlocks');
    expectHealthy(r);
    await r.unmount();
  });

  it('Overall: the period bar and the per-lift charts, no block section; Block again brings the block back', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, ProgressScreen, { name: 'ProgressHome' }, (t) => t.includes('Week 4 of 6'));
    await r.press('Overall');
    await r.waitFor((t) => t.includes('Est. 1RM'), 'Overall charts');
    await r.layout();
    expect(tabSelected(r, 'Overall')).toBe(true);
    expect(periodBar(r)).toBe(true);
    expect(r.text()).not.toContain('Week 4 of 6');
    expect(r.text()).not.toContain('All blocks ›');
    await r.press('Block');
    await r.waitFor((t) => t.includes('Week 4 of 6'), 'Block again');
    expect(periodBar(r)).toBe(false);
    // Training keeps its period bar.
    await r.press('Training');
    await r.waitFor((t) => t.includes('October workouts'), 'Training');
    expect(periodBar(r)).toBe(true);
    expect(r.all((n) => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === 'Overall, 2 of 2').length).toBe(0);
    expect(r.errors).toEqual([]);
    await r.unmount();
  });

  it('a past block opens the same view; a row tap opens the lift’s block detail', async () => {
    ben = await benWithBlocks();
    const key = (await ben.s.blockProgress.blocks())?.rows[1]?.key ?? '';
    const r = await renderScreen(ben.h, ben.launched, BlockScreen, { name: 'ProgressBlock', params: { blockKey: key } }, (t) => t.includes('Block 2 · Muscle'));
    expect(r.text()).toContain('7 Sep – 4 Oct');
    expect(r.text()).toContain('60×8 → 65×8 kg');
    expect(r.text()).not.toContain('All blocks ›');
    const row = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes('60×8 to 65×8 kg'))[0];
    if (row === undefined) throw new Error('no row');
    const onPress = row.props.onPress as () => void;
    onPress();
    expect(JSON.stringify(r.nav)).toContain('ProgressLiftBlock');
    expectHealthy(r);
    await r.unmount();
  });

  it('a lift’s block detail: Stalled 3 weeks, its line, the weekly chart, Week · Top set · Sets · Est. 1RM with est.', async () => {
    ben = await benWithBlocks();
    const mainId = ben.plans[2]?.mainId ?? '';
    const r = await renderScreen(ben.h, ben.launched, LiftBlockScreen, { name: 'ProgressLiftBlock', params: { blockKey: null, exerciseId: mainId, name: 'Bench press' } }, (t) => t.includes('Stalled 3 weeks'));
    const text = r.text();
    for (const w of ['Stalled 3 weeks', 'Top set 70×6 kg, 4 weeks running.', 'W1', 'W3', 'Week', 'Top set', 'Sets', 'Est. 1RM', '70×2 kg', ' est.']) expect(text).toContain(w);
    // (Decision 1) The main lift's Next week: the rule's reset as one line, Why? / Skip / Apply; Apply then Undo.
    for (const w of ['Next week', 'Top 70×6 → 65×3–6 kg · back-off 65', 'Why?', 'Skip', 'Apply']) expect(text).toContain(w);
    await r.press('Apply');
    await r.waitFor((t) => t.includes('Undo') && !t.includes('Apply'), 'Undo after Apply');
    await r.press('Undo');
    await r.waitFor((t) => t.includes('Apply'), 'Apply back after Undo');
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

  it('no block: Lifts has no strip and shows Overall (period bar, charts); a first block: Block, no All blocks ›', async () => {
    solo = harness();
    const b = await benWithHistory(solo);
    let r = await renderScreen(solo, b.launched, ProgressScreen, { name: 'ProgressHome' }, (t) => t.includes('Bench press') && t.includes('Est. 1RM'));
    expect(r.all((n) => n.props.accessibilityRole === 'tab' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Block, ')).length).toBe(0);
    expect(r.text()).not.toContain('Overall');
    expect(periodBar(r)).toBe(true);
    expectHealthy(r);
    await r.unmount();

    await withPlan(solo, b);
    r = await renderScreen(solo, b.launched, ProgressScreen, { name: 'ProgressHome' }, (t) => t.includes('Overall') && /Week \d of \d|Lead-in/.test(t));
    expect(tabSelected(r, 'Block')).toBe(true);
    expect(periodBar(r)).toBe(false);
    expect(r.text()).not.toContain('All blocks');
    await r.unmount();
  });

  it('Library › Plan: All blocks › by Previous once a block has finished', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, LibraryScreen, { name: 'LibraryHome' }, (t) => t.includes('All blocks ›'));
    expect(r.text()).not.toContain('|Blocks ›');
    await r.press('All blocks ›');
    expect(JSON.stringify(r.nav)).toContain('ProgressBlocks');
    expectHealthy(r);
    await r.unmount();
  });
});
