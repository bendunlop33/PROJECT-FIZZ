import { describe, expect, it } from 'vitest';

import { reduceSession } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectError, logCmd, setsFor, startFixture } from './session-fixture';

/** `Rest after` editor (rest-state §2.4): this set only, or this exercise; never a done set or the running timer. */
describe('set_rest_after', () => {
  it('this set only: changes that pending set; the running timer and done sets are untouched', () => {
    let s = startFixture().state;
    const [w, b1, b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10));
    const timer = s.restTimer;
    const r = reduceSession(s, { type: 'set_rest_after', at: at(20), opId: 'rest-1', setId: b2?.id ?? '', seconds: 240, scope: 'set', expectedVersion: s.session.version });
    if (!r.ok) throw new Error(r.error.message);
    const after = setsFor(r.state, BENCH);
    expect(after.map((x) => x.rest.seconds)).toEqual([w?.rest.seconds, b1?.rest.seconds, 240]);
    expect(after[2]?.rest).toEqual({ seconds: 240, source: 'set_override', sourceLabel: 'This set', byOpId: 'rest-1' });
    expect(r.state.restTimer).toEqual(timer);
    expect(r.state.session.version).toBe(s.session.version + 1);
    expect(r.events).toEqual([{ type: 'RestPlanChanged', setIds: [b2?.id], seconds: 240 }]);
    // Same opId again: a duplicate, nothing changes.
    const again = reduceSession(r.state, { type: 'set_rest_after', at: at(21), opId: 'rest-1', setId: b2?.id ?? '', seconds: 240, scope: 'set', expectedVersion: s.session.version });
    expect(again).toMatchObject({ ok: true, duplicate: true });
  });

  it('this exercise: every pending set of it; a done set is refused and a stale version rejected', () => {
    let s = startFixture().state;
    const [w] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 10));
    const pending = setsFor(s, BENCH)[1];
    const r = reduceSession(s, { type: 'set_rest_after', at: at(20), opId: 'rest-2', setId: pending?.id ?? '', seconds: 150, scope: 'exercise', expectedVersion: s.session.version });
    if (!r.ok) throw new Error(r.error.message);
    expect(setsFor(r.state, BENCH).map((x) => x.rest.seconds)).toEqual([w?.rest.seconds, 150, 150]);
    expect(setsFor(r.state, BENCH)[1]?.rest.sourceLabel).toBe('Bench press default (yours)');
    expect(setsFor(r.state, BENCH)[1]?.rest.byOpId).toBe('rest-2');
    expectError(reduceSession(r.state, { type: 'set_rest_after', at: at(30), opId: 'rest-3', setId: w?.id ?? '', seconds: 90, scope: 'set', expectedVersion: r.state.session.version }), 'set_not_pending');
    expectError(reduceSession(r.state, { type: 'set_rest_after', at: at(30), opId: 'rest-4', setId: pending?.id ?? '', seconds: 90, scope: 'set', expectedVersion: s.session.version }), 'stale_version');
  });
});
