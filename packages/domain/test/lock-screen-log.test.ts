import { describe, expect, it } from 'vitest';

import type { LoadConvention, SessionAggregate, WorkoutSet } from '@fizz/schemas';
import {
  buildActiveSetView,
  buildLockScreenContent,
  LOCK_SCREEN_LOG_MAX_AGE_MS,
  LOCK_SCREEN_LOG_NOTICE_MS,
  lockScreenLogCommand,
  lockScreenLoggedNotice,
  lockScreenLogOf,
  lockScreenLogOpId,
  lockScreenLogTarget,
  lockScreenTapBase,
  parseLockScreenLog,
  parseLockScreenTap,
  reduceSession,
  toMs,
  type ComparableSet,
  type LockScreenLogTap,
} from '../src/index';
import { at, kg, lb, ms, TZ, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * `Log` on the Lock Screen (Ben, 27 Oct 2026; lock-screen-and-alerts §2.1,
 * §4.2): the current set's values as the in-app Log would save them, a target
 * carrying the set's version and those values, a deterministic operation ID
 * (double tap / retry log once), refusal on a newer set (rule 5), and the
 * `Set 2 logged from Lock Screen · Undo` notice.
 */

const plain = (s: string | undefined) => (s ?? '').replaceAll(' ', ' ');

function bench(state: SessionAggregate): { warm: WorkoutSet; b1: WorkoutSet; b2: WorkoutSet } {
  const [warm, b1, b2] = setsFor(state, BENCH);
  if (!warm || !b1 || !b2) throw new Error('fixture: bench has a warm-up and two working sets');
  return { warm, b1, b2 };
}

/** The warm-up logged at 30 s; its 60 s rest runs out at 90 s. */
function afterWarmup(state = startFixture().state, warmLoad = kg(60)): SessionAggregate {
  return apply(state, logCmd(bench(state).warm.id, values(warmLoad, 10), 30));
}

/** The bench row in another unit or load convention (planned loads to match). */
function benchAs(state: SessionAggregate, convention: LoadConvention, unit: 'kg' | 'lb', load: number): SessionAggregate {
  const ids = new Set(setsFor(state, BENCH).map((s) => s.id));
  return {
    ...state,
    exercises: state.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, loadConvention: convention, unit } : e)),
    sets: state.sets.map((x) => (ids.has(x.id) ? { ...x, planned: { ...x.planned, load: convention === 'bodyweight' ? null : { value: x.setType === 'warmup' ? load / 2 : load, unit, convention } } } : x)),
  };
}

function tapOf(state: SessionAggregate, setId: string): LockScreenLogTap {
  const log = lockScreenLogOf(state, setId);
  if (!log) throw new Error('no Log');
  const tap = parseLockScreenLog(lockScreenLogTarget(log));
  if (!tap) throw new Error('target did not parse');
  return tap;
}

