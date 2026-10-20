# Review: kit slice (Ben's items 10 and 11, 20 Oct)

Branch `claude/ben-kit-20oct` (10 commits, diff from merge-base `c62ef40` with `claude/gracious-knuth-joxqpw`). Reviewer run, 20 Oct 2026.

## Verdict: CHANGES NEEDED

Three blocking issues. All are small fixes and none needs a design change:

- An exercise left out for a missing bench or rack gives the wrong reason ("no barbell here").
- The FitNotes import preview shows Smith sets as `BW + …`.
- The coach's "no bench here" doesn't take effect on any gym set up before this branch.

Otherwise the slice is well built. Item 10 needs no change and the code confirms it (`FULL_DUMBBELL_MAX` is 50 kg / 120 lb; machine stacks step 5 kg / 10 lb).

The new kinds work:
- They are modelled as their own schema types and widened in every exhaustive switch.
- They snap through the existing barbell, plate-loaded and dumbbell paths. EZ, trap-bar and Smith exercises never map to the Olympic bar.
- They are assumed (`detailsSource: 'preset'`) and written natively in kg and lb.

Migration 29 keeps every row and the index. No sibling 20-Oct branch takes 29.

## Checks run (by the reviewer)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `NODE_OPTIONS=--max-old-space-size=6144 npm run lint` | clean |
| `npx vitest run --maxWorkers=2` | 402 files, 7687 passed, 1 todo, 0 failed |
| `npm run check:migrations` | `Migrations OK: 1 to 29, none reserved or empty.` |
| `npm run catalogue:validate` | 144 valid, 0 errors, 1 warning (`barbell-landmine-press`, existed before this branch) |
| Migration 29 numbering vs the other `*-20oct` branches | no other branch uses 29 |
| Probe (temporary test, deleted): hotel quick setup with `bench` and `barbell` ticked and no rack; `barbell-overhead-press` planned on the hotel's **own** barbell | `mapping: 'not_here'`, load dropped, `reason: 'not_here'` |

## Blocking

### B1. An exercise left out for a missing bench or rack gives the wrong reason, and the reason is never named

**Where:**
- `packages/domain/src/session/snap.ts:179`
- `packages/domain/src/exercise-equipment.ts:52`
- `packages/domain/src/session/snap-text.ts:125`
- `packages/domain/src/session/fit-words.ts:35-37`
- `packages/domain/src/stations.ts:92`: `STATION_WORD` is exported but never used.

**What happens:** `mapEquipment` returns the generic `{ equipment: null, mapping: 'not_here' }` when `missingStations` finds a gap. It does this even when the exercise's own item is at this gym (the `same` item, checked further down). The set card then reads from `intendedOn`, which is that same barbell.

**Failure scenario:**
1. Ben sets up a hotel or home gym with Barbell ticked and Rack unticked. The quick setup saves a retired rack record.
2. His routine's overhead press, squat or bench press (rack needed per the catalogue) gets `No load target · no barbell and plates here` at the gym where that barbell sits.
3. The Library and exercise picker mark the lift `not_at_gym` without saying it is the rack.
4. The coach's `fit.ts` says `not at this gym`.

That is a false statement about Ben's equipment (rule 6 and the slice's "Why? for the new kinds"). Nothing tells him that ticking Rack would fix it.

**Fix:**
- Give the station gap its own reason, for example `SnapReason 'station_missing'` with the missing `GymStation[]`, from `mapEquipment`, and a matching `doableHere`/`gymAvailability` reason.
- Render it with `STATION_WORD`: `No load target · no rack here`, and `Needs a rack` in the picker or Library.
- Tests:
  - A hotel with a barbell and no rack gives the rack wording, never the barbell's name.
  - The picker row shows the same reason.

### B2. The FitNotes import preview shows Smith machine sets as `BW + 40 kg` instead of `40 kg plates`

**Where:** `apps/mobile/src/import/views.ts:508-509`. `loadContextFor` checks `compatibleEquipment.includes('plate_loaded_machine')`. The three Smith catalogue entries now list `smith_machine` (`packages/catalogue/data/exercises/smith-machine-*.json`), so the check returns `null`. `mappedSetText` → `loadText(added, null)` then reads `BW + n`.

