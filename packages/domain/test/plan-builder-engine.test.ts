import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlanDraftSchema } from '@fizz/schemas';
import {
  PB_BACKOFF_BAND,
  PB_CORE,
  PB_EX,
  PB_EXTRA_LIFTS,
  PB_CHECK_LIFTS,
  PB_GROUPS,
  PB_MAIN_A,
  PB_MAIN_ALT,
  PB_MAIN_B,
  PB_PREF_QUESTIONS,
  PB_SEC,
  PB_SIMILAR,
  applyPlan,
  buildPlanFromAnswers,
  catalogueExerciseId,
  chunks,
  currentPlanVersion,
  pbAtWeek,
  pbBackOff,
  pbDayName,
  pbDaysReady,
  pbDeloadWeeks,
  pbExpect,
  pbLiftStart,
  pbMainFocus,
  BACKOFF_BANDS,
  pbMainWeekOneLine,
  pbNeedsLiftCheck,
  pbNewPlanDraft,
  pbPlanDays,
  pbPrefScore,
  pbStrengthBalance,
  pbSuggestedSplit,
  pbTapSport,
  pbTogglePriority,
  pbWarmUp,
  pbWarmUpText,
  pbWithSessions,
  weeklySetsOf,
  type PbExercise,
  type PbHistory,
  type PbPlan,
  type PlanEngineInput,
  planWarmups,
  type PlanKit,
} from '../src/index';
import { ASSIST, BAR, DB, HISTORY_OF, HIST, KIT_OF, NOW, STACK, answers, kitFor } from './plan-builder-fixture';

const at = { utc: '2026-10-22T12:00:00.000Z', tz: 'Europe/London' } as const;

function build(patch: Partial<PlanEngineInput> = {}, a = answers()): PbPlan {
  return buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW, ...patch });
}

const mains = (p: PbPlan): PbExercise[] => p.days.flatMap((d) => d.exercises.filter((e) => e.role === 'main'));
const mainOf = (p: PbPlan, key: string): PbExercise | undefined => mains(p).find((e) => e.key === key);

describe('plan builder tables', () => {
  it('names only exercises the catalogue has', () => {
    const dir = fileURLToPath(new URL('../../catalogue/data/exercises/', import.meta.url));
    const have = new Set(readdirSync(dir).map((f) => f.replace(/\.json$/, '')));
    const keys = new Set<string>([
      ...Object.values(PB_EX).flatMap((l) => l.map((x) => x.key)),
      ...Object.values(PB_MAIN_A).flatMap((m) => (m === null ? [] : [m.key])),
      ...Object.values(PB_MAIN_B).map((m) => m.key),
      ...Object.entries(PB_MAIN_ALT).flatMap(([k, l]) => [k, ...l]),
      ...Object.keys(PB_SEC),
      ...Object.entries(PB_SIMILAR).flatMap(([k, l]) => [k, ...l.map((x) => x.from)]),
      ...PB_PREF_QUESTIONS.flatMap((q) => [...q.opts.flat(), ...q.other]),
      ...Object.values(PB_CORE),
      ...PB_CHECK_LIFTS,
      ...PB_EXTRA_LIFTS,
    ]);
    expect([...keys].filter((k) => !have.has(k))).toEqual([]);
  });

  it('chunks sets into exercises of 2–4', () => {
    expect(chunks(0)).toEqual([]);
    expect(chunks(1)).toEqual([2]);
    expect(chunks(4)).toEqual([4]);
    expect(chunks(7)).toEqual([4, 3]);
    expect(chunks(10)).toEqual([4, 3, 3]);
  });
});

