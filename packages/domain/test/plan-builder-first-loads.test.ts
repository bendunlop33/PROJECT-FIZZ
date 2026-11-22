import { describe, expect, it } from 'vitest';
import type { Exercise, PainFlag } from '@fizz/schemas';
import { applyPlan, buildPlanFromAnswers, catalogueExerciseId, pbNewPlanDraft, planDayRows, planFirstLoads, currentPlanVersion, type HistorySession, type SubstituteContext } from '../src/index';
import { exercise, OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

const nowAt = { utc: new Date(NOW).toISOString(), tz: TZ };
const BENCH_ID = catalogueExerciseId('barbell-bench-press');
const BENCH: Exercise = { ...exercise(900, 'Bench press', { catalogueKey: 'barbell-bench-press' }), id: BENCH_ID };

function applied() {
  const a = answers();
  const plan = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  const draft = pbNewPlanDraft({ plan, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-00000000c001', at: nowAt });
  const r = applyPlan(draft, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: '00000000-0000-4000-8000-00000000c002', at: nowAt, live: [] });
  if (r.kind !== 'write') throw new Error(r.kind);
  const routine = r.create.find((x) => x.exercises.some((e) => e.exerciseId === BENCH_ID));
  if (routine === undefined) throw new Error('no bench day');
  return { plan: r.next, routine };
}

const sub = (painFlags: PainFlag[] = []): SubstituteContext => ({ ownerId: OWNER, unit: 'kg', gym: { id: '00000000-0000-4000-8000-0000000000f1', name: 'Gym', equipment: [] }, knownEquipment: new Map(), painFlags, sessionPain: { active: false, reportedAtUtc: null }, at: nowAt });

describe('a builder plan’s first workout', () => {
  it('takes the plan’s week-1 loads as `plan` targets', () => {
    const { plan, routine } = applied();
    const loads = planFirstLoads({ routine, plan, exercises: new Map([[BENCH_ID, BENCH]]), histories: new Map(), substitute: sub(), nowMs: NOW + 60_000 });
    const row = [...loads.values()].find((v) => v.exerciseId === BENCH_ID);
    const top = row?.sets.find((s) => s !== null);
    expect(top?.load).toEqual({ value: 100, unit: 'kg', convention: 'total' });
    expect(top?.source).toBeUndefined();
    expect(top?.provenance?.source).toBe('plan');
  });

  it('not when the movement is flagged for pain (rule 9)', () => {
    const { plan, routine } = applied();
    const flag = { id: '00000000-0000-4000-8000-00000000c010', ownerId: OWNER, version: 1, createdAtUtc: nowAt.utc, updatedAtUtc: nowAt.utc, exerciseId: BENCH_ID, exerciseName: 'Bench press', area: 'shoulder', source: 'workout', checkInId: null, reportedAt: nowAt, status: 'active' } as unknown as PainFlag;
    const loads = planFirstLoads({ routine, plan, exercises: new Map([[BENCH_ID, BENCH]]), histories: new Map(), substitute: sub([flag]), nowMs: NOW + 60_000 });
    expect([...loads.values()].some((v) => v.exerciseId === BENCH_ID)).toBe(false);
  });

  it('not once Ben has done it since the plan was built (his newer sets win)', () => {
    const { plan, routine } = applied();
    const newer = { sessionId: '00000000-0000-4000-8000-00000000c020', performedAtUtc: new Date(NOW + 3_600_000).toISOString(), equipmentId: null, gymId: null, imported: false, sets: [] } as HistorySession;
    const loads = planFirstLoads({ routine, plan, exercises: new Map([[BENCH_ID, BENCH]]), histories: new Map([[BENCH_ID, [newer]]]), substitute: sub(), nowMs: NOW + 7_200_000 });
    expect([...loads.values()].some((v) => v.exerciseId === BENCH_ID)).toBe(false);
  });

  it('the day view shows est. on an estimated load', () => {
    const a = answers();
    const plan = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: (k) => (k === 'dumbbell-seated-shoulder-press' ? null : HISTORY_OF(k)), nowMs: NOW });
    const draft = pbNewPlanDraft({ plan, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-00000000c003', at: nowAt });
    const day = currentPlanVersion(draft).days[0];
    if (day === undefined) throw new Error('no day');
    const rows = planDayRows(day, (id) => (id === catalogueExerciseId('dumbbell-seated-shoulder-press') ? { name: 'DB shoulder press', defaultLoadConvention: 'per_hand' } : null));
    expect(rows[0]?.estimate).toBe(true);
  });
});
