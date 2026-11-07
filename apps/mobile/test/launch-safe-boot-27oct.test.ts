import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Hang fix, 27 Oct: build 457 stayed blank after Start, and blank at every launch after it.) A safe start boots
 * without the unfinished workout's recovery: it is read as stored, by name, never ticked or written, so nothing the
 * workout holds can stop the Safe start screen; Resume recovers it then.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-27T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

describe('safe boot with a workout in progress', () => {
  it('reads it by name without recovering or writing it; a normal launch still recovers it', async () => {
    const first = await h.launch();
    const gymId = await setUpGym(h, first.services);
    const started = await first.services.sessions.startEmpty({ gymId, opId: 'start-safe' });
    if (!started.ok) throw new Error(started.error.message);
    await h.forceClose();
    h.clockMs += 3_600_000;

    const safe = await h.launch({ safe: true });
    expect(safe.recovery).toBeNull();
    expect(safe.recoveryError).toBeNull();
    expect(safe.activeWorkout).toEqual({ name: null });
    const stored = await safe.services.sessions.active();
    expect(stored?.revision).toBe(started.aggregate.revision);
    // Resume: recovered then.
    const resumed = await safe.services.sessions.recover();
    expect(resumed?.state.session.id).toBe(started.aggregate.session.id);
    await h.forceClose();

    const normal = await h.launch();
    expect(normal.activeWorkout).toBeNull();
    expect(normal.recovery?.state.session.id).toBe(started.aggregate.session.id);
  }, 60_000);

  it('no workout in progress: a safe boot has nothing to show', async () => {
    const first = await h.launch();
    await setUpGym(h, first.services);
    await h.forceClose();
    const safe = await h.launch({ safe: true });
    expect(safe.activeWorkout).toBeNull();
    expect(safe.recovery).toBeNull();
  }, 60_000);
});
