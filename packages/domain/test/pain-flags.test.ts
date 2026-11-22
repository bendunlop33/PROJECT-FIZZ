import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, PainFlag, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildPainFlagSheet,
  buildTodayView,
  calculateNextTargets,
  clearPainFlag,
  explainTarget,
  localDateText,
  mayHurtAccessibility,
  mayHurtConfirm,
  NBSP,
  newPainFlag,
  painClearConfirm,
  painClearedToast,
  painFlagCovering,
  painFlagHeading,
  painFlagSinceText,
  painNoteText,
  painStatusFor,
  toIso,
  toMs,
  type HistorySession,
  type HistorySet,
  type TodayInput,
} from '../src/index';
import { assisted, at, barbell, doubleProgression, dumbbells, exercise, id, kg, ms, OWNER, T0_MS, TZ, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/** Domain text uses no-break spaces; tests read it with plain spaces. */
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const DAY = 86_400;
const DAY_MS = DAY * 1000;
const LONDON = 'Europe/London';
const zoned = (utc: string, tz = LONDON): ZonedTimestamp => ({ utc, tz });

let n = 9_000;
function flag(reportedAt: ZonedTimestamp, over: Partial<PainFlag> = {}): PainFlag {
  n += 1;
  return {
    ...newPainFlag({ id: id(n), ownerId: OWNER, opId: `pain-${String(n)}`, exerciseId: BENCH, exerciseName: 'Overhead press', area: 'shoulder', source: 'check_in', checkInId: null, at: reportedAt }),
    ...over,
  };
}

// 6 Oct 2026, 18:00 in London (BST).
const SET_AT = zoned('2026-10-06T17:00:00.000Z');
const londonMs = (date: string, hhmm = '09:00') => {
  // 9:00 local on a date in October/November 2026 (BST until 25 Oct, then GMT).
  const bst = date < '2026-10-25';
  return toMs(`${date}T${hhmm}:00.000Z`) - (bst ? 3_600_000 : 0);
};

describe('copy (active-workout §5, exercise-library §5, today.md §5)', () => {
  const f = flag(SET_AT);
  const now = londonMs('2026-10-22');

  it('picker: `May hurt` confirm with area and date; no area reads `pain` alone; never “safe”', () => {
    expect(mapPlain(mayHurtConfirm(f))).toEqual({
      title: 'Overhead press may hurt',
      message: 'Shoulder pain flagged 6 Oct.',
      confirm: 'Add anyway',
      cancel: 'Choose another',
    });
    expect(plain(mayHurtConfirm({ ...f, area: null }).message)).toBe('Pain flagged 6 Oct.');
    expect(plain(mayHurtConfirm({ ...f, area: 'other' }).message)).toBe('Pain flagged 6 Oct.');
    expect(mayHurtAccessibility(f)).toBe('May hurt: you flagged shoulder pain on it.');
    expect(JSON.stringify(mayHurtConfirm(f)).toLowerCase()).not.toMatch(/safe|injur|strain|tendon/);
  });

  it('note and sheet lines (no `check due`: the two-weekly check is gone, Ben 9 Nov)', () => {
    expect(painNoteText()).toBe('Pain flag · clears after next session');
    expect(painNoteText(true)).toBe('Pain flag · clears after this workout');
    expect(painFlagHeading(f)).toBe('Overhead press · shoulder');
    expect(painFlagHeading({ ...f, area: null })).toBe('Overhead press');
    expect(plain(painFlagSinceText(f, now, LONDON))).toBe('Since 6 Oct (16 days) · you, in a check-in');
    expect(plain(painFlagSinceText({ ...f, source: 'workout' }, toMs(SET_AT.utc), LONDON))).toBe('Since 6 Oct (today) · you, during a workout');
  });

  it('clear confirmation (AW10): default wording, the reference kept, and the toast', () => {
    expect(mapPlain(painClearConfirm(f))).toEqual({
      title: 'Clear the pain flag on Overhead press?',
      confirm: 'Clear flag',
      cancel: 'Keep it',
    });
    expect(painClearedToast('Overhead press')).toEqual({ text: 'Pain flag cleared for Overhead press', action: 'Undo' });
  });

  it('localDateText prints a stored date the way dayMonthText prints an instant', () => {
    expect(plain(localDateText('2026-11-03'))).toBe('3 Nov');
  });
});

function mapPlain<T extends Record<string, string>>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, plain(v)])) as T;
}

