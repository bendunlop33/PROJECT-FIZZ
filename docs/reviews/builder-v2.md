# Review: builder-v2 (workout builder v2: coach loads, questions, reason lines)

**Verdict: CHANGES NEEDED**

Branch `claude/builder-v2` (099d401), diffed against `claude/gracious-knuth-joxqpw`. I checked it against `docs/design/workout-builder.md` v2 (BD6–BD20, §8.2–§8.8, WB26, WB-L1–L13, WB-Q1–Q11, WB-P1–P8), ADR 0025 amendment 1, CLAUDE.md rules 1–10 and the minimal-copy convention. I also checked it against Ben's 14 Oct ask: "it gave me 4 sets on 90kg for 6–8 with no reason why".

## Checks run

| Check | Result |
|---|---|
| Merge of main | Already committed (5eda2a5). There are no conflict markers. Every line main added to `workout-builder.md` and `CHANGELOG.md` since the merge base is still present: the §8.2 `propose_workout` 13 Oct amendment, §8.2a, and main's CHANGELOG entries |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | pass: 321 files, 6551 tests, 1 todo |
| `npm run check:migrations` | pass: 1 to 18. Migration 0018 keeps all of 0017's `coach_actions` kinds, adds `build_question`, and keeps the 4 indexes and the no-delete trigger |

I ran throwaway probes against `checkProposedLoad`, `recheckDraftLoad`, `draftReasonLine` and `loadWhyEntry`. They were deleted afterwards and not committed. They back findings B1–B4 below.

## What's good

- `checkProposedLoad` is pure and runs the steps in order: convention and unit, then pain, then the bands, then the equipment. Clamped, held, est. and step-bounded loads snap toward easier through `loadDirection`. In the probes, 32 kg assist goes to 35, never 30. Every path goes through `roundToAvailableLoad` on the mapped item, so a load can't pass a machine max (rule 4).
- A rejected or missing load falls back to the built-in rule (`substituteTargets`, which reads pain flags and session pain). A swapped-in substitute never inherits the coach's load (BD9).
- Pain holds use the **most recent** comparable session, not the heaviest, including when FitNotes history is older and heavier. With no history, the load is `none`. Session pain is passed both at build time and at plan time.
- The draft stores checked loads with `checkedOn`. `recheckDraftSlot` sends a slot back to the rule on a change of kind, convention or bar, so WB-L6b's "60 kg total" can never become "60 kg each". One source per exercise.
- `ask_build_question` is withheld once 2 questions have been asked, after Skip, and in a draft revision. The turn stops after a recorded question. Retries are idempotent on opId. `checkBuildQuestion` checks the text whatever the topic says. Main-lift answers are catalogue IDs from the `doable` list, which already excludes pain-flagged exercises.
- Profile saves from a tapped chip only write a day's main lift when Ben hasn't chosen one. Undo is versioned (WB-Q10 and WB-Q11 are tested).
- The head note and reason lines are values, not prose. The preview key includes the newest finished workout. No new logging of health data.

---

## Blocking

### B1. A coach basis can invent a history set, and the reason line shows it as fact (rule 6, WB-L9)

`packages/domain/src/session/builder-loads.ts:610-612` and `:627-641` (`basisNumbers`).

`allowed` includes the proposal's own value (`p.value`), so any number equal to the proposed load passes `checkBasis`, including inside a `load×reps` pair.

**Probe:** on the WB-L1 fixture (bench, last 100×7 @8), the coach proposes 110 kg with basis `last 110×6 @8`. The result is `basisFromCoach: true` and `basis: "last 110×6 @8"`, and the load is clamped to 107.5. A second probe proposed 104 kg with basis `last 104×8 @7`, which is also accepted. `draftReasonLine` then prints `last 110×6 @8` under the row. Ben never lifted 110×6. This is exactly the "no invented numbers" failure that WB-L9 exists to catch. The existing test only covers a 110×5 basis when the proposal is 102.5.

**Fix:** parse `A×B` (and `A kg × B`, `A x B`) pairs, and accept a pair only if `(A, B)` is a reference set's `(value, reps)`. Allow the proposal's value only on its own (after `→`, or as the bare target), never as the load of a cited set. Add tests for both probes.

### B2. A clamped load keeps the coach's basis, so the reason line contradicts the target (honest reasons; Ben's 14 Oct ask)

`builder-loads.ts:610-613`, `packages/domain/src/session/coach-draft.ts:809`, `packages/domain/src/session/builder-reasons.ts:71-75`.

**Probe:** a proposal of 120 kg with basis `last 3: 100×7 @8 → 120` gives a load of 107.5. The basis is kept as the coach's (`basisFromCoach: true`), and the cap note goes only into `guardNotes`. The row then reads **107.5 kg** with the line `last 3: 100×7 @8 → 120` under it. The same happens on a hold (`held · last … → 102.5` under 100 kg) and on a snap.

Ben's complaint was about not knowing why. A line naming a different number from the target is worse than no line.

