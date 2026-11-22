# Review: coach tools (backlog §4.3)

Branch `claude/coach-tools` against `claude/gracious-knuth-joxqpw` (5 commits, 052ce16..7291180). Reviewer, 12 Oct 2026.

**Verdict: CHANGES NEEDED** (one blocking issue: B1)

## Checks run

- `npm run typecheck`: passes.
- `npm run lint`: passes.
- `npx vitest run --testTimeout=120000`: 3955 passed, 1 failed. The failure is `packages/catalogue/test/definition.test.ts` D6, which timed out at its own 60 s per-test limit under full-suite load. This branch doesn't touch that test, and it passes when run on its own (40/40). It is a pre-existing flake, not a regression.

## Scope against the brief

| Item | State |
|---|---|
| 1. Read tools (history, overview, equipment, built-in targets) and the `How am I doing?` chip | Done. Every result is labelled `domain: 'Your data'` with a note that its text is data, never instructions. There is no e1RM, excluded sets are labelled, imported sets are never compared with app sets, and assisted loads count less assistance as better. The chip is hidden when the coach isn't ready. |
| 2. Structural proposals as Apply cards with before/after and Undo, gated on a request or a CA9 signal | Swap, remove and reorder are done. **Add is not offered** (see S8 and SP1). Template changes only go through `Change Push A too ›`. |
| 3. Log or correct a set from chat, with Undo, through the same commands | Done. Uses the workout's own `log_set` / `correct_set` / `undo_log`, with the record and the set write in one transaction. Only numbers Ben said are accepted, and units are never converted. |
| 4. Memory screen | Done: list, edit, forget with Undo, add, and suggestions waiting for Save. Suggestions are never sent to the coach. |
| 5. Playbook candidates | Done: approve, reject, and back to review. Only approved rules go to the coach, as Coaching knowledge. |