describe('lockScreenLogOf: what Log shows and saves', () => {
  it('Ready shows `Log 100 kg × 8` for the next set: the target, top of the range, no effort', () => {
    const s = afterWarmup();
    const { b1 } = bench(s);
    const c = buildLockScreenContent(s, ms(91), TZ);
    expect(c?.state).toBe('ready');
    expect(plain(c?.log?.label)).toBe('Log 100 kg × 8');
    expect(c?.log?.a11y).toBe('Log 100 kilograms, 8 reps');
    expect(c?.log).toMatchObject({ setId: b1.id, setVersion: b1.version, values: values(kg(100), 8), side: null });
    // During the rest there is no Log on the live state; the Ready content written with it has one.
    const resting = buildLockScreenContent(s, ms(40), TZ);
    expect(resting?.state).toBe('resting');
    expect(resting?.log).toBeNull();
    expect(resting?.afterRest?.log).toEqual(c?.log);
  });

  it('is exactly the in-app Log (one definition): values and label match the card', () => {
    let s = afterWarmup();
    for (let i = 0; i < 4; i += 1) {
      const active = s.session.activeSetId;
      const view = buildActiveSetView({ aggregate: s, nowMs: ms(1000 + i * 400), gymName: null, previous: {}, painFlagged: new Set(), edits: null, withTimeLeft: false });
      const log = lockScreenLogOf(s, active);
      expect(log?.values).toEqual(view.focus?.logValues);
      expect(log?.label).toBe(view.focus?.logLabel);
      if (!log || active === null) throw new Error('no Log');
      s = apply(s, logCmd(active, log.values, 1000 + i * 400 + 10));
    }
  });

  it('Ben’s saved draft wins over the target, effort included; the set version moves with it', () => {
    const s0 = afterWarmup();
    const { b1 } = bench(s0);
    const s = apply(s0, { type: 'save_draft', at: at(95), setId: b1.id, values: values(kg(102.5), 6, { rir: 2 }) });
    const log = lockScreenLogOf(s, b1.id);
    expect(plain(log?.label)).toBe('Log 102.5 kg × 6');
    expect(log?.values).toEqual(values(kg(102.5), 6, { rir: 2 }));
    // A draft doesn't move the set's version; the draft key tells the two pictures apart.
    expect(log?.setVersion).toBe(b1.version);
    expect(log?.draftKey).not.toBe(lockScreenLogOf(s0, b1.id)?.draftKey);
  });

  it('kg/lb: a pound row logs pounds', () => {
    const s = afterWarmup(benchAs(startFixture().state, 'total', 'lb', 225), lb(95));
    const log = lockScreenLogOf(s, bench(s).b1.id);
    expect(plain(log?.label)).toBe('Log 225 lb × 8');
    expect(log?.a11y).toBe('Log 225 pounds, 8 reps');
    expect(log?.values.load).toEqual(lb(225));
  });

  it('per-hand dumbbells say `each` and log the per-dumbbell load', () => {
    const s = afterWarmup(benchAs(startFixture().state, 'per_hand', 'kg', 22.5), kg(10, 'per_hand'));
    const log = lockScreenLogOf(s, bench(s).b1.id);
    expect(plain(log?.label)).toBe('Log 22.5 kg each × 8');
    expect(log?.values.load).toEqual(kg(22.5, 'per_hand'));
  });

  it('assisted machines log the assistance; bodyweight logs no load', () => {
    const assisted = afterWarmup(benchAs(startFixture().state, 'assistance', 'kg', 20), kg(40, 'assistance'));
    const a = lockScreenLogOf(assisted, bench(assisted).b1.id);
    expect(a?.values.load).toEqual(kg(20, 'assistance'));
    expect(plain(a?.label)).toBe('Log Assist 20 kg × 8');
    const bw = afterWarmup(benchAs(startFixture().state, 'bodyweight', 'kg', 0), { value: 0, unit: 'kg', convention: 'bodyweight' });
    const b = lockScreenLogOf(bw, bench(bw).b1.id);
    expect(b?.values.load).toEqual({ value: 0, unit: 'kg', convention: 'bodyweight' });
    expect(b?.values.reps).toBe(8);
    expect(plain(b?.label)).toBe('Log BW × 8');
  });

  it('the equipment-snapped target is what is logged, never a load past it', () => {
    const s = afterWarmup(startFixture({ benchTarget: 102.5 }).state);
    const log = lockScreenLogOf(s, bench(s).b1.id);
    expect(log?.values.load).toEqual(bench(s).b1.planned.load);
  });

  it('no Log for a timed set, a missing value, a warm-up without a draft, paused, or a finished set', () => {
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    expect(lockScreenLogOf(state, hang?.id ?? null)).toBeNull();
    // The warm-up (its load is the warm-up planner's) …
    expect(lockScreenLogOf(state, bench(state).warm.id)).toBeNull();
    // … unless Ben saved its values.
    const drafted = apply(state, { type: 'save_draft', at: at(5), setId: bench(state).warm.id, values: values(kg(60), 10) });
    expect(plain(lockScreenLogOf(drafted, bench(state).warm.id)?.label)).toBe('Log 60 kg × 10');
    const s = afterWarmup();
    const paused = apply(s, { type: 'pause', at: at(95), opId: 'p' });
    expect(lockScreenLogOf(paused, bench(s).b1.id)).toBeNull();
    expect(lockScreenLogOf(s, bench(s).warm.id)).toBeNull();
    expect(lockScreenLogOf(s, null)).toBeNull();
    // No target load, nothing logged today and no history: nothing to log blind.
    const noLoad = { ...state, sets: state.sets.map((x) => (x.id === bench(state).b1.id ? { ...x, planned: { ...x.planned, load: null } } : x)) };
    expect(lockScreenLogOf(noLoad, bench(state).b1.id, { lastComparable: () => [] })).toBeNull();
  });

  it('values that would come from last time wait until history is read', () => {
    const s0 = startFixture().state;
    const { b1 } = bench(s0);
    const s = { ...s0, sets: s0.sets.map((x) => (x.id === b1.id ? { ...x, planned: { ...x.planned, load: null } } : x)) };
    // Nothing logged today to carry from, and no lookup yet: no Log.
    expect(lockScreenLogOf(s, b1.id)).toBeNull();
    const h: ComparableSet[] = [{ index: b1.index, values: values(kg(97.5), 8) }];
    expect(plain(lockScreenLogOf(s, b1.id, { lastComparable: () => h })?.label)).toBe('Log 97.5 kg × 8');
  });

  it('unilateral: the side travels with the Log and the label says `per side`', () => {
    const s0 = afterWarmup();
    const s = { ...s0, exercises: s0.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, laterality: 'unilateral' as const } : e)) };
    const log = lockScreenLogOf(s, bench(s).b1.id);
    expect(log?.side).toBe('both');
    expect(plain(log?.label)).toBe('Log 100 kg × 8 per side');
    expect(parseLockScreenLog(lockScreenLogTarget(log ?? (null as never)))?.side).toBe('both');
  });

  it('supersets: after the row, Ready shows the face pull with its own Log', () => {
    let s = afterWarmup();
    const { b1, b2 } = bench(s);
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 200));
    s = apply(s, logCmd(b2.id, values(kg(100), 8), 500));
    const r1 = setsFor(s, ROW)[0];
    s = apply(s, logCmd(r1?.id ?? '', values(kg(50, 'stack'), 12), 800));
    const f1 = setsFor(s, FACE)[0];
    expect(s.session.activeSetId).toBe(f1?.id);
    const c = buildLockScreenContent(s, ms(2000), TZ);
    expect(c?.state).toBe('ready');
    expect(c?.log?.setId).toBe(f1?.id);
    expect(plain(c?.log?.label)).toBe('Log 20 kg stack × 15');
  });

  it('the last set: once everything is logged, Ready says to finish in the app, with no Log', () => {
    let s = afterWarmup();
    let t = 100;
    while (s.session.activeSetId !== null) {
      const id = s.session.activeSetId;
      const hang = setsFor(s, HANG)[0];
      t += 400;
      s = apply(s, logCmd(id, id === hang?.id ? values(null, null, { durationS: 45, load: { value: 0, unit: 'kg', convention: 'bodyweight' } }) : (lockScreenLogOf(s, id)?.values ?? values(kg(50, 'stack'), 10)), t));
    }
    const c = buildLockScreenContent(s, ms(t + 600), TZ);
    expect(c?.line1).toBe('All sets done');
    expect(c?.line2).toBe('Open GymSmarter to finish');
    expect(c?.a11y).toMatch(/Open GymSmarter to finish\.$/);
    expect(c?.log).toBeNull();
  });
});

