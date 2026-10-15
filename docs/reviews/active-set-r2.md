# Review r2: active set follow-ups (Why?, exclusions, pain flags without the coach, time left)

**Verdict: CHANGES NEEDED**

Reviewed: `claude/gracious-knuth-joxqpw..claude/active-set` (36 commits, base `952f79b`, HEAD `098463e`). The focus is the 13 fix commits after the first review (`f693d71`, `docs/reviews/active-set.md`) and the rebase onto the current base.

Specs read: CLAUDE.md (rules 2–6, 9, 10, and the minimal-copy convention), `docs/design/active-workout.md` §2.12–2.15, §7 checks 36–62, §8 (AW1–AW13) and the new §8.3, the competitor landscape follow-ups 3/8/9/10, and CHANGELOG 2026-10-09.

## What I ran

| Check | Result |
|---|---|
| `npm run check` in `/home/user/wt-active-set` | Exit 0. Typecheck and lint are clean, 128 test files and 1749 tests pass, the catalogue validates, and 10/10 guides pass the motion thresholds |
| `git merge-base HEAD claude/gracious-knuth-joxqpw` | Equals the base tip `952f79b`. The branch is rebased, 0 commits behind, and `git merge-tree` reports no conflicts |
| A throwaway service test on real SQLite (deleted, not committed) | Reproduces B1 below |
| Grep of the diff for logging and secrets | None |

## First-review items: status

| Item | Status |
|---|---|
| B1.1: Repeat/next-session rule targets explained as "No progression" | **Fixed.** `repeat.ts:216–225` and `routines.ts` (`ruleProvenance`) keep the rule's own provenance and add the fit note against `Target`. A rule target stored without provenance reads `Not recorded` and is never presented as a repeat. The starting plan records the built-in rule (`first-run.ts`). Tested in the domain and through the services |
| B1.2: lift highlight and records ignore exclusions | **Fixed.** `lift-highlight.ts:38` filters on `record` and `comparison`. `records.ts:49,55,75,122,128` excludes a marked set as a record, as the bar and in the imported-heavier check. Tested |
| B1.3: copy breaks the minimal-copy convention | **Fixed** (`f425a15`). The deviation is recorded in §8.3 |
| B1.4: migration numbering | **Folded** into one schema 4 (`0004-active-set.ts`). It still collides with `claude/gym-switch`'s `0004-gym-switch.ts`. §8.3 records this; see N3 |
| B2: Undo of a mark turns its pain flag into a real clear | **Fixed in the main path.** The new `retracted` status is versioned, kept out of `listActive`, `referenceFlag`, `painReference` and the sheet, and can't be cleared or restored. The table rebuild is tested from schema 3. **But the N2 rollback added with it opens a new rule 9 hole: see B1** |
| N1: `Not used` numbering | **Fixed.** `setDisplayNumbers` (`order.ts:76`) uses the same order and liveness as `exerciseSets` in `active-view.ts:282` |
| N2: AW7 as two writes | **Partly fixed.** It now has a rollback, but that rollback causes B1, and the thrown-error path isn't covered (N1 below) |
| N3: `log_set` with `pain` | **Fixed.** The schema refuses it (`commands.ts:40`) |
| N4: time left computed twice | **Fixed** (`withTimeLeft: false` on the workout screen) |
| N5: basis copied onto every planned set | Not addressed. Still non-blocking |
| N6: unbuilt parts | Tracked in §8.3 |

## Blocking

### B1. After a failed Pain mark, retrying in the same sheet marks the set `Pain` with no pain flag, and the toast says the flag is on (rules 9 and 6, AW7)

`apps/mobile/src/services/workout-services.ts:979–1002`, together with `apps/mobile/src/screens/workout/EditSetScreen.tsx:35,70–76`.

The sheet keeps one `saveOp` for its whole life (`useState(newUuid)`). The service derives the movement's flag ID from that opId (`deriveId(\`pain:${req.opId}:${exerciseId}\`)`).

1. On the first save, the service creates the flag (`created`). `correct_set` then fails for a non-stale reason, such as `Command failed validation.`, or a version race. The new rollback at `:1001` **retracts** that flag.
2. The sheet shows the error and resets its edits (`setExclusions(null)`). Ben ticks `Pain` again and taps Save, still with the same `saveOp`.
3. `ours` (`:980`) is now the *retracted* flag, so `!ours` is false and no new flag is written (`:988`). `painFlags` carries the retracted ref. `correct_set` succeeds.

