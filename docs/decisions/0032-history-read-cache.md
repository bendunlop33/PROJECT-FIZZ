# 0032: Workout history is read once and cached in memory, keyed by stored version

**Status:** ACCEPTED by the developer on 23 Oct 2026 for the "so slow" fix (Ben, 23 Oct). For PM and reviewer
review. Renumber on merge if another branch took 0032.

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
