# Build A pre-build review: `claude/b3-merge-20oct` (21 Oct 2026)

Scope: everything going into Build A. That covers Wave 2 (builder, Today, coach), the inline cell edit, rest-undo (migration 31), the active workout v3 core, and the five post-merge commits `0522180`..`046db2e` (the untick test, the `+N min` time fit, and builder Start → v3).

## Verdict: **NO-GO** (1 blocker, small fix)

The core loop is sound. One opt-in path, the `+N min` fit, shortens rests the merge summary says it never touches, including Ben's own edited rests and rests on pain-flagged movements. Fix B1, add its test, and this becomes GO. Nothing else blocks.

## Checks run by the reviewer

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `eslint .` (6 GB heap) | clean |
| `npm run check:migrations` | `Migrations OK: 1 to 31, none reserved or empty.` |
| `vitest run` (full suite) | 437 files, 8242 passed, 1 todo |
| `expo prebuild --platform ios` then `npm run check:entitlements` | `Entitlement check: OK (no forbidden keys)`. The generated `ios/` was deleted afterwards (it is gitignored). |
| Native config diff | Neither merge (`2280c98`, `bb41abe`) nor any post-merge commit touches `app.config.ts`, `app-identity.mts`, `plugins/`, `modules/`, `patches/` or any `package.json`. The last native change is `@react-native-community/datetimepicker` 9.1.0 (19 Oct, ADR 0028), which is free-provisionable. ADR 0004 holds. |

I traced the scenarios with temporary tests, all deleted afterwards:
1. **Superset untick (domain plus SQLite services).** Bench rest running → `1a` (ends the bench rest early; no rest of its own) → force-close mid-superset → relaunch opens on `1b` → `1b` (round rest runs, alert scheduled) → force-close mid-rest → relaunch keeps the same deadline and alert → untick `1b` (round rest and alert cancelled; SET clock counts on from the `1a` log, not from zero) → untick `1a` (bench rest back with its **original deadline**, and the alert is rescheduled to it). Result: correct. Only the latest log offers untick. When the earlier rest had already expired, unticking `2b` brings it back finished, with the SET clock at `0:40` from the `2a` log.
2. **Builder Start with the scope prompt.** `openTemplate` → add a set → `startPrompt` reads `Triceps pushdown: 3 → 4 sets` / `Update Push · bench press in your plan` → Start with `update` → force-close → log every set → force-close → finish → force-close → `planChangeOf` returns the template change → `undoPlanChange` gives `{ ok: true }`. Result: correct. The Today → Edit route into the builder was covered by the Wave 2 reviews and their fixes (`abdf13a`, `e91c5dd`, `ff98eee`).
3. **Offline.** Logging, untick, rest and the fit are all local, and no network is involved. Today shows `Offline` / `Not reviewed · Offline` (`today-session.test.ts:575-594`). The workout's coach sheet shows its own status. No canned coach text anywhere.
4. **Force-close mid-rest and mid-superset.** Covered in (1). The fit also survives a relaunch (`time-fit-workout.test.ts`).

Earlier blockers: the wo-v3 logic and spec reviews (B1 set numbering, B2 `＋ Set` out of sight, B3 keypad fallback) were fixed in `442e3de`, `e7a8b5a` and `f6ad9ff`. Wave 2 wiring and integrity B1/B2 were fixed in `abdf13a`, `143f3e9`, `089003d` and `e91c5dd`. Rest-undo-sp1 B1 was fixed in `0933983`, `994dba1` and `9006921`. None of these fixes has had a follow-up review. I spot-checked the wo-v3 B1 fix: every toast, sheet title and effort heading in `WorkoutScreen.tsx` now uses `stepName`.

## Blocking

### B1. The `+N min` fit shortens rests on sets Ben edited, on pain-flagged movements and on timed exercises
- **Where:** `packages/domain/src/session/time-fit-today.ts:163-183` (`restCuts`). It applies the new rest level to every kept pending row and never checks `slot.touched`. `touched` is set at `:121` for Ben's own edits, pain flags and non-rep exercises, but only the ladder's effort, set and drop steps honour it (`builder/fit.ts` `accessories()`).
- **Failure (reproduced):** Ben sets bench set 2's rest to 300 s himself (`edit_planned_set`, `planned.edit` = his op). Later he is 2 min over and taps `+2 min`. The alert lists only `Shorter rests`. Apply sends `edit_planned_set { restS: 120 }` on that set, so his 300 s is gone. The same offer shortens the pain-flagged Cable row from 90 s to 60 s. The domain test `time-fit-today.test.ts:139-152` passes because it only asserts `targetRpe` on flagged sets.
- **Why it blocks:** the merge summary tells Ben the fit never changes "exercises with a pain flag, sets Ben edited himself, and exercises that aren't counted in reps", and the module's own comment (`:120`) says the same. The code does change them, and the one-line summary hides it. That is the "never silently change what Ben chose" spirit of rule 2/3. For a pain-flagged movement it also adds training density, which goes against rule 9's "stop progression".
- **Fix:** in `restCuts`, skip slots whose `touched === true` (look the original slot up by key and `continue`). Optionally also skip any individual set with `planned.edit` (or `planned.edit.patch.restS`) set. Add tests: a Ben-edited rest is unchanged, a pain-flagged exercise's rests are unchanged, and a timed exercise's rests are unchanged. Then decide the main-lift question in SP-1.

