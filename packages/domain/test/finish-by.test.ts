import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { reduceSession } from '../src/index';
import { at } from './fixtures';
import { apply, expectError, expectOk, startFixture } from './session-fixture';

/** `Finish by` (active-workout §2.15.3, AW12): today only, versioned, changes no set. */

const setBy = (s: SessionAggregate, nowS: number, byS: number | null, opId = 'fb-1', expectedVersion = s.session.version) =>
  reduceSession(s, { type: 'set_finish_by', at: at(nowS), opId, finishBy: byS === null ? null : at(byS), expectedVersion });

describe('set_finish_by', () => {
  it('stores the time on the session and bumps the version; sets, rest and timers are untouched', () => {
    const { state } = startFixture();
    const r = expectOk(setBy(state, 60, 60 + 45 * 60));
    expect(r.state.session.finishBy).toEqual(at(60 + 45 * 60));
    expect(r.state.session.version).toBe(state.session.version + 1);
    expect(r.state.sets).toEqual(state.sets);
    expect(r.state.restTimer).toEqual(state.restTimer);
    expect(r.events).toEqual([{ type: 'FinishByChanged', finishByUtc: at(60 + 45 * 60).utc }]);
  });

  it('Not set removes it', () => {
    const { state } = startFixture();
    const set = expectOk(setBy(state, 60, 3600)).state;
    const cleared = expectOk(setBy(set, 90, null, 'fb-2')).state;
    expect(cleared.session.finishBy).toBeUndefined();
    expect('finishBy' in cleared.session).toBe(false);
  });

  it('a repeat with the same opId is a duplicate; reusing it for another time is refused', () => {
    const { state } = startFixture();
    const once = expectOk(setBy(state, 60, 3600)).state;
    const again = expectOk(setBy(once, 61, 3600, 'fb-1', state.session.version));
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(once);
    expectError(setBy(once, 61, 4200, 'fb-1', state.session.version), 'operation_id_reused');
  });

  it('a stale sheet is refused, never applied to newer state', () => {
    const { state } = startFixture();
    const once = expectOk(setBy(state, 60, 3600)).state;
    expectError(setBy(once, 70, 4200, 'fb-2', state.session.version), 'stale_version');
  });

  it('a time already past, or more than 3 h ahead, is refused', () => {
    const { state } = startFixture();
    expectError(setBy(state, 600, 600), 'invalid_time');
    expectError(setBy(state, 600, 300), 'invalid_time');
    expectError(setBy(state, 0, 3 * 3600 + 60), 'invalid_time');
    expectOk(setBy(state, 0, 3 * 3600));
  });

  it('is superseded once a later Finish by replaced it', () => {
    const { state } = startFixture();
    const first = expectOk(setBy(state, 60, 3600)).state;
    const second = expectOk(setBy(first, 70, 4200, 'fb-2')).state;
    const retry = expectOk(setBy(second, 80, 3600, 'fb-1', state.session.version));
    expect(retry).toMatchObject({ duplicate: true, superseded: true });
  });

  it('is refused on a finished workout', () => {
    const { state } = startFixture();
    const done = apply(state, { type: 'finish', at: at(60), opId: 'f', expectedVersion: state.session.version, endedAt: null });
    expectError(setBy(done, 70, 3600, 'fb-1', done.session.version), 'session_finished');
  });
});
