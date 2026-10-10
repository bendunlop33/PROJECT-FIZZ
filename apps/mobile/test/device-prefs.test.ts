import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS, parsePrefs, updatePrefs } from '../src/device/prefs';

describe('device prefs', () => {
  it('guide animations default on, including for files saved before the setting existed', () => {
    expect(DEFAULT_PREFS.guideAnimations).toBe(true);
    expect(parsePrefs(null).guideAnimations).toBe(true);
    expect(parsePrefs('{"themeDirection":"A"}')).toEqual({ themeDirection: 'A', guideAnimations: true });
    expect(parsePrefs('garbage')).toEqual(DEFAULT_PREFS);
  });

  it('only an explicit false turns them off', () => {
    expect(parsePrefs('{"guideAnimations":false}').guideAnimations).toBe(false);
    expect(parsePrefs('{"guideAnimations":"no"}').guideAnimations).toBe(true);
  });

  it('a change keeps the other preferences', () => {
    const a = updatePrefs({ themeDirection: 'A', guideAnimations: true }, { guideAnimations: false });
    expect(a).toEqual({ themeDirection: 'A', guideAnimations: false });
    expect(updatePrefs(a, { themeDirection: 'D' })).toEqual({ themeDirection: 'D', guideAnimations: false });
    expect(updatePrefs(null, { guideAnimations: false })).toEqual({ themeDirection: null, guideAnimations: false });
  });
});
