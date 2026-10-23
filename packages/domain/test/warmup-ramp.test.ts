import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, SessionAggregate, SetTemplate } from '@fizz/schemas';
import { buildActiveSetView, buildWorkoutTableView, NBSP, prefillDraft, startWorkout, type ActiveViewInput, type PreviousSession, type TableBlock, type TableRow } from '../src/index';
import { warmupRampLoads } from '../src/session/warmup-ramp';
import { assisted, at, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, logCmd, setsFor } from './session-fixture';

/**
 * Every row shows its load (23 Oct, Ben's iPhone): a coach-built workout
 * stores its warm-ups as reps only, so they showed `—` and the open one
 * prefilled the working weight (`Log 35 kg each × 8` on a warm-up). A
 * pending row now shows what it would prefill as the open row: a warm-up's
 * ramp to the working load, a working set's history. Nothing is written.
 */

const DSP = id(700);
const RACK = (over: Partial<Extract<EquipmentInstance, { kind: 'dumbbells' }>> = {}) => dumbbells({ loads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40], ...over });

function start(working: SetTemplate['targetLoad'], o: { warmups?: number; eq?: EquipmentInstance; convention?: 'per_hand' | 'assistance' } = {}): SessionAggregate {
  const eq = o.eq ?? RACK();
  const ex = exercise(700, 'Dumbbell shoulder press', { compatibleEquipment: [eq.kind], defaultLoadConvention: o.convention ?? 'per_hand' });
  const warm = Array.from({ length: o.warmups ?? 3 }, (_, i) => template(7010 + i, { setType: 'warmup', targetReps: { min: 5, max: 5 } }));
  const work = [7020, 7021].map((n) => template(n, { targetLoad: working, targetReps: { min: 6, max: 10 }, targetRpe: 9 }));
  return startWorkout({
    opId: 'start',
    owner: profile(),
    gymId: GYM,
    routine: routine([routineExercise(710, { exerciseId: DSP, equipmentId: eq.id, order: 0, setTemplates: [...warm, ...work] })]),
    exercises: new Map([[DSP, ex]]),
    gymEquipment: [eq],
    at: at(0),
    newId: idGen(72_000),
  }).aggregate;
}

const previous = (s: SessionAggregate, load: number): ActiveViewInput['previous'] => {
  const ex = s.exercises[0];
  const prev: PreviousSession = { sessionId: 'last', performedAtUtc: '2026-10-16T08:00:00.000Z', gymId: GYM, imported: false, sets: [0, 1].map((index) => ({ index, values: values(kg(load, 'per_hand'), 8) })) };
  return ex === undefined ? {} : { [ex.id]: prev };
};

const input = (aggregate: SessionAggregate, prev: ActiveViewInput['previous'] = {}): ActiveViewInput => ({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: prev, painFlagged: new Set(), edits: null });

function rowsOf(s: SessionAggregate, prev: ActiveViewInput['previous'] = {}): TableRow[] {
  return buildWorkoutTableView(input(s, prev)).blocks.flatMap((b: TableBlock) => (b.kind === 'exercise' ? b.card.rows : b.superset.members.flatMap((m) => m.rows)));
}
const loads = (s: SessionAggregate, prev: ActiveViewInput['previous'] = {}) => rowsOf(s, prev).map((r) => [r.state, r.setType, (r.cells.load ?? '').replaceAll(NBSP, ' ')]);
const select = (s: SessionAggregate, setId: string) => apply(s, { type: 'set_active_set', at: at(5), opId: `sel-${setId}`, setId, expectedVersion: s.session.version });

