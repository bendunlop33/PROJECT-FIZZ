# Critic pass 1: product critique (9 Oct 2026)

Independent product critic, reading as Ben would: a strength and endurance lifter who wants a fast, premium logger with a useful embedded coach. Read-only on code. Inputs: CLAUDE.md, the brief (validation scenarios 1–10, §10 acceptance, competitor table), CHANGELOG v0.2–v0.9, `provisional-2026-10-09.md`, design README, open-decisions, the specs for today, check-in, active-workout, rest-state, workout-summary, coach-adjustments, workout-builder and progress, the Third Space reference, the training-guides README, ADRs 0005/0006/0010, `reviews/app-foundation.md`, `device-tests/2026-10-08-probe-build7.md`, and the code in `apps/mobile/src` and `packages/*/src`.

**What exists today (build at `7a71d64`):** first run (units, a gym from a preset checklist, the data explainer), Today, the check-in sheet, the focused set card (steppers, `Last (date)` with tap to copy, `Rest after`, effort chips, Undo toast, correction sheet, delete/skip/add set), rest with a persisted deadline and one keyed notification, pause, finish sheet, Summary with built-in `Next time`, and automatic on-phone backups plus `Save a copy to Files`. The domain covers feasible loads, ceilings, pain halts and idempotent commands, and the tests are strong.

**Not built:** routines and the weekly plan (so every workout starts empty), the gym editor, Overview, the custom keypad, timed sets, supersets in the UI, restore UI, import, export, Progress, the coach, voice, and Live Activity (`DEP-LIVE` failed in build 7).

---

## 1. Scenario coverage

Key: **Built** = works in the current code. **Designed** = specified, not built. **Gap** = neither design nor build handles it fully.

### Brief "Validation before claiming it is better"

| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | Bench 115×4 @ RPE 10, coach offers a reviewable adjustment | Designed | coach-adjustments §1 path B, §2.3. `evaluateCoachTrigger` isn't in `packages/domain`; ADR 0010 says "the coach is never reachable in this build" |
| 2 | Shoulder session two days earlier is used without overclaiming | Designed (thin) | coach-sheet §2.4 has the context builder with missing-data flags. No spec or acceptance check tests "uses recent related work, doesn't claim cause". The brief §2 wording is the only rule |
| 3 | Long run tomorrow: show the trade-off, don't overwrite | Designed, but **blocked** | weekly-plan WP3/WP5/WP7. Warnings only fire from *approved* rules, and rule 12 (C2/C3) is still a candidate (training-guides README). Endurance entries are in Phase B (step 6). Until Ben approves rule 12, this scenario can't pass even once it's built |
| 4 | 20 minutes left: keep the priority work and update the remaining time | **Gap** | today.md §4: `Shorter session` is "out of milestone scope, hide it". `shortenSession` has no spec. The only entry is coach-sheet's `Short on time` chip (CS6). No in-workout remaining-time estimate is designed or built (`estimateRemainingDuration` doesn't exist in code) |
| 5 | Correct 100×8 → 95×8; history and recommendations follow | Built (partly) | `EditSetScreen` → `correct_set`, version-guarded. Summary and `calculateNextTargets` read the actual values. Progress and the coach don't exist yet |
| 6 | Same file imported twice: no duplicates | Designed | data-import-export (checksum, `Undo this import`). Not built (`Import from FitNotes: Not in this build yet`). Still blocked on a real FitNotes export from Ben |
| 7 | Restart: session and coach memory survive | Built (session) / Designed (memory) | Cold start into the workout, draft restore and deadline restore are built and tested. Coach memory is only specified (coach-memory.md) |
| 8 | No network or model: logging works, status is honest | Built | No AI anywhere. Talk shows "Not in this build". Summary tags `Built-in rule (coach not connected)` |
| 9 | No wearable data: the coach doesn't invent it | Designed (trivially true now) | v0.9 parks wearables. CI14 removes wearable fields from the check-in. Needs a coach-prompt test when the coach lands |
| 10 | Pain: stop progression, no diagnosis | Built (partly) | A check-in `Pain` with chosen movements sets flags, and `calculateNextTargets` returns `halted_pain`. In-workout `Adjust → Pain` and "soreness or pain?" (CM6) are only designed |

### Brief §10 additional acceptance scenarios

