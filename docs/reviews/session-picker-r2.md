# Review r2: session picker (`claude/session-picker`)

**Verdict: CHANGES NEEDED.**

Scope: `git diff claude/gracious-knuth-joxqpw...claude/session-picker`, commits `d46ba3c`..`d1e83db`. That covers the domain (`session-types.ts`), persistence (`listSessionTypeRows`), services (`sessionTypes.list`, the `{kind: 'session'}` overview target, `sessions.list`), the view helpers (`workout/session-picker.ts`), `SessionPickerSheet`, Today (`Change`, `SESSIONS`, `All sessions`), the overview (title button, in-place switch, `Save as routine`), and tests. I checked it against `docs/design/session-picker.md` v0.1 and its mockup, `workout-overview.md`, `today.md`, ADR 0016, ADR 0022, D19, D21 and CLAUDE.md rules 1–10, plus the minimal-copy rule. I also re-checked the r1 findings (`docs/reviews/session-picker.md`).

Checks run in `/home/user/wt-picker`:

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --testTimeout=120000`: pass. 191 files, 3796 tests passed, 1 todo, on the first run. The r1 N1 flake (backup catch-up) now polls and didn't recur.
- A throwaway probe test (deleted afterwards, not committed) confirmed B1 on real SQLite.

**What r1 asked for is mostly done.** The slice is now built end to end:

- r1 B1: the picker is wired.
- r1 B2: imported sources are `startable: false`, aren't recommended and are left out of the list.
- r1 S1: after a break, the most recently done type is offered.
- r1 S2: the spec is committed.
- r1 S3, S4: the edge-case tests are added, and old dates show their year.
- r1 N2–N5: done.

Both of Ben's decisions are behind `SESSION_PICKER_DECISIONS` (both off), so D19's "last workout" fallback is unchanged. That's the right call while they're open.

Start paths: I traced Up next, `SESSIONS` rows, `Change`, `All sessions`, the overview title, `Empty workout`, `Past workouts`, Done today and the "Your routines" fallback. **Preview = Start holds:**

- A picked session resolves through the same `resolveNext`.
- It has the same `previewKey` target (`{kind:'next', sourceSessionId}`). Only the eyebrow basis differs, and the key doesn't include it.
- Start uses the page's own `startOf`, `previewKey` and draft.

Drafts stay per basis across a switch, and `Edited` reads the right basis, except in the B1 case. There are no provider calls, and the coach D21 targets come through the unchanged `nextTargetsOf`.

---

## Blocking

### B1. Sometimes the `UP NEXT` row for a routine opens a different workout, and the routine can't be opened at all

- **Where:** `apps/mobile/src/services/workout-services.ts:2308` (`recommendedKey = … index.keyOfSession.get(up.sessionId)`), and `:2323` (`target: t.key === recommendedKey ? { kind: 'next' } : …`). Also `apps/mobile/src/workout/session-picker.ts:62-65` (`isShownRow`) and `workout-services.ts:2315-2318` (`isEdited`).
- **Failure scenario (reproduced on SQLite):**
  1. Ben saves routine `Legs` from a Legs workout (Back squat).
  2. Later he does a Legs workout that wasn't started from the routine: via Repeat, via the Up next "next session" path, or renamed `Legs` on Summary (Leg press).
  3. It is his newest workout, so `nextInRotation` returns `last_workout`, and `resolveUpNext` returns `{kind:'next', sessionId: <that workout>}`.
  4. `groupSessionTypes` folds that named workout into the routine type by name. So `recommendedKey` becomes `routine:<Legs id>`, and the row is `kind: 'routine'`, `routineId` set, `target: {kind:'next'}`.

  What Ben sees:
  - The picker row `Legs [UP NEXT]` opens the last workout's next session (`Leg press`), not the routine (`Back squat`). It shows the routine's exercise count, not the one that opens.
  - Today's `SESSIONS` hides it (it's Up next), and the picker has only that one `Legs` row. So the `Legs` routine itself can't be opened from Today or the picker. Before this branch, `Your routines` and the overview's `Other routine` always reached it. Its Rename/Delete (long-press on Today, ⋯ on its overview) can't be reached either.
  - On that overview, the `Legs` row isn't checked: `isShownRow` returns false when `routineId !== null` and `startOf` is `nextOf`. Tapping it reloads the same page.
  - `Edited` reads the routine's draft basis, but the row opens the `next` basis. Edits made on the Up next page never show `Edited`, and a routine draft shows `Edited` on a page that opens without those edits (SP10).

  The same thing happens whenever D19's next routine can't start at this gym (for example the hotel gym). `resolveUpNext` falls back to the last workout, which belongs to the routine just done.
- **Fix:** only mark a type as recommended (and give it the `{kind:'next'}` target) when it is the same plan Up next opens. That means `up.kind === 'routine'` for a routine type, or `up.kind === 'next'` with `t.routineId === null` and `t.sourceSessionId === up.sessionId`. Otherwise, keep the routine row's `{kind:'routine'}` target and leave `recommendedKey` null, or show the Up next session as its own row. Make `isEdited` read the basis of the row's actual target. Add a service test for this exact fixture, covering the routine row's target, `✓`, `Edited`, and Today's `SESSIONS` still reaching the routine.

---

## Should fix

### S1. If a switch on the overview fails, Ben is stuck: no picker and no way back

- **Where:** `apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:774-786` (the `!page` branch) and `:436-447` (`switchTo`). `SessionPickerSheet` is only rendered in the ready branch (`:1090`).
- **Failure scenario:** on the overview, Ben picks `Back`, but `overview.load` returns null. That happens if the source was deleted from Past workouts in the meantime, if the dry run fails at this gym, or if a routine row can't be planned here. `setTarget` has already replaced the shown session, so the page becomes `Couldn't load this workout.` with `Try again`, which retries the same bad target forever, and `Empty workout`. The title button and picker are gone, and the previous session can't be shown again without closing the overview. Spec §5 says: "If the type is gone, `Couldn't load this workout.` with the picker reachable from the title."
- **Fix:** do one of the following:
  - load the new target first and commit `setTarget` only when it succeeds (keep the old page and show a short `Couldn't load` toast);
  - or render the picker and a `Change session` button in the failure branch.

  Add a test (view helper or service) for picking a type whose source is gone.

