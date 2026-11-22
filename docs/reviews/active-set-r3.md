# Review r3: active set follow-ups (Why?, exclusions, pain flags without the coach, time left)

**Verdict: PASS**

Reviewed: `claude/gracious-knuth-joxqpw..claude/active-set` (39 commits, base `952f79b`, HEAD `1b8531a`). This round focuses on the three commits after review r2 (`6ca342a`, `docs/reviews/active-set-r2.md`): `31da831` (r2 B1, N1, N2), `27b4179` (r2 nits) and `1b8531a` (spec §8.3: r2 N3, N4, S3). I also re-checked the earlier fixes and the rebase.

Specs read: CLAUDE.md (rules 2–6, 9, 10 and the minimal-copy convention), `docs/design/active-workout.md` §2.12–2.15, §7, §8 and §8.3, the competitor-landscape follow-ups 3/8/9/10, and CHANGELOG 2026-10-09.

## What I ran

| Check | Result |
|---|---|
| `npm run check` in `/home/user/wt-active-set` | Exit 0. Typecheck and lint are clean, 129 test files and 1755 tests pass, the catalogue validates (135 entries, 0 errors), and 10/10 guides pass the motion thresholds |
| `git merge-base HEAD claude/gracious-knuth-joxqpw` | Equals the base tip `952f79b`, so the branch is 0 commits behind |
| A throwaway probe test on real SQLite (deleted, not committed) | (a) The first rollback fails (`retractPainFlag` throws), which leaves an active flag behind, then a retry without `Pain` retracts that leftover. (b) The same leftover, then a retry with `Pain`, reuses the flag, and Undo retracts it. Both pass |
| Grep of the diff for `console.*`, logging and secrets | None |
| Migration files on the sibling branches | `claude/gym-switch` has `0004-gym-switch.ts` and `claude/coach` has `0004-coach.ts` (see N2) |

## Review r2 items: status

| Item | Status |
|---|---|
| B1: a retry after a failed Pain mark marks the set with no flag | **Fixed.** `opPainFlag` (`workout-services.ts:322`) walks a chain of IDs derived from the opId and returns the first one that is absent or `active`, so a retracted flag is never "ours" and a retry writes a fresh flag. The leftover branch (`:1007`) takes back an active flag of this op when the retry no longer ticks `Pain`. Tested: the failed save leaves no active flag and no `Before flag` row, the retry gives one active flag with a true toast and a working Undo, and a retry that drops Pain leaves no flag. I probed the leftover paths myself |
| N1: a throw leaves the flag on while the sheet says "wasn't saved" | **Fixed.** The `catch` (`:1035–1047`) rolls back when the op didn't land and says `Saved. Showing the latest.` when it did. Both are tested with a faulting `dispatch` (`set-exclusions-throw.test.ts`) |
| N2: `flagFromCheckIn` reports a retracted flag | **Fixed.** It returns early once the link op has been applied (`:418`), and only an active flag counts as the op's. Tested |
| N3: migration 4 collision | **Recorded as a gate** in §8.3. It is incomplete; see N2 below |
| N4: merge risk with `claude/coach` | Recorded in §8.3 |
| N5: basis copied onto every planned set | Not addressed. Still non-blocking |
| Nits: rebase leftovers in `reducer.ts` and `repeat.ts` | Fixed |
| S3: no cross-repository transaction | Recorded in §8.3 as an ADR question. Still open; see the spec issues |

## Blocking

None.

## Should fix (non-blocking)

