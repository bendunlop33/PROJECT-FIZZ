import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyseImport,
  buildImportedSession,
  buildLiftHighlight,
  DEFAULT_ANSWERS,
  parseFitNotesCsv,
  pastExercisesOf,
  planImportRows,
  purgeAfterUtc,
  starterExercises,
  toHistorySessions,
  toMs,
  type MatchCandidate,
} from '@fizz/domain';
import { HISTORY_EXERCISES, id, idGen, largeHistory, OWNER, profile } from '@fizz/domain/testing';
import type { ImportJob, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
import {
  checkIntegrity,
  countDomains,
  countDomainsIn,
  createBackup,
  DatabaseManager,
  exportDomain,
  exportTables,
  openStore,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * Deleting finished workouts on real SQLite (delete-workouts.md): the
 * status change and its audit, idempotency and stale refusals, every
 * derived reader, Recently deleted, the purge and its tombstone, imports,
 * exports, and the backup round trip.
 */

const TZ = 'Europe/London';
const z = (utc: string): ZonedTimestamp => ({ utc, tz: TZ });
const NOW = z('2026-10-09T07:12:00.000Z');
const DAY_31 = z('2026-11-09T00:00:00.000Z');
const BENCH = HISTORY_EXERCISES[0]?.id ?? '';

let store: Store;
let history: SessionAggregate[];

beforeEach(async () => {
  store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  for (const e of HISTORY_EXERCISES) await store.repos.exercises.save(e, null);
  history = largeHistory({ weeks: 2, perWeek: 3 });
  for (const a of history) expect(await store.repos.sessions.save(a, null)).toMatchObject({ ok: true });
});
afterEach(async () => {
  await store.close();
});

const latest = () => history.at(-1) as SessionAggregate;
const item = (a: SessionAggregate) => ({ sessionId: a.session.id, expectedVersion: a.session.version });

async function del(list: readonly SessionAggregate[], opId = 'del-1', at = NOW) {
  const out = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: list.map(item), opId, at });
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out;
}

/** Raw rows of a session's tables, to compare before and after. */
async function rowsOf(sessionId: string) {
  return store.db.read(async (q) => ({
    sets: await q.getAll('SELECT * FROM session_sets WHERE session_id = ? ORDER BY id', [sessionId]),
    exercises: await q.getAll('SELECT * FROM session_exercises WHERE session_id = ? ORDER BY id', [sessionId]),
    audit: await q.getAll('SELECT * FROM set_audit WHERE session_id = ? ORDER BY ordinal', [sessionId]),
  }));
}

describe('deleteWorkouts and restoreWorkouts on SQLite', () => {
  it('changes only the status and deletion record; every set row and version is unchanged; the operation is recorded (DW6)', async () => {
    const a = latest();
    const before = await rowsOf(a.session.id);
    const out = await del([a]);
    expect(out).toEqual({ ok: true, duplicate: false, refs: [{ sessionId: a.session.id, version: a.session.version + 1 }] });
    expect(await rowsOf(a.session.id)).toEqual(before);
    const stored = await store.repos.sessions.get(a.session.id);
    expect(stored?.session).toMatchObject({ status: 'deleted', deletion: { at: NOW, opId: 'del-1', purgeAfterUtc: purgeAfterUtc(NOW) } });
    expect(stored?.revision).toBe(a.revision + 1);
    expect(stored?.processedOps['del-1']).toMatchObject({ commandType: 'delete_workout' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('a retry with the same operation ID writes nothing new (DW7)', async () => {
    const a = latest();
    await del([a]);
    const digest = await store.finishedWorkoutsDigest();
    const stored = await store.repos.sessions.get(a.session.id);
    const again = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a)], opId: 'del-1', at: NOW });
    expect(again).toEqual({ ok: true, duplicate: true, refs: [{ sessionId: a.session.id, version: a.session.version + 1 }] });
    expect(await store.repos.sessions.get(a.session.id)).toEqual(stored);
    expect(await store.finishedWorkoutsDigest()).toBe(digest);
  });

  it('a workout changed since it was selected refuses the whole delete (DW8); an already-deleted one in a new operation is stale', async () => {
    const [a, b, c] = history;
    if (!a || !b || !c) throw new Error('fixture');
    // `b` was corrected from another screen after the list loaded.
    const set = b.sets.find((s) => s.status === 'completed');
    const fixed = await store.repos.sessions.save(
      { ...b, session: { ...b.session, version: b.session.version + 1 }, sets: b.sets.map((s) => (s.id === set?.id ? { ...s, version: s.version + 1, edited: true } : s)), revision: b.revision + 1 },
      b.revision,
    );
    expect(fixed).toMatchObject({ ok: true });
    const out = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a), item(b), item(c)], opId: 'del-sel', at: NOW });
    expect(out).toEqual({ ok: false, error: { code: 'stale', sessionIds: [b.session.id] } });
    for (const x of [a, b, c]) expect((await store.repos.sessions.get(x.session.id))?.session.status).toBe('finished');

    await del([a], 'del-a');
    const second = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version + 1 }], opId: 'del-a-2', at: NOW });
    expect(second).toMatchObject({ ok: false, error: { code: 'stale' } });
  });

  it('Undo restores exactly that operation’s workouts with the same values and version + 1; a later delete’s Undo leaves the earlier one (DW9)', async () => {
    const [a, b, c] = history;
    if (!a || !b || !c) throw new Error('fixture');
    const before = await rowsOf(a.session.id);
    const first = await del([a, b], 'del-first');
    const second = await del([c], 'del-second');
    const undo = await store.repos.sessions.restoreWorkouts({
      ownerId: OWNER,
      items: second.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })),
      opId: 'undo-second',
      at: z('2026-10-09T07:12:05.000Z'),
    });
    expect(undo).toMatchObject({ ok: true, refs: [{ sessionId: c.session.id, version: c.session.version + 2 }] });
    expect((await store.repos.sessions.get(c.session.id))?.session.status).toBe('finished');
    expect((await store.repos.sessions.get(a.session.id))?.session.status).toBe('deleted');
    const restored = await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: first.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })), opId: 'undo-first', at: NOW });
    expect(restored.ok).toBe(true);
    const back = await store.repos.sessions.get(a.session.id);
    expect(back?.session.status).toBe('finished');
    expect(back?.session.deletion).toBeUndefined();
    expect(back?.session.version).toBe(a.session.version + 2);
    expect(await rowsOf(a.session.id)).toEqual(before);
    expect(Object.keys(back?.processedOps ?? {})).toEqual(expect.arrayContaining(['del-first', 'undo-first']));
  });

  it('Restore after the 30 days is refused, and a stale restore version too (DW21)', async () => {
    const a = latest();
    const out = await del([a]);
    const ref = out.refs[0];
    if (!ref) throw new Error('no ref');
    expect(await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: ref.version }], opId: 'r-late', at: DAY_31 })).toMatchObject({ ok: false, error: { code: 'stale' } });
    expect(await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: ref.version - 1 }], opId: 'r-stale', at: NOW })).toMatchObject({ ok: false, error: { code: 'stale' } });
  });
});

