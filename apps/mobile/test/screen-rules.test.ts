import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repsDraftWith, repsSteps, type RepsDraft } from '../src/workout/reps-draft';
import { checkInSheetEnd, statStripStacked, tileLabel } from '../src/workout/screen-rules';

/**
 * Screen rules that outlived the Workout overview (retired 22 Oct, Ben): the
 * check-in tiles' words, where the check-in sheet goes when it finishes
 * (over Your workout it never starts a workout), the stat strip's stacking
 * (Progress, Summary) and the reps sheet's steppers (the set-shape controls).
 */
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('check-in tiles and the sheet over a pre-start page', () => {
  it('VoiceOver reads each tile with its meaning at the ends', () => {
    expect([1, 2, 3, 4, 5].map((n) => tileLabel(n as 1 | 2 | 3 | 4 | 5))).toEqual(['1 of 5, rough', '2 of 5', '3 of 5', '4 of 5', '5 of 5, great']);
  });
  it('over Your workout, or with no gym to start at, every finishing exit returns to the page; otherwise it starts', () => {
    expect(checkInSheetEnd({ overview: true, gymId: null })).toBe('back_to_overview');
    expect(checkInSheetEnd({ overview: true, gymId: 'g' })).toBe('back_to_overview');
    expect(checkInSheetEnd({ overview: false, gymId: null })).toBe('back_to_overview');
    expect(checkInSheetEnd({ overview: false, gymId: 'g' })).toBe('start_workout');
    // Your workout opens the What's up? step over itself, and its Start reuses that check-in.
    expect(read('screens/builder/BuilderWorkoutScreen.tsx')).toContain("navigation.navigate('CheckIn', { mode: 'overview', checkInId: r.checkIn.id });");
  });
  it('Done, Skip, Not now, Flag, Train anyway and a 4–5 at the score all finish through start(), which checks the mode first; Skip workout goes to Today', () => {
    const src = read('screens/workout/CheckInScreen.tsx');
    const sheet = src.slice(src.indexOf('function StartCheckIn('), src.indexOf('function EditCheckIn('));
    const startBody = sheet.slice(sheet.indexOf('async function start('), sheet.indexOf('const savedToast'));
    // The mode check comes before any write: over the overview nothing starts.
    expect(startBody.indexOf("checkInSheetEnd({ overview: overview !== undefined, gymId }) === 'back_to_overview'")).toBeGreaterThan(-1);
    expect(startBody.indexOf('navigation.goBack()')).toBeLessThan(startBody.indexOf('services.workout.start('));
    // The only workout start in the sheet is inside start().
    expect(sheet.match(/services\.workout\.start\(/g)).toHaveLength(1);
    const body = (name: string) => sheet.slice(sheet.indexOf(`async function ${name}(`), sheet.indexOf('\n  }\n', sheet.indexOf(`async function ${name}(`)));
    // pickScore (a 4–5 at AX sizes), done (Done), afterPain (Not now, Flag, via flagPain) each end in start().
    // skipWithScore (both Skips once a score is saved) ends in start() too.
    for (const name of ['pickScore', 'done', 'afterPain', 'skipWithScore']) expect(body(name)).toContain('await start(');
    expect(body('flagPain')).toContain('await afterPain(');
    expect(sheet).toContain('onPress={() => void afterPain(null)}');
    expect(sheet).toContain('onPress={() => void skipWithScore()}');
    // Train anyway calls start() directly.
    expect(sheet.match(/void start\(\{ kind: 'answered', checkInId: record\.id \}/g)?.length).toBeGreaterThanOrEqual(1);
    expect(body('skipWorkout')).toContain('popToToday(');
    expect(body('skipWorkout')).not.toContain('start(');
  });
  it('r2 N3/N4: over the overview, Skip’s hint doesn’t promise a start, and a score that fails to save says so on the sheet', () => {
    const src = read('screens/workout/CheckInScreen.tsx');
    expect(src).toContain("accessibilityHint={overview ? 'Keeps your score.' : 'Keeps your score and starts the workout.'}");
    const pick = src.slice(src.indexOf('async function pickScore('), src.indexOf('async function done('));
    expect(pick.indexOf('setError(CHECK_IN_NOT_SAVED)')).toBeGreaterThan(-1);
    expect(pick.indexOf('setError(CHECK_IN_NOT_SAVED)')).toBeLessThan(pick.indexOf("{ kind: 'info', text: CHECK_IN_NOT_SAVED }"));
  });
  it('N1: with a saved score to load, the scale waits for it (no second check-in)', () => {
    const src = read('screens/workout/CheckInScreen.tsx');
    expect(src).toContain('disabled={existingId !== null && record === null}');
    expect(src).toContain('if (busy || (existingId !== null && record === null)) return;');
  });
});

describe('the stat strip (Progress, Summary)', () => {
  it('stacks at AX, or once a value wrapped at this width and text size (sticky until either changes)', () => {
    expect(statStripStacked({ ax: true, width: 390, fontScale: 1.65, wrappedAt: null })).toBe(true);
    expect(statStripStacked({ ax: false, width: 390, fontScale: 1.235, wrappedAt: null })).toBe(false);
    const wrap = { width: 390, fontScale: 1.235 };
    expect(statStripStacked({ ax: false, width: 390, fontScale: 1.235, wrappedAt: wrap })).toBe(true);
    expect(statStripStacked({ ax: false, width: 390, fontScale: 1, wrappedAt: wrap })).toBe(false);
    expect(statStripStacked({ ax: false, width: 430, fontScale: 1.235, wrappedAt: wrap })).toBe(false);
    expect(read('ui/overview.tsx')).toContain('statStripStacked({ ax, width, fontScale, wrappedAt })');
  });
});

describe('the reps sheet’s steppers (set-shape controls)', () => {
  it('Range ↔ Exact; steps stay within 1–50 and To ≥ From', () => {
    const d: RepsDraft = { kind: 'reps', exact: false, min: 8, max: 10 };
    expect(repsSteps({ kind: 'reps', exact: false, min: 1, max: 1 }).from?.down).toMatchObject({ enabled: false });
    expect(repsSteps({ kind: 'reps', exact: false, min: 8, max: 8 }).to?.down).toMatchObject({ enabled: false });
    expect(repsSteps({ kind: 'reps', exact: true, min: 50, max: 50 }).from?.up).toMatchObject({ enabled: false, reason: 'Max 50' });
    expect(repsDraftWith(repsDraftWith(d, 'from', 6), 'to', 8)).toEqual({ kind: 'reps', exact: false, min: 6, max: 8 });
    const exact = repsDraftWith(d, 'exact');
    expect(exact).toEqual({ kind: 'reps', exact: true, min: 8, max: 8 });
    expect(repsDraftWith(exact, 'range')).toEqual({ kind: 'reps', exact: false, min: 8, max: 10 });
    expect(repsDraftWith(d, 'from', 99)).toMatchObject({ min: 50, max: 50 });
    expect(repsDraftWith(d, 'to', 2)).toMatchObject({ min: 8, max: 8 });
  });
  it('work time: ±5 s within 0:05–10:00', () => {
    expect(repsSteps({ kind: 'time', seconds: 5 }).time?.down).toMatchObject({ enabled: false });
    expect(repsSteps({ kind: 'time', seconds: 600 }).time?.up).toMatchObject({ enabled: false });
    expect(repsDraftWith({ kind: 'time', seconds: 45 }, 'time', 2)).toEqual({ kind: 'time', seconds: 5 });
  });
});