describe('warm-ups with no load ramp to the working load (23 Oct)', () => {
  it('3 warm-ups before 35 kg each: every row shows a load, lightest first, below the working load; the open warm-up logs its ramp load', () => {
    const s = start(kg(35, 'per_hand'));
    expect(loads(s)).toEqual([
      ['open', 'warmup', '7.5'],
      ['pending', 'warmup', '17.5'],
      ['pending', 'warmup', '25'],
      ['pending', 'working', '35'],
      ['pending', 'working', '35'],
    ]);
    // Never the working weight on a warm-up (it was `Log 35 kg each × 5`).
    const v = buildActiveSetView(input(s, previous(s, 35)));
    expect(v.primary.label.replaceAll(NBSP, ' ')).toBe('Log 7.5 kg each × 5');
    // Prefill only: nothing stored changes.
    expect(setsFor(s, DSP).filter((x) => x.setType === 'warmup').every((x) => x.planned.load === null && x.draft === null)).toBe(true);
  });

  it('a row keeps its load after it stops being current (select another row), and a logged row shows what was logged', () => {
    let s = start(kg(35, 'per_hand'));
    const [w1, w2, w3] = setsFor(s, DSP);
    s = select(s, w3?.id ?? '');
    expect(loads(s).map((r) => r[2])).toEqual(['7.5', '17.5', '25', '35', '35']);
    expect(loads(s)[2]?.[0]).toBe('open');
    // Ben logs warm-up 1 heavier than the ramp: the logged value shows, the rest re-ramp around it, still under 35.
    s = apply(s, logCmd(w1?.id ?? '', values(kg(20, 'per_hand'), 5), 20));
    const after = loads(s);
    expect(after[0]).toEqual(['done', 'warmup', '20']);
    const rest = after.slice(1, 3).map((r) => Number(r[2]));
    expect(rest.every((x) => x > 0 && x < 35)).toBe(true);
    expect(rest[0]).toBeLessThanOrEqual(rest[1] ?? 0);
    expect(w2).toBeDefined();
  });

  it('working sets with no target show the history the open row prefills (not `—`), and the warm-ups ramp to it', () => {
    const s = start(null);
    const prev = previous(s, 35);
    expect(loads(s, prev).map((r) => r[2])).toEqual(['7.5', '17.5', '25', '35', '35']);
    // No history and no target: honest `—` everywhere, no invented loads.
    expect(loads(s).map((r) => r[2])).toEqual(['—', '—', '—', '—', '—']);
  });

  it('equipment steps and minimum: the ramp stays on the rack (rule 4), rounded down, never invented below the lightest dumbbell', () => {
    const s = start(kg(30, 'per_hand'), { eq: RACK({ loads: [10, 20, 30] }) });
    // 3 warm-ups, only two loads fit below 30 on this rack: the first stays empty rather than inventing one.
    expect(loads(s).map((r) => r[2])).toEqual(['—', '10', '20', '30', '30']);
  });

  it('lb racks ramp in lb', () => {
    const s = start(lb(50, 'per_hand'), { eq: RACK({ unit: 'lb', loads: [10, 15, 20, 25, 30, 35, 40, 45, 50] }), warmups: 2 });
    const r = loads(s).map((x) => x[2]);
    expect(r.slice(0, 2).map(Number).every((x) => x >= 10 && x < 50)).toBe(true);
    expect(r.slice(2)).toEqual(['50', '50']);
  });

  it('assisted machines never get a warm-up ramp (less assistance is harder)', () => {
    const eq = assisted();
    const s = start({ value: 30, unit: eq.unit, convention: 'assistance' }, { eq, convention: 'assistance' });
    const ex = s.exercises[0];
    expect(ex === undefined ? null : warmupRampLoads(s, ex.id, () => ({ value: 30, unit: eq.unit, convention: 'assistance' })).size).toBe(0);
  });

  it('a warm-up prefill never copies a working set’s load from history or this session', () => {
    const s = start(null, { warmups: 1 });
    const [w] = setsFor(s, DSP);
    const ex = s.exercises[0];
    // No working target and no history: the warm-up stays empty (it used to copy last time's 35).
    expect(prefillDraft(s, w?.id ?? '', []).values.load).toBeNull();
    expect(prefillDraft(s, w?.id ?? '', previous(s, 35)[ex?.id ?? '']?.sets ?? []).values.load).toEqual(kg(17.5, 'per_hand'));
  });
});
