# Review: B3 coach integration (workout-builder-v3 §5, §6.1 pre-session nudge)

Branch `claude/b3-coach-20oct` (93130e4..1fad763, 6 commits). Spec: `docs/design/workout-builder-v3.md` §2.6, §2.9, §5, §6.1, S6/S7; prototypes `workout-builder-v3.html`, `today-v2.html`; CLAUDE.md rules 1–10.

## Verdict: **CHANGES NEEDED** (6 blocking)

## Checks run by the reviewer

- `npm run typecheck`: clean (exit 0).
- `eslint` on every changed path: clean (exit 0).
- `vitest` on `packages/coach/test`, `packages/schemas/test`, `apps/mobile/test/builder-coach.test.ts`: 41 files, 2260 tests passed. All 24 `apps/mobile/test/*coach*.test.ts` files passed (277 tests), so the `coach-service.ts` memory filter breaks nothing.
- Probe tests (written to scratch files, run, then deleted; nothing left in the tree) back up B1, B2, B3 and S1 below.

There is no file overlap with `claude/b3-builder-20oct` or `claude/b3-today-20oct`. The contract mismatches with those two streams are covered in B6 and S11.

---

## Blocking

**B1. The pre-session nudge fires again after Apply and keeps going lighter.**
`apps/mobile/src/coach/builder-coach-service.ts:421-450`, `packages/coach/src/builder/nudge.ts:158-188`.
`inputsHash` includes the offer's lines, and the offer is rebuilt from the current draft. After Ben taps Apply, the draft is lighter, so the offer lines change and the hash changes. The stored review is then superseded and the light model is asked again. The signal (for example 3 sessions at RPE 9–10) is still there, so the card shows the nudge again with a new offer.
Probe: rpe_high, Apply three times in a row. The offers were `100 → 97.5 kg`, then `97.5 → 95 kg`, then `95 → 92.5 kg`, with 3 model calls. This breaks rule 3 ("never adjusts constantly") and §6.1 ("re-runs only when its inputs changed"). The inputs (signals) never changed.
*Fix:* build the hash from the signals and the plan-day identity only (not the offer or the draft state). Record the Apply against the stored pre-session review, for example by adding the apply op ID to `opIds` or `actionIds`. Once the nudge is applied or skipped for that `localDate` + `splitDayId`, return `silent`. Add a test: Apply, then open Today again, and expect no line and no model call.

**B2. A coach sentence with a wrong number is not hidden when that number appears anywhere in the context.**
`packages/coach/src/builder/checked-text.ts:16-31`, with the facts pool built at `builder-coach-service.ts:231-235` and `:350`.
The facts pool is every number in the whole YOUR DATA JSON: slot keys like `bench#1`, draft UUIDs, reps, loads, history lines and memories. A claim passes if its value appears anywhere in that pool.
Probe on the fixture review (16 working sets, Mid chest 7). All four of these were **shown**: `Balanced, 5 working sets`, `Balanced, 30 working sets`, `Mid chest has 4 sets`, `Only 2 exercises for chest`. Only `12 working sets` was hidden. This fails S7 "a coach sentence with a wrong number is hidden" and §2.9 "code works out and checks every fact". It also breaks rule 6.
*Fix:* check counts against the count they name, not against a pool. Parse `<n> (working )?sets`, `<n> exercises`, `<n> compound|isolation`, `<n> min` and `<focus> <n>`, and compare each with the matching `BuilderReviewFacts` value. Hide any other bare number unless it is a load or rep value of a named exercise. Build the pool from code's fact lines and loads only, never from IDs, slot keys or memories. Add the four probe sentences above as tests.

