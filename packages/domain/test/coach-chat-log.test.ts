import { describe, expect, it } from 'vitest';
import type { Load, SessionAggregate } from '@fizz/schemas';
import { chatSetUndoCommand, checkChatCorrection, checkChatLog, numbersInWords, reduceSession, type ChatSetInput } from '../src/index';
import { at, kg } from './fixtures';
import { apply, BENCH, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * Logging or correcting a set from chat (backlog §4.3, coach-sheet §2.7):
 * the Log button's and the correction sheet's own commands, only with the
 * numbers Ben said, in the exercise's own unit and convention, at the
 * version the coach read (rule 5).
 */

const lb = (value: number): Load => ({ value, unit: 'lb', convention: 'total' });

function input(state: SessionAggregate, setId: string, over: Partial<ChatSetInput> = {}): ChatSetInput {
  return { aggregate: state, baseVersion: state.session.version, setId, load: kg(100), reps: 8, rpe: null, benWords: 'log 100 for 8', opId: 'turn-1:log_set:abc', at: at(300), ...over };
}

describe('numbersInWords', () => {
  it('reads digits, decimals and spoken numbers', () => {
    expect([...numbersInWords('Log 62.5 for 8 at RPE 8.5')]).toEqual(expect.arrayContaining([62.5, 8, 8.5]));
    expect(numbersInWords('a hundred for eight').has(100)).toBe(true);
    expect(numbersInWords('set two was ninety five').has(95)).toBe(true);
    expect(numbersInWords('hundred and ten for six').has(110)).toBe(true);
    expect(numbersInWords('62,5 kg').has(62.5)).toBe(true);
  });
});

describe('checkChatLog (log_set from chat)', () => {
  it('builds the Log button’s command for a pending set; the set and rest come out as the button’s would', () => {
    const { state } = startFixture();
    const bench = setsFor(state, BENCH);
    const working = bench[1];
    if (!working) throw new Error('no set');
    const r = checkChatLog(input(state, working.id));
    expect(r).toMatchObject({ status: 'ok', exerciseName: 'Bench press', after: { load: kg(100), reps: 8, rpe: null }, command: { type: 'log_set', setId: working.id, values: { load: kg(100), reps: 8 } } });
    if (r.status !== 'ok') throw new Error('not ok');
    const after = reduceSession(state, r.command);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.state.sets.find((x) => x.id === working.id)).toMatchObject({ status: 'completed', actual: { load: kg(100), reps: 8 }, version: r.setVersionAfter });
    expect(after.state.restTimer?.setId).toBe(working.id);
    // Same opId → same rest timer ID, so a replay is the same command.
    expect(checkChatLog(input(state, working.id))).toEqual(r);
  });

  it('refuses numbers Ben didn’t say, a chip with no words, and an RPE he didn’t give', () => {
    const { state } = startFixture();
    const set = setsFor(state, BENCH)[1];
    if (!set) throw new Error('no set');
    expect(checkChatLog(input(state, set.id, { benWords: 'log 100 for 6' }))).toMatchObject({ status: 'rejected', failure: 'say the weight and reps to log' });
    expect(checkChatLog(input(state, set.id, { benWords: null }))).toMatchObject({ status: 'rejected' });
    expect(checkChatLog(input(state, set.id, { rpe: 9 }))).toMatchObject({ status: 'rejected' });
    expect(checkChatLog(input(state, set.id, { rpe: 9, benWords: 'log 100 for 8 at rpe 9' }))).toMatchObject({ status: 'ok', after: { rpe: 9 } });
  });

  it('kg/lb and conventions are never converted: lb on a kg bar, total on a stack', () => {
    const { state } = startFixture();
    const bench = setsFor(state, BENCH)[1];
    const row = setsFor(state, ROW)[0];
    if (!bench || !row) throw new Error('no set');
    expect(checkChatLog(input(state, bench.id, { load: lb(225), benWords: 'log 225 for 8' }))).toMatchObject({ status: 'rejected', failure: 'Bench press is logged in kg' });
    expect(checkChatLog(input(state, row.id, { load: kg(50), benWords: 'log 50 for 8' }))).toMatchObject({ status: 'rejected', failure: 'Cable row is logged as stack' });
    expect(checkChatLog(input(state, row.id, { load: kg(50, 'stack'), benWords: 'log 50 for 8' }))).toMatchObject({ status: 'ok' });
  });

  it('a stale version, a done set, a timed exercise or no active workout is refused; nothing to write', () => {
    const { state } = startFixture();
    const [warm, b1] = setsFor(state, BENCH);
    const hang = setsFor(state, HANG)[0];
    if (!warm || !b1 || !hang) throw new Error('no set');
    expect(checkChatLog(input(state, b1.id, { baseVersion: state.session.version - 1 }))).toMatchObject({ status: 'stale' });
    const logged = apply(state, logCmd(warm.id, { load: kg(60), reps: 10, durationS: null, rpe: null, rir: null }, 60));
    expect(checkChatLog(input(logged, warm.id, { benWords: 'log 100 for 8' }))).toMatchObject({ status: 'rejected', failure: 'set 1 is already logged' });
    expect(checkChatLog(input(logged, hang.id))).toMatchObject({ status: 'rejected', failure: 'Dead hang is timed: log it in the workout' });
    expect(checkChatLog({ ...input(logged, b1.id), aggregate: null })).toMatchObject({ status: 'stale' });
  });
});

