import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { LibraryScreen } from '../../src/screens/library/LibraryScreen';
import { TrainingDetailsScreen } from '../../src/screens/profile/TrainingDetailsScreen';
import { directionById, resolveTheme } from '../../src/theme';
import { benWithBlocks, type BlockBen } from '../block-seed';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';

/**
 * (Ben, 2 Nov: one plan screen, one plan time) Library › Plan's top over real SQLite (ADR 0037), Ben's block 3
 * (Muscle, 6 weeks, Standard: deload week 6) on Wed 28 Oct, week 4: `Muscle · 6 weeks`, `Week 4 of 6 · ends Sun 15 Nov`,
 * the week strip (weeks 1–3 filled green with no tick, week 4 accent, week 5 neutral, week 6 dashed `6 ↓`), each bar a
 * tap that shows its week (an outline on a picked week; this week again goes back), and days / week · minutes ·
 * effort. Then the plan's minutes and Profile's session length agree after an edit on either side.
 */

let ben: BlockBen | null = null;
afterEach(async () => {
  await ben?.h.cleanup();
  ben = null;
});

const plain = (t: string) => t.replace(/\u00a0/g, ' ');
const ids = (r: Rendered) => r.all((n) => typeof n.props.testID === 'string' && /^plan-week-(done|current|later)/.test(n.props.testID)).map((n) => n.props.testID as string);
const bars = (r: Rendered) => r.all((n) => n.props.testID === 'plan-week-bar').map((n) => n.props.style as Record<string, unknown>);
function textOf(node: { children: readonly unknown[] }): string {
  return node.children
    .map((c) => (typeof c === 'string' ? c : textOf(c as { children: readonly unknown[] })))
    .filter((t) => t !== '')
    .join('|');
}
async function tapWeek(r: Rendered, label: string) {
  const bar = r.all((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  if (bar === undefined) throw new Error(`no bar ${label}`);
  const onPress = bar.props.onPress as () => void;
  await act(async () => {
    onPress();
    await Promise.resolve();
  });
}

describe('Library › Plan’s top (one plan screen)', () => {
  it('title, week line with end date, the strip’s states, three numbers; no goal line or ticks', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, LibraryScreen, { name: 'LibraryHome', params: { segment: 'plan' } }, (t) => t.includes('Week 4 of 6'));
    const text = plain(r.text());
    expect(text).toContain('Muscle · 6 weeks|Week 4 of 6 · ends Sun 15 Nov|');
    expect(text).not.toContain('Goal:');
    expect(text).not.toContain('deload in week');
    // The strip: one bar per week, the number under it, deload `6 ↓`.
    expect(ids(r)).toEqual(['plan-week-done', 'plan-week-done', 'plan-week-done', 'plan-week-current', 'plan-week-later', 'plan-week-later-deload']);
    const strip = r.all((n) => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === 'Plan weeks')[0];
    if (strip === undefined) throw new Error('no strip');
    expect(textOf(strip)).toBe('1|2|3|4|5|6 ↓');
    expect(textOf(strip)).not.toContain('✓');
    const colors = resolveTheme(directionById(null), 'dark').colors;
    const b = bars(r);
    expect(b.slice(0, 3).map((s) => s.backgroundColor)).toEqual([colors['status.done'], colors['status.done'], colors['status.done']]);
    expect(b[3]?.backgroundColor).toBe(colors.accent);
    expect(b[4]).toMatchObject({ borderStyle: 'solid' });
    expect(b[5]).toMatchObject({ backgroundColor: 'transparent', borderStyle: 'dashed' });
    // VoiceOver says each state.
    expect(r.all((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('plan-week-') && n.props.testID !== 'plan-week-bar').map((n) => n.props.accessibilityLabel as string)).toEqual(['Week 1, done', 'Week 2, done', 'Week 3, done', 'Week 4, this week', 'Week 5', 'Week 6, deload']);
    // Three numbers: days / week, minutes (the plan's own), effort.
    const answers = (await ben.s.plans.inUseTime())?.time;
    expect(text).toContain(`|${String(answers?.sessions)}|days / week|~${String(answers?.minutes)}|min|Standard|effort|`);
    expect(text).toContain('This week');
    expectHealthy(r);
    await r.unmount();
  });

  it('tapping a week shows its list with an outline; this week again goes back', async () => {
    ben = await benWithBlocks();
    const r = await renderScreen(ben.h, ben.launched, LibraryScreen, { name: 'LibraryHome', params: { segment: 'plan' } }, (t) => t.includes('Week 4 of 6'));
    await tapWeek(r, 'Week 5');
    expect(r.text()).toContain('|Week 5|Push|');
    expect(ids(r)).toContain('plan-week-later-picked');
    expect(r.all((n) => n.props.accessibilityLabel === 'Week 5, showing')).toHaveLength(1);
    expect(r.all((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('plan-week-') && n.props.testID.endsWith('-picked'))[0]?.props.accessibilityState).toEqual({ checked: true });
    await tapWeek(r, 'Week 2, done');
    expect(r.text()).toContain('|Week 2|');
    expect(ids(r)).toContain('plan-week-done-picked');
    await tapWeek(r, 'Week 4, this week');
    expect(r.text()).toContain('|This week|');
    expect(ids(r).some((x) => x.endsWith('-picked'))).toBe(false);
    expectHealthy(r);
    await r.unmount();
  });
});

describe('one plan time: the plan’s minutes and Profile’s session length agree', () => {
  it('Change plan › Days and time writes the plan, Profile follows; Undo puts both back; a replay writes once', async () => {
    ben = await benWithBlocks();
    const s = ben.s;
    const before = (await s.plans.inUseTime())?.time;
    if (before == null) throw new Error('no builder plan in use');
    // Plan setup's Apply already put the plan's minutes in Profile.
    expect((await s.training.snapshot())?.profile.sessionMinutes).toBe(before.minutes);
    const edit = await s.planBuilder.open({ editPlanId: ben.plans[2]?.planId ?? '' });
    const run = edit?.running ?? null;
    if (edit === null || run === null) throw new Error('no edit session');
    const minutes = before.minutes === 45 ? 75 : 45;
    const op = ben.h.ids();
    const r = await s.planBuilder.applyEdit(edit, { ...edit.answers, minutes }, new Set(), { kind: 'from', week: run.week }, op);
    if (!r.ok) throw new Error(`not applied: ${r.message}`);
    expect((await s.plans.inUseTime())?.time?.minutes).toBe(minutes);
    const after = await s.training.snapshot();
    expect(after?.profile.sessionMinutes).toBe(minutes);
    // The same tap again: nothing more is written (rule 5).
    await s.planBuilder.applyEdit(edit, { ...edit.answers, minutes }, new Set(), { kind: 'from', week: run.week }, op);
    expect((await s.training.snapshot())?.profile.version).toBe(after?.profile.version);

    // Library › Plan and Profile › Training details both show the plan's minutes.
    const lib = await renderScreen(ben.h, ben.launched, LibraryScreen, { name: 'LibraryHome', params: { segment: 'plan' } }, (t) => t.includes('Week 4 of 6'));
    expect(lib.text()).toContain(`|~${String(minutes)}|min|`);
    await lib.unmount();
    const profile = await renderScreen(ben.h, ben.launched, TrainingDetailsScreen, { name: 'TrainingDetails' }, (t) => t.includes('Session length'));
    expect(profile.text()).toContain(`Session length|${String(minutes)} min`);
    // Its row opens the plan's own Days and time (Change plan), the one versioned edit.
    await profile.press(`Session length${String(minutes)} min`);
    const open = profile.nav.find((c) => c.method === 'dispatch' && JSON.stringify(c.args).includes('PlanSetup'));
    expect(JSON.stringify(open?.args)).toContain('"start":"week"');
    expect(JSON.stringify(open?.args)).toContain(ben.plans[2]?.planId ?? 'none');
    expectHealthy(profile);
    await profile.unmount();

    // Undo of the edit: the plan's minutes back, and Profile with them.
    const undo = await s.planBuilder.undoEdit({ planId: r.planId, expectedVersion: r.version, opId: ben.h.ids() });
    if (!undo.ok) throw new Error('not undone');
    expect((await s.plans.inUseTime())?.time?.minutes).toBe(before.minutes);
    expect((await s.training.snapshot())?.profile.sessionMinutes).toBe(before.minutes);
  });
});
