import { describe, expect, it } from 'vitest';
import { type EditTodayArgs, type EditTodayOp, type PainFlag, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { namedWeightGymEdit, painGoAheadWords, planCoachEdit, reduceSession, type CoachEditInput } from '../src/index';
import { at, barbell, id, kg, OWNER, TZ, values } from './fixtures';
import { apply, BENCH, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 8 Nov: "If I agree to apply it there shouldn't be any limit"; coach parity) `planCoachEdit` with `asked`:
 * Ben's ask goes past the coach's judgement limits (8 direct sets a muscle a session, the 20% load step, the warm-up
 * count) with a one-line trade-off; the coach's own offer (`asked: false`) is held to them. The kit, a machine's max
 * and done sets hold either way. A warm-up weight he names is kept as typed; his go-ahead waves a pain hold through.
 * The parity ops (a set out, rest, order, note, + weight) undo with the edit.
 */

const GROUPS: Record<string, string> = { [BENCH]: 'Chest', [ROW]: 'Back', [FACE]: 'Shoulders' };
const groupOf = (exerciseId: string): string | null => GROUPS[exerciseId] ?? null;
const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const working = (s: SessionAggregate, exerciseId: string) => setsFor(s, exerciseId).filter((x) => x.setType !== 'warmup' && x.status !== 'deleted');
const OP = 'turn-1:edit_today:o';
type Details = Extract<EditTodayOp, { op: 'set_details' }>;
const details = (sessionExerciseId: string, over: Partial<Details>): EditTodayOp => ({ op: 'set_details', sessionExerciseId, setId: null, setType: null, restSeconds: null, workSeconds: null, distanceMetres: null, position: null, remove: null, note: null, addedWeight: null, ...over });

function plan(s: SessionAggregate, ops: EditTodayOp[], over: Partial<CoachEditInput> = {}) {
  const args: EditTodayArgs = { baseVersion: s.session.version, ops, reason: 'Ben asked', benAsked: true, benQuote: 'do it' };
  return planCoachEdit({ aggregate: s, args, intent: 'general', opId: OP, actionId: id(9_500), at: at(500), painFlags: [], sessionPainUnspecified: false, gymName: 'Main gym', messagePain: null, exercises: new Map(), directGroupOf: groupOf, ...over });
}
function ok(p: ReturnType<typeof planCoachEdit>) {
  if (p.status !== 'ok') throw new Error(`Expected ok, got ${p.status}${p.status === 'rejected' ? `: ${p.failure}` : ''}`);
  return p;
}
const revert: SessionCommand = { type: 'revert_coach_edit', at: at(600), opId: 'undo-o', targetOpId: OP, actionId: id(9_500) };

describe("Ben's ask overrides the coach's judgement limits (8 Nov)", () => {
  it('"make it 12 sets" on his yes: applied past 8 a session, with one trade-off line', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'set_count', sessionExerciseId: rowId(s0, BENCH), workingSets: 12 }], { asked: true }));
    expect(p.tradeOff).toEqual(['Chest 12 sets today · above 8 a session']);
    const s1 = apply(s0, p.command);
    expect(working(s1, BENCH)).toHaveLength(12);
  });

  it('the coach’s own offer of the same is trimmed to 8 a session, and says so', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'set_count', sessionExerciseId: rowId(s0, BENCH), workingSets: 12 }], { asked: false }));
    expect(p.tradeOff).toEqual([]);
    expect(p.guardNotes.map((n) => n.text)).toContain('Not done: Chest above 8 sets a session');
    expect(working(apply(s0, p.command), BENCH)).toHaveLength(8);
  });

  it('a 30% jump he asks for applies (snapped to the plates) with its trade-off; an offer stops at the 20% step', () => {
    const s0 = startFixture().state;
    const [, b1] = setsFor(s0, BENCH);
    const ops: EditTodayOp[] = [{ op: 'set', setId: b1?.id ?? '', target: { load: kg(130.3), reps: null, rpe: null } }];
    const asked = ok(plan(s0, ops, { asked: true }));
    expect(asked.exercises[0]?.changes[0]?.after?.load).toEqual(kg(130));
    expect(asked.tradeOff).toEqual(['Bench press +30% · above the usual 20% step']);
    const offer = ok(plan(s0, ops, { asked: false }));
    expect(offer.exercises[0]?.changes[0]?.after?.load).toEqual(kg(120));
    expect(offer.guardNotes.some((n) => n.kind === 'capped' && n.text.includes('20% step'))).toBe(true);
  });

  it('never past a machine’s max, even when he asks', () => {
    const s0 = startFixture().state;
    const [f1] = setsFor(s0, FACE);
    const p = ok(plan(s0, [{ op: 'set', setId: f1?.id ?? '', target: { load: kg(70, 'stack'), reps: null, rpe: null } }], { asked: true }));
    expect(p.exercises[0]?.changes[0]?.after?.load).toEqual(kg(50, 'stack'));
    expect(p.guardNotes.map((n) => n.kind)).toContain('capped');
  });

  it('done sets stay: his ask never rewrites a logged set', () => {
    const s = startFixture().state;
    const [w, b1] = setsFor(s, BENCH);
    const s0 = apply(apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60)), logCmd(b1?.id ?? '', values(kg(100), 8), 300));
    const p = plan(s0, [{ op: 'set', setId: b1?.id ?? '', target: { load: kg(140), reps: null, rpe: null } }], { asked: true });
    expect(p.status).toBe('rejected');
  });

  it('a warm-up weight he names is kept as typed (off the plates), and the gym learns it', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'warmups', sessionExerciseId: rowId(s0, BENCH), sets: [{ load: 81, reps: 3 }], replace: false }], { asked: true, benLoads: [{ value: 81, unit: 'kg' }] }));
    const step = p.command.steps.find((x) => x.type === 'add_warmup');
    expect(step?.type === 'add_warmup' && step.planned.load?.value).toBe(81);
    expect(step?.type === 'add_warmup' && step.loadAsTyped).toBe(true);
    const s1 = apply(s0, p.command);
    expect(setsFor(s1, BENCH).filter((x) => x.setType === 'warmup').map((x) => x.planned.load?.value)).toEqual([60, 81]);
    let n = 0;
    const learned = namedWeightGymEdit({ aggregate: s0, command: p.command, items: [barbell()], atUtc: at(500).utc, newId: () => id(9_600 + (n += 1)) });
    expect(learned).not.toBeNull();
  });

  it('the coach’s own warm-up is still rounded down to the plates', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [{ op: 'warmups', sessionExerciseId: rowId(s0, BENCH), sets: [{ load: 81, reps: 3 }], replace: false }], { asked: true }));
    const step = p.command.steps.find((x) => x.type === 'add_warmup');
    expect(step?.type === 'add_warmup' && step.planned.load?.value).toBe(80);
    expect(step?.type === 'add_warmup' && step.loadAsTyped).toBeUndefined();
  });

  it('more warm-ups than the usual 6 on his ask, with the trade-off; an offer stops at 6', () => {
    const s0 = startFixture().state;
    const sets = [20, 30, 40, 50, 55, 70, 80, 90].map((load) => ({ load, reps: 3 }));
    const asked = ok(plan(s0, [{ op: 'warmups', sessionExerciseId: rowId(s0, BENCH), sets, replace: false }], { asked: true }));
    expect(asked.tradeOff).toEqual(['Bench press: 9 warm-ups · more than the usual 6']);
    const offer = ok(plan(s0, [{ op: 'warmups', sessionExerciseId: rowId(s0, BENCH), sets, replace: false }], { asked: false }));
    expect(apply(s0, offer.command).sets.filter((x) => x.setType === 'warmup' && x.status !== 'deleted' && x.sessionExerciseId === rowId(s0, BENCH))).toHaveLength(6);
  });
});

