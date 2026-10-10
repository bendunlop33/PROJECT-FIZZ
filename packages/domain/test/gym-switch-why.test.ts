import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { buildAddSetContinuation, explainTarget, NBSP, reduceSession, refitNote, refitProvenance, sessionRecords, startWorkoutFromSession, type GymSwitchProposal, type HistorySession } from '../src/index';
import { at, idGen, kg, profile, values } from './fixtures';
import { BENCH, EXERCISES, exerciseSets, GYM_NAMES, HOTEL, HOTEL_EQ, hotelRack, INCLINE, LATERAL, MAIN, MAIN_EQ, mainBar, propose, pushA, rowOf, switchCmd } from './gym-fixture';
import { apply, expectOk, logCmd } from './session-fixture';

/**
 * Merge of gym switch (ADR 0019) with `Why?` (active-workout §2.12): a target
 * the switch fits again explains the new fit, not the old gym's, and Undo
 * puts the old explanation back exactly.
 */

const plain = (s: string) => s.replaceAll(NBSP, ' ');
const notes = (s: SessionAggregate, setId: string) => (s.sets.find((x) => x.id === setId)?.planned.provenance?.guardNotes ?? []).map(plain);

function benchTwoDone(): SessionAggregate {
  let s = pushA();
  const bench = exerciseSets(s, BENCH);
  s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 60));
  s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 7), 300));
  return s;
}

function switchToHotel(s: SessionAggregate): { after: SessionAggregate; p: GymSwitchProposal } {
  const p = propose(s, { id: HOTEL, equipment: HOTEL_EQ });
  return { after: expectOk(reduceSession(s, switchCmd(p, 320))).state, p };
}

describe('Why? after a gym switch', () => {
  const before = benchTwoDone();
  const { after } = switchToHotel(before);

  it('the routine’s provenance is made at Start and kept through the switch (who set it, the routine)', () => {
    const incline = exerciseSets(after, INCLINE)[0];
    expect(incline?.planned.provenance).toMatchObject({ source: 'plan', routineName: before.session.routineName, requestedLoad: kg(32.5, 'per_hand') });
  });

  it('a capped load says the cap here, in the same words as a capped Start', () => {
    const incline = exerciseSets(after, INCLINE);
    expect(incline.map((x) => x.planned.load)).toEqual([kg(20, 'per_hand'), kg(20, 'per_hand'), kg(20, 'per_hand')]);
    for (const x of incline) expect(notes(after, x.id)).toEqual(['Capped at 20 kg each: the most this rack makes. Plan was 32.5 kg each.']);
  });

  it('a dropped load says there is nothing of that kind here; the logged sets keep their own provenance', () => {
    const bench = exerciseSets(after, BENCH);
    for (const x of bench.filter((b) => b.status === 'pending')) {
      expect(x.planned.load).toBeNull();
      expect(notes(after, x.id)).toEqual(['No load target: plan was 100 kg, and this gym has nothing of that kind to check it on.']);
    }
    for (const x of bench.filter((b) => b.status === 'completed')) expect(x).toEqual(before.sets.find((b) => b.id === x.id));
  });

  it('a load that is the same here has no equipment note', () => {
    for (const x of exerciseSets(after, LATERAL)) {
      expect(x.planned.load).toEqual(kg(10, 'per_hand'));
      expect(notes(after, x.id)).toEqual([]);
    }
  });

  it('the Why? panel’s Equipment row reads the new fit', () => {
    const set = exerciseSets(after, INCLINE)[0];
    const why = explainTarget({ aggregate: after, setId: set?.id ?? '', nowMs: Date.parse(at(400).utc), basisNow: null, gymNames: GYM_NAMES, painFlags: [], history: [] });
    expect(why?.rows.find((r) => r.key === 'equipment')?.lines.map(plain)).toEqual(['Capped at 20 kg each: the most this rack makes. Plan was 32.5 kg each.']);
  });

  it('Undo restores every target’s provenance exactly', () => {
    const entry = after.session.gymChanges?.at(-1);
    if (!entry?.afterFingerprint) throw new Error('no change entry');
    const undone = expectOk(reduceSession(after, { type: 'undo_change_gym', at: at(330), opId: 'undo-1', actionId: entry.actionId, expectedFingerprint: entry.afterFingerprint })).state;
    for (const b of before.sets) expect(undone.sets.find((x) => x.id === b.id)?.planned).toEqual(b.planned);
  });

  it('switching back to Main restores the plan and clears the Hotel notes', () => {
    const back = expectOk(reduceSession(after, switchCmd(propose(after, { id: MAIN, equipment: MAIN_EQ }), 340, 'switch-back'))).state;
    for (const x of exerciseSets(back, INCLINE)) {
      expect(x.planned.load).toEqual(kg(32.5, 'per_hand'));
      expect(notes(back, x.id)).toEqual([]);
    }
  });

  it('Add set on a row left at the other gym fits the copy here and says so', () => {
    const benchMain = rowOf(after, BENCH, 0);
    const cont = buildAddSetContinuation(after, benchMain?.id ?? '', { exercise: EXERCISES.get(BENCH) ?? null, gymName: 'Hotel · Lisbon', painFlagged: new Set(), ownerUnit: 'kg', newId: idGen(99_000) });
    expect(cont?.planned.load).toBeNull();
    expect(cont?.planned.provenance?.guardNotes.map(plain)).toEqual(['No load target: plan was 100 kg, and this gym has nothing of that kind to check it on.']);
  });
});