### S2. The SP6 test doesn't compare loads, so "preview = Start" is only half-checked

- **Where:** `apps/mobile/test/session-picker.test.ts:186-191`.
- **Failure scenario:** the test checks exercise names and working-set counts. For loads it only checks `working[0]?.planned.load?.value` is defined, so it never compares them with the row's `TARGET`. A regression where the picked-session preview snaps differently from Start would pass. OV3's whole point is that a load shown is the load started (rule 4).
- **Fix:** for each row, assert that the row's load value and unit equal the first working set's `planned.load` (and reps), as the existing overview OV3 test does.

### S3. Some acceptance checks have no test on the new paths

- **SP7:** no test of a stored D21 coach target on a picked (`{kind:'session'}`) source. The path is shared with `next`, but this branch adds a new entry into it, and rule 3 is checked hardest. Add a test for the `Coach` tag and target on a picked type, and for no coach UI when there's no target or the coach is offline.
- **SP9 and SP11:** the in-place switch is only tested as two separate `overview.load` calls. Nothing covers what `switchTo` resets (start op ID, panels, swap, reorder) or keeps (the tapped check-in, the gym). At minimum, add a source-check test like the existing `workout-overview-screen.test.ts` ones. They should assert that `switchTo` clears `startOp` and that the load passes `tappedRef`.
- **B1** fixture (above).
- **The `Done today` list.** `includeUpNext: true` is only checked for `more`, not for the rows' order (Up next first, §5).

### S4. `SESSION_PICKER_DECISIONS.longestGapFallback` doesn't switch anything

- **Where:** `packages/domain/src/session/session-types.ts:56`. Production code never reads the flag. `recommendSession` is only called from tests, and `sessionTypes.list` always uses `resolveUpNext`.
- **Failure scenario:** when Ben approves Decision 2, someone sets the flag to `true` and expects the longest-gap Up next. Nothing changes, and Today, the picker and the Plan (weekly-plan check 18) still use D19's last-workout fallback. The doc comment calls it a switch.
- **Fix:** either branch on the flag in `resolveUpNext` (so Today and the picker use `recommendSession` together), or rename the field or comment to say it's a marker and that the service wiring is still to do. A test with the flag on would pin it down.

---

## Nits