Rules checked: 2 (corrections only on Ben's named request, with a visible before → after card and Undo), 3 (structural tool gated by `buildTurnRegistry` and real signals), 4 (swap-ins checked as doable), 5 (versions and op IDs on every write; stale proposals refused), 8 and 10 (reads quoted as data; approved rules in Coaching knowledge only). The minimal-copy test passes, and UI strings are short.

## Blocking

### B1. Reserved no-op migrations 8 and 9 can skip the real ones permanently on a device or backup

`packages/persistence/src/migrations.ts:39-40`

Versions 8 and 9 are empty placeholders, and `migrate()` (`migrations.ts:83-93`) only checks `user_version`. Nothing stops a build that still has the placeholders from reaching the phone. The ADR note only forbids an `[ios-build]` "from this branch", but the same risk applies once this branch merges to main before delete-workouts or workout-library.

**Failure scenario:** coach-tools merges first, and main ships an `.ipa` (the usual flow). Ben's phone migrates to `user_version = 10` using the empty 8 and 9. Later, delete-workouts merges with its real migration 8. On the phone `from (10) >= 8`, so its SQL never runs. The delete-workouts code then hits a schema that doesn't exist, mid-session. A backup taken at v10 has the same problem: it claims schema 10 without 8 and 9's tables or columns. A restore into a build with the real 8 and 9 runs neither.

**Suggested fix (small):** make the placeholders impossible to ship.
- Add a test or `npm run check` step that fails when any migration has empty SQL or a `reserved-` name, and wire it into the ios-build workflow. The merge then can't produce a shippable build until the real 8 and 9 replace the placeholders.
- Optionally, have `assertWellFormed` reject empty `up` SQL unless an env flag is set for branch work.
- Record the required merge order (8 → 9 → 10) in the ADR note and in the PR description.

## Should fix

### S1. An Apply card reads "Applied" when the overview's own checks refused the edit

`apps/mobile/src/services/app-services.ts:523-529`, `apps/mobile/src/coach/coach-service.ts` (`structuralDeps.doable` uses `gymInContext`)

A swap is checked as doable at the gym in context: the workout's gym, else the default gym. The draft edit is checked again at the overview's actual gym (`swapAllowed`). When that check refuses it, `applyCoachChanges` ignores `r.ok === false`. The card state comes only from coach records, so it still reads `Applied`.

**Failure scenario:** a proposal made at the Main gym swaps in Pec deck. Ben opens the next workout at the Hotel gym, which has no pec deck. The overview shows the original exercise, while the coach card still says `Applied` with Undo. Neither surface shows that the change didn't land, which breaks the honest-status rules (1 and 6).

**Fix:** surface refused writes. For example, mark that apply's state as `Couldn't apply here` (or `Out of date`) when the draft write returns `invalid` or `stale`, and add a one-line overview notice. Add a test for a swap that isn't doable at the overview's gym.

### S2. Chat rule numbers differ between the Playbook screen and the coach

`apps/mobile/src/coach/playbook-view.ts:29-30` and `packages/coach/src/context.ts:204`

The screen numbers rules after removing `withdrawn` candidates. The coach context numbers all of them, withdrawn included.

**Failure scenario:** rule A is added and then undone (withdrawn), and rule B is approved. The screen shows `Chat rule 1` for B. The coach is sent `Chat rule 2` for B, and cites "Chat rule 2", which Ben can't find.

**Fix:** use one numbering in both places (filter `withdrawn` before `chatRuleNumbers` in `buildCoachingKnowledge`, or in neither). Add a test with a withdrawn candidate ahead of an approved one.

### S3. A chat log can land on any pending set, not the one Ben means

`packages/domain/src/coach/chat-log.ts:145`

`checkChatLog` accepts any pending set in the workout. "Log 100 for 8" relies on the model to choose the `setId`.

**Failure scenario:** the model picks set 3 of the next exercise (or set 4 while set 2 is still pending). The set is logged out of order, rest starts, and the first set stays pending. The card does show the set and offers Undo, but the wrong set has been logged.

**Fix:** restrict `log_set` to the next pending set of the exercise in focus, or of the one exercise Ben named, the same set the Log button would log. Refuse anything else with `say which set`. Add a domain test.

### S4. `suggest_memory` has no deterministic guard against general training rules (rule 10)

`packages/coach/src/registry.ts:201`, `packages/coach/src/executors.ts:184`

The tool is offered on every general or workout turn (`needs: 'none'`). Only the description tells the model not to use it for rules.

**Failure scenario:** the coach suggests "Always deload every 5th week" as a memory. Ben taps Save, and a general rule becomes a personal memory in Your data, against CLAUDE.md rule 10 and CM9.

**Fix:** run the suggestion text through a rule detector, for example the playbook phrasing plus imperative or "always/never + training noun" patterns, and refuse it, or route it to `add_playbook_candidate` as a suggestion. Add a test.

### S5. After midnight, a coach edit that Ben undid on the overview comes back

`packages/domain/src/coach/structural.ts:234`

`structuralDraftPlan` only skips op IDs that the **open** draft has seen. When yesterday's draft expires (TE5), the new draft has none of them, so every live Apply is written again.

**Failure scenario:** Ben applies a swap, opens the overview, and taps the overview's own Undo on that swap. He doesn't train that day. The next day the swap reappears. This contradicts the function's own doc comment ("a later Ben Undo of that edit never brings it back").

**Fix:** record Ben's overview Undo of a `coach-apply:` edit against the Apply, for example as an `undo` record or a "dismissed" note on the apply, so later drafts skip it. Add a cross-midnight test.

### S6. An expired memory suggestion blocks the same suggestion forever and records a misleading refusal

`packages/persistence/src/coach.ts:413`

After 14 days a suggestion drops off the screen, but its row stays `suggested`. Any later suggestion with the same words is refused as "it is already saved or waiting".

**Fix:** treat a `suggested` row older than `SUGGESTION_DAYS` as not waiting. Either move it to `not_saved` when it is read, or apply the date check in the store query.

### S7. The migration 10 test covers only `coach_actions`

`packages/persistence/test/schema10.test.ts`

Nothing tests that:
- `memories` accepts `suggested` and `not_saved`;
- `playbook_candidates` accepts `approved` and `rejected`;
- existing rows survive the rebuild;
- `memories_one_active` and `playbook_candidates_one_open` still enforce uniqueness;
- the no-delete triggers on both tables still fire;
- `suggest_memory` is an accepted kind.

A typo in either table rebuild would pass today's tests.

**Fix:** extend the schema-10 test to cover all of the above.

### S8. Item 2 is partial: Add isn't offered

`packages/domain/src/coach/structural.ts:98`

The scope says swap, add, remove and reorder. Add is dropped with a guard note because the pre-start draft can't hold an added exercise yet. That reason is valid, and it is documented in ADR 0020 and coach-contract.

**Fix:** keep it, but add Add as an explicit backlog row that depends on the workout-library branch, so the gap is tracked rather than buried in an ADR note. See SP1.

## Nits

- **N1.** `get_substitutions` returns catalogue exercises (Coaching knowledge) labelled `domain: 'Your data'` (`packages/coach/src/structural.ts:111`). Label the options by where each comes from, or use a neutral label.
- **N2.** In a correction, `said()` (`chat-log.ts:98`) counts the set number as a number Ben said. With "set 2 was 95", the model could also set reps to 2 and pass. "The last one was 2 short" also matches `CORRECT`. Excluding the number that follows `set` from the said-set would close this.
- **N3.** `log_set` checks `baseVersion` outside the write transaction (`packages/coach/src/chat-set.ts:41`), so a Log tap on a *different* set in that window doesn't stale the chat log. The window is small, and the card makes the result visible.
- **N4.** `perWeek` in the overview (`training-view.ts:313`) divides by the whole window even when the first workout was recent. "0.3 a week" over 12 weeks for someone who started 2 weeks ago misleads the coach. Use the span from the first workout in the window, or omit `perWeek` when the window predates the history.
- **N5.** In the overview, `workingSets` counts sets Ben marked as not counted.
- **N6.** The Memory screen doesn't show the Your data label (the Playbook screen shows Coaching knowledge). Waiting rows can't be edited before saving (coach-memory line 180/337). Save has no Undo toast.
- **N7.** A spoken or typed "record 3 sets of 8" opens `log` (`LOG` accepts `record`). The numbers check passes `3 kg × 8`, and the card makes that visible.
- **N8.** Merge note: training reads rely on `listFinished*` excluding deleted workouts. Re-check this when delete-workouts (migration 8) lands.

## Spec issues

- **SP1.** ADR 0020 §3 and the backlog item list "add" as a structural change, but the pre-start draft (ADR 0022) has no slot for an added exercise. Add should be scoped to after the workout-library work (or the draft model extended). This needs a backlog or brief note, not a code workaround.
- **SP2.** The orchestration instruction "use migration 10" while 8 and 9 are still on other branches forces placeholder migrations. Whoever merges needs a fixed order (8 → 9 → 10) or a release guard (B1). Record the order in the merge plan.
