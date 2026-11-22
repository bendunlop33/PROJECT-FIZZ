VERDICT: CHANGES NEEDED

# Review r2: Delete workouts (claude/delete-workouts)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/delete-workouts` (9 commits, 72 files), focused on the four fix commits
after round 1 (`25b6ed7`, `1ae5773`, `3d0df23`, `803417e`). Checked against `docs/design/delete-workouts.md`
(DW-D1 to DW-D6, §2 to §8, DW1 to DW33), CLAUDE.md rules 2, 5, 6 and 10, the minimal-copy convention, and ADR 0024.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: 196 branch test files, 3857 tests passed, 1 todo, 0 failed. The round-1 load flake
  (`app-services.test.ts`, "catches up a backup at launch…") passed in the full run.
- Ad hoc scratch test, run and then removed so nothing was committed: an empty finished workout (`Finish anyway` with
  nothing logged) next to a normal one. Result: `status finished`, `counts.finishedWorkouts = 2`, and
  `repeat.candidates()` lists only the normal workout (see B1).
- I grepped every `FROM`/`JOIN` on `sessions`, `session_sets` and `session_exercises` in `packages/*/src` and
  `apps/mobile/src`, and every status literal comparison. Every history reader goes through `inHistorySql` /
  `isInHistory`. The remaining readers deliberately count more, and each one is safe:
  - `appDates` and `startedFrom` (active included);
  - the exercise-in-use checks (`documents.ts:198`, `app-services.ts:173`), which must keep counting deleted workouts
    because those can still be restored;
  - integrity, `listIds`, and the deletion lifecycle itself.

  I found no read path that counts a deleted workout as history.

## Round-1 findings: status

| R1 | Status |
|---|---|
| B1 migration column hazard | **Fixed.** `upMigration0008` checks `PRAGMA table_info(sessions)` against the frozen 26 columns and throws inside the migration transaction. Tested for an unknown column and a missing one, and on a populated schema-7 DB with every status: schema equals a fresh DB, foreign keys and integrity are clean. The ADR records the merge order. |
| B2 unbuilt acceptance checks | **Resolved.** DW24, DW26, the §6.5 lines and the DW16 chip are built and tested. Swipe, DW30, the memory source line, voice, DW28 and structural proposals are listed in ADR 0024 as divergences, with reasons. |
| S1 restore preview | **Fixed.** Deleted workouts are skipped as workouts. `deletedSinceBackup` and a `Recently deleted` row are added, plus an honest "come back" line while DW-Q4 is open. |
| S2 DW19 scan | **Widened**, but it still isn't an enumeration of readers (see S3). |
| S3 VoiceOver toast | **Fixed.** `onDismiss`, the escape gesture, and a close button while VoiceOver is on. Every delete toast goes through `DeleteToastView`. |
| S4 / N2 op IDs | **Fixed** with `IntentOps` (keyed on action + items + versions), and tested. |
| S5 hidden workouts | **Fixed** in `presence()` and the imported view. The Summary still isn't gated (N2). |
| S6 tests | **Fixed.** Covers DW13, DW14, DW16 (stale coach write), DW17, DW29, a rich purge and the populated migration. |
| S7 ADR approval / kept targets | **Open.** This is still for Ben (S5 below). |
| N1, N4, N5, N6, N7 | Fixed. |

---

## Blocking

### B1. Empty finished workouts are counted but can never be selected or deleted

`packages/persistence/src/sessions.ts:731` (`listRepeatableIds` requires `EXISTS … status = 'completed'`) and
`apps/mobile/src/services/workout-services.ts:1973` (`if (row.sets === 0) continue;`). Past workouts and its Select mode
are built on `repeat.candidates()`.

**Scenario.**
1. Ben tests the app: he starts a session, logs nothing, and taps `Finish anyway` (`FinishSheet.tsx:146`). The result
   is a `finished` workout with 0 sets.
2. It counts in Data & backup (`2 workouts`), in the week count, and in `latestFinished` (so Up next and the rotation
   use it), and it is in every export and backup.
3. From the next day on, it's on no list. Past workouts leaves it out, and Recently deleted, the import list and Today
   can't reach it. Its Summary is reachable only from Today's `Done today` on the same day.
4. So it can never be deleted.

These test sessions are exactly what this feature exists for ("delete old records"). The spec's Select mock-up
(§2.3, l. 115 and 124) shows `Mon 5 Oct · Empty workout` with `0 sets` as a row that can be deleted.

**Fix.**
- Give Past workouts its own list query: every manual workout in history, with or without completed sets.
- Rows with 0 sets can be ticked and deleted. Tapping one opens its Summary (with `⋯`) instead of Repeat, or Repeat
  shows its existing "nothing to repeat" state.
