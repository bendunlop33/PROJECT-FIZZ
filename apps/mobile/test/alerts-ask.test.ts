import { describe, expect, it } from 'vitest';

import { alertsOff, alertsOffAction, alertsOffLabel, shouldAskOnStart } from '../src/alerts/ask';
import { DEFAULT_PREFS, parsePrefs } from '../src/device/prefs';

/** premium-feel §3.5, acceptance 8 and 9. */
describe('Rest alerts ask on the first Start', () => {
  it('asks once, only while iOS can still ask', () => {
    expect(shouldAskOnStart('undetermined', 'undetermined')).toBe(true);
    expect(shouldAskOnStart('undetermined', 'later')).toBe(false);
    expect(shouldAskOnStart('undetermined', 'answered')).toBe(false);
    expect(shouldAskOnStart('granted', 'undetermined')).toBe(false);
    expect(shouldAskOnStart('denied', 'undetermined')).toBe(false);
    expect(shouldAskOnStart('unknown', 'undetermined')).toBe(false);
  });

  it('Rest shows alerts off when denied or Not now, never while unknown or granted', () => {
    expect(alertsOff('denied', 'answered')).toBe(true);
    expect(alertsOff('undetermined', 'later')).toBe(true);
    expect(alertsOff('undetermined', 'undetermined')).toBe(false);
    expect(alertsOff('granted', 'later')).toBe(false);
    expect(alertsOff('unknown', 'later')).toBe(false);
    expect(alertsOffAction('denied')).toBe('open_settings');
    expect(alertsOffAction('undetermined')).toBe('request');
    expect(alertsOffAction('granted')).toBe('none');
  });

  it('the answer is kept per phone and an old prefs file reads as not asked', () => {
    expect(DEFAULT_PREFS.alertsAsk).toBe('undetermined');
    expect(parsePrefs(JSON.stringify({ themeDirection: 'D', guideAnimations: true })).alertsAsk).toBe('undetermined');
    expect(parsePrefs(JSON.stringify({ alertsAsk: 'later' })).alertsAsk).toBe('later');
    expect(parsePrefs(JSON.stringify({ alertsAsk: 'answered' })).alertsAsk).toBe('answered');
    expect(parsePrefs(JSON.stringify({ alertsAsk: 'nonsense' })).alertsAsk).toBe('undetermined');
  });
});

describe('bell.slash says what its tap does (review S6)', () => {
  it('denied opens iOS Settings; not asked yet asks', () => {
    expect(alertsOffLabel('denied')).toBe('Rest alerts are off. Opens iOS Settings.');
    expect(alertsOffLabel('undetermined')).toBe('Rest alerts are off. Asks to allow them.');
    expect(alertsOffLabel('unknown')).toBe('Rest alerts are off.');
  });
});