describe('every derived reader leaves a deleted workout out, and has it back on Restore (§5, DW10–DW19)', () => {
  /** Every reader of finished workouts in the store, as one comparable snapshot. */
  async function readers() {
    const s = store.repos.sessions;
    const ids = (list: readonly SessionAggregate[]) => list.map((a) => a.session.id);
    const withBench = await s.listFinishedWithExercise(OWNER, BENCH);
    return {
      listFinishedWithExercise: ids(withBench),
      listFinishedBetween: ids(await s.listFinishedBetween(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')),
      listFinishedBetweenReadable: ids((await s.listFinishedBetweenReadable(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).sessions),
      latestFinished: (await s.latestFinished(OWNER))?.session.id ?? null,
      earliestFinishedStartUtc: await s.earliestFinishedStartUtc(OWNER),
      listRepeatableIds: await s.listRepeatableIds(OWNER, 100),
      listPastWorkoutIds: await s.listPastWorkoutIds(OWNER, 100),
      listFinishedRefs: (await s.listFinishedRefs(OWNER, 100)).map((r) => r.sessionId),
      listExerciseHistory: (await store.listExerciseHistory(OWNER, BENCH)).map((h) => [h.sessionId, h.sets.length]),
      countRecords: await store.countRecords(),
      digest: await store.finishedWorkoutsDigest(),
      countDomainsIn: (await countDomainsIn(store.db.driver)).yourData.workouts,
      // Workouts and sets only: `records` counts every Your-data row, deleted ones included (Delete my data removes them).
      countDomains: (({ workouts, sets }) => ({ workouts, sets }))(countDomains(await store.db.read((q) => exportTables(q))).yourData),
      lastValues: pastExercisesOf(withBench, BENCH),
      liftHighlight: buildLiftHighlight(withBench),
    };
  }

  it('deleting the latest workout recomputes every view as if it never existed; Restore brings back the original', async () => {
    const original = await readers();
    const a = latest();
    // What the views would be if the workout had never been logged.
    const never = await openStore(memoryDriver());
    await never.repos.profiles.save(profile(), null);
    for (const e of HISTORY_EXERCISES) await never.repos.exercises.save(e, null);
    for (const x of history.slice(0, -1)) await never.repos.sessions.save(x, null);
    const s = store;
    store = never;
    const expected = await readers();
    store = s;
    await never.close();

    const out = await del([a]);
    const deleted = await readers();
    expect({ ...deleted, digest: null, countDomainsIn: deleted.countDomainsIn }).toEqual({ ...expected, digest: null });
    expect(deleted.digest).toBe(expected.digest);
    expect(deleted.latestFinished).toBe(history.at(-2)?.session.id);
    expect(deleted.listRepeatableIds).not.toContain(a.session.id);
    // Restore: every view as it was, except the digest (the revision moved on, so a backup is due).
    const ref = out.refs[0];
    if (!ref) throw new Error('no ref');
    expect((await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: ref.sessionId, expectedVersion: ref.version }], opId: 'res', at: NOW })).ok).toBe(true);
    const back = await readers();
    expect({ ...back, digest: null }).toEqual({ ...original, digest: null });
    expect(back.digest).not.toBe(original.digest);
  });

  it('toHistorySessions of the stored deleted aggregate is empty (records, e1RM and next targets read only through it)', async () => {
    const a = latest();
    await del([a]);
    const stored = await store.repos.sessions.get(a.session.id);
    if (!stored) throw new Error('gone');
    expect(toHistorySessions(stored, BENCH)).toEqual([]);
  });

  it('no reader compares a session status except through the one predicate, or with a listed reason (DW19, review S2)', () => {
    const root = join(__dirname, '..', '..', '..');
    const dirs = ['packages/domain/src', 'packages/persistence/src', 'packages/coach/src', 'packages/schemas/src', 'packages/providers/src', 'apps/mobile/src'];
    // What is checked:
    // - any comparison with `finished`, `discarded` or `reverted` (TS `===`/`!==`, SQL `=`/`<>`/`IN (...)`); session and
    //   import-job statuses use these words, set statuses don't;
    // - `deleted` compared on a session in TS (`session.status`) or in SQL (sets compare `deleted` only in TS, on `s.status`).
    // Writes (`SET status = ...`) aren't reads.
    const patterns = [
      /status\s*(?:===|!==|=|<>|!=)\s*'(?:finished|discarded|reverted)'|status\s+(?:NOT\s+)?IN\s*\([^)]*'(?:finished|discarded|reverted)'/,
      /session\??\.status\s*(?:===|!==)\s*'deleted'|status\s*(?:=|<>|!=)\s*'deleted'|status\s+(?:NOT\s+)?IN\s*\([^)]*'deleted'/,
    ];
    const write = /SET\s+status\s*=/;
    // Allowed, each for a reason.
    const allowed: Record<string, { why: string; lines: RegExp }> = {
      'packages/domain/src/session/deletion.ts': { why: 'the predicate itself and the delete/restore planner', lines: /./ },
      'packages/domain/src/session/reducer.ts': { why: 'the command guard: a state machine, not a reader', lines: /./ },
      'packages/persistence/src/sessions.ts': {
        why: 'the deletion record check on read, Recently deleted, and the purge: the deletion lifecycle itself',
        lines: /deletion !== undefined|status = 'deleted' AND purge_after_utc|AND status = 'deleted'"|row\?\.status !== 'deleted'/,
      },
      'packages/persistence/src/coach.ts': { why: '`startedFrom`: was a routine started since (active included)', lines: /status IN \('active', 'finished'\)/ },
      'packages/persistence/src/imports.ts': {
        why: '`appDates` (active included), import-job status, the job’s deleted count, deleted import dates, and `revertJob` (a writer)',
        lines: /status IN \('active', 'finished'\)|status <> 'reverted'"|job\.status === 'reverted'|status = 'deleted' AND purge_after_utc|AND status = 'deleted'"|status IN \('finished', 'deleted'\)/,
      },
      'packages/persistence/src/backup/backup.ts': { why: 'backup counts by status, each on its own line', lines: /discardedWorkouts:|deletedWorkouts:/ },
      'packages/persistence/src/data-domains.ts': { why: 'check-ins hidden with a deleted workout in exports and counts (review r2 S1)', lines: /FROM sessions d WHERE d\.check_in_id = c\.id AND d\.status = 'deleted'/ },
      'apps/mobile/src/import/import-service.ts': { why: 'import-job status (`reverted` = undone), not a session', lines: /\b(?:job|j|current\?)\.status/ },
      'apps/mobile/src/import/layout-service.ts': { why: 'import-job status (`reverted` = undone): which saved layouts are still in use (AI12), not a session', lines: /\b(?:job|j)\.status/ },
      'apps/mobile/src/coach/sheet-view.ts': { why: 'the coach chip’s `Deleted workout` label (DW16; review r3 N5)', lines: /return session\.status === 'deleted' \? 'deleted' : 'unavailable';/ },
      'packages/domain/src/session/coach-draft.ts': { why: 'a coach draft’s own status (`discarded` = Discard draft, workout-builder §6.2), not a session', lines: /\b(?:current|d)\.status/ },
      'packages/persistence/src/workout-drafts.ts': { why: 'the coach-draft expiry (BD4): open and discarded drafts past 14 days', lines: /FROM workout_drafts WHERE owner_id = \? AND status IN \('open', 'discarded'\)/ },
      'apps/mobile/src/services/plan-services.ts': { why: 'a coach plan’s own status (`discarded`), not a session (19 Oct)', lines: /\bplan\.status/ },
    };
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'schema' && name !== 'generated') walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        const rel = relative(root, path);
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!patterns.some((p) => p.test(line)) || write.test(line)) return;
            if (allowed[rel]?.lines.test(line)) return;
            offenders.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
          });
      }
    };
    for (const d of dirs) walk(join(root, d));
    expect(offenders).toEqual([]);
  });

  it('every SQL read of `sessions` filters with `inHistorySql`, or is listed with a reason (DW19, review r2 S3)', () => {
    const root = join(__dirname, '..', '..', '..');
    const dirs = ['packages/domain/src', 'packages/persistence/src', 'packages/coach/src', 'packages/schemas/src', 'packages/providers/src', 'apps/mobile/src'];
    // Each listed reader, matched on the text of its query from `FROM`/`JOIN sessions` to the end of its string.
    const allowed: Record<string, { why: string; query: RegExp }[]> = {
      'packages/persistence/src/sessions.ts': [
        { why: 'one session by ID, whatever its status: `readAggregate`, the revision guards, the purge’s checks and tombstone', query: /FROM sessions WHERE id = \?['`]$/ },
        // Anchored to each query's whole text (review r3 N4): a broader reader that also says `status = 'deleted'` isn't allowed.
        { why: 'the purge’s check that the session is deleted', query: /^"SELECT check_in_id FROM sessions WHERE id = \? AND status = 'deleted'"$/ },
        { why: 'Recently deleted', query: /^`SELECT id FROM sessions WHERE owner_id = \? AND status = 'deleted' AND purge_after_utc > \? ORDER BY deleted_at_utc DESC, id DESC`$/ },
        { why: 'Recently deleted’s count', query: /^"SELECT count\(\*\) AS n FROM sessions WHERE owner_id = \? AND status = 'deleted' AND purge_after_utc > \?"$/ },
        { why: 'the purge: deleted workouts past their 30 days', query: /^"SELECT id FROM sessions WHERE owner_id = \? AND status = 'deleted' AND purge_after_utc <= \? ORDER BY id"$/ },
        { why: '`active`: the one unfinished workout', query: /^"SELECT id FROM sessions WHERE owner_id = \? AND status = 'active'"$/ },
        { why: '`byStartOp`: idempotent start by operation ID', query: /start_operation_id = \?'$/ },
        { why: '`listIds`: integrity checks over every stored session', query: /^'SELECT id FROM sessions ORDER BY id'$/ },
      ],
      'packages/persistence/src/integrity.ts': [{ why: 'integrity checks over every stored session', query: /^'SELECT id FROM sessions ORDER BY id'$/ }],
      'packages/persistence/src/coach.ts': [{ why: '`startedFrom`: was a workout started from this one (active included)', query: /status IN \('active', 'finished'\)/ }],
      // Fit to time (merge with the workout library): the start fence counts Starts, not history; purged starts are counted from their tombstones.
      'packages/persistence/src/drafts.ts': [{ why: '`startFenceIn`: how many workouts Ben has started (any status), never decreasing', query: /^`SELECT \(SELECT COUNT\(\*\) FROM sessions WHERE owner_id = \? AND source = 'manual'\) \+ \(SELECT COUNT\(\*\) FROM purged_sessions WHERE owner_id = \? AND import_job_id IS NULL\) AS n`$/ }],
      'packages/persistence/src/documents.ts': [{ why: 'a check-in still linked to any stored session (deleted ones can be restored)', query: /FROM sessions WHERE check_in_id IN/ }],
      'packages/persistence/src/store.ts': [{ why: 'the backup status’ unfinished-workout count', query: /^FROM sessions WHERE status = 'active'\) AS unfinishedWorkouts, \(SELECT count\(\*\) FROM session_sets s$/ }],
      'packages/persistence/src/data-domains.ts': [{ why: 'check-ins hidden with a deleted workout (export and counts)', query: /^`EXISTS \(SELECT 1 FROM sessions d WHERE d\.check_in_id = c\.id AND d\.status = 'deleted'\)`$/ }],
      'packages/persistence/src/imports.ts': [
        { why: '`appDates`: dates with a workout in the app (active included)', query: /status IN \('active', 'finished'\)/ },
        { why: 'an import’s dates in Recently deleted', query: /^"SELECT local_date AS d FROM sessions WHERE owner_id = \? AND import_job_id IS NOT NULL AND status = 'deleted' AND purge_after_utc > \?"$/ },
        { why: '`writtenDates`: an import’s rows already written, any status (resume)', query: /^'SELECT local_date AS d FROM sessions WHERE import_job_id = \?'$/ },
        { why: '`writtenSessions`: an import’s workouts already written, any status (resume; ADR 0026)', query: /^'SELECT id FROM sessions WHERE import_job_id = \?'$/ },
        { why: 'idempotent import write by start operation ID', query: /start_operation_id = \?'$/ },
      ],
    };
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'schema' && name !== 'generated') walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        const rel = relative(root, path);
        for (const query of sessionQueries(readFileSync(path, 'utf8'))) {
          scanned += 1;
          if (query.includes('inHistorySql(')) continue;
          if (allowed[rel]?.some((a) => a.query.test(query))) continue;
          offenders.push(`${rel}: ${query}`);
        }
      }
    };
    for (const d of dirs) walk(join(root, d));
    expect(offenders).toEqual([]);
    // The scan found the store's readers (it didn't silently match nothing).
    expect(scanned).toBeGreaterThan(30);
  });

  it('a reader that also takes deleted workouts isn’t covered by the lifecycle entries (review r3 N4)', () => {
    const lifecycle = /^"SELECT id FROM sessions WHERE owner_id = \? AND status = 'active'"$/;
    const [q] = sessionQueries(`const r = await q.getAll("SELECT id FROM sessions WHERE owner_id = ? AND status = 'active' OR status = 'deleted'", [o]);`);
    expect(q).toBeDefined();
    expect(lifecycle.test(q ?? '')).toBe(false);
    expect(lifecycle.test(sessionQueries(`q.getFirst("SELECT id FROM sessions WHERE owner_id = ? AND status = 'active'", [o])`)[0] ?? '')).toBe(true);
  });

  it('the reader scan catches a reader with no status filter at all (review r2 S3)', () => {
    const q = (src: string) => sessionQueries(src).filter((x) => !x.includes('inHistorySql('));
    expect(q("const r = await q.getFirst('SELECT id FROM sessions WHERE owner_id = ? ORDER BY started_at_utc DESC LIMIT 1', [o]);")).toEqual(["'SELECT id FROM sessions WHERE owner_id = ? ORDER BY started_at_utc DESC LIMIT 1'"]);
    expect(q('const r = `SELECT s.id FROM session_sets x JOIN sessions s ON s.id = x.session_id\n WHERE x.status = ?`;')).toHaveLength(1);
    expect(q('const r = `SELECT id FROM sessions WHERE owner_id = ? AND ${inHistorySql()} LIMIT 1`;')).toEqual([]);
    expect(q("// a comment: don't FROM sessions\nconst r = `SELECT sum(${inHistorySql()}) FROM sessions WHERE import_job_id = ?`;")).toEqual([]);
    // Two subqueries in one string are checked apart.
    expect(q('`(SELECT count(*) FROM sessions WHERE ${inHistorySql()}) AS a, (SELECT count(*) FROM sessions WHERE owner_id = ?) AS b`')).toEqual(['FROM sessions WHERE owner_id = ?) AS b`']);
  });

  it('the DW19 scan catches the readers the review found (S2)', () => {
    const patterns = [
      /status\s*(?:===|!==|=|<>|!=)\s*'(?:finished|discarded|reverted)'|status\s+(?:NOT\s+)?IN\s*\([^)]*'(?:finished|discarded|reverted)'/,
      /session\??\.status\s*(?:===|!==)\s*'deleted'|status\s*(?:=|<>|!=)\s*'deleted'|status\s+(?:NOT\s+)?IN\s*\([^)]*'deleted'/,
    ];
    const caught = (line: string) => patterns.some((p) => p.test(line));
    expect(caught("if (s.status === 'discarded' || s.status === 'reverted') continue;")).toBe(true);
    expect(caught("return a?.session.status === 'deleted' ? null : a;")).toBe(true);
    expect(caught("if (a.session.status !== 'deleted') return { kind: 'live' };")).toBe(true);
    expect(caught("SELECT id FROM sessions WHERE status <> 'deleted'")).toBe(true);
    // A set's own `deleted` status isn't a session reader.
    expect(caught("const live = state.sets.filter((s) => s.status !== 'deleted');")).toBe(false);
  });
});