| Scenario | Status | Evidence |
|---|---|---|
| Home gym with dumbbells up to 30 kg: per-hand loads, nothing unavailable | Built in the domain, **not enterable** | `equipment.ts` bounds by min/max and steppers disable past the limit. But the gym comes only from a preset checklist (`GymSetupFlow`, SP3: read-only until the gym editor exists), so Ben can't set his real rack top or increments |
| Switch to a hotel gym mid-session | Designed | gym-editor GE7, `setActiveGym` proposal. The workout's gym line is a label, not a chip |
| Machine reaches its maximum | Built | `progression.ts` `ceiling_reached` holds the load, caps the reps and suggests a substitution |
| Spoken "one fifteen" in a noisy gym | Designed | voice.md §4, §7. DEP-STT passed in en-US only. No parser in code |
| Interrupt a spoken reply | Designed | voice.md |
| Bluetooth drop, phone call or restart | Built (session) / Designed (audio) | Session recovery is built. The audio-coach Swift module exists as a probe only |
| Text is eligible but voice isn't | Designed | ai-connection.md, CHANGELOG v0.6 |
| OAuth revoked or budget gone: no paid fallback | Designed | ai-connection AC1. Nothing to test yet |
| Same spoken turn twice: one commit | Built for taps, designed for voice | opId dedupe in the reducer (`processed_operations`). The voice path doesn't exist |
| Reschedule by voice | Designed | weekly-plan Phase B plus voice.md. Not built |

**Net:** 2 of the 20 scenarios pass end to end (8 and machine max). About 5 pass in part. One is a real design gap (4), and one can't pass until Ben approves a rule (3).

---

## 2. Top 10 improvements (value to Ben ÷ effort)

| # | Improvement | Why it matters to Ben | Effort | Refs |
|---|---|---|---|---|
| 1 | **Routines plus "Repeat last workout"**, before anything else in slice 3 | Every session today is `Start empty workout` → pick each exercise from 29 starters → add sets. That is the slowest part of the loop by far. Hevy and Strong open on your routines. Repeat-last (RT4) is the cheapest version and also feeds `Last` and `Next time` | M | routines.md RT2/RT4; today.md planned card; ADR 0010 "Not built" |
| 2 | **Wire the Restore UI and finish the SideStore trial run before real workouts** | The milestone requires a tested restore before any real workout (CLAUDE.md "First design milestone", ADR 0004/0005). `DatabaseManager.restore`/rollback already exist in `packages/persistence/src/manager.ts`. Only the screen is missing. Today Data & backup tells Ben to "do the trial run … restore", which he can't do in the app | S | `DataBackupScreen.tsx:91,133`; manager.ts:165 |
| 3 | **Minimal gym editor: dumbbell range and step, plate counts, stack step and max** | Rule 4 is only as true as the inventory. Preset values are `not checked` and can't be edited, so steppers and `Next time` may offer loads Ben's gym doesn't have. Skip travel gyms, attachments and out-of-order for now | S–M | gym-editor.md §2; SP3; GE1 |
| 4 | **Plate breakdown and warm-up ramp on barbell sets** (Strong/Hevy pattern) | A small line under the load (`20 bar + 25 + 10 + 2.5 / side`) saves mental maths every set and makes the app feel expert. A warm-up ramp on the first working set removes manual warm-up logging. The domain already computes plate subset sums (`equipment.ts:86`), and `buildPlateSetup` is in the brief §4 | S | brief §4 table; active-workout §2.1 |
| 5 | **Pull FitNotes import forward (ask Ben for the export now)** | Without history, `Last` lines are blank and the built-in rule has nothing to work with for weeks. The coach is also blind. Hevy, Strong and Fitbod all lead with import. The schema can't be done without the real file (brief §11) | M (blocked on the file) | data-import-export.md; open-decisions §C |
| 6 | **ChatGPT sign-in spike S1, then the smallest coach slice** (path A `Adjust` → `Too hard/Too easy`, plus summary `Next time`) | The coach is the stated differentiator over Hevy + ChatGPT and LiftTrack Max (brief "Proposed advantage"). Roughly 3,000 lines of coach specs rest on a route that has never run on the phone. Prove S1 (or the API-key route) before writing more coach design | M–L, uncertain | ai-connection.md; DEP-AI; ADR 0006 consequences |
| 7 | **Make `Rest after` tappable, and remember per-exercise rest** | The brief §12 target is "editable rest presets visible before training". Today `Rest after: 3:00` is static text (`WorkoutScreen.tsx:689`), and the only presets are the onboarding defaults of 60/90/180 | S | rest-state §2.4; P9 |
| 8 | **Fix the Live Activity (DEP-LIVE), then add a lock-screen countdown with the next set** | Strength users check the lock screen during rest. Hevy ships this. The notification works, but the countdown is what makes it feel premium. Most of the fix (runtime App Group) is already built and waiting on a retest | S–M | probe-build7; ADR 0007; lock-screen-and-alerts §2.1 |
| 9 | **Overview table (FitNotes-style)** | Ben comes from FitNotes, and the brief §12 promises it. It's the fastest way to see the whole session, fix a set or log out of order | M | active-workout §2.4 |
| 10 | **One "moment" on the Summary**, kept honest | Today the Summary is a facts list. Add one headline: `Heaviest bench top set on this bar: 102.5 kg × 6` (actual, like-for-like, already computed by the comparison), a hairline, and the serif headline the Third Space reference proposes. Plus one success haptic on Finish. That's delight with nothing invented | S | workout-summary §2 region 4; thirdspace §5–6.5 |

