import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';
import type { CheckIn } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';

import { afterReasonsStep, NO_REASONS_WRITTEN, reasonsSubmission, skipReasons, submitReasons, type ReasonsSubmission } from '../src/workout/check-in-sheet';

import { createHarness, logWorkout, type Harness } from './harness';

/**
 * What's up? → Done → (pain step) Back → change reasons → Done: the second
 * Done is a new write, not a duplicate of the first (rule 5 keeps retries
 * of the same payload safe); the sheet routes on what was saved.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

describe('reasonsSubmission: one opId per distinct Done', () => {
  it('a retry of the same reasons and note reuses the opId; a change gets a new one; A → B → A is new again', () => {
    let n = 0;
    const id = () => `op-${String((n += 1))}`;
    const a = reasonsSubmission(null, { reasons: ['pain'], note: null }, id);
    expect(reasonsSubmission(a, { reasons: ['pain'], note: null }, id).opId).toBe(a.opId);
    const b = reasonsSubmission(a, { reasons: ['poor_sleep'], note: null }, id);
    expect(b.opId).not.toBe(a.opId);
    expect(reasonsSubmission(b, { reasons: ['poor_sleep'], note: 'late night' }, id).opId).not.toBe(b.opId);
    const back: ReasonsSubmission = reasonsSubmission(b, { reasons: ['pain'], note: null }, id);
    expect(back.opId).not.toBe(a.opId);
    expect(back.opId).not.toBe(b.opId);
    // Order of ticking doesn't make a new payload.
    const ab = reasonsSubmission(null, { reasons: ['pain', 'ill'], note: null }, id);
    expect(reasonsSubmission(ab, { reasons: ['ill', 'pain'], note: null }, id).opId).toBe(ab.opId);
  });

  it('routes on the saved check-in: pain first, then ill, else start', () => {
    const c = (reasons: CheckIn['reasons']) => ({ reasons }) as Pick<CheckIn, 'reasons'>;
    expect(afterReasonsStep(c(['pain', 'ill']))).toBe('pain');
    expect(afterReasonsStep(c(['ill']))).toBe('ill');
    expect(afterReasonsStep(c(['poor_sleep']))).toBe('start');
  });

  it('the sheet uses the helpers: no fixed `:reasons` opId, no Skip that starts on the stale record', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'workout', 'CheckInScreen.tsx'), 'utf8');
    expect(src).not.toContain('`${recordOp}:reasons`');
    expect(src).toContain('submitReasons(services.checkIns');
    expect(src).toContain('skipReasons(services.checkIns');
    // Every Skip with a saved score goes through skipWithScore, never straight to start on `record`: the
    // start sheet's two, and the workout's own check-in's What's up? (Ben, 23 Oct).
    expect(src).not.toMatch(/if \(record\) void start\(\{ kind: 'answered', checkInId: record\.id \}, savedToast\(record\)\)/);
    expect(src.match(/void skipWithScore\(\)/g)?.length).toBe(3);
  });
});

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  const gymId = gym.ok ? (gym.gymId ?? '') : '';
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 8 }] }]);
  h.clockMs += 2 * 86_400_000;
  const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
  if (!ci.ok) throw new Error('check-in');
  return { s, gymId, first, ci: ci.checkIn };
}

async function startsAsPlanned(s: AppServices, gymId: string, first: string, checkInId: string) {
  const r = await s.workout.start({ gymId, opId: 'next', checkIn: { kind: 'answered', checkInId }, nextOf: first });
  if (!r.ok) throw new Error(r.error.message);
  expect(r.aggregate.sets.map((x) => x.planned.load?.value)).toEqual([62.5, 62.5, 62.5]);
  const data = await s.workout.load();
  if (!data) throw new Error('no workout');
  expect(plain(s.workout.view(data, h.clockMs, null).focus?.target)).toBe('Target 62.5 kg · 3–6 reps @ RPE 8.5');
}

describe('Pain → Done → Back → untick Pain, tick Poor sleep → Done (bug: change dropped, loads held)', () => {
  it('through the sheet\'s submitReasons: the second Done is a new write, routes to start, and Start adds load as planned', async () => {
    const { s, gymId, first, ci } = await setUp();
    const one = await submitReasons(s.checkIns, ci, { reasons: ['pain'], note: null }, NO_REASONS_WRITTEN, h.ids);
    if (!one.ok) throw new Error('reasons 1');
    expect(one.next).toBe('pain');
    // A double tap on the first Done is a duplicate (rule 5).
    const again = await submitReasons(s.checkIns, ci, { reasons: ['pain'], note: null }, one.state, h.ids);
    expect(again.ok && again.duplicate).toBe(true);
    // Back, untick Pain, tick Poor sleep, Done again.
    const two = await submitReasons(s.checkIns, one.checkIn, { reasons: ['poor_sleep'], note: null }, again.state, h.ids);
    if (!two.ok) throw new Error('reasons 2');
    expect(two.duplicate).toBe(false);
    expect(two.next).toBe('start');
    expect((await s.checkIns.get(ci.id))?.reasons).toEqual(['poor_sleep']);
    await startsAsPlanned(s, gymId, first, ci.id);
  });
});

describe('Pain → Done → Back → untick Pain → Skip (review S1: Skip kept the saved pain and held every load)', () => {
  it('Skip puts back the score-only check-in with a new write, and Start adds load as planned', async () => {
    const { s, gymId, first, ci } = await setUp();
    const one = await submitReasons(s.checkIns, ci, { reasons: ['pain'], note: 'left shoulder' }, NO_REASONS_WRITTEN, h.ids);
    if (!one.ok) throw new Error('reasons 1');
    const skipped = await skipReasons(s.checkIns, one.checkIn, one.state, h.ids);
    if (!skipped.ok) throw new Error('skip');
    expect(skipped.duplicate).toBe(false);
    expect(skipped.checkIn.version).toBeGreaterThan(one.checkIn.version);
    const stored = await s.checkIns.get(ci.id);
    expect(stored?.reasons).toEqual([]);
    expect(stored?.note ?? null).toBeNull();
    expect(stored?.score).toBe(2);
    await startsAsPlanned(s, gymId, first, ci.id);
  });

  it('Skip with no Done writes nothing', async () => {
    const { s, ci } = await setUp();
    const skipped = await skipReasons(s.checkIns, ci, NO_REASONS_WRITTEN, h.ids);
    expect(skipped.ok && skipped.checkIn).toBe(ci);
    expect((await s.checkIns.get(ci.id))?.version).toBe(ci.version);
  });

  it('a stale Done returns the latest check-in for the sheet to show (review N1)', async () => {
    const { s, ci } = await setUp();
    const elsewhere = await s.checkIns.update(ci.id, { reasons: ['tired'], note: 'x' }, ci.version, h.ids());
    if (!elsewhere.ok) throw new Error('edit');
    const r = await submitReasons(s.checkIns, ci, { reasons: ['pain'], note: null }, NO_REASONS_WRITTEN, h.ids);
    if (r.ok) throw new Error('expected stale');
    expect(r.stale).toBe(true);
    expect(r.latest?.reasons).toEqual(['tired']);
    expect(r.latest?.note).toBe('x');
  });
});
