# Review: untick restores a finished rest as finished (rest-undo SP1), 21 Oct 2026

Branch `claude/rest-undo-20oct`, commits `7bb1fef`, `40b7b3e`, `b1b0e65` (diff `2d8e3cf..HEAD`).
Spec: `docs/design/workout-table-v3.md` §3, untick bullets.

## Verdict: CHANGES NEEDED

There is one blocking issue. The spoken-cue guard only works inside one JS run. After a relaunch, unticking a log a few seconds after the kept rest's deadline still says "Rest done" late. Everything else matches §3.

## Validation run by the reviewer

- `npm run typecheck`: clean
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean
- `npm run check:migrations`: OK (1 to 31)
- Targeted tests (`rest-undo`, `spoken-cues`, `rest-alerts`, `live-activity`, `rest-resume-migration`, `sqlite-repositories`): 123/123 passed
- Full suite `npx vitest run --maxWorkers=2`: 418 files, 7967 passed, 1 todo
- Reviewer probe (a temporary test, since deleted) reproduced B1. See below.

## Blocking

### B1. A relaunch between the accidental tick and the untick speaks a late "Rest done" for a rest that comes back finished

- `apps/mobile/src/voice/cue-controller.ts:124`, `:176`, `:182`, and `:59`
- **Why it fails:** the guard is the in-memory `dropped` set. A key only goes into it when this controller instance had a timer waiting for that key and then cancelled it. After a force-close, an iOS memory kill or a JS reload, the new controller starts with `dropped` and `played` empty. The kept rest is not the live timer at relaunch (the accidental rest is), so its key is never planned and never dropped. When the undo brings the rest back `expired`, `planCues` emits its end cue with `ended: true`. Because `dropped` does not have the key, the cue passes the line 182 check. The lateness is at most `TIMING.lateCueDrop` (5 s), so it is scheduled and spoken immediately.
- **Scenario (reproduced):** the warm-up rest is due at 1:05. B1 is ticked by accident at 0:58. The app is force-closed and relaunched at 1:04, then a fresh controller reconciles the ticked state. Ben unticks at 1:07. The controller says `"Rest done. Set 2, Bench press, 100 kilos for 8."` The commit's own requirement is that the spoken cue never plays a late end cue for a restored finished rest. The force-close lens covers exactly this path.
- **Fix:** make the "restored finished" fact part of the persisted state instead of controller memory. For example:
  - (a) When `restoreAfterUndo` brings back a finished rest, mark it (e.g. an optional `restoredFinishedAtUtc` or `quiet: true` on `RestTimerCoreSchema`, persisted in `rest_timers`). `planCues` then plans no end cue for a timer with that mark.
  - (b) Alternatively, have `planCues` skip the end cue of an `expired` rest whose `endedAtUtc` is earlier than the latest `undone` audit entry for the session.
  
  Either way, `dropped` can then be removed. Add a spoken-cues test with a fresh controller (relaunch) that reconciles the ticked state, unticks within 5 s after the kept deadline, and expects `said` to be `[]`.

## Should fix

### S1. The kept-rest stack now fills to the cap almost every workout, and it is rewritten on every command

- `packages/domain/src/rest.ts:171` (`pruneResumable` no longer drops anything), `:186`, `:157`, and `packages/persistence/src/sessions.ts:568-585`
- Before this branch, entries whose deadline had passed were dropped, so the stack usually held 0 to 2 entries. Now every log whose earlier rest was running, paused, expired or skipped adds an entry. Entries leave only through an undo pop, Start work, Finish, Discard, or the `slice(-20)` cap. After about 20 logs the stack sits at 20 full `RestTimer` snapshots, roughly 0.4 KB each and about 8 KB of JSON. `saveAggregate` deletes and reinserts the `rest_timers` row on every command, including debounced draft saves and ticks. Every load runs that JSON through `JSON.parse` and Zod validation. This is not a correctness bug and SQLite copes, but it is unbounded churn for entries that only matter if Ben unwinds 20 logs in a row.
- **Concrete case:** a 25-set workout. From about set 21 on, each 300 ms draft save writes about 8 KB of `resume_on_undo`, and each restore or backup round-trips 20 validated timers per session.
- **Fix:** keep the cap, and also bound finished entries. Options:
  - Store finished entries slimmed down: only `id`, `setId`, `kind`, `durationS`, `deadlineUtc`, `endedAtUtc`, `status` and `version` are needed to restore one.
  - Drop finished entries more than N deep, or ended more than, say, 30 minutes ago. Undoing a log that far back gets no rest, which is the same result as before this branch.
  
  Add a size assertion to the existing 22-ticks test, e.g. `JSON.stringify(resumeOnUndo).length` under a budget.

