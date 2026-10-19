import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import { at, BENCH, barbell, exercises, HANG, idGen, kg, OWNER, GYM, profile, stack, startFixture, values } from '@fizz/domain/testing';
import { openStore, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * `Superset with…` mid-workout and the Finish sheet's start time (Ben, 19 Oct) survive a
 * force-close (restart recovery): schema 24's `round_offset`, the link's Undo after a relaunch,
 * a retry with the same opId is a duplicate, and a stale version is refused.
 */

async function seed(store: Store): Promise<string> {
  const { repos } = store;
  await repos.profiles.save(profile(), null);
  await repos.equipment.save(barbell(), null);
  await repos.equipment.save(stack(), null);
  for (const e of exercises.values()) await repos.exercises.save(e, null);
  const r = startFixture().input.routine;
  await repos.routines.save(r, null);
  return r.id;
}

describe('superset link and finish times after a relaunch', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('keeps round_offset, undoes the link after a relaunch, and stores a start chosen at Finish', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    const routineId = await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId, opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sid = started.aggregate.session.id;
    let a = started.aggregate;
    const row = (exerciseId: string) => a.exercises.find((e) => e.exerciseId === exerciseId)?.id ?? '';
    const benchSets = a.sets.filter((x) => x.sessionExerciseId === row(BENCH)).sort((x, y) => x.index - y.index);
    for (const [i, set] of benchSets.slice(0, 2).entries()) {
      const r = await service.dispatch(sid, { type: 'log_set', at: at(60 * (i + 1)), opId: `log-${String(i)}`, setId: set.id, values: values(kg(i === 0 ? 60 : 100), 8), restTimerId: `00000000-0000-4000-8000-00000009900${String(i)}` });
      if (!r.ok) throw new Error(r.error.code);
      a = r.aggregate;
    }
    const link = { type: 'link_superset' as const, at: at(200), opId: 'link-1', expectedVersion: a.session.version, sessionExerciseId: row(HANG), withSessionExerciseId: row(BENCH) };
    const linked = await service.dispatch(sid, link);
    if (!linked.ok) throw new Error(linked.error.code);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(240));
    const hang = recovered?.state.exercises.find((e) => e.exerciseId === HANG);
    expect(hang).toMatchObject({ supersetGroup: 'B', roundOffset: 2 });
    expect(await service.dispatch(sid, link)).toMatchObject({ ok: true, duplicate: true, superseded: false });
    expect(await service.dispatch(sid, { ...link, opId: 'link-2' })).toMatchObject({ ok: false, error: { code: 'stale_version' } });
    const undone = await service.dispatch(sid, { type: 'undo_op', at: at(250), opId: 'undo-1', targetOpId: 'link-1' });
    if (!undone.ok) throw new Error(undone.error.code);
    expect(undone.aggregate.exercises.find((e) => e.exerciseId === HANG)?.supersetGroup).toBeNull();

    // Finish with a start 10 minutes earlier and an end before now.
    const fin = await service.dispatch(sid, { type: 'finish', at: at(3600), opId: 'fin-1', expectedVersion: undone.aggregate.session.version, endedAt: at(3000), startedAt: at(-600) });
    if (!fin.ok) throw new Error(fin.error.code);
    await store.close();

    store = await openStore(openNodeDriver(path));
    const saved = await store.repos.sessions.get(sid);
    expect(saved?.session.startedAt).toEqual(at(-600));
    expect(saved?.session.endedAt).toEqual(at(3000));
    expect(saved?.timingAudit.map((e) => [e.field, e.source])).toEqual([
      ['startedAt', 'finish'],
      ['endedAt', 'finish'],
    ]);
    await store.close();
  });
});
