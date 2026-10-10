import { describe, expect, it } from 'vitest';
import { latestUndoableGymChange, reduceSession } from '@fizz/domain';
import { apply, at, hotelFixture, kg, logCmd, profile, values } from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';
import { openStore } from '../src/index';
import { memoryDriver } from './helpers';

const { BENCH, HOTEL, HOTEL_EQ, exerciseSets, propose, pushA, switchCmd } = hotelFixture;

/** Push A at Main Gym, bench sets 1–2 logged, then switched to Hotel · Lisbon. */
function switchedWorkout(): { before: SessionAggregate; after: SessionAggregate } {
  let s = pushA();
  const bench = exerciseSets(s, BENCH);
  s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 60));
  s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 7), 300));
  const r = reduceSession(s, switchCmd(propose(s, { id: HOTEL, equipment: HOTEL_EQ }), 320));
  if (!r.ok) throw new Error(r.error.message);
  return { before: s, after: r.state };
}

describe('a switched workout in SQLite (schema 4, ADR 0019)', () => {
  it('round-trips continuation rows, gym changes, fitted targets and the append-only snapshot', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const { before, after } = switchedWorkout();
    expect(await store.repos.sessions.save(before, null)).toMatchObject({ ok: true });
    expect(await store.repos.sessions.save(after, before.revision)).toMatchObject({ ok: true });
    const read = await store.repos.sessions.get(after.session.id);
    expect(read).toEqual(after);
    expect(read?.exercises.some((e) => e.continuesFromId !== undefined)).toBe(true);
    expect(read?.session.gymChanges).toHaveLength(1);
    expect(read?.sets.some((x) => x.planned.snap?.reason === 'not_here')).toBe(true);
    await store.close();
  });

  it('Undo keeps the (now empty) continuation row: rows are never deleted', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const { before, after } = switchedWorkout();
    await store.repos.sessions.save(before, null);
    await store.repos.sessions.save(after, before.revision);
    const change = latestUndoableGymChange(after);
    const undone = apply(after, { type: 'undo_change_gym', at: at(330), opId: 'undo', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' });
    expect(await store.repos.sessions.save(undone, after.revision)).toMatchObject({ ok: true });
    const read = await store.repos.sessions.get(after.session.id);
    expect(read).toEqual(undone);
    expect(read?.session.gymId).toBe(before.session.gymId);
    expect(read?.exercises).toHaveLength(after.exercises.length);
    await store.close();
  });

  it('a continuation pointing at a row that isn’t there is never read back as valid', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    const { before } = switchedWorkout();
    const broken = { ...before, exercises: before.exercises.map((e, i) => (i === 0 ? { ...e, continuesFromId: before.session.id } : e)) };
    // Refused on write where foreign keys are enforced (this driver), and by the read-side reference check otherwise.
    const wrote = await store.repos.sessions.save(broken, null).then(
      () => true,
      (e: unknown) => {
        expect(String(e)).toContain('FOREIGN KEY');
        return false;
      },
    );
    if (wrote) await expect(store.repos.sessions.get(before.session.id)).rejects.toThrow('No such session exercise');
    await store.close();
  });
});
