import { describe, expect, it } from 'vitest';

import {
  applyCheckInPatch,
  asksReasons,
  calculateNextTargets,
  checkInFact,
  clearPainFlag,
  DEFAULT_CHECK_IN_SETTINGS,
  evaluateCheckInOffer,
  localDateOf,
  localMidnightUtcMs,
  localWeekBounds,
  newCheckIn,
  newPainFlag,
  painMentionedNotFlagged,
  painStatusFor,
  reasonsText,
  shouldAskCheckIn,
  toIso,
  toMs,
  weekdayOf,
  type CheckInGateInput,
  type RecentCheckIn,
} from '../src/index';
import { at, barbell, doubleProgression, id, kg, ms, OWNER, T0_MS } from './fixtures';

const base: CheckInGateInput = { settings: DEFAULT_CHECK_IN_SETTINGS, nowMs: T0_MS, weekday: 'thu', entry: 'start', recent: [] };
const recent = (minutesAgo: number, over: Partial<RecentCheckIn> = {}): RecentCheckIn => ({
  id: id(900 + minutesAgo),
  recordedAtUtc: toIso(T0_MS - minutesAgo * 60_000),
  outcome: 'not_started',
  deleted: false,
  linked: false,
  ...over,
});

describe('shouldAskCheckIn (check-in.md §2.1)', () => {
  it('asks on Start when check-ins are on and nothing is reusable', () => {
    expect(shouldAskCheckIn(base)).toEqual({ kind: 'ask' });
  });

  it('skips when off, or when today is not a check-in day', () => {
    expect(shouldAskCheckIn({ ...base, settings: { ...DEFAULT_CHECK_IN_SETTINGS, enabled: false } })).toEqual({ kind: 'skip', reason: 'off' });
    const days = { ...DEFAULT_CHECK_IN_SETTINGS, schedule: { kind: 'days' as const, weekdays: ['mon' as const, 'wed' as const] } };
    expect(shouldAskCheckIn({ ...base, settings: days })).toEqual({ kind: 'skip', reason: 'not_a_check_in_day' });
    expect(shouldAskCheckIn({ ...base, settings: days, weekday: 'wed' })).toEqual({ kind: 'ask' });
  });

  it('reuses the newest unlinked check-in under 2 h old, never a linked, deleted, acted-on or older one', () => {
    expect(shouldAskCheckIn({ ...base, recent: [recent(30), recent(10)] })).toEqual({ kind: 'reuse', checkInId: id(910) });
    expect(shouldAskCheckIn({ ...base, recent: [recent(10, { linked: true })] })).toEqual({ kind: 'ask' });
    expect(shouldAskCheckIn({ ...base, recent: [recent(10, { deleted: true })] })).toEqual({ kind: 'ask' });
    expect(shouldAskCheckIn({ ...base, recent: [recent(10, { outcome: 'skipped_workout' })] })).toEqual({ kind: 'ask' });
    expect(shouldAskCheckIn({ ...base, recent: [recent(120)] })).toEqual({ kind: 'ask' });
    expect(shouldAskCheckIn({ ...base, recent: [recent(119)] })).toEqual({ kind: 'reuse', checkInId: id(1019) });
  });

  it('never asks on resume once any set was committed, or when already decided (check 4, check 22)', () => {
    const resume = { ...base, entry: 'resume' as const };
    expect(shouldAskCheckIn({ ...resume, session: { checkIn: { kind: 'pending' }, anySetEverCommitted: true } })).toEqual({ kind: 'skip', reason: 'set_logged' });
    expect(shouldAskCheckIn({ ...resume, session: { checkIn: { kind: 'skipped', atUtc: at(0).utc }, anySetEverCommitted: false } })).toEqual({
      kind: 'skip',
      reason: 'already_decided',
    });
    expect(shouldAskCheckIn({ ...resume, session: { checkIn: null, anySetEverCommitted: false } })).toEqual({ kind: 'skip', reason: 'already_decided' });
    expect(shouldAskCheckIn({ ...resume, session: { checkIn: { kind: 'pending' }, anySetEverCommitted: false } })).toEqual({ kind: 'ask' });
    // A pending session never reuses an old check-in silently.
    expect(shouldAskCheckIn({ ...resume, recent: [recent(5)], session: { checkIn: { kind: 'pending' }, anySetEverCommitted: false } })).toEqual({ kind: 'ask' });
  });
});

