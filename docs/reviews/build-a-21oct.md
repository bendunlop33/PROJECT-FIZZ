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

---

## Re-check 21 Oct (after `ae0d413`..`2d71217`)

### Verdict: **NO-GO** (1 blocker: B1 is only partly fixed; small fix)

The fixes for S1–S5, SP-3 and N1/N4 are real, and their tests fail when the fix is taken out. The follow-up check of the five earlier reviews finds every B item fixed in code. One gap remains. The B1 exception ("rests Ben set himself are never shortened") only recognises `edit_planned_set`. The in-workout **Rest after** sheet is the way Ben actually sets a rest, and it writes `set_rest_after`, which the fit doesn't see. So the fit still cuts those rests. Fix R1 and this is GO.

### Checks run by the reviewer (on `2d71217`)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `eslint .` (6 GB heap) | clean |
| `npm run check:migrations` | `Migrations OK: 1 to 31, none reserved or empty.` |
| `vitest run` (full suite) | 437 files, 8255 passed, 1 todo |
| `expo prebuild --platform ios --no-install`, then `npm run check:entitlements` | `Entitlement check: OK (no forbidden keys)`. `apps/mobile/ios` deleted afterwards; `git status` clean. |
| Native config diff `493e80c..HEAD` | No native, plugin, module, patch or `package.json` changes. ADR 0004 holds. |

**Mutation checks.** I reverted each fix in turn in `time-fit-today.ts`, ran the tests, then restored the file with `git checkout`:
- **B1:** removing the `restCuts` guards *and* the `pinnedRests` pin fails all 3 new B1 tests. Removing only the `restCuts` guards fails none, because the pin alone protects. The guards are therefore redundant belt-and-braces.
- **S2:** suppressing the effort line on a slot that lost a set fails the ladder-order test.
- **S3:** `least = 1` fails the 300-min test.
- **N4:** making `fitOwnEdit` always false fails 2 tests.
- **S1:** making `undoableTimeFit` ignore the dry run fails 3 tests: the domain test, `time-fit-workout` and the S5 Today test.

### Items from this review

| Item | Status | Evidence |
|---|---|---|
| B1 | **Partly fixed** (see R1) | Fixed for `edit_planned_set` edits, pain flags and timed exercises (`time-fit-today.ts:169`, `pinnedRests`, `restCuts`). A pain-flagged member of a superset keeps both members' rests (reviewer probe P2, passed). |
| S1 | Fixed | `⋯ › Undo fit to time` is shown only when a dry-run `undo_op` would succeed. It survives a relaunch (schema round trip) and is refused once stale. |
| S2 | Fixed | Both lines show, e.g. `Cable fly 3 → 2 sets` and `Cable fly last set @8 → @9`. |
| S3 | Fixed | The target is floored at half the remaining sets' length. When capped, the status is `over` and the sheet reads `Saves ≈ N min`. |
| S4 | Fixed | `CoachAskBar icons page="active"`: ✦ shows `Coach` / `Offline` / `No coach` and is never disabled. Heard words go to the coach field unsent. |
| S5 | Fixed | `today-session.test.ts` starts from Today with a real superset and catalogue info. The main lift is kept, rests only get shorter, and Apply → ⋯ Undo restores the sets. |
| SP-3 | Fixed | `TimeFitSheet`: one before → after line per change, Apply / Not now / `Time left ›`. |
| N1 | Fixed | |
| N4 | Fixed | |

### Earlier reviews: B items (each confirmed in code)
- **wave2-wiring B1:** fixed. `builder-service.ts:752-764` turns an Other session into a custom day with that session's name and groups, and never falls back to `split[0]`. `coach-ports.ts:67` goes through the same function. Test at `today-session.test.ts:357`.
- **wave2-wiring B2:** fixed. `todayAskFirst` (`builder-coach-view.ts:241`) sends pain or unclear words to the coach with `draft` before the Set up parser runs. A reply or `Not understood` also opens the coach with the words.
- **wave2-integrity B1:** fixed. `BuilderProposal.askedHeavier` is stored (`proposal.ts:35,58,74`) and used by `apply` (`builder-coach-service.ts:402`).
- **wave2-integrity B2:** fixed. Ownership is now by state (`todayDraftState`: `today` / `nudge` / `edited`), and a nudged draft isn't `· edited`. Tests at `today-session.test.ts:631,653`.
- **wo-v3-spec B1 / wo-v3-logic B1:** fixed. `setSteps` / `stepName` is used in every toast and title.
- **wo-v3-spec B2:** fixed. `boxAnchor` pins the box to the new row until the next log, untick or round change (`rounds.ts`).
- **wo-v3-spec B3:** fixed. The fallback keeps 2-row boxes, hides Up next, and scrolls the page to the edited cell (`pageOffsetFor`, `WorkoutTable.tsx:209-215`).
- **wo-v3-logic B2:** fixed. `companion` rows share their head's number and aren't counted (`rounds.ts:137,154`). The test expects `1L`, `1R`.
- **rest-undo-sp1 B1:** fixed. `rest_timers.restored_finished` is persisted (migration 31, `sessions.ts:358,623`), `cue-controller.ts:53` uses it, and there is a fresh-controller test in `spoken-cues.test.ts`.

