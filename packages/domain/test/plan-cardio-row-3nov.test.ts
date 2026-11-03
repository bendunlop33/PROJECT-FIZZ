import { describe, expect, it } from 'vitest';

import type { DraftSlot, RoutineExercise, SetTemplate } from '@fizz/schemas';

import { applyPlanDayEdit, buildPlanFromAnswers, pbBlockView, pbPickedWeekLine, pbPlanVersion, pbRowLine, pbSlotIsTimed, pbStartReps, planDayEditPreview, planRowIsTimed, timedTargetText, type PlanKit } from '../src/index';
import { BAR, DB, HISTORY_OF, KIT_OF, NOW, STACK, answers } from './plan-builder-fixture';

/**
 * (Ben, 3 Nov, from his iPhone) Library › Plan › Legs A read `Exercise bike 1 × 12 BW` after the coach added an 8-minute
 * bike first on leg days. The 8 minutes were stored (the slot's `durationS` 480); the week view read the slot as a
 * bodyweight accessory: reps defaulted to 10 and double progression added a rep a week (12 by week 3), and a slot with
 * no load and no item reads `BW`. A cardio or timed row now reads its stored time every week (`8 min`, `· Warm-up`),
 * never reps or `BW`. Made-up fixtures.
 */

const TZ = 'Europe/London';
const at = { utc: '2026-10-22T12:00:00.000Z', tz: TZ } as const;
const BIKE = 'ex-bike';

function bikeSlot(over: Partial<DraftSlot> = {}, durationS: number | null = 480, distanceM?: number, sets = 1): DraftSlot {
  return {
    slotKey: '00000000-0000-4000-8000-0000000b1e01',
    exerciseId: BIKE,
    catalogueId: 'exercise-bike',
    order: -1,
    main: false,
    supersetGroup: null,
    setTemplates: Array.from({ length: sets }, () => ({ setType: 'working' as const, reps: null, durationS, ...(distanceM === undefined ? {} : { distanceM }), targetRpe: null, restS: null })),
    checkedOn: null,
    ...over,
  };
}

