import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, PainFlag, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildAddExerciseCommand,
  buildPainFlagSheet,
  buildTodayView,
  calculateNextTargets,
  clearPainFlag,
  daysBetween,
  explainTarget,
  isPainCheckDue,
  liveReviews,
  localDateText,
  mayHurtAccessibility,
  mayHurtConfirm,
  NBSP,
  newPainFlag,
  nextPainCheckDate,
  painChecksDue,
  painClearConfirm,
  painClearedToast,
  painFlagCovering,
  painFlagFact,
  painFlagHeading,
  painFlagSinceText,
  painKeptText,
  painNoteText,
  painProfessionalNudge,
  painStatusFor,
  recordPainFlagReview,
  restorePainFlag,
  todayPainCheck,
  toIso,
  toMs,
  undoPainFlagReview,
  type HistorySession,
  type HistorySet,
  type TodayInput,
} from '../src/index';
import { assisted, at, barbell, doubleProgression, dumbbells, exercise, id, idGen, kg, ms, OWNER, profile, T0_MS, TZ, values } from './fixtures';
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

/** Record `Still hurts` and return the new flag (throws on anything else). */
function stillHurts(f: PainFlag, when: ZonedTimestamp, opId: string): PainFlag {
  const r = recordPainFlagReview(f, 'still_hurts', opId, when);
  if (r.kind !== 'recorded') throw new Error(`expected recorded, got ${r.kind}`);
  return r.flag;
}

// 6 Oct 2026, 18:00 in London (BST).
const SET_AT = zoned('2026-10-06T17:00:00.000Z');
const londonMs = (date: string, hhmm = '09:00') => {
  // 9:00 local on a date in October/November 2026 (BST until 25 Oct, then GMT).
  const bst = date < '2026-10-25';
  return toMs(`${date}T${hhmm}:00.000Z`) - (bst ? 3_600_000 : 0);
};

describe('the two-weekly check (timing.painReview, active-workout §2.14.2)', () => {
  it('falls due 14 calendar days after the flag was set: on 20 Oct, not on 19 Oct (today checks 19)', () => {
    const f = flag(SET_AT);
    expect(nextPainCheckDate(f)).toBe('2026-10-20');
    expect(isPainCheckDue(f, londonMs('2026-10-19', '23:59'), LONDON)).toBe(false);
    // In the morning of day 14, before the hour it was set: calendar days, not 336 hours.
    expect(isPainCheckDue(f, londonMs('2026-10-20', '07:00'), LONDON)).toBe(true);
    expect(isPainCheckDue(f, londonMs('2026-11-30'), LONDON)).toBe(true);
  });

  it('counts calendar days across the clocks going back (25 Oct)', () => {
    const f = flag(zoned('2026-10-18T23:30:00.000Z')); // 19 Oct 00:30 BST
    expect(nextPainCheckDate(f)).toBe('2026-11-02');
    expect(isPainCheckDue(f, toMs('2026-11-01T23:59:00.000Z'), LONDON)).toBe(false);
    expect(isPainCheckDue(f, toMs('2026-11-02T00:00:00.000Z'), LONDON)).toBe(true);
    expect(daysBetween('2026-10-19', '2026-11-02')).toBe(14);
  });

  it('a cleared flag is never due, and being due changes nothing by itself', () => {
    const f = flag(SET_AT);
    const cleared = clearPainFlag(f, zoned('2026-10-10T08:00:00.000Z'));
    expect(isPainCheckDue(cleared, londonMs('2026-12-01'), LONDON)).toBe(false);
    // Months later with no answer: still active, still due, nothing written.
    expect(f.status).toBe('active');
    expect(isPainCheckDue(f, londonMs('2027-03-01'), LONDON)).toBe(true);
    expect(f.version).toBe(1);
  });

  it('painChecksDue lists only active, due flags, oldest flag first', () => {
    const old = flag(zoned('2026-09-01T08:00:00.000Z'), { exerciseName: 'Bench press' });
    const due = flag(SET_AT);
    const recent = flag(zoned('2026-10-15T08:00:00.000Z'));
    const cleared = clearPainFlag(flag(zoned('2026-09-02T08:00:00.000Z')), zoned('2026-09-20T08:00:00.000Z'));
    expect(painChecksDue([recent, due, cleared, old], londonMs('2026-10-21'), LONDON).map((f) => f.id)).toEqual([old.id, due.id]);
  });
});