describe('D6 week-1 loads (acceptance check 4)', () => {
  it('a stale squat not confirmed starts one step lighter: 115 / 107.5', () => {
    const p = build({}, answers({ split: 'ppl', sessions: 3, days: [0, 2, 4] }));
    const squat = mainOf(p, 'barbell-back-squat');
    expect(squat?.main?.light).toBe(true);
    expect(squat === undefined ? null : pbMainWeekOneLine(squat)).toBe('1 × 6 + 2 × 8 · 115 / 107.5');
  });

  it('confirmed with Still right it starts at full weight: 117.5 / 110', () => {
    const p = build({}, answers({ split: 'ppl', sessions: 3, days: [0, 2, 4], lifts: { 'barbell-back-squat': { kind: 'confirmed' } } }));
    const squat = mainOf(p, 'barbell-back-squat');
    expect(squat?.main?.light).toBe(false);
    expect(squat === undefined ? null : pbMainWeekOneLine(squat)).toBe('1 × 6 + 2 × 8 · 117.5 / 110');
  });

  it('a recent lift starts at its 6-rep estimate, never last weight + a step', () => {
    expect(pbLiftStart('barbell-bench-press', KIT_OF, HISTORY_OF, undefined, NOW)?.six).toBe(100);
    // Row 90 × 12 → 105 × 6 (§1a example).
    expect(pbLiftStart('barbell-bent-over-row', KIT_OF, HISTORY_OF, undefined, NOW)?.six).toBe(105);
  });

  it('an entered set replaces history and is not light', () => {
    const s = pbLiftStart('barbell-back-squat', KIT_OF, HISTORY_OF, { kind: 'entered', value: 130, unit: 'kg', reps: 6 }, NOW);
    expect(s).toMatchObject({ status: 'entered', six: 130, light: false, estimate: false, open: false });
  });

  it('no history: an estimate from the closest similar lift, est. and a step lighter', () => {
    const none = (k: string): PbHistory | null => (k === 'dumbbell-seated-shoulder-press' ? null : HISTORY_OF(k));
    const s = pbLiftStart('dumbbell-seated-shoulder-press', KIT_OF, none, undefined, NOW);
    expect(s?.status).toBe('estimated');
    expect(s?.estimate).toBe(true);
    expect(s?.light).toBe(true);
    expect(s?.from).toMatchObject({ kind: 'similar', fromKey: 'machine-shoulder-press' });
    // Machine 50 × 10 → e1RM 66.7 ÷ 2 ÷ 1.1 per hand = 30.3 → 6 reps ≈ 25.3 → 26 per hand.
    expect(s?.six).toBe(26);
    // Other lift: the OHP (stale) instead.
    const other = pbLiftStart('dumbbell-seated-shoulder-press', KIT_OF, none, { kind: 'similar', source: 1 }, NOW);
    expect(other?.from).toMatchObject({ kind: 'similar', fromKey: 'barbell-overhead-press' });
    expect(other?.open).toBe(false);
  });

  it('nothing to estimate from: no load, never invented (rule 6)', () => {
    const s = pbLiftStart('barbell-bench-press', KIT_OF, () => null, undefined, NOW);
    expect(s).toMatchObject({ status: 'none', six: null, open: true });
    const p = build({ historyOf: () => null });
    for (const e of mains(p)) if (e.main !== null) expect(e.main.top).toBeNull();
    for (const d of p.days) for (const e of d.exercises) if (e.role !== 'main') expect(e.load.kind === 'kg').toBe(false);
  });

  it('Check your lifts shows only when a main lift is stale or has no history', () => {
    const lifts = PB_CHECK_LIFTS.map((k) => pbLiftStart(k, KIT_OF, HISTORY_OF, undefined, NOW));
    expect(pbNeedsLiftCheck(lifts)).toBe(true);
    const fresh = (k: string): PbHistory | null => (HIST[k] === undefined ? null : { ...HIST[k], last: HIST[k].last === null ? null : { ...HIST[k].last, atUtc: '2026-10-20T10:00:00Z' } });
    expect(pbNeedsLiftCheck(PB_CHECK_LIFTS.map((k) => pbLiftStart(k, KIT_OF, fresh, undefined, NOW)))).toBe(false);
  });

  it('kg history on a lb bar: converted, then snapped to the lb kit', () => {
    const lb: PlanKit = { ...BAR, unit: 'lb', loads: Array.from({ length: 120 }, (_, i) => 45 + i * 5), barMass: 45 };
    const s = pbLiftStart('barbell-bench-press', (k) => (k === 'barbell-bench-press' ? lb : kitFor(k)), HISTORY_OF, undefined, NOW);
    // 100 kg = 220.5 lb × 6 → nearest 5 lb: 220.
    expect(s?.unit).toBe('lb');
    expect(s?.six).toBe(220);
  });
});