## Should fix

### S1. The fit's Undo exists only in the transient toast
`WorkoutScreen.tsx:1170`. Once the toast is gone, or after a force-close, a multi-set change (rests, RPE, deleted sets, skipped exercises) can only be reversed by hand. `undo_op` on the fit opId works at any time (`reducer.ts` `undoFitToday`), but no surface offers it. Add a `Fitted · Undo` entry, for example in `⋯` or on the header while the fit is the latest change, or record it where today's other coach edits can be reverted.

### S2. Hidden RPE change when a slot also loses a set
`time-fit-today.ts:241`. When the ladder cuts a set, `setWorkingCount → lastAtNine` re-marks the new last set `@9`. The `effort` line is suppressed (`al.gone.length === 0`), but the `targetRpe: 9` step is still sent. The alert says `Cable fly · 3 → 2 sets` while set 2 also moves from @8 to @9. Either show both, e.g. `3 → 2 sets · last @ 9`, or don't send RPE steps for a slot that only lost sets.

### S3. The target can collapse to 1 minute
`time-fit-today.ts:202`. `targetMinutes = floor((builderEstimate − paceOver) / 60)`, floored at 1. The `over` value is pace-based and the remaining estimate is builder-based (the developer flagged the mismatch), so a large pace overrun (for example 30 min over with a builder estimate of 20 min left) asks the ladder for 1 min. It then drops every droppable exercise and reports `over`. Cap the cut, for example `target ≥ ceil(before / 2)` or a floor tied to the main lift's remaining sets. Alternatively, compute `over` with the same estimator that sizes the sets left.

### S4. v3 §1.6: the workout still has the old `Chat` button
`WorkoutScreen.tsx:2796` renders `<ChatButton>`. The spec says that once the Wave 2 coach ask bar (`ui/coach-ask-bar.tsx`) is on the branch, the workout's Chat becomes that bar's mic + ✦ entry, same as Today. It is on this branch now. This is not a correctness issue, because the coach sheet shows its own honest status, but Today and the workout differ.

### S5. The fit has no app-level test from a Today Start, and no superset test against real catalogue info
The developer acknowledged this. The app-level test (`time-fit-workout.test.ts`) starts empty and adds exercises. The domain superset test (`time-fit-today.test.ts:206`) uses `info: () => null`, so groups and roles are defaults and the drop order isn't exercised. Add one test that starts from Today with a superset day, applies the fit, and checks main-lift protection through `draftMains` and `planDay` provenance.

## Nits
- N1 `workout-services.ts:2280`: the JSDoc "An exercise by ID…" now sits above `draftMains`, and `exerciseById` lost its comment.
- N2 `time-fit-today.ts:202`: `beforeMinutes` uses the builder's rest-level defaults, not the sets' stored rests. With custom rests, `≈ before → after` can be far from the header's time. The `≈` is honest, but consider an info tap.
- N3 `commands.ts` `FitTodayToTimeCommandSchema.steps.max(120)`: a very long workout fails validation with a generic refusal. This is unlikely, but a refusal reading `Too many changes` would be clearer.
- N4 After an Apply, each fitted set carries `planned.edit` from the fit. A second `+N min` offer therefore treats those exercises as Ben-edited (`touched`) and won't cut them. That is acceptable, but it's surprising and untested.

## Spec issues (for Ben)
- **SP-1. Is the main lift's rest included in "never the main lift" (v3 §5)?** The builder ladder, and therefore this fit, shortens the main lift's rests too. In the probe, bench back-off went from 180 s to 120 s, and the test `time-fit-today.test.ts:195` expects a fit edit on bench. The spec wording is ambiguous, and short rests on heavy compounds affect performance. Ben should say whether rests on the main lift may be shortened.
- **SP-2. v3 §5 vs fit-to-time FT3.** FT3 says a mid-workout trim never shortens rests, and the approved v3 spec asks for the builder ladder, which does. The developer followed v3. Record the override in `docs/brief/CHANGELOG.md` or an ADR, and retire or keep `fitPlanToMinutes` on purpose (`builder/fit.ts:25-33` still says "S1/S8 own" that decision).
- **SP-3. The fit is a plain alert, not a proposal card.** It has no per-set before/after. CLAUDE.md rule 2 asks broad changes to show before/after, and the spec only says "one offer with Apply/Undo". Ben should decide whether the fit needs a proposal card.
- **SP-4.** The rest-undo spec items SP-a (the Rested count after a skip) and SP-b (the "SET / Rested clock" name) are still open from `rest-undo-sp1-21oct.md`.

## Needs a real iPhone
- The `+N min` tap → alert → Apply → Undo toast.
- Untick after a force-close, with notification and Live Activity re-armed to the original deadline.
- Superset box scrolling and keypad fallback on an SE-size screen.
- Free-provisioning install of the Actions-built `.ipa` through SideStore (the datetimepicker native module is new since the last device build, if that build predates 19 Oct).
