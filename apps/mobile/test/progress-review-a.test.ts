import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCoachContext, describeCoachContext } from '@fizz/coach';

import { seesLabel, starterChips } from '../src/coach/sheet-view';
import { HOW_COUNTED_LINES, TIME_SHEET_COPY } from '../src/progress/copy';
import { countedText, runCountIt, type CountItDeps, type CountItToast } from '../src/progress/count-it';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Fixes for review progress-A: one shared window/grouping setting (B3), no
 * lost settings write (S3), a reachable `Count it` Undo (B2, N6), the Ask
 * pill above the ResumeBar with Progress's window (S1, S2), the sheet copy
 * for check 23 (S8, SP1), and a DST case through the service (S8).
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const DAY = 86_400_000;

let h: Harness | null = null;
afterEach(async () => {
  await h?.cleanup();
  h = null;
});

async function setUp(start = '2026-10-05T07:00:00.000Z') {
  h = createHarness(start);
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  return { h, s, gymId: gym.ok ? (gym.gymId ?? '') : '' };
}

async function normal(s: AppServices) {
  const home = await s.progress.home();
  if (home?.view.dataState !== 'normal') throw new Error('expected normal');
  return { ...home, view: home.view };
}

describe('B3, S3: window and grouping are one shared, saved setting', () => {
  it('a window picked on Muscles is what home shows next, even before the save lands, and is what is saved', async () => {
    const { h: hh, s, gymId } = await setUp();
    await logWorkout(hh, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);

    // Home: 7 days.
    const homePick = s.progress.saveSettings({ period: '3m' });
    expect((await normal(s)).period).toBe('3m');
    await homePick;
    // Muscles (same service call, no request of its own): 60 days. Read straight away, as the screen's reload does.
    const musclesPick = s.progress.saveSettings({ period: '1y' });
    const home = await normal(s);
    expect(home.period).toBe('1y');
    expect(home.view.windowLabel).toBe('1 year');
    expect(await musclesPick).toEqual({ ok: true });
    expect((await s.yourData.profile())?.progress).toMatchObject({ period: '1y' });
  });

  it('two quick taps (grouping, then window) both land; neither overwrites the other, and both survive a relaunch', async () => {
    const { h: hh, s, gymId } = await setUp();
    await logWorkout(hh, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const [a, b] = await Promise.all([s.progress.saveSettings({ grouping: 'ppl' }), s.progress.saveSettings({ period: '1y' })]);
    expect(a.ok && b.ok).toBe(true);
    expect((await s.yourData.profile())?.progress).toEqual({ period: '1y', grouping: 'ppl' });

    await hh.forceClose();
    const { services: s2 } = await hh.launch();
    const again = await normal(s2);
    expect([again.period, again.grouping]).toEqual(['1y', 'ppl']);
  });

  it('Muscles reads the service with no request; Progress (redesign v3 C2) reads by the period bar’s one choice', () => {
    const muscles = read('screens/progress/MusclesScreen.tsx');
    expect(muscles).toContain('s.progress.home()');
    expect(muscles).not.toMatch(/useState<\{\s*days\?/);
    expect(read('screens/progress/ProgressScreen.tsx')).toContain('s.progress.shell(choice)');
    expect(read('screens/progress/TrainingTab.tsx')).toContain('s.progress.training(choice)');
  });
});

describe('B2, N6: Count it closes the sheet before its Undo toast shows', () => {
  const row = { sessionId: 'w1', version: 4, title: 'Push A', text: 'Fri 2 Oct · Push A · 5 h 12 min' };

  type Req = { sessionId: string; expectedVersion: number; opId: string };

  function fakes(confirmOk = true) {
    const log: string[] = [];
    let toast: CountItToast | null = null;
    let release: () => void = () => undefined;
    const deps: CountItDeps = {
      confirm: vi.fn(async (req: Req) => {
        log.push(`confirm v${String(req.expectedVersion)}`);
        await new Promise<void>((r) => {
          release = r;
        });
        return confirmOk ? { ok: true as const, sessionId: req.sessionId, version: 5 } : { ok: false as const, message: 'This workout changed. Check it and try again.' };
      }),
      undo: vi.fn((req: Req) => {
        log.push(`undo v${String(req.expectedVersion)}`);
        return Promise.resolve({ ok: true as const, sessionId: req.sessionId, version: 6 });
      }),
      newId: () => `op-${String(log.length)}`,
      closeSheet: () => {
        log.push('close sheet');
      },
      show: (t) => {
        log.push(`show ${t.text}`);
        toast = t;
      },
      hide: () => {
        log.push('hide');
        toast = null;
      },
      reload: () => {
        log.push('reload');
      },
    };
    return { deps, log, toast: () => toast, release: () => {
        release();
      } };
  }

  it('closes the sheet, then shows `Counted …` with an Undo that undoes against the version Count it produced', async () => {
    const f = fakes();
    const inFlight = new Set<string>();
    const run = runCountIt(row, f.deps, inFlight);
    // A double tap while saving sends nothing more (one command, one opId).
    const second = runCountIt(row, f.deps, inFlight);
    await Promise.resolve();
    f.release();
    await Promise.all([run, second]);
    expect(f.deps.confirm).toHaveBeenCalledTimes(1);
    expect(f.log.indexOf('close sheet')).toBeGreaterThan(-1);
    expect(f.log.indexOf('close sheet')).toBeLessThan(f.log.findIndex((l) => l.startsWith('show')));
    const t = f.toast();
    expect(t?.text).toBe('Counted Push A, 5 h 12 min');
    expect(t?.action).toBe('Undo');
    t?.onAction?.();
    t?.onAction?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(f.deps.undo).toHaveBeenCalledTimes(1);
    expect(f.log).toContain('undo v5');
  });

  it('a refused Count it also closes the sheet, so its message is seen', async () => {
    const f = fakes(false);
    const run = runCountIt(row, f.deps, new Set());
    await Promise.resolve();
    f.release();
    await run;
    expect(f.log.indexOf('close sheet')).toBeLessThan(f.log.findIndex((l) => l.startsWith('show')));
    expect(f.toast()).toEqual({ text: 'This workout changed. Check it and try again.' });
  });

  it('countedText takes the duration from the row', () => {
    expect(countedText(row)).toBe('Counted Push A, 5 h 12 min');
  });

  it('the screen wires Count it through runCountIt with a closeSheet that hides the Time sheet', () => {
    const src = read('screens/progress/ProgressScreen.tsx');
    expect(src).toContain('runCountIt(r, countDeps, inFlight.current)');
    expect(src).toMatch(/closeSheet: \(\) => \{\s*setTimeSheet\(null\);/);
  });
});

describe('S1, S2: Ask floats above the ResumeBar and carries the Progress window', () => {
  it('the ResumeBar is outside the area the Ask pill and toast float in', () => {
    const src = read('screens/progress/ProgressScreen.tsx');
    const ask = src.indexOf('<AskPill');
    const toast = src.indexOf('<Toast');
    const resume = src.indexOf('<ResumeBar');
    // The floating area is the flex: 1 View opened before the ScrollView and closed before the ResumeBar.
    const areaClose = src.lastIndexOf('</View>', resume);
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(areaClose);
    expect(toast).toBeLessThan(areaClose);
    expect(resume).toBeGreaterThan(areaClose);
    expect(src).toContain("{ kind: 'progress', period: bar.preset, range: { from: bar.window.from, to: bar.window.to } }");
  });

  it('the coach sheet reads the window; the context frames it without inventing numbers', () => {
    expect(seesLabel({ kind: 'progress', period: '1m' }, null, false)).toBe('Sees: Progress · last month');
    expect(starterChips({ kind: 'progress', period: '1m' }, { status: 'ok', model: 'm' }, false)).toEqual([]);
    const ctx = buildCoachContext({
      turnKind: 'general',
      session: null,
      gymName: null,
      painFlags: [],
      checkIn: null,
      memories: [],
      thread: [],
      catalogue: [],
      openedFrom: { screen: 'progress', window: { days: 30, from: '2026-09-06', to: '2026-10-05' } },
    });
    expect(ctx.yourData.openedFrom).toEqual({ screen: 'progress', window: { days: 30, from: '2026-09-06', to: '2026-10-05' } });
    expect(ctx.notAvailable.some((n) => n.startsWith('Training history'))).toBe(true);
    expect(describeCoachContext(ctx).yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · last 30 days' });
  });

  it('through the services: `What the coach can see` from Progress names the window', async () => {
    const { s } = await setUp();
    const d = await s.coach.describe({ kind: 'progress', period: '6m' }, null);
    expect(d.yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · last 6 months' });
  });
});

describe('S8, SP1: sheet copy (check 23, minimal copy)', () => {
  it('no score, ring, percentage, streak, recovery, readiness or fatigue words in either sheet', () => {
    const all = [...HOW_COUNTED_LINES, ...Object.values(TIME_SHEET_COPY)].join('\n');
    expect(all).not.toMatch(/score|ring\b|%|streak|recovery|readiness|fatigue/i);
  });

  it('the sheets render the shared copy, not their own literals', () => {
    const src = read('screens/progress/sheets.tsx');
    expect(src).toContain('HOW_COUNTED_LINES');
    expect(src).not.toMatch(/recovery|fatigue/i);
  });
});

describe('S8: local dates across the October DST change, through the service', () => {
  it('a workout at 23:30 UTC on 24 Oct (00:30 BST) is on 25 Oct; one at 23:30 UTC on 25 Oct (GMT) is on 25 Oct too', async () => {
    const { h: hh, s, gymId } = await setUp('2026-10-24T23:30:00.000Z');
    await logWorkout(hh, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    hh.clockMs = Date.parse('2026-10-25T23:30:00.000Z');
    await logWorkout(hh, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);

    const cal = await s.progress.calendar('2026-10');
    expect(cal?.view.days['2026-10-24'] ?? []).toEqual([]);
    expect(cal?.view.days['2026-10-25']).toHaveLength(2);

    // 1 month ending Tue 24 Nov (local) runs 25 Oct – 24 Nov: both count. A day later (26 Oct – 25 Nov) neither does.
    hh.clockMs = Date.parse('2026-11-24T12:00:00.000Z');
    await s.progress.saveSettings({ period: '1m' });
    expect((await normal(s)).view.activity.stats[0]?.value).toBe('2');
    hh.clockMs += DAY;
    expect((await normal(s)).view.activity.stats[0]?.value).toBe('0');
  });
});