describe('painFlagCovering: only the exercise Ben flagged (CM5)', () => {
  it('tags the flagged exercise; a similar movement and a cleared flag are not covered', () => {
    const ohp = flag(SET_AT);
    const lateral = id(777);
    const cleared = clearPainFlag(flag(SET_AT, { exerciseId: lateral }), zoned('2026-10-08T08:00:00.000Z'));
    expect(painFlagCovering([ohp, cleared], BENCH)).toEqual({ flag: ohp });
    expect(painFlagCovering([ohp, cleared], lateral)).toBeNull();
    expect(painFlagCovering([ohp], lateral)).toBeNull();
  });

  it('with two flags on one exercise, the oldest is the one the note uses', () => {
    const older = flag(zoned('2026-09-01T08:00:00.000Z'));
    const newer = flag(SET_AT);
    expect(painFlagCovering([newer, older], BENCH)?.flag.id).toBe(older.id);
  });
});

// ---------------------------------------------------------------------------
// Set card and rest card (buildActiveSetView)

/** Bench is flagged `days` before the fixture workout (8 Oct, Auckland). */
const benchFlag = (days: number, over: Partial<PainFlag> = {}) =>
  flag(at(-days * DAY), { exerciseName: 'Bench press', ...over });

function view(state: SessionAggregate, flags: readonly PainFlag[], nowS = 2_000) {
  return buildActiveSetView({ aggregate: state, nowMs: ms(nowS), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), painFlags: flags, edits: null });
}

describe('PainFlagNote (checks 32, 51); no `Still hurts?` (Ben, 9 Nov)', () => {
  it('the note is plain however old the flag; it never changes Log', () => {
    const { state } = startFixture();
    const plainView = view(state, []);
    const old = view(state, [benchFlag(16)]);
    const fresh = view(state, [benchFlag(5)]);
    expect(plainView.focus?.painFlag).toBeNull();
    expect(old.focus?.painFlag?.text).toBe('Pain flag · clears after this workout');
    expect(old.focus?.painFlagged).toBe(true);
    expect(fresh.focus?.painFlag?.text).toBe('Pain flag · clears after this workout');
    expect(old.primary).toEqual(plainView.primary);
    expect(old.focus?.logLabel).toBe(plainView.focus?.logLabel);
  });

  it('the rest card asks nothing after the first set of a flagged movement', () => {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 100));
    expect(JSON.stringify(view(s, [benchFlag(16)], 120))).not.toMatch(/still hurt/i);
  });
});

// ---------------------------------------------------------------------------
// Today

function todayInput(over: Partial<TodayInput>): TodayInput {
  return { nowMs: londonMs('2026-10-22'), active: null, finishedThisWeek: [], todayLocalDate: '2026-10-22', localDateOf: () => '2026-10-22', recentCheckIns: [], ...over };
}

describe('buildTodayView: no `Still hurts?` row (Ben, 9 Nov)', () => {
  it('has no pain check row', () => {
    expect(buildTodayView(todayInput({}))).not.toHaveProperty('painCheck');
  });
});

// ---------------------------------------------------------------------------
// Pre-flag reference: the sheet, Why? and targets after clearing (check 54)

const BAR = barbell();
let hn = 60_000;
function hs(day: number, loads: [number, number][], over: Partial<HistorySession> = {}, conv: 'total' | 'per_hand' | 'assistance' = 'total', unit: 'kg' | 'lb' = 'kg'): HistorySession {
  hn += 1;
  const sets: HistorySet[] = loads.map(([load, reps]) => ({ setType: 'working', side: null, load: { value: load, unit, convention: conv }, reps, rpe: 8, rir: null }));
  return { sessionId: id(hn), performedAtUtc: toIso(T0_MS + day * DAY_MS), equipmentId: BAR.id, gymId: null, imported: false, sets, tz: TZ, ...over };
}

