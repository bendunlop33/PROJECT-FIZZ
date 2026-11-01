import { describe, expect, it } from 'vitest';
import type { EditTodayArgs, EditTodayOp, SessionAggregate } from '@fizz/schemas';
import { alreadyLine, planCoachEdit } from '../src/index';
import { at, id, kg, lb } from './fixtures';
import { BENCH, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 1 Nov, build 500) "Let's stick to 100 as easier to take off plates" when the sets are already 100 kg got
 * "Couldn't apply. Couldn't change today's workout: Coach kept sets 4–5 as planned.. Nothing changed." A restatement is a
 * no-op, not a failure: `already` with `Already 100 kg`.
 */

function plan(s: SessionAggregate, ops: EditTodayOp[]): ReturnType<typeof planCoachEdit> {
  const args: EditTodayArgs = { baseVersion: s.session.version, ops, reason: 'Ben asked', benAsked: true, benQuote: 'stick to 100' };
  return planCoachEdit({ aggregate: s, args, intent: 'general', opId: 'turn-1:edit_today:x', actionId: id(9_000), at: at(500), painFlags: [], sessionPainUnspecified: false, gymName: 'Main gym', messagePain: null, exercises: new Map() });
}

describe('a no-op today edit (Ben, 1 Nov)', () => {
  it('asking for the load the pending sets already have is `already`, with the value', () => {
    const s = startFixture().state;
    const pending = setsFor(s, BENCH).filter((x) => x.status === 'pending' && x.setType !== 'warmup');
    const load = pending[0]?.planned.load;
    if (load == null) throw new Error('no planned load');
    const p = plan(s, pending.map((x) => ({ op: 'set' as const, setId: x.id, target: { load, reps: null, rpe: null } })));
    expect(p).toMatchObject({ status: 'rejected', already: true });
    expect(p.status === 'rejected' ? p.failure.replace(/ /g, ' ') : '').toBe(`Already ${String(load.value)} ${load.unit}`);
  });

  it('a real change is not `already`', () => {
    const s = startFixture().state;
    const pending = setsFor(s, BENCH).filter((x) => x.status === 'pending' && x.setType !== 'warmup');
    const load = pending[0]?.planned.load;
    if (load == null) throw new Error('no planned load');
    const p = plan(s, pending.map((x) => ({ op: 'set' as const, setId: x.id, target: { load: { ...load, value: load.value - 10 }, reps: null, rpe: null } })));
    expect(p.status).toBe('ok');
  });

  it('the line: one value, reps only, kg and lb, per-hand dumbbells, mixed', () => {
    const nb = (t: string) => t.replace(/ /g, ' ');
    expect(nb(alreadyLine([{ asked: { load: kg(100), reps: null }, convention: 'total' }, { asked: { load: kg(100), reps: null }, convention: 'total' }]))).toBe('Already 100 kg');
    expect(nb(alreadyLine([{ asked: { load: lb(225), reps: { min: 5, max: 5 } }, convention: 'total' }]))).toBe('Already 225 lb × 5');
    expect(nb(alreadyLine([{ asked: { load: kg(22.5, 'per_hand'), reps: null }, convention: 'per_hand' }]))).toBe('Already 22.5 kg each');
    expect(alreadyLine([{ asked: { load: null, reps: { min: 8, max: 10 } }, convention: 'total' }])).toBe('Already 8–10 reps');
    expect(alreadyLine([{ asked: { load: kg(100), reps: null }, convention: 'total' }, { asked: { load: kg(95), reps: null }, convention: 'total' }])).toBe('Already as asked');
  });
});
