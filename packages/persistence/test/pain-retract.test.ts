import { describe, expect, it } from 'vitest';
import { clearPainFlag, newPainFlag, retractPainFlag } from '@fizz/domain';
import { at, id, OWNER, profile, SPLIT_SQUAT } from '@fizz/domain/testing';
import { MIGRATIONS, openStore } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * Retracted pain flags (review B2): schema 4 rebuilds `pain_flags` so its
 * status allows `retracted`. Rows saved at schema 3 come through unchanged,
 * and a retracted flag is never listed as active.
 */
const flag = (n: number, seconds = 0) =>
  newPainFlag({ id: id(n), ownerId: OWNER, opId: `pain-${String(n)}`, exerciseId: SPLIT_SQUAT.id, exerciseName: SPLIT_SQUAT.name, area: 'knee', source: 'workout', checkInId: null, at: at(seconds) });

describe('pain_flags at schema 4', () => {
  it('keeps every schema-3 flag through the rebuild, then stores a retraction', async () => {
    const driver = memoryDriver();
    const v3 = await openStore(driver, { migrations: MIGRATIONS.slice(0, 3) });
    await v3.repos.profiles.save(profile(), null);
    const active = flag(900);
    const cleared = clearPainFlag(flag(901), at(60));
    expect(await v3.repos.painFlags.save(active, null)).toEqual({ ok: true, version: 1 });
    expect(await v3.repos.painFlags.save(cleared, null)).toMatchObject({ ok: true });
    // Before schema 4, the database refuses the new status.
    const early = retractPainFlag(active, at(90), 'undo-early');
    await expect(v3.db.write((tx) => tx.run("UPDATE pain_flags SET status = 'retracted' WHERE id = ?", [early.id]))).rejects.toThrow();

    const v4 = await openStore(driver);
    expect(v4.migration.applied).toEqual([4]);
    expect(await v4.repos.painFlags.get(active.id)).toEqual(active);
    expect(await v4.repos.painFlags.get(cleared.id)).toEqual(cleared);

    const retracted = retractPainFlag(active, at(120), 'undo-1');
    expect(retracted).toMatchObject({ status: 'retracted', clearedAtUtc: null, retracted: { atUtc: at(120).utc, opId: 'undo-1' }, version: 2 });
    expect(await v4.repos.painFlags.save(retracted, 1)).toEqual({ ok: true, version: 2 });
    expect(await v4.repos.painFlags.get(active.id)).toEqual(retracted);
    expect(await v4.repos.painFlags.listActive(OWNER)).toEqual([]);
    // A stale retraction (an older version) is refused, never applied to newer state.
    expect(await v4.repos.painFlags.save(retractPainFlag(active, at(130), 'undo-2'), 1)).toMatchObject({ ok: false });
    await v4.close();
  });

  it('only an active flag can be retracted; a cleared or retracted one is left as it is', () => {
    const cleared = clearPainFlag(flag(902), at(60));
    expect(retractPainFlag(cleared, at(90), 'u')).toBe(cleared);
    const retracted = retractPainFlag(flag(903), at(60), 'u');
    expect(retractPainFlag(retracted, at(90), 'u2')).toBe(retracted);
    expect(clearPainFlag(retracted, at(90))).toBe(retracted);
  });
});