describe('Log targets', () => {
  it('round-trip: the target carries the workout, set, version, values and side', () => {
    const s = afterWarmup();
    const log = lockScreenLogOf(s, bench(s).b1.id);
    if (!log) throw new Error('no Log');
    const target = lockScreenLogTarget(log);
    expect(target).toBe(`fizz.log|${s.session.id}|${log.setId}|${String(log.setVersion)}|${log.draftKey}|100|kg|total|8|-|-|-`);
    expect(parseLockScreenLog(target)).toEqual({ sessionId: s.session.id, setId: log.setId, setVersion: log.setVersion, draftKey: log.draftKey, values: log.values, side: null });
    // Decimal loads and effort survive.
    const t2 = lockScreenLogTarget({ ...log, values: values(kg(22.5, 'per_hand'), 10, { rpe: 8.5, rir: 2 }), side: 'left' });
    expect(parseLockScreenLog(t2)).toMatchObject({ values: values(kg(22.5, 'per_hand'), 10, { rpe: 8.5, rir: 2 }), side: 'left' });
  });

  it('rest buttons and Log never read each other’s targets; malformed targets are not ours', () => {
    const s = afterWarmup();
    const log = lockScreenLogOf(s, bench(s).b1.id);
    const target = lockScreenLogTarget(log ?? (null as never));
    expect(parseLockScreenTap(target)).toBeNull();
    const t = s.restTimer;
    expect(parseLockScreenLog(`${lockScreenTapBase(s.session.id, { timerId: t?.id ?? '', timerVersion: 1 })}|skip`)).toBeNull();
    const parts = target.split('|');
    const swap = (i: number, v: string) => parts.map((p, j) => (j === i ? v : p)).join('|');
    for (const bad of [
      undefined,
      7,
      '',
      'fizz.log|a|b|1',
      swap(0, 'fizz.rest'),
      swap(1, ''),
      swap(3, '0'),
      swap(3, '1.5'),
      swap(4, 'NOT-KEY'),
      swap(5, '-5'),
      swap(5, '1e3'),
      swap(6, 'st'),
      swap(7, 'machine'),
      swap(8, '8.5'),
      swap(9, 'middle'),
      swap(10, 'hard'),
      `${target}|x`,
      `fizz.log|${'a'.repeat(500)}|b|1|abcdefg|100|kg|total|8|-|-|-`,
    ]) {
      expect(parseLockScreenLog(bad)).toBeNull();
    }
  });
});