/**
 * Every SQL query on `sessions` in a source file. String literals are found
 * with a small lexer (comments skipped, template `${…}` nested); each one is
 * cut at every `FROM sessions` / `JOIN sessions`, the first piece keeping the
 * literal's start, so two subqueries in one string are checked apart. Throws
 * if a clause is found outside any literal (the lexer lost its place).
 */
function sessionQueries(src: string): string[] {
  const clause = /\b(?:FROM|JOIN)\s+sessions\b/g;
  const literals: string[] = [];
  const skipString = (i: number): number => {
    const quote = src.charAt(i);
    let j = i + 1;
    while (j < src.length) {
      const c = src.charAt(j);
      if (c === '\\') j += 2;
      else if (c === quote) return j + 1;
      else if (quote === '`' && c === '$' && src.charAt(j + 1) === '{') j = skipExpr(j + 2);
      else if (quote !== '`' && c === '\n') return j;
      else j += 1;
    }
    return j;
  };
  const skipExpr = (j: number): number => {
    let depth = 1;
    while (j < src.length && depth > 0) {
      const c = src.charAt(j);
      if (c === "'" || c === '"' || c === '`') {
        j = skipString(j);
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      j += 1;
    }
    return j;
  };
  let code = '';
  for (let i = 0; i < src.length; ) {
    const c = src.charAt(i);
    if (c === '/' && src.charAt(i + 1) === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
    } else if (c === '/' && src.charAt(i + 1) === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? src.length : close + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const end = skipString(i);
      literals.push(src.slice(i, end));
      i = end;
    } else {
      code += c;
      i += 1;
    }
  }
  if (clause.test(code)) throw new Error('a sessions clause outside a string literal: the scan lost its place');
  const out: string[] = [];
  for (const lit of literals) {
    const at = [...lit.matchAll(clause)].map((m) => m.index);
    at.forEach((pos, i) => {
      out.push(lit.slice(i === 0 ? 0 : pos, at[i + 1] ?? lit.length).replace(/\s+/g, ' ').trim());
    });
  }
  return out;
}

describe('Recently deleted and the purge (§2.5, §6.4)', () => {
  it('lists deleted workouts newest deletion first until the end of their 30 days, then never (DW20, DW21)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a], 'del-a', NOW);
    await del([b], 'del-b', z('2026-10-10T09:00:00.000Z'));
    expect((await store.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc)).sessions.map((x) => x.session.id)).toEqual([b.session.id, a.session.id]);
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(2);
    // Day 31 for `a`: gone from the list even though the purge hasn't run.
    expect((await store.repos.sessions.listRecentlyDeleted(OWNER, DAY_31.utc)).sessions.map((x) => x.session.id)).toEqual([b.session.id]);
  });

  it('one deleted workout that can’t be read is counted, and the others stay listed (review r2 S2)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a, b]);
    await store.db.driver.run("UPDATE sessions SET gym_changes = '{\"not\":\"a list\"}' WHERE id = ?", [a.session.id]);
    const listed = await store.repos.sessions.listRecentlyDeleted(OWNER, NOW.utc);
    expect(listed.sessions.map((x) => x.session.id)).toEqual([b.session.id]);
    expect(listed.unreadable).toBe(1);
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(2);
  });

  it('the purge removes every row of a purge-due workout and leaves only a tombstone with no training values (DW21)', async () => {
    const a = latest();
    const keep = history[0] as SessionAggregate;
    await del([a], 'del-a', NOW);
    await del([keep], 'del-keep', z('2026-10-20T09:00:00.000Z'));
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-early', at: NOW })).toEqual({ ok: true, duplicate: false, purged: [] });
    const out = await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-1', at: DAY_31 });
    expect(out).toEqual({ ok: true, duplicate: false, purged: [a.session.id] });
    expect(await store.repos.sessions.get(a.session.id)).toBeNull();
    expect(await store.repos.sessions.isPurged(a.session.id)).toBe(true);
    expect((await store.repos.sessions.get(keep.session.id))?.session.status).toBe('deleted');
    const left = await store.db.read(async (q) => {
      const n: Record<string, unknown> = {};
      for (const t of ['session_sets', 'session_exercises', 'set_audit', 'timing_audit', 'processed_operations', 'session_pauses', 'rest_timers', 'work_intervals']) {
        n[t] = (await q.getFirst<{ n: number }>(`SELECT count(*) AS n FROM ${t} WHERE session_id = ?`, [a.session.id]))?.n;
      }
      n.tombstone = await q.getFirst('SELECT * FROM purged_sessions WHERE session_id = ?', [a.session.id]);
      return n;
    });
    expect(left).toEqual({
      session_sets: 0,
      session_exercises: 0,
      set_audit: 0,
      timing_audit: 0,
      processed_operations: 0,
      session_pauses: 0,
      rest_timers: 0,
      work_intervals: 0,
      tombstone: { session_id: a.session.id, owner_id: OWNER, deleted_at_utc: NOW.utc, purged_at_utc: DAY_31.utc, purge_op_id: 'purge-1', import_job_id: null, local_date: null },
    });
    // The same operation again changes nothing.
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-1', at: DAY_31 })).toEqual({ ok: true, duplicate: true, purged: [a.session.id] });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('Delete now purges named workouts at once; a workout that isn’t deleted is refused and nothing is purged (DW23)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a]);
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'now-x', at: NOW, sessionIds: [a.session.id, b.session.id] })).toEqual({
      ok: false,
      error: { code: 'stale', sessionIds: [b.session.id] },
    });
    expect((await store.repos.sessions.get(a.session.id))?.session.status).toBe('deleted');
    expect(await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'now-1', at: NOW, sessionIds: [a.session.id] })).toMatchObject({ ok: true, purged: [a.session.id] });
    expect(await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version + 1 }], opId: 'r', at: NOW })).toMatchObject({
      ok: false,
      error: { code: 'stale' },
    });
  });

  it('the database still refuses every other delete: finished workouts, their rows, tombstones, and a purged ID written again', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    const tryRun = (sql: string, params: string[]) => store.db.write((tx) => tx.run(sql, params));
    await expect(tryRun('DELETE FROM session_sets WHERE session_id = ?', [b.session.id])).rejects.toThrow(/tombstoned/);
    await expect(tryRun('DELETE FROM sessions WHERE id = ?', [b.session.id])).rejects.toThrow(/never deleted/);
    // A tombstone can't be written for a workout that isn't deleted.
    await expect(tryRun("INSERT INTO purged_sessions VALUES (?, ?, 'x', 'x', 'op', NULL, NULL)", [b.session.id, OWNER])).rejects.toThrow(/only a deleted workout/);
    // A deleted workout without a tombstone still can't lose rows.
    await del([a]);
    await expect(tryRun('DELETE FROM set_audit WHERE session_id = ?', [a.session.id])).rejects.toThrow(/append-only/);
    await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [a.session.id] });
    await expect(tryRun('DELETE FROM purged_sessions WHERE session_id = ?', [a.session.id])).rejects.toThrow(/append-only/);
    // A purged workout can't come back by being saved again.
    await expect(store.repos.sessions.save(a, null)).rejects.toThrow(/purged/);
  });
});

