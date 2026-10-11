import { describe, expect, it } from 'vitest';

import { createPrefsHolder, DEFAULT_PREFS, parsePrefs, settleLoadedPrefs, updatePrefs, type DevicePrefs } from '../src/device/prefs';

describe('device prefs', () => {
  it('guide animations default on, including for files saved before the setting existed', () => {
    expect(DEFAULT_PREFS.guideAnimations).toBe(true);
    expect(parsePrefs(null).guideAnimations).toBe(true);
    expect(parsePrefs('{"themeDirection":"A"}')).toEqual({ themeDirection: 'A', guideAnimations: true, alertsAsk: 'undetermined' });
    expect(parsePrefs('garbage')).toEqual(DEFAULT_PREFS);
  });

  it('only an explicit false turns them off', () => {
    expect(parsePrefs('{"guideAnimations":false}').guideAnimations).toBe(false);
    expect(parsePrefs('{"guideAnimations":"no"}').guideAnimations).toBe(true);
  });

  it('a change keeps the other preferences', () => {
    const a = updatePrefs({ themeDirection: 'A', guideAnimations: true, alertsAsk: 'later' }, { guideAnimations: false });
    expect(a).toEqual({ themeDirection: 'A', guideAnimations: false, alertsAsk: 'later' });
    expect(updatePrefs(a, { themeDirection: 'D' })).toEqual({ themeDirection: 'D', guideAnimations: false, alertsAsk: 'later' });
    expect(updatePrefs(null, { guideAnimations: false })).toEqual({ themeDirection: null, guideAnimations: false, alertsAsk: 'undetermined' });
  });
});

describe('prefs changed before the file loads (review N1)', () => {
  it('keeps the early change on top of the file and saves the merge', () => {
    const loaded = { themeDirection: 'D' as const, guideAnimations: true, alertsAsk: 'undetermined' as const };
    expect(settleLoadedPrefs(loaded, { guideAnimations: false })).toEqual({ prefs: { themeDirection: 'D', guideAnimations: false, alertsAsk: 'undetermined' }, save: true });
  });
  it('with no early change, uses the file as it is and writes nothing', () => {
    const loaded = { themeDirection: 'A' as const, guideAnimations: false, alertsAsk: 'answered' as const };
    expect(settleLoadedPrefs(loaded, {})).toEqual({ prefs: loaded, save: false });
  });
});

describe('createPrefsHolder (review S2)', () => {
  function file(initial: string | null) {
    let text = initial;
    let release: (() => void) | null = null;
    const writes: string[] = [];
    return {
      writes,
      get text() {
        return text;
      },
      remove() {
        text = null;
      },
      /** Hold the next read until `go()`: the load races a delete at launch. */
      holdRead() {
        const gate = new Promise<void>((r) => {
          release = r;
        });
        return { gate, go: () => release?.() };
      },
      port(gate?: Promise<void>) {
        return {
          read: async () => {
            const seen = text;
            if (gate) await gate;
            return seen;
          },
          write: (t: string) => {
            text = t;
            writes.push(t);
            return Promise.resolve();
          },
        };
      },
    };
  }

  it('after Delete my data cleared it, a load still in flight and later changes never write the old prefs back', async () => {
    const f = file(JSON.stringify({ themeDirection: 'D', guideAnimations: false, alertsAsk: 'answered' }));
    const { gate, go } = f.holdRead();
    const seen: DevicePrefs[] = [];
    const holder = createPrefsHolder(f.port(gate), (p) => seen.push(p));
    const loading = holder.load();
    // The interrupted delete finishes at launch: the file goes, then Root clears.
    f.remove();
    holder.clear();
    go();
    await loading;
    expect(seen.at(-1)).toEqual(DEFAULT_PREFS);
    await holder.update({ alertsAsk: 'later' });
    expect(JSON.parse(f.text ?? 'null')).toEqual({ ...DEFAULT_PREFS, alertsAsk: 'later' });
    expect(f.writes.some((w) => w.includes('"D"'))).toBe(false);
  });

  it('without a delete: loads, keeps early changes on top, saves', async () => {
    const f = file(JSON.stringify({ themeDirection: 'A', guideAnimations: true, alertsAsk: 'undetermined' }));
    const seen: DevicePrefs[] = [];
    const holder = createPrefsHolder(f.port(), (p) => seen.push(p));
    const loading = holder.load();
    await holder.update({ guideAnimations: false });
    await loading;
    expect(seen.at(-1)).toEqual({ themeDirection: 'A', guideAnimations: false, alertsAsk: 'undetermined' });
    expect(JSON.parse(f.text ?? 'null')).toEqual({ themeDirection: 'A', guideAnimations: false, alertsAsk: 'undetermined' });
  });
});