**Fix:** when the final value differs from the proposal, the reason line must end with the final value. Either use code's basis plus a short `capped` / `held` word, or rewrite the coach's `→ N` to the final value and keep the original under `Why?` → `NOT USED`/notes. Add a test where the reason line's number equals the row's target after a clamp, a hold and a snap.

### B3. Step-bound clamps on assisted and added loads are labelled `HELD` (pain), with no pain present (rule 9 honesty)

`builder-reasons.ts:72` and `:121-122` (`guardNotes.some((n) => n.startsWith('held'))`), and `builder-loads.ts:530` (note text `held at 25 assist · one step from last 30`).

**Probe:** an assisted pull-up with last 30 kg assist, a proposal of 5 kg assist and no pain gives `held: false`. But `draftReasonLine` returns `held · last 30×8 @8`, and `loadWhyEntry` returns `label: 'HELD'`. On the overview and in `Why?`, `HELD` means a pain hold (§4.4, OV7). Ben would read it as a pain flag he never set. Weighted pull-ups and dips get the same wrong label (`held at +21.25 …`).

**Fix:** carry the check's `held` boolean in provenance (for example `heldForPain: true`) and use that, not a prefix match on note text. Reword the step note (for example `25 assist · one step from last 30`). See Spec issues.

### B4. A draft built during a workout is never re-checked against that workout (rule 3 guard, BD4, BD14, WB-L12)

`builder-loads.ts:717-718`. `checkedHistoryVersion` is written at `coach-draft.ts:517` and never read anywhere.

`recheckDraftLoad` treats a session as newer only if `performedAtUtc > builtAtUtc`, and `performedAtUtc` is the session's **start** time (`packages/domain/src/history.ts:69`). BD14 lets Ben build from Today's sheet during a workout. The build context reads only finished sessions, so the active workout isn't a reference either.

**Probe:** a bench session started 1 h ago is logged as 100×5 @10. The draft was built 30 min ago with 102.5. The recheck returns 102.5 with no notes. Next day, the overview and Start both plan 102.5 kg, even though his newest bench was an RPE 10 rep miss. Preview equals Start here, because the preview key changes but the recheck ignores the session.

**Fix:** compare `refsNow.historyVersion` (or the set of session IDs) with the slot's stored `checkedHistoryVersion`. Treat any comparable session absent at build time as newer, whatever its start time. Add a test for the session-started-before-build case.

---

## Should fix

### S1. The coach and the checker see different references (§8.5 "the model and the checker read the same `loadReferences`"; WB-L5c)

`apps/mobile/src/coach/coach-service.ts:936-962` vs `:1030`.

The context (`loadViews`) is built from a 180-day `listFinishedBetween` window, while `checkContext` swaps in full history (`fullHistory`) before checking. For a lift whose own history is all older than 180 days:
- the coach is sent `firstTimeMax` (because `base.all` is empty, so there's no personal ratio);
- the checker then bounds the load by `E_pr` from the full history.

The coach never sees the ratio that WB-L5c says the context lists, and its basis can't cite it. **Fix:** build the context's references from the same full history (or load full history for the referenced exercises up front). Add a test that the context lists the ratio.

### S2. Free-text builds ignore the Profile session length (BD11, WB-P7)

`coach-service.ts:900`: `minutes = chips?.minutes ?? words ?? parent?.fitMinutes ?? resolveBuildMinutes(null, null)`, which gives 60.

Profile length is read only by the Build card chips (`training-service.ts:162`). "Build me a chest workout" typed in chat with Profile length 45 builds a 60-minute draft, while the same turn's `KNOWN` block tells the coach "usual length 45". **Fix:** pass `known.sessionMinutes` (or the training profile's `sessionMinutes`) into `resolveBuildMinutes`, and test it.

### S3. `est.` isn't shown everywhere WB-L5 requires, and the row panel `LOAD` line is missing (§4.4, rule 6)

`est.` appears only on the overview row (`apps/mobile/src/ui/overview.tsx`) and in `Why?` ("From a coach workout · … · est.", `target-why.ts:184`). The active set card target line and its VoiceOver don't show it.

The §4.4 panel line (`LOAD 102.5 kg · Why?`, `· est.`, `· Rule`, `— · start light`, `· HELD`) isn't implemented. **Fix:** add the `SourceTag` `est.` to the set card target line and its VoiceOver label, and add the panel `LOAD` line.

### S4. The `Why this workout` sheet drops some facts and states one that may be false (WB-L9, rule 6)

