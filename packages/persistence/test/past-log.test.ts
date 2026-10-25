import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand, ZonedTimestamp } from '@fizz/schemas';
import { createSessionService, lastComparableSession, toIso, toMs, unshiftedMs, type SessionService } from '@fizz/domain';
import { at, barbell, BENCH, exercises, GYM, id, idGen, kg, OWNER, profile, richFinishedSession, setsFor, stack, startFixture, TZ, values } from '@fizz/domain/testing';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * (Ben, 25 Oct) "I should be able to freely edit times, e.g. if I want to import a workout
 * historically from the day before or beyond." On real SQLite: a past log, a finished workout moved a
 * week back (pauses included), Undo, retries, stale versions, ordering by workout date, a relaunch.
 */

const MIN = 60;
const DAY = 24 * 3600;
const T0 = toMs(at(0).utc);
const z = (ms: number): ZonedTimestamp => ({ utc: toIso(ms), tz: TZ });

async function seed(store: Store): Promise<void> {
  await store.repos.profiles.save(profile(), null);
  for (const eq of [barbell(), stack()]) await store.repos.equipment.save(eq, null);
  for (const ex of exercises.values()) await store.repos.exercises.save(ex, null);
  const routine = startFixture().input.routine;
  if (!routine) throw new Error('fixture');
  await store.repos.routines.save(routine, null);
}

async function ok(service: SessionService, sessionId: string, cmd: SessionCommand): Promise<SessionAggregate> {
  const r = await service.dispatch(sessionId, cmd);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
}

/** A routine workout: bench warm-up and B1 logged `load` at +5 / +10 min after `startS`, optionally a pause, finished at +30 min. */
async function workout(service: SessionService, opId: string, startS: number, load: number, opts: { pastStart?: ZonedTimestamp; pause?: boolean; nowS?: number } = {}): Promise<SessionAggregate> {
  const nowS = opts.nowS ?? startS;
  const started = await service.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId, at: at(nowS), ...(opts.pastStart ? { pastStart: opts.pastStart } : {}) });
  if (!started.ok) throw new Error(started.error.code);
  const sid = started.aggregate.session.id;
  const live = opts.pastStart === undefined;
  const [w, b1] = setsFor(started.aggregate, BENCH);
  await ok(service, sid, { type: 'log_set', at: at(live ? startS + 5 * MIN : nowS + 1), opId: `${opId}-w`, setId: w?.id ?? '', values: values(kg(60), 10), restTimerId: id(91_000 + startS % 1000) });
  if (opts.pause) {
    await ok(service, sid, { type: 'pause', at: at(startS + 6 * MIN), opId: `${opId}-p` });
    await ok(service, sid, { type: 'resume', at: at(startS + 8 * MIN), opId: `${opId}-r` });
  }
  const s = await ok(service, sid, { type: 'log_set', at: at(live ? startS + 10 * MIN : nowS + 2), opId: `${opId}-b1`, setId: b1?.id ?? '', values: values(kg(load), 8), restTimerId: id(92_000 + startS % 1000) });
  const end = live ? null : z(toMs(s.session.startedAt.utc) + 45 * MIN * 1000);
  return ok(service, sid, { type: 'finish', at: at(live ? startS + 30 * MIN : nowS + 3), opId: `${opId}-fin`, expectedVersion: s.session.version, endedAt: end });
}

const shift = (s: SessionAggregate, nowS: number, startMs: number, endMs: number | null, opId: string): SessionCommand => ({
  type: 'update_session_timing',
  at: at(nowS),
  opId,
  expectedVersion: s.session.version,
  startedAt: z(startMs),
  endedAt: endMs === null ? null : z(endMs),
  shift: true,
});