Just outside the top 10:
- **In-workout `~25 min left`** from a deterministic `estimateRemainingDuration`. Small, and it is half of scenario 4.
- **A default rule per exercise category**: big compounds at 5–8 reps, isolation at 8–12. The provisional 8–12 for everything (ADR 0010) is wrong for squat and bench for a strength lifter. Taste call, see §4.
- **Hide the dead 60×60 Talk button** until voice exists (see §4).

---

## 3. Over-engineering: simplify or cut for a one-person app

The design corpus is about 14,000 lines across 25 specs, and `open-decisions.md` asks Ben for 18 calls plus about 150 bulk defaults. The build is careful. The specs are ahead of it by several build steps, and every addition costs developer and reviewer time.

1. **Two data domains with independent section restore, export and reset** (README "Your data / Coaching knowledge", DX11, check 13a, `formatVersion: 2`). The built `restore` swaps the whole database, which is right. **Simplify:** one backup and one restore. The catalogue and playbook ship with the app and are re-seeded by ID. Keep the *labels* in the coach context view only.
2. **Check-in machinery** (679 lines, CI1–CI14): a 2 h reuse window, an unlinked-check-in line on Today, versioned edit history, a Progress card with a points-only chart, day and threshold settings, and spoken number-only grammar. **Simplify:** score, optional chips and a note stored on the session. `Pain` → choose movements → flag. Editable from the summary. Drop the reuse window, the Today line and the Progress card until two weeks of use show they're wanted (Ben's own brief says "retain only widgets Ben finds useful after two weeks").
3. **Playbook as an in-app approval workflow** (coaching-playbook.md: candidate and approved rules, evidence grades, guide PDF ingestion and on-phone search, conflicts and source precedence, `validateCitations`, approval records in backups). **Simplify:** Ben approves rules in `docs/training-guides`. The approved set ships as a versioned JSON bundle the coach prompt reads. Guardrails stay in code. Cut guide-PDF ingestion.
4. **Proposal model** (change-review: 9 kinds, 4 scopes, variants, `supersedesId`, overlap marking, 30-day `Not now`, expiry rules CR1–CR8). **Keep:** today vs future, base version, Apply/Undo, reason. Start with 3 kinds (`adjust_pending_sets`, `swap_exercise`, `update_template`) and add more when a feature needs one.
5. **In-app spend caps with usage estimates** (AC2/AC3/AC7, B10 "$5 text, $2 voice"). Caps set on OpenAI's dashboard are authoritative, and in-app estimates are guesses. **Simplify:** show "uses your API key, billed by OpenAI", a link to the usage page, and a hard on/off. That still satisfies rule 7.
6. **Animated exercise-guide engine** (`packages/catalogue/src/figure/*`, about 2,100 lines of rig, pose, keyframes, SVG and checks, plus two agents, plus a pending Skia/Reanimated dependency). Ben asked for visual guides (v0.9), but the static key frames already rendered (`preview.png`) give most of the value at a fraction of the cost. **Recommend:** ship static frames and decide on animation after using the app. (Taste call; see §4.)
7. **Weekly review coach call with numeric verification** (PG18/PG19) and records needing 3 earlier sessions, streaks and sets per muscle. Fine ideas, but Progress isn't built. **Start with:** lift trends and a calendar.
8. **Unilateral auto-paired partner sets** (active-workout §2.9: `pairedWithSetId`, side-lag holds, partner removal on Undo). **Simplify:** log `per side` by default, with an optional L/R note. Revisit if Ben actually logs sides differently.
9. **Stacked revision banners at the top of specs.** today.md has 6 before its Purpose, and active-workout and summary have 5 each. **Fix:** keep specs as the current truth and move revision history to git or a changelog section at the bottom. This cuts reading cost for every agent.
10. **Coach memory lifecycle** (suggestions expire after 14 days, `Worth checking` after 6 months, history and versions). **Start with:** a plain list Ben can add, edit and delete, and "remember X" saving with Undo.
11. **App status with dated evidence in the user UI** (system-states). Keep the signing-expiry reminder, which is a real SideStore risk. Move everything else to Developer.

---

## 4. Clear-cut fixes vs taste calls

### Clear-cut (objectively right, consistent with CLAUDE.md; no Ben call needed)