**Result, reproduced on SQLite:** the retry returns `ok: true` with toast `Set 1: pain · not counted for records · pain flag on Bench press`, and the set's exclusions are `["pain"]`, but `pain.active()` is `[]`. Ben is told the movement is flagged, but nothing holds its progression. The next session's built-in rule adds load to a movement he just reported pain on, which breaks rule 9 and AW7, and the toast states something false (rule 6). The returned `undo.painFlags` points at a retracted flag, so Undo is also a no-op for the flag.

**Fix:** if `ours?.status === 'retracted'`, treat it as absent and create a fresh flag under a new derived ID (for example `pain:${opId}:${exerciseId}:${ours.version}`), or reactivate it as a new version. Better, write the flag and the `correct_set` in one SQLite transaction so no rollback is needed. Only count a flag as "ours" when it is `active`. Add service tests for (a) a failed mark then a retry in the same sheet: one active flag, and the toast matches, and (b) the rollback itself: a failed mark leaves no active flag and no `Before flag` reference.

## Should fix (non-blocking)

- **N1. When an exception is thrown, the flag stays on while the sheet says nothing was saved.** In `workout-services.ts:1012–1014`, the `catch` returns `failed` without the rollback that `:1001` does. If `dispatch` throws after the flag was saved (a SQLite I/O error), the sheet says `The change wasn't saved. Try again.`, but the movement stays flagged. The safe direction holds, but the message is untrue. Rolling back in the `catch` too only becomes safe after B1's fix, otherwise it widens B1. A single transaction fixes both. No test covers either failure path.
- **N2. `flagFromCheckIn` reports a retracted flag as set.** In `workout-services.ts:405–408`, a retry with an opId whose flag was already retracted pushes the retracted ref, and the check-in links it, so the `Pain noted for …` toast appears with no active flag. This is unlikely today, because Undo happens on the workout screen after the check-in has closed. It is the same pattern as B1, so apply the same "only an active flag is ours" rule.
- **N3. Migration 4 still collides with `claude/gym-switch`.** That branch has `0004-gym-switch.ts`. §8.3 says "whichever merges second renumbers". Make that a gate: no `.ipa` from either branch until one is renumbered and a backup made at the merged schema restores. It is also worth noting that this migration rebuilds `pain_flags` (DROP and RENAME). That is safe today because nothing references the table or has a trigger on it, but a later migration that adds one must come after this one.
- **N4. Merge risk with `claude/coach`.** `PainFlag.status` gains `retracted`. `claude/coach`'s `workout-services.ts:342,359` still use `status === 'cleared'` as "not active", and its old `pain.clear` would clear a retracted flag. When merging, carry over `status !== 'active'` and the retraction-aware `clearPainFlag` and `restorePainFlag`.
- **N5 (carried over).** Every planned set still copies the whole basis (first review N5).

## Nits

- Rebase leftovers, where two statements share a line: `packages/domain/src/session/reducer.ts:1243` (`return handleRenameSession(...);    case 'set_finish_by':`) and `packages/domain/src/session/repeat.ts:91` (a trailing comment that starts the next block's two-line comment). Both lint clean but read as mistakes.
- `duration.ts` and `time-left.ts` are two estimators of §2.15.2. §8.3 records the follow-up to fold them into one.
- `undo:${key}:pain` and `${opId}:rollback` are derived opIds. They are well within the 128-char limit while keys stay UUIDs.

## What is solid

- Retraction is modelled properly. It is a new status with an audit record (`retracted: {atUtc, opId}`), it is never a delete, and it is excluded at every consumer I found (`listActive`, `target-why.ts:236–240`, `pain-sheet.ts:91–103`, `clearPainFlag`/`restorePainFlag`, `clearConfirmed`). It is versioned against the version the action left, and a flag that changed since is kept and Ben is told (`Set undone. Pain flag kept: it changed since.`).
- Rule provenance survives every start path (Start next session, Repeat, routine with next targets, first exercise). A missing provenance reads `Not recorded`, never an invented reason.
- Exclusions now reach every consumer of tops, records and trends on the base branch, and volume still counts flagged sets (AW8).

## Spec issues

- **S1 (open, carried over as first-review S3).** A pain flag set mid-workout leaves today's already-increased remaining targets in place. Rule 9 says pain "stops progression for that movement". §8.3 asks Ben. Until he decides, the spec and rule 9 disagree.
- **S2.** §5's copy table still lists the pre-minimal-copy strings (§8.3 says so). The designer should revise it so the spec and the code agree.
- **S3.** AW7 says the flag and the mark are written "in the same commit", but the service contract has no cross-repository transaction, which is why the developer built a compensating rollback (the source of B1). The spec or an ADR should say whether services may span a transaction across `painFlags` and `sessions`. That is the clean fix for B1 and N1.
