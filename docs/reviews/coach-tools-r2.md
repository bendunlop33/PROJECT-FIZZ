# Review: coach tools, round 2 (backlog §4.3)

Branch `claude/coach-tools` against `claude/gracious-knuth-joxqpw`. This round covers the fix commits after round 1 (`80cbd3b..8016775`) and re-checks the whole slice. Reviewer, 12 Oct 2026.

**Verdict: PASS.** No blocking issues. Two should-fix items (S1, S2) can follow in a small commit; neither breaks a CLAUDE.md rule outright.

## Checks run

- `npm run typecheck`: passes.
- `npm run lint`: passes.
- `npx vitest run --testTimeout=120000`: the machine was heavily loaded by parallel agents (load average 20 to 27). Two full runs had 4 to 8 failures, all timing-bound: the perf budgets in `backup-perf` and `data-domains-perf`, catalogue D6 and motion-turns, the equipment memo timing, and the app-services launch-backup polling loop. Run on its own, each failing file passes (app-services 13/13, definition 40/40, motion-turns 11/11, equipment 40/40, both backup-perf files, data-domains-perf). This branch doesn't touch any of them, so they are load flakes, not regressions. Every other test passes (3971+).
- Mutation checks. I reverted each fix in turn and confirmed its new test fails:
  - S3 (only the set the Log button would log): 2 tests fail.
  - S5 (an edit undone on the overview doesn't come back after midnight): 2 fail.
  - S6 (an expired suggestion doesn't block the same words): 1 fails.
  - N3 (the version is checked inside the write): 1 fails.
  - S2 (rule numbering): 2 fail.
  - S1 (`Couldn't apply here`): 1 fails.

## Round 1 findings

| R1 | State |
|---|---|
| B1 reserved migrations 8/9 | **Fixed.** `releaseBlockers` and `npm run check:migrations` reject a `reserved-` name or empty SQL. The iOS workflow's `check` job runs it, and `build` `needs: check`. Tests cover the script exit code and that the workflow wires it in. The merge order 8 → 9 → 10 is in ADR 0020 and in the migration-list comment. |
| S1 Apply card says Applied when the overview refused it | **Fixed.** The card reads `Couldn't apply here`, the overview toasts `Coach change didn't fit here`, and the card goes back to `Applied` at a gym that can do it. Tested. See N1 for the leftover. |
| S2 chat rule numbering | **Fixed.** `chatRuleNumbers` skips withdrawn rules, so the screen and the context share one numbering. |
| S3 chat log on any pending set | **Fixed.** Only the next pending set of the exercise in focus or of the one exercise Ben named is accepted, with leading warm-ups allowed to be passed over. Anything else gets `say which set`. |
| S4 `suggest_memory` general-rule guard | **Partly fixed.** There is now a deterministic guard on `suggest_memory`, but it has false positives, and `save_memory` has no guard at all. See S1 and S2 below. |
| S5 undone edit comes back after midnight | **Fixed.** `dismissedCoachEditOpIds` reads closed drafts. A copy restored by Ben's toast Undo still counts as wanted. |
| S6 expired suggestion blocks the same words | **Fixed** in the store write, with the same `suggestionInDate` the list uses. |
| S7 schema-10 coverage | **Fixed.** The test now covers rows surviving the rebuild, the new statuses, both unique indexes, the no-delete triggers and the `suggest_memory` kind. |
| S8 Add not offered | Tracked as its own backlog row (`8016775`). Accepted. |
| N1 to N7 | All fixed except part of N6 (waiting rows still can't be edited before Save). N8 is recorded in ADR 0020. |

Scope items 1 to 5 still meet the brief, as in round 1. On rules: 2 (Apply/Undo, nothing silent), 3 (structural tool gated), 4 (doable checks, plus the new refusal shown honestly), 5 (op IDs, versions, and the session version now checked inside the transaction), 8 (reads quoted as data) and 10 (substitutions labelled by both domains; Memory shows `Your data`). The minimal-copy test passes.

## Blocking

None.

## Should fix

### S1. `save_memory` (Ben's "remember …") has no general-rule guard, so CM9 / rule 10 still leaks through the confirmed path

`packages/coach/src/executors.ts:162-182`, `packages/coach/src/tool-call.ts:230` (the guard runs only for `suggest_memory`)

Round 1's S4 fix covers only the suggestion path. CM9 says: "Even when Ben says 'remember …', a general rule is never saved as a memory." The `save_memory` description asks the model not to save a rule, but nothing in code checks it.

**Failure scenario:** Ben says "remember to always deload every 5th week". The model calls `save_memory` with "Always deload every 5th week". It is saved at once as `active` in Your data and sent to the coach as a personal memory on every later turn. That breaks rule 10, and the rule never reaches Playbook → To review.

**Fix:** run the same check (`generalRuleMemoryText`) in `parseToolCall` for `save_memory`. Better still, make both paths do what CM9 asks: turn the call into an `add_playbook_candidate` (an `Add to playbook?` card) instead of a dead-end refusal. Add a test with "remember to always deload every 5th week".

### S2. `generalRuleMemoryText` refuses ordinary personal constraints and misses some general rules

`packages/coach/src/tool-call.ts:188-205`

I probed it with sample texts.

These are personal facts, and the guard refuses them as "general rules":
- "Keep sessions under 45 minutes on weekdays"
- "Sessions must be under 45 minutes on weekdays"
- "Avoid lunges"
- "Use straps for deadlifts"
- "Train before work"
- "Finish by 7:30 to get to work"

These are general rules, and the guard lets them through:
- "Progressive overload works best with small jumps"
- "A deload every 4-6 weeks helps recovery"
- "Compound lifts first"

**Failure scenario:** Ben says his sessions have to be under 45 minutes on weekdays. The coach suggests "Keep sessions under 45 minutes on weekdays". The call is refused, and Ben sees the app line "That's a general rule, not about you, so it wasn't suggested as a memory. Nothing changed." That line is wrong, and it is long for the minimal-copy rule. A schedule constraint is exactly what coach-memory wants kept.

**Fix:** don't hard-refuse on a regex. When the text is ambiguous, do what CM9 says for "split unclear": a card with [Save as a memory about me] [Add to playbook]. Keep hard refusal for clear rule wording only ("always/never … every N weeks", "should/must" with no person). Shorten the line, for example `Rule, not a memory · sent to Playbook`. Add the false positives above to the tests as personal facts.

## Nits

- **N1.** `Couldn't apply here` is kept in memory only (`apps/mobile/src/coach/coach-service.ts:257`). After a force-close, the card reads `Applied` until the overview loads again. That's acceptable because the overview recomputes it on load, but a test or a comment saying the card can be optimistic after a restart would make the trade-off explicit.
- **N2.** The same applies to an edit Ben undid on the overview, and to a pruned redundant or stale coach edit: the coach card still reads `Applied`, with Undo, while the overview shows nothing. Undo there is harmless, but the card's word could be `Undone on overview`, or the card could treat dismissed op IDs as `not_here`.
- **N3.** `chatLoggableSetIds` lets a chat log pass over pending warm-ups (`packages/domain/src/coach/chat-log.ts:120-150`). The Log button doesn't do that: it logs the active set. The leftover warm-ups stay pending ahead of the logged set. That's reasonable, but the coach-sheet spec should say so. It currently says "the set the Log button would log".
- **N4.** `namedExercise` matches by substring of normalised names. "Log row 50 for 8" in a workout with both "Cable row" and "Chest-supported row" matches neither, so the result is `say which set`. That is correct and safe. It's noted only so the copy stays clear.
- **N5.** Part of round 1's N6 is still open: a waiting suggestion can't be edited before Save (coach-memory §2.2).

## Spec issues

- **SP1.** The orchestrator says workout-library "may take migration 9". If it doesn't, the `reserved-workout-library` placeholder blocks every `.ipa` (safely) until someone renumbers. Because 10 has never shipped, renumbering it to 9 is safe at that point. The merge plan should say who decides, and when.
- **SP2.** CM9 asks for an `Add to playbook?` card or a two-button split when a memory looks like a rule. Rounds 1 and 2 drifted to a refusal line instead (see S1, S2). Either build the card or amend CM9.