describe('checkChatCorrection (correct_set from chat)', () => {
  function withLogged() {
    const { state } = startFixture();
    const b1 = setsFor(state, BENCH)[1];
    if (!b1) throw new Error('no set');
    const logged = apply(state, logCmd(b1.id, { load: kg(100), reps: 8, durationS: null, rpe: 8, rir: null }, 60));
    return { logged, setId: b1.id };
  }

  it('changes only the values Ben said, as the correction sheet’s command; rest is untouched', () => {
    const { logged, setId } = withLogged();
    // During the rest that log started.
    const r = checkChatCorrection(input(logged, setId, { load: kg(95), reps: null, rpe: null, benWords: 'set 2 was 95', at: at(90), opId: 'turn-2:correct_set:x' }));
    expect(r).toMatchObject({ status: 'ok', before: { load: kg(100), reps: 8, rpe: 8 }, after: { load: kg(95), reps: 8, rpe: 8 }, command: { type: 'correct_set', patch: { load: kg(95) } } });
    if (r.status !== 'ok') throw new Error('not ok');
    const after = reduceSession(logged, r.command);
    if (!after.ok) throw new Error(after.error.message);
    expect(after.state.restTimer).toEqual(logged.restTimer);
    expect(after.state.sets.find((x) => x.id === setId)?.actual?.load).toEqual(kg(95));
  });

  it('a pending set, unchanged values, unsaid numbers or another unit are refused', () => {
    const { logged, setId } = withLogged();
    const pending = setsFor(logged, BENCH)[2];
    if (!pending) throw new Error('no set');
    expect(checkChatCorrection(input(logged, pending.id, { load: kg(95), benWords: 'set 3 was 95' }))).toMatchObject({ status: 'rejected', failure: 'set 3 isn’t logged yet' });
    expect(checkChatCorrection(input(logged, setId, { load: kg(100), reps: 8, benWords: 'set 2 was 100 for 8' }))).toMatchObject({ status: 'rejected' });
    expect(checkChatCorrection(input(logged, setId, { load: kg(90), reps: null, benWords: 'set 2 was 95' }))).toMatchObject({ status: 'rejected', failure: 'say the corrected numbers' });
    expect(checkChatCorrection(input(logged, setId, { load: lb(210), reps: null, benWords: 'set 2 was 210' }))).toMatchObject({ status: 'rejected', failure: 'Bench press is logged in kg' });
  });
});

describe('chatSetUndoCommand', () => {
  it('a log comes back with undo_log on the version it left; a correction goes back to the values before', () => {
    const { state } = startFixture();
    const b1 = setsFor(state, BENCH)[1];
    if (!b1) throw new Error('no set');
    const r = checkChatLog(input(state, b1.id));
    if (r.status !== 'ok') throw new Error('not ok');
    const logged = apply(state, r.command);
    const undo = chatSetUndoCommand({ kind: 'log_set', setId: b1.id, setVersionAfter: r.setVersionAfter }, { opId: 'undo-1', at: at(400) });
    expect(undo).toMatchObject({ type: 'undo_log', expectedSetVersion: r.setVersionAfter });
    if (undo === null) throw new Error('no undo');
    expect(apply(logged, undo).sets.find((x) => x.id === b1.id)?.status).toBe('pending');

    const c = checkChatCorrection(input(logged, b1.id, { load: kg(95), reps: 6, benWords: 'set 2 was 95 for 6', opId: 'turn-2:correct_set:y', at: at(320) }));
    if (c.status !== 'ok') throw new Error('not ok');
    const corrected = apply(logged, c.command);
    const back = chatSetUndoCommand({ kind: 'correct_set', setId: b1.id, setVersionAfter: c.setVersionAfter, before: c.before, after: c.after }, { opId: 'undo-2', at: at(500) });
    if (back === null) throw new Error('no undo');
    expect(back).toMatchObject({ type: 'correct_set', patch: { load: kg(100), reps: 8 } });
    expect(apply(corrected, back).sets.find((x) => x.id === b1.id)?.actual).toMatchObject({ load: kg(100), reps: 8 });
    // A later change to the set makes the Undo stale (rule 5).
    const later = apply(corrected, { type: 'correct_set', at: at(600), opId: 'ben-edit', setId: b1.id, expectedSetVersion: c.setVersionAfter, patch: { rpe: 9 } });
    expect(reduceSession(later, back).ok).toBe(false);
  });
});