**Failure scenario:** Ben previews a FitNotes export containing `Smith Machine Squat 60 kg × 8`. The preview line reads `Smith machine squat · BW + 60 kg × 8`. Before this branch it read `60 kg plates`. The stored data is still `added` and correct, but the screen where Ben checks the import misstates the load convention. That breaks the rule that kg/lb and load convention are always explicit. It also contradicts the developer summary ("added on a Smith reads plates everywhere").

**Fix:** `return c?.compatibleEquipment.some(isPlatesAddedKind) ? { kind: c.compatibleEquipment.find(isPlatesAddedKind) } : null`, or equivalent. Add an import-views test for a Smith row. Search the app for any other place that derives a load context from `compatibleEquipment` with a hard-coded `'plate_loaded_machine'`. This one was the only hit in `apps/mobile/src`.

### B3. The coach's "no bench here" doesn't take effect on any gym set up before this branch

**Where:**
- `packages/domain/src/stations.ts:85-90`: `missingStations` only treats a station as missing when the gym has a **record** of that kind.
- `packages/domain/src/quick-gym.ts:793-801` (`update_gym` `remove`): with no live bench, it only adds `bench` to `gym.missingKinds`.

**Failure scenario:**
1. Every gym Ben has today predates this branch, so none has a bench or rack record.
2. He tells the coach "this gym has no bench". The card shows `Bench: not here` and he taps Apply.
3. Dumbbell bench press, one-arm row, fly and similar are still planned there with load targets.

The card states a change that has no effect. ADR 0030 records this as a "consequence", but the coach is the main way Ben will tell the app about kit, and he'll do it on his existing gyms. That makes it the common path, not an edge case.

**Fix:**
- Pass the gym's `missingKinds` into `missingStations`, or into `mapEquipment`/`equipmentForExercise`, so that `kind ∈ missingKinds` counts as "known, none available".
- Alternatively, have `remove` write a retired, assumed record when none exists, as the quick setup already does. This is simpler and keeps one mechanism.
- Test: a gym with no bench record gets "no bench here" from the coach, Apply, and then the bench exercises are left out. Undo brings them back.

## Should fix

### S1. EZ and trap bar totals are compared across bars of different weights

**Where:**
- `packages/domain/src/session/overview.ts:75` (`equipmentKey` sets `barMass` only for `barbell`)
- `packages/domain/src/session/substitutes.ts:104` (`sameItemKind` checks bar mass only for `barbell`)

**Failure scenario:** Ben's main gym's EZ bar is confirmed at 7.5 kg and the hotel's is assumed at 10 kg. A 30 kg EZ curl at one is treated as like-for-like with 30 kg at the other: overview comparisons and the substitute targets' history. Totals that include different bars are not comparable, and these functions already encode that rule for barbells.

**Fix:** use `isBarLoaded(eq)` in both places and add a test.

### S2. EZ bar, trap bar and Smith machine get no plate breakdown or warm-up ramp on the active set

**Where:** `packages/domain/src/touches.ts:21, 27, 52, 69, 84`. Each checks `kind === 'barbell'` or `'plate_loaded_machine'`.

**Failure scenario:**
- An EZ curl at 25 kg shows no `10 bar + 5 + 2.5 / side` line.
- A Smith squat shows no `20 + 10 / side`, unlike a plate-loaded machine.

Snapping is right, but "snapping and loads for the new kinds" stops halfway at the set card. The overview's `platesText` was updated, so the two screens now disagree.

**Fix:** extend `plateBreakdownLine` to `isBarLoaded(eq) || eq.kind === 'smith_machine'` (bar label from `eq.barMass`, Smith as plates per side). Decide whether the warm-up ramp applies to the trap bar (likely yes). Add tests.

### S3. The import screen shows a misleading answered question, `Dumbbells: one dumbbell`, for the kettlebell swing

**Where:** `apps/mobile/src/import/views.ts:278` (and `READING_WORD.one` at :253). Pinned by `apps/mobile/test/fitnotes-import-views.test.ts:185`.

**Failure scenario:** a FitNotes export with only kettlebell swings and an EZ-bar curl shows a ticked line `Dumbbells: one dumbbell`. Ben has no dumbbell exercise in that import.

**Fix:** leave catalogue-answered one-implement rows out of the per-hand question when no exercise needed asking. Otherwise use the implement word the plan already has (`implementOf` → `Kettlebells: one kettlebell`). Update the test to pin the right text.

### S4. The unchecked line's grammar is wrong for kettlebells

**Where:** `packages/domain/src/session/gym-switch.ts:413, 553`. `itemWord` lower-cases only `dumbbells`, and `are` is used only for dumbbells.