describe('pain go-ahead (8 Nov)', () => {
  const flag: PainFlag = { id: id(8_100), ownerId: OWNER, version: 3, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, exerciseId: BENCH, exerciseName: 'Bench press', area: 'shoulder', source: 'coach', checkInId: null, reportedAt: { utc: at(1).utc, tz: TZ }, status: 'active', clearedAtUtc: null, createdByOpId: 'x' };

  it('held without it; with Ben’s go-ahead today’s progression on that movement applies, and the card says so', () => {
    const s0 = startFixture().state;
    const ops: EditTodayOp[] = [{ op: 'set_count', sessionExerciseId: rowId(s0, BENCH), workingSets: 3 }];
    expect(plan(s0, ops, { asked: true, painFlags: [flag] }).status).toBe('rejected');
    const p = ok(plan(s0, ops, { asked: true, painFlags: [flag], painGoAhead: true }));
    expect(p.tradeOff).toEqual(['Bench press: going ahead despite the shoulder flag']);
    expect(p.wavedFlags).toEqual([{ id: flag.id, version: 3 }]);
    expect(working(apply(s0, p.command), BENCH)).toHaveLength(3);
  });

  it('never on an offer', () => {
    const s0 = startFixture().state;
    expect(plan(s0, [{ op: 'set_count', sessionExerciseId: rowId(s0, BENCH), workingSets: 3 }], { asked: false, painFlags: [flag], painGoAhead: true }).status).toBe('rejected');
  });

  it('reads his own words, never a report of worse pain', () => {
    expect(painGoAheadWords('my shoulder is fine, go ahead')).toBe(true);
    expect(painGoAheadWords('do it anyway')).toBe(true);
    expect(painGoAheadWords('add a set')).toBe(false);
    expect(painGoAheadWords('go ahead, it’s getting worse though')).toBe(false);
  });
});