describe('recordPainFlagReview / undoPainFlagReview (versioned, idempotent; never clears)', () => {
  const due = zoned('2026-10-22T08:00:00.000Z'); // 22 Oct, 16 days in

  it('Still hurts keeps the flag, bumps the version and moves the next check 14 days from the answer', () => {
    const f = flag(SET_AT);
    const r = recordPainFlagReview(f, 'still_hurts', 'op-1', due);
    expect(r.kind).toBe('recorded');
    if (r.kind !== 'recorded') return;
    expect(r.flag.status).toBe('active');
    expect(r.flag.clearedAtUtc).toBeNull();
    expect(r.flag.version).toBe(2);
    expect(r.flag.reviews).toEqual([{ at: due, answer: 'still_hurts', opId: 'op-1' }]);
    expect(nextPainCheckDate(r.flag)).toBe('2026-11-05');
    expect(plain(painKeptText(r.flag))).toBe('Pain flag kept · next check 5 Nov');
    expect(isPainCheckDue(r.flag, toMs(due.utc), LONDON)).toBe(false);
    // Still stops progression (rule 9).
    expect(painStatusFor([r.flag], BENCH).active).toBe(true);
  });

  it('the same operation twice records one answer (double tap, retry after a crash)', () => {
    const once = stillHurts(flag(SET_AT), due, 'op-dup');
    const again = recordPainFlagReview(once, 'still_hurts', 'op-dup', zoned('2026-10-22T08:00:05.000Z'));
    expect(again.kind).toBe('duplicate');
    if (again.kind === 'duplicate') expect(again.flag).toBe(once);
    expect(once.reviews).toHaveLength(1);
  });

  it('refuses when not due (a second answer from another place) and on a cleared flag', () => {
    const f = flag(SET_AT);
    expect(recordPainFlagReview(f, 'still_hurts', 'early', zoned('2026-10-12T08:00:00.000Z')).kind).toBe('not_due');
    const kept = stillHurts(f, due, 'op-a');
    expect(recordPainFlagReview(kept, 'still_hurts', 'op-b', zoned('2026-10-22T08:01:00.000Z')).kind).toBe('not_due');
    expect(recordPainFlagReview(clearPainFlag(f, due), 'still_hurts', 'op-c', due).kind).toBe('not_active');
  });

  it('Undo makes the check due again exactly as before, keeps the answer for the audit, and is idempotent', () => {
    const f = flag(SET_AT);
    const kept = stillHurts(f, due, 'op-1');
    const u = undoPainFlagReview(kept, 'op-1', 'undo-1', zoned('2026-10-22T08:00:30.000Z'));
    expect(u.kind).toBe('undone');
    if (u.kind !== 'undone') return;
    expect(u.flag.version).toBe(3);
    expect(u.flag.reviews?.[0]?.undone).toEqual({ atUtc: '2026-10-22T08:00:30.000Z', opId: 'undo-1' });
    expect(liveReviews(u.flag)).toEqual([]);
    expect(nextPainCheckDate(u.flag)).toBe(nextPainCheckDate(f));
    expect(isPainCheckDue(u.flag, toMs(due.utc), LONDON)).toBe(true);
    // A retried Undo is a no-op; a different Undo of the same answer is refused.
    expect(undoPainFlagReview(u.flag, 'op-1', 'undo-1', due).kind).toBe('duplicate');
    expect(undoPainFlagReview(u.flag, 'op-1', 'undo-2', due).kind).toBe('already_undone');
    expect(undoPainFlagReview(u.flag, 'nope', 'undo-3', due).kind).toBe('not_found');
    // An undone answer's opId still counts as used: replaying it doesn't record it again.
    expect(recordPainFlagReview(u.flag, 'still_hurts', 'op-1', due).kind).toBe('duplicate');
  });

  it('only the latest answer can be undone, and not after the flag was cleared', () => {
    const first = stillHurts(flag(SET_AT), due, 'op-1');
    const second = stillHurts(first, zoned('2026-11-06T09:00:00.000Z'), 'op-2');
    expect(undoPainFlagReview(second, 'op-1', 'u', due).kind).toBe('not_latest');
    expect(undoPainFlagReview(clearPainFlag(second, due), 'op-2', 'u', due).kind).toBe('not_active');
  });

  it('from the second Still hurts in a row (4 weeks or more) the outcome suggests a physio or doctor', () => {
    const first = stillHurts(flag(SET_AT), due, 'op-1');
    expect(painProfessionalNudge(first, toMs(due.utc), LONDON)).toBeNull();
    const at2 = zoned('2026-11-06T09:00:00.000Z');
    const second = stillHurts(first, at2, 'op-2');
    expect(painProfessionalNudge(second, toMs(at2.utc), LONDON)).toBe('It’s been 4 weeks. Pain that lasts this long is worth getting checked by a physio or doctor.');
    // Later answers count the real weeks.
    const at3 = zoned('2026-11-24T09:00:00.000Z');
    const third = stillHurts(second, at3, 'op-3');
    expect(painProfessionalNudge(third, toMs(at3.utc), LONDON)).toMatch(/^It’s been 7 weeks\./);
    // Undoing the second takes the line away again.
    const u = undoPainFlagReview(second, 'op-2', 'u2', at2);
    expect(u.kind === 'undone' ? painProfessionalNudge(u.flag, toMs(at2.utc), LONDON) : 'x').toBeNull();
  });

  it('a restored flag (Undo of a clear) keeps its answers and its due date', () => {
    const kept = stillHurts(flag(SET_AT), due, 'op-1');
    const back = restorePainFlag(clearPainFlag(kept, zoned('2026-10-23T08:00:00.000Z')), zoned('2026-10-23T08:00:05.000Z'));
    expect(back.reviews).toEqual(kept.reviews);
    expect(nextPainCheckDate(back)).toBe('2026-11-05');
  });
});

