import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GymSchema, type Exercise, type Gym, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { createSessionService, startWorkout, type Repositories } from '../src/index';
import {
  assisted,
  at,
  barbell,
  bodyweightStation,
  doubleProgression,
  dumbbells,
  exercise,
  GYM,
  id,
  idGen,
  kg,
  OWNER,
  plateMachine,
  profile,
  routine,
  routineExercise,
  stack,
  T0,
  template,
  topSetBackoff,
  values,
} from './fixtures';
import { apply, logCmd, startFixture } from './session-fixture';

/**
 * Shared contract for the storage ports in `ports.ts`. Every implementation
 * (in-memory, SQLite) must pass it. The factory returns fresh, empty storage;
 * `close` (optional) releases it after each test.
 */
export interface RepositoryHarness {
  repos: Repositories;
  close?: () => Promise<void>;
}

export const OTHER_OWNER = id(9);

export function gym(n: number, over: Partial<Gym> = {}): Gym {
  return GymSchema.parse({
    id: id(n),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: T0,
    updatedAtUtc: T0,
    name: `Gym ${n}`,
    isDefault: false,
    ...over,
  });
}

const SPLIT_SQUAT = exercise(230, 'Bulgarian split squat', {
  compatibleEquipment: ['dumbbells'],
  defaultLoadConvention: 'per_hand',
  laterality: 'unilateral',
});

/** A unilateral dumbbell session: three planned sets of split squats. */
export function unilateralSession(opId = 'start-uni', newId = idGen(60_000)): SessionAggregate {
  const rack = dumbbells();
  const r = routine([
    routineExercise(700, {
      exerciseId: SPLIT_SQUAT.id,
      equipmentId: rack.id,
      order: 0,
      setTemplates: [7001, 7002, 7003].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })),
    }),
  ]);
  return startWorkout({
    opId,
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises: new Map([[SPLIT_SQUAT.id, SPLIT_SQUAT]]),
    gymEquipment: [rack],
    at: at(0),
    newId,
  }).aggregate;
}

/**
 * A session that exercises every persisted part of the aggregate: logged,
 * corrected, undone, deleted and skipped sets; an other-side companion row;
 * closed pauses; an added set (createdIds); a finish with a chosen end time
 * and a later timing correction (timing audit). The reducer bumps `revision` on every step.
 */
export function richFinishedSession(): SessionAggregate {
  let s = unilateralSession();
  const step = (cmd: SessionCommand) => {
    s = apply(s, cmd);
  };
  const [a, b, c] = s.sets;
  if (!a || !b || !c) throw new Error('fixture');
  step(logCmd(a.id, values(kg(15, 'per_hand'), 10, { rpe: 8 }), 60, 'log-a', 'left'));
  const companion = s.session.activeSetId ?? '';
  step(logCmd(companion, values(kg(15, 'per_hand'), 9, { rir: 2 }), 90, 'log-a-right'));
  step({ type: 'pause', at: at(100), opId: 'pause-1' });
  step({ type: 'resume', at: at(160), opId: 'resume-1' });
  step(logCmd(b.id, values(kg(15, 'per_hand'), 7), 200, 'log-b'));
  const logged = s.sets.find((x) => x.id === b.id);
  step({ type: 'correct_set', at: at(210), opId: 'fix-b', setId: b.id, expectedSetVersion: logged?.version ?? 1, patch: { reps: 8 } });
  step({ type: 'add_set', at: at(220), opId: 'add-1', sessionExerciseId: s.exercises[0]?.id ?? '', newSetId: id(61_000), setType: null });
  const added = s.sets.find((x) => x.id === id(61_000));
  step({ type: 'delete_set', at: at(230), opId: 'del-1', setId: id(61_000), expectedSetVersion: added?.version ?? 1 });
  step(logCmd(c.id, values(kg(15, 'per_hand'), 8), 300, 'log-c'));
  const cLogged = s.sets.find((x) => x.id === c.id);
  step({ type: 'undo_log', at: at(305), opId: 'undo-c', setId: c.id, expectedSetVersion: cLogged?.version ?? 1 });
  step({ type: 'finish', at: at(4000), opId: 'finish', expectedVersion: s.session.version, endedAt: at(600) });
  step({
    type: 'update_session_timing',
    at: at(4100),
    opId: 'timing-1',
    expectedVersion: s.session.version,
    startedAt: at(-60),
    endedAt: null,
  });
  return s;
}