1. **Restore UI before real workouts.** CLAUDE.md milestone and ADR 0004/0005. The engine exists (`manager.ts:165`). Until it ships, Data & backup should say plainly: `Restore isn't in this build. Keep a copy in Files; don't rely on this build for real training yet.` The current line asks for a trial run he can't finish.
2. **Brief banner is stale.** CLAUDE.md says the approved amendments are summarised at the top of the brief, but the banner stops at v0.4. v0.5 (workout builder), v0.6 (ChatGPT Pro and voice plan), v0.7 (data domains, in-app backups), v0.8/v0.9 (wearables parked, check-in, exercise bank) are only in the CHANGELOG. The brief body still says "quick readiness check" (§1), `ReadinessEntry … and any sourced wearable metrics` (§6) and "Optional readiness: Normal / Tired / Sore" (§12). open-decisions "For the product manager" already lists the wording.
3. **CLAUDE.md package list is missing `packages/persistence`**, which exists per ADR 0005. Add it.
4. **The missing device-test checklist.** `docs/device-tests/2026-10-08-probe-build7.md:35` points to `morning-checklist.md`, which doesn't exist. Ben has no test list for the first real-app build.
5. **Scenario 4 has no design.** Either specify a deterministic `estimateRemainingDuration` line in the workout and a `shorten` path (adjust_pending_sets removing lower-priority sets), or record in the CHANGELOG that scenario 4 is deferred.
6. **Scenario 3 depends on an unapproved rule.** Put rule 12 (C2/C3) at the top of Ben's approval list, or the scenario is unpassable by design (weekly-plan WP5).
7. **A gym inventory Ben can correct** before real logging (rule 4: "achievable on the selected gym's real equipment"). Presets marked `not checked` but read-only can't satisfy it.
8. **`Rest after` must be editable** (brief §12 usability target; P9 says "tap to edit"). It's static text today.
9. **Add an acceptance check for scenario 2** (the coach mentions related recent work and hedges causation) to coach-sheet.md. Every other scenario has one somewhere.

### Taste calls for Ben

| # | Question | Critic's lean |
|---|---|---|
| T1 | Check-in sheet on every Start (one extra tap) vs an inline row vs only on chosen days (B15) | Keep it, cut the copy to `How are you feeling?` · `Before Push A` and drop "Saved with this workout. Nothing changes unless you say so." Review after 2 weeks as planned |
| T2 | Default built-in rule: 8–12 for everything (ADR 0010) vs category defaults (compounds 5–8 or 3–6, isolation 8–12/10–15) | Category defaults, since Ben trains for strength |
| T3 | Talk button: show it disabled (`Offline`, per flow check 6) vs hide it until voice ships | Hide it. A 60×60 control that opens "Not in this build" wastes the best thumb spot and isn't premium |
| T4 | Motion: "no animations other than navigation and sheets" (today check 10) vs small ≤200 ms micro-interactions (Log → check morph, number tick, rest-ring sweep) | Allow a few, with Reduce Motion respected. A premium feel needs some motion. Gamified rings and streak headlines stay out |
| T5 | Display serif (Newsreader) for 2–3 headings (Third Space ref §6.5, needs an ADR) | Try it on the Summary headline only |
| T6 | Copy: `How you said you felt: 2 of 5` (summary, Progress) | `Check-in: 2/5 · Tired`. The current phrasing reads clinical and long |
| T7 | Two near-identical durability phrases, `Saved on this phone` / `Backed up on this phone` | Fine if both stay, but the summary needs only one line: `✓ Saved · backed up 19:05` |
| T8 | Animated exercise guides vs static key frames (provisional item 5, ADR 0011) | Static first |
| T9 | Repeat-last vs full routine editor first | Repeat-last first, then the routine editor |
| T10 | Readiness offers: lighter-session offer on the first set card (B16) | OK as designed; it never speaks and needs no tap |

---

## Top 5 (summary)

1. **The loop is fast but has nothing to load.** No routines, no import and no editable gym means every session is an empty workout built by hand on preset equipment. Build Repeat-last/routines and a minimal gym editor next, and get Ben's FitNotes export now.
2. **Data safety isn't milestone-complete.** The restore engine and rollback exist but have no UI, so the required trial run can't be done. Ship Restore, fix the "do the trial run" copy, and write the missing morning checklist.
3. **The coach is the differentiator and is entirely unproven.** About 3,000 lines of coach specs, zero calls on the phone. Run S1 (or the API-key route) and build the smallest slice: `Adjust` → Too hard/Too easy, plus coach `Next time`.
4. **The specs are over-built for one user.** Two-domain restore, the check-in apparatus, the in-app playbook approval workflow, a 9-kind proposal model, in-app spend estimates and an animated figure engine should be cut or deferred. Strip the stacked revision banners from specs.
5. **Cheap premium wins are available:** plate breakdown plus a warm-up ramp, editable `Rest after`, a working Live Activity, one honest Summary highlight with a success haptic, and hiding dead controls. Brief scenarios 3 and 4 need fixes on paper first: approve rule 12, and design a remaining-time and shorten path.