- **N1. After a throw past the commit, the open sheet can swallow a further edit.** In `apps/mobile/src/services/workout-services.ts:1042`, when `correct_set` committed and something later throws (for example `afterCommand`), the result is `{ ok: false, stale: true, message: 'Saved. Showing the latest.' }`. `EditSetScreen.tsx:72–77` then keeps the sheet open, reloads it and keeps the same `saveOp` (`:35`). If Ben then changes the reps and taps Save, `done` is true and the reducer treats the op as a duplicate. The service returns `ok: true` with no toast, the sheet closes, and the new reps are never saved, with no error. Two smaller effects on the same path: `changed()` isn't called, so the workout screen behind the sheet stays stale, and the Pain mark that landed comes with no Undo toast. This needs an I/O failure after the commit, so it is rare. A related variant was there before this round: with no flag created (`:1039`, `created === null`, for example a `Spotted`-only or reps-only edit), a throw after the commit returns `The change wasn’t saved. Try again.` even though the edit was saved, and the next, different edit in the same sheet is swallowed the same way. **Fix:** in the `catch`, always check `processedOps[req.opId]`, not only when a flag was created. If the op landed, return `ok: true`, using the latest aggregate and the plan's toast and undo, and let the screen close as it does on success. Otherwise, have the sheet generate a new `saveOp` after any result that says the op landed.
- **N2. The migration 4 gate names only `claude/gym-switch`, but `claude/coach` also has `0004-coach.ts`.** That makes three unreleased schema-4 migrations. `docs/design/active-workout.md:1202` should list both, so that the renumbering and the backup-restore check at the merged schema cover all three.
- **N3. When a rollback itself fails, the flag stays on and the sheet still says "wasn't saved".** At `workout-services.ts:1023`, `rollBack` ignores `pain.retract`'s result (`ok: false` or a `stale` entry). In my probe (a), the first save returned `Command failed validation.` while the Bench press flag stayed active. This is the safe direction for rule 9, and the next save in the same sheet cleans the flag up. But if Ben closes the sheet instead, the movement stays flagged with no mark and no toast, and he only learns of it from Today's pain-flag row. §8.3 already accepts this. A transaction (spec issue S2) removes it.
- **N4. The leftover-flag branches aren't covered by committed tests.** The reuse branch (`ours` is active and the retry still ticks Pain) and the take-back branch (`:1007`) only run when the first rollback failed. My probe shows both work. Add the two cases to `set-exclusions-throw.test.ts`, using a `retractPainFlag` fault.
- **N5 (carried over).** Every planned set still copies the whole basis (first review, N5).

## Nits

- `flagFromCheckIn`'s duplicate result (`:418`) returns `flags: []`. If the UI ever re-sends the step after a lost response, it would show `Pain noted for …` with an Undo that does nothing. No current screen can re-send it: the check-in has no Back from `ill`, and Summary's `Choose movements` goes away once the check-in has flags. Returning the linked check-in's active flag refs would make the duplicate result match the original.
- `opPainFlag` stops after 64 IDs and throws. That's fine, but a comment could say why 64 is enough: each attempt adds at most one ID.

## What is solid

- The ownership rule is simple and applied the same way everywhere: only an `active` flag derived from this op belongs to it. A retracted or cleared flag is never reused, never shown in a toast, and never sent to Undo.
- Every way a save can fail now ends with the set and the movement's flag in agreement, except N3, which errs toward holding progression (rule 9).
- The idempotency of a duplicate of a successful save is unchanged: no new flag, no toast, no Undo (tested).
- Rule 6: the toast after a retry is true (tested against `pain.active()`).
- The minimal-copy rule holds. The only new copy is `Saved. Showing the latest.`.

## Spec issues

- **S1 (open, carried over).** A pain flag set mid-workout leaves today's remaining targets, which may already be increased, as they are, while rule 9 says pain "stops progression for that movement". This is still an open question to Ben in §8.3 (`active-workout.md:1206`), and there is no CHANGELOG decision. Until he decides, the spec and rule 9 disagree.
- **S2 (open).** AW7 says "in the same commit", but the persistence contract has no transaction across `painFlags` and `sessions`. §8.3 now says so and asks for an ADR. The compensating rollback is correct apart from N1 and N3, but a transaction would be the cleaner fix.
- **S3 (carried over).** §5's copy table still lists the strings from before the minimal-copy rule (§8.3 notes this). The designer should revise it.