describe('buildPainFlagSheet (§2.14.4)', () => {
  const press = { measurement: 'reps' as const, defaultLoadConvention: 'total' as const };
  const f = flag(at(5 * DAY)); // 13 Oct (Auckland)
  const history = [hs(-6, [[55, 6], [55, 6], [55, 6]]), hs(0, [[57.5, 5], [57.5, 4]]), hs(8, [[50, 8], [50, 8], [50, 8]])];

  it('before the flag (the reference) and since the flag, both as actual results; no check', () => {
    const sheet = buildPainFlagSheet({ flag: f, history, nowMs: ms(9 * DAY), tz: TZ, exercise: press, anchor: { equipmentId: BAR.id, unit: 'kg', loadConvention: 'total', equipment: BAR } });
    expect(sheet.heading).toBe('Overhead press · shoulder');
    expect(plain(sheet.since)).toBe('Since 13 Oct (4 days) · you, in a check-in');
    expect(sheet.effect).toBe('No increases · clears after next session');
    expect(plain(sheet.before)).toBe('8 Oct · 57.5 kg × 5, 4');
    expect(plain(sheet.sinceFlag)).toBe('16 Oct · 50 kg × 8, 8, 8');
    expect(sheet.professional).toBe('Sharp or lasting pain: see a physio or doctor.');
    expect(buildPainFlagSheet({ flag: f, history, nowMs: ms(20 * DAY), tz: TZ, exercise: press })).not.toHaveProperty('checkDue');
  });

  it('without an open workout, the latest workout decides what is comparable', () => {
    const sheet = buildPainFlagSheet({ flag: f, history, nowMs: ms(9 * DAY), tz: TZ, exercise: press });
    expect(plain(sheet.before)).toBe('8 Oct · 57.5 kg × 5, 4');
    expect(plain(sheet.sinceFlag)).toBe('16 Oct · 50 kg × 8, 8, 8');
  });

  it('per-hand dumbbells in lb print `each`; a kg history is never the reference for lb equipment', () => {
    const db = dumbbells({ unit: 'lb', loads: [20, 25, 30, 35, 40, 45, 50] });
    const lbHist = [hs(-3, [[45, 8]], { equipmentId: db.id }, 'per_hand', 'lb'), hs(-1, [[20, 8]], { equipmentId: db.id }, 'per_hand', 'kg'), hs(7, [[35, 10]], { equipmentId: db.id }, 'per_hand', 'lb')];
    const sheet = buildPainFlagSheet({ flag: f, history: lbHist, nowMs: ms(9 * DAY), tz: TZ, exercise: { measurement: 'reps', defaultLoadConvention: 'per_hand' }, anchor: { equipmentId: db.id, unit: 'lb', loadConvention: 'per_hand', equipment: db } });
    expect(plain(sheet.before)).toBe('5 Oct · 45 lb each × 8');
    expect(plain(sheet.sinceFlag)).toBe('15 Oct · 35 lb each × 10');
  });

  it('assisted machines print the assistance, never a bodyweight claim', () => {
    const am = assisted();
    const aHist = [hs(-2, [[20, 6], [20, 5]], { equipmentId: am.id }, 'assistance')];
    const sheet = buildPainFlagSheet({ flag: f, history: aHist, nowMs: ms(9 * DAY), tz: TZ, exercise: { measurement: 'reps', defaultLoadConvention: 'assistance' } });
    expect(plain(sheet.before)).toBe('6 Oct · Assist 20 kg × 6, 5');
    expect(sheet.sinceFlag).toBeNull();
  });

  it('no history: no rows invented; a FitNotes workout can be the reference (B7)', () => {
    expect(buildPainFlagSheet({ flag: f, history: [], nowMs: ms(9 * DAY), tz: TZ, exercise: press })).toMatchObject({ before: null, sinceFlag: null });
    const imported = [hs(-3, [[60, 5]], { imported: true, equipmentId: null })];
    const sheet = buildPainFlagSheet({ flag: f, history: imported, nowMs: ms(9 * DAY), tz: TZ, exercise: press });
    expect([plain(sheet.before), sheet.sinceFlag]).toEqual(['5 Oct · 60 kg × 5', null]);
  });

  it('review import-progress N1: a newest FitNotes workout (no item) still finds the app workouts on their item', () => {
    const mixed = [hs(-6, [[55, 6], [55, 6], [55, 6]]), hs(8, [[50, 8], [50, 8]], { imported: true, equipmentId: null })];
    const sheet = buildPainFlagSheet({ flag: f, history: mixed, nowMs: ms(9 * DAY), tz: TZ, exercise: press });
    expect([plain(sheet.before), plain(sheet.sinceFlag)]).toEqual(['2 Oct · 55 kg × 6, 6, 6', '16 Oct · 50 kg × 8, 8']);
  });

  it('a flag cleared elsewhere says so and asks nothing', () => {
    const cleared = clearPainFlag(f, at(7 * DAY));
    const sheet = buildPainFlagSheet({ flag: cleared, history, nowMs: ms(30 * DAY), tz: TZ, exercise: press });
    expect(sheet).toMatchObject({ active: false });
    expect(plain(sheet.effect)).toBe('Cleared 15 Oct.');
  });
});