describe('D4 back-offs', () => {
  it('matches the spec examples', () => {
    expect(pbBackOff(BAR, 100, 6, 8, 'balanced').back).toBe(95);
    expect(pbBackOff(BAR, 102.5, 6, 8, 'balanced').back).toBe(95);
    expect(pbBackOff(BAR, 117.5, 6, 8, 'balanced').back).toBe(110);
    expect(pbBackOff(BAR, 100, 5, 8, 'strength').back).toBe(92.5);
    // Dumbbells on 2 kg steps: Strength 24 × 7 → 22 (not 24); Muscle 26 × 6 → 24 (7.7 %, nearest the band).
    expect(pbBackOff(DB, 24, 7, 8, 'strength').back).toBe(22);
    expect(pbBackOff(DB, 26, 6, 8, 'muscle').back).toBe(24);
  });

  it('is always an achievable load below the top, inside the band when one is (acceptance check 5)', () => {
    for (const kit of [BAR, DB, STACK])
      for (const focus of ['strength', 'balanced', 'muscle', 'fitness'] as const)
        for (const top of kit.loads.slice(3, 60))
          for (const reps of [5, 6, 7, 8]) {
            const { back } = pbBackOff(kit, top, reps, 8, focus);
            expect(kit.loads).toContain(back);
            expect(back).toBeLessThan(top);
            const band = PB_BACKOFF_BAND[focus];
            const inBand = kit.loads.some((l) => l >= top * (1 - band[1]) - 1e-9 && l <= top * (1 - band[0]) + 1e-9);
            if (inBand) {
              expect(back).toBeGreaterThanOrEqual(top * (1 - band[1]) - 1e-9);
              expect(back).toBeLessThanOrEqual(top * (1 - band[0]) + 1e-9);
            }
          }
  });

  it('a top with nothing below it keeps its load and the back-offs do one rep fewer', () => {
    const one: PlanKit = { ...DB, loads: [10] };
    expect(pbBackOff(one, 10, 6, 8, 'balanced')).toEqual({ back: 10, reps: 7 });
  });
});

describe('warm-ups (WU4, WU5, WU8, WU9)', () => {
  it('bench 100 × 6: bar × 5 · 40 × 5 · 60 × 3 · 80 × 2', () => {
    expect(pbWarmUpText(pbWarmUp(BAR, 'barbell-bench-press', 100, 6), false)).toBe('bar × 5 · 40 × 5 · 60 × 3 · 80 × 2');
  });
  it('floor lifts skip the empty bar; dumbbells start at 40 % with no bar', () => {
    expect(pbWarmUpText(pbWarmUp(BAR, 'barbell-bent-over-row', 105, 6), false)).toBe('40 × 5 · 62.5 × 3 · 82.5 × 2');
    expect(pbWarmUpText(pbWarmUp(DB, 'dumbbell-seated-shoulder-press', 26, 6), true)).toBe('10 each × 5 · 14 each × 3 · 20 each × 2');
  });
  it('higher reps: two steps', () => {
    expect(pbWarmUp(BAR, 'barbell-bench-press', 80, 10).map((w) => w.reps)).toEqual([8, 5]);
  });
  it('the shared planner’s steps, with the inputs Start uses for a main lift (the plan view and the workout agree)', () => {
    const lb: PlanKit = { ...BAR, unit: 'lb', loads: Array.from({ length: 120 }, (_, i) => 45 + i * 5), barMass: 45 };
    const cases: [PlanKit, string, number, number][] = [
      [BAR, 'barbell-bench-press', 100, 6],
      [BAR, 'barbell-back-squat', 140, 3],
      [BAR, 'barbell-overhead-press', 50, 8],
      [lb, 'barbell-bench-press', 225, 5],
      [DB, 'dumbbell-seated-shoulder-press', 26, 6],
    ];
    for (const [kit, key, W, R] of cases) {
      const shared = planWarmups({ cls: 'heavy', reps: R, load: W, warmed: false, firstOfSession: true, floorStart: false, barMass: kit.kind === 'barbell' ? kit.barMass : null, loads: kit.loads });
      expect(pbWarmUp(kit, key, W, R).map((w) => [w.load, w.reps])).toEqual(shared.map((w) => [w.load, w.reps]));
    }
    // R ≤ 3 (WU4): a single at 87.5 %; every step an achievable load below W (rule 4).
    const squat = pbWarmUp(BAR, 'barbell-back-squat', 140, 3);
    expect(squat.at(-1)).toMatchObject({ reps: 1 });
    for (const w of squat) expect(BAR.loads.includes(w.load) && w.load < 140).toBe(true);
  });
  it('WU9 from the catalogue: deadlifts start from the floor (no bar step); a Romanian deadlift doesn’t', () => {
    expect(pbWarmUp(BAR, 'barbell-deadlift', 160, 5)[0]?.bar).toBe(false);
    expect(pbWarmUp(BAR, 'barbell-deadlift', 160, 5, { catalogueKey: 'barbell-deadlift', family: 'deadlift', mechanic: 'compound' })[0]?.bar).toBe(false);
    expect(pbWarmUp(BAR, 'barbell-romanian-deadlift', 100, 6, { catalogueKey: 'barbell-romanian-deadlift', family: 'romanian_deadlift', mechanic: 'compound' })[0]).toEqual({ bar: true, load: 20, reps: 5 });
    // Assisted / bodyweight conventions: no formula, no warm-up ladder.
    expect(pbWarmUp(ASSIST, 'machine-assisted-pull-up', 30, 6)).toEqual([]);
  });
});

