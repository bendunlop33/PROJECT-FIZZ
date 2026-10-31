import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { clampWorkoutTimes, reduceSession, START_BACK_MS, summaryTimeBounds, TIME_NOTE, timesNeedDate, wheelNeedsDate, workoutDurationText, workoutTimeBounds } from '../src/index';
import { at, kg, ms, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * Started / Ended wheels on the Finish sheet and a past workout's Edit times (Ben, 19 Oct): start
 * ≤ first logged set, end ≥ last logged set, end ≤ now, end > start; out of range clamps with a note.
 */

/** Two bench sets logged at +10 min and +40 min (the workout started at 0). */
function logged(): SessionAggregate {
  let s = startFixture().state;
  const [w, b1] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 600));
  return apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 2400));
}

describe('workoutTimeBounds and clampWorkoutTimes', () => {
  const s = logged();
  const now = ms(4000);
  const b = workoutTimeBounds(s, now);

  it('start between a day back and the first set; end between the last set and now', () => {
    expect(b).toEqual({ startMinMs: ms(0) - START_BACK_MS, startMaxMs: ms(600), endMinMs: ms(2400), endMaxMs: now });
  });

  it('values inside the bounds are kept', () => {
    expect(clampWorkoutTimes({ startMs: ms(-300), endMs: ms(3000) }, b)).toEqual({ startMs: ms(-300), endMs: ms(3000), note: null });
  });

  it('a start after the first set, an end before the last set, an end in the future: clamped, with the note', () => {
    expect(clampWorkoutTimes({ startMs: ms(900), endMs: ms(3000) }, b)).toEqual({ startMs: ms(600), endMs: ms(3000), note: 'start_after_first_set' });
    expect(clampWorkoutTimes({ startMs: ms(0), endMs: ms(1200) }, b)).toEqual({ startMs: ms(0), endMs: ms(2400), note: 'end_before_last_set' });
    expect(clampWorkoutTimes({ startMs: ms(0), endMs: ms(9000) }, b)).toEqual({ startMs: ms(0), endMs: now, note: 'end_in_future' });
    expect(clampWorkoutTimes({ startMs: ms(0) - START_BACK_MS - 60_000, endMs: ms(3000) }, b).note).toBe('start_too_early');
    expect(TIME_NOTE.end_before_last_set).toBe('End can’t be before the last set');
  });

  it('nothing logged: the end must be after the start, and the start not in the future', () => {
    const empty = startFixture().state;
    const e = workoutTimeBounds(empty, ms(1200));
    expect(e).toMatchObject({ startMaxMs: ms(1200), endMinMs: ms(0) });
    expect(clampWorkoutTimes({ startMs: ms(600), endMs: ms(300) }, e)).toEqual({ startMs: ms(600), endMs: ms(660), note: 'end_before_start' });
    expect(clampWorkoutTimes({ startMs: ms(1500), endMs: ms(1200) }, e)).toMatchObject({ startMs: ms(1200), note: 'start_in_future' });
  });
});

describe('the live duration and the date wheel', () => {
  it('reads 1 h 12 min, 48 min', () => {
    expect(workoutDurationText(ms(0), ms(72 * 60)).replace(/\u00a0/g, ' ')).toBe('1 h 12 min');
    expect(workoutDurationText(ms(0), ms(48 * 60)).replace(/\u00a0/g, ' ')).toBe('48 min');
  });

  it('shows the date when the workout crosses midnight in its own zone', () => {
    // T0 is 19:00 in Auckland (06:00 UTC): to 23:30 is the same day, to 00:30 the next.
    expect(timesNeedDate({ startMs: ms(0), endMs: ms(4.5 * 3600) }, 'Pacific/Auckland')).toBe(false);
    expect(timesNeedDate({ startMs: ms(0), endMs: ms(5.5 * 3600) }, 'Pacific/Auckland')).toBe(true);
  });
});

describe('review S4: the wheel crosses midnight while both times are on one date', () => {
  it('a wheel whose range spans two dates has the date column; one within a day does not', () => {
    // T0 is 19:00 in Auckland: 19:00–23:30 is one date, 23:30–00:30 two.
    expect(wheelNeedsDate(ms(0), ms(4.5 * 3600), 'Pacific/Auckland')).toBe(false);
    expect(wheelNeedsDate(ms(4.5 * 3600), ms(5.5 * 3600), 'Pacific/Auckland')).toBe(true);
  });

  it('a start recorded at 00:05 can move back to 23:50 the day before', () => {
    // Started at T0 + 5 h 5 min (00:05), first set at 00:20, now 01:00.
    const startAt = 5 * 3600 + 300;
    let s = startFixture().state;
    s = apply(s, { type: 'update_session_timing', at: at(startAt), opId: 'move-start', expectedVersion: s.session.version, startedAt: at(startAt), endedAt: null });
    const [w] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), startAt + 900));
    const b = workoutTimeBounds(s, ms(6 * 3600));
    const times = { startMs: ms(startAt), endMs: ms(6 * 3600) };
    expect(timesNeedDate(times, 'Pacific/Auckland')).toBe(false);
    expect(wheelNeedsDate(b.startMinMs, b.startMaxMs, 'Pacific/Auckland')).toBe(true);
    const back = ms(startAt - 15 * 60);
    expect(clampWorkoutTimes({ startMs: back, endMs: times.endMs }, b)).toEqual({ startMs: back, endMs: times.endMs, note: null });
  });
});

describe('review N5: Finish checks a moved start against a pause, like Edit times', () => {
  it('the start wheel stops at the pause, and Finish refuses a start after it', () => {
    let s = startFixture().state;
    s = apply(s, { type: 'pause', at: at(600), opId: 'p' });
    expect(workoutTimeBounds(s, ms(1200)).startMaxMs).toBe(ms(600));
    const finish = (startSec: number, opId: string) => reduceSession(s, { type: 'finish', at: at(1200), opId, expectedVersion: s.session.version, endedAt: at(1200), startedAt: at(startSec) });
    expectError(finish(900, 'f-late'), 'invalid_time');
    expect(expectOk(finish(300, 'f-ok')).state.session.startedAt).toEqual(at(300));
  });
});

describe('a past workout’s Edit times (summaryTimeBounds)', () => {
  it('the same bounds from the Summary, read again now', () => {
    const b = summaryTimeBounds({ startLatestUtc: at(600).utc, endEarliestUtc: at(2400).utc, endLatestUtc: at(3000).utc }, at(0).utc, ms(5000));
    expect(b).toEqual({ startMinMs: ms(0) - START_BACK_MS, startMaxMs: ms(600), endMinMs: ms(2400), endMaxMs: ms(5000) });
    expect(clampWorkoutTimes({ startMs: ms(700), endMs: ms(2000) }, b)).toEqual({ startMs: ms(600), endMs: ms(2400), note: 'start_after_first_set' });
  });
});