describe('What\'s up? threshold (check 7)', () => {
  it('opens at 3 or lower by default; never with `Never`', () => {
    expect([1, 2, 3, 4, 5].map((s) => asksReasons(s as 1 | 2 | 3 | 4 | 5, DEFAULT_CHECK_IN_SETTINGS))).toEqual([true, true, true, false, false]);
    expect(asksReasons(3, { ...DEFAULT_CHECK_IN_SETTINGS, askReasonsAtOrBelow: 2 })).toBe(false);
    expect(asksReasons(1, { ...DEFAULT_CHECK_IN_SETTINGS, askReasonsAtOrBelow: null })).toBe(false);
  });
});

describe('evaluateCheckInOffer (check-in.md §4.4, check 16)', () => {
  const ci = (score: 1 | 2 | 3 | 4 | 5, reasons: ('tired' | 'stressed' | 'poor_sleep')[] = []) => ({ id: id(5), score, reasons });
  const run = (checkIn: ReturnType<typeof ci>, coach: 'not_connected' | 'offline' | 'available' = 'available', over = {}) =>
    evaluateCheckInOffer({ checkIn, settings: DEFAULT_CHECK_IN_SETTINGS, coach, anySetLogged: false, hasPendingWorkingSet: true, ...over });

  it('offers at 2 or lower, or 3 + Tired; not 3 + Stressed or 4', () => {
    expect(run(ci(2))).toEqual({ kind: 'offer', triggerId: `check_in_low:${id(5)}`, fact: 'You said 2 of 5' });
    expect(run(ci(3, ['tired']))).toMatchObject({ kind: 'offer', fact: 'You said 3 of 5 · Tired' });
    expect(run(ci(3, ['stressed']))).toBeNull();
    expect(run(ci(4))).toBeNull();
    expect(evaluateCheckInOffer({ checkIn: ci(1), settings: { ...DEFAULT_CHECK_IN_SETTINGS, offerAtOrBelow: null, offerOnTiredOrPoorSleep: false }, coach: 'available', anySetLogged: false, hasPendingWorkingSet: true })).toBeNull();
  });

  it('is honest about the coach: nothing when not connected (CI7), one line when offline', () => {
    expect(run(ci(1), 'not_connected')).toBeNull();
    expect(run(ci(1), 'offline')).toEqual({ kind: 'offline_line', text: 'Check-in saved. Coach offline, so today’s plan is unchanged.' });
  });

  it('never appears after a set is logged or with no pending working set', () => {
    expect(run(ci(1), 'available', { anySetLogged: true })).toBeNull();
    expect(run(ci(1), 'available', { hasPendingWorkingSet: false })).toBeNull();
  });
});

describe('check-in records', () => {
  const made = newCheckIn({ id: id(7), ownerId: OWNER, opId: 'op-1', score: 3, reasons: ['poor_sleep', 'tired'], note: '  Baby was up at 3 ', at: at(0), localDate: '2026-10-08' });

  it('stores what Ben said, in chip order, with the scale it was given against', () => {
    expect(made).toMatchObject({ score: 3, reasons: ['tired', 'poor_sleep'], note: 'Baby was up at 3', scale: { version: 1, low: 'rough', high: 'great' }, version: 1, outcome: 'not_started' });
    expect(reasonsText(made.reasons)).toBe('Tired · Poor sleep');
    expect(checkInFact(made)).toBe('You said 3 of 5 · Tired, Poor sleep');
  });

  it('versions every change with history; a retried opId is a duplicate', () => {
    const r = applyCheckInPatch(made, { score: 2, reasons: ['tired', 'pain'], note: null }, 'op-2', at(5));
    if (r.kind !== 'updated') throw new Error(r.kind);
    expect(r.checkIn).toMatchObject({ score: 2, reasons: ['tired', 'pain'], version: 2, appliedOps: ['op-2'] });
    expect(r.checkIn.note).toBeUndefined();
    expect(r.checkIn.history.map((h) => [h.field, h.from, h.to])).toEqual([
      ['score', 3, 2],
      ['reasons', ['tired', 'poor_sleep'], ['tired', 'pain']],
      ['note', 'Baby was up at 3', null],
    ]);
    expect(applyCheckInPatch(r.checkIn, { score: 1 }, 'op-2', at(6))).toEqual({ kind: 'duplicate' });
    expect(applyCheckInPatch(made, { score: 1 }, 'op-1', at(6))).toEqual({ kind: 'duplicate' });
    expect(applyCheckInPatch(made, { score: 3 }, 'op-3', at(6))).toEqual({ kind: 'unchanged' });
  });

  it('flags "pain mentioned, nothing flagged" (CI8) until a movement is flagged', () => {
    const r = applyCheckInPatch(made, { reasons: ['pain'] }, 'op-2', at(5));
    if (r.kind !== 'updated') throw new Error(r.kind);
    expect(painMentionedNotFlagged(r.checkIn)).toBe(true);
    const flagged = applyCheckInPatch(r.checkIn, { painFlagIds: [id(40)] }, 'op-3', at(6));
    if (flagged.kind !== 'updated') throw new Error(flagged.kind);
    expect(painMentionedNotFlagged(flagged.checkIn)).toBe(false);
  });
});