- `LoadWhyEntry` (`builder-reasons.ts:108-126`) has no `notUsed`, so a rejected coach basis is never listed under `NOT USED`, which WB-L9 requires.
- Plan-time fallback notes (`planCoachDraft`'s `ruleNotes`, for example `different equipment here · rule used`, `capped at 95 · newer session …`) don't reach `Why?`. `draftExplain` reads only the build-time stored notes (`workout-services.ts:1705`).
- `USED` always prints `Logged and FitNotes history` (`apps/mobile/src/coach/build-view.ts:183`), even when Ben has never imported anything. Show `FitNotes` only when a FitNotes reference was actually used.

### S5. Parts of the v2 spec are not built and not recorded as deferred

These aren't built:
- BD12: Save to Workouts doesn't write the draft's re-checked loads as coach next-session targets, so the S6 workaround stays.
- BD20: there's no goal card. The training profile on main now has `goal` and `goalSetAtUtc`, so §8.8 P1 is partly met.
- `YOU ANSWERED`, `knownHash` and `loadChecks` on `WorkoutDraftVersion` are missing.
- The `build_requests` record is missing. The question count is derived from the thread instead, which works, but answers aren't stored with the draft.
- The `previewKey` uses the newest finished workout overall rather than `historyVersion` of the draft's exercises. That's acceptable, but it's a deviation from the spec.

**Fix:** build them, or record each as deferred in the design (§8.8) and the CHANGELOG so Ben sees the gap.

### S6. Known training-profile details aren't protected from questions

`packages/domain/src/session/builder-questions.ts:11-12` claims `knownPreferences` covers experience, age, gender, height and bodyweight. It doesn't (`:47-58`), and `checkBuildQuestion` has no text check for them.

An `other` question such as "How long have you been lifting?" is caught by the length regex, but "Are you a beginner or experienced?" and "What do you weigh?" pass even when the profile has them. The brief's task asked for known preferences to include these profile fields. **Fix:** add the profile fields to `KNOWN`, refuse questions on them with the known value, and test it.

### S7. `Saved to Profile · Undo` lives only in component state

`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:89`.

Close and reopen the sheet, and the card no longer shows the save or its Undo, although the Profile change persists. §6.2 and WB-Q9 expect the card to survive a reopen. **Fix:** derive it from the profile's main-lift source and version, or store the save on the question record.

### S8. Test gaps

There are no tests for the B1–B4 cases. These acceptance checks are also untested: WB-P4 (main lift pain-flagged: not used as main), WB-P5/P6 (goal), WB-P7 (length default), WB-Q6 (typed "bench, under 40 min" sets the fit to 40), WB-Q7 (no question cards when everything is known), WB-Q9 offline chip tap (nothing saved, `Needs the coach`), and WB-L5c's context listing.

---

## Nits

- N1. `checkBasis` accepts any number within 0.51 of a rounded allowed value (`builder-loads.ts:662`), so `100.5` passes from 100 and `8.5` from 8. Use 0.051 only, plus the plate-rounded value.
- N2. `buildQuestionChain` (`packages/coach/src/build-ask.ts`) treats a question older than 12 h as still open. Ben's next unrelated message is then read as its answer, while the card says `Not answered`. Apply the same TTL there.
- N3. The build reads session pain from check-ins in the last 12 h (`coach-service.ts:938`). The overview reads today's check-in. These can disagree near midnight or for long days.
- N4. `draftExplain` scans 120 days of sessions and awaits `exerciseById` one at a time on every overview load. Cache it, or reuse the build's `recentSplits`.
- N5. On a stack or plate-loaded machine, app history older than 180 days makes `own` null, and in-window FitNotes `est.` references are ignored (`builder-loads.ts:239`).
- N6. The 225 lb case snaps to the nearest load: 102.06 becomes 102.5, which is harder. The spec allows this, but a converted value is effectively an approximate load, and snapping it toward easier would be more consistent with BD6.

---

## Spec issues

1. **Ben's 14 Oct reason-line ask isn't recorded.** `workout-builder.md` §4.4 still says "No per-row coach text, no explanation lines" and "The `Rule` tag appears in the panel only". The branch now shows `Rule · last 85×8` under the row, plus a head note. Add a CHANGELOG entry and update §4.4, §4.5 and §7 with the reason-line and head-note format, so reviewers and later work don't flag it as a violation.
2. **The WB-L11 note wording `held at 25 assist · one step from last 30` collides with the `HELD` (pain) label.** It caused B3. Use a different word for step bounds.
3. **The §8.5 / §7 basis rule needs tightening.** "The proposal's value" is allowed as a citable number, so a fabricated `proposal×reps` set passes. The spec should say that a `load×reps` pair must match a reference set.
4. **§8.8 P1 is now partly met.** The training profile on main has `goal`, `goalSetAtUtc`, `sessionMinutes` and `mainLifts`, but not `goalConfirmedAt` or `goalCheckWeeks`. The spec should say whether BD20 and the 45-minute default are in scope now.
5. **§8.5 bounds are still unapproved.** All the numbers (0.5 / 1.05 / 1.10 / 1.25, the 25% ceiling, ×0.5, ±steps, 180 / 28 days) are still the designer's proposal, pending training-researcher evidence and Ben's approval (§11.3). The code ships them in one constant (`BUILDER_LOAD_BOUNDS`), which is the right shape, but Ben should approve them before a real workout uses coach loads.
