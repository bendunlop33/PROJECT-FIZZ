import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RestWhenShortScreen } from '../../src/screens/profile/RestWhenShortScreen';
import { createHarness, setUpGym, type Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';

/**
 * (Ben, 1 Nov) Profile › Rest when short on time over real SQLite: `Shorten main lift too` is off, the main-lift line
 * reads `Main lift 3:00`; turned on, it's saved and the line shows each level's value.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-11-01T08:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

describe('Rest when short on time › Shorten main lift too', () => {
  it('off by default; on saves and shows each level’s main-lift rest; no React warning', async () => {
    const launched = await h.launch();
    await setUpGym(h, launched.services);
    const r = await renderScreen(h, launched, RestWhenShortScreen, { name: 'RestWhenShort' }, (t) => t.includes('Shorten main lift too'));
    expect(r.text()).toContain('Main lift 3:00');
    expect(r.text()).not.toContain('Main lift 3:00 · 2:30 · 2:00');
    const sw = r.all((n) => n.props.testID === 'shorten-main' && typeof n.props.onValueChange === 'function')[0];
    if (sw === undefined) throw new Error('no switch');
    expect(sw.props.value).toBe(false);
    const toggle = sw.props.onValueChange as (on: boolean) => void;
    await act(async () => {
      toggle(true);
      await Promise.resolve();
    });
    await r.waitFor((t) => t.includes('Main lift 3:00 · 2:30 · 2:00'), 'the per-level main-lift line');
    expect((await launched.services.training.snapshot())?.profile.fitShortenMain).toBe(true);
    expectHealthy(r);
    await r.unmount();
  });
});