describe('the build', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('builds the ✦ answers: 4 days Upper / Lower, main lift first, within each session cap', () => {
    const p = build();
    expect(p.split).toBe('ul');
    expect(p.days.map(pbDayName)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    for (const d of p.days) {
      expect(d.exercises[0]?.role).toBe('main');
      expect(d.exercises.filter((e) => e.role === 'main')).toHaveLength(1);
      expect(d.exercises.reduce((s, e) => s + e.sets, 0)).toBeLessThanOrEqual(d.cap + 4);
      expect(d.exercises.length).toBeLessThanOrEqual(10);
    }
    // A and B days differ in their main lift.
    expect(p.days[0]?.exercises[0]?.key).not.toBe(p.days[2]?.exercises[0]?.key);
  });

  it('session length caps sets: longer sessions fit more, never more than the length less the day’s warm-ups allows', () => {
    const caps = [45, 60, 75].map((m) => Math.max(...build({}, answers({ minutes: m })).days.map((d) => d.cap)));
    expect(caps[0]).toBeLessThan(caps[1] ?? 0);
    expect(caps[1]).toBeLessThan(caps[2] ?? 0);
    for (const m of [45, 60, 75])
      for (const d of build({}, answers({ minutes: m })).days) expect(d.cap).toBeLessThanOrEqual(Math.max(2, Math.floor((m - d.warmupS / 60) / 3 + 1e-9)));
  });

  it('a priority holds: trained on 2+ days and at least the bottom of its range', () => {
    for (const g of ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms'] as const)
      for (const n of [3, 4, 5]) {
        const a = pbWithSessions(answers({ priorities: [g] }), n);
        const p = build({}, a);
        for (const m of PB_GROUPS[g]) {
          const days = p.days.filter((d) => d.exercises.some((e) => e.muscle === m)).length;
          expect(days, `${g} ${String(n)} days ${m}`).toBeGreaterThanOrEqual(2);
          expect(p.weekly[m] ?? 0, `${g} ${String(n)} days ${m}`).toBeGreaterThanOrEqual(p.ranges[m]?.[0] ?? 0);
        }
      }
  });

  it('at most 8 sets of one muscle in a session', () => {
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const p = build({}, pbWithSessions(answers({ minutes: 90, priorities: ['Chest', 'Back'] }), n));
      for (const d of p.days) {
        const by = new Map<string, number>();
        for (const e of d.exercises) by.set(e.muscle, (by.get(e.muscle) ?? 0) + e.sets);
        for (const [m, s] of by) expect(s, `${String(n)} days ${m}`).toBeLessThanOrEqual(8 + (d.exercises.find((e) => e.role === 'main' && e.muscle === m)?.sets ?? 0));
      }
    }
  });

  it('suggested split by sessions, Profile’s when it fits', () => {
    expect(pbSuggestedSplit(2, null)).toBe('full');
    expect(pbSuggestedSplit(3, null)).toBe('ul');
    expect(pbSuggestedSplit(5, null)).toBe('ppl');
    expect(pbSuggestedSplit(3, 'body')).toBe('ul');
    expect(pbSuggestedSplit(4, 'body')).toBe('body');
    expect(pbSuggestedSplit(3, 'ppl')).toBe('ppl');
    const p = build({}, pbWithSessions(answers(), 5));
    expect(p.days.map(pbDayName)).toEqual(['Push A', 'Pull A', 'Legs', 'Push B', 'Pull B']);
    expect(p.nextWeekStarts).toBe('Legs');
  });

  it('Any days (acceptance check 7): 4 sessions on Set days with a day unticked, then Any days, builds 4 days', () => {
    const a = answers({ schedule: 'set', days: [0, 1, 3] });
    expect(pbDaysReady(a)).toBe(false);
    const any = { ...a, schedule: 'any' as const };
    expect(pbDaysReady(any)).toBe(true);
    expect(pbPlanDays(any)).toEqual([0, 1, 3, 5]);
    expect(build({}, any).days).toHaveLength(4);
  });

  it('no heavy legs the day before the long run', () => {
    // Set days Mon Tue Thu Sat, long run Sunday: Saturday must not be a leg day.
    const a = pbTapSport(answers({ schedule: 'set', days: [0, 1, 3, 5] }), 'Running');
    const p = build({}, a);
    const sat = p.days.find((d) => d.weekday === 5);
    expect(['Legs', 'Lower', 'Full body']).not.toContain(sat?.focus);
    expect(p.days.some((d) => d.moved)).toBe(true);
  });

  it('a pain-held exercise is never planned (rule 9); its main lift moves to an alternative', () => {
    const p = build({ painHeld: new Set(['barbell-bench-press']) }, pbWithSessions(answers(), 5));
    expect(p.days.flatMap((d) => d.exercises).some((e) => e.key === 'barbell-bench-press')).toBe(false);
    expect(p.heldForPain).toEqual(['barbell-bench-press']);
    expect(p.days[0]?.exercises[0]?.key).toBe('dumbbell-bench-press');
  });

  it('only what the gym has: no barbell → dumbbell and machine work', () => {
    const noBar = (k: string): ReturnType<typeof kitFor> => (k.startsWith('barbell-') ? null : kitFor(k));
    const p = build({ kitOf: noBar });
    expect(p.days.flatMap((d) => d.exercises).some((e) => e.key.startsWith('barbell-'))).toBe(false);
    expect(p.days.every((d) => d.exercises.length > 0)).toBe(true);
  });

  it('likes, nevers and preference answers move the choice', () => {
    const a = answers({ prefs: { squat: 1 } });
    // Leg press liked: it replaces the squat as the leg-day main.
    const p = build({}, pbWithSessions(a, 5));
    expect(p.days.find((d) => d.focus === 'Legs')?.exercises[0]?.key).toBe('machine-leg-press');
    // The squat (the option not picked) ranks below everything else.
    expect(pbPrefScore('barbell-back-squat', a, HISTORY_OF)).toBeLessThan(0.1);
    const never = build({}, answers({ never: ['cable-fly'] }));
    expect(never.days.flatMap((d) => d.exercises).some((e) => e.key === 'cable-fly')).toBe(false);
  });

  it('his history outweighs the default after about 5 sessions', () => {
    const a = answers();
    // Shrugs: prior 0.5, 2 sessions and 3 skips → below the default.
    expect(pbPrefScore('dumbbell-shrug', a, HISTORY_OF)).toBeLessThan(0.5);
    // Incline DB press: 14 sessions, no skips → near 1.
    expect(pbPrefScore('dumbbell-incline-bench-press', a, HISTORY_OF)).toBeGreaterThan(0.9);
  });

  it('supersets pair accessories, never the main lift or heavy compounds', () => {
    const p = build({}, answers({ supersets: true }));
    for (const d of p.days) {
      for (const e of d.exercises) if (e.role === 'main' || e.key === 'barbell-romanian-deadlift') expect(e.pair).toBeNull();
      const pairs = d.exercises.filter((e) => e.pair !== null).map((e) => e.pair);
      for (const p1 of pairs.filter((x) => x?.endsWith('1') === true)) expect(pairs).toContain(`${p1?.slice(0, 1) ?? ''}2`);
      // Partners sit side by side.
      d.exercises.forEach((e, i) => {
        if (e.pair?.endsWith('1') === true) expect(d.exercises[i + 1]?.pair).toBe(`${e.pair.slice(0, 1)}2`);
      });
    }
    for (const d of build({}, answers({ supersets: true })).days) expect(d.cap).toBeLessThanOrEqual(Math.max(2, Math.floor((60 - d.warmupS / 60) / 2.3 + 1e-9)));
  });

  it('specific targets get trained: Glutes about 6 sets over 2 days; rear delts count toward Back (D5)', () => {
    const p = build({}, answers({ priorities: ['Legs'], specific: ['Glutes', 'Rear delts'] }));
    expect(p.weekly.Glutes ?? 0).toBeGreaterThanOrEqual(4);
    const rear = p.days.flatMap((d) => d.exercises).filter((e) => e.tags.includes('Rear delts'));
    expect(rear.length).toBeGreaterThan(0);
    for (const e of rear) expect(e.muscle).toBe('Back');
  });

  it('abs: 10 a week by default, 14 with Core or Fitness, 6 on Maintain, his number when he changes it', () => {
    const core = (p: PbPlan): number => p.days.flatMap((d) => d.exercises).filter((e) => e.muscle === 'Core').reduce((s, e) => s + e.sets, 0);
    expect(build().abs).toBe(10);
    expect(build({}, answers({ focus: 'fitness' })).abs).toBe(14);
    expect(build({}, answers({ effort: 'maintain' })).abs).toBe(6);
    expect(core(build({}, answers({ abs: 0 })))).toBe(0);
    expect(core(build())).toBeGreaterThanOrEqual(8);
  });

  it('every planned load is achievable on the gym item (rule 4)', () => {
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const p = build({}, pbWithSessions(answers({ supersets: n % 2 === 0 }), n));
      for (const d of p.days)
        for (const e of d.exercises) {
          const kit = kitFor(e.key);
          if (e.load.kind === 'kg' && kit !== null && kit !== 'bodyweight') expect(kit.loads, e.key).toContain(e.load.value);
          if (e.main?.back != null && kit !== null && kit !== 'bodyweight') expect(kit.loads).toContain(e.main.back);
        }
    }
  });

  it('an accessory at 15+ reps steps up one achievable load; an assisted machine keeps more help, never less than it can give', () => {
    const p = build({}, answers({ priorities: ['Shoulders'] }));
    const lat = p.days.flatMap((d) => d.exercises).find((e) => e.key === 'dumbbell-lateral-raise');
    // 10 × 15 last time → 12 per hand.
    expect(lat?.load).toMatchObject({ kind: 'kg', value: 12, convention: 'per_hand' });
    const assisted = buildPlanFromAnswers({
      answers: answers({ likes: ['machine-assisted-pull-up'] }),
      profileSplit: null,
      kitOf: KIT_OF,
      historyOf: (k) => (k === 'machine-assisted-pull-up' ? { last: { value: 27, unit: 'kg', reps: 8, atUtc: '2026-10-20T10:00:00Z' }, sessions: 3, skips: 0 } : HISTORY_OF(k)),
      nowMs: NOW,
    });
    const ap = assisted.days.flatMap((d) => d.exercises).find((e) => e.key === 'machine-assisted-pull-up');
    // 27 kg of help isn't on the stack: 30 (more help, easier), never 25.
    expect(ap?.load).toMatchObject({ kind: 'kg', value: 30, convention: 'assistance' });
    expect(ASSIST.loads).toContain(30);
  });

  it('weekly sets: each group is exactly the sum of its rows; indirect work counts half', () => {
    const w = weeklySetsOf([{ exercises: [{ key: 'barbell-bench-press', muscle: 'Chest', sets: 3 } as PbExercise, { key: 'cable-lat-pulldown', muscle: 'Back', sets: 3 } as PbExercise] }], ['Chest', 'Back', 'Triceps', 'Biceps']);
    expect(w).toEqual({ Chest: 3, Back: 3, Triceps: 1, Biceps: 1 });
  });
});