**B3. The load guard fails open when there is no load reference.**
`packages/coach/src/builder/load-guard.ts:80-96`.
`checkProposedLoad` runs only when `refs !== null` and the unit and convention match. Otherwise the coach's value is just rounded down to the item's max.
Probe with the fixture's `refs: () => null` for accessories: `Cable fly: 15 → 100 kg` (stack max) and `Incline dumbbell press: 27.5 → 40 kg each` were both offered as proposals. The source port documents `refs` as "null when none was read", so the builder wiring can trigger this. It bypasses rule 3's ceilings (`capE` / `capLastTop`, first-time ceiling) and §5 "loads via `checkProposedLoad`".
*Fix:* fail closed. When `refs` is null, refuse a `value` load (`Not changed: no reference for that load`) and allow at most one `step`. When the unit or convention differs, call `checkProposedLoad` anyway, because it already converts units and refuses a wrong convention. Make `refs` non-nullable in `LoadGuardDeps`, or make the builder stream always supply `loadReferences` (it returns a no-history reference with `patternE1rms` and `noReferenceCeiling`). Add tests for null refs and for a lb history on a kg item.

**B4. Numeric "For next <day> day" notes are shown ticked but are never saved.**
`packages/coach/src/builder/review.ts:264-274`, `apps/mobile/src/coach/builder-coach-view.ts:129`, `builder-coach-service.ts:384`.
`checkReview` produces `kind: 'target'` notes such as `Bench top set: 102.5 kg next`, and `builderReviewView` shows them ticked by default. `saveTarget` is not wired, so on Done they count as `skipped`, and nothing in the view model shows that. Ben sees a ticked note, taps Done, and the note is gone. S7 ("a numeric note sets next time's load") is not met, and Ben gets a false impression that it was saved.
*Fix:* until Ben decides how coach targets are stored (Spec issues SP2), take target notes out of `builderReviewView`, or save them as text day notes in code's wording (`Bench top set: 102.5 kg next`) so they at least show under `From last review` and reach the coach. Also return `skipped` to the sheet so a failed save shows a one-word `Not saved`. Add a test that a target note is never shown ticked when it can't be saved.

**B5. "Reviewed" is reported when no coach ran, including in airplane mode.**
`builder-coach-service.ts:427, 449`, `builder-coach-view.ts:153-162`.
With no signals, `preSessionNudge` returns `{ kind: 'silent' }` without checking reach, and `nudgeReviewStatus` maps `silent` to `'reviewed'`. So `coachWhyLine` returns null offline. On Today in airplane mode (the usual case, with no signals) the `Why?` would not end `Not reviewed · Offline`. This fails §2.0.8 acceptance check 1, §2.0.4 Offline and rule 1.
*Fix:* split code-only silence from coach silence. For example, use `{ kind: 'silent'; by: 'code' | 'coach'; status: BuilderCoachReach }`, always read `reach()`, and map code silence while offline or not connected to that status. Add a test: offline with quiet inputs gives `Not reviewed · Offline`.

