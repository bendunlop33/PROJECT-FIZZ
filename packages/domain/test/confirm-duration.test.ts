import { describe, expect, it } from 'vitest';

import { reduceSession } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectError, logCmd, setsFor, startFixture } from './session-fixture';

/** `Count it` (progress.md PG25a) in the reducer: finished, timed workouts only; versioned; idempotent; no set touched. */

function finished() {
  let s = startFixture().state;
  s = apply(s, logCmd(setsFor(s, BENCH)[1]?.id ?? '', values(kg(100), 8), 60));
  return apply(s, { type: 'finish', at: at(5 * 3600), opId: 'f', expectedVersion: s.session.version, endedAt: null });
}

describe('confirm_session_duration', () => {
  it('sets durationConfirmedAt, bumps the version, emits one event and changes no set', () => {
    const s = finished();
    const r = reduceSession(s, { type: 'confirm_session_duration', at: at(6 * 3600), opId: 'c1', confirmed: true, expectedVersion: s.session.version });
    if (!r.ok) throw new Error(r.error.code);
    expect(r.state.session.durationConfirmedAt).toEqual(at(6 * 3600));
    expect(r.state.session.version).toBe(s.session.version + 1);
    expect(r.state.sets).toEqual(s.sets);
    expect(r.state.session.endedAt).toEqual(s.session.endedAt);
    expect(r.events).toEqual([{ type: 'SessionDurationConfirmed', confirmed: true }]);
  });

  it('a repeated opId is a duplicate; a different command under it is refused; a stale version is refused', () => {
    const s = finished();
    const cmd = { type: 'confirm_session_duration' as const, at: at(6 * 3600), opId: 'c1', confirmed: true, expectedVersion: s.session.version };
    const once = apply(s, cmd);
    expect(reduceSession(once, cmd)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expectError(reduceSession(once, { ...cmd, confirmed: false }), 'operation_id_reused');
    expectError(reduceSession(once, { ...cmd, opId: 'c2' }), 'stale_version');
  });

  it('Undo (confirmed: false) removes it; the first one then reads as superseded', () => {
    const s = finished();
    const cmd = { type: 'confirm_session_duration' as const, at: at(6 * 3600), opId: 'c1', confirmed: true, expectedVersion: s.session.version };
    const once = apply(s, cmd);
    const undone = apply(once, { ...cmd, opId: 'u1', confirmed: false, expectedVersion: once.session.version });
    expect(undone.session).not.toHaveProperty('durationConfirmedAt');
    expect(reduceSession(undone, cmd)).toMatchObject({ duplicate: true, superseded: true });
  });

  it('refused on an active workout and on a date-only imported workout', () => {
    const active = startFixture().state;
    expectError(reduceSession(active, { type: 'confirm_session_duration', at: at(10), opId: 'c', confirmed: true, expectedVersion: active.session.version }), 'session_not_finished');
    const s = finished();
    const imported = { ...s, session: { ...s.session, source: 'import' as const, localDate: '2026-10-08' } };
    expectError(reduceSession(imported, { type: 'confirm_session_duration', at: at(6 * 3600), opId: 'c', confirmed: true, expectedVersion: s.session.version }), 'invalid_time');
  });
});