describe('weekly progression and deloads (atWeek)', () => {
  it('deload weeks: Standard the last week, Push every 4th, Maintain none', () => {
    expect(pbDeloadWeeks({ effort: 'standard', weeks: 6 })).toEqual([6]);
    expect(pbDeloadWeeks({ effort: 'push', weeks: 8 })).toEqual([4, 8]);
    expect(pbDeloadWeeks({ effort: 'maintain', weeks: 12 })).toEqual([]);
  });

  it('a barbell main lift rises at the weekly rate, snapped; the deload takes 10 % off top and back-offs, a set fewer', () => {
    const a = answers({ split: 'ppl', sessions: 3, days: [0, 2, 4], lifts: { 'barbell-back-squat': { kind: 'confirmed' } } });
    const p = build({}, a);
    const bench = mainOf(p, 'barbell-bench-press');
    if (bench === undefined) throw new Error('no bench');
    const w1 = pbAtWeek(a, bench, BAR, 1);
    const w5 = pbAtWeek(a, bench, BAR, 5);
    const w6 = pbAtWeek(a, bench, BAR, 6);
    expect(w1.line).toBe('1 × 6 + 2 × 8 · 100 / 95');
    // 100 × (1 + 1.2 % × 4) = 104.8 → 102.5.
    expect(w5.load).toBe(102.5);
    expect(w6.deload).toBe(true);
    expect(w6.load).toBe(92.5);
    expect(w6.backs).toBe(1);
    expect(w6.back ?? 0).toBeLessThan(w6.load ?? 0);
    expect(BAR.loads).toContain(w6.back);
  });

  it('a dumbbell main lift adds reps first (6 → 7 → 8), then the next dumbbell, and never past the rack (rule 4)', () => {
    const small: PlanKit = { ...DB, loads: DB.loads.filter((l) => l <= 28) };
    const a = answers({ weeks: 12, effort: 'standard' });
    const e: PbExercise = { ...(mainOf(build(), 'dumbbell-seated-shoulder-press') as PbExercise) };
    const top = e.main?.top ?? 0;
    expect(top).toBe(26);
    const seq = [1, 2, 3, 4, 5, 6, 7].map((w) => pbAtWeek(a, e, small, w));
    expect(seq.map((x) => x.reps).slice(0, 3)).toEqual([6, 7, 8]);
    expect(seq[3]?.load).toBe(28);
    for (const x of seq) expect(x.load ?? 0).toBeLessThanOrEqual(28);
  });

  it('accessories: double progression, one step at the top of the range; held at the item max', () => {
    const a = answers();
    const e = { key: 'cable-fly', muscle: 'Chest', role: 'i', tags: [], sets: 3, reps: 12, load: { kind: 'kg', value: 20, unit: 'kg', convention: 'stack', equipmentId: STACK.equipmentId }, bodyweightMain: false, main: null, estimate: false, pair: null, why: '' } as PbExercise;
    expect(pbAtWeek(a, e, STACK, 2)).toMatchObject({ reps: 8, load: 22.5 });
    expect(pbAtWeek(a, e, STACK, 3)).toMatchObject({ reps: 9, load: 22.5 });
    const top: PlanKit = { ...STACK, loads: [15, 17.5, 20] };
    expect(pbAtWeek(a, e, top, 4)).toMatchObject({ reps: 12, load: 20 });
  });

  it('Maintain holds weights', () => {
    const a = answers({ effort: 'maintain' });
    const bench = mainOf(build({}, a), 'barbell-bench-press') ?? mainOf(build({}, pbWithSessions(a, 5)), 'barbell-bench-press');
    if (bench === undefined) throw new Error('no bench');
    expect(pbAtWeek(a, bench, BAR, 4).load).toBe(bench.main?.top);
  });
});