export function describeRepositoryContract(name: string, setup: () => Promise<RepositoryHarness>): void {
  describe(`repository contract: ${name}`, () => {
    let harness: RepositoryHarness;
    let repos: Repositories;

    beforeEach(async () => {
      harness = await setup();
      repos = harness.repos;
    });
    afterEach(async () => {
      await harness.close?.();
    });

    describe('versioned records', () => {
      it('creates, reads, updates and rejects stale or duplicate writes', async () => {
        expect(await repos.profiles.get(OWNER)).toBeNull();
        const p = profile();
        expect(await repos.profiles.save(p, null)).toEqual({ ok: true, version: 1 });
        expect(await repos.profiles.get(OWNER)).toEqual(p);
        expect(await repos.profiles.save(p, null)).toEqual({ ok: false, error: 'conflict', currentVersion: 1 });

        const p2 = { ...p, version: 2, preferredUnit: 'lb' as const };
        expect(await repos.profiles.save(p2, 1)).toEqual({ ok: true, version: 2 });
        expect(await repos.profiles.get(OWNER)).toEqual(p2);
        // A stale writer still holding version 1 is rejected, and nothing changes.
        expect(await repos.profiles.save({ ...p, version: 2, effortScale: 'off' }, 1)).toEqual({
          ok: false,
          error: 'conflict',
          currentVersion: 2,
        });
        expect(await repos.profiles.get(OWNER)).toEqual(p2);
        // Updating a record that doesn't exist is a conflict, not an upsert.
        expect(await repos.gyms.save(gym(20, { version: 2 }), 1)).toEqual({ ok: false, error: 'conflict', currentVersion: null });
        expect(await repos.gyms.get(id(20))).toBeNull();
      });

      it('returns copies, never live references', async () => {
        await repos.gyms.save(gym(20), null);
        const read = await repos.gyms.get(id(20));
        if (!read) throw new Error('missing');
        read.name = 'Mutated';
        expect((await repos.gyms.get(id(20)))?.name).toBe('Gym 20');
      });

      it('lists gyms and routines by owner', async () => {
        await repos.gyms.save(gym(20), null);
        await repos.gyms.save(gym(21, { isDefault: true, locationLabel: 'Home', notes: 'garage' }), null);
        await repos.gyms.save(gym(22, { ownerId: OTHER_OWNER }), null);
        const mine = await repos.gyms.listByOwner(OWNER);
        expect(mine.map((g) => g.id).sort()).toEqual([id(20), id(21)]);
        expect(mine.find((g) => g.id === id(21))).toEqual(gym(21, { isDefault: true, locationLabel: 'Home', notes: 'garage' }));

        const r = routine([
          routineExercise(500, {
            exerciseId: id(200),
            restBySetType: { warmup: { seconds: 60, presetName: 'Warm-up' }, working: { seconds: 180 } },
            supersetGroup: 'A',
            transitionRestS: 15,
          }),
        ]);
        await repos.routines.save(r, null);
        await repos.routines.save({ ...r, id: id(301), ownerId: OTHER_OWNER }, null);
        expect(await repos.routines.listByOwner(OWNER)).toEqual([r]);
        expect(await repos.routines.get(r.id)).toEqual(r);
      });

      it('round-trips every equipment kind, in kg and lb, and lists by gym', async () => {
        const all = [
          barbell(),
          dumbbells({ unit: 'lb', loads: [5, 10, 12.5, 15], maxLoad: 15, make: 'Rogue', model: 'Hex', station: 'Rack 2' }),
          stack({ addOns: [2.5], minLoad: 10, notes: 'pin sticks at 45' }),
          assisted(),
          plateMachine({ loadingSides: 1 }),
          bodyweightStation(),
        ];
        for (const eq of all) expect(await repos.equipment.save(eq, null)).toEqual({ ok: true, version: 1 });
        await repos.equipment.save({ ...barbell(), id: id(150), gymId: id(3) }, null);
        for (const eq of all) expect(await repos.equipment.get(eq.id)).toEqual(eq);
        const listed = await repos.equipment.listByGym(GYM);
        expect(listed.map((e) => e.id).sort()).toEqual(all.map((e) => e.id).sort());
        expect(await repos.equipment.listByGym(id(3))).toHaveLength(1);
      });

      it('round-trips catalogue and custom exercises and progression rules', async () => {
        const custom: Exercise = exercise(240, 'Landmine press', { ownerId: OWNER, source: 'custom', defaultRestS: 75 });
        const catalogue = exercise(241, 'Plank', { measurement: 'duration', laterality: 'bilateral' });
        await repos.exercises.save(custom, null);
        await repos.exercises.save(catalogue, null);
        expect((await repos.exercises.list()).sort((a, b) => a.id.localeCompare(b.id))).toEqual([custom, catalogue]);
        expect(await repos.exercises.get(custom.id)).toEqual(custom);

        const dp = doubleProgression({ startingLoad: { value: 40, unit: 'kg' }, maxLoadJump: { value: 5, unit: 'lb' } });
        const ts = topSetBackoff();
        await repos.progressionRules.save(dp, null);
        await repos.progressionRules.save(ts, null);
        expect(await repos.progressionRules.get(dp.id)).toEqual(dp);
        expect(await repos.progressionRules.get(ts.id)).toEqual(ts);
      });
    });

    describe('sessions', () => {
      it('creates, reads and rejects a second create or a stale revision', async () => {
        const { state } = startFixture();
        expect(await repos.sessions.get(state.session.id)).toBeNull();
        const r0 = state.revision;
        expect(await repos.sessions.save(state, null)).toEqual({ ok: true, version: r0 });
        expect(await repos.sessions.get(state.session.id)).toEqual(state);
        expect(await repos.sessions.save(state, null)).toEqual({ ok: false, error: 'conflict', currentVersion: r0 });

        const set = state.sets[0];
        if (!set) throw new Error('fixture');
        const next = apply(state, logCmd(set.id, values(kg(60), 10), 30, 'log-1'));
        expect(next.revision).toBe(r0 + 1);
        expect(await repos.sessions.save(next, r0)).toEqual({ ok: true, version: r0 + 1 });
        expect(await repos.sessions.get(state.session.id)).toEqual(next);
        // A writer that still holds the old revision loses; storage keeps the newer one.
        const stale = apply(state, { type: 'pause', at: at(40), opId: 'pause-stale' });
        expect(await repos.sessions.save(stale, r0)).toEqual({ ok: false, error: 'conflict', currentVersion: r0 + 1 });
        expect(await repos.sessions.get(state.session.id)).toEqual(next);
      });

      it('finds the active session and the start operation, scoped to the owner', async () => {
        const { state } = startFixture();
        await repos.sessions.save(state, null);
        expect((await repos.sessions.getActive(OWNER))?.session.id).toBe(state.session.id);
        expect(await repos.sessions.getActive(OTHER_OWNER)).toBeNull();
        expect((await repos.sessions.findByStartOperation(OWNER, 'start-1'))?.session.id).toBe(state.session.id);
        expect(await repos.sessions.findByStartOperation(OTHER_OWNER, 'start-1')).toBeNull();
        expect(await repos.sessions.findByStartOperation(OWNER, 'start-2')).toBeNull();

        const finished = apply(state, { type: 'finish', at: at(60), opId: 'fin', expectedVersion: state.session.version, endedAt: null });
        expect(await repos.sessions.save(finished, state.revision)).toMatchObject({ ok: true });
        expect(await repos.sessions.getActive(OWNER)).toBeNull();
        expect((await repos.sessions.findByStartOperation(OWNER, 'start-1'))?.session.status).toBe('finished');
      });

      it('round-trips a full aggregate: pauses, audits, companions, tombstones, processed ops', async () => {
        const rich = richFinishedSession();
        // The fixture really covers what it claims.
        expect(rich.session.pauses).toHaveLength(1);
        expect(rich.timingAudit.map((t) => t.source)).toEqual(['finish', 'correction']);
        expect(new Set(rich.audit.map((a) => a.kind))).toEqual(new Set(['logged', 'corrected', 'undone', 'deleted', 'skipped']));
        expect(rich.sets.some((x) => x.pairedWithSetId !== null)).toBe(true);
        expect(rich.processedOps['add-1']?.createdIds).toEqual([id(61_000)]);
        expect(rich.processedOps['log-a']?.createdIds).toBeUndefined();

        // Save it as the app would: once at start, then every intermediate state.
        const initial = unilateralSession();
        expect(await repos.sessions.save(initial, null)).toMatchObject({ ok: true });
        expect(await repos.sessions.save(rich, initial.revision)).toMatchObject({ ok: true });
        expect(await repos.sessions.get(rich.session.id)).toEqual(rich);
      });

      it('returns copies of aggregates', async () => {
        const { state } = startFixture();
        await repos.sessions.save(state, null);
        const read = await repos.sessions.get(state.session.id);
        if (!read) throw new Error('missing');
        read.sets.length = 0;
        expect((await repos.sessions.get(state.session.id))?.sets).toHaveLength(state.sets.length);
      });
    });

    describe('session service on this storage', () => {
      async function seed(): Promise<void> {
        await repos.profiles.save(profile(), null);
        await repos.equipment.save(dumbbells(), null);
        await repos.exercises.save(SPLIT_SQUAT, null);
        await repos.routines.save(
          routine([
            routineExercise(700, {
              exerciseId: SPLIT_SQUAT.id,
              equipmentId: dumbbells().id,
              setTemplates: [template(7001, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })],
            }),
          ]),
          null,
        );
      }

      it('starts idempotently and treats a repeated operation ID as a duplicate', async () => {
        await seed();
        const service = createSessionService(repos, idGen(70_000));
        const req = { ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-svc', at: at(0) };
        const started = await service.start(req);
        if (!started.ok) throw new Error(started.error.code);
        const again = await service.start(req);
        expect(again).toMatchObject({ ok: true, duplicate: true });
        if (!again.ok) throw new Error('unreachable');
        expect(again.aggregate.session.id).toBe(started.aggregate.session.id);

        const setId = started.aggregate.sets[0]?.id ?? '';
        const cmd = logCmd(setId, values(kg(15, 'per_hand'), 10), 60, 'log-svc');
        const first = await service.dispatch(started.aggregate.session.id, cmd);
        expect(first).toMatchObject({ ok: true, duplicate: false });
        const second = await service.dispatch(started.aggregate.session.id, cmd);
        expect(second).toMatchObject({ ok: true, duplicate: true, superseded: false });
        const stored = await repos.sessions.get(started.aggregate.session.id);
        expect(stored?.sets.filter((x) => x.status === 'completed')).toHaveLength(1);
        expect(stored?.revision).toBe(started.aggregate.revision + 1);
      });

      it('rejects a stale session version without writing', async () => {
        await seed();
        const service = createSessionService(repos, idGen(70_000));
        const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-svc', at: at(0) });
        if (!started.ok) throw new Error(started.error.code);
        const sessionId = started.aggregate.session.id;
        const staleVersion = started.aggregate.session.version;
        await service.dispatch(sessionId, logCmd(started.aggregate.sets[0]?.id ?? '', values(kg(15, 'per_hand'), 10), 60, 'log-x'));
        const before = await repos.sessions.get(sessionId);
        const out = await service.dispatch(sessionId, {
          type: 'finish',
          at: at(120),
          opId: 'fin-stale',
          expectedVersion: staleVersion,
          endedAt: null,
        });
        expect(out).toMatchObject({ ok: false, error: { code: 'stale_version' } });
        expect(await repos.sessions.get(sessionId)).toEqual(before);
      });
    });
  });
}
