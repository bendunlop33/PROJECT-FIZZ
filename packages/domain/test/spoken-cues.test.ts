import { describe, expect, it } from 'vitest';

import { cueText, spokenDuration, spokenLoad, spokenNumber, spokenReplyText, spokenSetDetail, spokenSetOf, speakableText, type SpokenSetInput } from '../src/index';
import { at, kg, lb, values } from './fixtures';
import { apply, BENCH, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/** Spoken workout cues (Ben, 19 Oct 2026): the words only; timing is the app's cue controller. */

const set = (over: Partial<SpokenSetInput> = {}): SpokenSetInput => ({
  exerciseName: 'Bench press',
  number: 2,
  setType: 'working',
  measurement: 'reps',
  unilateral: false,
  side: null,
  convention: 'total',
  equipment: { kind: 'barbell' },
  load: kg(80),
  reps: { min: 8, max: 8 },
  durationS: null,
  distanceM: null,
  ...over,
});

describe('spoken numbers, loads and durations', () => {
  it('says halves the way people do and keeps other decimals', () => {
    expect(spokenNumber(80)).toBe('80');
    expect(spokenNumber(97.5)).toBe('97 and a half');
    expect(spokenNumber(21.25)).toBe('21.25');
    expect(spokenNumber(0.5)).toBe('0.5');
  });

  it('every load says its unit and convention (kg and lb)', () => {
    expect(spokenLoad(kg(80), 'total')).toBe('80 kilos');
    expect(spokenLoad(lb(185), 'total')).toBe('185 pounds');
    expect(spokenLoad(kg(1), 'total')).toBe('1 kilo');
    expect(spokenLoad(kg(22.5, 'per_hand'), 'per_hand', { kind: 'dumbbells' })).toBe('22 and a half kilos each');
    expect(spokenLoad(lb(50, 'per_hand'), 'per_hand', { kind: 'dumbbells' })).toBe('50 pounds each');
    expect(spokenLoad(kg(45, 'stack'), 'stack', { kind: 'weight_stack' })).toBe('45 kilos on the stack');
    expect(spokenLoad(kg(40, 'added'), 'added', { kind: 'plate_loaded_machine' })).toBe('40 kilos of plates');
    expect(spokenLoad(kg(20, 'assistance'), 'assistance', { kind: 'assisted_stack' })).toBe('20 kilos of assistance');
    expect(spokenLoad(kg(10, 'added'), 'added', { kind: 'bodyweight_station' })).toBe('bodyweight plus 10 kilos');
    expect(spokenLoad(kg(0, 'added'), 'added', { kind: 'bodyweight_station' })).toBe('bodyweight');
    expect(spokenLoad(null, 'added', { kind: 'bodyweight_station' })).toBe('bodyweight');
    expect(spokenLoad(null, 'bodyweight')).toBe('bodyweight');
    expect(spokenLoad(null, 'total')).toBeNull();
  });

  it('durations follow rest-state §5', () => {
    expect(spokenDuration(10)).toBe('10 seconds');
    expect(spokenDuration(1)).toBe('1 second');
    expect(spokenDuration(90)).toBe('90 seconds');
    expect(spokenDuration(180)).toBe('3 minutes');
    expect(spokenDuration(150)).toBe('2 minutes 30');
    expect(spokenDuration(1200)).toBe('20 minutes');
    expect(spokenDuration(3600)).toBe('1 hour');
    expect(spokenDuration(4200)).toBe('1 hour 10 minutes');
  });
});

describe('cue text', () => {
  it('timer-only cues never name the set', () => {
    expect(cueText({ kind: 'warning', seconds: 10 }, 'timer')).toBe('10 seconds.');
    expect(cueText({ kind: 'rest_end', next: set() }, 'timer')).toBe('Rest done.');
    expect(cueText({ kind: 'work_end' }, 'timer_and_set')).toBe('Time.');
  });

  it('timer and set details adds the next set: number, exercise, load in words, reps', () => {
    expect(cueText({ kind: 'rest_end', next: set() }, 'timer_and_set')).toBe('Rest done. Set 2, Bench press, 80 kilos for 8.');
    expect(cueText({ kind: 'rest_end', next: set({ reps: { min: 6, max: 8 }, load: lb(185) }) }, 'timer_and_set')).toBe('Rest done. Set 2, Bench press, 185 pounds for 6 to 8.');
    // No next set (the last one): just the timer.
    expect(cueText({ kind: 'rest_end', next: null }, 'timer_and_set')).toBe('Rest done.');
  });

  it('warm-ups say warm-up; per-hand says each; unilateral says each side; assisted and bodyweight + added', () => {
    expect(spokenSetDetail(set({ setType: 'warmup', load: kg(40), reps: { min: 10, max: 10 } }))).toBe('Warm-up, Bench press, 40 kilos for 10');
    expect(spokenSetDetail(set({ exerciseName: 'Incline dumbbell press', convention: 'per_hand', equipment: { kind: 'dumbbells' }, load: kg(30, 'per_hand') }))).toBe('Set 2, Incline dumbbell press, 30 kilos each for 8');
    expect(spokenSetDetail(set({ exerciseName: 'Split squat', unilateral: true, convention: 'per_hand', load: kg(20, 'per_hand'), equipment: { kind: 'dumbbells' } }))).toBe('Set 2, Split squat, 20 kilos each for 8 each side');
    expect(spokenSetDetail(set({ exerciseName: 'Assisted pull-up', convention: 'assistance', equipment: { kind: 'assisted_stack' }, load: kg(25, 'assistance'), reps: { min: 6, max: 8 } }))).toBe('Set 2, Assisted pull-up, 25 kilos of assistance for 6 to 8');
    expect(spokenSetDetail(set({ exerciseName: 'Dip', convention: 'added', equipment: { kind: 'bodyweight_station' }, load: kg(10, 'added') }))).toBe('Set 2, Dip, bodyweight plus 10 kilos for 8');
    expect(spokenSetDetail(set({ exerciseName: 'Push-up', convention: 'bodyweight', equipment: null, load: null, reps: { min: 12, max: 12 } }))).toBe('Set 2, Push-up, 12 reps');
    // No load anywhere on a loaded exercise: left out, never phrased as a bodyweight set (review B1).
    expect(spokenSetDetail(set({ load: null }))).toBe('Set 2, Bench press, for 8');
    expect(spokenSetDetail(set({ side: 'left', exerciseName: 'Single-arm row', convention: 'per_hand', load: kg(30, 'per_hand') }))).toBe('Set 2, left side, Single-arm row, 30 kilos each for 8');
  });

  it('timed and cardio sets say "for 20 minutes"; distance sets say metres', () => {
    expect(spokenSetDetail(set({ exerciseName: 'Rowing', measurement: 'duration', convention: 'bodyweight', equipment: null, load: null, reps: null, durationS: 1200, number: 1 }))).toBe('Set 1, Rowing, for 20 minutes');
    expect(spokenSetDetail(set({ exerciseName: 'Plank', measurement: 'duration', convention: 'bodyweight', load: null, reps: null, durationS: 45, number: 3 }))).toBe('Set 3, Plank, for 45 seconds');
    expect(spokenSetDetail(set({ exerciseName: 'Farmer carry', measurement: 'distance', convention: 'per_hand', load: kg(32, 'per_hand'), reps: null, distanceM: 40 }))).toBe('Set 2, Farmer carry, 32 kilos each for 40 metres');
    expect(spokenSetDetail(set({ exerciseName: 'Sled push', measurement: 'distance', convention: 'added', equipment: null, load: kg(0, 'added'), reps: null, distanceM: 1500 }))).toBe('Set 2, Sled push, for 1 and a half kilometres');
  });

  it('a chosen side is said once; "each side" only when both sides are done (review N1)', () => {
    const uni = { exerciseName: 'Split squat', convention: 'per_hand' as const, equipment: { kind: 'dumbbells' as const }, load: kg(20, 'per_hand'), unilateral: true };
    expect(spokenSetDetail(set({ ...uni, side: 'left' }))).toBe('Set 2, left side, Split squat, 20 kilos each for 8');
    expect(spokenSetDetail(set({ ...uni, side: null }))).toBe('Set 2, Split squat, 20 kilos each for 8 each side');
  });

  it('reads the next set from a live workout: number in its block, the card’s values', () => {
    const { state } = startFixture();
    const [warm] = setsFor(state, BENCH);
    if (!warm) throw new Error('no warm-up');
    const s = apply(state, logCmd(warm.id, values(kg(60), 10), 30));
    const next = spokenSetOf(s, s.session.activeSetId);
    expect(next).not.toBeNull();
    // The card's prefill: target load, top of the rep range.
    expect(cueText({ kind: 'rest_end', next }, 'timer_and_set')).toBe('Rest done. Set 2, Bench press, 100 kilos for 8.');
    expect(spokenSetOf(s, 'missing')).toBeNull();
    expect(spokenSetOf(s, null)).toBeNull();
    // The stack exercise and the timed one read their own conventions.
    const [row1] = setsFor(s, ROW);
    expect(spokenSetDetail(spokenSetOf(s, row1?.id ?? null) ?? set())).toBe('Set 1, Cable row, 50 kilos on the stack for 12');
    const [hang] = setsFor(s, HANG);
    expect(spokenSetDetail(spokenSetOf(s, hang?.id ?? null) ?? set())).toMatch(/^Set 1, Dead hang, for \d+ (seconds|minutes?)/);
  });

  it('a draft saved during the rest wins over the target, as on the card (review B1)', () => {
    const { state } = startFixture();
    const [warm, b1] = setsFor(state, BENCH);
    if (!warm || !b1) throw new Error('fixture');
    let s = apply(state, logCmd(warm.id, values(kg(60), 10), 30));
    s = apply(s, { type: 'save_draft', at: at(40), setId: b1.id, values: values(kg(85), 8) });
    expect(s.session.activeSetId).toBe(b1.id);
    expect(cueText({ kind: 'rest_end', next: spokenSetOf(s, b1.id) }, 'timer_and_set')).toBe('Rest done. Set 2, Bench press, 85 kilos for 8.');
  });

  it('a partial target (load open) takes the load from history, as the card does; none anywhere → left out (review B1)', () => {
    const { state } = startFixture();
    const [warm, b1, b2] = setsFor(state, BENCH);
    if (!warm || !b1 || !b2) throw new Error('fixture');
    const open = { ...state, sets: state.sets.map((x) => (x.id === b2.id ? { ...x, planned: { ...x.planned, load: null, reps: { min: 8, max: 8 } } } : x)) };
    // Nothing logged here yet and no history: the load is left out, not "8 reps".
    expect(spokenSetDetail(spokenSetOf(open, b2.id) ?? set())).toBe('Set 3, Bench press, for 8');
    // The last comparable session fills it.
    expect(spokenSetDetail(spokenSetOf(open, b2.id, [{ index: b2.index, values: values(kg(92.5), 8) }]) ?? set())).toBe('Set 3, Bench press, 92 and a half kilos for 8');
    // This session's last set wins over history, as on the card.
    const logged = apply(open, logCmd(b1.id, values(kg(95), 8), 30));
    expect(spokenSetDetail(spokenSetOf(logged, b2.id, [{ index: b2.index, values: values(kg(92.5), 8) }]) ?? set())).toBe('Set 3, Bench press, 95 kilos for 8');
  });
});

describe('coach replies read aloud', () => {
  it('speaks the first two sentences, capped', () => {
    expect(spokenReplyText('Good work. Next time try 82.5 kg for 8. Keep the rest at 3 minutes. Sleep well.')).toBe('Good work. Next time try 82 and a half kilos for 8.');
    const long = `${'Very long words '.repeat(40)}end.`;
    const out = spokenReplyText(long);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('.')).toBe(true);
  });

  it('says numbers naturally: units, × reps, ranges, short times, percent, BW', () => {
    expect(speakableText('Do **100 kg × 8**, then 3 × 10 at 6–8 RPE.')).toBe('Do 100 kilos for 8, then 3 by 10 at 6 to 8 RPE.');
    expect(speakableText('22.5 kg each x 10')).toBe('22 and a half kilos each for 10');
    expect(speakableText('Go +2.5 lb and rest 2:30.')).toBe('Go plus 2 and a half pounds and rest 2 minutes 30.');
    expect(speakableText('Your e1RM is up 5% · BW + 10 kg')).toBe('Your estimated 1 rep max is up 5 percent, bodyweight plus 10 kilos');
    expect(speakableText('- one\n- two')).toBe('one two');
  });

  it('never splits a decimal or e.g. into sentences; empty stays empty', () => {
    expect(spokenReplyText('Try 2.25 kg plates, e.g. the small ones. Then rest. Then go.')).toBe('Try 2.25 kilos plates, e.g. the small ones. Then rest.');
    expect(spokenReplyText('   ')).toBe('');
  });
});