**Failure scenario:** a session at a hotel with assumed kettlebells shows `Hotel’s Kettlebells is assumed.`

**Fix:** treat `kettlebell` like `dumbbells` ("kettlebells are assumed"). Add a test.

### S5. Test gaps

The new tests cover the domain happy paths well (kinds, snapping, kg and lb, Why? labels, stations, quick setups, migration in place, backup round-trip). These cases are missing:

- The station-gap reason text, on both the card and the picker (B1).
- An import preview of a Smith row (B2).
- The coach's `remove` of a bench on a gym with no bench record actually stopping bench exercises (B3). The existing test only covers a gym that already has a bench record.
- EZ or trap totals on different bar weights not being compared (S1).
- A service-level session start (`apps/mobile`) at a gym where a routine exercise is left out for a station. This should check the persisted `planned.snap` and that it reads the same after a relaunch.
- Restore of a schema-28 backup into a v29 store. The test only round-trips a v29 backup.

## Nits

### N1. The assumed bench type isn't named in Why?

**Where:** `packages/domain/src/quick-gym.ts:354-356`. `assumedWhy` returns `null` for bench and rack.

The quick setup assumes `adjustable`, and that assumption is what enables incline exercises. The gym row shows the `Assumed` tag, but `Why?` on an incline press says nothing. Consider `Assumed bench` for an assumed bench that is serving an incline need.

### N2. The coach's `propose_exercise` accepts `bench` and `rack`, then refuses them

**Where:** `packages/schemas/src/coach.ts:203`. It uses `EquipmentKindSchema`, which now includes `bench` and `rack`, so the model can choose them. `checkCustomExerciseFields` then refuses with a generic `Check the fields.`

Consider a load-equipment enum for the tool argument, so the model is never offered them.

### N3. Two bar weights now live in one place

**Where:** `packages/domain/src/gym-presets.ts:160-178` duplicates the bar weights (`10/20`, `25/55`, `15/35`) that `BAR_MASS` in `gym-editor.ts` already holds, and `quick-gym.ts` now uses `BAR_MASS`. Use `BAR_MASS` in the presets too, so one place holds the assumed bar weights.

## Spec issues (for Ben, not code defects)

### SP1. Smith machine convention

The brief allowed either "total incl. bar" or "plates + bar". The developer chose plates added (keeping FitNotes imports and history unchanged, and keeping an assumed 15 kg out of logged numbers, rule 6), with the bar weight shown beside the load **in the gym screen only** (`0–630 kg plates · 15 kg bar`). The set card shows `60 kg plates` with no bar.

I agree with plates added. Ben should confirm, and say whether the bar weight should also appear on the set card or in Why? for Smith lifts.

### SP2. Maxima from per-bar plate sets are unrealistic

Each bar gets its own assumed plate set, so the full gym's EZ bar reaches 325 kg, the trap bar 655 kg and the Smith machine 630 kg of plates. Rule 4 holds (snapping never passes the item's max). But the assumed max is meaningless and the gym rows look odd.

Options:
- (a) Sensible default `maxLoad` values per bar (for example EZ 60 kg, trap 250 kg).
- (b) One shared plate inventory per gym. This is a bigger model change and would need an ADR.

Ben decides.

### SP3. Is a rack a hard need for overhead press, push press, good morning and standing calf raise?

The catalogue's `requiresStation` says yes for all four. Now that stations gate planning, a home or hotel gym with a barbell and no rack loses those lifts completely, including the overhead press, which is often cleaned from the floor.

This is coaching knowledge (Your data vs Coaching knowledge, rule 10). The catalogue owner or Ben should decide whether `rack` stays a hard need for these, or becomes a soft need that warns instead of excluding.

### SP4. Catalogue rows saved earlier keep their old fields

Smith exercises stay on `plate_loaded_machine` and never use the new Smith item. Kettlebell swing, goblet squat and deadlift stay `total` and get no load target on the new kettlebells.

A versioned refresh of the saved rows needs a decision. It must keep history comparable: `total` and `per_hand` with `implements: 1` are the same number.

### SP5. Gyms that predate this branch have no bench or rack records

Nothing is gated at those gyms until Ben taps `Make full gym` (offered again on existing full gyms while a kind is missing) or adds the items. This is acceptable once B3 is fixed, but Ben should know the gating is opt-in for his current gyms.