describe('parity ops: what Ben can do by hand, with one Undo (8 Nov)', () => {
  it('a set out, rest, set type, set order, a note and + weight, all undone together', () => {
    const s0 = startFixture().state;
    const [w, b1, b2] = setsFor(s0, BENCH);
    const face = setsFor(s0, FACE);
    const p = ok(
      plan(
        s0,
        [
          details(rowId(s0, FACE), { setId: face[1]?.id ?? '', remove: true }),
          details(rowId(s0, BENCH), { setId: b2?.id ?? '', setType: 'backoff', restSeconds: 150 }),
          details(rowId(s0, HANG), { workSeconds: 60 }),
          details(rowId(s0, ROW), { setId: setsFor(s0, ROW)[1]?.id ?? '', position: 1 }),
          details(rowId(s0, BENCH), { note: 'Pause at the chest' }),
          details(rowId(s0, HANG), { addedWeight: true }),
        ],
        { asked: true },
      ),
    );
    const s1 = expectOk(reduceSession(s0, p.command)).state;
    expect(s1.session.version).toBe(s0.session.version + 1);
    expect(s1.sets.find((x) => x.id === face[1]?.id)?.status).toBe('deleted');
    const b2After = s1.sets.find((x) => x.id === b2?.id);
    expect([b2After?.setType, b2After?.rest.seconds]).toEqual(['backoff', 150]);
    expect(setsFor(s1, HANG)[0]?.planned.durationS).toBe(60);
    expect(s1.exercises.find((e) => e.exerciseId === BENCH)?.note).toBe('Pause at the chest');
    expect(s1.exercises.find((e) => e.exerciseId === HANG)?.loadConvention).toBe('added');
    expect(setsFor(s1, ROW).sort((a, b) => a.index - b.index).map((x) => x.id)).toEqual(setsFor(s0, ROW).map((x) => x.id).reverse());
    expect(p.lines.map((l) => l.text)).toContain('Bench press: note “Pause at the chest”');

    const s2 = expectOk(reduceSession(s1, revert)).state;
    expect(s2.sets.find((x) => x.id === face[1]?.id)?.status).toBe('pending');
    expect(s2.sets.find((x) => x.id === b2?.id)?.setType).toBe('working');
    expect(s2.sets.find((x) => x.id === b2?.id)?.rest.seconds).toBe(b2?.rest.seconds);
    expect(setsFor(s2, HANG)[0]?.planned.durationS).toBe(45);
    expect(s2.exercises.find((e) => e.exerciseId === BENCH)?.note).toBeUndefined();
    expect(s2.exercises.find((e) => e.exerciseId === HANG)?.loadConvention).toBe('bodyweight');
    expect(setsFor(s2, ROW).sort((a, b) => a.index - b.index).map((x) => x.id)).toEqual(setsFor(s0, ROW).map((x) => x.id));
    expect(w?.status).toBe('pending');
    expect(b1?.status).toBe('pending');
  });

  it('a duplicate op ID replays; a stale version is refused', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [details(rowId(s0, BENCH), { note: 'Elbows in' })], { asked: true }));
    const s1 = expectOk(reduceSession(s0, p.command)).state;
    expect(expectOk(reduceSession(s1, p.command)).duplicate).toBe(true);
    expect(plan(s1, [details(rowId(s1, BENCH), { note: 'x' })], { asked: true, args: { baseVersion: s0.session.version, ops: [details(rowId(s1, BENCH), { note: 'x' })], reason: 'r' } }).status).toBe('stale');
  });

  it('a coach note’s Undo is refused once the note changed since (rule 5)', () => {
    const s0 = startFixture().state;
    const p = ok(plan(s0, [details(rowId(s0, BENCH), { note: 'Elbows in' })], { asked: true }));
    const s1 = expectOk(reduceSession(s0, p.command)).state;
    const s2 = apply(s1, { type: 'set_note', at: at(550), opId: 'ben-note', target: { kind: 'exercise', sessionExerciseId: rowId(s1, BENCH) }, note: 'My own words', expectedVersion: s1.session.version });
    expect(reduceSession(s2, revert).ok).toBe(false);
    expect(s2.exercises.find((e) => e.exerciseId === BENCH)?.note).toBe('My own words');
  });
});
