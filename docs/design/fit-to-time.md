# Fit to time (How long? on the overview; built-in trim and coach fit)

> **Revision 22 Oct (Ben): optimised built-in fit, plan-aware.** When the time is shorter than the session:
> 1. **Free savings first:** shorter rests, then supersets if they're off (pairs work, loses none).
> 2. **Then the cheapest cut, step by step:** a set off an exercise (never below 2) or a whole exercise (saves its changeover). If one cut is enough, the one that loses least; otherwise the least training lost per minute saved. Value per set: compound accessory 3, isolation 2, abs 2.5 (his choice), extra 1.5. The main lift is never cut.
> 3. **The week is protected:** sets lost (2 or more) are offered on the next day for that muscle, capped at 4 (`+4 sets on your next Chest day · Undo`).
> 4. **Honest, without moving the screen:** the Time row shows the biggest change in light orange after the label (`Time · −1 exercise ›`); tapping it lists everything combined (shorter rests, supersets, `Incline DB press 3 → 2 sets`, `Dropped Triceps pushdown`, the carry-over with Undo). The card's exercise count and minutes update. Prototype: training-blocks.html (Today with a plan).

> **Your workout's Time (built 22 Oct; Ben, 22 Oct: "add option to reduce time").** The overview is retired, so the time control lives on Your workout (workout-builder-v3 §2.3). It uses the built-in fit Today's card uses (`fitToMinutes`), not a second algorithm, on today's draft only. Against the revision above:
> - **Built:** shorter rests first; never the main lift; no superset made, ever (Supersets off is a hard rule, design review V14); the note after Time in light orange (`−1 exercise`, `−2 sets`, `shorter rests`) with everything it changed behind a tap and a one-step `Undo`; more time brings back what was cut, up to the workout as it was, never more; offline, no coach call; the saved workout and the plan never change. No effort is pushed there and kept sets keep their own RPE (`pushEffort: false`).
> - **Not built, because the shared fit would have to change (which also changes Today's card, out of scope for this batch):** (1) supersets as a free saving when Supersets is on; (2) the cheapest cut by training lost per minute with the value weights (compound accessory 3, isolation 2, abs 2.5, extra 1.5): the shared fit still trims accessory sets last exercise first down to 2, then drops whole exercises by band (abs and no-group extras → the other group's isolations → accessory isolations → compounds), then gives back sets a drop freed; (3) the week's carry-over (`+4 sets on your next Chest day · Undo`). Today's card still pushes accessory last sets to RPE 9 (its step b). These need Ben's go-ahead to change Today's fit too.
> - The `How long?` sheet, the TIME tile and the coach fit (§3–§5, FT-C1 and FT-C10–C15) belonged to the retired overview; nothing replaces the coach fit here (the coach bar on Your workout can already change the workout).

Status: v1.0 draft, 11 Oct 2026. Build slice C of the Workouts library change ([routines.md](routines.md) §A8). Ben: "on the edit before starting … an option to choose how long the session should be, and then using GPT or a pre-existing option the session gets updated to reflect that time period". Research: [workout-library-and-duration.md](../research/workout-library-and-duration.md) R2, R3. Mockup: [mockups/workout-library.html](mockups/workout-library.html) frames 3 and 4.

Builds on [workout-overview.md](workout-overview.md) (TIME tile, OV3), [overview-today-edits.md](overview-today-edits.md) (pre-start draft, TE2, TE3, §11), [active-workout.md](active-workout.md) §2.15 (`estimateRemainingDuration`, Time left, `Finish by`, coach Shorten), [coach-adjustments.md](coach-adjustments.md) (CA1–CA3) and playbook v1 ("Session length: when time is short, keep the goal's priority order and cut sets, not load"). Rules: CLAUDE.md 1, 2, 3, 4, 5, 6, 9 and the minimal-copy convention.

---

## 1. Purpose

**Question:** "I've got 45 minutes. What does today look like if it has to fit?"