describe('after clearing: no reset (check 54)', () => {
  const benchEx = exercise(200, 'Bench press');
  const next = (history: HistorySession[], flags: PainFlag[], eq: EquipmentInstance = BAR) =>
    calculateNextTargets({ exerciseName: 'Bench press', measurement: 'reps', history, rule: doubleProgression({ workingSets: 3 }), equipment: eq, unit: 'kg', convention: 'total', pain: painStatusFor(flags, benchEx.id) });
  const f = flag(at(5 * DAY), { exerciseName: 'Bench press' });
  // Before the flag: 60 kg. Since: 50 kg × 8, 8, 8 at RPE 8.
  const history = [hs(-6, [[60, 8], [60, 8], [60, 8]]), hs(8, [[50, 8], [50, 8], [50, 8]])];

  it('while flagged the rule holds; after Clear it carries on from the recent sets with one normal step, never back to the old load', () => {
    expect(next(history, [f]).decision).toBe('halted_pain');
    const cleared = clearPainFlag(f, at(9 * DAY));
    const r = next(history, [cleared]);
    expect(r.decision).toBe('increase_load');
    expect(r.sets.map((s) => s.load?.value)).toEqual([52.5, 52.5, 52.5]);
    // The history before the flag is untouched.
    expect(history[0]?.sets.map((s) => s.load?.value)).toEqual([60, 60, 60]);
  });

  it('the next step is still capped by the equipment maximum (dumbbell rack tops out at 30 kg each)', () => {
    const rack = dumbbells();
    const dbHist = [hs(-6, [[30, 8], [30, 8], [30, 8]], { equipmentId: rack.id }, 'per_hand'), hs(8, [[30, 8], [30, 8], [30, 8]], { equipmentId: rack.id }, 'per_hand')];
    const r = calculateNextTargets({ exerciseName: 'DB press', measurement: 'reps', history: dbHist, rule: doubleProgression({ workingSets: 3 }), equipment: rack, unit: 'kg', convention: 'per_hand', pain: painStatusFor([clearPainFlag(f, at(9 * DAY))], benchEx.id) });
    expect(r.sets.every((s) => (s.load?.value ?? 0) <= 30)).toBe(true);
  });

  it('Why? shows the Pain row with no `Check due ›` link, however old the flag (Ben, 9 Nov)', () => {
    const s = startFixture().state;
    const set = setsFor(s, BENCH)[1];
    const row = explainTarget({ aggregate: s, setId: set?.id ?? '', nowMs: ms(10), basisNow: null, gymNames: {}, painFlags: [benchFlag(16)], history: [] })?.rows.find((r) => r.key === 'pain');
    expect(row?.label).toBe('Pain');
    expect(row).not.toHaveProperty('link');
  });

  it('lb sanity: the reference never mixes units (lb history next to kg equipment is skipped)', () => {
    const mixed = [hs(-6, [[135, 8]], {}, 'total', 'lb'), hs(-2, [[60, 6]])];
    const sheet = buildPainFlagSheet({ flag: f, history: mixed, nowMs: ms(9 * DAY), tz: TZ, exercise: { measurement: 'reps', defaultLoadConvention: 'total' }, anchor: { equipmentId: BAR.id, unit: 'kg', loadConvention: 'total', equipment: BAR } });
    expect(plain(sheet.before)).toBe('6 Oct · 60 kg × 6');
  });
});