describe('imports (§6.2)', () => {
  const AT: ZonedTimestamp = { utc: '2026-10-09T10:00:00.000Z', tz: TZ };
  const CSV = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', '2026-10-01,Lat pulldown,Back,40,10,,,', '2026-10-03,Lat pulldown,Back,47.5,8,,,'].join('\n');

  async function importTwo(): Promise<{ job: ImportJob; sessions: SessionAggregate[] }> {
    for (const e of starterExercises(AT.utc)) await store.repos.exercises.save(e, null).catch(() => undefined);
    const candidates: MatchCandidate[] = starterExercises(AT.utc).map((e) => ({
      exerciseId: e.id,
      name: e.name,
      aliases: [],
      catalogueKey: e.catalogueKey ?? null,
      laterality: e.laterality,
      defaultLoadConvention: e.defaultLoadConvention,
      compatibleEquipment: e.compatibleEquipment,
      implements: null,
    }));
    const p = parseFitNotesCsv(CSV, '2026-10-09');
    if (!p.ok) throw new Error('not parsed');
    const a = analyseImport(p, { ownerId: OWNER, candidates, aliases: new Map(), appDates: new Set(), importedDates: new Map(), defaultUnit: 'kg' }, DEFAULT_ANSWERS);
    const jobId = id(9001);
    const rows = planImportRows(p, a, { jobId, defaultUnit: 'kg' });
    const job: ImportJob = {
      id: jobId,
      ownerId: OWNER,
      version: 1,
      createdAtUtc: AT.utc,
      updatedAtUtc: AT.utc,
      source: 'fitnotes',
      fileName: 'FitNotes_Export_synthetic.csv',
      checksum: 'a'.repeat(64),
      variant: 'A1-kg',
      header: p.firstLine,
      timezone: TZ,
      startedAt: AT,
      operationId: 'commit-1',
      mappingVersion: 1,
      answers: DEFAULT_ANSWERS,
      counts: { rows: a.rowCount, workouts: a.counts.workouts, sets: a.counts.sets, exercises: a.counts.exercises, byResult: { imported: 2, skipped_cardio: 0, skipped_unsupported: 0, skipped_duplicate: 0, skipped_date_exists: 0, skipped_exercise: 0, unreadable: 0 } },
      dateRange: a.dateRange,
      status: 'committing',
      finishedAt: null,
      revert: null,
    };
    expect(await store.repos.imports.createJob(job, rows, { exercises: [], aliases: [], at: AT, newId: idGen(50_000) })).toMatchObject({ ok: true });
    const sessions: SessionAggregate[] = [];
    for (const date of ['2026-10-01', '2026-10-03']) {
      const s = buildImportedSession({ ownerId: OWNER, jobId, operationId: job.operationId, tz: TZ, gymId: null, importedAtUtc: AT.utc, date, rows });
      expect(await store.repos.imports.commitWorkout(jobId, s)).toBe('written');
      sessions.push(s);
    }
    const fin = await store.repos.imports.finishJob(jobId, 1, AT);
    if (!fin.ok) throw new Error('not finished');
    return { job: fin.job, sessions };
  }

  it('one imported workout deletes and restores with its import rows intact (DW24); counts read `· 1 deleted`', async () => {
    const { job, sessions } = await importTwo();
    const [first] = sessions;
    if (!first) throw new Error('fixture');
    const rowsBefore = await store.repos.imports.rows(job.id);
    /** Finished imported workouts: every finished workout less the app's own. */
    const importedRefs = async () => (await store.repos.sessions.listFinishedRefs(OWNER, 100, { includeImported: true })).length - (await store.repos.sessions.listFinishedRefs(OWNER, 100)).length;
    expect(await importedRefs()).toBe(2);
    const out = await del([first]);
    expect(await importedRefs()).toBe(1);
    expect(await store.repos.imports.jobWorkoutCounts(job.id, NOW.utc)).toEqual({ finished: 1, deleted: 1 });
    expect(await store.repos.imports.rows(job.id)).toEqual(rowsBefore);
    const ref = out.refs[0];
    if (!ref) throw new Error('no ref');
    expect((await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: ref.sessionId, expectedVersion: ref.version }], opId: 'r', at: NOW })).ok).toBe(true);
    expect(await store.repos.imports.jobWorkoutCounts(job.id, NOW.utc)).toEqual({ finished: 2, deleted: 0 });
    expect(await store.repos.imports.rows(job.id)).toEqual(rowsBefore);
  });

  it('Undo this import reverts deleted workouts too, and they leave Recently deleted (DW25)', async () => {
    const { job, sessions } = await importTwo();
    const [first] = sessions;
    if (!first) throw new Error('fixture');
    await del([first]);
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(1);
    const undone = await store.repos.imports.revertJob(job.id, job.version, 'undo-import', NOW);
    expect(undone).toMatchObject({ ok: true, workouts: 2 });
    expect((await store.repos.sessions.get(first.session.id))?.session).toMatchObject({ status: 'reverted' });
    expect((await store.repos.sessions.get(first.session.id))?.session.deletion).toBeUndefined();
    expect(await store.repos.sessions.countRecentlyDeleted(OWNER, NOW.utc)).toBe(0);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });

  it('a deleted imported date still counts as imported; after the purge a re-import offers it as new (DW26)', async () => {
    const { sessions } = await importTwo();
    const [first] = sessions;
    if (!first) throw new Error('fixture');
    await del([first]);
    expect([...(await store.repos.imports.importedDates(OWNER)).keys()].sort()).toEqual(['2026-10-01', '2026-10-03']);
    expect([...(await store.repos.imports.deletedImportDates(OWNER, NOW.utc))]).toEqual(['2026-10-01']);
    // Past its 30 days but not yet purged: no longer counted as in Recently deleted (review r2 N1).
    expect([...(await store.repos.imports.deletedImportDates(OWNER, DAY_31.utc))]).toEqual([]);
    await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: DAY_31 });
    expect([...(await store.repos.imports.importedDates(OWNER)).keys()]).toEqual(['2026-10-03']);
    expect([...(await store.repos.imports.deletedImportDates(OWNER, NOW.utc))]).toEqual([]);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
  });
});