**Primary action on the page: still `Start workout`.** The sheet's own primary is `Trim to 45 min`. Fitting is optional and always undoable.

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| FT1 | **The TIME tile is the control.** `≈ 62 min ▾` opens the `How long?` sheet, in normal and Edit mode | It's where Ben already reads the length. No new row on the page |
| FT2 | **Two ways to fit, one sheet.** `Trim to 45 min` (built-in, deterministic, offline) and `Ask coach` (ChatGPT, online). One fit is live at a time; choosing one replaces the other (Undo brings the old one back) | Ben asked for "GPT or a pre-existing option". Rule 1: the built-in way always works |
| FT3 | **The built-in trim only shortens.** Order: trim accessory sets → skip accessory exercises → trim main lifts to 2 sets. Never skips a main lift, never raises a load, reps or sets, never shortens rest, never removes a top set or the warm-ups of a kept exercise (§4) | Playbook: cut sets, not load, keep the priority order. Matches the Shorten guards (`shorten_no_increase`, `rest_unchanged`) |
| FT4 | **The fit is stored as intent** (`TodayEdit {kind: 'fit', minutes}`) and re-runs after every other edit, gym change or new target. It runs **after** the planner, on the planned preview, and marks cut sets `skipped` (`skippedBy: 'before_start'`). So preview = Start (OV3) | Same pattern as TE2. A gym change can't leave stale cuts |
| FT5 | **Ben's own edits win.** A slot Ben edited (add, sets, reps, load, Bring back) is never trimmed or skipped by the fit | Rule 2 in spirit: the machine never overrides a choice Ben just made |
| FT6 | **Choosing a time applies the fit at once**, built-in trim and coach fit alike, with a before → after card and Undo (CLAUDE.md rule 3: Ben asked, today only). No Apply step on the fitted version. Swaps and supersets from the coach come back as a separate change card with `Apply` (today only). **Decided by Ben, 12 Oct 2026** (CHANGELOG) | Rule 3: a change Ben asked for applies immediately, with visible change and one-tap Undo |
| FT7 | **Every minute shown comes from `estimateRemainingDuration`**, with `≈`. The coach never supplies a number of minutes | Rule 6; research: estimates are users' top complaint |
| FT8 | **Start carries the time.** A live fit sets the session's `Finish by` to start + minutes, rounded up to 5 min. The Time left line then reads `on track for 19:45` or `about 7 min past 19:45`, and the coach's mid-workout Shorten offer (active-workout §2.15.4) can use it | One idea of "how long" from the overview through the workout |
| FT9 | **Mid-workout, the same trim** (slice C2): the Time left sheet's `Shorten to fit…` gets `Trim` beside `Ask coach`, running the same function on pending sets. Replaces AW12's offline caption | One rule before and during the workout; offline users get a fit too |
| FT10 | **Longer than planned:** the built-in trim does nothing (`Fits already`). `Ask coach` can add work, today only, within limits (§5.3) | Research: "shorten only" annoys users, but the built-in rule never invents extra work |

## 3. Layout (390 × 844)

### 3.1 The tile

```
│────────────────────────────────────────│
│  ≈ 62 min ▾│  ≈ 19:05  │     16        │ ▾ caret, text.secondary
│  TIME      │  DONE BY  │    SETS       │
│────────────────────────────────────────│
```
- With a live fit: `≈ 44 min ▾` over `TIME · FIT 45` (label `type.sectionLabel`, clock icon). When the fit can't reach the target: `≈ 52 min ▾` over `TIME · FIT 45`, and the card says so (§3.3).
- The tile is one button, ≥ 44pt tall: "Time, about 62 minutes. How long? button."

### 3.2 `How long?` sheet (`HowLongSheet`, medium detent)

