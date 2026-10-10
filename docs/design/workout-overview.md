# Workout overview (the page before the first set)

Status: v0.1, 10 Oct 2026. Asked for by Ben ("a one page overview ahead of doing a session"). Synthesised from three concepts. The base is "The plan at a glance", with grafts from "Ready in one place" and "The coach's briefing". Research: [competitor-first-pages.md](../research/competitor-first-pages.md) ideas 2–8 (13 later). Its idea 1 ("no separate page") is overruled by Ben's ask. Mockup: [mockups/workout-overview.html](mockups/workout-overview.html).

Rules: CLAUDE.md 1 (offline, no canned coach), 2 (no silent changes), 3 / D21 (coach's small next-session changes shown with reason and Undo), 4 (achievable loads), 5 (versioned, op IDs, stale rejected), 6 (targets vs actuals vs estimates), 9 (pain holds progression), and the minimal-copy convention. Look: Direction D dark (`PREMIUM_DIRECTION` in `apps/mobile/src/theme/tokens.ts`). It adds no colour values and no web fonts.

**Name.** In specs this is the **Workout overview** (route `WorkoutOverview`). It is not the in-workout `Overview` mode (Focus | All) in active-workout.md. The screen itself has no title word.

---

## 1. Purpose

Ben gets four answers in about three seconds, before anything is created: **what** (`Push A`), **where** (gym chip), **how long** (`≈ 55 min`, done `≈ 19:05`, `15` sets) and **what he will lift** (every exercise, its sets × reps and a large target load, each with a one-word change marker against last time).

There is one primary action, `Start workout`. The page is read-only apart from the edits in §6. Opening it creates no session, makes no AI call and needs no network.

---

## 2. Entry points and flow

### 2.1 Entry points

| From | Opens |
|---|---|
| Today, Up next card: `Start workout`, a tap anywhere on the card, or a hero detail row | The overview for Up next (`services.next.preview`: the rotation routine (D19), or the last workout's next session when the last workout wasn't a routine) |
| Today, Done today → `Start another workout` | The overview for Up next |
| Today, `Your routines` row / Plan → Routines row (replaces the routine sheet's `Start this routine`) | The overview for that routine. The routine's `Rename` and `Delete` move to the overview's `⋯` menu. **There is one pre-workout page, not two.** |
| Resume, P6 auto-open, stale card | **Never the overview.** These are unchanged |
| `Empty workout`, `Build a workout` → `Start now`, Repeat → `Start workout`, voice "start my workout" | Unchanged: no overview. These keep the `CheckInSheet` from check-in.md when a check-in is due |
| First ever (no history, no routines) | No overview. Today's First workout hero goes straight to an empty workout |

Presentation: a full-screen modal that slides up (`presentation: 'fullScreenModal'`, standard native-stack animation). Start replaces it with Workout (Ready on the first pending set). Close (chevron-down, or swipe down from the top) returns to Today. Nothing is started.

### 2.2 Flow and tap count (to the first logged set)

```
Today ─ Start workout ─► Overview ─┬─ Start workout ─────────────────────────────► Workout (Ready) ─ Log
                                   ├─ score 4–5 (above What's up?) ── saved ─► Start ─► Workout ─ Log
                                   ├─ score ≤ What's up? setting ─► What's up? sheet ─ Done/Skip ─► Overview ─ Start ─► …
                                   └─ Close / swipe down ─► Today (nothing created; a tapped score stays saved, unlinked, 2 h)
```

| Case | Taps | Before (today.md / check-in.md) |
|---|---|---|
| Check-in off or not due | **3**: Start → Start → Log | 2 |
| Due, ignored (counts as `skipped`) | **3** | 3 (Start, Skip, Log) |
| Due, scored 4–5 | **4**: Start → score → Start → Log | 3 |
| Due, scored ≤ What's up? setting | **5**: Start → score → Done → Start → Log | 4 |
| Reused check-in (< 2 h) | 3. The chip shows it already selected | 2 |
| First Start ever | +1 for the Rest alerts sheet (premium-feel §3.5), shown **after** the overview's Start. Either answer continues the same Start | same |

The overview costs one tap. That is the price of the page Ben asked for. Mitigations: Resume skips the page, the check-in is no longer a modal on this path, and a long-press `Start now` on Today is possible (decision for Ben, §11).

**Where the check-in lives now.** On this path it is an optional inline row in the overview's fixed bottom bar, shown only when `shouldAskCheckIn` says `ask` or `reuse`. A tapped score is saved at once (`recordCheckIn`, CI4). A score never starts the workout. A score at or below the "What's up?" setting opens check-in.md's Step 2 as a sheet **over the overview**. Its `Done`, `Skip`, `Not now`, `Flag n movements` and `Train anyway` all return to the overview with the plan re-rendered (a new pain flag shows `HELD` at once). `Skip workout` closes the overview to Today's skipped state, exactly as before. Because the session still doesn't exist until Start, CI1 holds unchanged. Starting with no score records `{kind: 'skipped'}`.

---

## 3. Layout (390 × 844, top to bottom)

Canvas `bg.canvas`, side margin 20 (`components.screenMargin`). The list scrolls. The top bar and bottom bar are fixed.

1. **Top bar (44 pt).**
   - Left: chevron-down `Close` (44 pt).
   - Right: `GymChip` `Main gym ▾` (34 pt visual, 44 pt hit, `border.control` outline), then `⋯` (44 pt). The menu holds `Other routine` · `Empty workout` · `Edit routine` (routines only; it becomes `Rename` · `Delete` until the routine editor exists).
2. **Eyebrow** (`type.sectionLabel`, 12/600, tracked 1.4, caps, `text.tertiary`). It is the D19 basis, an actual: `AFTER PULL A · THU 8 OCT`. Variants: `START OF YOUR ROTATION` · `ONLY ROUTINE` · `LAST DONE MON 5 OCT` (a routine opened from the list) · `NEXT SESSION · FROM THU 8 OCT` (not a routine) · `NEW ROUTINE` (never done).
3. **Title** (40/46, 600): the routine or workout name. It wraps to 2 lines and never truncates.
4. **Stat strip.** Three equal columns between `border.divider` hairlines (`StatStrip`, new):
   - `≈ 55 min` / `TIME`
   - `≈ 19:05` / `DONE BY`
   - `15` / `SETS`

   Numerals are 32/300, tabular, `text.primary`. `≈` and `min` are `text.secondary`. Labels use `type.sectionLabel`. `TIME` is `estimateRemainingDuration` over the unstarted plan with recent pace, rounded as active-workout §2.15. `DONE BY` is now + that, rounded to 5 min, refreshed once a minute (`timing.timeLeftRefresh`). `SETS` counts working sets only. Estimates always carry `≈`.
5. **Muscles** (`type.callout`): `Chest · Shoulders · Triceps`. The primary muscle is in `text.primary`, the others in `text.secondary`. It is text only, from catalogue data (Coaching knowledge). There is no body figure and no `guide.muscle`.
6. **List header** (`type.sectionLabel`): `5 EXERCISES` on the left, `TARGET` on the right. This column header is the "Target" label for every load (rule 6), so rows don't repeat the word.
7. **Exercise rows** (`OverviewRow`, new; min 64 pt; `border.divider` between rows; the whole row is one button):
   - Index `01` (16/500, tabular, `text.tertiary`).
   - Name (17/600).
   - Detail line (`type.callout`, `text.secondary`, tabular): `3 × 6–8 · 3 warm-ups`. Timed sets show `3 × 0:45`. AMRAP shows `3 × 8+`. Unilateral shows `3 × 10 each side`.
   - Right column:
     - **Change marker** (`ChangeMarker`, new): 12/600 tracked caps, `text.secondary`, with an arrow glyph where it has one.
     - **Load** (22/500, tabular, `text.primary`), with its unit in 16 pt `text.secondary`: `100 kg` · `32 kg each` · `25 kg` (stack) · `−20 kg` (assisted; VoiceOver "20 kilograms of assistance") · `BW` / `+10 kg` (bodyweight / added).
     - When the snap changed the target (`StartWarning` `target_rounded`, bounded or converted), an `info.circle` glyph (14 pt, `text.tertiary`) sits after the load. The reason lives in the row panel. `≈` is never used for rounding: it is reserved for estimates.
   - **Superset**: a `SUPERSET` eyebrow above the group and a 3 pt `text.tertiary` bracket down the left of its rows. VoiceOver: "Superset with Triceps pushdown".
8. **Row panel** (one open at a time; a tap toggles it in place). It is a `bg.surface` block, `radius.md`, inset under the name. It holds label/value pairs (labels `type.sectionLabel` `text.tertiary`; values `type.callout`, tabular). Each line shows only when it applies:
   - `CHANGE`: `↑ 2.5 kg · vs 1 Oct` (the marker's size and its basis date).
   - `LAST`: `97.5 kg × 8, 8, 8 · 1 Oct` (actual working sets from the last comparable session).
   - `WARM-UP`: `20 × 10 · 60 × 5 · 80 × 3` (first barbell exercise only).
   - `PLATES`: `25 · 10 · 5 a side · 20 kg bar` (first barbell exercise only, when the gym has a plate inventory).
   - `BEST`: `102.5 kg × 5 · 12 Sep` (first barbell exercise only; an actual set, never e1RM).
   - `ROUNDED`: `Stack goes 15 → 17.5 → 20` / `Rack tops out at 30 kg` (from `startWarningNote`).
   - `FLAG`: `⚠ Shoulder · 6 Oct`, with `Still hurts?` (`isPainCheckDue`) as a link to the pain flag sheet.
   - `COACH`: the stored one-line reason, in quotes, clamped to 2 lines (only once the coach is live, §5).

   Actions are outline pills, 44 pt: `How to` (exercise guide), `History` (Progress → exercise), `Why?` (the `TargetWhyPanel` content from active-workout §2.12, in a sheet), and `Undo` / `Use coach target` on coach rows (§5).
9. **Fixed bottom bar** on the canvas, with no rule above it and a 14 pt fade over the list:
   - **Check-in row** (only when due or reused). A `CHECK-IN` label on the left, five tiles `1`–`5` on the right (`CheckInScale`, 50 × 52 pt at 390 pt, `radius.pill`, `border.control` outline). The selected tile is `accent.subtle` fill + 2 pt `accent` border + `checkmark`, **never an accent fill**, so Start stays the only filled pill. There are no end labels: VoiceOver says "1 of 5, rough" … "5 of 5, great". Keep **≥ 20 pt** between the tiles and Start.
   - `Start workout`: `PrimaryButton`, 60 pt pill, `accent` / `on.accent`, full width.

---

## 4. Change markers (`targetChangeMarker`, pure, `packages/domain`)

Each row gets one word, set by the first rule that matches. It compares this preview's first working set with **the last comparable session's working targets** for the exercise. A session is comparable if it used the same equipment kind and load convention (ADR 0016). If that session had no targets (imported, empty workout), the comparison uses its heaviest working actual for load only.

| # | Marker | When | Style |
|---|---|---|---|
| 1 | `⚠ HELD` | An active pain flag covers the exercise (`painFlagCovering`). The load is never above last time | `status.warning`, icon + word |
| 2 | `NEW` | No comparable session | `text.secondary` |
| 3 | `⚠ NO LOAD` | The load target was dropped here (`target_dropped`, `equipment_not_in_gym` with no substitute). The load cell shows `—` | `status.warning`, icon + word |
| 4 | `↑ UP` / `↓ DOWN` | The working load differs (after unit/convention normalisation). A deload or a rounding/cap that lands lower is `DOWN` | `text.secondary` |
| 5 | `↑ REPS` / `↓ REPS` | Same load, and the rep target's lower bound differs | `text.secondary` |
| 6 | `↑ SETS` / `↓ SETS` | Same load and reps, and the working set count differs | `text.secondary` |
| 7 | `SAME` | Nothing differs | `text.secondary` |

Markers never use `status.done`, `status.danger` or `accent`. The panel's `CHANGE` line gives the size (`↑ 2.5 kg`, `↑ 1 rep`, `↑ 1 set`). VoiceOver reads "Load up 2.5 kilograms from 1 October".

---

## 5. Coach (hidden until coach v1 merges)

- **No coach configured, or coach v1 not merged:** nothing coach-related renders. There is no tag, no slot, no status line and no `Built-in rule` tag on rows. The `Why?` sheet still says `Set by Built-in rule`.
- **Coach live, with a stored D21 small change for this routine:** the row adds `SourceTag` `Coach` (`text.bubble` icon + word) beside the marker. Its panel shows `COACH "…"` (the stored reason) and `Undo`. Undo calls the **same versioned command as the Summary's Next time row**: that exercise goes back to the built-in rule, the marker re-computes, a toast reads `Incline dumbbell press · built-in rule` [Undo], and the panel offers `Use coach target`. A stale version is rejected and the page re-renders (rule 5). This page is the last place to undo before Start uses the change.
- **Coach configured but offline:** nothing on the page changes. Stored coach targets are still shown, because they are already saved. The `Why?` sheet says `Built-in rule (coach offline)` where it applies.
- If a late coach result (CA10) saves new targets while the page is open, the affected rows update in place and the preview key changes (§7).
- Opening the page never calls the coach, and the page has no lighter-session offer. CI5's offer stays in the first set card.

---

## 6. Edits allowed on the page, and how they are recorded

| Edit | Call | Recorded as |
|---|---|---|
| Gym | `selectGym(gymId)` (selection only; there is no session yet). Every row re-snaps and re-marks, toast `Hotel gym · 2 targets changed` [Undo] | Owner setting, versioned, op ID |
| Check-in score | `recordCheckIn` on the first tap, then `updateCheckIn(id, {score}, expectedVersion, opId)` on a change | `CheckIn`, Your data. It is linked by `startWorkout` in the same transaction |
| What's up? / pain / ill | check-in.md §4.1 unchanged | as check-in.md |
| Pain flag review (`Still hurts?`) | `recordPainFlagReview` / `clearPainFlag` via the existing sheet | as active-workout §2.14 |
| Coach Undo / Use coach target | The Summary's Next-time commands (`undoAction` on the D21 action; re-apply) | `ActionRecord`, versioned |
| **Start** | `services.workout.start({gymId, routineOf \| nextOf, opId, checkIn, expectedPreviewKey})` | One session write. The `opId` is minted at the first Start tap and reused for every retry until success or the page closes. A double tap creates one session |

**Not in the first slice:** `Swap today`, `Skip today`, reorder and the return-after-a-break offer (idea 13). Each needs edits to a session that doesn't exist yet, which means a persisted pre-start draft plus an `edits` input to `startWorkout`. That is a schema, backup and ADR change, and it needs Ben's go-ahead. Today, Ben swaps or skips in the workout as before.

---

## 7. Preview = what Start creates

- `buildWorkoutOverview(input)` (pure, `packages/domain`) shapes the view from the **same dry run** Start uses: `planRoutineStart` / `startFromSession` with `preview: true` (as `services.next.preview` already does), plus `getComparableHistory`, active pain flags, `estimateRemainingDuration`, catalogue muscles, the check-in gate and stored D21 actions.
- It returns `previewKey`, a stable hash of every input that can change a target:
  - routine id + version
  - gym id + equipment versions
  - the target-source session id + version
  - active pain flag ids + versions
  - D21 action ids + versions
  - the owner's unit
- Start sends `expectedPreviewKey`, and the service re-plans inside the start transaction. **On a mismatch nothing is created.** The page re-renders with the new rows, and the toast `Targets updated` appears. Ben taps Start again (rule 5: never apply stale).
- `services.overview.load({kind: 'next'} | {kind: 'routine', routineId}, gymId)` is the only read. It is local, has no AI and never throws: it returns `null` if the preview can't be built.

---

## 8. States

| State | Shows |
|---|---|
| Loading | Nothing for 300 ms, then static blocks (no shimmer) |
| Normal, check-in not due | §3 without the check-in row |
| Check-in due / reused / answered | Row with no selection / the reused score pre-selected / the tapped score selected |
| What's up? sheet | check-in.md Step 2 over the overview. Dismissing it keeps the score |
| Pain flag | Row `⚠ HELD`, load ≤ last time; panel `FLAG` (+ `Still hurts?` when due) |
| Rounded / capped target | `info.circle` after the load; panel `ROUNDED` |
| Equipment missing here | `⚠ NO LOAD`, load `—`, reps kept; panel says which item is missing and links `Edit gym` |
| Superset | Bracket + `SUPERSET` eyebrow |
| No coach / coach offline | Nothing extra (§5) |
| Coach changes stored (after coach v1) | `Coach` tag, panel reason + `Undo` (§5) |
| No gym | Chip reads `Add gym`. Rows are previewed against the typical-gym preset that Start will save (`setup.useTypicalGym`), so the rows still match. One `NoteLine` under the strip: `⚠ No gym · typical equipment` |
| Offline / AI unavailable | Identical. Nothing here needs network |
| Fresh install (default pace) | Same strip with `≈`. No extra words |
| Preview unreadable | `Couldn't load this workout.` [Try again] and the link `Empty workout` |
| Start failed | `⚠ Couldn't start. Try again.` above Start. The page, score and gym stay. The retry uses the same op ID |
| Stale preview on Start | Rows re-render, toast `Targets updated`, no session (§7) |
| A workout became active (another path) | Start returns `session_already_active`: the overview closes and Today shows Resume |
| Force-close on the overview | No session. Relaunch opens Today. A tapped score is unlinked and reused within 2 h (CI4), so it shows pre-selected next time |
| Dynamic Type AX1+ | The stat strip stacks (value + label per line). Rows stack the load under the name, and the warm-up fragment drops first. Numbers never truncate. Check-in tiles collapse to one `Check-in ›` button that opens `CheckInSheet` Step 1. A score there returns to the overview |
| VoiceOver | Order: Close, gym, menu, eyebrow, title, strip (one element: "About 55 minutes, done about 19:05, 15 working sets"), muscles, rows (one button each: "1, Bench press, 3 sets of 6 to 8, 3 warm-ups, target 100 kilograms, load up. Expands."), check-in, Start. The escape gesture = Close |
| Reduce Motion | The row panel appears without the height animation |

---

## 9. Copy (complete; values and actions only)

`Close` (VoiceOver) · `Main gym ▾` · `Add gym` · `Other routine` · `Empty workout` · `Edit routine` / `Rename` / `Delete` · eyebrows in §3.2 · `TIME` · `DONE BY` · `SETS` · `N EXERCISES` · `TARGET` · `SUPERSET` · markers in §4 · `warm-ups` · `each` · `each side` · panel labels `CHANGE` `LAST` `WARM-UP` `PLATES` `BEST` `ROUNDED` `FLAG` `COACH` · `Still hurts?` · `How to` · `History` · `Why?` · `Undo` · `Use coach target` · `CHECK-IN` · `Start workout` · toasts `Hotel gym · 2 targets changed` / `Targets updated` / `Incline dumbbell press · built-in rule` · errors `Couldn't load this workout.` / `Couldn't start. Try again.` · `No gym · typical equipment`.

The page has no explanation lines, no reassurance and no rule names. Explanations live behind `Why?`.

---

## 10. Data and code

- **New pure functions (`packages/domain`, unit-tested):**
  - `targetChangeMarker(planned, comparable, painFlag, warnings)` → `{kind, delta?, basisDate?}`
  - `buildWorkoutOverview(...)` → view + `previewKey`
  - `previewKey(...)`
  - `platesPerSide(load, bar, inventory)`, if not already in `equipment.ts`
- **Service:** `services.overview.load`. `services.workout.start` gains `expectedPreviewKey` (a stale key returns `{ok: false, code: 'stale_preview'}`).
- **Screen:** `apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx`, route `WorkoutOverview` (`{kind: 'next'} | {kind: 'routine', routineId}`) in `AppNavigator.tsx`. The screen formats only. It computes no targets, markers or durations.
- **Today** navigates to `WorkoutOverview` instead of starting. The `start()` handler moves to the overview. The `CheckIn` route stays for the paths in §2.1 that skip the overview.
- **New components** (design-system follow-up): `StatStrip`, `OverviewRow`, `ChangeMarker`, `SupersetBracket`.

---

## 11. For Ben to confirm

1. **The extra tap.** It is 3 taps to the first set (was 2). Should a long-press on Today's `Start workout` → `Start now` skip the overview? Recommendation: don't build it, and re-check after two weeks of real use.
2. **Check-in moves onto the overview** (amends check-in.md CI2). Ignoring the tiles counts as Skip, a score never starts the workout, and a low score's What's up? returns to the overview. CI1 is unchanged.
3. **Swap/Skip today, reorder and "Lighter start?" are deferred.** They need a pre-start draft (an ADR). In the first slice, rows expand to show the facts, `How to`, `History` and `Why?` only.

Follow-ups for the product manager (not edited here):
- flow-first-milestone tap counts
- premium-feel §2.6 (the routine sheet is replaced by this page)
- routines.md routine row
- research idea 2's "2 taps" check
- design-system components
- the 12 pt `sectionLabel` vs the 16 pt floor (an existing token conflict)
- `CheckInScale` inline tiles at 50 × 52 vs the sheet's ≥ 52 × 60 (check-in check 28); confirm on device

---

## 12. Acceptance checks

- **OV1.** Today `Start workout` opens the overview with no session row created. Close or swipe down returns to Today with none.
- **OV2.** Check-in not due: Start → Start → Log logs the first set in 3 taps. Due and ignored: 3 taps, and the session's `checkIn.kind` is `skipped`.
- **OV3.** For every load convention (barbell total, per dumbbell, stack, assisted, bodyweight + added, timed), each row's sets, reps and load equal the pending targets of the session that Start creates (test over the shared dry run).
- **OV4.** Changing the routine, gym equipment, pain flags or a D21 action after the page opened makes Start create nothing, re-render the rows and show `Targets updated`.
- **OV5.** A double tap on Start, or a retry after a failed write, creates exactly one session (same op ID).
- **OV6.** `targetChangeMarker` unit tests cover:
  - each row of §4 and its order (pain beats load up; load beats reps; reps beat sets)
  - kg ↔ lb normalisation
  - per-hand dumbbells
  - an equipment max cap (`DOWN` + info glyph)
  - an assisted machine (less assistance = `UP`)
  - a different bar = `NEW`
- **OV7.** A pain-flagged exercise shows `⚠ HELD` (icon + word). Its target is never above last time's working load.
- **OV8.** With no coach configured, the rendered tree has no `Coach` SourceTag, coach slot or coach text (test). With a stored D21 change, `Undo` restores the built-in target through the Summary's command and rejects a stale version.
- **OV9.** In airplane mode with no AI, the page renders fully and Start works. The provider log shows no call from opening or using the page.
- **OV10.** A tapped score saves immediately. Force-quit, relaunch, reopen within 2 h: it shows pre-selected, and Start links it. A score ≤ the setting opens What's up?. Every exit from that sheet returns to the overview, and a new pain flag shows `HELD` before Start.
- **OV11.** Resume, P6 auto-open and the stale card never show the overview. With a session active, the overview can't be reached.
- **OV12.** Switching gym re-snaps every row, updates the markers and the stat strip, and Undo restores the previous gym.
- **OV13.** Only one filled pill (Start) is visible in every state. A selected check-in tile is `accent.subtle` + border + check. The tiles sit ≥ 20 pt from Start.
- **OV14.** At AX3 nothing scrolls sideways, no number truncates, the strip stacks, the check-in collapses to `Check-in ›`, and Start stays visible in the fixed bar. All targets ≥ 44 pt (tiles 52, Start 60).
- **OV15.** Status is never shown by colour alone (HELD, NO LOAD and the flag carry icon + word). Estimates always show `≈`. `LAST` and `BEST` are actual sets, never e1RM.
- **OV16.** `DONE BY` is rounded to 5 min and changes at most once a minute. It matches `estimateRemainingDuration` on the planned session at that moment.
- **OV17.** The routine list's row opens this overview for that routine, and its Start creates a session with `routineId` set. The rotation then continues from it (D19).