describe('a cardio slot in the plan’s weeks (pbBlockView)', () => {
  const a = answers({ split: 'ppl', sessions: 3, days: [0, 2, 4], lifts: { 'barbell-back-squat': { kind: 'confirmed' } } });
  const plan = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  const version = pbPlanVersion({ plan, answers: a, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v', opId: '00000000-0000-4000-8000-00000000c301', at, planId: 'plan-3nov' });
  const builder = { answers: a, startReps: pbStartReps(plan, 'plan-3nov') };
  const kits = new Map<string, PlanKit>([BAR, DB, STACK].map((k) => [k.equipmentId, k]));
  const kitOf = (s: DraftSlot): PlanKit | null => kits.get(s.checkedOn?.equipmentId ?? '') ?? null;
  const block = { week: 2, of: 6, deload: false, done: false, mondays: ['2026-10-26', '2026-11-02'], daysDone: [[0, 1, 2], []] };
  const nameOf = (id: string) => (id === BIKE ? 'Exercise bike' : id);
  /** The leg day with the bike first (as Apply of `propose_plan_add` leaves the plan's week). */
  const withBike = (slot: DraftSlot) => ({ days: version.days.map((d, i) => (i === 2 ? { ...d, plan: { ...d.plan, slots: [slot, ...d.plan.slots] } } : d)) });

  it('8 min first in every week 1–6 (the deload week too): never `1 × 12`, never `BW`; Warm-up when marked', () => {
    const v = withBike(bikeSlot({ warmup: true }));
    for (let wk = 1; wk <= 6; wk += 1) {
      const view = pbBlockView({ version: v, builder, block, viewed: wk, kitOf, nameOf });
      const row = view.days[2]?.rows[0];
      expect(row?.name, `week ${String(wk)}`).toBe('Exercise bike');
      expect(row?.line, `week ${String(wk)}`).toBe('8 min');
      expect(row?.kg, `week ${String(wk)}`).toBeNull();
      expect(row?.timed).toBe(true);
      expect(row?.warmup).toBe(true);
      expect(pbRowLine(row ?? { line: '' })).toBe('8 min · Warm-up');
      expect(row?.line).not.toMatch(/×|BW/);
      // The lifts still progress as before.
      expect(view.days[2]?.rows.slice(1).every((r) => r.timed === undefined)).toBe(true);
    }
  });

  it('weekOf (a running plan’s own weeks): the stored minutes survive every week’s days', () => {
    const v = withBike(bikeSlot());
    const views = Array.from({ length: 6 }, (_, i) => pbBlockView({ version, builder, block, viewed: i + 1, kitOf, nameOf, weekOf: () => ({ days: v.days }) }));
    expect(views.map((x) => x.days[2]?.rows[0]?.line)).toEqual(['8 min', '8 min', '8 min', '8 min', '8 min', '8 min']);
    expect(views.map((x) => pbRowLine(x.days[2]?.rows[0] ?? { line: '' }))).toEqual(Array(6).fill('8 min'));
  });

  it('distance, several bouts and seconds read as stored; a lift is never read as timed', () => {
    const view = (s: DraftSlot) => pbBlockView({ version: withBike(s), builder, block, viewed: 3, kitOf, nameOf }).days[2]?.rows[0]?.line;
    expect(view(bikeSlot({}, 600, 4000))).toBe('10 min · 4,000\u00a0m');
    expect(view(bikeSlot({}, 90, undefined, 4))).toBe('4 × 1:30');
    expect(view(bikeSlot({}, null, 2000))).toBe('2,000\u00a0m');
    const squat = version.days[2]?.plan.slots[0];
    expect(squat === undefined ? null : pbSlotIsTimed(squat)).toBe(false);
  });
});

describe('timedTargetText', () => {
  it('whole minutes read `N min`; seconds read m:ss; bouts and distance', () => {
    expect(timedTargetText(1, 480, null)).toBe('8 min');
    expect(timedTargetText(1, 45, null)).toBe('0:45');
    expect(timedTargetText(3, 600, null)).toBe('3 × 10 min');
    expect(timedTargetText(1, 1200, 5000)).toBe('20 min · 5,000\u00a0m');
    expect(timedTargetText(1, null, null)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// The coach's plan-day edit on a cardio row (propose_plan_day_edit: minutes, warm-up, first)

const st = (over: Partial<SetTemplate>): SetTemplate => ({ id: 'set', setType: 'working', targetReps: null, targetLoad: null, targetRpe: null, targetRir: null, targetDurationS: null, restOverrideS: null, ...over });
const row = (id: string, exerciseId: string, order: number, templates: SetTemplate[], extra: Partial<RoutineExercise> = {}): RoutineExercise => ({ id, exerciseId, order, supersetGroup: null, setTemplates: templates, restBySetType: {}, notes: null, ...extra }) as unknown as RoutineExercise;
const squat = row('r-squat', 'ex-squat', 0, [st({ id: 's1', targetReps: { min: 6, max: 8 } }), st({ id: 's2', targetReps: { min: 6, max: 8 } })], { main: true });
const curl = row('r-curl', 'ex-curl', 1, [st({ id: 'c1', targetReps: { min: 10, max: 12 } })]);
const bike = row('r-bike', BIKE, 2, [st({ id: 'b1', targetDurationS: 720 })]);
const day = [squat, curl, bike];
const ask = (c: Partial<Parameters<typeof planDayEditPreview>[1]['changes'][number]>) => ({ order: null, changes: [{ exerciseId: BIKE, sets: null, reps: null, targetRpe: null, main: null, load: null, ...c }] });

describe('planDayEditPreview / applyPlanDayEdit: a cardio row’s minutes, place and warm-up mark', () => {
  it('12 min → 8 min, first, warm-up: one change, the order puts it first; the lifts are untouched', () => {
    const p = planDayEditPreview(day, ask({ durationS: 480, first: true, warmup: true }));
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.edit.order).toEqual(['r-bike', 'r-squat', 'r-curl']);
    expect(p.edit.rows).toEqual([{ rowId: 'r-bike', durationS: 480, warmup: true, first: true }]);
    const out = applyPlanDayEdit(day, p.edit, () => 'new-set');
    expect(out.map((r) => r.id)).toEqual(['r-bike', 'r-squat', 'r-curl']);
    expect(out[0]?.setTemplates.map((t) => [t.targetDurationS, t.targetReps])).toEqual([[480, null]]);
    expect(out[0]?.warmup).toBe(true);
    expect(out[1]).toEqual({ ...squat, order: 1 });
  });

  it('the mark comes off with warmup false; a distance is set; nothing changing is no_change', () => {
    const marked = [squat, curl, { ...bike, warmup: true as const }];
    const off = planDayEditPreview(marked, ask({ warmup: false }));
    if (off.kind !== 'ok') throw new Error(off.kind);
    expect('warmup' in (applyPlanDayEdit(marked, off.edit, () => 'x').find((r) => r.id === 'r-bike') ?? {})).toBe(false);
    const dist = planDayEditPreview(day, ask({ distanceM: 3000 }));
    if (dist.kind !== 'ok') throw new Error(dist.kind);
    expect(applyPlanDayEdit(day, dist.edit, () => 'x').find((r) => r.id === 'r-bike')?.setTemplates[0]?.targetDistanceM).toBe(3000);
    expect(planDayEditPreview(day, ask({ durationS: 720 })).kind).toBe('no_change');
    expect(planDayEditPreview([{ ...bike, order: 0 }, { ...squat, order: 1 }, { ...curl, order: 2 }], ask({ first: true })).kind).toBe('no_change');
  });

  it('a time or a warm-up mark on a lift is refused (never turns a lift into cardio); first never splits a superset', () => {
    expect(planDayEditPreview(day, { order: null, changes: [{ exerciseId: 'ex-curl', sets: null, reps: null, targetRpe: null, main: null, load: null, durationS: 300 }] })).toEqual({ kind: 'not_timed', exerciseIds: ['ex-curl'] });
    expect(planDayEditPreview(day, { order: null, changes: [{ exerciseId: 'ex-squat', sets: null, reps: null, targetRpe: null, main: null, load: null, warmup: true }] }).kind).toBe('not_timed');
    const paired = [squat, { ...curl, supersetGroup: 'A' }, { ...bike, supersetGroup: 'A' }];
    expect(planDayEditPreview(paired, ask({ first: true })).kind).toBe('splits_superset');
    expect(planRowIsTimed(bike)).toBe(true);
    expect(planRowIsTimed(curl)).toBe(false);
  });
});

describe('pbPickedWeekLine: a plan day opened from a picked week says which week and when', () => {
  const b = { week: 2, of: 6, done: false } as const;
  it('this week: null (the day shows today’s plan); next, later, done and deload weeks are named', () => {
    expect(pbPickedWeekLine(2, b, false)).toBeNull();
    expect(pbPickedWeekLine(3, b, false)).toBe('Week 3 of 6 · Next week');
    expect(pbPickedWeekLine(6, b, true)).toBe('Week 6 of 6 · Deload · In 4 weeks');
    expect(pbPickedWeekLine(1, b, false)).toBe('Week 1 of 6 · Done');
    expect(pbPickedWeekLine(2, { week: 1, of: 6, done: false, leadIn: { startsOn: '2026-11-09' } }, false)).toBe('Week 2 of 6 · In 2 weeks');
    expect(pbPickedWeekLine(1, { week: 1, of: 6, done: false, leadIn: { startsOn: '2026-11-09' } }, false)).toBe('Week 1 of 6 · Next week');
  });
});