describe('copy (active-workout §5, exercise-library §5, today.md §5)', () => {
  const f = flag(SET_AT);
  const now = londonMs('2026-10-22');

  it('picker: `May hurt` confirm with area and date; no area reads `pain` alone; never “safe”', () => {
    expect(mapPlain(mayHurtConfirm(f))).toEqual({
      title: 'Overhead press may hurt',
      message: 'You flagged shoulder pain on it on 6 Oct. Loads won’t go up while the flag is on.',
      confirm: 'Add anyway',
      cancel: 'Choose another',
    });
    expect(plain(mayHurtConfirm({ ...f, area: null }).message)).toBe('You flagged pain on it on 6 Oct. Loads won’t go up while the flag is on.');
    expect(plain(mayHurtConfirm({ ...f, area: 'other' }).message)).toBe('You flagged pain on it on 6 Oct. Loads won’t go up while the flag is on.');
    expect(mayHurtAccessibility(f)).toBe('May hurt: you flagged shoulder pain on it.');
    expect(JSON.stringify(mayHurtConfirm(f)).toLowerCase()).not.toMatch(/safe|injur|strain|tendon/);
  });

  it('note, check and sheet lines', () => {
    expect(painNoteText(false)).toBe('Pain flag: no increases');
    expect(painNoteText(true)).toBe('Pain flag: no increases · check due');
    expect(plain(painFlagFact(f, now, LONDON))).toBe('Pain flag since 6 Oct · 16 days');
    expect(painFlagHeading(f)).toBe('Overhead press · shoulder');
    expect(painFlagHeading({ ...f, area: null })).toBe('Overhead press');
    expect(plain(painFlagSinceText(f, now, LONDON))).toBe('Since 6 Oct (16 days) · you, in a check-in');
    expect(plain(painFlagSinceText({ ...f, source: 'workout' }, toMs(SET_AT.utc), LONDON))).toBe('Since 6 Oct (today) · you, during a workout');
    expect(plain(painFlagFact(f, londonMs('2026-10-07'), LONDON))).toBe('Pain flag since 6 Oct · 1 day');
  });

  it('clear confirmation (AW10): default wording, the reference kept, and the toast', () => {
    expect(mapPlain(painClearConfirm(f))).toEqual({
      title: 'Clear the pain flag on Overhead press?',
      message: 'Loads, reps and sets can go up again, starting from your recent sets. Your sets from before 6 Oct stay in your history as the reference.',
      confirm: 'Clear flag',
      cancel: 'Keep it',
    });
    expect(painClearedToast('Overhead press')).toEqual({ text: 'Pain flag cleared for Overhead press', action: 'Undo' });
  });

  it('Today row: one due, several due, none', () => {
    expect(todayPainCheck([f], now, LONDON)).toEqual({ kind: 'one', flagId: f.id, text: 'Still hurts? Overhead press · flagged 16 days ago', accessibilityLabel: 'Pain flag check due: Overhead press, flagged 16 days ago.' });
    const other = flag(zoned('2026-10-01T08:00:00.000Z'), { exerciseName: 'Bench press' });
    expect(todayPainCheck([f, other], now, LONDON)).toEqual({ kind: 'several', count: 2, text: 'Still hurts? 2 pain flags to check', accessibilityLabel: 'Pain flag checks due: 2 flags.' });
    expect(todayPainCheck([f], londonMs('2026-10-19'), LONDON)).toBeNull();
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
    expect(painFlagCovering([ohp, cleared], BENCH, londonMs('2026-10-10'), LONDON)).toEqual({ flag: ohp, checkDue: false });
    expect(painFlagCovering([ohp, cleared], lateral, londonMs('2026-10-10'), LONDON)).toBeNull();
    expect(painFlagCovering([ohp], lateral, londonMs('2026-10-10'), LONDON)).toBeNull();
  });

  it('with two flags on one exercise, the due one is the one the note and check use', () => {
    const unanswered = flag(zoned('2026-09-01T08:00:00.000Z'));
    const answered = stillHurts(flag(SET_AT), zoned('2026-10-20T08:00:00.000Z'), 'k');
    expect(painFlagCovering([answered, unanswered], BENCH, londonMs('2026-10-21'), LONDON)?.flag.id).toBe(unanswered.id);
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

describe('PainFlagNote and the rest card’s Still hurts? (checks 32, 51)', () => {
  it('the note reads `check due` when due, and is plain otherwise; it never changes Log', () => {
    const { state } = startFixture();
    const plainView = view(state, []);
    const due = view(state, [benchFlag(16)]);
    const notDue = view(state, [benchFlag(5)]);
    expect(plainView.focus?.painFlag).toBeNull();
    expect(due.focus?.painFlag).toMatchObject({ checkDue: true, text: 'Pain flag: no increases · check due' });
    expect(due.focus?.painFlagged).toBe(true);
    expect(notDue.focus?.painFlag).toMatchObject({ checkDue: false, text: 'Pain flag: no increases' });
    expect(due.primary).toEqual(plainView.primary);
    expect(due.focus?.logLabel).toBe(plainView.focus?.logLabel);
  });

  it('asks once, right after the first set of the flagged movement; the next Log moves on and it isn’t asked again', () => {
    const f = benchFlag(16);
    let s = startFixture().state;
    expect(view(s, [f]).painReview).toBeNull();
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 100));
    const first = view(s, [f], 120);
    expect(first.painReview).toMatchObject({ flagId: f.id, flagVersion: 1, exerciseName: 'Bench press', afterSetId: bench[0]?.id, question: 'Bench press: still hurting?' });
    expect(plain(first.painReview?.fact)).toBe('Pain flag since 22 Sep · 16 days');
    // Rebuilt from the same stored state (a force-close and relaunch): the same line.
    expect(view(structuredClone(s), [f], 130).painReview).toEqual(first.painReview);
    s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 8), 300));
    expect(view(s, [f], 320).painReview).toBeNull();
  });

  it('isn’t asked when the check isn’t due, after it was answered, or for an unflagged movement', () => {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 100));
    expect(view(s, [benchFlag(5)], 120).painReview).toBeNull();
    const answered = stillHurts(benchFlag(16), at(50), 'answered');
    expect(view(s, [answered], 120).painReview).toBeNull();
    expect(view(s, [benchFlag(16, { exerciseId: id(999) })], 120).painReview).toBeNull();
  });

  it('with the movement in the workout twice, only the first set overall asks', () => {
    const f = benchFlag(16);
    let s = startFixture().state;
    const ids = idGen(80_000);
    s = apply(s, buildAddExerciseCommand({ opId: 'again', owner: profile(), exercise: exercise(200, 'Bench press'), equipmentId: barbell().id, at: at(50), newId: ids, plan: [{ setType: 'working', planned: { load: kg(90), reps: { min: 8, max: 8 }, durationS: null, rpe: null, rir: null } }] }));
    const second = s.exercises.at(-1);
    const extra = s.sets.find((x) => x.sessionExerciseId === second?.id);
    s = apply(s, logCmd(extra?.id ?? '', values(kg(90), 8), 100));
    expect(view(s, [f], 120).painReview?.afterSetId).toBe(extra?.id);
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 200));
    expect(view(s, [f], 220).painReview).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Today (region 4b)

