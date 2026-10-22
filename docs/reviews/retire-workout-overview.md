# Review: retire WorkoutOverview (Ben, 22 Oct 2026)

**Verdict: CHANGES NEEDED** (final re-review 22 Oct 2026, after 81c77e2, 247a215, bac61da: R2–R5 fixed; R1 fixed for Ben's edits but a coach load change still collapses a saved range, F1 below)

Scope: `216a402..847729b` on `claude/gracious-knuth-joxqpw` (84d5ea1, cb342fc, 77f16ef, df0ef78, 847729b).
Checked against `docs/design/workout-builder-v3.md` §2.1, §2.3, §3.1, §7, the CLAUDE.md product rules, and the parity audit in the task.

## Checks I ran

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` (default heap) | **crashes: JavaScript heap out of memory, exit 134** |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run lint` | exit 0 |
| `npx vitest run` | 466 files, 8701 passed, 2 todo |
| Reviewer probe (temporary test on real SQLite, deleted afterwards) | Reproduced B1 and B2 below |

The route, screen, type, `EditorFrom 'WorkoutOverview'`, and every `navigate('WorkoutOverview', …)` call are gone. Every entry point in the audit now opens `BuilderWorkout` with an `open` target. No deep link, notification, or Live Activity referenced the route. Start goes through `workout.start` → `coachDraftStart`, with the op-ID replay and the builder-version fence, so it is idempotent.

## Blocking

### B1. Library workouts and "do again" open as a different workout from the saved one (Ben didn't decide this)
`apps/mobile/src/builder/builder-service.ts:1013`, `:1019`; `packages/domain/src/builder/scope.ts:57-92`

`specsFromWorkout` and `specsFromSession` keep only the exercise, order, working-set count, pair, and main flag. Everything else in Ben's saved workout is thrown away and rebuilt by the builder's §3.1 rules:
- saved reps and set types
- Fixed loads
- `progressionRuleId` (his own rule; the env calls `nextTargetsFor` with `rule: null`)
- preferred `equipmentId`
- rest overrides
- timed sets

Cardio and distance exercises are dropped, and nothing on the page says so.

My probe on real SQLite logged a workout of 5 × 5 back squat at 100 kg plus lateral raise 2 × 20 at 8 kg, then saved it as "Five by five". The saved routine has 5 working sets of 3–6 reps. Your workout opens it as:
- squat: 4 warm-ups, **top 100 × 6, then 4 back-offs of 95 × 8**
- lateral raise: 2 × 18 at 7.5

Start would create that session. The overview's `routineStart` would have planned his 5 × (3–6) from the routine's own next targets.

Why it matters:
- It is a silent change to Ben's own data and programme. CLAUDE.md rule 3 says "Ben's own rule keeps its range", and §3.1 says the same.
- Ben's 22 Oct decision listed exactly four overview-only things to drop (gym picker, done-by, arrows, "after Pull A" header). It did not cover dropping the saved structure of library workouts.
- The developer's report flags this as a "behaviour change you should know about". That is a product decision Ben hasn't made, and it shouldn't ship before he does.

Fix (pick one, Ben decides):
- (a) Open non-plan library workouts and past sessions from their stored set templates (reps, set types, Fixed loads, own progression rule, duration and distance sets). Snap loads to the gym (rule 4). This needs builder slots that can carry those, or a non-builder slot kind.
- (b) Keep the builder's rules, but get Ben's explicit approval first and record it in `docs/brief/CHANGELOG.md`. At minimum, show a minimal honest line for anything left out (`1 left out`, with Why? naming the cardio row), as the overview's `leftOut` did.

Tests to add: open a routine with fixed loads, a custom rep range, a drop set, a timed set, and a cardio exercise. Assert what opens and what Start creates.

### B2. A chat draft revised after it was opened still opens and starts the old version, and the new version is marked Started
`apps/mobile/src/builder/builder-service.ts:806-812` (`openFrom` resumes any open draft for the key), `:1021-1034`; `packages/persistence/src/workout-drafts.ts:174-181`, `packages/persistence/src/sessions.ts:541`

`openFrom` returns the existing builder draft for `{from: coach_draft, id}` without checking which chat-draft version it was built from. `startChatSourceIn` then starts the chat draft with no version fence.

Probe, step by step:
1. The coach builds Push (Bench press, Lateral raise), and Ben taps Open.
2. Ben asks for "no bench today, triceps instead". The coach revises the draft to v2 (`− Bench press`, `+ Triceps pushdown`), and the card shows v2.
3. Ben taps Open again. The same builder draft opens, still showing **Bench press, Lateral raise**.
4. Start succeeds with bench, and the chat draft reads `status: started, currentVersion: 2`.

This breaks rule 5 (stale content is applied over newer state, and a version is marked as done when it wasn't), and it breaks honesty: the card says Started for a workout he didn't do.

Fix:
- Store the chat draft's `versionN` in the builder draft, for example as `from.version` or in the setup.
- On open, if the chat draft's `currentVersion` is newer, then:
  - if the builder draft has no edits, rebuild it silently from the new version;
  - otherwise show the §2.3 "changed elsewhere · Reload" line with Undo.
- In `startChatSourceIn`, pass the expected chat version and refuse the start (stale) on a mismatch, inside the same transaction.
- Add a test with exactly the probe sequence.

### B3. The coach's "next workout" Apply now lands nowhere, and the card still says it applied
`apps/mobile/src/services/app-services.ts:699-737`, called only from `overview.load` at `:753`; tool still registered in `packages/coach/src/registry.ts:262`

`propose_next_workout_change` is still offered to the model in general, workout, and summary turns. Apply writes the change into the overview's today-edits draft, which only `overview.load` read, and no screen calls that any more. Your workout (builder drafts) and Today's one-tap Start never read it.

Failure: after Pull A, Ben says "swap rows for pull-downs next time". The card shows before/after, he taps Apply and sees it applied with Undo. Next time he opens Pull A from the Library or Starts from Today, rows are still there.

This is a proposal with Apply that silently does nothing (rules 1, 2, and 3). The developer lists it as a "feature lost". It can't just be lost while the coach keeps offering it and the card keeps claiming it worked. The tests (`coach-structural.test.ts:178`, `coach-structural-library.test.ts`) still pass only because they drive the retired path through the test-only `overview-driver.ts`.

Fix:
- Either apply structural changes to the builder draft for that target when it opens (as `applyCoachChanges` did, using the builder's edit ops with Undo),
- or stop offering `propose_next_workout_change` (registry and claims) until that's built, and tell Ben.

Either way, move the tests off `overview-driver.ts` onto `builder.openTarget` and `builder.start`.

### B4. `npm run lint` (and so `npm run check` in CI) runs out of memory at the default heap
`package.json:15`; `.github/workflows/ios-ipa.yml` runs `npm run check` with no `NODE_OPTIONS`

On this machine the default-heap lint dies at about 2 GB (exit 134). The developer saw the same and only got a pass with 8 GB. The `.ipa` workflow's Check job would fail the same way, so Ben gets no build.

This may predate the slice (lint already failed at 216a402 on a parse error, so nobody would have noticed). It still blocks shipping this slice to the iPhone.

Fix: set the heap in the script (for example `node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js .`) or in the workflow env, and confirm on a runner. Better, find the cause (type-aware lint over `docs/` or the tests) and narrow `parserOptions.project`.

## Should fix (not blocking on their own)

**S1. ⋯ Save to Workouts can save a chat draft twice.**
`builder-service.ts:615`, `workout-services.ts:savedDraftIdOf`.
Opened from a chat draft, `canSave` is true even if that chat draft was already saved (`routineId` linked). The save links to the builder draft's ID, not the chat draft's, so the `already_saved` guard (review r2 S2) never fires and a second identical workout is created.
Fix: for `from.kind === 'coach_draft'`, check and link the chat draft, or hide Save when the chat draft's current version is already saved.

**S2. `noteStartFrom` is written before the start can fail.**
`workout-services.ts:2690-2696`.
It runs before `coachDraftStart`, so a stale, active or not-found start leaves a "started from" note for an op ID that created nothing.
Fix: write it after `r.ok`, or inside the start transaction.

**S3. Back label is `‹ Back` from the coach sheet and Exercise detail.**
`CoachSheetScreen.tsx:421,426`, `ExerciseInfoScreen.tsx:221`.
Spec §2.3 names only `‹ Today` / `‹ Library`.
This is minor. Either update the spec to allow `‹ Back`, or pass the real origin.

**S4. Chat build opens Your workout, not Set up.**
Spec §2.1 and §7 say "chat build fills Set up". The adopt-the-chat-draft route is a reasonable call, but it's undocumented. See Spec issues.

**S5. Missing tests:**
- force-close between `openTarget` and the first edit, then relaunch (resume by key with a new op ID)
- two quick opens of the same target (two screens, two op IDs: the same draft)
- a target opened before midnight and reopened after (it becomes an "Edits from" draft)
- `active` → `popToToday` on the screen
- a pain-flagged exercise in a library workout opened via `openTarget` (rule 9 hold)
- a gym with a machine max lower than the routine's history (rule 4 cap via `openFrom`)

The new screen checks in `builder-screens.test.ts` are source-text greps. They prove the call site exists, not that it works.

## Nits

- **N1.** Developer report says "Nothing called the `next` target"; `openTarget({kind:'next'})` passes `'typical-gym-preview'` when there's no gym (`app-services.ts`). That's fine, but it's untested with no gym.
- **N2.** `BuilderWorkoutScreen` with neither `draftId` nor `open` renders a blank page with no back control (`back` undefined). No caller does this today. A guard would be cheap.
- **N3.** `CheckIn mode:'overview'`, `services.overview`, `overview-driver.ts`, and `session-picker-driver.ts` keep the retired name and a dead service path alive. That's acknowledged as a follow-up slice; track it so B3-style dead paths don't hide behind test drivers.

## Spec issues

1. **Spec and brief not updated for Ben's 22 Oct decision.**
   - `workout-builder-v3.md` §2.1 still says Your workout replaces the overview "for plan days" (pending Q1), and §7 still lists `workout-overview.md` as superseded only for plan days.
   - `workout-overview.md`, `overview-today-edits.md`, and `session-picker.md` have no superseded banner.
   - There's no `docs/brief/CHANGELOG.md` entry, and no ADR for the change in how library workouts are planned. CLAUDE.md requires both for approved changes.
2. **Chat build entry point conflicts with the spec.** §2.1 and §7 say "chat build fills Set up". The code opens the coach's checked draft on Your workout. Ben should pick one, and the spec should say which.
3. **The spec doesn't say what a non-plan library workout looks like on Your workout.** §3.1's load sources and §3.1 step 9's defaults (main lift = 1 top + back-offs) are written for builder-made workouts. Applying them to Ben's saved workouts (B1) is a spec gap, not just a code choice. Ben needs to decide whether saved workouts keep their own reps, set types and rule.
4. **No home for the feature losses (class d).** Coach fit-to-time, "Change <workout> too" for library workouts, session switch from the title, and the per-row How to / History / Still hurts / Edit gym links have no home in v3. Ben should confirm the drops. B3 (structural coach changes) can't simply be dropped while the tool remains.

## Fixes (developer, 22 Oct 2026)

I checked each claim in the code before changing anything. Commits are on `claude/gracious-knuth-joxqpw`.

| Issue | Confirmed? | What changed |
|---|---|---|
| B1: library and past workouts rebuilt by §3.1 | Yes | They now open from the overview's own planner, dry run at the draft's gym (`builderSources.planned` → `plannedAsDraftPlan`, `packages/domain/src/builder/from-planned.ts`). Saved set types, reps, target RPE, Fixed loads, the workout's own rule's next targets, the preferred item and Ben's own rests are kept, and loads are already rounded to the gym (rule 4) and held on pain (rule 9). Rows the builder can't hold (cardio, timed or distance sets, a second copy of an exercise, anything past the builder's limits) are listed as `N left out` with Why? naming them. A workout made only of those reads `Can’t open this workout here yet.`, not `wasn't found`. `Why this weight?` names a saved load `Saved workout` (new slot source `saved`). The reviewer's probe is now a test: 5 × 5 squat opens as 5 working sets, Start creates exactly that. |
| B2 / high (chat draft revised after open) | Yes | The builder draft stores the version it was opened on (`BuilderSetup.sourceVersion`). Reopening a draft with no edits reloads it silently. With edits, the existing `… changed · Reload` line shows (Reload has Undo). Start is refused as stale inside the start transaction when the chat draft's current version isn't the opened one (`chatSourceStaleIn`), so v2/v3 is never marked Started with v1's content. |
| High (library workout edited after open) | Yes | Same mechanism, against `routine.version`. A past workout uses `session.version`. |
| B3: next-workout Apply lands nowhere | Yes | `propose_next_workout_change` is withheld: its executor isn't registered, so the turn reports it `not_in_build`. An older card reads `Out of date` and its Apply is refused. `get_substitutions` stays. The app-level tests that drove the retired overview path (`coach-structural*.test.ts`) are replaced by tests on `builder.openTarget` showing the tool isn't offered and nothing changes. Domain and coach unit tests for the structural checks are unchanged. **Open for Ben:** rebuild it on Your workout (apply on open, with Undo) or drop it. |
| B4 / low: lint OOM | Yes (it predates this slice) | `npm run lint` now runs eslint with a 5 GB heap. Measured here: about 3.6 GB peak, exit 0 at 4 GB in 282 s. Not yet confirmed on a GitHub runner. A private-repo ubuntu runner has 7 GB, so this should fit, but it needs one `[ios-build]` push to prove. |
| S1: chat draft saved twice | Yes | Your workout hides `⋯ Save to Workouts` when the chat draft's current version is already saved, and `saveFrom` on that builder draft returns `already_saved`. Not fixed: saving from the builder first and then from the chat card still makes two, because the routine is linked to the builder draft. |
| S2: start-from note before a failed start | Claim confirmed, no change | This is by design (`persistence/src/coach.ts` `noteStartFrom`): the note counts only while a session with that op ID exists, so a refused start leaves it inert. Writing it after the start would let a force-close between the two leave the coach's targets unused, so they would be applied a second time. I added a comment at the call site. |
| S3: `‹ Back` label | Yes | No change. From the coach sheet and Exercise detail there is no Today or Library to name, so `‹ Back` is the honest label. Spec §2.3 should allow it (designer/Ben). |
| S5: missing tests | Partly | Added (`apps/mobile/test/builder-open-sources.test.ts`): two quick opens with two op IDs give one draft; a force-close then relaunch resumes it; before and after midnight gives a fresh draft with `Edits from`; a pain flag holds the load and marks `May hurt`; Fixed loads; timed, cardio and duplicate rows. Not added: a machine-max case through `openTarget` (loads come from the same planner and snap that are tested for max already), and an on-screen `active` → Today test (screen tests here are source-level only). |
| Medium: cardio-only workout dead end, wrong message | Yes | It now reads `Can’t open this workout here yet.` It is still a dead end: Your workout can't hold cardio or timed sets yet (open for Ben, see below). |
| Medium: exercise listed twice silently cut | Yes | The second copy is now named in `N left out`, not dropped silently. Holding it needs the builder to allow one exercise in two slots (open). |
| Low: old plan's routine opens the current plan's day | Yes | A routine opens as a plan day only when its plan is the plan in use. Otherwise it opens as a library workout. No test yet. |
| Info: leftover names | — | `CheckIn mode:'overview'`, `services.overview` and `overview-driver.ts` are still there (cardio tests import `repsDraftOf` from the driver). Clean-up is a follow-up slice. |
| Spec (1) | Yes | Added the CHANGELOG entry for 22 Oct and superseded banners on `workout-overview.md`, `overview-today-edits.md` and `session-picker.md`. Updated `workout-builder-v3.md` §2.1 and §7 to say "every pre-start entry". No ADR: no stack or architecture change. |
| Spec (2)–(4) | — | Left for Ben, noted in the spec and CHANGELOG: chat `Open ›` goes to Your workout, not Set up; how saved workouts are planned (built here as the overview did, pending his confirmation); the dropped class-d features. |

Still open for Ben:
1. B1 as built keeps saved workouts as the overview planned them. Confirm, or choose the builder's rules.
2. B3: rebuild the next-workout proposal on Your workout, or drop it.
3. Cardio, timed and distance sets, and one exercise twice, on Your workout. Until then they show as `left out`.
4. Chat `Open ›`: Your workout (as built) or Set up (as specced).

## Re-review (reviewer, 22 Oct 2026)

Scope: `847729b..0a356e4` (62b1202, a1af70e, c7a4750, 0a356e4).

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` (default env; the script now sets a 5 GB heap) | exit 0 |
| `npx vitest run` | 467 files, 8705 passed, 2 todo, exit 0 |
| Reviewer probe (temporary test on real SQLite, deleted afterwards) | Reproduced R1 below |

Verified as fixed:
- **B2 / high (stale source):** `sourceVersion` is stored on open. A source that changed reloads silently when there are no edits, and shows `… changed · Reload` with Undo when there are. `chatSourceStaleIn` (`packages/persistence/src/workout-drafts.ts:180`) refuses a stale chat start inside the start transaction, before `startWorkoutDraftIn` and `startChatSourceIn`. On `stale`, the screen reloads and shows the Reload line. The test covers v1, v2 and v3.
- **B3:** `propose_next_workout_change` is withheld (`not_in_build`), an unapplied card reads Out of date, and Apply is refused. The tests now use `builder.openTarget`.
- **B4:** `npm run lint` passes at the default env. A GitHub runner still needs to confirm it.
- **S1:** the Save to Workouts entry is hidden, and `saveFrom` refuses when the chat draft is already saved. The reverse order is still open (see R4).
- **Old plan's routine:** it opens as a library workout unless its plan is `planInUse`.
- **S2:** I accept the developer's reasoning. `noteStartFrom` is inert without a session that has that op ID (`packages/persistence/src/coach.ts:909-920`).

### Blocking

**R1. Saved rep ranges are shown as their minimum, and any edit turns them into fixed reps at Start (B1 is only partly fixed).**
`packages/domain/src/builder/codec.ts:126` (`reps: t.reps?.min ?? 1`), `:77` (`reps: { min: row.reps, max: row.reps }`), `apps/mobile/src/builder/builder-view.ts:351`.
`plannedAsDraftPlan` keeps the planner's `{min:3,max:6}` in the set templates, but Your workout's rows hold one rep number. The page shows `3`. The first edit of any kind re-encodes every slot through `toDraftPlan`, so Start then logs `{3,3}`.
Probe: log back squat 5 × 5 @ 100 kg and lateral raise 2 × 20 @ 8 kg, then save as `Five`. The routine is 5 × (3–6), and `routines.planned` gives 5 × (3–6) @ 100. Open it from Library: the rows read `100 × 3` five times. Add one set to lateral raise, then Start: the session's squat sets are planned `{min:3,max:3}` @ 100.
This is not the workout Ben saved. It also feeds progression: a range-based rule sees 3 reps as the top of the range. The B1 test checks only set types and loads, not reps.
Fix: carry a per-row rep range, or at least `repsMax`, through `BuilderSetRow` and the codec for slots from `plannedAsDraftPlan`. Show `3–6` on the row. Add the reps check to the B1 test, with an edit before Start.

### Should fix

- **R2. `Gym changed` on a library or past workout rebuilds its loads with the builder's §3.1 rules** (`builder-service.ts:1182` → `reloadSlotLoads`). Fixed loads and the workout's own rule targets are replaced by the builder's calculation. Fix: for a draft with `builderKey.from` of kind routine or session, re-run `sourcePlanOf` at the new gym, keeping Ben's edits as in Reload.
- **R3. Held and capped loads lose their reason.** `from-planned.ts:127-128` writes `held: false, notes: []`, and the planner's `provenance.held` and `snap` are dropped. `Why this weight?` says `Saved workout` for a load the planner held on pain or capped at a machine's max (rules 4, 6, 9 honesty). A load from Ben's own progression rule is explained with the built-in rule's line (`ruleLine`).
- **R4. S1 in reverse is still open.** Save from Your workout first, then save from the chat card, and you get two identical workouts (the developer acknowledged this).
- **R5. Tests still missing:** machine max through `openTarget`, an old plan's routine, and `Gym changed` on a saved workout. Screen tests are still source greps.

### Nits

- `workout-drafts.ts:170-189`: `startChatSourceIn`'s doc comment now sits above `chatSourceStaleIn`, so the two comments are stacked.
- `registry.ts:212` (`edit_today` description) and `request.ts:951` still point the model to `propose_next_workout_change`, which is withheld. The model is told to use a tool it doesn't have.
- `coach-service.ts:650` `basisChanged = true`: a card applied before this build still reads `Applied` (with Undo) although nothing applies it. This affects old data only.
- `‹ Back` from the coach sheet and Exercise detail: fine, but the spec (§2.3) should say so.

### Spec issues (still open for Ben)

The four decisions in the developer's list stand: saved workouts as planned vs builder rules; the next-workout change rebuilt or dropped; cardio, timed and duplicate rows on Your workout; and chat `Open ›` going to Your workout or Set up. R1 needs a design call too: Your workout has no way to show a rep range per row.

## Final re-review (22 Oct)

Scope: `20a15d8..bac61da` (81c77e2, 247a215, bac61da). fe5c67a (another agent's docs) is not reviewed here.

**Verdict: CHANGES NEEDED.** R2–R5 and the three nits are fixed. R1 is fixed for Ben's own edits, but a coach load change still collapses a saved rep range: the same failure by another route (F1). The fix is small.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| eslint (5 GB heap) on the 15 TS files changed since 20a15d8 | exit 0. Full lint and the full suite were not run (another process was running the suite). |
| `npx vitest run` builder-from-planned-review2, builder-open-sources, builder-review-fixes | 3 files, 41 passed |
| `npx vitest run` on 10 related files (coach-structural, builder-coach, builder-screens, coach-add-exercise, library-tab, today-v2-screen, coach registry/request/builder-coach-edits, persistence workout-drafts) | 615 passed |
| Reviewer probes (temporary tests, deleted) | F1 and O1 reproduced |

Verified fixed:
- **R1 (Ben's edits):** `repsMax` goes through the codec both ways (`codec.ts:81`, `:131`). The pop-up reads `3–6` and says "3 to 6 reps". Tapping into a range cell and out sends nothing (`exercise-popup.tsx:85-86`). A reps edit fixes only that set, and Add set copies the range. The probe test now edits, force-closes, relaunches and Starts, and the session plans the range. Chat drafts' ranges now survive edits too.
- **R2:** Gym changed on a library or past workout re-runs its own planner at the new gym (`builder-service.ts:1188-1207`). The replay check still runs first, and the planner call is a dry run.
- **R3:** the Why lines are its own rule's line, `Held · pain`, `Max here` and `Rounded down`. Reload and swap drop them.
- **R4:** the chat card reads saved, and its Save returns `already_saved` (`workout-services.ts:1883`).
- **R5:** tests added for the machine max through `openTarget`, a no-item fit, the pain-held Why, Gym changed on a saved workout, and an old plan's routine. Screen tests are still source greps (accepted).
- **Nits:** the doc comment order is fixed. `edit_today` no longer names the withheld tool. An applied card from before this build reads `Out of date` with no Undo.
- **Rules 2 and 5:** none of the three commits touch sessions or logged sets, and the draft writes stay op-ID and version fenced.
- **Leftover references:** no `'WorkoutOverview'` route, `WorkoutOverviewScreen`, navigation type or action remains in `apps/` or `packages/` (internal names: N1).

### Blocking

**F1. A coach load change still turns a saved rep range into fixed reps at Start.**
`packages/coach/src/builder/edit-ops.ts:143-150` (`withWorkingLoad`, called at `:308`, `:314`, `:346`). The rows are rebuilt as `{ type, reps, rpe, load }`, which drops `repsMax`.
- Probe: a bench slot of 5 × 3–6 @ 100, then the op `load heavier`. The only change line is `Barbell bench press: 100 → 102.5 kg`, and `toDraftPlan` writes `{min:3,max:3}` × 5.
- Failure: Ben opens his saved `Five` from the Library, Coach review suggests heavier squats, and he taps Apply. Start then plans 5 × 3, and the before/after never showed that (rules 2, 3).
- Why it matters: the planned reps feed the coach's rep-miss trigger and its next-session targets (`domain/src/coach/trigger.ts:163`, `next-session.ts:254`).
- Fix: build each row as `{ ...r, load }`, keeping `repsMax` and dropping `typed`/`roundedFrom`. Add a test: ranged slot, coach load op, encode, then assert `{3,6}`.

### Should fix

- **S1. After a coach load change, `Why this weight?` still shows the saved workout's reasons.** The same function keeps `slot.why`, so `whyWeight` (`builder-service.ts:1407-1408`) shows `Saved workout · Max here` for the coach's 102.5. `draftLoadOf` (`codec.ts:32-39`) also copies those notes into every set. Fix: delete `why` in `withWorkingLoad`, as `reloadSlotLoads` does.
- **S2. The coach is told a saved range is its minimum.** `packages/coach/src/builder/requests.ts:136,145` sends `5 × 3 @ 100 kg` for 5 × 3–6. The claim check (`builder/claims.ts:147`) only knows the 3, so a correct "3–6" reply gets flagged. Fix: render the range, and add `repsMax` to the claim facts.
- **S3. Gym changed on an edited saved-workout slot can mix loads from two items.** `from-planned.ts:231,240` and `builder-service.ts:1206`. An extra set, or a kept typed kg, is fitted to the builder's item, but the slot is pinned to the planner's item. If those items differ, Start re-snaps the load, so the page and Start disagree (Start itself stays within rule 4). Fix: when the items differ, use `base` for the whole slot.

### Nits

- **N1.** Internal leftovers: `WorkoutOverview`/`buildWorkoutOverview` (`domain/src/session/overview.ts:811,1007`); `services.overview` (`app-services.ts:749`, still used for `loadKeypad` at `BuilderWorkoutScreen.tsx:446` and `WorkoutEdits.tsx:457`); `CheckIn mode:'overview'` (`navigation/types.ts:164`); `test/workout-overview.test.ts` and `overview-driver.ts`. This is the tracked follow-up.
- **N2.** `fitPlannedSlotHere` (`from-planned.ts:268`) leaves a load in another convention unfitted, but still stamps the builder's item as `checkedOn`. This is rare.
- **N3.** `held` and the notes are written on warm-up sets too (`from-planned.ts:159-160`). Harmless.

### Outside this slice (not counted in the verdict)

**O1. Today's one-tap Start plans a no-item Fixed load past the machine's max (rule 4).**
- Probe on real SQLite: a pushdown saved with `equipmentId: null` and Fixed 400 kg. `routines.planned` and `workout.start({ routineOf })` (the path at `TodayScreen.tsx:365`) both plan 400 kg on the stack, with no item and no snap.
- 81c77e2 fits this only on Your workout.
- Fix: in the shared planner, in its own slice with a test.

Spec issues: unchanged. bac61da records saved rep ranges, the planned Why lines and `‹ Back` as [Proposal], pending Ben.

## Final fixes (developer, 22 Oct 2026)

Commit `407a7bf` on `claude/gracious-knuth-joxqpw`. O1 and N1–N3 are not touched.

| Issue | What changed | Test |
|---|---|---|
| F1: a coach load change collapses a saved range | `withWorkingLoad` (`packages/coach/src/builder/edit-ops.ts`) builds each row as `{ ...r, load }`, so `repsMax` is kept. It drops `typed` and `roundedFrom`, because the coach's load replaces a typed kg. The `reps`/`rpe` ops' held-load path uses the same function, so an RPE change keeps the range too. A reps op still fixes the reps, as Ben's own edit does (R1). | `builder-coach-edits.test.ts` › "a saved rep range through the coach": bench 5 × 3–6 @ 100, op `load heavier`. The only line is `Barbell bench press: 100 → 102.5 kg`, and `toDraftPlan` writes `{min:3,max:6}` × 5. A typed kg on the slot leaves no `typed` or `roundedFrom`. |
| S1: stale saved-workout reasons after a coach load | `withWorkingLoad` deletes `slot.why`, as `reloadSlotLoads` does. `whyWeight` then reads `Coach target` (source `coach_target`), and encoded sets carry no notes or `held`. | Same block, S1: `why` is undefined, `builder.why` isn't encoded, and every set has `notes: []` and `held: false`. A `sets` op that doesn't move the load keeps the reasons. |
| S2: the coach sees `5 × 3` for a 3–6 slot | `builderWorkoutView` renders `5 × 3–6 @ 100 kg` (fixed reps unchanged). `claimFacts` adds `repsMax` to the exercise's reps. In `claimSentenceOk` the top of a range now takes its bottom's kind, so in `5 × 3–6` the 6 is checked as reps. Before, it fell through to `bare` and was hidden even with the fact present. | Same block, S2: view text; `Bench press is 5 × 3–6 at 100 kg.`, `… 3–6 reps.` and `… 6 reps.` pass. `3–8` in either form is hidden. |
| S3: Gym changed mixes loads from two items | `slotAtNewGym` takes `sameItem`. An edited slot that would take any load from `base` (a kept typed kg, or a set the planner has no match for) returns `base` whole when the planner's item differs from the builder's. An edited slot whose loads all come from the planner keeps them. `changeGym` compares the planner's `checkedOn.equipmentId` with `env.codec.checkedOnOf` (`builder-service.ts`). | `builder-from-planned-review2.test.ts` › S3: an extra set and a kept typed kg on another item each give `{ slot: base, fromPlanned: false }`; reps-only edits keep the planner's 40 kg. The existing R1–R5 tests pass `sameItem: true`. No app-level test with two items for one exercise (pure function tested; the wiring is one comparison). |

Checks (this branch, after the fixes):

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` (full suite) | exit 0. 468 files, 8725 passed, 2 todo |

Open (not fixed here):
- The claim check reads `@` as RPE, so `Bench press is 4 × 6 @ 100 kg.` is hidden even for fixed reps, though the coach is shown that same `@ 100 kg` form. This predates this slice. The coach's prose usually says "at", so the impact is low. It needs its own change and test.