describe('exports and backups (§6.3, §6.5)', () => {
  it('My data leaves out deleted workouts, their rows and tombstones (DW18)', async () => {
    const [a, b] = history;
    if (!a || !b) throw new Error('fixture');
    await del([a, b]);
    await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [b.session.id] });
    const mine = await exportDomain(store.db, 'your_data');
    const text = JSON.stringify(mine);
    expect(text).not.toContain(a.session.id);
    expect(text).not.toContain(b.session.id);
    expect(mine.tables.purged_sessions).toBeUndefined();
    expect(mine.tables.sessions).toHaveLength(history.length - 2);
  });

  it('My data leaves out a deleted workout’s check-in, its next-session targets and the coach’s actions on it; a live workout’s check-in stays (DW18, §5; review r2 S1)', async () => {
    const [a, b, c] = history;
    const CI_A = '00000000-0000-4000-8000-00000000c1a0';
    const CI_C = '00000000-0000-4000-8000-00000000c5a0';
    if (!a || !b || !c) throw new Error('fixture');
    await store.db.write(async (tx) => {
      for (const ci of [CI_A, CI_C])
        await tx.run('INSERT INTO check_ins (id, owner_id, recorded_at_utc, version, updated_at_utc, data) VALUES (?, ?, ?, 1, ?, ?)', [ci, OWNER, NOW.utc, NOW.utc, JSON.stringify({ note: ci === CI_A ? 'sore after test session' : 'fine' })]);
      await tx.run("INSERT INTO next_session_targets (id, owner_id, source_session_id, exercise_id, action_id, status, version, updated_at_utc, data) VALUES ('nst-a', ?, ?, ?, 'act-a', 'saved', 1, ?, '{}')", [OWNER, a.session.id, BENCH, NOW.utc]);
      await tx.run("INSERT INTO next_session_targets (id, owner_id, source_session_id, exercise_id, action_id, status, version, updated_at_utc, data) VALUES ('nst-c', ?, ?, ?, 'act-c', 'saved', 1, ?, '{}')", [OWNER, c.session.id, BENCH, NOW.utc]);
      await tx.run("INSERT INTO next_target_uses (owner_id, start_op_id, source_session_id, created_at_utc) VALUES (?, 'use-a', ?, ?)", [OWNER, a.session.id, NOW.utc]);
      await tx.run(
        "INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('act-a', ?, 'op-act-a', NULL, ?, 'set_next_session_targets', 'committed', 1, ?, ?, '{}')",
        [OWNER, a.session.id, NOW.utc, NOW.utc],
      );
      // An Undo of act-a (no session of its own) goes with it (review r3 N1); an unrelated memory action stays.
      await tx.run(
        "INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('undo-a', ?, 'op-undo-a', NULL, NULL, 'undo', 'committed', 1, ?, ?, ?)",
        [OWNER, NOW.utc, NOW.utc, JSON.stringify({ detail: { kind: 'undo', undoneActionId: 'act-a' } })],
      );
      await tx.run(
        "INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('mem-x', ?, 'op-mem-x', NULL, NULL, 'save_memory', 'committed', 1, ?, ?, '{}')",
        [OWNER, NOW.utc, NOW.utc],
      );
    });
    const answered = async (x: SessionAggregate, checkInId: string): Promise<SessionAggregate> => {
      const next = { ...x, session: { ...x.session, checkIn: { kind: 'answered' as const, checkInId }, version: x.session.version + 1 }, revision: x.revision + 1 };
      expect(await store.repos.sessions.save(next, x.revision)).toMatchObject({ ok: true });
      return next;
    };
    const a2 = await answered(a, CI_A);
    await answered(c, CI_C);
    const before = await countDomainsIn(store.db.driver);
    await del([a2, b]);
    const mine = await exportDomain(store.db, 'your_data');
    const text = JSON.stringify(mine);
    for (const gone of [CI_A, 'nst-a', 'act-a', 'use-a', 'undo-a', 'sore after test session']) expect(text).not.toContain(gone);
    expect(mine.tables.coach_actions?.map((r) => r.id)).toEqual(['mem-x']);
    expect(mine.tables.check_ins?.map((r) => r.id)).toEqual([CI_C]);
    expect(mine.tables.next_session_targets?.map((r) => r.id)).toEqual(['nst-c']);
    // The counts agree with the export, in SQL and in JS.
    const after = await countDomainsIn(store.db.driver);
    expect(after.yourData.checkIns).toBe(before.yourData.checkIns - 1);
    expect(after).toEqual(countDomains(await store.db.read((q) => exportTables(q))));
    // Restore brings the check-in back into the count.
    expect((await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a2.session.version + 1 }], opId: 'res-a', at: NOW })).ok).toBe(true);
    expect((await countDomainsIn(store.db.driver)).yourData.checkIns).toBe(before.yourData.checkIns);
  });

  it('a backup carries the deleted state and its dates; the restored workout is in Recently deleted, not history (DW27)', async () => {
    const { dir, cleanup } = tempDir();
    try {
      let n = 0;
      const manager = await DatabaseManager.open({ host: nodeDatabaseHost(dir), newName: () => `t-${String(++n)}.db` });
      const s = manager.store;
      await s.repos.profiles.save(profile(), null);
      for (const x of history) await s.repos.sessions.save(x, null);
      const [a, b] = history;
      if (!a || !b) throw new Error('fixture');
      expect((await s.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(a)], opId: 'del-a', at: NOW })).ok).toBe(true);
      expect((await s.repos.sessions.deleteWorkouts({ ownerId: OWNER, items: [item(b)], opId: 'del-b', at: NOW })).ok).toBe(true);
      await s.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'p', at: NOW, sessionIds: [b.session.id] });
      const made = await createBackup(s, { at: NOW, app: { name: 'GymSmarter', version: '0.1.0', build: null } });
      expect(made.counts).toMatchObject({ finishedWorkouts: history.length - 2, deletedWorkouts: 1 });

      // Restored into a fresh phone: the deleted workout is deleted, with its original clock; the purged one stays purged.
      const { dir: dir2, cleanup: cleanup2 } = tempDir();
      try {
        const phone = await DatabaseManager.open({ host: nodeDatabaseHost(dir2), newName: () => `p-${String(++n)}.db` });
        const restored = await phone.restore(made.text, z('2026-10-12T08:00:00.000Z'));
        expect(restored).toMatchObject({ ok: true, status: 'restored' });
        const r = phone.store.repos.sessions;
        expect((await r.get(a.session.id))?.session).toMatchObject({ status: 'deleted', deletion: { at: NOW, opId: 'del-a', purgeAfterUtc: purgeAfterUtc(NOW) } });
        expect((await r.listRecentlyDeleted(OWNER, '2026-10-12T08:00:00.000Z')).sessions.map((x) => x.session.id)).toEqual([a.session.id]);
        expect(await r.listRepeatableIds(OWNER, 100)).not.toContain(a.session.id);
        expect(await r.get(b.session.id)).toBeNull();
        expect(await r.isPurged(b.session.id)).toBe(true);
        // Past its 30 days at restore time: never shown, and the next purge removes it.
        expect((await r.listRecentlyDeleted(OWNER, DAY_31.utc)).sessions).toEqual([]);
        expect(await r.purgeDeleted({ ownerId: OWNER, opId: 'after-restore', at: DAY_31 })).toMatchObject({ purged: [a.session.id] });
        expect((await checkIntegrity(phone.store.db)).ok).toBe(true);
        await phone.close();
      } finally {
        cleanup2();
      }
      await manager.close();
    } finally {
      cleanup();
    }
  });
});

describe('time', () => {
  it('fixture sanity: the history ends before NOW', () => {
    expect(toMs(latest().session.startedAt.utc)).toBeLessThan(toMs(NOW.utc));
  });
});