- Test: an empty finished workout is listed, can be selected, deletes, and its Undo works.

### B2. Past workouts loads only the 30 newest workouts, so older records can't be deleted

`apps/mobile/src/screens/repeat/PastWorkoutsScreen.tsx:23` calls `s.repeat.candidates()`, whose default `limit = 30`
(`workout-services.ts:1953`). There is no paging or "load more".

**Scenario.** Ben has 45 workouts logged in the app and wants to remove the 6 test sessions from his first week, which
was the request ("delete old records"). They are the 40th to 45th rows and never appear, so neither `Select` nor
`Select all` can reach them. The spec assumes the list pages (§2.3: "`Select all` selects only what's loaded (the list
pages)").

**Fix.**
- Page the Past workouts list: `listRepeatableIds` already takes `offset`. Load the next page on scroll, or add a
  `Show more` row.
- Keep `Select all` scoped to the loaded rows, as the spec says.
- Test: with 35 workouts, the 35th can be reached and deleted.

---

## Should fix

### S1. `My data` export still contains a deleted workout's check-in and the coach records with its numbers

`packages/persistence/src/data-domains.ts:261-269`. `withoutDeletedWorkouts` filters `sessions` and the tables keyed by
`session_id`, but not:
- `check_ins`, which is linked by `sessions.check_in_id`;
- `next_session_targets` (`source_session_id`);
- `coach_actions` (`session_id`).

**Scenario.** Ben deletes a bad test session, then exports `My data` to share with a coach. The file still holds that
session's check-in (score, reasons and his free-text note) and the coach's targets derived from its sets.
- DW18 says the export "leaves out deleted workouts".
- §5 says "the check-in linked to it is hidden with it".
- `countDomainsIn` (`What the coach can see` and the Your-data counts) also still counts the check-in.

**Fix.**
- In `withoutDeletedWorkouts`, also drop `check_ins` rows whose ID is the `check_in_id` of a deleted session, and drop
  `next_session_targets` / `coach_actions` rows whose source or session is deleted. Leave conversations in, as DW-D6
  says.
- Mirror this in `countDomainsIn`.
- Add to the DW18 test: a deleted workout with an answered check-in and a saved coach target, and assert neither ID is
  in the export.

### S2. A failed read of Recently deleted says "Nothing deleted in the last 30 days."

- `apps/mobile/src/services/history-services.ts:110-127`: on an exception it returns `{ rows: [], unreadable: 1 }`.
- `listRecentlyDeleted` (`sessions.ts`) has no per-row catch, so one unreadable deleted workout throws for the whole
  list.
- `RecentlyDeletedScreen.tsx` ignores `unreadable` and renders `DELETE_COPY.empty`.

**Scenario.** One deleted workout's row fails `checkRead`, for example after a restore from an older backup. Past
workouts' footer still reads `Recently deleted (3)`, because `countRecentlyDeleted` is a plain count. But Recently
deleted says `Nothing deleted in the last 30 days.` That is false (rules 1 and 6), and Ben can't restore the other two
before their clock runs out.

**Fix.**
- Catch per row in `listRecentlyDeleted`, as `listImportJobInHistory` already does, and return `unreadable`.
- In the screen, show the same `n workouts couldn't be read` + `Check data ›` line that Past workouts uses.
- When the whole read fails, show the existing error state instead of the empty state.

### S3. DW19 is still a scan for status literals, not a list of readers

`packages/persistence/test/deleted-workouts.test.ts:219-270`.

**Scenario.** A new reader such as `SELECT id FROM sessions WHERE owner_id = ? ORDER BY started_at_utc DESC LIMIT 1`
(a future calendar, a week review, or the session picker on another branch) has no status literal at all. The scan
passes and the reader shows deleted, discarded and reverted workouts. DW19 asks for "a test [that] lists every reader
of sessions and fails if one doesn't go through `isInHistory`". The status-literal scan only catches readers that
filter by status wrongly, not readers that don't filter at all.

**Fix.** Add a second pattern over `packages/*/src` and `apps/mobile/src`: any SQL string containing
`FROM sessions` / `JOIN sessions` must also contain `inHistorySql(` or appear in an allow-list with a reason. Today the
allow-list would be `readAggregate`, `active`, `byStartOp`, the deletion lifecycle, integrity, `listIds`,
`startedFrom`, `appDates`, `documents.ts:242` and the import job queries.

### S4. The `session_deleted` / `session_restored` audit events (§6.1, DW6) aren't recorded, and the gap isn't listed