describe('lockScreenLogCommand', () => {
  it('becomes the in-app `log_set` at the tap time, with a fixed opId and the drawn set version', () => {
    const s = afterWarmup();
    const { b1 } = bench(s);
    const tap = tapOf(s, b1.id);
    const d = lockScreenLogCommand(s, tap, at(100), ms(95));
    if (d.kind !== 'dispatch') throw new Error(d.reason);
    expect(d.command).toMatchObject({ type: 'log_set', at: at(95), opId: `lock:log:${b1.id}:${String(b1.version)}`, setId: b1.id, values: values(kg(100), 8), expectedSetVersion: b1.version });
    expect(d.command.opId).toBe(lockScreenLogOpId(tap));
    // The same tap again: the same command, rest timer ID included.
    expect(lockScreenLogCommand(s, tap, at(101), ms(95))).toEqual(d);
  });

  it('applied, it logs the set and starts the next rest from the tap; the same command again is a duplicate (rule 5)', () => {
    const s = afterWarmup();
    const { b1, b2 } = bench(s);
    const d = lockScreenLogCommand(s, tapOf(s, b1.id), at(100), ms(95));
    if (d.kind !== 'dispatch') throw new Error(d.reason);
    const r = expectOk(reduceSession(s, d.command));
    const done = r.state.sets.find((x) => x.id === b1.id);
    expect(done?.status).toBe('completed');
    expect(done?.actual).toEqual(values(kg(100), 8));
    expect(done?.completedAt?.utc).toBe(at(95).utc);
    expect(r.state.restTimer?.status).toBe('running');
    expect(toMs(r.state.restTimer?.startedAtUtc ?? '')).toBe(ms(95));
    expect(toMs(r.state.restTimer?.deadlineUtc ?? '')).toBe(ms(95 + 180));
    expect(r.state.session.activeSetId).toBe(b2.id);
    const again = expectOk(reduceSession(r.state, d.command));
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(r.state);
    // Read again after the write, the tap is simply done.
    expect(lockScreenLogCommand(r.state, tapOf(s, b1.id), at(102), ms(95))).toEqual({ kind: 'ignore', reason: 'already_logged' });
  });

  it('a tap read late (the app was killed) logs at the tap time, never before the last activity', () => {
    const s = afterWarmup();
    const tap = tapOf(s, bench(s).b1.id);
    const late = lockScreenLogCommand(s, tap, at(3600), ms(95));
    expect(late.kind === 'dispatch' ? late.command.at.utc : null).toBe(at(95).utc);
    // An implausible tap time (before the warm-up was logged) is clamped to the last activity.
    const early = lockScreenLogCommand(s, tap, at(100), ms(10));
    expect(early.kind === 'dispatch' ? early.command.at.utc : null).toBe(s.session.lastActivityAtUtc);
  });

  it('ignored: too old, no workout, another workout, paused, logged in the app, edited since, not loggable', () => {
    const s = afterWarmup();
    const { b1 } = bench(s);
    const tap = tapOf(s, b1.id);
    const reason = (d: ReturnType<typeof lockScreenLogCommand>) => (d.kind === 'ignore' ? d.reason : 'dispatch');
    expect(reason(lockScreenLogCommand(s, tap, at(100), ms(100) - LOCK_SCREEN_LOG_MAX_AGE_MS - 1))).toBe('too_old');
    expect(reason(lockScreenLogCommand(null, tap, at(100), ms(95)))).toBe('no_workout');
    expect(reason(lockScreenLogCommand(s, { ...tap, sessionId: 'other' }, at(100), ms(95)))).toBe('other_workout');
    expect(reason(lockScreenLogCommand(apply(s, { type: 'pause', at: at(96), opId: 'p' }), tap, at(100), ms(95)))).toBe('paused');
    // Logged in the app first (any values): the Lock Screen tap does nothing.
    const inApp = apply(s, logCmd(b1.id, values(kg(105), 6), 97));
    expect(reason(lockScreenLogCommand(inApp, tap, at(100), ms(95)))).toBe('already_logged');
    // Edited in the app since it was drawn: refused, never logged with the old values.
    const edited = apply(s, { type: 'save_draft', at: at(96), setId: b1.id, values: values(kg(105), 6) });
    expect(reason(lockScreenLogCommand(edited, tap, at(100), ms(95)))).toBe('stale');
    // Drawn from a draft that Ben has since changed back: still a different picture.
    const fromDraft = tapOf(edited, b1.id);
    const redrafted = apply(edited, { type: 'save_draft', at: at(97), setId: b1.id, values: values(kg(100), 8) });
    expect(reason(lockScreenLogCommand(redrafted, fromDraft, at(100), ms(96)))).toBe('stale');
    // Logged, then Undone: a newer version of the same set.
    const undone = apply(inApp, { type: 'undo_log', at: at(98), opId: 'u', setId: b1.id, expectedSetVersion: inApp.sets.find((x) => x.id === b1.id)?.version ?? 0 });
    expect(reason(lockScreenLogCommand(undone, tap, at(100), ms(95)))).toBe('stale');
    expect(reason(lockScreenLogCommand(s, { ...tap, setId: 'gone' }, at(100), ms(95)))).toBe('stale');
    const hang = setsFor(s, HANG)[0];
    expect(reason(lockScreenLogCommand(s, { ...tap, setId: hang?.id ?? '', setVersion: hang?.version ?? 1 }, at(100), ms(95)))).toBe('not_loggable');
  });

  it('reducer: `expectedSetVersion` refuses a log drawn for an older version (stale_version); omitted, the in-app log is unchanged', () => {
    const s = afterWarmup();
    const { b1 } = bench(s);
    const d = lockScreenLogCommand(s, tapOf(s, b1.id), at(100), ms(95));
    if (d.kind !== 'dispatch') throw new Error(d.reason);
    // Logged in the app and Undone: the set is pending again at a newer version.
    const logged = apply(s, logCmd(b1.id, values(kg(105), 6), 97));
    const undone = apply(logged, { type: 'undo_log', at: at(98), opId: 'u', setId: b1.id, expectedSetVersion: logged.sets.find((x) => x.id === b1.id)?.version ?? 0 });
    expectError(reduceSession(undone, d.command), 'stale_version');
    expectOk(reduceSession(undone, logCmd(b1.id, values(kg(105), 6), 101, 'in-app-again')));
  });
});

