import { describe, expect, it } from 'vitest';

import { buildActiveSetView, NBSP, plateBreakdownLine, startWorkout, summaryHighlight, warmUpRamp, warmUpText, type HistorySession } from '../src/index';
import { at, barbell, dumbbells, GYM, id, idGen, kg, plateMachine, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, BENCH, exercises, logCmd, setsFor, startFixture } from './session-fixture';

const plain = (s: string | null) => (s ?? '').replaceAll(NBSP, ' ');
const bar = barbell({ plates: [25, 20, 15, 10, 5, 2.5, 1.25].map((mass) => ({ mass, count: 4 })) });

describe('plate breakdown (critic #4, brief §4 buildPlateSetup)', () => {
  it('shows the bar and the plates per side; nothing for loads it can’t make or non-plate equipment', () => {
    expect(plain(plateBreakdownLine(kg(102.5), bar))).toBe('20 bar + 25 + 15 + 1.25 / side');
    expect(plain(plateBreakdownLine(kg(20), bar))).toBe('Just the bar (20 kg)');
    expect(plateBreakdownLine(kg(101), bar)).toBeNull();
    expect(plateBreakdownLine(kg(20, 'per_hand'), dumbbells())).toBeNull();
    expect(plateBreakdownLine({ value: 100, unit: 'lb', convention: 'total' }, bar)).toBeNull();
    const leg = plateMachine();
    const r = plateBreakdownLine(kg(40, 'added'), leg);
    expect(r === null || plain(r).endsWith('/ side') || plain(r).endsWith('on the horn')).toBe(true);
  });

  it('is on the set card for the load that Log will save', () => {
    const s = startFixture().state;
    const v = buildActiveSetView({ aggregate: s, nowMs: Date.parse(at(1).utc), gymName: null, previous: {}, painFlagged: new Set(), edits: null });
    // The first bench set is the routine's 60 kg warm-up.
    expect(plain(v.focus?.plateLine ?? null)).toMatch(/^20 bar \+ .* \/ side$/);
  });
});

describe('warm-up ramp (deterministic, labelled, skippable)', () => {
  it('the shared planner’s WU4 ladder: bar × 5, then 40/60/80 % rounded down to this bar; never at or above the working load', () => {
    const steps = warmUpRamp(kg(100), bar);
    expect(steps).toEqual([
      { load: 20, reps: 5 },
      { load: 40, reps: 5 },
      { load: 60, reps: 3 },
      { load: 80, reps: 2 },
    ]);
    expect(plain(warmUpText(steps, bar))).toBe('bar × 5 · 40 × 5 · 60 × 3 · 80 × 2 (kg)');
    // The set's reps pick the band (WU3): 3 reps → the 1–3 ladder; 12 reps → WU5's two steps, no bar.
    expect(warmUpRamp(kg(100), bar, 3).map((x) => [x.load, x.reps])).toEqual([[20, 5], [40, 5], [60, 3], [75, 2], [87.5, 1]]);
    expect(warmUpRamp(kg(100), bar, 12).map((x) => [x.load, x.reps])).toEqual([[50, 8], [80, 5]]);
    expect(warmUpRamp(kg(40), bar).map((x) => x.load)).toEqual([20, 22.5, 30]);
    expect(warmUpRamp(kg(20), bar)).toEqual([]);
    expect(warmUpRamp(kg(30, 'per_hand'), dumbbells())).toEqual([]);
  });

  it('shows only on the first working set of the first barbell exercise, with no warm-ups planned or logged', () => {
    // Routine without warm-ups: bench 2 × 100.
    const r = routine([routineExercise(900, { exerciseId: BENCH, equipmentId: bar.id, order: 0, setTemplates: [template(9001, { targetLoad: kg(100) }), template(9002, { targetLoad: kg(100) })] })]);
    let s = startWorkout({ opId: 's', owner: profile(), gymId: GYM, routine: r, exercises, gymEquipment: [bar], at: at(0), newId: idGen(95_000) }).aggregate;
    const view = () => buildActiveSetView({ aggregate: s, nowMs: Date.parse(at(1).utc), gymName: null, previous: {}, painFlagged: new Set(), edits: null });
    expect(plain(view().focus?.warmUp ?? null)).toBe('bar × 5 · 40 × 5 · 60 × 3 · 80 × 2 (kg)');
    const first = setsFor(s, BENCH)[0];
    s = apply(s, logCmd(first?.id ?? '', values(kg(100), 5), 10));
    expect(view().focus?.warmUp).toBeNull();
    // A plan with its own warm-ups never gets the suggestion.
    expect(buildActiveSetView({ aggregate: startFixture().state, nowMs: 0, gymName: null, previous: {}, painFlagged: new Set(), edits: null }).focus?.warmUp ?? null).toBeNull();
  });
});

describe('summary highlight (like-for-like, never invented)', () => {
  function finishedBench(sets: [number, number][]) {
    const r = routine([routineExercise(910, { exerciseId: BENCH, equipmentId: bar.id, order: 0, setTemplates: sets.map((_, i) => template(9100 + i, { targetLoad: kg(100) })) })]);
    let s = startWorkout({ opId: 's2', owner: profile(), gymId: GYM, routine: r, exercises, gymEquipment: [bar], at: at(0), newId: idGen(96_000) }).aggregate;
    for (const [i, [load, reps]] of sets.entries()) s = apply(s, logCmd(setsFor(s, BENCH)[i]?.id ?? '', values(kg(load), reps), 10 + i * 100));
    return apply(s, { type: 'finish', at: at(1000), opId: 'f', expectedVersion: s.session.version, endedAt: null });
  }
  const hist = (sets: [number, number][], equipmentId = bar.id): HistorySession => ({ sessionId: id(990), performedAtUtc: at(-86_400).utc, equipmentId, gymId: GYM, imported: false, sets: sets.map(([load, reps]) => ({ setType: 'working' as const, side: null, load: kg(load), reps, rpe: null, rir: null })) });

  it('heaviest set, then most reps at a load done before, then most volume', () => {
    const s = finishedBench([[102.5, 6], [100, 6]]);
    expect(plain(summaryHighlight(s, { [BENCH]: [hist([[100, 6], [100, 6]])] }))).toBe('Heaviest Bench press set on Olympic bar: 102.5 kg × 6');
    const reps = finishedBench([[100, 8], [100, 6]]);
    expect(plain(summaryHighlight(reps, { [BENCH]: [hist([[100, 7], [100, 6]])] }))).toBe('Most reps at 100 kg on Bench press on Olympic bar: 8');
    const vol = finishedBench([[100, 6], [100, 6], [100, 6]]);
    expect(plain(summaryHighlight(vol, { [BENCH]: [hist([[100, 6], [100, 6]])] }))).toBe('Most Bench press volume on Olympic bar: 1800 kg (working sets)');
  });

  it('nothing without earlier comparable history, or on other equipment, or when nothing improved', () => {
    const s = finishedBench([[102.5, 6]]);
    expect(summaryHighlight(s, {})).toBeNull();
    expect(summaryHighlight(s, { [BENCH]: [hist([[90, 6]], id(555))] })).toBeNull();
    expect(summaryHighlight(finishedBench([[100, 5]]), { [BENCH]: [hist([[100, 6]])] })).toBeNull();
  });
});