```
┌────────────────────────────────────────┐
│ How long?                        Close │
│ Now ≈ 62 min                       ⓘ  │ estimate; ⓘ = pace source
│                                        │
│ [ 30 ] [✓45 ] [ 60 ] [ 75 ] [ 90 ]     │ ParamChip, 44pt, tabular
│ [ Other ]                              │ wheel 15–180 min, 5-min steps
│                                        │
│ [           Trim to 45 min           ] │ PrimaryButton (sheet)
│ [             Ask coach              ] │ SecondaryButton
│                                        │
│ Clear fit                              │ only with a live fit
└────────────────────────────────────────┘
```

- **Default chip:** the live fit's minutes; else Ben's preferred session length (Goals & schedule) when it's below `Now`; else the largest chip below `Now`. Chips at or above `Now` stay selectable.
- **Chip ≥ Now:** `Trim` turns into disabled `Fits already`. `Ask coach` reads `Ask coach to fill 75 min`.
- **Coach offline / not connected:** `Ask coach` disabled, caption `Coach offline` under it (icon + word). Trim unaffected.
- `ⓘ` opens the Time left sheet's pace lines (active-workout §2.15.3: `Your pace`, source tag). No other explanation.

### 3.3 Fitted result (`FitCard`, a `ResultCard`, above the list)

```
│ ┌────────────────────────────────────┐ │
│ │ ◷ Fitted to 45 min                 │ │ type.headline
│ │ ≈ 62 → 44 min                      │ │ before → after, tabular
│ │ Cable fly · skipped                │ │ one line per cut, plan order
│ │ Lateral raise · 3 → 2 sets         │ │
│ │ Triceps pushdown · 3 → 2 sets      │ │
│ │ (Undo)                   (Change)  │ │ Change = reopen the sheet
│ └────────────────────────────────────┘ │
│ 5 EXERCISES · FITTED           TARGET  │
│ 01 Bench press              SAME       │
│ …                                      │
│┃03 Lateral raise         ◷ TRIMMED     │ ChangeMarker; detail "2 × 12–15"
│ 05 Cable fly             ⊘ SKIPPED     │ panel: Bring back
```

- **Rows:** trimmed rows get `◷ TRIMMED` and their detail shows the new count (`2 × 12–15`); skipped rows `⊘ SKIPPED` as v0.2. Precedence: SKIPPED > HELD > NO LOAD > ADDED > SWAPPED > EDITED > TRIMMED > the §4 markers.
- **Can't reach the target:** first line `Shortest: ≈ 52 min` instead of `Fitted to 45 min`, then the cuts. No extra cuts are made beyond §4.
- **Bring back** on a fit-skipped row, or `[+]` on a trimmed row in Edit mode, is Ben's edit (FT5): that slot leaves the fit and the card updates (`≈ 52 min · 7 over 45`).
- The card collapses to one line (`◷ Fitted to 45 min · ≈ 44 min ›`) after the first scroll, and expands on tap.
- **Coach variant:** first line `[Coach] Coach fitted to 45 min`, `Why? ›` beside `Undo`. Cuts and additions listed the same way (`Face pull · added · 2 × 12–15`). A swap or superset suggestion sits under it as a `ChangeReviewCard` (`Today only`, `Apply`, `Not now`).

### 3.4 Coach pending

```
│ ┌────────────────────────────────────┐ │
│ │ [Coach] Fitting to 45 min…         │ │ no spinner animation; static
│ │                          (Cancel)  │ │
│ └────────────────────────────────────┘ │
```
The page stays usable. Start is live; starting cancels the request and nothing from it is applied.

## 4. Built-in trim (`fitPlanToMinutes`, pure, `packages/domain`)

### 4.1 Input and output

```ts
fitPlanToMinutes(input: {
  preview: SessionAggregate;          // planner output after Ben's edits, not started
  slots: FitSlot[];                   // slotKey, sessionExerciseIds, tier, benEdited, supersetGroup
  minutes: number;                    // 15..180
  pace: PaceInput;                    // same as the TIME tile
}): {
  status: 'fitted' | 'already_fits' | 'over';
  beforeSeconds: number; afterSeconds: number;
  cuts: ({ slotKey: string; kind: 'sets'; from: number; to: number } | { slotKey: string; kind: 'skip' })[];
  skipSetIds: string[];               // the planned sets to mark skipped
}
```

