# Review: active set follow-ups (Why?, exclusions, pain flags without the coach, time left)

**Verdict: CHANGES NEEDED**

Reviewed: `claude/gracious-knuth-joxqpw..claude/active-set` (22 commits, `d7eee68..087d907`, 62 files, +6460/−169). The commits cover competitor follow-ups 3 (`Why?` on targets), 9 (exclusion flags), 8 (pain flags without the coach) and 10 (time left / `Finish by`).

Specs read: CLAUDE.md (worktree copy, plus the base branch's newer copy with the 10 Oct minimal-copy convention), `docs/design/active-workout.md` §2.12–2.15, §4.10, §7 checks 36–62, §8 (AW1–AW13) and §9 (taken from `claude/gracious-knuth-joxqpw`, because this branch was cut before `3d9649a` added those sections), the competitor landscape follow-ups 3/8/9/10, and CHANGELOG 2026-10-09 (D21).

## What I ran

| Check | Result |
|---|---|
| `npm run check` in `/home/user/wt-active-set` | Exit 0. Typecheck and lint are clean, 101 test files and 1401 tests pass, the catalogue validates and 10/10 guides pass |
| `git merge-tree --write-tree HEAD claude/gracious-knuth-joxqpw` | **9 conflicting files**: `navigation/types.ts`, `TodayScreen.tsx`, `ExercisePickerScreen.tsx`, `WorkoutScreen.tsx`, `workout-services.ts`, `domain/src/index.ts`, `session/active-view.ts`, `session/repeat.ts`, `session/today.ts` |
| Grep of the diff for `console.*`, logging and secrets | None |

## What is solid

- **Exclusions are applied in one place.** `isSetCountable` (`packages/domain/src/exclusions.ts:61`) drives progression (`progression.ts:279`, with the `No counted sets … (all left out); holding.` fact), the summary comparison (`summary.ts:209–223`), the records highlight (`touches.ts:108,115`) and the `Why?` basis. Volume and working-set counts still include flagged sets (AW8). Flags are a versioned `correct_set` and never delete anything (AW6). Marking a set alone doesn't add `Edited`. Undoing a log drops its flags. Schema 4 stores NULL for "counts", so nothing is backfilled.
- **`Why?` reads stored data and never recomputes (AW3).** `explainTarget` (`session/target-why.ts`) is a pure read of `planned.provenance`. It runs no rule and makes no network call. A target with no provenance reads `Not recorded (set before this app version)`. The "edited since" note compares the basis set IDs and versions. `fitProvenance` keeps the text inside schema bounds, so explaining a target can't make the write that sets it fail. The panel is inline and closes on Log, on a new active set and when the keypad opens (`whyPanelReducer`, tested). Log stays usable while it's open.
- **Pain flags never clear without Ben.** `recordPainFlagReview` never clears a flag. It is idempotent by opId, a stale version is refused, and not-due answers are refused. Undo marks the review undone and keeps it in the audit. `clearConfirmed` is versioned and goes through the AW10 confirmation. The `May hurt` tag goes only on the flagged exercise (CM5), the row is never hidden, and `Choose another` adds nothing. The Today row is hidden while a workout is in progress. No copy diagnoses.
- **Time left is deterministic and labelled as an estimate.** `estimateRemainingDuration` is pure. Pace samples skip paused time and gaps over 15 min, and the pace source falls back from this workout to recent workouts to `Default`. Rounding follows §2.15.1, check 57 is exactly the specified case, and check-ins are never read. `set_finish_by` is versioned and idempotent, refuses past times and times more than 3 h ahead, is refused on a finished workout, and is stored in schema 5 so it survives a force-close. The line's clock moves only on data changes and once a minute (`WorkoutScreen.tsx`, `TIME_LEFT.refreshMs`).
- **Tests cover more than the happy path.** They cover stale sheets (no pain flag written), retry idempotency, force-close and relaunch on SQLite for `Why?`, `Still hurts` and `Finish by`, superseded `Finish by`, and the control case (the same workout without a mark adds load).

## Blocking

### B1. The branch is 92 commits behind its base, and the merge changes the meaning of this code (rules 6 and 10, CLAUDE.md conventions)
`claude/active-set` was cut at `4761119`. Since then, `claude/gracious-knuth-joxqpw` has gained 92 commits, and a merge conflicts in 9 files (table above). Several of those base commits interact with this feature in ways the conflict markers won't show:

1. **Next-session targets now go through Repeat.** `7357bb8` and `1e2ed61` make `startWorkoutFromSession` take the built-in rule's next targets and mark those sets `built_in_rule`. This branch stamps every Repeat-built set with `source: 'repeat'` provenance (`packages/domain/src/session/repeat.ts:224,244`). `Why?` then says `What you did last time is today's target. No progression is applied.` (`target-why.ts:218`). **Failure path:** after the merge, Ben taps `Start next session`. Bench press is planned at 102.5 kg by the built-in rule. `Why?` says `Repeat of Push A, 1 Oct · No progression is applied.`, which is a false explanation of a progressed target (rule 6) and the opposite of check 39. **Fix:** when resolving `repeat.ts`, write `ruleTargetProvenance` (source `rule`, basis, step) for sets that came from `nextTargets`, and keep `repeat` only for copied sets. Add a test.
2. **New consumers of top sets and trends don't check exclusions.** `aae38be` adds `session/lift-highlight.ts` (last top set, change and trend on Today), and `99766bf` adds the Progress list. After the merge, `HistorySet.exclusions` reaches them, but they don't call `isSetCountable`. **Failure path:** Ben marks a spotted 110 kg × 8 top set. Today's lift highlight then shows it as his latest top set and trend point, which breaks check 45 ("left out of records … the summary comparison"). **Fix:** filter with `isSetCountable(s, 'record' | 'comparison')` in `buildLiftHighlight` and its sparkline, and show the exclusion words wherever Progress lists sets (check 49). Add tests.
3. **Copy now breaks a CLAUDE.md convention.** Ben approved the "UI copy is minimal" convention on 10 Oct (`5e42865`, on the base branch). It forbids reassurance and explanation lines in the main UI. These strings break it:
   - `time-left.ts:403` (`This is an estimate … It doesn't change your sets.`)
   - `exclusions.ts:39` (`Still counts in your log and volume.`)
   - `exclusions.ts:141` (`This also puts a pain flag on …: no increases until you clear it.`)
   - the Profile › Pain flags lead text

   **Fix:** shorten these or move them behind an info tap after rebasing. See also Spec issue S1.
4. **Migration numbers will collide.** Migrations 4 and 5 (`0004-set-exclusions.ts`, `0005-session-finish-by.ts`) collide with `claude/gym-switch`'s migration 4, which the commit messages note, and possibly with the FitNotes import worktree. Renumber these before any build that could reach Ben's phone, because migrations are "frozen once released". Then run a backup made at the merged schema through restore.

**Fix overall:** rebase onto the current `claude/gracious-knuth-joxqpw`, resolve items 1–4, re-run `npm run check`, and re-request review of the rebased diff.

### B2. Undoing an exclusion mark turns its pain flag into a real "cleared" flag
`apps/mobile/src/services/workout-services.ts:680` calls `pain.clear(req.painFlagIds)`, and `pain.clear` (`:296–305`) applies `clearPainFlag`, which sets status `cleared` with a `clearedAtUtc`. `Why?` (`target-why.ts:229` `referenceFlag`) and the pain flag sheet treat any flag cleared within 8 weeks as real. The spec's return-to-load guard (§2.14.3, check 55) will do the same.

**Failure path:** Ben ticks `Pain` by mistake in the correction sheet, which sets a flag (AW7), then taps Undo on the toast 2 s later. For the next 8 weeks, `Why?` on that exercise shows `Before flag  100 kg × 8, 8, 8 · 1 Oct`, the flag appears in cleared-flag history, and (from step 4) coach increases are capped at one step. All of this rests on a flag Ben withdrew (rule 6). It also bypasses check 53 ("no path clears a flag without `Clear flag` in the confirmation"), because the flag goes through the normal clear path with no confirmation. The existing `kind: 'pain'` toast Undo (`WorkoutScreen.tsx:228`) has the same pattern, and this branch's new 8-week consumers now make it visible.

**Fix:** treat an Undo of a flag that was just created as a retraction, not a clear. For example, add `status: 'retracted'` (or delete the document and record an audit entry), keep it out of `referenceFlag`, `painReference`, the lists and the return-to-load guard, and test it. Also version the Undo against the flag version the mark produced. Today it clears whatever it reads.

## Should fix (non-blocking)

- **N1. The `Not used` set number doesn't match the card's number.** `target-why.ts:85` numbers basis sets among non-warm-up sets only, and in completion order without the side regrouping. The card, toast and correction sheet number sets among all live sets, warm-ups included (`active-view.ts:379,503,640`). **Failure path:** with 2 warm-ups, Ben marks "Set 4: spotted". Next time, `Why?` says `Set 2 on 1 Oct: spotted.` **Fix:** store the set's display number in `TargetBasisSet` when the provenance is written, or number the sets the same way everywhere.
- **N2. AW7 is two writes, not one commit.** `correctSet` saves the pain flag (`workout-services.ts:648`) and then dispatches `correct_set`. The spec says "in the same commit". This is the documented safe direction. However, if `correct_set` then fails for a non-stale reason, the sheet says "The change wasn't saved" while the movement flag stays on and nothing tells Ben. Either write both in one SQLite transaction, or say in the failure message that the pain flag was still set.
- **N3. The `log_set` exclusions path has no AW7 handling.** `log_set` accepts `exclusions: ['pain']` (`commands.ts`), but nothing sets the movement flag on that path. The schema comment says "the service does that", yet no service calls it, and voice ("100 for 8, spotted") isn't built. Add a service wrapper now, or reject `pain` in `log_set` until there is one, so that the future voice wiring can't skip rule 9.
- **N4. The time-left estimate is computed twice a second, and the result is thrown away.** `buildActiveSetView` computes `timeLeft` (`active-view.ts:596`) on the screen's 1 s tick, but `WorkoutScreen` renders `services.workout.timeLeft` instead. Use one source. Today can keep the view field.
- **N5. Every planned set stores its own copy of the basis.** Each planned set copies the whole basis (up to 60 sets) into its provenance, so a 4-set exercise stores it 4 times. That bloats `session_sets.planned` and backups. Consider storing the basis once per session exercise and referencing it from each set.
- **N6. Some spec parts are not built yet and should be tracked.** Not built: the Overview `Why?` and the time-left line at the end of Overview (no Overview exists yet); an `Edit history` UI that uses `exclusionAuditLines` (check 49 is partial); the `trigger` and `e1rm` purposes (coach offers and e1RM don't exist yet); the `History ›` footer in the panel; and `Use built-in rule` / `Undo this change` (coach, step 4). Record these in the spec's follow-ups so they aren't lost.

## Nits

- `Finish by` uses a ±5 min stepper, not the wheel described in §2.15.3. It works, so confirm with the designer.
- `TimeLeftEstimate.overByMinutes` is calculated against the paused-at time while paused. It isn't shown in the paused wording, but it's wrong if a future caller reads it.
- `undoMark` and the `Still hurts` undo use derived opIds (`undo:<key>`). That's fine, but they rely on `key` staying short (128-char limit).

## Spec issues

- **S1. The active-workout copy predates the minimal-copy convention.** §2.13, §2.14.4 and §2.15.3 specify explanation and reassurance lines, such as the sheet footnote, `Still counts in your log and volume.` and the Profile lead text. Ben's 10 Oct CLAUDE.md convention now forbids these in the main UI. The designer should revise §5 so the developer isn't left choosing between them.
- **S2. Retracting a pain flag is undefined.** AW7, coach-memory §2.5 and the toasts all offer Undo on a newly set flag, but neither spec says whether that is a clear (which starts the 8-week reference and guard) or a retraction (as if it never existed). B2 depends on this decision. I recommend a retraction.
- **S3. A flag set mid-workout leaves today's increased targets in place.** The §2.13 effects table says "a flag never changes targets by itself", and `Why?` says `Flagged after this target was set, so the target wasn't changed.` CLAUDE.md rule 9 says a pain mention "stops progression for that movement". If today's remaining sets were already an increase (+2.5 kg), they stay an increase after Ben ticks `Pain`. Ben should decide whether a newly set flag offers, or applies, "hold today's remaining sets at the last done load" as a one-tap visible change with Undo.
- **S4. The spec isn't on the branch it describes.** §2.12–2.16 exist only on the base branch (`3d9649a`). This branch was cut before them, so its copy of `active-workout.md` doesn't describe the code it contains. The rebase in B1 fixes this.