`packages/domain/src/session/deletion.ts:139-143`. The operation is recorded only in `processed_operations`
(`delete_workout` / `restore_workout`).

**Scenario.** DW6 says "The audit has `session_deleted` with the op ID". A PM checking DW6 against Edit history or
`timing_audit` finds nothing. The processed-operations row is an adequate record, but it isn't what the spec says, and
ADR 0024's divergence list doesn't mention it.

**Fix.** Either add the two events to the session's audit, or add a line to ADR 0024's divergences saying
`processed_operations` is the audit record, and amend §6.1.

### S5. Merge is gated on Ben: ADR 0024 is still Proposed, along with DW-Q4 and kept training values after purge

`docs/decisions/0024-deleted-workouts-and-purge.md:3`. The ADR amends ADR 0005 (a trigger exception for row deletes).
It also leaves these with Ben:
- DW28 / DW-Q4: a restore from a pre-delete backup brings workouts back;
- the purge keeps `next_session_targets` loads and reps derived from a purged workout, against §6.4's "no training
  values".

None of this is a code defect. CLAUDE.md requires Ben's approval for architecture changes, so this can't merge to main
until he signs off.

**Fix.** Get Ben's decisions, then flip the ADR to Accepted and update §6.4 / §6.5 to match.

---

## Nits

- **N1.** Deleted workouts past their 30 days but not yet purged are counted as "in Recently deleted" in some places:
  - `imports.ts:208` (`deletedImportDates`) has no `purge_after_utc` filter, so the re-import line can say
    `3 are in Recently deleted.` when Recently deleted lists fewer;
  - the restore preview's `Recently deleted` phone count (`countBackup`) does the same.

  Filter on `purge_after_utc > now` for anything labelled "Recently deleted".
- **N2.** The Summary's `⋯ → Delete workout` (`SummaryScreen.tsx:292-299`) isn't gated on `presence.kind === 'live'`.
  - If `presence()` fails, the loader falls back to `live` (`:68`).
  - A reverted or discarded workout opened by ID also shows the menu.

  Either way the delete is refused as stale, which is a dead end. Show `⋯` only when the presence is `live`.
- **N3.** The coach chip only says `Deleted workout` when the aggregate still loads. After a purge, or for a
  reverted/discarded workout, `seesLabel` falls back to `Sees: this workout`, but `coach-service.ts:160` gives the coach
  nothing. That isn't an honest status (rule 1). Pass `deleted`/`unavailable` when the load returns null or a non-history
  status.
- **N4.** The Repeat screen on a deleted source shows `That workout has nothing to repeat.` (`RepeatScreen.tsx:63`). §5
  specifies `This workout was deleted.` with Start disabled. Use `history.presence` in its loader.
- **N5.** `plan()` treats a retry as a duplicate whenever every item already has that op ID in `processedOps`
  (`deletion.ts:115-126`), even if a later operation has changed the state since. For example, delete X, then
  Restore Y, then a late retry of X returns `ok, duplicate` with the restored version. The toast then says "deleted"
  for a workout that is live. This is unlikely, because retries are immediate. Returning `stale` when the current status
  doesn't match the op's outcome would close it.
- **N6.** After `Restore` in the imported workout view (`ImportedWorkoutScreen.tsx:88-97`), the restored line has no
  `Undo`, unlike the other restore toasts (§7). It is also a persistent `StatusLine`, not a toast.
- **N7.** Past workouts rows open Repeat, not a history-mode Past workout with `⋯` (§2.1 row 2). On iPhone, the only
  single-row delete for a sighted user is `Select` → tick → `Delete (1)` → sheet. That is fine until swipe lands, but
  the ADR's swipe divergence should mention it.

---

## Spec issues

- **SP1** (carried over). The import counts disagree: §5 has `412 workouts · 3 deleted` and §6.2 has
  `0 workouts · 412 deleted`. The code follows §5, and ADR 0024 flags it. The designer should pick one.
- **SP2** (carried over). `Gone 30 days after deleting.` explains a rule in the main UI, against the minimal-copy
  convention and DW32. The designer should drop it and keep the `ⓘ`.
- **SP3.** §2.3's "Rows show … `0 sets`, `Empty workout`" conflicts with the Past workouts definition ("pick one to
  repeat"), which has always excluded workouts with nothing to repeat. The spec should say plainly that the delete list
  includes workouts with 0 sets, and what tapping one opens (B1).
- **SP4.** §6.1 ("Audit events `session_deleted` / `session_restored`") names an audit mechanism that doesn't exist for
  session-level changes. Say which store is meant (S4).