### S2. The guard can also suppress a legitimate in-run cue

- `apps/mobile/src/voice/cue-controller.ts:176-182`
- Any reconcile that briefly leaves a running rest out of the plan and then brings it back `expired` with the same deadline adds its key to `dropped`. That cue is then silenced even though the rest really just ended, and not through an undo. Examples are a coach re-read landing with a different shape, or `reconcile(null)` from a restore path.
- No such path exists today: the version guard in `rest-alerts.ts` and the same-key `timers.has` check cover the normal tick. However, the rule ("dropped earlier means a restored rest") is inferred rather than stated, and it fails open for B1 and closed here.
- **Fix:** the persisted mark from B1 removes this inference.

## Nits

- **N1.** `packages/schemas/src/session.ts:684`: a finished kept entry does not require `endedAtUtc !== null` and `remainingMsAtPause === null`. Add a `superRefine` so a corrupt row is caught on read and does not come back as "Ended –".
- **N2.** `apps/mobile/src/voice/cue-controller.ts:124`: `dropped` (like `played`) is never cleared, so it grows by about 2 keys per rest for the life of the JS run. Clear it on a session change. This becomes moot after B1.
- **N3.** `packages/persistence/src/schema/0031-rest-resume-on-undo.ts:4-11`: the header says "Frozen once released", but it was edited (comment only, SQL unchanged, `check:migrations` OK). Fine if 31 has not reached a device build yet. Otherwise put the clarification in `sessions.ts` instead.
- **N4.** Tests are thorough for the domain: run-out between tick and untick, exactly at the deadline, expired before the tick, skipped, pause and resume, Finish and Discard, chains, the 20 cap, and schema and SQLite round trips including a force-close. They are also thorough for alerts and Live Activity, including a fresh controller after relaunch. Only the spoken-cue path lacks a relaunch test (B1).

## Checked and OK

- No notification for a restored finished rest: `planRestAlert` returns only `running` rests (`rest-alerts.ts:72`). The log already replaced the old alert by identifier, and the tests cover a relaunched controller.
- No in-app haptic: the WorkoutScreen rest-end effect (`WorkoutScreen.tsx:556`) only fires for `running`. The reducer emits no `RestEnded`/`RestStarted` for a finished restore, so `restEndCueKey` stays null.
- Live Activity goes to Ready with no countdown and `staleAtMs` null (tested).
- The count-up continues from the original end. `settleResumable` sets `endedAtUtc` to the deadline, and `restOverrunMs` and `view.ts:49` count from the deadline, so "Rest over · rested X · Ended hh:mm" carries on.
- Pause and resume never revive a finished entry: `mapResumable` settles first and maps only running or paused entries.
- Skip, ±30 and a run-out of the accidental rest keep the stack, because `endRestTimer`/`adjustRestTimer` spread `resumeOnUndo`. Start work, Finish and Discard clear it.
- Versioning: a restored timer is `version + 2`, so alert keys change. Stale and duplicate undo are still refused or treated as no-ops (tested).
- Persistence: the widened enum is read back through `parseJson` and the aggregate schema, and the force-close round trip is tested on a database file.

## Spec issues

- **SP-a.** `workout-table-v3.md` §3 says a finished rest "comes back finished: the SET / Rested clock keeps counting from when it ended". For a rest that had been **skipped**, the restored state shows `Ready` with no count-up (`WorkoutScreen.tsx:1805`, `WorkoutTable.tsx:1360`, and `view.ts:53` gives `restedMs: 0`). That matches how a skipped rest looked before the tick, which is probably the intent, but the spec wording promises a count. Suggested wording: "...comes back as it was: an expired rest keeps its Rested count from when it ended; a skipped one shows Ready."
- **SP-b.** "SET / Rested clock" does not match any label in the UI. The surfaces are the rest bar (`Ready · rested 3:12`) and the `Rest over · rested …` notice. Name the actual element so reviewers can check it.
