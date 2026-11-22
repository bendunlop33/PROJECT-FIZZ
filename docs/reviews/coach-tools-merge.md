# Review: merge of main into coach tools (fd5994c)

**Verdict: PASS**

Scope: merge commit `fd5994c` on `claude/coach-tools` (parents `0ed3fc3` coach tools r3, `9f03a8d` = `claude/gracious-knuth-joxqpw`). I checked it against both parents with `git show --remerge-diff` and read every hunk where a conflict was resolved. Focus areas: renumbering migration 11 and whether it is safe to run in place, whether either side lost a feature, whether deleted workouts stay out of the coach's reads, and whether target RPE is applied the same way everywhere.

## Checks run (in this worktree)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=180000` | 4536 passed, 1 todo, 1 failed: `apps/mobile/test/progress-perf.test.ts` (timing budget, 193 ms against 103 ms under full-suite load). Re-run alone: pass. |
| `npm run check:migrations` | pass (no reserved or empty migrations) |
| `FIZZ_RELEASE_CHECK=1 npx vitest run packages/persistence/test/release-migrations.test.ts` | pass |

## Migration 11: numbering and in-place safety

- `packages/persistence/src/migration-list.ts:39-49`: the list is 1–7, then main's real migrations 8 `deleted-workouts`, 9 `progress` and 10 `workout-gaps`, then `11 coach-set-actions`. The `reserved-` placeholders are gone. `git diff 9f03a8d fd5994c -- packages/persistence/src/schema/` shows that only `0011-coach-set-actions.ts` was added, so main's 8–10 are byte-for-byte unchanged.
- `0011-coach-set-actions.ts` is the old branch-local `0010` with only the version and table-name suffixes changed. None of 8–10 touch `coach_actions`, `memories` or `playbook_candidates` (I grepped the schema files), so the rebuilt CHECK lists are complete. Migration 7's `update_routine` kind is kept. No table has a foreign key to these three tables, and no view refers to them, so the drop-and-rename rebuild doesn't break any reference. Each rebuild recreates every index and every no-delete trigger.
- Upgrade path: the coach-tools branch could never produce a phone or backup at "coach-tools 10" (the `check:migrations` job blocked any `.ipa` with placeholders). Every real device is therefore on main's schema ≤ 10 and only runs 11. `deleted-workouts-edges.test.ts:242-328` covers this. It takes a populated schema-10 database (deleted and purged workouts, a workout-gaps note, active and forgotten memories, a playbook candidate, coach actions), applies only `[11]`, and checks that the result matches a fresh database's schema dump, that every table's rows are identical, that `foreign_key_check` and `integrity_check` are clean, and that the new kinds and statuses accept writes. `schema11.test.ts` starts from 10, and the 8→, 9→ and 6→ upgrade tests now expect `11` to be applied as well. A schema-10 backup restore goes through `migrate(driver, migrations, file.schemaVersion)` (`manager.ts:413`), so restores are covered too.
- CI (`.github/workflows/ios-ipa.yml:83-92`): both release checks are kept, main's `release-migrations.test.ts` (empty SQL) and the branch's `check:migrations` (`reserved-` name or empty SQL). `check:migrations` gained `--experimental-transform-types` because migration 8 uses class parameter properties. Without it the script would fail to load, not pass silently. The script test spawns with the same flag.

## No feature lost on either side

I classified each of the 12 conflicted files and the 5 auto-merged files that differ from both parents:

- `coach-service.ts`: kept main's `entry` parameter, `recentActionsScope(entry)` (review r3 S1), `ruleTargetRpe` on `adjust_pending_sets` and `openedFrom`. Kept the coach side's `createChatSetExecutors`, approved chat rules in context, `trainingHistoryAvailable`, the structural executors and the training reads. `status === 'finished'` became `isInHistory(...)` in the structural basis (`:423`, `:453`).
- `sheet-view.ts`: kept the coach side's memory/proposal card types and Today's `How am I doing?` chip, and main's `progress` / `progress_exercise` entries with no chip (see Spec issues).
- `context.ts`, `render.ts`, `domain/index.ts`, `persistence/coach.ts`, `migrations.ts`, `drafts.test.ts`, `context.test.ts`: union resolutions. Both `chatValues` (coach) and `rpePart` (main) are in `render.ts`. `targetPhrase` keeps main's RPE suffix. Both the `approved chat rules` and the `timed and distance sets` describe blocks are present in `context.test.ts`.
- I diffed every file changed on only one side against the merge result. The only differences are the intended migration renumbering, the doc wording "migration 11 (numbered 10 before the merge)", the `inHistorySql` edits and new tests.

## Deleted workouts excluded