**B6. The `BuilderReview` provider the builder stream consumes is not provided.**
In scope: "Provide the view-model providers the Today and builder streams consume: `BuilderReview` provider". The builder stream (`claude/b3-builder-20oct`, `apps/mobile/src/builder/review.ts`) defines `BuilderReviewProvider { review(draftId, signal), apply(draftId, actionId, opId), saveNotes(draftId, noteIds, opId) }` returning `BuilderReview { status: 'reviewed'|'pending'|'offline'|'not_connected', counts: {group, sets, trained}[], plan.actions, suggestions: BuilderReviewAction[], nextNotes }`.
This branch offers something different: `service.review({ draftId, opId, groups, plan })` plus `builderReviewView` (`coverage` by focus, proposal objects instead of action IDs, a `failed` status the builder doesn't have, and `saveReviewNotes` needing `splitDayId` and `mainLiftExerciseId`). Nothing maps one onto the other. The adapter is stateful: it holds proposals by action ID, notes by ID, and `groups` and `plan` from the draft. As things stand, nobody owns it at the merge.
*Fix:* add `createBuilderReviewProvider(service, source)` in `apps/mobile/src/coach/` implementing the builder's interface. It should cache the last `BuilderReviewResult` per draft, map `apply(actionId)` to `service.apply(proposal)` (`Out of date` becomes `{ ok: false, message: 'Out of date. Ask again.' }`), and map `saveNotes(noteIds)` to `saveReviewNotes`. Agree with the builder stream which statuses exist and whether counts are per group or per focus (S11, SP3). Add a contract test against the builder's types, written as a local copy of the interface if the branches can't import each other yet.

---

## Should fix

**S1. Double tap, or retry after a crash, reports "Out of date" for an Apply that succeeded.**
`builder-coach-service.ts:328-337`. The existing test asserts this at `apps/mobile/test/builder-coach.test.ts:186-188`.
The recheck runs before the idempotent write. On the second tap the slots have moved, so Ben sees `Out of date. Ask again.` even though the change was applied. *Fix:* ask the writer first whether `builderApplyOpId(proposal.id)` has already been applied (a `replayed` result, or an `applied(opId)` lookup), and return `applied` if it has. Then change the test to expect `applied` twice and one write.

**S2. Pain-flagged movements can still be given more volume.**
`packages/coach/src/builder/edit-ops.ts:362-369` (`sets`), `:370-395` (`reps`).
Only harder RPE and heavier load are blocked. `sets 3 → 5` on a pain-flagged lift is proposed with no note. Rule 9 says pain stops progression for that movement. *Fix:* refuse a `sets` or `reps` increase on a pain-flagged slot with `Not more: <pain>`, as for RPE, and add a test.

**S3. Reps and RPE ops change loads by formula without the ceiling check.**
`edit-ops.ts:386-394`. Probe: `reps 6 → 1` on bench gave `100 → 115 kg`. That is inside 1.2× here, but a combined `reps` + `rpe 10` can go past `capLastTop` without passing through `checkProposedLoad`. *Fix:* after reps or RPE edits, run the new top load through `env.loads.check` (keeping the slot's load when the check refuses), and say so in a note.

**S4. A target RPE is invented in a stored fact.**
`nudge.ts:122`: `rpe_drift` is stored with `targetRpe: 8` whatever the sessions' real targets were (rule 6). *Fix:* store the real target when it is known, or `null`. Widen the schema if needed.

**S5. Day notes never expire, and they also show as general memories.**
`builder-coach-view.ts:204-209` returns every active note ever saved for the day and main lift, so notes from several reviews pile up under `From last review`, can contradict each other, and all go to the coach. They also appear in Profile › Memories (`coach-service.ts:1746` `memoryList`) as plain memories with no day attached. *Fix:* limit them to the latest review's notes for that day (by `dayNote.reviewId`, or close older notes when a newer review saves). Either label them with the day in Memories or leave them out of that list (see SP4).

**S6. The mic shows `⊘` only after the first tap.**
`apps/mobile/src/ui/coach-ask-bar.tsx:40`. State starts `idle`, so a phone with no on-device speech shows a normal mic (§2.6: "the mic shows ⊘"). *Fix:* run `onDeviceAvailable()` on mount and when the app returns to the foreground, and set `unavailable` before any tap. Keep the per-tap re-check.

**S7. Listening is not announced on iOS.**
`coach-ask-bar.tsx:84`. `accessibilityLiveRegion` only works on Android. *Fix:* call `AccessibilityInfo.announceForAccessibility('Listening')` when listening starts, and announce the final words when it ends.

**S8. "Set up from words" can't be asked from Today.**
`builder-coach-service.ts:282-284`: `askSetup` gives `failed` when `source.setup()` is null ("Set up isn't open"). §2.0.5 and §2.1 say the Today coach bar's "legs, 45 min" opens the builder Set up, filled, with an Undo toast. *Fix:* add a `source.setupFor(dayHint)`, or let `askSetup` take a context built from Today's card, and have the writer open the builder on Set up. Add a test.

**S9. Offline, Set up gets a sheet when the spec says it shouldn't.**
`coach-ask-bar.tsx:52, 86` always calls `onOpen` (the coach sheet). §2.6 says offline Set up has "No chat sheet, no chat bubble". The typed or spoken words should go straight to `askSetup`. *Fix:* add an `onSubmit(words)` path for `page === 'setup' && reach !== 'ok'`, with an inline field, and a toast for `Not understood`.

**S10. `Update plan day` ignores set-count changes.**
`review.ts:198`: `differs` only looks at missing or added exercises. The §2.8 example (`Triceps pushdown: 3 → 4 sets`) counts as a difference, but this code wouldn't offer `Update plan day`. *Fix:* also compare working sets per planned exercise and the main lift. Loads stay out (§9 Q11).

**S11. Collisions with the Today and builder streams.**
- Today (`claude/b3-today-20oct`, `packages/domain/src/today-v2/view.ts`) already builds the Mix it up line (`notReviewed`, `Another (1/n)`) and the `Why?` lines, including `Not reviewed · Offline` and `Not reviewed · Coach not connected`. `mixPick`, `mixRowView` and `coachWhyLine` here duplicate that work. Decide who owns the copy, and have Today call `mixPick` for the coach's choice only.
- Counting conventions differ. The builder stream's review counts direct working sets per group (`Chest 10`). This branch counts by focus with half credit for secondary muscles (`Triceps 7` from one 3-set pushdown plus presses). The stored `group_sets` facts use a third, direct-only convention. Pick one (SP3).
- Builder stream note `coach-draft.ts:812`: `applyWorkout` must keep `origin: 'builder'` and set builder loads through the same codec, or Start will refit. Write this into the `BuilderCoachWriter` doc comment, together with "bump `DraftSlot.rev` for every changed slot on a coach apply".

**S12. Status words in a few paths are wrong.**
`builder-coach-service.ts:224, 296`: a model error that isn't a network error (invalid args, rate limit) is shown as `Coach not connected`. `:312`: a missing draft is reported as `not_connected`. *Fix:* use `failed` → `Not reviewed` for model errors, and a separate `gone` result for a missing draft.

**S13. Proposals don't survive a force-close.**
Chat proposals and review suggestions live only on screen. §4.8 planned migration 0030 to rebuild `coach_actions` for these tool kinds, and §2.0.3 stores the review result with the draft. This is acceptable for now as the developer's stated decision, but it needs Ben's decision and a CHANGELOG entry. After a force-close the review sheet costs a new model call.

## Nits

- N1 `coach-ask-bar.tsx:107`: `numberOfLines={2}` clips at the largest Dynamic Type sizes, although the comment says it wraps.
- N2 `edit-ops.ts:342-346`: an `add` with an unknown `afterSlotKey` is quietly placed at the end. Add a note.
- N3 `edit-ops.ts:577`: the minutes precondition compares values, so a length change 60 → 45 → 60 still passes. Use a Set up revision.
- N4 `voice/on-device-speech.ts:317-341`: if `start()` throws, the three listeners are never removed.
- N5 `proposal.ts:128`: the recheck compares lines but not `warnings`, so a new `⚠` that appears after Ben's other edits is not shown before Apply.

## Test gaps

None of these are tested: the nudge after Apply (B1); wrong numbers that do appear somewhere in the context (B2); a load guard with null refs or mismatched units (B3); target notes when `saveTarget` is absent (B4); offline with no signals giving `Not reviewed · Offline` (B5); Apply after a replay (S1); pain combined with sets or reps (S2); `⊘` before the first tap (S6).

## Spec issues (for Ben, not code defects)

- **SP1.** §2.0.3 says the coach reviews every Today draft (a background AI call, with `Not reviewed` when it didn't run). §6.1 says the daily check is silent unless there is a clear signal, using the light model. This branch follows §6.1 and makes no call without a signal. The spec should say which applies, and what `Why?` shows online when there was no signal (`reviewed`? nothing?).
- **SP2.** §2.9 [Proposal] says a numeric note "is saved as the coach's target for that lift", but no record for a pre-Start coach target exists (existing targets are tied to a finished session). §9 Q12's load order (coach target first) depends on this.
- **SP3.** "Core-muscle coverage with set counts" doesn't define the counting: direct sets per group, or per focus with credit for secondary muscles. The two streams already differ, and Progress weekly sets per muscle will need the same rule.
- **SP4.** How long `From last review` notes last isn't defined: the last review only, until met (Summary ticks them, §6), or until ✕ forever.
- **SP5.** The nudge's offer is chosen by code (one step lighter, or one set fewer), and the coach only writes the line. This narrows rule 3 ("the coach chooses weights, reps and sets … when a clear signal suggests it"). Ben should approve it, and it should go in the CHANGELOG.
- **SP6.** §5 lists Migration 0030 "rebuilds `coach_actions` for the new tool kinds", but this slice needs no migration because it stores no actions. Either drop that from §4.8 or keep it as the plan for persisting proposals (S13).