### 4.2 Priority (`fitTier`)

| Tier | Which slots | Cut |
|---|---|---|
| **A: main** | `RoutineExercise.main` (routines.md WL9; for a history basis or an older workout, the WL9 default at read) | Last, and only down to 2 working sets. Never skipped |
| **B** | Other compound exercises (catalogue `mechanic: 'compound'`), and exercises whose primary muscle is one of Ben's priority groups (when set) | Second |
| **C** | Everything else (isolation, unknown mechanic) | First |

- Within a tier, **later in today's order is cut first**.
- A **superset** is one unit: its tier is its highest member's; a trim removes one round (one working set from each member).
- **Ben-edited slots** (FT5) and **pain-held** slots (`⚠ HELD`) are left as they are.

### 4.3 Passes (stop as soon as the estimate fits)

"Fits" means the unrounded `estimateRemainingDuration` seconds ≤ `minutes × 60`.

1. **Trim tiers C, then B.** Round-robin from the lowest-priority unit up: remove one working set from each unit that is above its floor, re-estimate after each removal. Floor: 2 working sets (or the slot's own count if it already has fewer). Within a unit the set removed is the last drop set, then the last back-off, then the last plain working set. A top set is never removed.
2. **Skip whole units**, tier C bottom-up, then tier B. The unit's warm-ups go with it.
3. **Trim tier A** to 2 working sets, round-robin bottom-up, same set order as pass 1.
4. **Stop.** If it still doesn't fit, `status: 'over'`. Nothing else is cut.

Before pass 1, if it already fits: `already_fits`, no cuts.

### 4.4 Never

- Raise any load, rep target or set count. Change any load at all.
- Shorten rest, transition rest or warm-ups of a kept exercise.
- Change order, swap, superset, or add anything.
- Touch a done set (mid-workout use, FT9: pending sets only).
- Use check-ins, readiness guesses or coach output.

### 4.5 Example (fixture, §9)

Push A at Main gym: bench 3 working (A), incline DB 3 (A), superset lateral raise 3 + pushdown 3 (C), cable fly 3 (C). Pace from the last 5 workouts. `≈ 62 min`. Fit 45:
- Pass 1: cable fly 3 → 2, superset 3 → 2 rounds → `≈ 52 min`.
- Pass 2: skip cable fly → `≈ 44 min`. Stop. `Fitted to 45 min · ≈ 62 → 44 min`.
Fit 30: continues; skip the superset → `≈ 34 min`; pass 3: incline 3 → 2 → `≈ 31 min`; bench 3 → 2 → `≈ 28 min`. Fit 20: after pass 3 `≈ 28 min`, `Shortest: ≈ 28 min`.

## 5. Coach fit

### 5.1 Request

`Ask coach` → `services.coach.requestTodayFit({target, draft: {id, version}, previewKey, minutes, opId})` → `requestCoachAdjustment({origin: 'ben_request', intent: 'fit', targetMinutes, scope: 'pre_start'}, …)`.

Context sent: **only today's shown plan** (exercises, set types and counts, targets with units and conventions, rest, the estimate and pace source), Ben's goal and priority groups, active pain flags, and the gym's usable equipment kinds. No other draft, no history beyond each exercise's last comparable session. This is Your data sent because Ben asked (amends ADR 0022 §1 "never in coach context" for this one request; needs an ADR note).

### 5.2 What comes back, and the validator (`validateTodayFit`, deterministic)

The coach returns today edits only: `skip`, `sets`, `add`, and optionally `swap` / `superset` suggestions. The validator:
- **Shortening** (target < Now): rejects any increase (`shorten_no_increase`), any rest change (`rest_unchanged`), and skipping a tier-A slot unless Ben's request said so in words (not possible from this sheet).
- **Lengthening** (target > Now): at most +2 working sets per exercise and at most 2 added exercises; added exercises must be Ben's own, usable at this gym, not pain-flagged; their targets come from `addTargets` (own history or `No history`), never from the model; per-session cap of about 8 hard sets per muscle group (playbook rule 1).
- **Always:** loads fitted by `snapPlanToGym`; pain flags block (rule 9); Ben-edited slots untouched (FT5); swaps and supersets become a suggestion card, never applied.
- Minutes are recomputed with `estimateRemainingDuration`. The model's own minutes, if any, are ignored.

Edits that pass are written to the draft as `author: 'coach'` edits with one `actionId`, in one versioned write, and the `FitCard` (coach variant) shows. Edits that fail are dropped; if all fail, the card reads `Couldn't use the coach's version` with `Why?` and `Trim instead`.

### 5.3 Undo

`Undo` on the card (or `Clear fit` in the sheet) marks every edit with that `actionId` removed, in one write, and records the undo in the coach action log. A built-in fit it replaced comes back.

## 6. States

| State | Shows |
|---|---|
| No fit | Tile `≈ 62 min ▾`, no card |
| Built-in fit, fits | §3.3 |
| Built-in fit, over | `Shortest: ≈ 52 min` card; tile `≈ 52 min` / `TIME · FIT 45` |
| Fits already | Sheet: `Fits already` (disabled); nothing written |
| Coach pending | §3.4 |
| Coach applied | Coach `FitCard`; suggestion card for any swap |
| Coach timeout (`timing.coachTimeout`) | Card `No answer from the coach` [Trim instead] [Dismiss] |
| Coach offline / not connected | Sheet `Ask coach` disabled + `Coach offline`. Trim works |
| Coach result rejected | `Couldn't use the coach's version` [Why?] [Trim instead] |
| Plan changed while the coach worked | Result discarded; card `Plan changed` [Ask again] |
| Other edits after a fit | Built-in: re-runs, card updates. Coach: its edits stay unless the slot is gone (stale, dropped) or Ben edits that slot (Ben wins) |
| Gym changed | Built-in re-runs on the re-fitted plan |
| Start with a fit | One transaction (ADR 0022 §3); `finishBy` set (FT8); `session.todayEdits.fitted = {minutes, by: 'built_in' \| 'coach', cuts}` |
| Mid-workout (C2) | Time left sheet: `Fit into [20 min ▾]` · `Trim` · `Ask coach`. Trim → banner `Trimmed to fit · ≈ 35 → 20 min` [Undo]; sets `skippedBy: 'in_workout'` |
| Force-close | Draft (with the fit) intact; coach request lost, card shows nothing pending |
| AX1+ | Chips wrap two per line; card lines wrap; Start stays in the bar |

Transitions:

```
Overview ─TIME tile─► How long? ─chip─► Trim ─► FitCard (built-in) ─Undo─► previous
                                   └─► Ask coach ─► pending ─ok─► FitCard (coach) ─Undo─► previous
                                                        ├─timeout/reject─► Trim instead
                                                        └─Start─► cancelled
FitCard ─Change─► How long? (chip preselected)
Overview ─Start─► Workout (Finish by = start + minutes)
```

## 7. Interactions and copy

### 7.1 Tap counts

| Path | Taps |
|---|---|
| Fit with the default chip | 2: tile → `Trim to 45 min` |
| Fit to another length | 3: tile → chip → `Trim` |
| Coach fit | 3: tile → chip → `Ask coach` |
| Undo | 1: card `Undo` (or toast) |

Toasts: `Fitted to 45 min` [Undo] (built-in), none for the coach (the card is the result). Voice (step 5, for voice.md): "I've got 45 minutes" on the overview → built-in trim to 45 with Undo, spoken back `About 44 minutes.`; "ask the coach to fit 45" → coach fit.

VoiceOver: the card reads "Fitted to 45 minutes. About 62 to about 44 minutes. Cable fly skipped. Lateral raise 3 to 2 sets. Triceps pushdown 3 to 2 sets. Undo button. Change button."

### 7.2 Copy

`≈` values are **estimates**. Set counts on the card are **targets** for today.

| Element | Text |
|---|---|
| Tile | `≈ 62 min ▾` · `TIME` · `TIME · FIT 45` |
| Sheet | `How long?` · `Now ≈ 62 min` · `30` `45` `60` `75` `90` `Other` · `Trim to 45 min` · `Fits already` · `Ask coach` · `Ask coach to fill 75 min` · `Coach offline` · `Clear fit` · `Close` |
| Card | `Fitted to 45 min` · `Shortest: ≈ 52 min` · `≈ 62 → 44 min` · `Cable fly · skipped` · `Lateral raise · 3 → 2 sets` · `Face pull · added · 2 × 12–15` · `≈ 52 min · 7 over 45` · `Undo` · `Change` · `Coach fitted to 45 min` · `Why? ›` |
| Coach states | `Fitting to 45 min…` · `Cancel` · `No answer from the coach` · `Couldn't use the coach's version` · `Trim instead` · `Plan changed` · `Ask again` · `Dismiss` |
| Markers / header | `◷ TRIMMED` · `5 EXERCISES · FITTED` |
| Mid-workout (C2) | `Fit into` · `Trim` · `Trimmed to fit · ≈ 35 → 20 min` |
| `Why?` (coach card) | The coach's reason in one or two lines, then the checks it passed, e.g. `Loads and rest unchanged.` |

No rule names, no "built-in" label on the trim, no lead text. Honesty is the `≈`, the before → after and `Shortest`.

## 8. Data needed

**Pure (`packages/domain`, unit-tested):** `fitPlanToMinutes` (§4), `fitTier` (§4.2, uses `defaultMain` from routines.md §A6), `validateTodayFit` (§5.2), `estimateRemainingDuration` (`duration.ts`; the follow-up to fold it into `estimateTimeLeft` should land first or with this slice so the tile, the fit and Time left agree), `planWithTodayEdits` (applies the `fit` edit after the planner, FT4), `buildWorkoutOverview` (`fit: {minutes, status, before, after, cuts, by} | null`; `ChangeMarkerKind` gains `trimmed`), `finishByFromFit(startedAt, minutes)`.

**Schema:** `TodayEdit` gains `{kind: 'fit', minutes}`; `editBase` gains `author` and `actionId?` (shared with §11 of overview-today-edits); `SessionTodayEdits.fitted?`; `WorkoutSession.finishBy` (exists, AW12). All JSON or existing columns.

**Migration 12 (`0012-today-fit`, coach fit only):** rebuild `coach_actions` so its `kind` CHECK also accepts `fit_today`, keeping migration 11's kinds (`log_set`, `correct_set`, `suggest_memory`); same rebuild pattern as migrations 7 and 11 (rows, indexes and the no-delete trigger kept). Nothing else. The built-in trim needs no migration; skipped sets reuse `skipped_by = 'before_start'` / `'in_workout'`. Built as 8 on the library branch; numbered 12 at the merge with main (8 deleted-workouts, 9 progress, 10 workout-gaps, 11 coach-set-actions).

**Services:** `services.overview.edit({kind: 'fit', minutes})`, `services.overview.clearFit`, `services.coach.requestTodayFit`, `services.coach.undoAction` (fit_today), `services.workout.trimToFit({sessionId, minutes, expectedRevision, opId})` (C2), `getAiCapabilities`.

## 9. Acceptance checks (slice C)

Fixture: §4.5 Push A; Ben's pace from 5 recent workouts; coach connected unless stated.

- **FT-C1. Tile.** TIME is a button with `▾`; tapping opens `How long?` with `Now ≈ 62 min` equal to the tile.
- **FT-C2. Order.** `fitPlanToMinutes` unit tests reproduce §4.5 exactly for 45, 30 and 20 minutes: accessories trimmed to 2 before any skip, tier C skipped before tier B, tier A never skipped and never below 2 working sets, top sets never removed.
- **FT-C3. Never raises.** Property test over random plans and targets: no output load, rep target or set count is higher than its input; rest and warm-ups of kept slots are identical; order is identical.
- **FT-C4. Already fits / over.** Target ≥ Now writes nothing (`Fits already`). Fit 20 on the fixture shows `Shortest: ≈ 28 min` and makes no cut beyond pass 3.
- **FT-C5. Preview = Start.** With a fit plus any mix of §11 and v0.2 edits, the rows (including skipped and trimmed sets) equal what Start creates. Start sets `finishBy` = start + minutes rounded up to 5 min, and the Time left line uses it.
- **FT-C6. Re-runs.** Changing the gym, adding a set elsewhere or swapping an exercise re-runs the trim; the card and tile update; no stale cut remains.
- **FT-C7. Ben wins.** `Bring back` on a fit-skipped row keeps it in the plan, the card shows `≈ 52 min · 7 over 45`, and no further trim touches that slot.
- **FT-C8. Undo.** Card `Undo` and toast `Undo` restore the plan exactly (rows, SETS, TIME). Choosing a coach fit after a built-in one and undoing it brings the built-in fit back.
- **FT-C9. Offline.** Airplane mode, no AI: Trim works; `Ask coach` is disabled with `Coach offline`; no provider call.
- **FT-C10. Coach shorten.** A coach response that skips cable fly and trims the superset applies at once with the coach card, before → after minutes from `estimateRemainingDuration`, and Undo. A response that raises any load or shortens rest has those edits rejected (validator log), the rest applied.
- **FT-C11. Coach lengthen.** Asking for 90 on a 62-minute plan: the coach's added exercise uses Ben's own history for its target (or `No history`), is usable at this gym and not pain-flagged; more than 2 added exercises or +3 sets on one exercise are rejected.
- **FT-C12. Coach swap.** A coach swap comes back as a `Today only` change card; nothing is swapped until `Apply`.
- **FT-C13. Coach failures.** Timeout shows `No answer from the coach` with `Trim instead`; a plan change while waiting discards the result (`Plan changed`); Start while pending creates the session without any coach edit.
- **FT-C14. Context.** The coach request contains only today's shown plan, goal, priority groups, pain flags and equipment kinds (request log). No other draft, no memories beyond those.
- **FT-C15. Audit.** A coach fit writes one `coach_actions` row (`fit_today`, migration 12) and its Undo one `undo` row. The built-in trim writes none.
- **FT-C16. Mid-workout (C2).** With 11 pending sets and `Fit into 20 min`, `Trim` skips pending sets by the same order, leaves done sets untouched, shows `Trimmed to fit · ≈ 35 → 20 min` with Undo, and works offline.
- **FT-C17. Idempotent and versioned.** Repeated `opId`s give one fit; a stale `expectedDraftVersion` or `previewKey` writes nothing.
- **FT-C18. Visual.** Chips and buttons ≥ 44pt; `◷ TRIMMED`, `⊘ SKIPPED`, `Coach offline` carry icon + word; minutes tabular with `≈`; Start the only filled pill on the page; AX3 at 375pt with no sideways scroll; light and dark.

## 10. For the PM (flags, not decided here)

- **ADR notes needed:** ADR 0006 (a built-in fit-to-time is a labelled offline fallback beside the coach's `shortenSession`; research P1); ADR 0022 (the `load` edit carries Ben's intended number, TE13; coach-authored draft edits; today's plan sent to the coach on Ben's request).
- **Brief conflict (research P3), resolved:** brief §7 says `shortenSession` "proposes"; CLAUDE.md rule 3 says apply at once when Ben asks. Ben decided for rule 3 (FT6, 12 Oct 2026, CHANGELOG): a fit he asks for applies at once with Undo.
- **Later:** per-gym usual length as the chip default (research R6/P2).
