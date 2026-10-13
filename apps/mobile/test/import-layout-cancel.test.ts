import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StackRouter, type ParamListBase, type StackNavigationState } from '@react-navigation/routers';
import { afterEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { keepsLayoutSession, leaveLayoutScreen } from '../src/import/layout-leave';
import { createHarness, setUpGym, type Harness } from './harness';
import { SpyLayoutPort, answerWith, layoutFixture, state } from './import-layout-helpers';

/**
 * `Cancel`, back and the swipe on New file layout and Check the layout
 * (§9.2.2, §9.2.5; review r2 S2): the layout session is dropped and its
 * request closed, so choosing the same file again never adopts the layout
 * Ben walked away from. Only the flow's own hand-off (New file layout
 * replaced by Check the layout for the same session) keeps it. All files
 * are synthetic.
 */
const STRONG = layoutFixture('strong-new-kg.synthetic.csv');
const SPEC = JSON.parse(layoutFixture('strong-new-kg.spec.json')) as unknown;
const SRC = join(__dirname, '..', 'src');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');

let h: Harness | null = null;
afterEach(async () => {
  await h?.cleanup();
  h = null;
});

async function launch(steps: ((req: ModelRequest) => ModelEvent[])[]) {
  const port = new SpyLayoutPort(steps);
  h = createHarness('2026-10-12T09:00:00.000Z', { coach: { model: () => port, connection: () => Promise.resolve(state('ok')) } });
  const { services: s } = await h.launch();
  await setUpGym(h, s);
  return { s, port };
}

const goBack = { type: 'GO_BACK' };
const popToTop = { type: 'POP_TO_TOP' };
const replace = (name: string, params: object) => ({ type: 'REPLACE', payload: { name, params } });

describe('which removals keep the layout session', () => {
  it('only the hand-off to the same session keeps it', () => {
    expect(keepsLayoutSession(replace('ImportLayoutCheck', { layoutId: 'a' }), 'a')).toBe(true);
    expect(keepsLayoutSession(replace('ImportNewLayout', { layoutId: 'b' }), 'a')).toBe(false);
    expect(keepsLayoutSession(goBack, 'a')).toBe(false);
    expect(keepsLayoutSession(popToTop, 'a')).toBe(false);
    expect(keepsLayoutSession({ type: 'POP', payload: { count: 1 } }, 'a')).toBe(false);
  });
});

describe('leaving drops the session (review r2 S2)', () => {
  it('Cancel (or back, or the swipe) on Check the layout: the same file is read again with a new request', async () => {
    const { s, port } = await launch([answerWith(SPEC), answerWith(SPEC)]);
    const r = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    if (r.kind !== 'new_table') throw new Error(r.kind);
    const sample = s.importLayouts.buildImportSample(r.layoutId);
    expect(await s.importLayouts.proposeImportMapping(r.layoutId, sample?.hash ?? '', 'op-1')).toMatchObject({ status: 'proposed' });
    // New file layout hands the session on to Check the layout: kept.
    await leaveLayoutScreen(s.importLayouts, r.layoutId, replace('ImportLayoutCheck', { layoutId: r.layoutId }));
    expect(s.importLayouts.getLayoutReview(r.layoutId)).not.toBeNull();
    // Ben backs out of Check the layout.
    await leaveLayoutScreen(s.importLayouts, r.layoutId, goBack);
    expect(s.importLayouts.getLayoutReview(r.layoutId)).toBeNull();
    const again = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    expect(again).toMatchObject({ kind: 'new_table', reused: false });
    if (again.kind !== 'new_table') return;
    const next = s.importLayouts.buildImportSample(again.layoutId);
    expect(await s.importLayouts.proposeImportMapping(again.layoutId, next?.hash ?? '', 'op-2')).toMatchObject({ status: 'proposed', reused: false });
    expect(port.requests).toHaveLength(2);
  });

  it('Cancel on New file layout before reading: the session is gone and nothing was sent', async () => {
    const { s, port } = await launch([]);
    const r = await s.importLayouts.previewImport({ name: 'strong_workouts.csv', text: STRONG });
    if (r.kind !== 'new_table') throw new Error(r.kind);
    await leaveLayoutScreen(s.importLayouts, r.layoutId, goBack);
    expect(await s.importLayouts.newTable(r.layoutId)).toBeNull();
    expect(port.requests).toHaveLength(0);
  });
});

describe('the screens wire it (source checks)', () => {
  it('both screens use the Cancel hook; the hook drops the session on beforeRemove and shows `Cancel`', () => {
    for (const f of ['screens/import/ImportNewLayoutScreen.tsx', 'screens/import/ImportLayoutCheckScreen.tsx']) expect(src(f)).toContain('useLayoutCancel(layoutId)');
    const hook = src('screens/import/useLayoutCancel.tsx');
    expect(hook).toContain("addListener('beforeRemove'");
    expect(hook).toContain('leaveLayoutScreen(services.importLayouts, layoutId, e.data.action)');
    expect(hook).toContain('label="Cancel"');
  });

  it('the role sheet goes back to the Check the layout under it (no second copy to remove later)', () => {
    expect(src('screens/import/ImportLayoutRoleScreen.tsx')).toContain("navigation.popTo('ImportLayoutCheck'");
    expect(src('screens/import/ImportLayoutRoleScreen.tsx')).not.toContain("navigate('ImportLayoutCheck'");
  });
});

describe('the stack through React Navigation 7', () => {
  const routeNames = ['ImportHistory', 'ImportNewLayout', 'ImportLayoutCheck', 'ImportLayoutQuestion', 'ImportLayoutRole', 'ImportPreview'];
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  type State = StackNavigationState<ParamListBase>;
  const apply = (s: State, action: Parameters<typeof router.getStateForAction>[1]): State => {
    const next = router.getStateForAction(s, action, options);
    if (next === null || next.stale) throw new Error(`action not handled: ${action.type}`);
    return next as State;
  };
  const names = (s: State) => s.routes.map((r) => r.name);
  const nav = (name: string, params: object = {}) => ({ type: 'NAVIGATE', payload: { name, params } }) as const;

  it('Question → Role → popTo leaves one Check the layout, with the toast param', () => {
    let s = apply(router.getInitialState(options), nav('ImportNewLayout', { layoutId: 'a' }));
    s = apply(s, { type: 'REPLACE', payload: { name: 'ImportLayoutCheck', params: { layoutId: 'a' } } });
    s = apply(s, nav('ImportLayoutQuestion', { layoutId: 'a', kind: 'new_column', column: 2 }));
    s = apply(s, nav('ImportLayoutRole', { layoutId: 'a', column: 2 }));
    s = apply(s, { type: 'POP_TO', payload: { name: 'ImportLayoutCheck', params: { layoutId: 'a', moved: 'x' } } });
    expect(names(s)).toEqual(['ImportHistory', 'ImportLayoutCheck']);
    expect(s.routes[1]?.params).toEqual({ layoutId: 'a', moved: 'x' });
  });
});

describe('a stale coach-layout commit goes back to Check the layout (review r2 S3)', () => {
  it('Run shows the session copy and pops to Check the layout; the saved-layout copy is unchanged', () => {
    const run = src('screens/import/ImportRunScreen.tsx');
    expect(run).toContain("case 'layout_session_changed'");
    expect(run).toContain('layoutRefusedView(r)');
    expect(run).toContain("navigation.popTo('ImportLayoutCheck', { layoutId: phase.back.layoutId })");
  });

  it('popTo from Run drops Preview and Run and keeps the one Check the layout', () => {
    const routeNames = ['ImportHistory', 'ImportLayoutCheck', 'ImportPreview', 'ImportRun'];
    const router = StackRouter({});
    const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
    type State = StackNavigationState<ParamListBase>;
    let s: State = router.getInitialState(options);
    for (const [name, params] of [
      ['ImportLayoutCheck', { layoutId: 'a' }],
      ['ImportPreview', { draftId: 'd' }],
      ['ImportRun', { draftId: 'd', mappingVersion: 1, workouts: 3 }],
      ['ImportLayoutCheck', { layoutId: 'a' }],
    ] as const) {
      const next = router.getStateForAction(s, name === 'ImportLayoutCheck' && s.routes.length > 1 ? { type: 'POP_TO', payload: { name, params } } : { type: 'NAVIGATE', payload: { name, params } }, options);
      if (next === null) throw new Error(name);
      s = next as State;
    }
    expect(s.routes.map((r) => r.name)).toEqual(['ImportHistory', 'ImportLayoutCheck']);
  });
});