describe('Check your lifts extras', () => {
  it('strength balance: Below / In range / Above against bench', () => {
    const lifts = PB_CHECK_LIFTS.flatMap((k) => {
      const s = pbLiftStart(k, KIT_OF, HISTORY_OF, undefined, NOW);
      return s === null ? [] : [s];
    });
    const b = pbStrengthBalance(lifts);
    expect(b.map((x) => x.key)[0]).toBe('barbell-bench-press');
    // Squat 117.5 × 6 ≈ 141 e1RM vs bench 120: 1.17 → Below 1.2–1.5.
    expect(b.find((x) => x.key === 'barbell-back-squat')?.word).toBe('Below');
    expect(b.find((x) => x.key === 'barbell-bent-over-row')?.word).toBe('Above');
  });

  it('What to expect: est. at the focus reps, flat on Maintain', () => {
    const s = pbLiftStart('barbell-bench-press', KIT_OF, HISTORY_OF, undefined, NOW);
    if (s === null) throw new Error('no bench');
    const e = pbExpect(answers(), [{ start: s, kit: BAR }]);
    expect(e.reps).toBe(6);
    expect(e.rows[0]?.now).toBe(100);
    expect(e.rows[0]?.end ?? 0).toBeGreaterThan(100);
    expect(pbExpect(answers({ effort: 'maintain' }), [{ start: s, kit: BAR }]).rows[0]?.end).toBe(100);
  });

  it('answer helpers: up to 2 priorities, sport chips cycle add → ★ → off', () => {
    const a = answers();
    const two = pbTogglePriority(pbTogglePriority(a, 'Back') ?? a, 'Chest');
    expect(two?.priorities).toEqual(['Back', 'Chest']);
    expect(two === null ? 'x' : pbTogglePriority(two, 'Legs')).toBeNull();
    const s1 = pbTapSport(a, 'Cycling');
    expect(s1.other).toEqual([{ sport: 'Cycling', days: [5], star: false }]);
    expect(pbTapSport(s1, 'Cycling').other[0]?.star).toBe(true);
    expect(pbTapSport(pbTapSport(s1, 'Cycling'), 'Cycling').other).toEqual([]);
  });
});