- **N1.** During an in-place switch, `data` stays `ready` with the old page until the new load lands. In that window, `Why?`, `Swap` and `Skip` send the new `target` with the old page's draft version. A tap there can write an edit to the session that isn't shown yet. It is short and local, but consider blocking row actions while `target` doesn't match `page.startOf` (`WorkoutOverviewScreen.tsx:485, 533, 582`).
- **N2.** `Saved as routine` → Undo calls `switchTo(before)` even when `routines.remove` fails. The page then shows the history basis while the routine still exists (`WorkoutOverviewScreen.tsx:468-473`). Switch back only on `u.ok`.
- **N3.** `listSessionTypeRows` counts every distinct `session_exercises` row (`packages/persistence/src/sessions.ts:727`), including exercises with no completed set. The picker's `N exercises` can then differ from the overview it opens. Count exercises with a completed set, or take the count from the same plan source.
- **N4.** Today's `Change` has the accessibility label `Change` and the hint `Change session`. §4.5 asks for the label "Change session." (`TodayScreen.tsx:457-460`).
- **N5.** `OVERVIEW_COPY.otherRoutine` (`apps/mobile/src/workout/overview.ts:217`) is now unused. Remove it.
- **N6.** In the SP6 flow, the eyebrow for a picked session that is also the recommendation stays the existing `Next session · from …`, not §2.3's `UP NEXT · LAST DONE …`. That is acceptable while Decision 2 is open, but record it (SI2).

---

## Rules check

- **Rule 1 (offline, no AI):** the list, the switch, the pick and Save as routine are all local. SP14 asserts no model request. Pass.
- **Rule 2 (no silent change to completed sets):** nothing here edits sets. Save as routine is a new routine with Undo. Pass.
- **Rule 3 / D21:** the picked session plans through `nextTargetsOf` (stored coach target when valid, else the built-in rule). No coach call and no coach text in the sheet. Pass on the code, untested on the new path (S3).
- **Rule 4 (achievable loads):** the same dry run and `snapPlanToGym` as Start. Imported sources can't be picked (ADR 0016 P-I3). Pass. S2 is the missing proof.
- **Rule 5 (idempotent, versioned):** Start keeps its `opId`, `previewKey` and draft fence. A switch clears the start op. Save as routine uses one `opId` per prompt (SP13: a repeat gives one). Undo is versioned. SP15 (stale source) is tested. Pass.
- **Rule 6 (no invented data):** `N days ago`, dates (with the year after 11 months) and exercise counts are actuals. The routine `lastDone` versus D19 date difference is documented (r1 N4). N3 is a small count mismatch. Pass.
- **Rule 8 (imports are data):** Category cells would be used as labels only, and are gated off. Pass.
- **Rule 10:** session types are Your data. No Coaching-knowledge mixing. Pass.
- **Minimal copy:** `Choose session`, `Close`, `UP NEXT`, `Edited`, `New`, `OLDER`, `Change`, `Sessions`, `All sessions`, `Save as routine`, `Saved as routine` [Undo]. No explanations or rule labels. Pass.

---

## Spec issues (for the designer and PM; not code defects)

- **SI1. With both decisions off, the picker can't offer most of Ben's history.** Imported FitNotes workouts aren't types (Decision 1, and P-I3 for starting them). In-app workouts are types only if Ben renamed them or saved them as routines. Unnamed ones aren't types (§3.1.4). Ben's request was to "choose what day/type of session I am hitting". Until he decides Decision 1 and P-I3, he'll mostly see his routines. The PM should put Decision 1, Decision 2 and P-I3 to Ben together. A possible interim option is to let Ben name a past workout from Past workouts so that it becomes a type.
- **SI2. The spec still describes the post-decision behaviour as current.** That covers SP1's `Legs` Up next with `Last done … · 6 days ago`, §2.3's `UP NEXT · LAST DONE`, and SP2's category rows. Add a "while Decisions 1 and 2 are open" column to §8 (for example, SP1 currently gives `Chest` from D19) so that the acceptance checks match what is built.
- **SI3. §2.1 and §5 say "1 type → no `SESSIONS`".** The build lists a single type when it isn't Up next (`session-picker.ts:79-86`), so a never-done routine stays reachable now that `Your routines` is gone. That's a sensible change. Record it in the spec.
- **SI4. §3.1.1 lets a named workout join a routine by name, but D19 rotation (`isFromRoutine`) doesn't count it.** That gap causes B1. The spec should say how Up next is labelled and targeted when the last workout joined a routine only by name. Either it is the routine (rotation counts name matches) or it is a separate "next session" row.
- **SI5. §4.3 Save as routine** isn't in workout-overview.md's ⋯ menu list, and `Other routine` is removed. The PM follow-ups in §9 (today.md, workout-overview §2.1, design-system, CHANGELOG once Ben decides) are still outstanding.
