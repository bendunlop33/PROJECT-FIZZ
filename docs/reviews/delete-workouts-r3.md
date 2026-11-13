VERDICT: PASS

# Review r3: Delete workouts (claude/delete-workouts)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/delete-workouts` (74 files), focused on the five fix commits after
round 2 (`2eefda3`, `5229b77`, `91612b7`, `97005f8`, `429bd32`). Checked against `docs/design/delete-workouts.md`
(DW-D1 to DW-D6, §2 to §8, DW1 to DW33), CLAUDE.md rules 2, 5, 6 and 10, the minimal-copy convention, and ADR 0024.

Merge is still gated on Ben approving ADR 0024 (S2). That is a process gate, not a code defect.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: 197 files, 3865 tests passed, 1 todo, 0 failed.
  - My first full run reported 203 files with 2 timing failures (`progress-perf.test.ts`, `equipment.test.ts`
    "stepper taps … stay cheap").
  - `progress-perf.test.ts` doesn't exist in this worktree; it's in `/home/user/wt-progress`. It was picked up while
    another job was running on the machine, so the timings were also under load.
  - `equipment.test.ts` passed when re-run alone, and a clean full re-run passed. Neither failure is related to this
    branch.
- Base check: `claude/gracious-knuth-joxqpw` is an ancestor of HEAD. The base has migrations 1 to 7 only, so
  migration 8 has no number clash on this base. The `claude/progress` clash is handled by the column guard and the
  ADR's merge-order note.
- Read-path hunt:
  - I grepped every `FROM`/`JOIN` on `sessions`, `session_sets`, `session_exercises`, `check_ins`,
    `next_session_targets`, `coach_actions` and `coach_offers` in `packages/*/src` and `apps/mobile/src`.
  - I also grepped every TS comparison of a status literal.
  - Every history reader of sessions goes through `inHistorySql` / `isInHistory`, or is on the new scan's reasoned
    allow-list.
  - The one reader that still exposes a deleted workout is not on `sessions`: `coach_actions` via
    `get_recent_actions` (S1).
- Migration 8 (re-read): frozen-column guard, the rebuild under `defer_foreign_keys`, indexes and triggers
  re-created, and the narrowed DELETE triggers. Unchanged since r2. The populated schema-7 test still passes.

## Round-2 findings: status

| R2 | Status |
|---|---|
| B1 empty workouts unreachable | **Fixed.** `listPastWorkoutIds` lists every manual workout in history, with or without sets. An empty one shows as `Empty workout · 0 sets`, and a tap opens its Summary (with `⋯`). Tested: listed, selected, deleted, and Undo. |
| B2 only 30 rows | **Fixed.** `pastWorkouts({limit, offset})` with `more`, and a `Show more` row that widens `limit`. `useScreenData` reloads with the new limit (`loadRef` is updated each render). Tested with 35 workouts. |
| S1 export leaks check-in and coach records | **Fixed.** Check-in, `next_session_targets`, `next_target_uses` and `coach_actions` are dropped for deleted sources. The SQL and JS counts agree. Tested. |
| S2 Recently deleted false empty | **Fixed.** Rows are caught one at a time and `unreadable` is surfaced. A whole-read failure now reaches the screen's error state. Tested at the store level. |
| S3 DW19 scan | **Fixed.** A lexer-based scan of every `FROM/JOIN sessions` literal, with an allow-list and reasons, and a self-test that it catches an unfiltered reader. |
| S4 audit events | **Resolved as a divergence** in ADR 0024 (`processed_operations` is the audit record). Spec issue SP4 is still open. |
| S5 ADR approval | **Open** (S2 below). |
| N1 | Fixed for the re-import line. The restore preview count is a documented divergence with a sound reason (no clock in the manager, and filtering would cause a false `preview_stale`). |
| N2 to N7 | Fixed: the Summary `⋯` shows only when the workout is `live`; the chip says `Workout unavailable` / `Deleted workout`; Repeat shows `This workout was deleted.`; a late retry is `stale` (tested); the import view's restore has a toast with Undo; the ADR swipe note is updated. |

---

## Blocking

None.

---

## Should fix

### S1. `get_recent_actions` still gives the coach a deleted workout's targets and adjustments

- `packages/persistence/src/coach.ts:338-346` (`listRecentActions`) has no filter on the action's session status.
- `apps/mobile/src/coach/coach-service.ts:160` returns `null` for a deleted workout.
- `:208` then passes `sessionId: null` to `createStoreExecutors`.
- The result is that the tool reads **owner-wide** actions.

**Scenario.**
1. Ben deletes a bad test session whose summary review saved `Next Push A: Bench 100 kg × 8`.
2. Later he asks the Today coach "what did you change recently?", or reopens that workout's thread, where the chip
   says `Deleted workout`.
3. The model calls `get_recent_actions` and gets the `set_next_session_targets` and `adjust_pending_sets` records of
   the deleted workout, rendered with their loads and reps (`turn.ts:320`, `render.ts:313`).
