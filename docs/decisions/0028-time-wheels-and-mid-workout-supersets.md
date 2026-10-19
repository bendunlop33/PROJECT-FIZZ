# 0028: Time wheels on Finish, and supersets made mid-workout

**Status:** Ben asked for both on 19 Oct 2026 (screenshots of the Finish sheet and a refused coach change). **Built, not run on his iPhone yet:** the picker is a native module, so it needs a new dev build or `.ipa` before it shows; the rest is TypeScript.

## Context

- The Finish sheet moved the end time in ±1 / ±5 minute steps, and couldn't move the start. Ben: "Option to change start and end by scrolling when finish workout".
- The coach refused to pair Seated calf raise with a second copy of itself ("Just do weighted and we put 0"): today's edits and the coach's add both refused an exercise already in the workout. Ben: "I want the option to add superset to an existing set", "Even if it's the same exercise with different or no weight".

## Decision

1. **`@react-native-community/datetimepicker` 9.1.0**, the version Expo SDK 57 bundles (`expo/bundledNativeModules.json`), pinned exactly in `apps/mobile`. It is the iOS `UIDatePicker` wheel (`display="spinner"`), takes the workout's own time zone (`timeZoneName`) and min/max dates. No entitlement, no config plugin needed: free-provisionable. `@expo/ui`'s SwiftUI `DatePicker` was the alternative, but it is in the app only for the widget today and is not yet used for in-app UI; a JS wheel was the fallback if the module couldn't be installed.
2. **Started / Ended rows** on the Finish sheet and in a past workout's `Edit times`, one shared component (`WorkoutTimesRows`). Bounds and the clamp are pure (`packages/domain/src/session/workout-times.ts`); the writes check them again: `finish` takes an optional `startedAt` (audited as `source: finish`), a past workout uses `update_session_timing`. No set changes.
3. **Supersets on live rows**: `link_superset` and `split_superset` session commands (rows and order only, versioned, idempotent, `undo_op`), also steps of the coach's `edit_today` (`superset`, `split_superset` ops). A row paired mid-workout sits out the rounds already done (`session_exercises.round_offset`, migration 24), so the sets alternate from the current round.
4. **The same exercise twice** is allowed on every add path (Library, overview, coach). Each copy keeps its own sets; only the main copy is the exercise's history and next-time basis (`extraCopies`), so a 0 kg copy never moves its targets.

## Consequences

- A native rebuild is needed for the wheels. Until then the old JS bundle can't load the module; the build that ships this code must include it.
- Removed rows keep their superset letter (an Undo of a removal could bring them back), so a new pair can get `B` after an undone `A`.
- Before Start, the overview adds a second copy but has no `Superset with…` yet (today's edits have no superset kind).