describe('refitProvenance', () => {
  const base = { source: 'rule' as const, setAt: at(0), routineName: null, requestedLoad: null, basis: null, guardNotes: ['Not checked against equipment: this exercise has no equipment set up at this gym.'] };
  const step = { from: kg(100), to: kg(102.5), pctChange: 2.5, smallest: true, equipmentKind: 'barbell' as const };

  it('absent stays absent: a target made before Why? still reads Not recorded', () => {
    expect(refitProvenance(undefined, { load: kg(20, 'per_hand') }, hotelRack)).toBeUndefined();
  });

  it('keeps the step only while it still describes this load on this kind of equipment', () => {
    expect(refitProvenance({ ...base, step }, { load: kg(102.5) }, mainBar)?.step).toEqual(step);
    expect(refitProvenance({ ...base, step }, { load: kg(100), snap: { intended: kg(102.5), intendedOn: null, outcome: 'rounded', equipmentId: mainBar.id, gymId: MAIN, by: 'gym_switch' } }, mainBar)?.step).toBeUndefined();
    expect(refitProvenance({ ...base, step }, { load: null }, null)?.step).toBeUndefined();
  });

  it('a rule target says `Target was`; old equipment notes are replaced', () => {
    const p = refitProvenance(base, { load: null, snap: { intended: kg(102.5), intendedOn: null, outcome: 'dropped', reason: 'not_here', equipmentId: null, gymId: HOTEL, by: 'gym_switch' } }, null);
    expect(p?.guardNotes.map(plain)).toEqual(['No load target: target was 102.5 kg, and this gym has nothing of that kind to check it on.']);
  });

  it('a pain-held load says so (rule 9)', () => {
    const note = refitNote({ intended: kg(30, 'per_hand'), intendedOn: null, outcome: 'rounded', painHeld: true, equipmentId: hotelRack.id, gymId: HOTEL, by: 'gym_switch' }, kg(20, 'per_hand'), hotelRack, 'Plan');
    expect(note && plain(note)).toBe('Kept at 20 kg each: a pain flag stops increases. Plan was 30 kg each.');
  });
});

describe('Repeat of a switched workout: Why? names the gym each set was done at', () => {
  it('the basis of a set done at Main says Main; one done at the hotel says the hotel', () => {
    let s = switchToHotel(benchTwoDone()).after;
    for (const [i, x] of exerciseSets(s, INCLINE).entries()) s = apply(s, logCmd(x.id, values(kg(20, 'per_hand'), 10), 400 + i * 120));
    s = apply(s, { type: 'finish', at: at(1000), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const out = startWorkoutFromSession({ opId: 'rep', owner: profile(), gymId: MAIN, gymName: 'Main Gym', source: s, exercises: EXERCISES, gymEquipment: MAIN_EQ, at: at(86_400), newId: idGen(98_000) });
    const benchBasis = exerciseSets(out.aggregate, BENCH).map((x) => x.planned.provenance?.basis);
    expect(benchBasis.length).toBeGreaterThan(0);
    for (const b of benchBasis) expect(b).toMatchObject({ gymId: MAIN, equipmentId: mainBar.id });
    const inclineBasis = exerciseSets(out.aggregate, INCLINE).map((x) => x.planned.provenance?.basis);
    expect(inclineBasis.length).toBe(3);
    for (const b of inclineBasis) expect(b).toMatchObject({ gymId: HOTEL, equipmentId: hotelRack.id });
    // Copied from the hotel's 20 kg each onto Main's rack: exact, so no equipment note.
    for (const x of exerciseSets(out.aggregate, INCLINE)) expect(x.planned.provenance?.guardNotes).toEqual([]);
  });
});

describe('Records in a switched workout name the gym of the part', () => {
  it('a heaviest bench set logged at Main before switching to the hotel says Main Gym', () => {
    const history: HistorySession[] = [1, 2, 3].map((n) => ({
      sessionId: `old-${String(n)}`,
      performedAtUtc: new Date(Date.parse(at(0).utc) - n * 86_400_000).toISOString(),
      equipmentId: mainBar.id,
      gymId: MAIN,
      imported: false,
      sets: [{ setType: 'working', side: null, load: kg(95), reps: 8, rpe: null, rir: null }],
    }));
    const { after } = switchToHotel(benchTwoDone());
    expect(sessionRecords({ aggregate: after, gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, history: { [BENCH]: history } })).toEqual(['Heaviest bench press set at Main Gym so far']);
    // Without gym names it falls back to the name given, as before.
    expect(sessionRecords({ aggregate: after, gymName: 'Main Gym', history: { [BENCH]: history } })).toEqual(['Heaviest bench press set at Main Gym so far']);
  });
});