describe('Log a past workout and move workouts in time, on SQLite', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('yesterday’s workout logged today sits at its date: history, last time and Up next order by date, not by insert', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    const service = createSessionService(store.repos, idGen(70_000));
    // Today's live workout first (−2 h), then yesterday's entered after it.
    const today = await workout(service, 'today', -2 * 3600, 100);
    const yesterday = T0 - DAY * 1000;
    const past = await workout(service, 'past', 0, 110, { pastStart: z(yesterday), nowS: 0 });
    expect(past.session.pastLog).toEqual({ enteredAt: at(0) });
    expect(past.session.startedAt.utc).toBe(toIso(yesterday));
    expect(toMs(past.session.endedAt?.utc ?? '')).toBe(yesterday + 45 * MIN * 1000);
    expect(past.restTimer).toBeNull();
    for (const x of past.sets.filter((y) => y.status === 'completed')) {
      expect(toMs(x.completedAt?.utc ?? '')).toBeGreaterThan(yesterday);
      expect(toMs(x.completedAt?.utc ?? '')).toBeLessThan(yesterday + 60_000);
    }

    // Ordered by workout date: the past log is older than today's, though written later.
    const refs = await store.repos.sessions.listFinishedRefs(OWNER, 10);
    expect(refs.map((r) => r.sessionId)).toEqual([today.session.id, past.session.id]);
    expect((await store.repos.sessions.latestFinished(OWNER))?.session.id).toBe(today.session.id);
    const history = await store.listExerciseHistory(OWNER, BENCH);
    // Newest first, by workout date.
    expect(history.map((h) => h.sessionId)).toEqual([today.session.id, past.session.id]);
    // "Last time" is today's (100 kg), never the heavier past log entered after it.
    const ex = today.exercises.find((e) => e.exerciseId === BENCH);
    if (!ex) throw new Error('fixture');
    expect(lastComparableSession(history, ex)?.sessionId).toBe(today.session.id);

    // A relaunch reads the same.
    await store.close();
    store = await openStore(openNodeDriver(path));
    const again = await store.repos.sessions.get(past.session.id);
    expect(again?.session.pastLog).toEqual({ enteredAt: at(0) });
    expect(again?.session.startedAt.utc).toBe(toIso(yesterday));
    expect((await store.repos.sessions.listFinishedRefs(OWNER, 10)).map((r) => r.sessionId)).toEqual([today.session.id, past.session.id]);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('an open past log survives a force-close: recovery restores it with no rest timer, and Start of another is refused until it is finished', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(72_000));
    const started = await service.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'past-open', at: at(0), pastStart: z(T0 - 2 * DAY * 1000) });
    if (!started.ok) throw new Error(started.error.code);
    const [w] = setsFor(started.aggregate, BENCH);
    await ok(service, started.aggregate.session.id, { type: 'log_set', at: at(5), opId: 'po-w', setId: w?.id ?? '', values: values(kg(60), 10), restTimerId: id(93_001) });
    await store.close();
    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(73_000));
    const recovered = await service.recover(OWNER, at(600));
    expect(recovered?.state.session.pastLog).toBeDefined();
    expect(recovered?.state.restTimer).toBeNull();
    const second = await service.start({ ownerId: OWNER, gymId: GYM, routineId: null, opId: 'live-2', at: at(700) });
    expect(second.ok ? null : second.error.code).toBe('session_already_active');
    await store.close();
  });

  it('an old workout moved a week back: sets, pause and end move; stored with the offset; Undo; a retry is a duplicate; a stale version is refused', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(74_000));
    const s = await workout(service, 'old', -3 * DAY, 100, { pause: true });
    const startMs = toMs(s.session.startedAt.utc);
    const back = startMs - 7 * DAY * 1000;
    const moveCmd = shift(s, 0, back, null, 'move-week');
    const moved = await ok(service, s.session.id, moveCmd);
    const off = back - startMs;
    expect(moved.session.pauses).toEqual(s.session.pauses.map((p) => ({ startUtc: toIso(toMs(p.startUtc) + off), endUtc: toIso(toMs(p.endUtc) + off) })));
    expect(moved.timingAudit.at(-2)?.shiftMs).toBe(off);

    // A retry (same op, e.g. after a relaunch) changes nothing more.
    await store.close();
    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(75_000));
    const stored = await store.repos.sessions.get(s.session.id);
    expect(stored?.session.startedAt.utc).toBe(toIso(back));
    expect(stored?.session.pauses).toEqual(moved.session.pauses);
    expect(stored?.timingAudit.find((e) => e.field === 'startedAt')?.shiftMs).toBe(off);
    const retry = await service.dispatch(s.session.id, { ...moveCmd, at: at(30) });
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    expect((await store.repos.sessions.get(s.session.id))?.revision).toBe(stored?.revision);
    // The sheet opened before the move is stale now.
    const stale = await service.dispatch(s.session.id, shift(s, 40, back - DAY * 1000, null, 'move-stale'));
    expect(stale.ok ? null : stale.error.code).toBe('stale_version');
    // Logged values unchanged (rule 2).
    expect(stored?.sets.map((x) => x.actual)).toEqual(s.sets.map((x) => x.actual));
    // Original times recoverable from the audit.
    const firstDone = stored?.sets.find((x) => x.status === 'completed');
    expect(unshiftedMs(firstDone?.completedAt?.utc ?? '', stored?.timingAudit ?? [])).toBe(toMs(s.sets.find((x) => x.id === firstDone?.id)?.completedAt?.utc ?? ''));

    // Undo: the same move back, a new op on the new version.
    if (!stored) throw new Error('missing');
    const undone = await ok(service, s.session.id, shift(stored, 60, startMs, toMs(s.session.endedAt?.utc ?? ''), 'undo-move-week'));
    expect(undone.session.startedAt.utc).toBe(s.session.startedAt.utc);
    expect(undone.session.endedAt?.utc).toBe(s.session.endedAt?.utc);
    expect(undone.session.pauses).toEqual(s.session.pauses);
    expect(undone.sets.map((x) => x.completedAt)).toEqual(s.sets.map((x) => x.completedAt));
    const reread = await store.repos.sessions.get(s.session.id);
    expect(reread?.session.pauses).toEqual(s.session.pauses);
    expect(reread?.timingAudit.filter((e) => e.shiftMs !== undefined).map((e) => e.shiftMs)).toEqual([off, -off]);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('a summarized workout moved a week back: its stored history summary moves in the same save, the check is clean, last time follows the dates', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(77_000));
    const older = await workout(service, 'older', -3 * DAY, 100);
    const newer = await workout(service, 'newer', -1 * DAY, 110, { pause: true });
    const summaryRow = (sid: string) =>
      store.db.read(async (q) => ({
        row: await q.getFirst<{ started_at_utc: string; revision: number; data: string }>('SELECT started_at_utc, revision, data FROM history_summaries WHERE session_id = ?', [sid]),
        lifts: (await q.getAll<{ started_at_utc: string }>('SELECT started_at_utc FROM history_summary_exercises WHERE session_id = ?', [sid])).map((r) => r.started_at_utc),
      }));
    const benchOf = (a: SessionAggregate) => {
      const ex = a.exercises.find((e) => e.exerciseId === BENCH);
      if (!ex) throw new Error('fixture');
      return ex;
    };
    // Before: the newer workout is last time.
    expect((await store.listExerciseHistory(OWNER, BENCH)).map((h) => h.sessionId)).toEqual([newer.session.id, older.session.id]);
    expect((await summaryRow(newer.session.id)).row?.started_at_utc).toBe(newer.session.startedAt.utc);

    // Moved a week back: now before the older one.
    const startMs = toMs(newer.session.startedAt.utc);
    const back = startMs - 7 * DAY * 1000;
    const moved = await ok(service, newer.session.id, shift(newer, 0, back, null, 'move-summarized'));
    const after = await summaryRow(newer.session.id);
    expect(after.row?.started_at_utc).toBe(toIso(back));
    expect(after.row?.revision).toBe(moved.revision);
    const data = JSON.parse(after.row?.data ?? 'null') as { session: { startedAt: { utc: string }; pauses: unknown } };
    expect(data.session.startedAt.utc).toBe(toIso(back));
    expect(data.session.pauses).toEqual(moved.session.pauses);
    expect(after.lifts.length).toBeGreaterThan(0);
    expect(new Set(after.lifts)).toEqual(new Set([toIso(back)]));
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, checked: 2, missing: [], differing: [], orphans: [], unreadable: [] });

    // Every summary-based read orders by the shifted date.
    expect((await store.repos.sessions.listFinishedRefs(OWNER, 10)).map((r) => r.sessionId)).toEqual([older.session.id, newer.session.id]);
    expect((await store.repos.sessions.latestFinished(OWNER))?.session.id).toBe(older.session.id);
    const history = await store.listExerciseHistory(OWNER, BENCH);
    expect(history.map((h) => h.sessionId)).toEqual([older.session.id, newer.session.id]);
    expect(history.find((h) => h.sessionId === newer.session.id)?.performedAtUtc).toBe(toIso(back));
    expect(lastComparableSession(history, benchOf(older))?.sessionId).toBe(older.session.id);
    const window = await store.repos.sessions.listFinishedBetweenReadable(OWNER, toIso(back - 1000), toIso(back + DAY * 1000));
    expect(window.sessions.map((w) => w.session.id)).toEqual([newer.session.id]);

    // A relaunch finds nothing to rebuild (written in the move's own transaction) and reads the same.
    await store.close();
    store = await openStore(openNodeDriver(path));
    expect(store.summaryRefresh).toMatchObject({ written: 0 });
    expect((await store.listExerciseHistory(OWNER, BENCH)).map((h) => h.sessionId)).toEqual([older.session.id, newer.session.id]);

    // Undo (the move back, a new op): the summary returns to its first date.
    service = createSessionService(store.repos, idGen(78_000));
    const current = await store.repos.sessions.get(newer.session.id);
    if (!current) throw new Error('missing');
    await ok(service, newer.session.id, shift(current, 60, startMs, toMs(newer.session.endedAt?.utc ?? ''), 'undo-move-summarized'));
    expect((await summaryRow(newer.session.id)).row?.started_at_utc).toBe(newer.session.startedAt.utc);
    expect((await store.listExerciseHistory(OWNER, BENCH)).map((h) => h.sessionId)).toEqual([newer.session.id, older.session.id]);
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, checked: 2 });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('a pause can only move with a timing shift written in the same save; the trigger refuses a change to its length', async () => {
    const store = await openStore(memoryDriver());
    await seed(store);
    const service = createSessionService(store.repos, idGen(76_000));
    const s = await workout(service, 'p', -3 * DAY, 100, { pause: true });
    const cur = await store.repos.sessions.get(s.session.id);
    if (!cur) throw new Error('missing');
    // Moved pause without a shift entry: a history rewrite.
    const sneaky = { ...cur, session: { ...cur.session, pauses: cur.session.pauses.map((p) => ({ startUtc: toIso(toMs(p.startUtc) - 1000), endUtc: toIso(toMs(p.endUtc) - 1000) })) }, revision: cur.revision + 1 };
    await expect(store.repos.sessions.save(sneaky, cur.revision)).rejects.toThrow(/session_pauses/);
    // Straight SQL: moving keeps its length (allowed by the trigger), changing the length is refused.
    await expect(store.db.write((tx) => tx.run("UPDATE session_pauses SET end_utc = '2030-01-01T00:00:00.000Z' WHERE session_id = ?", [s.session.id]))).rejects.toThrow(/only move/);
    const p = cur.session.pauses[0];
    if (!p) throw new Error('fixture');
    await store.db.write((tx) => tx.run('UPDATE session_pauses SET start_utc = ?, end_utc = ? WHERE session_id = ?', [toIso(toMs(p.startUtc) + 60_000), toIso(toMs(p.endUtc) + 60_000), s.session.id]));
    await store.close();
  });

  it('migration 37 in place on a schema-35 database, after 36: rows kept, the new columns NULL, summaries backfilled', async () => {
    const db = memoryDriver();
    const at35 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 35) });
    await at35.repos.profiles.save(profile(), null);
    await at35.repos.sessions.save(richFinishedSession(), null);
    const before = await at35.db.read((q) => exportTables(q));
    expect(await migrate(db)).toMatchObject({ from: 35, to: 37, applied: [36, 37] });
    const at37 = await openStore(db);
    const after = await at37.db.read((q) => exportTables(q));
    expect(after.sessions).toEqual((before.sessions ?? []).map((r) => ({ ...r, past_log: null })));
    expect(after.timing_audit).toEqual((before.timing_audit ?? []).map((r) => ({ ...r, shift_ms: null })));
    expect(after.session_pauses).toEqual(before.session_pauses);
    const got = await at37.repos.sessions.get(richFinishedSession().session.id);
    expect(got?.session.pastLog).toBeUndefined();
    expect((await checkIntegrity(at37.db)).ok).toBe(true);
    expect(await at37.checkHistorySummaries()).toMatchObject({ ok: true, checked: 1 });
    await at37.close();
  });

  it('migration 37 in place on a schema-36 database (history summaries already there): only 37 runs', async () => {
    const db = memoryDriver();
    const at36 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 36) });
    await at36.repos.profiles.save(profile(), null);
    await at36.repos.sessions.save(richFinishedSession(), null);
    expect(await at36.checkHistorySummaries()).toMatchObject({ ok: true, checked: 1 });
    expect(await migrate(db)).toMatchObject({ from: 36, to: 37, applied: [37] });
    const at37 = await openStore(db);
    expect(at37.summaryRefresh).toMatchObject({ written: 0 });
    expect(await at37.checkHistorySummaries()).toMatchObject({ ok: true, checked: 1 });
    expect((await checkIntegrity(at37.db)).ok).toBe(true);
    await at37.close();
  });

  it('a fresh database runs 36 (history summaries) before 37 (past logs)', () => {
    const order = MIGRATIONS.map((m) => m.version);
    expect(order.slice(-2)).toEqual([36, 37]);
    expect(MIGRATIONS.find((m) => m.version === 36)?.name).toBe('history-summaries');
    expect(MIGRATIONS.find((m) => m.version === 37)?.name).toBe('past-log-and-shift');
  });
});
