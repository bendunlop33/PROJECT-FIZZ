# 0032: Workout history is read once and cached in memory, keyed by stored version

**Status:** ACCEPTED by the developer on 23 Oct 2026 for the "so slow" fix (Ben, 23 Oct). The stored per-workout
history summary it proposed (below, "Amendment") is **Ben-approved, 24 Oct 2026**, and built.

## Context

On Ben's real-sized data (~800 imported workouts, ~20k sets, an applied 4-day plan) Today took 93–202 s in Node,
Your workout 223 s, an edit 218 s and Set up a plan 39 s (59 s without the JIT; ~20 s on his iPhone). Causes, from
profiles of `apps/mobile/test/app-paths.perf.test.ts`:

- `session_exercises` had no index on `session_id`, so every workout read scanned the whole table.
- Every history read decoded every workout of that exercise again (nine queries and a full schema check each),
  once per exercise, many times per screen (Today, its Edit and Your workout's Today options each re-ran Today).
- Validating a zoned timestamp built an `Intl.DateTimeFormat` each time (~18 s of one Today read).

## Decision

1. Migration 35 indexes `session_exercises (session_id, ordinal)`. Index only; backups are unchanged.
2. `SqliteSessions` keeps decoded workouts in history in memory, keyed by ID and `revision`, `version` and
   `last_activity_at_utc`; every save, delete, restore and purge through the repository drops them. Only the
   history reads use it (`listFinishedWithExercise(s)`, `listFinishedBetween*`, `latestFinished`, `getMany`); they
   return shared, read-only aggregates. `get()` still returns a fresh copy for callers that change it.
3. `Store.listExerciseHistories` reads many exercises in one call; per-exercise histories are kept while the
   owner's history stamp (count, revisions, versions, last activity, repository changes) holds.
4. `Database.writeCount` lets services cache what they derived (Today's data, `listFinishedRefs`) until any write.
5. Time zone validity and display formatters are cached for the run.

SQLite stays the authoritative record: nothing new is written or persisted, the caches are per store (a restore or
a reset opens a new store) and are only reused while the stored row says the workout is unchanged.

## Consequences

- After the first read of a run, every path is under a second (Node and `--jitless`; see the perf lane).
- The first history read after a launch still decodes every workout once (~3–4 s Node, ~6–7 s `--jitless` on 800
  workouts). Progress' prewarm starts it in the background at launch. Making the cold read fast too needs a stored
  per-workout history summary (a derived table written with each workout); that is a schema change for Ben to
  approve, not done here.
- Memory: the decoded workouts stay in memory (capped at 4,000).
- Writes that bypass the repositories (raw SQL in tests) aren't seen by the history cache; the app has none.

## Amendment (Ben-approved, 24 Oct 2026): a stored per-workout history summary

**Decision.**

1. **Migration 36** adds two derived Your-data tables: `history_summaries` (one row per workout in history, at the
   workout's storage `revision`, with the summary `format`; `data` = the workout as history reads it, `lifts` = each
   exercise's progression history, `toHistorySessions(…, { identity: true })`) and `history_summary_exercises` (which
   exercises each summary has, indexed by owner and exercise). Its backfill (every stored workout) runs in the
   migration's own transaction, passed in by `openStore` (`MIGRATION_BACKFILLS`), so the migration list stays free of
   domain code for the release check.
2. **Same transaction as every workout write.** `writeAggregate` (every save, edit, delete, restore and import commit,
   the coach's session writes included) stores the summary of a workout in history and removes it otherwise; an
   import's Undo removes its workouts' summaries in its transaction; a purge removes any left. Pure domain code makes
   the summary (`historySummaryOf`, `packages/domain/src/history-summary.ts`).
3. **History reads read summaries.** `listFinishedBetween*`, `listFinishedWithExercise(s)`, `latestFinished` and
   `getMany` return `HistoryWorkout` (the workout's session, rows, sets and revision, plus the rows added after it was
   planned; no audit trail, processed operations, rest timer or work interval, which no history reader used; domain
   readers take `HistoryLike`, which a full workout also satisfies). `Store.listExerciseHistories` reads the stored
   per-exercise histories (`listLiftHistories`). Today, Your workout, the plan builder, progression, Progress and the
   coach's context read them; nothing is decoded while they are current. `get()` and the active workout still decode,
   with the full-decode cache kept for them and for fallbacks.
4. **Never wrong data.** A summary is read only while its revision equals the workout's and its format is this
   build's; otherwise the workout is decoded (and a damaged one reported as before). Every open rebuilds any missing or
   stale summary (one query when there are none). The consistency check (`checkHistorySummaries`: every summary against
   the one recomputed from its workout, plus orphans) runs with `Check all data` and the launch's integrity check; any
   it finds is rebuilt from the workout (`repairHistorySummaries`). A workout whose rows went bad after its summary was
   written is served from that summary until the check drops it (then it reads as unreadable, as before).
5. **Backups never hold them.** They are derived and rebuildable: exports, backups, content hashes, restore previews
   and domain counts leave them out (`DERIVED_TABLES`); a restore, a reset, `Delete my data` or a rollback rebuilds
   them on open. The backup format is unchanged.
6. **Launch background work waits for the first screen.** With the decode gone, the cold reads were left waiting
   behind the launch's background work (the integrity check's engine pass ~0.3 s and a catch-up backup's export
   ~1–1.8 s, each one turn of the queue). `startApp` now starts that work (catch-up backup and purge, integrity check,
   weekly review, Progress prewarm) after `backgroundGate`: on the phone `afterLaunch` (3 s, then an idle moment).

**Consequences.**

- Cold reads on the 800-workout perf dataset (Node / `--jitless`): Set up a plan 4.0 s / 7.9 s → 0.10–0.24 s;
  Today 4.9 s / 8.1 s → 0.30–0.49 s / 0.75–0.89 s (perf lane `apps/mobile/test/app-paths.perf.test.ts`, budgets
  500 ms / 1.5 s; `packages/persistence/test/history-summaries.perf.test.ts`).
- Writes: a finished workout's save also writes its summary (~10 KB JSON; one row per workout and one per exercise).
  Logging a set writes nothing extra (an unfinished workout has no summary).
- A summary format change (`HISTORY_SUMMARY_FORMAT`) rebuilds every summary on the next open (~3–4 s on 800
  workouts, once).
- Still open: Today's cold path is now mostly its own rule work over each exercise's whole history (~0.3 s Node);
  the launch's background integrity check still decodes every workout (sliced, after the gate).