**S items spot-checked, all fixed:**
- integrity S1: the Today Start and the check-in route pin the draft version (`today-session.ts:912`, `CheckInScreen.tsx:323`).
- integrity S2: the nudge is keyed to a hash of the controls.
- logic S3: `set_active_set` is refused while another set's work timer runs (`reducer.ts:793`).
- spec S5/S6: 44 pt chips; Untick is offered only on the latest log.
- rest-undo S1: finished entries in the kept-rest stack are bounded.

### Blocking

**R1. The fit still shortens rests Ben set with the Rest after sheet (B1 not fully fixed).**
- **Where:** `packages/domain/src/session/time-fit-today.ts:93` (`bensEdit` reads only `planned.edit`) and `packages/domain/src/session/reducer.ts:1528-1543` (`handleSetRestAfter` writes `rest.source: 'set_override'` or `'exercise_default'` but never sets `planned.edit`). The workout's `Rest after N` sheet (`WorkoutScreen.tsx:2957-2971` → `workout-services.ts:3118`) sends `set_rest_after`. So do `⋯ › Rest after` and `Why? › Change`.
- **Failure (reproduced with a temporary test, since deleted):**
  - Ben sets Cable fly set 2's rest to 4:00 through Rest after (`scope: 'set'`). He is then 1 min over and taps `+1 min`. The sheet lists `Cable fly rest 4:00 → 1:15`, and Apply sends `edit_planned_set { restS: 75 }` on that set.
  - With `scope: 'exercise'` on bench at 5:00 (saved as his default, "(yours)"), the sheet lists `Bench press rest 5:00 → 2:30` on two sets.
  - The sheet now shows the change, so it is no longer hidden. But the code comment (`:19-23`), the CHANGELOG entry of 21 Oct and the fix summary all say rests Ben set himself are left exactly as they are. That holds only for `edit_planned_set`, which is not the path the Rest after UI uses.
- **Fix:**
  - Treat a pending set as Ben's when its rest is his own: `rest.source === 'set_override'` or `'exercise_default'`, unless the fit's own step wrote that rest (`planned.edit` is the fit's op and the rest equals what that step set).
  - Cleaner alternative: have `set_rest_after` record its provenance on the set, e.g. `rest.opId` or `planned.edit`, so `bensEdit` can read it.
  - Decide with Ben whether per-set `set_override` rests from his routine template (`rest.ts:32`) count too. I'd say yes.
  - Add tests: `set_rest_after` with scope `set` and with scope `exercise` leaves those rests unchanged at `over` = 1, 8 and 30. Also add a test for a superset whose member has a Rest-after rest.

### Should fix
- **R2. The workout's ✦ status word is fetched once.** `WorkoutScreen.tsx:197-210` calls `builderCoach.status()` only on mount. If the phone goes offline 20 minutes into a workout, ✦ still says `Coach` (rule 1: honest status). The sheet it opens is honest, so this doesn't block. Refresh it on `AppState` `active`, on focus, and after each coach sheet close, as Today does on reload.
- **R3. Ben's rest presets aren't passed.** `workout-services.ts:2968` calls `timeFitOffer` without `restPresetsS`, so the fit's targets use the default presets while the builder uses Ben's. The workout fit and the builder can therefore cut to different rests (`3:00 → 2:30` here vs the builder's). Pass `restPresetsS` the same way the builder does.
- Carried over and accepted as open: Log pill width on SE, live words not shown in the icons layout, N2, N3, SP-4, retiring `fitPlanToMinutes`.

### Nits
- `restCuts`' `touched` / round guards (`time-fit-today.ts:200-201`) are unreachable in practice, because the pin already makes the targets equal to the current values. Keep them, but the B1 tests only cover the pin. A short test calling `restCuts` with an unpinned touched slot would make the guards meaningful.
- With `status: 'over'`, a fit that only rounds to 0 saved minutes reads `Saves ≈ 0 min`. Hide the offer, or say `Saves < 1 min`.

### Spec issues (for Ben)
- **SP-1 is recorded as decided without Ben's word.** The CHANGELOG entry `## 2026-10-21: Mid-workout fit to time (records Ben's 20 Oct approval…)` (`docs/brief/CHANGELOG.md:568`) states the main-lift rule ("its rests may shorten, 3:00 → 2:00"), the three exceptions and the sheet as if they were approved. Ben approved v3 §5 on 20 Oct. The main-lift rest question (SP-1), the sheet (SP-3) and the exceptions were raised by this review afterwards. Ben should confirm them, or the entry should mark them "proposed, pending Ben". This doesn't block a device-test build.
- SP-4 (rest-undo SP-a/SP-b) is still open.

### Needs a real iPhone
- The fit sheet → Apply → toast, and ⋯ › Undo fit to time after a force-close.
- The ✦ + mic pair beside the Log pill on an SE-size screen (label truncation), plus the mic → coach field hand-off.
- Everything listed in the first section's device list still applies.
