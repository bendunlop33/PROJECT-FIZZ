import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';
import type { CheckIn } from '@fizz/schemas';

import { afterReasonsStep, reasonsSubmission, type ReasonsSubmission } from '../src/workout/check-in-sheet';

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

  it('the sheet uses it: no fixed `:reasons` opId, routing on the saved record', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'workout', 'CheckInScreen.tsx'), 'utf8');
    expect(src).not.toContain('`${recordOp}:reasons`');
    expect(src).toContain('reasonsSubmission(');
    expect(src).toContain('afterReasonsStep(saved)');
  });
});

describe('Pain → Done → Back → untick Pain, tick Poor sleep → Done (bug: change dropped, loads held)', () => {
  it('stores the new reasons and Start adds load as planned (no unspecified pain)', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 7 }, { load: 60, reps: 6, rpe: 8 }] }]);
    h.clockMs += 2 * 86_400_000;

    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error('check-in');
    // First Done: pain.
    const one = reasonsSubmission(null, { reasons: ['pain'], note: null }, h.ids);
    const r1 = await s.checkIns.update(ci.checkIn.id, { reasons: ['pain'], note: null }, ci.checkIn.version, one.opId);
    if (!r1.ok) throw new Error('reasons 1');
    expect(afterReasonsStep(r1.checkIn)).toBe('pain');
    // Back, untick Pain, tick Poor sleep, Done again.
    const two = reasonsSubmission(one, { reasons: ['poor_sleep'], note: null }, h.ids);
    const r2 = await s.checkIns.update(r1.checkIn.id, { reasons: ['poor_sleep'], note: null }, r1.checkIn.version, two.opId);
    if (!r2.ok) throw new Error('reasons 2');
    expect(r2.duplicate).toBe(false);
    expect(afterReasonsStep(r2.checkIn)).toBe('start');
    expect((await s.checkIns.get(ci.checkIn.id))?.reasons).toEqual(['poor_sleep']);

    const r = await s.workout.start({ gymId, opId: 'next', checkIn: { kind: 'answered', checkInId: ci.checkIn.id }, nextOf: first });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.aggregate.sets.map((x) => x.planned.load?.value)).toEqual([62.5, 62.5, 62.5]);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(plain(s.workout.view(data, h.clockMs, null).focus?.target)).toBe('Target 62.5 kg · 3–6 reps');
  });
});