The coach's reads all filter on history status: `listFinishedWithExercise`, `listFinishedBetween`, `latestFinished` (main, `inHistorySql`), `earliestFinishedStartUtc` (`sessions.ts:725`, changed in the merge), `basisStartedSince` (`coach.ts:224-231`, changed in the merge), `trainingOverviewView` (`training-view.ts:259`, `isInHistory`) and the structural `basisFor` (refuses a source that is neither in history nor active). `deleted-workouts.test.ts:169` adds `earliestFinishedStartUtc` to the "every derived reader" table, so a deleted workout is now pinned out of the coach's "first workout" date as well.

## Target RPE applied consistently

`get_progression_targets` (`builtInTargetsView`, `training-view.ts:424-441`) now uses `usualTargetRpeOf` with the rule's RPE from `ruleRpesOf(latest)`. That is the same function and the same priority (coach, then plan, then rule, never Ben's one-day override) that `nextSessionBases` uses for Summary targets (`next-session.ts:250`). Warm-up and drop sets get none, and an unknown rule value gives `null`, never an invented number. Tests: `coach-training-view.test.ts` (plan over rule, override not carried, warm-up/drop null, no rule means null) and `coach-reads.test.ts:97-105` (end to end, `@ RPE n` on each working target). `adjust_pending_sets`, `get_active_session` and `set_next_session_targets` all take `ruleRpesOf`.

## Findings

### Blocking

None.

### Should fix

**S1. A structural proposal made during an active workout plans from removed and swapped-out rows.** `apps/mobile/src/coach/coach-service.ts:425`
For an active source, the basis is every part-root row: `source.exercises ... .filter((e) => partRootOf(...) === e.id)`. Since this merge, main's workout gaps leave rows in `exercises` with `removed` set: `remove_exercise` (`reducer.ts:1651`) and a mid-workout swap's old row (`reducer.ts:1616`, `by: 'swap'`). The coach's own workout view drops them (`packages/coach/src/context.ts:192`), but this basis doesn't.
Scenario (from reading the code, not tested): mid-workout, Ben swaps Bench press for DB bench press, then asks "swap the cable fly next time". The card's Before/After shows both Bench press and DB bench press. If he asks to swap Bench press, `slotOf` matches the removed row and a proposal is saved. Once the workout finishes, `basisSlots`/`nextRoots` leaves that row out, so Apply ends up as "Couldn't apply here" for a change the card said would happen. The before/after is wrong (rule 2) and the outcome surprises Ben.
Fix: add `.filter((e) => e.removed === undefined)` to the active-source branch. Better still, make it match `nextRoots` for planning purposes. Add a coach-structural test that removes or swaps an exercise mid-workout and then asks for a structural change.

### Nits

- **N1.** `packages/persistence/src/coach.ts:210`: `startedFrom` still spells `s.status IN ('active', 'finished')`. It is equivalent to `status = 'active' OR inHistorySql('s')` today, but it is now the only coach query that doesn't use the helper (`basisStartedSince` next to it was converted). Convert it so a future history status can't diverge.
- **N2.** `packages/coach/src/chat-set.ts:45-48`: a set logged from chat ("log 100 for 8 at 10") never goes through `planOfferCheck`/`findOffer`, so main's deviation-based offer (target RPE versus logged RPE, the rule fallback) doesn't fire for it. The coach is in the turn, so that is arguably fine, but it is a gap against "offers follow the target RPE". Either run the offer check after `onSessionChanged` for a chat log, or record in coach-sheet §2.7 that chat logs don't raise offers.
- **N3.** `apps/mobile/src/coach/coach-service.ts:554-558`: `builtInTargets` takes the rule RPE of the *first* row with that exercise in the latest workout and uses that workout's equipment snapshot for the rule category. An exercise done twice in one workout, or a next workout at another gym, could show a different rule RPE than Start will plan. This is an edge case; consider looking it up by the row that `builtInNextTargets` used.
- **N4.** `.github/workflows/ios-ipa.yml:83-92`: the two release-migration steps overlap (`check:migrations` is a superset). That is harmless; fold them into one step when convenient.
- **N5.** `progress-perf.test.ts` failed its 100 ms budget under full-suite load (193 ms) and passed alone. This has been seen before and is not caused by the merge.

## Spec issues

- **SP1.** Progress entry chips (`sheet-view.ts:164-169`): main deliberately hid `How am I doing?` on Progress until the coach could read past workouts (review S4, rule 6). Coach tools now provides those reads (`get_training_overview`). The merge kept main's "no chip" and left a note. Whether Progress should now offer the chip is Ben's call. It should go into the backlog so the note doesn't become permanent by default.
