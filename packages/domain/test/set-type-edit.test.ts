import { describe, expect, it } from 'vitest';
import { buildSetEditView, reduceSession, SET_TYPE_ORDER } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

/** Set-type control in Edit set (brief §1; backlog 4.1): warm-up / working / top / back-off / drop. */
describe('Edit set: set type', () => {
  const logged = () => {
    let s = startFixture().state;
    const b1 = setsFor(s, BENCH)[1];
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 60));
    return { s, id: b1?.id ?? '' };
  };

  it('offers every type in workout order with the stored one selected; unchanged until another is chosen', () => {
    const { s, id } = logged();
    const v = buildSetEditView(s, id, null);
    expect(v?.setType.choices.map((c) => [c.label, c.selected])).toEqual([
      ['Warm-up', false],
      ['Working', true],
      ['Top set', false],
      ['Back-off', false],
      ['Drop set', false],
    ]);
    expect(v?.setType.changed).toBe(false);
    expect(v?.changed).toBe(false);
    const top = buildSetEditView(s, id, null, null, 'top');
    expect(top).toMatchObject({ setType: { value: 'top', changed: true }, changed: true });
    expect(SET_TYPE_ORDER).toHaveLength(5);
  });

  it('a type change saves as a correction (Edited, audited) and Undo puts it back', () => {
    const { s, id } = logged();
    const set = setsFor(s, BENCH)[1];
    const r = expectOk(reduceSession(s, { type: 'correct_set', at: at(70), opId: 'type', setId: id, expectedSetVersion: set?.version ?? 0, patch: { setType: 'backoff' } }));
    expect(setsFor(r.state, BENCH)[1]).toMatchObject({ setType: 'backoff', edited: true, actual: set?.actual });
    expect(r.state.audit.at(-1)).toMatchObject({ kind: 'corrected', before: { setType: 'working' }, after: { setType: 'backoff' } });
    const back = apply(r.state, { type: 'undo_op', at: at(71), opId: 'u', targetOpId: 'type' });
    expect(setsFor(back, BENCH)[1]).toMatchObject({ setType: 'working', edited: false });
  });
});