describe('lockScreenLoggedNotice: `Set 1 logged from Lock Screen · Undo` on the next open', () => {
  function lockLogged() {
    const s = afterWarmup();
    const { b1 } = bench(s);
    const d = lockScreenLogCommand(s, tapOf(s, b1.id), at(100), ms(95));
    if (d.kind !== 'dispatch') throw new Error(d.reason);
    return { s: expectOk(reduceSession(s, d.command)).state, b1, opId: d.command.opId };
  }

  it('names the set, offers the same versioned Undo as the app, and Undo puts the set back with its values', () => {
    const { s, b1, opId } = lockLogged();
    const n = lockScreenLoggedNotice(s, ms(160));
    expect(n).toEqual({ opId, setId: b1.id, stepName: 'Set 1', text: 'Set 1 logged from Lock Screen', undoOpId: `undo:${b1.id}:0` });
    const set = s.sets.find((x) => x.id === b1.id);
    const undone = expectOk(reduceSession(s, { type: 'undo_log', at: at(170), opId: n?.undoOpId ?? '', setId: b1.id, expectedSetVersion: set?.version ?? 0 })).state;
    const back = undone.sets.find((x) => x.id === b1.id);
    expect(back?.status).toBe('pending');
    expect(back?.draft).toMatchObject({ reps: 8 });
    expect(undone.restTimer?.status).not.toBe('running');
    expect(lockScreenLoggedNotice(undone, ms(171))).toBeNull();
  });

  it('none for an in-app log, after a newer set, after the notice window, or for a finished workout', () => {
    expect(lockScreenLoggedNotice(apply(afterWarmup(), logCmd(bench(afterWarmup()).b1.id, values(kg(100), 8), 100)), ms(110))).toBeNull();
    const { s, b1 } = lockLogged();
    expect(lockScreenLoggedNotice(s, ms(95) + LOCK_SCREEN_LOG_NOTICE_MS + 1)).toBeNull();
    const next = apply(s, logCmd(bench(s).b2.id, values(kg(100), 8), 400));
    expect(lockScreenLoggedNotice(next, ms(410))).toBeNull();
    expect(lockScreenLoggedNotice({ ...s, session: { ...s.session, status: 'finished' } }, ms(110))).toBeNull();
    expect(lockScreenLoggedNotice(null, ms(110))).toBeNull();
    expect(b1).toBeDefined();
  });
});