function todayInput(over: Partial<TodayInput>): TodayInput {
  return { nowMs: londonMs('2026-10-22'), active: null, finishedThisWeek: [], todayLocalDate: '2026-10-22', localDateOf: () => '2026-10-22', recentCheckIns: [], ...over };
}

describe('buildTodayView: the Still hurts? row (today checks 19–20)', () => {
  it('shows a flag set 14 days ago and not one set 13 days ago', () => {
    const fourteen = flag(zoned('2026-10-08T17:00:00.000Z'));
    const thirteen = flag(zoned('2026-10-09T17:00:00.000Z'));
    expect(buildTodayView(todayInput({ painFlags: [fourteen], tz: LONDON })).painCheck).toMatchObject({ kind: 'one', flagId: fourteen.id });
    expect(buildTodayView(todayInput({ painFlags: [thirteen], tz: LONDON })).painCheck).toBeNull();
  });

  it('is hidden while a workout is in progress (the workout asks in place)', () => {
    const { state } = startFixture();
    const v = buildTodayView(todayInput({ nowMs: ms(60), active: state, painFlags: [flag(SET_AT)], tz: LONDON }));
    expect(v.main.kind).toBe('resume');
    expect(v.painCheck).toBeNull();
  });

  it('reads nothing without the flags and zone (older callers)', () => {
    expect(buildTodayView(todayInput({ painFlags: [flag(SET_AT)] })).painCheck).toBeNull();
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

  it('before the flag (the reference) and since the flag, both as actual results; Still hurts? only when due', () => {
    const sheet = buildPainFlagSheet({ flag: f, history, nowMs: ms(9 * DAY), tz: TZ, exercise: press, anchor: { equipmentId: BAR.id, unit: 'kg', loadConvention: 'total', equipment: BAR } });
    expect(sheet.heading).toBe('Overhead press · shoulder');
    expect(plain(sheet.since)).toBe('Since 13 Oct (4 days) · you, in a check-in');
    expect(sheet.effect).toBe('No increases in load, reps or sets.');
    expect(plain(sheet.before)).toBe('8 Oct · 57.5 kg × 5, 4');
    expect(plain(sheet.sinceFlag)).toBe('16 Oct · 50 kg × 8, 8, 8');
    expect(sheet.checkDue).toBe(false);
    expect(sheet.professional).toBe('Sharp or lasting pain: see a physio or doctor.');
    expect(buildPainFlagSheet({ flag: f, history, nowMs: ms(20 * DAY), tz: TZ, exercise: press }).checkDue).toBe(true);
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

  it('no history: no rows invented; imported workouts are never the reference', () => {
    expect(buildPainFlagSheet({ flag: f, history: [], nowMs: ms(9 * DAY), tz: TZ, exercise: press })).toMatchObject({ before: null, sinceFlag: null });
    const imported = [hs(-3, [[60, 5]], { imported: true })];
    expect(buildPainFlagSheet({ flag: f, history: imported, nowMs: ms(9 * DAY), tz: TZ, exercise: press })).toMatchObject({ before: null, sinceFlag: null });
  });

  it('a flag cleared elsewhere says so and asks nothing', () => {
    const cleared = clearPainFlag(f, at(7 * DAY));
    const sheet = buildPainFlagSheet({ flag: cleared, history, nowMs: ms(30 * DAY), tz: TZ, exercise: press });
    expect(sheet).toMatchObject({ active: false, checkDue: false });
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

  it('Why? marks the Pain row `Check due ›` only while the check is due', () => {
    let s = startFixture().state;
    const set = setsFor(s, BENCH)[1];
    const explain = (flags: PainFlag[], nowS: number) => explainTarget({ aggregate: s, setId: set?.id ?? '', nowMs: ms(nowS), basisNow: null, gymNames: {}, painFlags: flags, history: [] });
    const due = benchFlag(16);
    expect(explain([due], 10)?.rows.find((r) => r.key === 'pain')?.link).toEqual({ kind: 'pain_flag', flagId: due.id, label: 'Check due ›' });
    expect(explain([benchFlag(3)], 10)?.rows.find((r) => r.key === 'pain')?.link).toBeUndefined();
    s = apply(s, logCmd(setsFor(s, BENCH)[0]?.id ?? '', values(kg(60), 10), 100));
    expect(explain([stillHurts(due, at(50), 'x')], 120)?.rows.find((r) => r.key === 'pain')?.link).toBeUndefined();
  });

  it('lb sanity: the reference never mixes units (lb history next to kg equipment is skipped)', () => {
    const mixed = [hs(-6, [[135, 8]], {}, 'total', 'lb'), hs(-2, [[60, 6]])];
    const sheet = buildPainFlagSheet({ flag: f, history: mixed, nowMs: ms(9 * DAY), tz: TZ, exercise: { measurement: 'reps', defaultLoadConvention: 'total' }, anchor: { equipmentId: BAR.id, unit: 'kg', loadConvention: 'total', equipment: BAR } });
    expect(plain(sheet.before)).toBe('6 Oct · 60 kg × 6');
  });
});
