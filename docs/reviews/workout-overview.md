VERDICT: CHANGES NEEDED

# Review: Workout overview (claude/workout-overview)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/workout-overview` (b198fc6..3aaa481, 5 commits, 28 files).
Checked against `docs/design/workout-overview.md` (OV1–OV17), `docs/design/mockups/workout-overview.html`,
`docs/design/check-in.md`, `docs/design/today.md`, CLAUDE.md rules 1–10 and the minimal-copy convention.

## Checks run

- `npm run check -- --testTimeout=120000`: **exit 0**. Typecheck, lint, 134 test files (1861 passed, 2 todo),
  catalogue validate, guide check and guide motion all pass.
- A throwaway service test (not committed) confirmed B1: after a score is recorded, a Start sent with the page's
  key from before that score returns `stale_preview`, even though the reloaded rows are identical.
- Navigation: React Navigation 7.6 `navigate('WorkoutOverview')` twice leaves a single overview on the stack, so a
  double tap on Today's Start doesn't stack two pages.

## What's good

- The page reads the **same dry run** Start uses (`overviewDryRun` → `routineStart` / `startFromSession` with
  `preview: true`). The tests compare every row with the session that Start creates (OV3), for both routine and
  next-session paths.
- Opening the page writes nothing (the record counts don't change). It makes no provider or network call (OV1, OV9).
- `previewKey` covers the routine, gym equipment versions, source revision, pain flags, unit and check-in. A stale
  key creates nothing, and a retry with an opId that already succeeded is a duplicate, never stale (OV4, OV5).
  A concurrent double Start yields one session (tested).
- Force-close: there's nothing to recover because nothing exists before Start. A tapped score survives a relaunch
  and is reused and linked (OV10, tested).
- Resume, the stale card and P6 auto-open never reach the overview. Routine rows are hidden while a workout is
  active (OV11).
- The check-in is asked once on this path. An ignored row → `skipped`. A score → `answered` and linked. A gate that
  is off or not a check-in day → `not_asked`. So the in-workout pending prompt can't fire again. Empty workout and
  Repeat keep the `CheckIn` sheet.
- No coach UI renders (OV8). HELD and NO LOAD carry an icon and a word. `LAST` and `BEST` are actual sets. Estimates
  carry `≈`. Markers are pure and well tested (OV6: order, kg↔lb, per-hand, assisted, cap, different bar).

---

## Blocking

### B1. Score then Start (the designed 4-tap flow) falsely says `Targets updated` and needs another tap

`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:157-180, 182-195`;
`apps/mobile/src/services/workout-services.ts:918, 1045-1051`.

The preview key includes the check-in (`checkIn: {id, version}`, line 918). `pickScore` saves the score, calls
`changed()` and returns. The page reloads asynchronously. `start()` then sends
`checkIn: {kind: 'answered', checkInId}` with `expectedPreviewKey: page.view.previewKey` from the page *as rendered*.
Until the reload lands, that key was computed with `checkIn: null`. `previewIsStale` recomputes the key with the
check-in, finds a mismatch and returns `stale_preview`.

Failure scenario: check-in due, Ben taps `4`, then `Start workout` straight away (§2.2, 4 taps). The reload is
`overview.load`, which runs the dry run plus `listFinishedWithExercise` for every exercise, so on a phone with
imported FitNotes history it can take a second or more. If Start comes first, nothing starts, the toast says
`Targets updated` and Ben has to tap Start again. The rows are unchanged, so the toast is untrue (rule 1/6 honesty),
and the flow costs 5 taps, not 4 (OV2/§2.2). I reproduced this against real SQLite: the result is `stale_preview` and
the reloaded rows are identical. The same race follows a `Done` in What's up?, because the check-in version bumps.

Fix (any one of these):
(a) Disable Start, or queue the tap, until the reload that includes the tapped check-in has landed. Track a
    `pendingReload` flag set in `pickScore` and cleared when `page.planCheckIn?.version` matches.
(b) Have `pickScore` await a fresh `overview.load` with the new `checkInId` and swap `page` before re-enabling Start.
(c) On `stale_preview`, compare the new rows with the old ones. If they're identical, start immediately with the new
    key (same opId) and show no toast.
Add a test: a score recorded after the page loaded, then Start with the old key. The expected result is that the UI
path starts the workout without a false `Targets updated`.

### B2. OV14 (large Dynamic Type) isn't met: fixed-size containers clip text, and the check-in row overflows below AX1

- `WorkoutOverviewScreen.tsx:323` sets the top bar to `height: 48`, and line 335 sets the gym chip to `height: 34`. The
  chip's `AppText variant="label"` scales to ×3 (`maxScale: 3`). At AX3 (≈×2.35) the label is about 38 pt in a
  34 pt box inside a 48 pt bar, so the gym name is clipped vertically, and a long name overruns `⋯`. Use
  `minHeight` for both, let the chip grow, and at stacked sizes put the chip on its own line under the bar or cap
  its scale.
- `ui/overview.tsx:136` puts the panel labels (`WARM-UP`, `ROUNDED`, `CHANGE`) in a `width: 80` box. With
  `sectionLabel` at ×3 they break mid-word from about AX1. Stack label over value when `stacked`.
- `WorkoutOverviewScreen.tsx:505` puts the inline check-in row in one line: the `CHECK-IN` label plus 5 × 50 pt
  tiles with 6 pt gaps, which is 274 pt fixed. On a 390 pt screen that leaves about 76 pt for the label, which is
  roughly what `CHECK-IN` needs at the default size. At xLarge through xxxLarge (font scale 1.12–1.35, below the
  1.6 `stacked` threshold), or on a 375 pt-wide phone at the default size, label plus tiles exceed the width. With
  RN's default `flexShrink: 0` the 5th tile is pushed off the edge or overlaps. Move the label above the tiles, or
  switch to the collapsed `Check-in ›` when `label + 274 > width`. Measure with `onLayout`, not only `fontScale`.
- The only DT test is `overviewLayout(1.65).stacked === true`. Nothing checks the chip, the panel or the check-in
  row. Add source or layout tests (for example, that no `height:` literal wraps scalable text in the overview), and
  run an on-device check at xxxLarge and AX3 on Ben's iPhone before PASS.

I estimated the widths and didn't measure them on a device, but the fixed `height: 34` / `height: 48` and
`width: 80` around ×3 text are certain to clip at AX3.

---

## Should fix

### S1. `Why?` ignores a reused check-in, so it can explain different targets from the row it opens on

`WorkoutOverviewScreen.tsx:311` sends `checkInId: tappedRef.current?.id`. `services.overview.explain`
(`workout-services.ts:1731`) plans with only that ID. `load` plans with `tapped ?? reused` (line 1672).
Scenario: Ben saved a check-in on Today with pain mentioned 30 min ago (reused, pre-selected). The row correctly shows
`⚠ HELD` at 60 kg. `Why?` re-plans with no check-in and explains a +2.5 kg progression. Fix: send
`page.planCheckIn?.id`, or have `explain` resolve the gate the same way `load` does. Add a test.

### S2. `Empty workout` from the overview (menu, and the load-failed state) can double-start and has no busy guard

`WorkoutOverviewScreen.tsx:243-270`: `startEmpty` mints `newUuid()` on every call and doesn't check or set `busy`.
Two taps on the load-failed `Empty workout` link give two `services.workout.start` calls with different opIds. One
creates the session. The other returns `session_already_active` and dispatches `popToToday()`, which can race
`openStartedWorkout()`, so Ben lands on Today with Resume instead of in the workout. Fix: one opId per page, held in
a ref like `startOp`, plus the `busy` guard. Today's `start()` already keys opIds per intent.

### S3. The stale check isn't in the start transaction

`workout-services.ts:970-990` and `app-services.ts:444-447`: `previewIsStale` reads, then
`routineStart` / `startFromSession` re-reads and writes in a separate step. Spec §7 says "re-plans inside the start
transaction". Today the only concurrent writer is Ben himself, so the window is small. When coach v1 lands, a late
D21 result (CA10) can land between the check and the write, and Start would create targets the page never showed
(rule 5). Fix: compute the key and the write in one `store.db.write`, or re-check the key from the same reads the
planner used. At minimum, add a TODO tied to coach v1 and an ADR note.

### S4. The row panel has no `History` action

`ui/overview.tsx:233-236` renders `Why?` and `How to` only. Spec §3.8 and the mockup both have `History` (Progress →
exercise). Add it, or record the deferral in the spec.

### S5. Up next on Today and the overview resolve Up next differently

`next.preview` (`workout-services.ts:1610-1628`) falls back to the last workout's next session when the rotation
routine's dry run fails (for example `nothing_to_start`). `resolveOverview` (line 887) doesn't, so the overview
returns null. Scenario: the rotation's next routine has no startable exercises. Today shows an Up next card, but
tapping Start shows `Couldn't load this workout.`. Share one resolver between Today and the overview, and add a test.

### S6. Missing tests for paths the task calls out

- No gym: `overview.start({gymId: null})` saves the typical gym and starts, and its rows equal the preview. There is
  no test, including the retry after a failed write and that `useTypicalGym` is reused.
- OV4 is tested for a routine rename and a pain flag only. There is no test for a gym-equipment edit, a check-in
  change (see B1), or a source-workout correction (revision bump).
- The `CheckIn` sheet in `mode: 'overview'`: every exit returns to the overview (Done, Skip, Not now, Flag, Train
  anyway), `Skip workout` goes to Today, and a 4–5 at AX size doesn't start. None of these is tested.
- The screen flow: one opId across a stale result and then a retry, the busy guard, and Start disabled while busy.
  These are covered only by pure helpers and source greps.

### S7. Double tap on a check-in tile drops the second score

`WorkoutOverviewScreen.tsx:157-171`: tiles are disabled only while Start is busy. Two quick taps both see
`row.record === null` and call `record` with the same `checkInId` and opId. The second write is a duplicate and
returns the first score. Scenario: Ben taps `4` and then corrects to `2` quickly. The tile shows 4 and What's up?
never opens. Add a `scoring` flag that disables the tiles while the write runs, or serialise the writes and apply
the last tap as an `update`.

---

## Nits

- N1. `CheckInScreen.tsx:250-262`: in AX `atScore` mode, a score tapped before `checkIns.get(existingId)` resolves
  records a second check-in, because `record` is still null. It's harmless (the newer one is reused) but leaves a
  stray record. Disable the scale until the existing record has loaded.
- N2. `gyms.select` has no opId (spec §6 says "versioned, op ID"). It's idempotent by state, which is fine, but say
  so in the spec.
- N3. `selectDefaultGym` (`gym-editor.ts`): with no default gym, `previousGymId` falls back to `live[0]`, which can be
  the chosen gym. Undo then re-selects the same gym, which is a no-op.
- N4. Copy that predates this slice but now shows on the overview path: the check-in Step 1 lead
  `Before your workout. Saved with it. Nothing changes unless you say so.` is a reassurance line (minimal-copy
  convention). The delete alert body `Past workouts keep their name.` explains a rule. Trim both when convenient.
- N5. `bestSet` (`packages/domain/src/session/overview.ts`) picks the highest kg. For an assisted machine, that's the
  *easiest* set. It's only used for the first barbell lift today, so there's no visible bug. Use `loadDirection`
  so it can't go wrong later.
- N6. A reused check-in that ages past 2 h while the page stays open is still sent as `answered`. Re-check the gate
  in Start, or accept this and note it in the spec.
- N7. `pickScore` silently does nothing when `record` fails. A short `⚠` line or toast would be more honest, and Start
  still works.

---

## Spec issues

1. **§7 `previewKey` input list omits the check-in.** The implementation correctly adds it, because a check-in that
   mentions pain holds loads, but the spec's flow (score → Start) then races the reload (B1). The spec should list
   the check-in as a key input and say that Start waits for the re-plan after a score, or that a stale result with
   identical rows starts silently.
2. **§3.9 sizes the check-in tiles for 390 pt only** (50 × 52 ×5 plus the label). It has no rule for narrower phones or
   for xLarge to xxxLarge text, and the AX collapse only begins at AX1. Add a width-based collapse rule.
   The §11 follow-up about 50 × 52 versus the sheet's 52 × 60 still needs a device check.
3. **§6 says gym selection is recorded with an op ID.** For a "select this gym" write, idempotency by state is
   enough. Relax the wording or say why an opId is needed.
4. **§3.8 lists `History`,** but §11.3 says the first slice shows "the facts, `How to`, `History` and `Why?`". Either
   build `History` (S4) or drop it from both places.

## Verdict

**CHANGES NEEDED.** Fix B1 (false stale after a score, on the main path) and B2 (clipping and overflow at large
Dynamic Type, then an on-device check at xxxLarge and AX3). S1–S7 should land in the same round. The S6 tests matter
most for the no-gym Start and the overview-mode check-in sheet.
