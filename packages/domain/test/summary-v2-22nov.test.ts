import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, Load, SessionAggregate, SetValues } from '@fizz/schemas';

import {
  buildAddExerciseCommand,
  comparableWorkoutRef,
  NBSP,
  startWorkout,
  summaryHealthLine,
  summaryHighlights,
  summaryPlanLine,
  summarySetText,
  summaryStats,
  volumeChange,
  volumeText,
  vsLastChange,
  vsLastTime,
  workoutVolume,
  type HistorySession,
  type SessionRecordItem,
} from '../src/index';
import { assisted, at, barbell, bodyweightStation, dumbbells, exercise, GYM, id, idGen, kg, lb, plateMachine, profile, stack, TZ, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

/** (Ben, 22 Nov; docs/design/prototypes/summary-v2-22nov.html) The Summary v2's pure pieces. */
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

// ---------------------------------------------------------------------------
// A workout: one exercise per kind of load, each with the given sets logged.

const ROW = exercise(501, 'Barbell row', { family: 'row' });
const RAISE = exercise(502, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const CONC = exercise(503, 'Concentration curl', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', laterality: 'unilateral' });
const PULLUP = exercise(504, 'Pull-up', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
const ASSIST = exercise(505, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
const PRESS = exercise(506, 'Leg press', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added' });
const PULLDOWN = exercise(507, 'Lat pulldown', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const PLANK = exercise(508, 'Plank', { measurement: 'duration', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });

const bar = barbell();
const dbs = dumbbells();
const station = bodyweightStation();
const assist = assisted();
const sled = plateMachine();
const cable = stack();

type Item = { ex: Exercise; eq: EquipmentInstance; sets: SetValues[]; warmups?: SetValues[] };

function workout(items: Item[], startS = 0): SessionAggregate {
  const owner = profile();
  const ids = idGen(70_000 + startS);
  let s = startWorkout({ opId: `w-${String(startS)}`, owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [bar, dbs, station, assist, sled, cable], at: at(startS), newId: ids }).aggregate;
  let k = 1;
  for (const item of items) {
    s = apply(s, buildAddExerciseCommand({ opId: `w-add-${String(startS)}-${String(k)}`, owner, exercise: item.ex, equipmentId: item.eq.id, at: at(startS + k), newId: ids }));
    const sx = s.exercises.find((e) => e.exerciseId === item.ex.id)?.id ?? '';
    // Only working sets, as many as logged (planned warm-ups out).
    for (const w of s.sets.filter((x) => x.sessionExerciseId === sx && x.setType === 'warmup')) s = apply(s, { type: 'delete_set', at: at(startS + k), opId: `w-del-${w.id}`, setId: w.id, expectedSetVersion: w.version });
    let own = s.sets.filter((x) => x.sessionExerciseId === sx && x.status !== 'deleted');
    for (let i = own.length; i < item.sets.length; i += 1) s = apply(s, { type: 'add_set', at: at(startS + k), opId: `w-set-${String(startS)}-${String(k)}-${String(i)}`, sessionExerciseId: sx, newSetId: ids(), setType: null });
    own = s.sets.filter((x) => x.sessionExerciseId === sx && x.status !== 'deleted').sort((a, b) => a.index - b.index);
    for (const extra of own.slice(item.sets.length)) s = apply(s, { type: 'delete_set', at: at(startS + k), opId: `w-del2-${extra.id}`, setId: extra.id, expectedSetVersion: extra.version });
    own = own.slice(0, item.sets.length);
    item.sets.forEach((v, i) => {
      const set = own[i];
      if (set === undefined) throw new Error('no set');
      s = apply(s, logCmd(set.id, v, startS + 10 * k + i, `w-log-${set.id}`));
    });
    k += 1;
  }
  return apply(s, { type: 'finish', at: at(startS + 3000), opId: `w-fin-${String(startS)}`, expectedVersion: s.session.version, endedAt: null });
}

const v = (load: Load | null, reps: number) => values(load, reps, { rpe: 8 });

describe('plan line', () => {
  it('`Week 4 of 6 · 4 of 5 days done`; lead-in; none without a plan or once the block is done', () => {
    expect(summaryPlanLine({ week: 4, of: 6, done: false, leadIn: false, daysDone: 4, days: 5 })).toBe('Week 4 of 6 · 4 of 5 days done');
    expect(summaryPlanLine({ week: 1, of: 6, done: false, leadIn: true, daysDone: 1, days: 4 })).toBe('Lead-in · 1 of 4 days done');
    // An extra day done that week never reads `6 of 5`.
    expect(summaryPlanLine({ week: 2, of: 6, done: false, leadIn: false, daysDone: 6, days: 5 })).toBe('Week 2 of 6 · 6 of 6 days done');
    expect(summaryPlanLine({ week: 7, of: 6, done: true, leadIn: false, daysDone: 1, days: 5 })).toBeNull();
    expect(summaryPlanLine(null)).toBeNull();
  });
});

describe('volume', () => {
  it('loaded working sets only: total, stack and plates as loaded; two dumbbells ×2, one at a time ×1; lb in kg', () => {
    const a = workout([
      { ex: ROW, eq: bar, sets: [v(kg(97.5), 8), v(kg(97.5), 8)] },
      { ex: RAISE, eq: dbs, sets: [v(kg(10, 'per_hand'), 13)] },
      { ex: CONC, eq: dbs, sets: [v(kg(12.5, 'per_hand'), 10)] },
      { ex: PULLDOWN, eq: cable, sets: [v(kg(50, 'stack'), 12)] },
      { ex: PRESS, eq: sled, sets: [v(kg(100, 'added'), 10)] },
    ]);
    // 2 × 780 + 2 × 10 × 13 + 12.5 × 10 + 50 × 12 + 100 × 10
    expect(workoutVolume(a)).toEqual({ kg: 1560 + 260 + 125 + 600 + 1000, loadedSets: 6, reps: 16 + 13 + 10 + 12 + 10 });
    // A set logged in lb (another gym's kit) counts in kg.
    const one = workout([{ ex: ROW, eq: bar, sets: [v(kg(100), 10)] }]);
    const lbs = { ...one, sets: one.sets.map((x) => (x.actual === null ? x : { ...x, actual: { ...x.actual, load: lb(100) } })) };
    expect(workoutVolume(lbs).kg).toBeCloseTo(453.59237, 4);
  });

  it('bodyweight, assisted and timed sets are left out (no invented bodyweight, rule 6); reps still count', () => {
    const a = workout([
      { ex: PULLUP, eq: station, sets: [v(null, 8), v(null, 7)] },
      { ex: ASSIST, eq: assist, sets: [v(kg(20, 'assistance'), 8)] },
      { ex: PLANK, eq: station, sets: [values(null, null, { durationS: 60 })] },
    ]);
    expect(workoutVolume(a)).toEqual({ kg: 0, loadedSets: 0, reps: 23 });
  });

  it('warm-ups are left out', () => {
    const a = workout([{ ex: ROW, eq: bar, sets: [v(kg(100), 5)] }]);
    const warm = { ...a, sets: a.sets.map((x) => ({ ...x, setType: 'warmup' as const })) };
    expect(workoutVolume(warm).loadedSets).toBe(0);
  });

  it('`6.4 t` from 1000 kg, else `850 kg`', () => {
    expect(plain(volumeText(6420))).toBe('6.4 t');
    expect(plain(volumeText(6000))).toBe('6 t');
    expect(plain(volumeText(1000))).toBe('1 t');
    expect(plain(volumeText(849.6))).toBe('850 kg');
  });

  it('the change: `↑ 6%`, `↓ 4%`, `=`; none with nothing comparable', () => {
    expect(volumeChange(6360, 6000)).toEqual({ text: '↑ 6%', spoken: 'up 6 percent', dir: 'up' });
    expect(volumeChange(5760, 6000)).toEqual({ text: '↓ 4%', spoken: 'down 4 percent', dir: 'down' });
    expect(volumeChange(6010, 6000)?.text).toBe('=');
    expect(volumeChange(6000, null)).toBeNull();
    expect(volumeChange(6000, 0)).toBeNull();
  });
});

describe('three numbers', () => {
  const vol = { kg: 6420, loadedSets: 18, reps: 160 };
  it('minutes, sets, volume with its arrow', () => {
    const s = summaryStats({ activeMs: 52 * 60_000, workingSets: 20, volume: vol, previousVolumeKg: 6060 });
    expect(s.map((x) => [x.value, x.label, x.change?.text ?? null]).map(([a, b, c]) => [plain(a), b, c])).toEqual([
      ['52', 'min', null],
      ['20', 'sets', null],
      ['6.4 t', 'volume', '↑ 6%'],
    ]);
    expect(s[2]?.spoken).toBe('volume 6.4 tonnes, up 6 percent');
  });
  it('no comparable workout: no arrow; a date-only workout: no minutes', () => {
    const s = summaryStats({ activeMs: null, workingSets: 20, volume: vol, previousVolumeKg: null });
    expect(s.map((x) => x.key)).toEqual(['sets', 'volume']);
    expect(s[1]?.change).toBeNull();
  });
  it('no loaded sets: reps instead; nothing at all: two numbers', () => {
    expect(summaryStats({ activeMs: 30 * 60_000, workingSets: 6, volume: { kg: 0, loadedSets: 0, reps: 48 }, previousVolumeKg: 5000 }).map((x) => [x.value, x.label, x.change])).toEqual([
      ['30', 'min', null],
      ['6', 'sets', null],
      ['48', 'reps', null],
    ]);
    expect(summaryStats({ activeMs: 30 * 60_000, workingSets: 1, volume: { kg: 0, loadedSets: 0, reps: 0 }, previousVolumeKg: null }).map((x) => x.key)).toEqual(['minutes', 'sets']);
  });
});

describe('comparable workout', () => {
  const day = { planId: 'p', dayIndex: 1 };
  const refs = [
    { sessionId: 'a', routineId: 'r1', startedAtUtc: '2026-11-09T17:00:00.000Z', planDay: day },
    { sessionId: 'b', routineId: 'r2', startedAtUtc: '2026-11-16T17:00:00.000Z', planDay: { planId: 'p', dayIndex: 2 } },
    { sessionId: 'c', routineId: 'r1', startedAtUtc: '2026-11-18T17:00:00.000Z' },
    { sessionId: 'later', routineId: 'r1', startedAtUtc: '2026-11-25T17:00:00.000Z', planDay: day },
  ];
  it('the same plan day first, else the same saved workout, never a later one; none: null', () => {
    expect(comparableWorkoutRef(refs, { sessionId: 'today', routineId: 'r9', startedAtUtc: '2026-11-21T17:00:00.000Z', planDay: day })?.sessionId).toBe('a');
    expect(comparableWorkoutRef(refs, { sessionId: 'today', routineId: 'r1', startedAtUtc: '2026-11-21T17:00:00.000Z', planDay: null })?.sessionId).toBe('c');
    expect(comparableWorkoutRef(refs, { sessionId: 'today', routineId: null, startedAtUtc: '2026-11-21T17:00:00.000Z', planDay: null })).toBeNull();
  });
});

describe('Garmin line', () => {
  it('only the values the Health workout has; heart rate only when its switch is on', () => {
    expect(summaryHealthLine({ sourceName: 'Connect', avgHeartRate: 128, activeKcal: 410 }, true)?.text).toBe('Garmin · avg 128 bpm · 410 kcal');
    expect(summaryHealthLine({ sourceName: 'Garmin Connect', avgHeartRate: 128, activeKcal: null }, true)?.text).toBe('Garmin · avg 128 bpm');
    expect(summaryHealthLine({ sourceName: 'Garmin Connect', avgHeartRate: 128, activeKcal: 410 }, false)?.text).toBe('Garmin · 410 kcal');
    expect(summaryHealthLine({ sourceName: 'Garmin Connect', avgHeartRate: null }, true)).toBeNull();
  });
});

describe('a set as the Summary says it', () => {
  it('the unit always named; per hand, assisted, BW + added and plates', () => {
    expect(plain(summarySetText(kg(97.5), 8))).toBe('97.5 kg × 8');
    expect(plain(summarySetText(lb(225), 5))).toBe('225 lb × 5');
    expect(plain(summarySetText(kg(7, 'per_hand'), 17))).toBe('7 kg ea × 17');
    expect(plain(summarySetText(kg(20, 'assistance'), 8))).toBe('20 kg assist × 8');
    expect(plain(summarySetText(kg(10, 'added'), 8))).toBe('BW +10 kg × 8');
    expect(plain(summarySetText(kg(40, 'added'), 8, true))).toBe('40 kg × 8');
    expect(plain(summarySetText(null, 8))).toBe('BW × 8');
  });
});

describe('highlights', () => {
  const order = [
    { exerciseId: 'pull', sessionExerciseId: 'se-pull' },
    { exerciseId: 'row', sessionExerciseId: 'se-row' },
    { exerciseId: 'crunch', sessionExerciseId: 'se-crunch' },
    { exerciseId: 'curl', sessionExerciseId: 'se-curl' },
  ];
  const crunch: SessionRecordItem = { exerciseId: 'crunch', sessionExerciseId: 'se-crunch', name: 'Cable crunch', kind: 'heaviest', text: 'Heaviest cable crunch set so far', load: kg(80, 'stack'), reps: 12, convention: 'stack', plates: false };
  const rowRecord: SessionRecordItem = { ...crunch, exerciseId: 'row', sessionExerciseId: 'se-row', name: 'Barbell row', load: kg(97.5), reps: 8, convention: 'total' };
  const plan = [
    { sessionExerciseId: 'se-pull', exerciseId: 'pull', name: 'Pull-up', plannedSets: 3, doneSets: 1 },
    { sessionExerciseId: 'se-row', exerciseId: 'row', name: 'Barbell row', plannedSets: 3, doneSets: 3 },
    { sessionExerciseId: 'se-curl', exerciseId: 'curl', name: 'Curl', plannedSets: 3, doneSets: 0 },
  ];

  it('new bests first (best for N reps, else heaviest), one per exercise; then cut short; at most 3, then `+N more`', () => {
    const h = summaryHighlights({ order, bests: [{ exerciseId: 'row', name: 'Barbell row', set: `97.5${NBSP}kg${NBSP}×${NBSP}8`, reps: 8 }], records: [rowRecord, crunch], plan });
    expect(h.shown.map((x) => [x.name, x.meta, plain(x.value), x.ring])).toEqual([
      ['Barbell row', 'Best for 8 reps', '97.5 kg × 8', 'best'],
      ['Cable crunch', 'Heaviest yet', '80 kg × 12', 'best'],
      ['Pull-up', 'Cut short', '1 of 3 sets', 'short'],
    ]);
    expect(h.more.map((x) => [x.name, x.meta, x.value])).toEqual([['Curl', 'Skipped', '0 of 3 sets']]);
    expect(h.shown[2]?.spoken).toBe('Pull-up, Cut short, 1 of 3 sets');
  });

  it('most reps at a load; nothing to say: none', () => {
    expect(summaryHighlights({ order, bests: [], records: [{ ...crunch, kind: 'most_reps_at_load' }], plan: null }).shown.map((x) => x.meta)).toEqual(['Most reps yet']);
    expect(summaryHighlights({ order, bests: [], records: [], plan: [plan[1] ?? plan[0]].flatMap((x) => (x === undefined ? [] : [x])) })).toEqual({ shown: [], more: [] });
  });
});

describe('vs last time: the plain change', () => {
  const t = (load: Load | null, reps: number) => ({ load, reps });
  it('more load, fewer reps: `↑ 2.5 kg · 2 fewer reps`, mixed (no single verdict, no e1RM)', () => {
    const c = vsLastChange(t(kg(95), 10), t(kg(97.5), 8), 'total');
    expect(plain(c?.text)).toBe('↑ 2.5 kg · 2 fewer reps');
    expect(c?.tone).toBe('mixed');
    expect(c?.spoken).toBe('up 2.5 kilograms, 2 fewer reps');
  });
  it('same load, one more rep: `↑ 1 rep`, better; one fewer: `↓ 1 rep`, less; the same: `=`', () => {
    expect(vsLastChange(t(kg(10, 'per_hand'), 12), t(kg(10, 'per_hand'), 13), 'per_hand')).toMatchObject({ text: '↑ 1 rep', tone: 'better' });
    expect(vsLastChange(t(kg(10, 'per_hand'), 12), t(kg(10, 'per_hand'), 10), 'per_hand')).toMatchObject({ text: '↓ 2 reps', tone: 'less' });
    expect(vsLastChange(t(kg(7, 'per_hand'), 17), t(kg(7, 'per_hand'), 17), 'per_hand')).toMatchObject({ text: '=', tone: 'same' });
  });
  it('more load, same or more reps: better; less load, same or fewer: less', () => {
    expect(vsLastChange(t(kg(100), 5), t(kg(102.5), 5), 'total')?.tone).toBe('better');
    expect(vsLastChange(t(kg(100), 5), t(kg(102.5), 6), 'total')).toMatchObject({ text: `↑ 2.5${NBSP}kg · 1 more rep`, tone: 'better' });
    expect(vsLastChange(t(kg(100), 5), t(kg(95), 5), 'total')).toMatchObject({ text: `↓ 5${NBSP}kg`, tone: 'less' });
    expect(vsLastChange(t(kg(100), 5), t(kg(95), 8), 'total')?.tone).toBe('mixed');
  });
  it('bodyweight: reps only; BW + added: the added load', () => {
    expect(vsLastChange(t(null, 9), t(null, 8), 'bodyweight')).toMatchObject({ text: '↓ 1 rep', tone: 'less' });
    expect(vsLastChange(t(null, 8), t(kg(5, 'added'), 8), 'added')).toMatchObject({ text: `↑ 5${NBSP}kg`, tone: 'better' });
  });
  it('assisted: less assistance is better, said in its own direction', () => {
    expect(vsLastChange(t(kg(30, 'assistance'), 8), t(kg(25, 'assistance'), 8), 'assistance')).toMatchObject({ text: `↓ 5${NBSP}kg${NBSP}assist`, tone: 'better', spoken: 'down 5 kilograms of assistance' });
    expect(vsLastChange(t(kg(25, 'assistance'), 8), t(kg(30, 'assistance'), 8), 'assistance')?.tone).toBe('less');
  });
  it('kg against lb, or another convention: not compared (null)', () => {
    expect(vsLastChange(t(kg(100), 5), t(lb(225), 5), 'total')).toBeNull();
    expect(vsLastChange(t(kg(20, 'stack'), 5), t(kg(20), 5), 'total')).toBeNull();
  });
});

describe('vs last time: rows from a workout and its history', () => {
  const hist = (eq: EquipmentInstance, sets: { load: Load | null; reps: number; setType?: 'working' | 'warmup' }[], daysAgo: number, sessionId = id(9000 + daysAgo)): HistorySession => ({
    sessionId,
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: eq.id,
    gymId: GYM,
    imported: false,
    tz: TZ,
    sets: sets.map((s) => ({ setType: s.setType ?? 'working', side: null, load: s.load, reps: s.reps, rpe: null, rir: 2 })),
  });

  it('each exercise’s best working set against the last time (`Last: 95 kg × 10 · <day>`), per hand and bodyweight; none without history', () => {
    const today = workout([
      { ex: PULLUP, eq: station, sets: [v(null, 8)] },
      { ex: ROW, eq: bar, sets: [v(kg(97.5), 8), v(kg(97.5), 8), v(kg(95), 9)] },
      { ex: RAISE, eq: dbs, sets: [v(kg(10, 'per_hand'), 13), v(kg(10, 'per_hand'), 12)] },
      { ex: PULLDOWN, eq: cable, sets: [v(kg(50, 'stack'), 12)] },
    ]);
    const history = {
      [PULLUP.id]: [hist(station, [{ load: null, reps: 9 }, { load: null, reps: 9 }], 12)],
      // Warm-ups never count; the newest like-for-like workout is the one compared.
      [ROW.id]: [hist(bar, [{ load: kg(120), reps: 3, setType: 'warmup' }, { load: kg(95), reps: 10 }], 12), hist(bar, [{ load: kg(90), reps: 10 }], 20)],
      [RAISE.id]: [hist(dbs, [{ load: kg(10, 'per_hand'), reps: 12 }], 12)],
    };
    const rows = vsLastTime({ aggregate: today, history });
    const day = plain(rows[0]?.last).split(' · ')[1];
    expect(rows.map((r) => [r.name, plain(r.last), plain(r.today), plain(r.change), r.tone])).toEqual([
      ['Pull-up', `Last: BW × 9 · ${day ?? ''}`, 'BW × 8', '↓ 1 rep', 'less'],
      ['Barbell row', `Last: 95 kg × 10 · ${day ?? ''}`, '97.5 kg × 8', '↑ 2.5 kg · 2 fewer reps', 'mixed'],
      ['Lateral raise', `Last: 10 kg ea × 12 · ${day ?? ''}`, '10 kg ea × 13', '↑ 1 rep', 'better'],
    ]);
    // The date in the workout's own zone, with its weekday (`Mon 9 Nov`).
    expect(day).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/);
  });

  it('an imported workout has none', () => {
    const today = workout([{ ex: ROW, eq: bar, sets: [v(kg(97.5), 8)] }]);
    const imported = { ...today, session: { ...today.session, source: 'import' as const } };
    expect(vsLastTime({ aggregate: imported, history: { [ROW.id]: [hist(bar, [{ load: kg(95), reps: 10 }], 12)] } })).toEqual([]);
  });
});