describe('the built plan as the app’s plan model', () => {
  it('is a valid open plan whose Apply makes one workout per day (rule 5 path)', () => {
    const a = answers();
    const p = build({}, a);
    const draft = pbNewPlanDraft({ plan: p, answers: a, kitOf: KIT_OF, ownerId: '00000000-0000-4000-8000-000000000001', gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-0000000000aa', at });
    const parsed = PlanDraftSchema.safeParse(draft);
    expect(parsed.error?.issues ?? []).toEqual([]);
    const v = currentPlanVersion(draft);
    expect(v.builder?.answers).toEqual(a);
    expect(v.days.map((d) => d.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    const bench = v.days.flatMap((d) => d.plan.slots).find((s) => s.catalogueId === 'barbell-bench-press');
    expect(bench?.exerciseId).toBe(catalogueExerciseId('barbell-bench-press'));
    expect(bench?.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'warmup', 'warmup', 'warmup', 'top', 'backoff', 'backoff']);
    expect(bench?.setTemplates.find((t) => t.setType === 'top')?.load).toMatchObject({ source: 'plan', load: { value: 100, unit: 'kg', convention: 'total' } });
    const r = applyPlan(draft, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: '00000000-0000-4000-8000-0000000000ab', at, live: [] });
    expect(r.kind).toBe('write');
    if (r.kind === 'write') expect(r.create.map((x) => x.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
  });

  it('estimates are flagged on the stored load (est., rule 6)', () => {
    const a = answers();
    const none = (k: string): PbHistory | null => (k === 'dumbbell-seated-shoulder-press' ? null : HISTORY_OF(k));
    const p = build({ historyOf: none }, a);
    const draft = pbNewPlanDraft({ plan: p, answers: a, kitOf: KIT_OF, ownerId: '00000000-0000-4000-8000-000000000001', gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-0000000000ac', at });
    const sp = currentPlanVersion(draft).days.flatMap((d) => d.plan.slots).find((s) => s.catalogueId === 'dumbbell-seated-shoulder-press');
    expect(sp?.setTemplates.find((t) => t.setType === 'top')?.load?.estimate).toBe(true);
  });
});

describe('the plan’s focus sets Today’s back-off band (S7)', () => {
  it('an applied builder plan’s focus, else Profile’s goal', () => {
    const a = answers({ focus: 'fitness' });
    const draft = pbNewPlanDraft({ plan: build({}, a), answers: a, kitOf: KIT_OF, ownerId: '00000000-0000-4000-8000-000000000001', gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-0000000000ad', at });
    expect(pbMainFocus(draft, 'strength')).toBe('strength');
    const applied = { ...draft, status: 'applied' as const };
    expect(pbMainFocus(applied, 'strength')).toBe('fitness');
    expect(BACKOFF_BANDS.fitness).toEqual({ min: 0.02, max: 0.15 });
    expect(pbMainFocus(null, 'muscle')).toBe('muscle');
    expect(pbMainFocus(null, null)).toBe('balanced');
  });
});
