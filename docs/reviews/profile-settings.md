# Review: Profile training details and split settings (D5, D7, D8, F19)

Branch `claude/profile-settings`, diff against `claude/gracious-knuth-joxqpw` (5 commits, 40 files).
Reviewer: independent reviewer agent, 14 Oct 2026.

## Verdict: CHANGES NEEDED

The storage, versioning and coach-context parts are solid. Migration 16 is the next number,
`training_profiles` is listed as Your data, backup, restore and Delete my data are covered,
writes are idempotent and stale-checked, and unset values are reported as "not set" instead
of guessed. Two problems block the merge: one setting on screen does nothing, and one tap
on a split card permanently deletes Ben's custom split and main-lift choices.

## Checks run (in the worktree)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | pass: 313 files, 6448 tests (1 todo) |
| `npm run check:migrations` | pass: "1 to 16, none reserved or empty" |
| Migration number clash with other local branches | none (only this branch has `0016-*`) |

## Blocking

### B1. "Next-time targets" (D5) is a switch that does nothing
`apps/mobile/src/screens/profile/TrainingDetailsScreen.tsx:91-97`, `packages/schemas/src/training-profile.ts:92-93`,
`packages/domain/src/training-profile.ts:153-154`.

`selfNextTargets` is stored and versioned, but nothing in `apps/` or `packages/` reads it
(grep: it only appears in the schema, the domain write, the view and the switch). The app
has no Self-driven session mode yet (`ideas-2026-10-12.md` §8 is still a proposal). The
Summary still shows the built-in `Next time` for every non-coach workout
(`apps/mobile/src/screens/workout/SummaryScreen.tsx:70`).

Failure: Ben sees "SELF SESSIONS · Next-time targets: Off" (the default), finishes a
routine workout, and the Summary shows next-time targets anyway. If he turns it On, nothing
changes. A control that says one thing while the app does another breaks the honesty rule
(rules 1 and 6) and the "values and actions" copy rule.

Fix: hide the row until Self-driven sessions exist, and keep the stored field. If Ben wants
it now, wire it into the Summary's built-in rows for non-coach sessions. That is a
behaviour change, so it needs his decision first (see Spec issues).

### B2. One tap on a split card permanently deletes the custom split and main-lift choices
`apps/mobile/src/screens/profile/SplitScreen.tsx:63-73`, `packages/domain/src/training-profile.ts:138-142, 158-163`,
`apps/mobile/src/training/training-view.ts:194-196`.

Tapping a preset `ChoiceCard` writes `preset_split` straight away, with no confirm and no
Undo. `carryMainLifts` keeps only the main lifts whose day ID matches the new split, so:
- Custom → PPL: every custom day (names and body parts) is gone. Tapping Custom again
  rebuilds it from `customStartDays(current)`, which are now the PPL days, so the custom
  days can't be recovered.
- PPL → CLSB: Ben's chosen main lifts for `push` and `pull` are dropped, because CLSB has
  no days with those IDs (the mobile test at `apps/mobile/test/training-details.test.ts:150-155`
  shows this: OHP is chosen for Push, then the split changes to CLSB). Switching back to
  PPL doesn't restore them.

Failure: Ben scrolls the Split screen, brushes the "Push/Pull/Legs" card, and loses a
6-day custom split and his main lifts. He has no way to get them back short of restoring a
backup.

Fix: either show one-tap Undo after a split change (the previous `split` is right there in
the stale-checked write), or keep the previous custom days and main lifts in the document
(for example `customDays` and `mainLiftsByDayId` kept across kinds) so switching back
restores them. Add a domain test for Custom → preset → Custom and PPL → CLSB → PPL.

## Should fix

### S1. Weight entries are deleted in one tap with no Undo
`apps/mobile/src/screens/profile/TrainingDetailsScreen.tsx:76-78`. Both the row swipe
action and the trailing `Delete` button write `delete_weight` straight away. A mis-tap in a
dense list removes a dated bodyweight entry, which the coach uses. Fix: an Undo toast that
re-adds the same entry (same ID), or a confirm.

### S2. Bodyweight isn't used by any deterministic code
`packages/domain/src/training-profile.ts:316-331` (`bodyweightLoadKg`) is only called from
tests. The brief says the weight is "used for bodyweight/assisted loads". At the moment the
coach only gets a hint string (`packages/coach/src/context.ts:130,157`). Assisted pull-up
volume and estimates still ignore bodyweight. Fix: wire `bodyweightLoadKg` into the place
that needs it (Progress volume or e1RM for bodyweight, weighted and assisted sets, or the
build checks). Otherwise delete it and record the gap. Dead guardrail code suggests a
guarantee that doesn't exist.

### S3. The goal check-in never appears
`packages/domain/src/training-profile.ts:303-307` (`goalCheckInDue`) has no callers. The
"Check-in · Every 6 weeks" row (`training-view.ts:121`) is another setting with no effect,
the same problem as B1 but lower stakes. Fix: hide the row until the check-in prompt is
built, or build it (12 Oct decision: shown on coach-driven workouts every N weeks).

### S4. A read failure reaches the coach as "not set"
`apps/mobile/src/services/training-service.ts:56, 117`. `repo().get(...).catch(() => null)`
turns an unreadable row (decode or integrity error) into `profile: null`.
`trainingDetailsView` then lists Age, Gender, Height, Bodyweight and the rest as "not set"
(`context.ts:144-170`), although Ben did set them. The screen also shows the defaults with
every value "Not set" instead of its error state (`stored()` at line 56). Any save then
fails with "Couldn't save". Fix: let `get` errors propagate. `coachInput` should then return
null (the coach is told `NO_TRAINING_DETAILS`, "not available"), and the screen shows
"Couldn't read training details." Add a test with a damaged row.