4. It can cite them as current.

This contradicts §5 / DW16 ("Coach context … Excluded"). It is also inconsistent with the r2 S1 fix, which already
treats these same `coach_actions` rows as derived from the deleted workout and drops them from `My data`. Opening a
deleted workout's thread makes it worse: it widens the tool from that session's actions to every action.

**Fix.**
- In `listRecentActions`, exclude actions whose `session_id` is a session that isn't in history:
  `AND (session_id IS NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_id AND (s.status = 'active' OR ${inHistorySql('s')})))`.
  A purged session has no row, so decide whether its actions also go. Recommended: yes, same as the export.
- In `coach-service.ts`, when the thread's workout is out of context, don't fall back to owner-wide reads. Either
  withhold `get_recent_actions` for that thread, or pass the thread's own session ID so the filter returns nothing.
- Test: delete a workout with a saved next-session target, then call `get_recent_actions` from the Today thread and
  from the deleted workout's thread. Neither may return the action. After Restore it's returned again.

### S2. Merge is gated on Ben: ADR 0024 is still Proposed

`docs/decisions/0024-deleted-workouts-and-purge.md:3`. Carried over from r2 S5. The ADR amends ADR 0005 (a narrow
DELETE-trigger exception for the purge). It also leaves these open:
- DW-Q4 (`Keep deleted` on restoring a pre-delete backup);
- whether purged workouts' `next_session_targets` (loads and reps) and summary note are kept.

CLAUDE.md requires Ben's approval for architecture changes. The code is fine to merge once he signs off.

**Fix.** Get Ben's decisions, then mark the ADR Accepted. Have the designer amend §6.1, §6.4 and §6.5 to match.

---

## Nits

- **N1.** `withoutDeletedWorkouts` (`data-domains.ts:286`) drops a deleted workout's `coach_actions`. It keeps `undo`
  actions (`session_id` NULL) that point at them, so the `My data` file can hold an Undo whose target action isn't in
  the file. It's harmless for a data dump, but either drop `undo` rows whose target was dropped, or note it in ADR
  0023/0024.
- **N2.** Past workouts' `Show more` raises `limit` and reloads every loaded row
  (`history-services.ts:158`, one full aggregate decode per row, one after another).
  - Every delete, Undo and refocus repeats that full read.
  - After a few years of logging and several `Show more` taps, that's hundreds of aggregate reads per reload.
  - Consider appending pages by `offset` and reloading only the changed rows, or a light row query like
    `listFinishedRefs`.
- **N3.** On Recently deleted, when every row is unreadable (`RecentlyDeletedScreen.tsx:160`), the nav-bar `Select`
  is still offered over an empty list. Hide it when `rows.length === 0`.
- **N4.** The DW19 allow-list matches per file on broad patterns (`deleted-workouts.test.ts:281-282`): any
  `sessions.ts` query containing `status = 'deleted'` or `status = 'active'` passes. For example, a future
  `WHERE status = 'active' OR status = 'deleted'` reader would slip through. Anchor these patterns to the specific
  queries, as the `listIds` and `byStartOp` entries already are.
- **N5.** Several fixes live only in screen code, with no test:
  - the Summary `canDelete` gate when presence isn't `live`;
  - the coach chip's purged → `Deleted workout` / unreadable → `Workout unavailable` mapping;
  - Past workouts' 0-set row opening the Summary;
  - the Recently deleted screen not showing the empty line when `unreadable > 0`.

  Move the small decisions into view helpers (`delete-view.ts` / `sheet-view.ts`) and unit-test them.
- **N6.** `recentlyDeletedCount` swallows read errors as `0` (`history-services.ts:180`). The footer and the Data &
  backup row then read `None` / hidden, even when deleted workouts exist. Prefer hiding the row only on a real `0`,
  and show the row without a count on error.

---

## Spec issues

- **SP1** (carried over). The import counts disagree: §5 has `412 workouts · 3 deleted` and §6.2 has
  `0 workouts · 412 deleted`. The code follows §5. The designer should pick one.
- **SP2** (carried over). `Gone 30 days after deleting.` explains a rule in the main UI, against minimal copy and DW32.
  Drop it and keep the `ⓘ`.
- **SP3** (carried over, now built per ADR). §2.3 should say that Past workouts lists workouts with 0 sets, and that
  tapping one opens its Summary, not Repeat.
- **SP4** (carried over). §6.1's `session_deleted` / `session_restored` audit events have no store. Amend §6.1 to name
  `processed_operations` plus the session's deletion record, as ADR 0024 does.
- **SP5.** §5 says the coach context excludes a deleted workout, and DW-D6 says its conversations are kept. Neither
  says whether coach **action records** (the cards in that conversation) count as conversation, which is kept, or as
  derived data, which is hidden. The export already treats them as derived data (r2 S1). The spec should say so for
  the coach's `get_recent_actions` too (S1).