describe('pain flags (rule 9)', () => {
  const flag = newPainFlag({ id: id(40), ownerId: OWNER, opId: 'p1', exerciseId: id(200), exerciseName: 'Bench press', area: 'shoulder', source: 'check_in', checkInId: id(7), at: at(0) });

  it('an active flag halts progression for that movement only; clearing it lifts the halt', () => {
    expect(painStatusFor([flag], id(200))).toEqual({ active: true, reportedAtUtc: at(0).utc });
    expect(painStatusFor([flag], id(201))).toEqual({ active: false, reportedAtUtc: null });
    const cleared = clearPainFlag(flag, at(10));
    expect(cleared).toMatchObject({ status: 'cleared', version: 2 });
    expect(painStatusFor([cleared], id(200)).active).toBe(false);

    const bar = barbell();
    const history = [{ sessionId: id(60), performedAtUtc: at(-86400).utc, equipmentId: bar.id, sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load: kg(100), reps: 8, rpe: null, rir: null })) }];
    const rule = doubleProgression({ repRange: { min: 6, max: 8 }, workingSets: 3 });
    const input = { exerciseName: 'Bench press', measurement: 'reps' as const, history, rule, equipment: bar, unit: 'kg' as const, convention: 'total' as const };
    expect(calculateNextTargets({ ...input, pain: painStatusFor([], id(200)) }).decision).toBe('increase_load');
    expect(calculateNextTargets({ ...input, pain: painStatusFor([flag], id(200)) }).decision).toBe('halted_pain');
  });
});

describe('calendar (weeks run Monday–Sunday)', () => {
  it('local dates, weekdays and week bounds follow the zone, across DST', () => {
    // T0 = 2026-10-08T06:00Z = Thu 8 Oct 19:00 in Auckland (NZDT, +13).
    expect(localDateOf(T0_MS, 'Pacific/Auckland')).toBe('2026-10-08');
    expect(weekdayOf(T0_MS, 'Pacific/Auckland')).toBe('thu');
    expect(localDateOf(ms(6 * 3600), 'Pacific/Auckland')).toBe('2026-10-09');
    const w = localWeekBounds(T0_MS, 'Pacific/Auckland');
    expect(w.mondayLocalDate).toBe('2026-10-05');
    expect(toIso(w.startMs)).toBe('2026-10-04T11:00:00.000Z');
    expect(w.endMs - w.startMs).toBe(7 * 86_400_000);
    // London: BST ends on 25 Oct 2026, so that week is an hour longer.
    const london = localWeekBounds(toMs('2026-10-21T12:00:00.000Z'), 'Europe/London');
    expect(toIso(london.startMs)).toBe('2026-10-18T23:00:00.000Z');
    expect(toIso(london.endMs)).toBe('2026-10-26T00:00:00.000Z');
    expect(toIso(localMidnightUtcMs('2026-03-29', 'Europe/London'))).toBe('2026-03-29T00:00:00.000Z');
  });
});
