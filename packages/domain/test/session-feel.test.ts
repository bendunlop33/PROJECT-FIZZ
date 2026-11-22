import { describe, expect, it } from 'vitest';

import { reduceSession } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectError, logCmd, setsFor, startFixture } from './session-fixture';

/** Summary's `How did it feel?` (Ben, 21 Oct): Ben's own tap on a finished workout; versioned; idempotent; no set touched. */

function finished() {
  let s = startFixture().state;
  s = apply(s, logCmd(setsFor(s, BENCH)[1]?.id ?? '', values(kg(100), 8), 60));
  return apply(s, { type: 'finish', at: at(3600), opId: 'f', expectedVersion: s.session.version, endedAt: null });
}

describe('set_feel', () => {
  it('stores Ben’s word with the time, bumps the version, emits one event and changes no set', () => {
    const s = finished();
    const r = reduceSession(s, { type: 'set_feel', at: at(3700), opId: 'feel-1', feel: 'hard', expectedVersion: s.session.version });
    if (!r.ok) throw new Error(r.error.code);
    expect(r.state.session.feel).toEqual({ value: 'hard', at: at(3700) });
    expect(r.state.session.version).toBe(s.session.version + 1);
    expect(r.state.sets).toEqual(s.sets);
    expect(r.events).toEqual([{ type: 'SessionFeelSet', feel: 'hard' }]);
  });

  it('a repeated opId is a duplicate; a stale version is refused (rule 5)', () => {
    const s = finished();
    const cmd = { type: 'set_feel' as const, at: at(3700), opId: 'feel-1', feel: 'easy' as const, expectedVersion: s.session.version };
    const once = apply(s, cmd);
    expect(reduceSession(once, cmd)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expectError(reduceSession(once, { ...cmd, opId: 'feel-2' }), 'stale_version');
  });

  it('a change replaces it (the first reads as superseded); a clear is stored as no answer', () => {
    const s = finished();
    const first = { type: 'set_feel' as const, at: at(3700), opId: 'feel-1', feel: 'easy' as const, expectedVersion: s.session.version };
    const once = apply(s, first);
    const changed = apply(once, { ...first, opId: 'feel-2', feel: 'good', expectedVersion: once.session.version });
    expect(changed.session.feel?.value).toBe('good');
    expect(reduceSession(changed, first)).toMatchObject({ duplicate: true, superseded: true });
    const cleared = apply(changed, { ...first, opId: 'feel-3', feel: null, expectedVersion: changed.session.version });
    expect(cleared.session.feel?.value).toBeNull();
    // Clearing what was never answered changes nothing.
    const none = reduceSession(s, { ...first, opId: 'feel-4', feel: null });
    expect(none).toMatchObject({ ok: true, events: [] });
  });

  it('refused on an active workout', () => {
    const active = startFixture().state;
    expectError(reduceSession(active, { type: 'set_feel', at: at(10), opId: 'f', feel: 'good', expectedVersion: active.session.version }), 'session_not_finished');
  });
});