### S5. Future-dated weights are accepted and become the latest weight
`apps/mobile/src/training/training-view.ts:147-152`, `packages/domain/src/training-profile.ts:106-113`.
The date is a free-text `YYYY-MM-DD` field (`TrainingDetailsScreen.tsx:228`, not a date
picker) and nothing checks it against today. A typo such as `2027-10-13` sorts last, so
`latestWeight` sends it to the coach indefinitely, and newer correct entries never replace
it. Fix: reject dates after today, in both the view and the domain (pass `today` like
`nowYear`). A date picker would be better still.

### S6. Rotation resets to the first day after any workout that doesn't match a split day
`packages/domain/src/training-profile.ts:243-251, 376-382`. `lastWorkoutGroups` uses only
the newest finished workout. If that was a Core-only or accessory session (no day lists
Core in either preset), `nextSplitDay` returns `days[0]`. Failure: Push on Monday, abs on
Tuesday, and on Wednesday the Build card pre-selects Push again. Fix: walk back to the
newest workout that matches a day. Add a test.

### S7. Custom split days don't rank exercises by their body parts
`packages/coach/src/build.ts:117-129`. `split_day: []` (and `chest`/`shoulders` → `push`)
means `usableFirst` gives no priority to the day's own body parts when the usable list is
capped. The custom day's `bodyParts` reach the model's context, but deterministic ranking
ignores them. A custom "Arms" day can then fill the capped list with unrelated exercises.
Fix: when `request.day` is present, rank exercises whose first primary muscle's group is in
`day.bodyParts`.

## Nits

- N1. `apps/mobile/src/coach/coach-service.ts:909`: a follow-up turn carries `parent.request.day`
  but sets `mainLift: chips?.mainLift ?? null`, so the main lift drops out of the build
  context on follow-ups. The string also loses whether Ben chose the lift or it was
  recommended (`CoachSheetScreen.tsx:274`). Pass the `MainLift` with its source and fall
  back to the training service on follow-ups.
- N2. `TrainingDetailsScreen.tsx:163-164`: the stepper labels `cm` and `in` are read aloud as
  "in". Use "Height in centimetres" and "Height in inches" as accessibility labels.
- N3. `BuildCards.tsx` / `build-view.ts:76`: a session length that isn't one of the chips
  (e.g. 50) leaves no length chip selected, while the Build card sends 50. Show the value
  as a selected chip, or snap the session length stepper to the chip values.
- N4. `WeightEntrySchema` stores a local `date` and `recordedAtUtc` with no timezone.
  CLAUDE.md asks for UTC plus the timezone.
- N5. `training-service.ts:66-89`: every coach turn (via `coachInput`) reads 180 days of
  sessions and the full exercise pool. Fine for now, but worth caching or limiting if
  turn latency matters.
- N6. `add_weight` with an ID that already exists, or `delete_weight` with an unknown ID,
  bumps the version for a no-op. This is harmless.

## Rules checklist

| Rule | Status |
|---|---|
| 1 Offline, honest AI | Local only. The training context is omitted and "not available" is said when the read throws at the service edge, but see S4 |
| 2 Completed sets / proposals | No set changes. Split edits are settings with no Undo (B2) |
| 3 Coach guardrails | Unchanged. The Build card's split chips are code, not model |
| 4 Achievable loads | Not touched (S2 notes unused bodyweight code) |
| 5 Idempotent, versioned | Yes: op ID replay before the stale check, expected version checked in one transaction, tested |
| 6 No invented data | Unset values listed as not set. Age is labelled from birth year. Recommended main lift is null with no history. See S4 |
| 7 Secrets | None added |
| 8 Imported content is data | Custom day names travel as JSON fields under YOUR DATA |
| 9 Pain | Not affected |
| 10 Your data separation | `training_profiles` is in `YOUR_DATA_TABLES`. Backup, restore and delete are tested, never Coaching knowledge |
| Minimal copy | Good. Copy test present. B1 and S3 are settings without effect |
| Accessibility | Mostly labelled. N2 |

## Tests

Good coverage of versioning, replay, staleness, ranges, lb→kg bounds, backup, restore,
delete, integrity, migration in place, force-close recovery, the next-day pre-select and the
coach context with nothing set. Missing: Custom → preset → Custom loss (B2), main-lift loss
across presets (B2), the damaged-row read path through the service and coach (S4), future
weight dates (S5), rotation after an unmatched workout (S6), and the follow-up build turn
keeping the day's main lift (N1).

## Spec issues

- D5 assumes a Self-driven session mode that doesn't exist yet. If "Off (default)" were
  wired to today's routine workouts, it would remove the built-in Next time targets Ben
  gets now (ADR 0006 fallback). Ben should confirm whether D5 waits for Self mode or
  applies to routine-started workouts now.
- "Weight used for bodyweight/assisted loads" doesn't say which deterministic feature uses
  it (Progress volume, e1RM, build checks). It needs a named consumer before it can be
  built or checked.
- The goal check-in (12 Oct: "shown the first time Ben uses a coach-driven workout, then
  every X weeks") has a setting in this task but no specified prompt or screen.
- The relayed user request also mentions "exercises being moved here". Nothing in this
  task or branch covers moving exercises, so the request is unclear and should go back to
  Ben.
