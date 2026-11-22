import { afterEach, describe, expect, it } from 'vitest';
import { at, id, OWNER } from '@fizz/domain/testing';
import type { CoachMessage, CoachThread, CoachTurn } from '@fizz/schemas';
import { openStore, TurnAlreadyRunningError, type Store } from '../src/index';
import { memoryDriver } from './helpers';

/** (Ben, 28 Oct) One turn per thread: a second `startTurn` while one is `running` is refused. */

const THREAD = id(900);

function thread(): CoachThread {
  return { id: THREAD, ownerId: OWNER, version: 1, createdAtUtc: at(0).utc, updatedAtUtc: at(0).utc, sessionId: null, title: 'Rest' };
}

function turn(n: number, over: Partial<CoachTurn> = {}): CoachTurn {
  return { id: id(n), ownerId: OWNER, version: 1, createdAtUtc: at(n).utc, updatedAtUtc: at(n).utc, threadId: THREAD, kind: 'general', status: 'running', error: null, model: 'm', contextHash: 'h', startedAt: at(n), endedAtUtc: null, toolLog: [], ...over };
}

function ben(n: number): Omit<CoachMessage, 'ordinal'> {
  return { id: id(n + 1), ownerId: OWNER, threadId: THREAD, turnId: id(n), createdAt: at(n), body: { role: 'ben', input: { kind: 'words', text: 'How long should I rest?', spoken: false } } };
}

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await openStore(memoryDriver());
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores) await s.close();
  stores = [];
});

describe('startTurn: one running turn per thread', () => {
  it('refuses a second turn while one runs, names it, and saves nothing for the refused one', async () => {
    const s = await store();
    await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(10), benMessage: ben(10) });
    const refused = s.repos.coach.startTurn({ thread: thread(), newThread: false, turn: turn(20), benMessage: ben(20) });
    await expect(refused).rejects.toBeInstanceOf(TurnAlreadyRunningError);
    await expect(refused).rejects.toMatchObject({ threadId: THREAD, runningTurnId: id(10) });
    expect(await s.repos.coach.getTurn(id(20))).toBeNull();
    expect((await s.repos.coach.listMessages(THREAD)).map((m) => m.turnId)).toEqual([id(10)]);
  });

  it('the same turn ID again is still a replay, not a refusal', async () => {
    const s = await store();
    await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(10), benMessage: ben(10) });
    const again = await s.repos.coach.startTurn({ thread: thread(), newThread: false, turn: turn(10), benMessage: ben(10) });
    expect(again.replayed).toBe(true);
  });

  it('starts once the running turn ended, or once a stale one is interrupted', async () => {
    const s = await store();
    await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(10), benMessage: ben(10) });
    const interrupted = await s.repos.coach.interruptTurn(id(10), at(15).utc);
    expect(interrupted).toMatchObject({ status: 'interrupted', endedAtUtc: at(15).utc, version: 2 });
    // Only a running turn is touched.
    expect(await s.repos.coach.interruptTurn(id(10), at(16).utc)).toMatchObject({ version: 2 });
    const next = await s.repos.coach.startTurn({ thread: thread(), newThread: false, turn: turn(20), benMessage: ben(20) });
    expect(next.replayed).toBe(false);
  });
});
