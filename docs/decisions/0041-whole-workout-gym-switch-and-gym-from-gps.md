# 0041: A gym switch is the whole workout; the gym from GPS (expo-location)

**Status:** Proposed, 2026-11-07 (developer, from Ben's 7 Nov report). Built and tested on Linux only (domain, SQLite
on Node, app services with a fake location port). **Not yet run on an iPhone**; expo-location is a native module and
needs a new dev build / IPA. Amends ADR 0019 (GS4 card-first switch, GS6 done sets stay on the old gym, the
`Main → Hotel` route).

## Context

Ben, 7 Nov (Push A, live): he changed gym mid-workout to Battersea and the incline dumbbell press table read sets 1–2
`Main gym`, a divider `At Battersea`, then sets 3–4. "If I change gym location mid go it should apply to everything.
Also can we do it based on GPS?" ADR 0019 fitted pending sets to the new gym through a `Switch` card and kept done
sets on the old gym's items (a continuation row per split exercise, a `GymPartDivider`, a done-set gym caption and a
`Main Gym → Hotel` route).

## Decision

### 1. A switch moves the whole workout (no migration)
- Picking a gym in `Gym for this workout` applies at once (CLAUDE.md rule 3: Ben asked), one toast
  `At Battersea · 3 sets fitted · Undo` (`At Battersea · Undo` when no target changed). `gymSwitch.switchNow` proposes
  and applies in one transaction; the same opId again (double tap, retry, relaunch) returns the recorded change.
- `change_gym` in `gym_switch` mode now also re-points rows **with done sets** (and rows with nothing left to do, sent
  as slots with no sets) to the new gym's mapped item. Done sets' values, planned targets and versions never change
  (rule 2); only their row's item does. Every pending set of every exercise is fitted by `snapPlanToGym` as before
  (rule 4; a load Ben typed himself stays as typed via the existing draft/edit rules).
- Done sets keep their old item (and the pending sets continue on a row as in GS6) only when the new gym has no item
  for the exercise, the item is in another unit or convention (done values are never reinterpreted), or the item
  couldn't make a load they record (history never claims a rack made more than its max). Bench at a gym with no bar
  is the common case.
- The `gymChanges` entry gets `wholeWorkout: true` (JSON, optional). `gymRouteIds` starts the route again at the
  latest whole-workout switch, so Summary, Past workouts and Repeat read one gym; older records without the flag read
  as before. History buckets follow the items (`toHistorySessions` already reads each item's gym), so re-pointed rows
  are history at the new gym and next-time targets read one block on the new item.
- The `GymPartDivider` and `partStart` are removed. A done-set gym caption shows only for a workout switched before
  this change (route of more than one gym).
- Undo restores the gym and every row and target exactly (the change's `before` already holds every row), refused
  once anything changed since (rule 5). `equipment_update` (`Use changes today`) keeps its card and GS6 behaviour.
- Schema: `GymChangeSchema.wholeWorkout?`, `ChangeGymSlotSchema.sets` may be empty (gym_switch only). No SQL change;
  `check:migrations` still ends at 45.

### 2. The gym from GPS
- **Library:** `expo-location` **57.0.20**, pinned exactly: the version `expo@57.0.27`'s `bundledNativeModules.json`
  lists (`~57.0.20`), matching how every other Expo module in `apps/mobile/package.json` is pinned. Expo-supported,
  no entitlement. Config plugin with `locationWhenInUsePermission` only; `locationAlwaysAndWhenInUsePermission`,
  `locationAlwaysPermission` and `motionUsagePermission` are `false` (otherwise the plugin writes its default
  "Always" and motion strings) and `isIosBackgroundLocationEnabled: false`. `expo config --type introspect` on Linux
  shows `NSLocationWhenInUseUsageDescription` as the only new key, `UIBackgroundModes` still `audio` only, and the
  entitlements unchanged. The prebuild entitlement check (`check:entitlements --prebuild`) runs on the macOS CI.
- **Storage (Your data, rule 10):** `Gym.location?` `{latitude, longitude, accuracyM, setAtUtc}` on the gym document
  (JSON, no migration), so it is owner-scoped and in backup/restore and Delete my data with the gym. Never sent
  anywhere; the coach gets gym names only, never coordinates.
- **Setting it:** Profile › Gyms › a gym › `Use current location` takes one precise fix (10 s timeout) and saves it
  (versioned); `Location set` · `Clear`. The when-in-use prompt is shown only from this tap. Fixes worse than 500 m
  aren't saved.
- **Matching (pure, `packages/domain/src/gym-location.ts`):** haversine distance; the nearest live gym with a location
  within 200 m; no match when the fix's accuracy is unknown or worse than 500 m, or the two nearest are within 1 m of
  each other (a tie: do nothing).
- **Using it:** Today, on focus, with a gym located and permission already granted, takes one low-power fix (4 s
  timeout). A match that isn't Today's gym, with no workout running, selects that gym (`gyms.select`, versioned) with
  the toast `At Battersea · Undo`; Undo selects the previous gym and the app won't pick that gym again by itself until
  it restarts. When a workout opens, a match that isn't the workout's gym is only offered: `You’re at Battersea`
  `Not now` `Switch` (Switch is part 1). No module, no permission, no fix, no match: nothing and no error copy.
- **Capability detection:** `requireOptionalNativeModule('ExpoLocation')`; expo-location's JS is imported only after
  it, so a build without the module hides the GPS rows and never checks.
- Never background location, region monitoring or "Always" permission.

## Consequences
- A workout reads as at one gym after a switch, which is what Ben meant; the price is that done sets on an item the
  new gym also has are recorded on that item. Where that would misstate the data (no item, other unit, load past its
  max) the old item is kept, invisibly in the workout (no divider, no caption).
- Repeat of a whole-workout switch copies each exercise once from one row (no parts) in most cases.

## Needs a device check
- The when-in-use prompt text and timing (first `Use current location` only), a fix indoors at the gym within 4 s,
  the Today switch and its Undo, the in-workout offer, Log blocked while the switch is written, and that the IPA
  still signs with SideStore (no new entitlement expected).
