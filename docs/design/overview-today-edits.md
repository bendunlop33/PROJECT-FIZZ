# Workout overview: today's edits (Swap today, Skip today, Do first, Reorder)

> **Superseded (Ben, 22 Oct 2026).** The Workout overview is retired: every pre-start entry opens the builder's Your workout ([workout-builder-v3.md](workout-builder-v3.md) §2.3). Kept for history; see `docs/brief/CHANGELOG.md` 2026-10-22 and `docs/reviews/retire-workout-overview.md`.

> **v0.3, 11 Oct 2026 (Ben: "an option to edit before starting the workout").** New §11: **full edit before start** (build slice B of the Workouts library change, [routines.md](routines.md) §A8). The overview gets a visible `Edit` mode that puts sets, reps, today's target load, add exercise, swap, skip and order in one place, and `Update Push A ›` turns today's edits into one change-review card. The `How long?` control on the TIME tile is specified in [fit-to-time.md](fit-to-time.md) (slice C). §1–§10 are unchanged and built; where §11 differs, §11 wins. Mockup: [mockups/workout-library.html](mockups/workout-library.html) frame 3.

Status: v0.2, 11 Oct 2026. **Ready to build; PM defaults pending Ben** (§10). Schema: [ADR 0022](../decisions/0022-pre-start-draft.md) (pre-start draft, migration 7). Reconciled with the merged overview (`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx`, `packages/domain/src/session/overview.ts`).

This is the slice that [workout-overview.md](workout-overview.md) §6 and §11.3 deferred. Everything else on the overview is unchanged. Sources: [exercise-library.md](exercise-library.md) §2.5, EL4, EL9; [gym-switch.md](gym-switch.md) GS2–GS3; [change-review.md](change-review.md) CR3, CR4; [active-workout.md](active-workout.md) §4.4; CLAUDE.md rules 1–5, 9, 10 and the minimal-copy convention.

**Out of scope (v0.2):** Lighter start after a break (its playbook rules R1–R6 aren't approved; ADR 0022 §1 leaves the seam), adding exercises, editing sets/reps/loads before Start, any AI call on this page. (v0.3: adding exercises and editing sets, reps and loads are now in §11. The only AI call is the coach fit in fit-to-time.md, and only when Ben asks.)

Borrowed patterns (not screens): a "just this workout" swap scope, and restoring the original after edits.

---

## 1. Purpose

**Question:** "Before I start, can I fit today's plan to today? This machine is taken, I'll skip that one, I want to start with this."

**Primary action: still `Start workout`.** Every edit is optional, sits in a row panel or the `⋯` menu, and is never between Ben and Start. An edited overview shows exactly what Start will create (OV3).

### 1.1 Decisions

| # | Decision | Reason |
|---|---|---|
| TE1 | Edits live in a **saved pre-start draft** (ADR 0022), not a session. Opening the page still creates nothing; the first edit creates the draft; Start consumes it in the session's transaction | OV1 and Resume unchanged; survives force-close |
| TE2 | Edits store **intent** (`swap` slot → exercise, `skip` slot, `order` of slots). `applyTodayEdits` rewrites the **start input**; the unchanged planner and `snapPlanToGym` (mode `start`) then run. Preview and Start share `planWithTodayEdits` | Preview = Start by construction; gym changes re-fit |
| TE3 | Ben's today-only edits **apply at once** with a toast Undo. No Apply step | Ben choosing is consent (EL4). Nothing outside today changes |
| TE4 | **`Change Push A too ›` opens a change-review card** (author `Ben`, scope `Push A from now on`, before → after, Apply, Undo). It replaces routines.md §4.2's "editor Save, no card" | Rule 2: template changes are always proposals with Undo |
| TE5 | **Close keeps the draft.** It ends at Start, `Reset today's edits`, any other workout start, or **local midnight in the draft's stored timezone**. Start after expiry creates nothing; the page re-reads without edits | A swipe or Close by accident costs nothing. One expiry rule, checked on read and at Start |
| TE6 | **Swap candidates** come from `rankSubstitutions`: catalogue substitutions, then same-family exercises, filtered to this gym's usable equipment, never already in today's plan, pain-flagged ones marked and last. Each shows the target it would get: its **own** comparable history through the built-in rule, else the slot's sets and reps with no load (`No history`). Fitted with the shared `snapPlanToGym`. **Never converted** from the original's load | Rules 4, 9; EL4, GS3 |
| TE7 | **Skipped exercises stay in the session** as skipped sets (`skippedBy: 'before_start'`). `Add set` in the workout brings one back | Honest record; reuses active-workout §4.4 |
| TE8 | Rows are keyed by **`slotKey`** (routine: `RoutineExercise.id`; next session: the source part-root `SessionExercise.id`), not `exerciseId` | A swap changes the exercise; an exercise can appear twice |
| TE9 | Swap sheet v1 has **no intent chips and no search** (Closest match order only) | Fewer taps at the gym. Intents and search come with the library build |
| TE10 | Reorder v1 is **buttons only** (`↑` / `↓`), no drag. No long-press menu; VoiceOver custom actions instead | One hand, sweaty fingers; no new gesture dependency |

---

## 2. Layout (390 × 844)

Regions are as workout-overview.md §3. This slice adds: an edit count in the list header, edit markers and panel actions on rows, a Reorder mode, a Swap sheet, and an inline change-review card.

### 2.1 Overview with edits

Bench is taken, so Ben swaps it for DB bench and starts with incline. He skips cable fly.

```
┌────────────────────────────────────────┐
│ ⌄                     [Main gym ▾]  ⋯  │ ⋯ adds: Reorder · Reset today's edits
│ AFTER PULL A · MON 5 OCT               │
│ Push A                                 │
│────────────────────────────────────────│
│  ≈ 45 min  │  ≈ 18:50  │     12        │ skipped sets left out
│  TIME      │  DONE BY  │    SETS       │
│────────────────────────────────────────│
│ Chest · Shoulders · Triceps            │
│                                        │
│ 5 EXERCISES · 3 EDITED         TARGET  │
│ 01 Incline DB press          SAME      │ moved (no marker; index shows it)
│    3 × 8–10 · 2 warm-ups  30 kg each   │
│ 02 DB bench press         ⇄ SWAPPED    │
│    3 × 6–8              32.5 kg each   │
│  ┌──────────────────────────────────┐  │ row panel (open)
│  │ SWAPPED  For Bench press · today │  │
│  │ LAST   32.5 kg each × 8 · 17 Sep │  │ actual
│  │ (Undo swap) (Swap again)         │  │
│  │ (Skip today) (How to) (Why?)     │  │
│  │ Change Push A too ›              │  │ routine basis only
│  └──────────────────────────────────┘  │
│ SUPERSET                               │
│┃03 Lateral raise           SAME        │
│┃   3 × 12–15              10 kg each   │
│┃04 Triceps pushdown        ↑ REPS      │
│┃   3 × 10–12                  25 kg    │
│ 05 Cable fly              ⊘ SKIPPED    │ text.tertiary
│    3 × 12–15                     —     │
│                                        │
│ CHECK-IN        (1)(2)(3)(4)(5)        │ only when due
│ [            Start workout           ] │ the only filled pill
└────────────────────────────────────────┘
```

Rules:
- **Markers** use the `ChangeMarker` slot and style. Precedence: `⊘ SKIPPED` > `⚠ HELD` > `⚠ NO LOAD` > `⇄ SWAPPED` > the §4 markers. A swapped row's panel still shows `CHANGE` / `LAST` against **the substitute's own** last comparable session (or `NEW`).
- **Moved rows have no marker.** One `order` edit counts once in `N EDITED`, however many rows moved.
- **Skipped rows stay in place** in `text.tertiary` with load `—`. They're left out of `TIME`, `DONE BY`, `SETS` and the muscles line. `N EXERCISES` still counts them.
- **List header:** `5 EXERCISES · 3 EDITED` when the draft has applied edits, else `5 EXERCISES`.
- **Supersets:** a swapped member keeps the bracket. Skipping a member keeps the bracket if two or more remain; with one left, the bracket goes for today. `Do first` on a member moves the whole group.
- **WARM-UP, PLATES, BEST** follow "first barbell exercise only" on the **edited** order.

### 2.2 Row panel actions (outline pills, 44pt, wrapping)

| Row state | Pills, in order |
|---|---|
| Normal | `Swap today` · `Skip today` · `Do first` (not on the first row/group) · `How to` · `Why?` · coach pills (overview §5) |
| `⚠ NO LOAD` | Same; panel `GYM` line as now |
| Swapped | `Undo swap` · `Swap again` · `Skip today` · `Do first` · `How to` · `Why?`, then the link `Change Push A too ›` (routine basis only) |
| Skipped | `Bring back` · `How to` |
| Only exercise not skipped | `Skip today` hidden |

Panel lines added: `SWAPPED  For Bench press · today` and `SKIPPED  Today`.

### 2.3 Reorder mode (`⋯` → `Reorder`)

```
┌────────────────────────────────────────┐
│ Reset order                      Done  │ Reset only when the order changed
│ Push A                                 │
│ 5 EXERCISES                            │
│ 01 Incline DB press          [↑] [↓]   │ ReorderRow, 44 × 44 buttons
│ 02 DB bench press            [↑] [↓]   │
│┃03 Lateral raise             [↑] [↓]   │ a superset moves as one row
│┃   Triceps pushdown                    │
│ 05 Cable fly · skipped       [↑] [↓]   │
│                                        │
│ [            Start workout           ] │ still live
└────────────────────────────────────────┘
```

- Each tap writes a new `order` edit at once (it replaces the previous one). There's no save step. `Done` leaves the mode. Start stays live and keeps the order.
- `↑` is disabled on the first row, `↓` on the last. No animation.

### 2.4 Swap sheet (`BottomCard`, large)

```
┌────────────────────────────────────────┐
│ Swap Bench press                 Close │
│ Main gym · today                       │
│                                TARGET  │
│ DB bench press                         │ SubstituteRow, ≥ 64pt, one button
│ Dumbbells · last 32.5 × 8 · 17 Sep     │ actual
│                    32.5 kg each × 6–8  │
│────────────────────────────────────────│
│ Chest press machine                    │
│ Stack · No history          — × 6–8    │
│────────────────────────────────────────│
│ Push-up                                │
│ Bodyweight · last BW × 15 · 2 Oct      │
│                           BW × 12–15   │
│────────────────────────────────────────│
│ Incline DB press           ⚠ May hurt  │ flagged: marked, listed last
│ Dumbbells · last 30 × 9 · 5 Oct        │
│                      30 kg each × 8–10 │
└────────────────────────────────────────┘
```

- Up to 8 rows, in `rankSubstitutions` order. The trailing value is the **target** the row will show after the pick (same function, same fit).
- From `Swap again`, the original is listed first as `Bench press · planned`. Picking it equals `Undo swap`: both return the slot to the plan, however many swaps were chained (`clearSwap`). Only the toast's `Undo` steps back one swap (review S1; pending Ben).
- Empty: `No swaps at Main gym.` (one line, no button).
- A row with `⚠ May hurt` asks `DB bench press may hurt` · `Shoulder pain flagged 6 Oct.` [Add anyway] [Choose another] first (EL9). `Choose another` keeps the sheet open.

### 2.5 Change-review card (inline, in the swapped row's panel)

Tapping `Change Push A too ›` replaces the link with a `ChangeReviewCard` (design-system §9.11), in place. No sheet, no screen.

```
│  ┌──────────────────────────────────┐  │
│  │ [person Ben] Change Push A       │  │ SourceTag + title
│  │ [▦ Push A from now on]           │  │ ScopeBadge
│  │ Changed  Bench press             │  │ ChangeLine
│  │       →  DB bench press          │  │
│  │ (Not now)              (Apply)   │  │ Apply: secondary accent button
│  └──────────────────────────────────┘  │
```

- After Apply: the card collapses to `✓ Applied · Push A from now on` [Undo]. The row loses `⇄ SWAPPED` (the template now matches), and the toast `Push A changed` [Undo] shows.
- Out of date (the routine version moved): the lines turn `text.secondary` under `Was suggested:`, Apply is **hidden**, `Dismiss` shows (CR4).
- `Why?` isn't shown: a Ben-authored one-line change has nothing to explain.

---

## 3. States

| State | Shows | Notes |
|---|---|---|
| No draft | The overview as workout-overview.md | First edit creates the draft |
| Draft with applied edits | Markers, `N EDITED`, recomputed strip | — |
| Writing an edit | Nothing visible (local write); the row updates on success | — |
| Edit write failed | Toast `Couldn't save that edit.` Row unchanged | Retry reuses the opId |
| Stale draft version (only the draft moved, e.g. a quick second tap on an older version) | Page re-reads; toast `Couldn't save that edit.` Row unchanged | Rule 5. The plan didn't change, so nothing to announce (as built after review B r1 S2; pending PM/Ben approval) |
| Today's plan gone or changed under a draft write (routine edited or deleted, source workout gone) | Page re-reads; toast `Targets updated` | Rule 5 |
| An edit no longer fits (routine edited and the slot is gone; an `order` whose slots changed) | Edit marked `stale`, dropped. Toast `Plan changed · 1 edit removed` | Other edits still apply |
| Edit made redundant (template now matches) | Dropped silently; row shows no `SWAPPED` | Change-review Apply does this in its transaction |
| Reopened, draft open | Edits as left | — |
| Reopened after midnight / another start | No edits. Toast `Earlier edits cleared` once, if the draft had edits | — |
| Start after midnight with the page still open | Nothing created; page re-reads without edits; toast `Earlier edits cleared`. Ben taps Start again | TE5 |
| Other routine | That routine's own draft, if any | One open draft per basis |
| Gym changed | Every row re-fits; edits kept. A substitute with no usable item here shows `⚠ NO LOAD` with `Swap again` first | Intent, not numbers |
| Check-in adds a pain flag | The row shows `⚠ HELD`. Swap and skip stay | — |
| Reorder mode | §2.3 | Start live |
| Swap sheet, no candidates | `No swaps at Main gym.` | — |
| Change-review card: ready / applied / out of date | §2.5 | — |
| Start with a draft | One transaction (ADR 0022 §3) | Stale key → nothing created (OV4) |
| Force-close anywhere | Relaunch → Today; draft intact; Today's Up next and the overview show it | Never a session |
| Offline / no AI | Identical. Nothing here needs network or AI | Rule 1 |
| Workout active | Overview unreachable (OV11) | — |
| Dynamic Type AX1+ | Pills wrap; Swap sheet rows stack the target under the name; Reorder buttons go under the name; numbers never truncate; Start stays in the fixed bar | — |

### 3.1 Transitions

```
Overview ─row─► panel ─Swap today─► Swap sheet ─pick─► Overview (⇄ SWAPPED, toast Undo)
                  │                      └─May hurt─► confirm ─Add anyway─► same
                  ├─Skip today─► ⊘ SKIPPED (toast Undo) ─Bring back─► restored
                  ├─Do first─► row/group to 01 (toast Undo)
                  └─Change Push A too ›─► inline card ─Apply─► routine v+1, swap edit redundant (toast Undo)
                                                      └─Not now─► link again
Overview ─⋯ Reorder─► Reorder mode ─↑/↓…─► Done ─► Overview
Overview ─Start─► [one transaction] ─ok─► Workout (Ready on the first pending set of the edited order)
                                   └─stale / expired─► Overview re-read, toast
Overview ─Close─► Today (draft kept until midnight / any start / Reset)
```

---

## 4. Interactions

### 4.1 Tap counts

| Edit | Taps | Then to the first logged set |
|---|---|---|
| Skip | 2 (row, `Skip today`) | +2 (Start, Log) |
| Do first | 2 (row, `Do first`) | +2 |
| Swap | 3 (row, `Swap today`, pick) | +2 |
| Undo | 1 (toast, within `timing.undoToast`), or 2 later (row → `Undo swap` / `Bring back`) | — |

With no edits the path is unchanged: Start → Start → Log (OV2).

### 4.2 Commands (every write: `opId` + `expectedDraftVersion`)

| Action | Call | Undo |
|---|---|---|
| Swap today / Swap again | `services.overview.edit({target, edit: {kind: 'swap', slotKey, toExerciseId}, expectedDraftVersion, opId})` | Toast: `services.overview.undoEdit({draftId, editId, expectedDraftVersion, opId})` (restores the edit it replaced). `Undo swap` / `· planned`: `services.overview.clearSwap({slotKey, expectedDraftVersion, opId})` (back to the plan) |
| Skip today / Bring back | `edit({kind: 'skip', slotKey})` / `undoEdit` | Toast or `Bring back` |
| Do first / `↑` / `↓` | `edit({kind: 'order', slotKeys})` (replaces the previous `order`) | Toast (Do first) or `Reset order` |
| Reset today's edits | `services.overview.resetEdits({draftId, expectedDraftVersion, opId})` | Toast `Today's edits reset` [Undo] → `restoreEdits` |
| Change Push A too › → Apply | `services.routines.applyTemplateSwap({routineId, expectedRoutineVersion, slotKey, toExerciseId, draft: {id, expectedVersion}, opId})`. One transaction: routine v+1 (slot's exercise replaced, equipment cleared, its template loads reset to Auto, never converted; sets, reps, effort, rest kept), an `ActionRecord` (author `ben`, detail `update_routine`), and the draft's swap edit marked `redundant` | `services.routines.undoTemplateSwap({actionId, opId})` (new; there is no generic `undoAction` yet): restores the routine if it is still at the version Apply produced and brings the swap edit back. Otherwise `Can't undo: Push A changed since.` |
| Start | `services.overview.start({…, draft: {id, expectedVersion} \| null, expectedPreviewKey, opId})` | Workout `⋯` → `Discard workout` (unchanged) |

Edits are never deleted. Undo marks `removed`; the draft version bumps. A repeated `opId` returns the current draft. Taps go through the screen's existing `createGuard` pattern (one write at a time).

### 4.3 After Start

- Swapped slots start as the substitute; `Why?` shows `Swapped before start · Bench press`. Pre-start Undo is gone; Ben uses the workout's own actions.
- Skipped slots show in the Skipped style; `Add set` brings one back.
- Next-session targets: a skipped exercise keeps its next target (no sets done). The substitute progresses on its own history. The swapped-away exercise is unchanged.

### 4.4 Voice (for voice.md; none on this page until build step 5)

Deterministic local commands, no coach: "skip cable fly" → skip + Undo · "do incline first" → Do first + Undo · "swap bench" → opens the Swap sheet (pick needs a tap) · "undo" → latest edit. No spoken cues from this page.

### 4.5 Accessibility

- Every pill ≥ 44pt; Reorder buttons 44 × 44; Swap rows ≥ 64pt.
- Row labels add the edit: "2, DB bench press, swapped for Bench press today, 3 sets of 6 to 8, target 32.5 kilograms each." / "5, Cable fly, skipped today."
- Each row exposes VoiceOver custom actions: Swap today, Skip today / Bring back, Do first, Move up, Move down.
- Reorder buttons: "Move Incline DB press up".
- Swap rows: "DB bench press, dumbbells, last 32.5 kilograms each for 8 on 17 September, target 32.5 kilograms each, 6 to 8 reps."

---

## 5. Copy (complete for this slice)

All loads are **targets** except `LAST` and the Swap sheet's `last …` line, which are **actuals**.

| Element | Text |
|---|---|
| Row pills | `Swap today` · `Skip today` · `Do first` · `Undo swap` · `Swap again` · `Bring back` |
| Markers | `⇄ SWAPPED` · `⊘ SKIPPED` |
| Panel lines | `SWAPPED  For Bench press · today` · `SKIPPED  Today` |
| List header | `5 EXERCISES · 3 EDITED` |
| `⋯` menu (added) | `Reorder` · `Reset today's edits` (only with edits) |
| Reorder | `Reset order` · `Done` · `· skipped` |
| Swap sheet | `Swap Bench press` · `Main gym · today` · `TARGET` · `Bench press · planned` · `last 32.5 × 8 · 17 Sep` · `No history` · `⚠ May hurt` · `No swaps at Main gym.` · `Close` |
| Pain confirm | `DB bench press may hurt` · `Shoulder pain flagged 6 Oct.` · `Add anyway` · `Choose another` |
| Change-review card | `Change Push A too ›` · `Change Push A` · `Push A from now on` · `Changed` · `Not now` · `Apply` · `✓ Applied · Push A from now on` · `Undo` · `Was suggested:` · `Dismiss` |
| Toasts | `Bench press → DB bench press · today` [Undo] · `Cable fly skipped today` [Undo] · `Incline DB press first` [Undo] · `Order reset` [Undo] · `Today's edits reset` [Undo] · `Push A changed` [Undo] · `Plan changed · 1 edit removed` · `Earlier edits cleared` · `Coach change didn't fit here` (an applied coach change the gym can't do; card reads `Couldn't apply here`, coach-tools review S1) · `Coach change applied` (a refused coach change that lands on a later load, once; merge r2 S2) · `Couldn't save that edit.` · `Can't undo: Push A changed since.` · `Targets updated` (existing) |
| `Why?` (swapped row) | `Swapped before start · Bench press` (then the usual target explanation) |

No reassurance lines, no rule names, no explanations outside `Why?`.

---

## 6. Data needed

### 6.1 Existing (merged)

`services.overview.load` / `start` / `explain`, `buildWorkoutOverview`, `previewKey`, `previewFence`, `planRoutineStart`, `startWorkoutFromSession`, `startWorkout` → `snapPlanToGym` (mode `start`), `nextTargetsFor`, `plannedSetsFromTargets`, `pastExercisesOf`, `lastComparable`, `painFlagCovering`, `targetChangeMarker`, `estimateRemainingDuration`, `ActionRecord` (author `ben`), catalogue `variations.substitutions`, `Exercise.family` / `catalogueKey`.

### 6.2 New pure functions (`packages/domain`, unit-tested)

| Function | Contract |
|---|---|
| `applyTodayEdits(basis, edits, ctx)` | `basis` = the start input (`routine` or source session exercises, plus the `targets` map). Applies open edits in a fixed order (swap, skip, order; a later target-edit kind goes after these). A swap re-points the slot to the substitute, clears its equipment (the shared fit maps an item, GS3) and puts `substituteTargets` in `targets`. Returns `{basis, skippedSlotKeys, outcomes: {editId, result: 'applied' \| 'stale' \| 'redundant'}[]}`. Never fits loads |
| `planWithTodayEdits(input)` | `applyTodayEdits` → the existing planner (`preview: true` or real) → skipped slots' sets marked `skipped` / `skippedBy: 'before_start'`. Returns the planner output plus `slotOf: Record<sessionExerciseId, slotKey>` and `outcomes`. **The only path** for both the overview dry run and Start |
| `substituteTargets(slot, exercise, pasts, ctx)` | Comparable history (`lastComparable` at the item the fit will map) → `nextTargetsFor` with the slot's working-set count → `plannedSetsFromTargets` (with provenance). None → the slot's own set templates with `targetLoad: null`. Never converts the original's load |
| `rankSubstitutions({slot, exercises, catalogueSubstitutions, excludeExerciseIds, gymEquipment, knownEquipment, pasts, painFlags, nowMs, tz})` | Candidates: (1) the slot exercise's catalogue substitutions resolved to Ben's exercises by `catalogueKey`, in catalogue order; (2) Ben's exercises with the same `family`, most recently done first. Excludes: anything in `excludeExerciseIds` (today's edited plan, skipped included), anything with no usable item at this gym (bodyweight always passes), unresolved catalogue keys. Pain-flagged candidates (`painFlagCovering`) keep `mayHurt` and go last. Each candidate's target = `substituteTargets` → `snapPlanToGym` (mode `start`) for that one slot. Max 8. No scores |
| `buildWorkoutOverview` (extended) | Input gains `slotOf` and the draft's applied edits. `OverviewRow` gains `slotKey` and `edit: {kind: 'swapped', fromName} \| {kind: 'skipped'} \| null`. `ChangeMarkerKind` gains `swapped` and `skipped`. `WorkoutOverview` gains `editCount` and `draft: {id, version} \| null`. Skipped rows are excluded from `estimate`, `workingSets` and `muscles` |
| `previewKey` / `previewFence` | `PreviewKeyParts` gains `draft: {id, version} \| null`; the fence pins the `pre_start_drafts` row |

### 6.3 New service calls

`services.overview.edit`, `undoEdit`, `clearSwap`, `resetEdits`, `restoreEdits`, `swapCandidates({target, gymId, slotKey})` (wraps `rankSubstitutions`); `services.overview.load` returns the draft, its outcomes and drops stale/redundant edits on its next write; `services.overview.start` accepts `draft`; `services.routines.applyTemplateSwap` / `undoTemplateSwap`. `services.next.preview` (Today's Up next) reads through `planWithTodayEdits` with the open draft.

### 6.4 Schema (ADR 0022)

`PreStartDraft`, `TodayEdit`, migration 7, `FenceTable` + `pre_start_drafts`, `SetRecord.skippedBy?`, `WorkoutSession.source.todayEdits?`, `ActionDetail` + `{kind: 'update_routine', routineId, routineName, changes: StructuralChangeLine[]}`.

### 6.5 Screen changes (`WorkoutOverviewScreen.tsx`)

- Row `key`, open-panel state and `panelReducer` row ids use `slotKey`, not `exerciseId`.
- `menu()` adds `Reorder` and `Reset today's edits`.
- Reorder mode replaces the list body; top bar shows `Reset order` / `Done`; the bottom bar is unchanged.
- The screen formats only: it never applies an edit, ranks a candidate or computes a target.

---

## 7. Acceptance checks

Fixture: Push A at Main gym (bench 3 × 100 kg × 6–8 with 2 warm-ups; incline 3 × 30 kg each × 8–10; superset lateral raise 3 × 10 kg each + triceps pushdown 3 × 25 kg stack; cable fly 3 × 50 kg stack × 12–15). DB bench press last done 17 Sep at 32.5 kg each × 8. Hotel gym: dumbbells 2.5–20 kg each, no barbell, no cable.

- **TE-A1. Nothing before Start.** Any edit, Undo or Reset creates no session row. Close returns to Today with no session; the draft row holds the edits.
- **TE-A2. Preview = Start.** The existing overview OV3 tests, extended: for every combination of swap, skip and order, and every load convention, the overview rows equal the pending sets, order and skipped sets of the session Start creates.
- **TE-A3. Skip.** `Skip today` on cable fly is 2 taps; the row shows `⊘ SKIPPED`; `SETS` drops by 3 and `TIME` drops. After Start, its 3 sets are `skipped` with `skippedBy: 'before_start'`, and `Add set` brings it back. The last unskipped exercise has no `Skip today`.
- **TE-A4. Swap candidates.** For bench at Main gym, the sheet lists only exercises doable there and not in today's plan (skipped included), at most 8, flagged ones last with `⚠ May hurt`. At Hotel gym, nothing needing a barbell or cable is listed.
- **TE-A5. Swap targets.** DB bench press shows `32.5 kg each × 6–8` from its own history; an exercise with no comparable history shows `No history` and becomes `NEW` with load `—`. No load is ever derived from bench's 100 kg. The target in the sheet equals the row after the pick and the set Start creates.
- **TE-A6. Swap and Undo.** Picking DB bench press shows `⇄ SWAPPED`; toast Undo restores bench exactly. `Swap again` lists `Bench press · planned` first, and picking it equals Undo.
- **TE-A7. Pain.** Picking a flagged candidate asks `… may hurt` first; `Choose another` changes nothing.
- **TE-A8. Do first and Reorder.** `Do first` on incline makes it `01`, and Start opens Ready on incline set 1. `Do first` on lateral raise moves the whole superset. Reorder works with buttons and with VoiceOver custom actions; `Reset order` restores the routine order.
- **TE-A9. Template change is a card.** `Change Push A too ›` shows the inline card (author `Ben`, scope `Push A from now on`, before → after). The routine version is unchanged until Apply. After Apply: routine v+1 with DB bench press and template loads Auto; the row has no `SWAPPED`; the draft edit is `redundant`; one `ActionRecord` (author `ben`). Undo restores both. With the routine edited elsewhere first, the card shows `Was suggested:` with no Apply.
- **TE-A10. No AI.** Opening the page, every edit, the Swap sheet and the change-review card make no provider call (provider log).
- **TE-A11. Gym change keeps edits.** Switching to Hotel gym keeps skip and order; DB bench re-fits (capped at 20 kg each); a substitute needing a cable shows `⚠ NO LOAD` with `Swap again` first.
- **TE-A12. Stale (rule 5).** Removing cable fly from Push A drops the skip edit with `Plan changed · 1 edit removed`. An edit with an old `expectedDraftVersion` is rejected and the page re-reads. A draft change between page load and Start makes Start create nothing (`Targets updated`).
- **TE-A13. Idempotent.** Repeating any edit, Undo, Apply or Start `opId` gives exactly one change and at most one session.
- **TE-A14. Force-close.** Kill the app after a swap and a skip. Relaunch → Today (no session); Today's Up next and the overview show both edits. Start consumes the draft; the next overview shows no edits.
- **TE-A15. Expiry.** A draft expires at local midnight in its stored timezone. The next open shows `Earlier edits cleared` once. With the page open from 23:55, Start at 00:05 creates nothing, the page re-reads without edits, and a second Start works. Any other start (Empty workout, Repeat) discards every open draft in the same transaction.
- **TE-A16. Offline.** In airplane mode with no AI, every edit, Undo, Reset, the Swap sheet, the change-review card and Start work.
- **TE-A17. Backup and data.** A backup with an open draft restores it as `discarded`. Drafts are exported and deleted with Your data and never appear in coach context.
- **TE-A18. Visual.** Start is the only filled pill on the page (the card's Apply is secondary style). Markers carry icon + word. Every target ≥ 44pt. At AX3 on 375pt nothing scrolls sideways and Start stays visible, including in Reorder mode.

---

## 8. Effects on other specs (done in this change)

- **routines.md §4.2:** `Swap ›` → `Change Push A` now goes through the change-review card (TE4), not the editor's Save. The editor's own `Replace exercise` is unchanged (that is Ben editing the template directly, with Save and Undo).
- **workout-overview.md §6, §11.3:** point here.
- **design-system.md §9.65–9.68:** `OverviewRow` (incl. skipped), `ChangeMarker` (incl. swapped, skipped), `StatStrip`, `SubstituteRow` target variant; `ReorderRow` superset variant.

Follow-ups for the PM (not edited here): today.md (Up next reads the edited preview), voice.md (§4.4 grammar), active-workout §4.4 (`skippedBy` in `Why?`), workout-summary (skipped-before-start shows like any skip), change-review.md §1 (first built instance is Ben-authored, inline).

---

## 9. Lighter start seam (not built)

- `TodayEdit` gets a new variant later; `applyTodayEdits` already has the slot after structural edits.
- No line, sheet, setting or toast for it appears in this slice. Nothing in this UI mentions a break.

---

## 10. For Ben to confirm (PM defaults applied)

1. **Saved draft** (migration 7) rather than in-memory.
2. **Close keeps today's edits** until local midnight, Start, Reset or another workout.
3. **`Change Push A too ›` uses a change-review card** (routines.md §4.2 updated to match).
4. **Lighter start** waits for R1–R6 approval.
5. **EL6** (same-movement substitute of a flagged exercise) is still pending; v1 marks only candidates that are themselves flagged.
6. **Draft-conflict toast and card freshness** (§3, §11.5): `Couldn't save that edit.` for a draft-only conflict; the Update card goes out of date when the draft moves too (as built, review B r1/r2).
7. **§11.4 keypad** (review B N3): the build uses the `NumberStepper` sheet, not a `WorkoutKeypad` with step keys; the strings `Assist`, `Most assistance here:`, `Least here:` and `Least assistance here:` still need adding to §11.8.
8. **Typed load on a `HELD` movement** (rule 9, review B N4): today it replaces the held load with both `HELD` and `[Ben]` shown. Options: keep, ask first, or cap at the held load.
9. **TE-B13 on legacy routines** (review B r1 S1): built as "drop today-only set counts", not "convert to a library routine on first edit".

---

## 11. Full edit before start (v0.3, build slice B)

### 11.1 Purpose

**Question:** "Before I start, can I change today's workout the way I want: more or fewer sets, different reps, a different weight, an extra exercise?" FitNotes' `Log All` lets Ben edit the copied day before saving it. This is the same idea, with the template left alone unless Ben says so.

**Primary action: still `Start workout`**, live in every mode. Edit mode is optional and never between Ben and Start.

### 11.2 Decisions

| # | Decision | Reason |
|---|---|---|
| TE11 | **A visible `Edit` button** in the overview top bar (`⌄ · [Main gym ▾] · Edit · ⋯`) opens **Edit mode**: every row shows its controls at once. `Done` leaves. `⋯ → Reorder` now opens Edit mode (it has `↑` / `↓`), so the v0.2 Reorder mode (§2.3) retires when this ships | Ben asked for an edit option he can see. One mode instead of panels plus a separate Reorder mode |
| TE12 | **Four new `TodayEdit` kinds**, stored as intent in the draft: `add` (exercise), `sets` (working-set count), `reps` (range, or work time), `load` (Ben's own target for today). Applied in this order after the v0.2 ones: swap, add, skip, order, sets, reps, load. Then the planner and `snapPlanToGym` run as now (TE2) | Preview = Start stays true by construction |
| TE13 | **`load` is the one edit that carries a number.** It's Ben's *intended* target, fitted on every read like any intended load (toward easier, never past a max; GS2). Amends ADR 0022 §1 "edits never carry a load" (needs a one-line ADR note) | Rule 4 still holds: the fitted value is what shows and what Start plans |
| TE14 | **Everything applies at once** (TE3). Steppers show no toast (`−` undoes `+` in place). Add, remove, swap, skip and a typed load show a toast with Undo | No toast spam while tapping `+` |
| TE15 | **`Update Push A ›`** (routine basis, when there are template-able edits) opens **one** inline `ChangeReviewCard` listing every change as a line with its own check. Skips start **unchecked**, the rest checked. Today's loads and the time fit are never listed. History basis: the link reads `Save to Workouts ›` (routines.md §A2.5) | Research R5/P5. A skip often means "machine taken", so removing it from the template must be a deliberate tick (rule 2) |
| TE16 | **Added exercises** come from the exercise picker (pick one), filtered to equipment usable at this gym, pain-flagged ones marked and confirmed (EL9). Targets: its own comparable history through the built-in rule (or a stored D21 coach target), else `No history` and load `—`. Default shape 3 working sets × the exercise's rule range (else 8–12). Added at the end | Same rules as a swap substitute (TE6). Never converted from another exercise |
| TE17 | **Limits:** working sets 1–10 per exercise (`−` disabled at 1; use Skip), up to 6 added exercises, reps 1–50, work time 0:05–10:00. The last exercise not skipped can't be skipped (v0.2) | Mistyped values can't make a silly plan |

### 11.3 Layout: Edit mode (390 × 844)

```
┌────────────────────────────────────────┐
│ Reset                            Done  │ Reset only with edits
│ Push A                                 │
│────────────────────────────────────────│
│  ≈ 62 min ▾│  ≈ 19:05  │     16        │ TIME tile → How long? (slice C)
│  TIME      │  DONE BY  │    SETS       │
│────────────────────────────────────────│
│ 6 EXERCISES · 3 EDITED         TARGET  │
│ 01 Bench press                [↑] [↓]  │ EditRow; ↑ disabled on 01
│    [−]  3 sets  [+]      6–8 reps ›    │ SetCountStepper, 44pt
│    100 kg ›          (⇄ Swap) (⊘ Skip) │ load = target (fitted)
│────────────────────────────────────────│
│ 02 Incline DB press  ✎ EDITED [↑] [↓]  │
│    [−]  4 sets  [+]     8–10 reps ›    │ was 3 sets
│    30 kg each ›      (⇄ Swap) (⊘ Skip) │
│────────────────────────────────────────│
│┃03 Lateral raise              [↑] [↓]  │ superset moves as one
│┃   [−]  3 sets  [+]    12–15 reps ›    │
│┃   10 kg each ›      (⇄ Swap) (⊘ Skip) │
│┃04 Triceps pushdown  ✎ EDITED          │
│┃   [−]  3 sets  [+]    10–12 reps ›    │
│┃   27.5 kg › [Ben]   (⇄ Swap) (⊘ Skip) │ Ben's own load today
│────────────────────────────────────────│
│ 05 Cable fly          ⊘ SKIPPED        │ text.tertiary
│                         (Bring back)   │
│────────────────────────────────────────│
│ 06 Face pull          ＋ ADDED [↑] [↓] │
│    [−]  3 sets  [+]    12–15 reps ›    │
│    —  No history             (Remove)  │ added: Remove instead of Skip
│────────────────────────────────────────│
│ ＋ Add exercise                        │ row link, 52pt
│ Update Push A ›                        │ TE15
│ [            Start workout           ] │ fixed bar, the only filled pill
└────────────────────────────────────────┘
```

Rules:
- **Row (`EditRow`)**: line 1 index, name, marker, `↑` `↓` (44 × 44). Line 2 `SetCountStepper` and the reps button. Line 3 the load button (`100 kg ›`, a target) or `—  No history`, then outline pills. Superset members share `↑` `↓` on the first member (the group moves as one).
- **Markers** (`ChangeMarker`): new `＋ ADDED` (`plus.circle`) and `✎ EDITED` (`pencil`, for sets, reps or load). Precedence: `⊘ SKIPPED` > `⚠ HELD` > `⚠ NO LOAD` > `＋ ADDED` > `⇄ SWAPPED` > `✎ EDITED` > the §4 markers. A Ben-typed load also shows the `SourceTag` `Ben` after it.
- **`N EDITED`** counts slots with any live Ben edit (an `order` counts once). The fit (slice C) is shown separately and doesn't count.
- **Out of Edit mode** the rows look as v0.2 §2.1, with the new markers; row panels keep `Swap today` / `Skip today` / `Do first` and the built `Change Push A too ›`.
- Warm-ups aren't edited here. They follow the exercise (added exercises get none; the first set card handles them as today).

### 11.4 Small sheets

**Reps (`RepsSheet`, small detent).**

```
│ Reps · Incline DB press          Done  │
│ [✓ Range ] [ Exact ]                   │
│ [−]  8 [+]   to   [−] 10 [+]           │ NumberStepper, tabular
│ Use planned                            │ only when edited
```
Applies to every working set of that exercise today. Timed exercises show `Work time [0:45 ▾]` instead. `Done` writes one `reps` edit. `Use planned` removes it.

**Load (keypad).** Tapping the load opens `WorkoutKeypad` with this gym's feasible step keys and the value in the exercise's convention (`kg each`, stack, assisted). The action bar above the keypad has `Set target` (primary of the keypad) and `Use planned`. A value the gym can't make shows a `NoteLine` before saving: `Rounds to 97.5 kg here`. Above the max: `Most here: 30 kg each`. The row then shows the fitted value. A top-set + back-off exercise: the edit sets the top and plain working sets; back-off and drop sets keep their planned loads.

**Add exercise.** The exercise library in pick-one mode ([exercise-library.md](exercise-library.md)), `At Main gym` filter on, exercises already in today's plan hidden, `⚠ May hurt` marked and confirmed. Pick → row appended with toast `Face pull added` [Undo].

(2026-10-12, Ben on build 126.) The sheet has the shared `Sets [−] 3 [+]` bar above the keyboard (exercise-library §10.2). A row tap still adds in one tap, with that many working sets (`add` edit with `workingSets`; TE16's 3 when untouched). The new row then shows its `SetCountStepper` at that count and its reps button, so the count can change again at once. Warm-ups stay out of Edit mode (§11.3); target RPE is set in the workout or the editor. `Update Push A ›` lists the added exercise as `Added  Face pull · 4 × 12–15`.

### 11.5 `Update Push A ›` card (inline, at the list end)

```
│ ┌────────────────────────────────────┐ │
│ │ [person Ben] Update Push A         │ │
│ │ [▦ Push A from now on]             │ │
│ │ [✓] Changed  Bench press           │ │ CheckRow 44pt each
│ │          →  DB bench press         │ │
│ │ [✓] Added    Face pull · 3 × 12–15 │ │
│ │ [✓] Sets     Incline DB press 3 → 4│ │
│ │ [✓] Reps     Pushdown 10–12 → 8–10 │ │
│ │ [✓] Order    Incline DB press first│ │
│ │ [ ] Removed  Cable fly             │ │ skips start unchecked
│ │ (Not now)                 (Apply)  │ │ Apply = SecondaryButton
│ └────────────────────────────────────┘ │
```

- **Apply** writes routine v+1 with the checked lines, in one transaction with an `ActionRecord` (`update_routine`, author `ben`, `before` stored) and the matching draft edits marked `redundant`. A swapped or added exercise gets `Auto` loads in the template (never converted). Collapses to `✓ Applied · Push A from now on` [Undo]; toast `Push A updated` [Undo].
- **Out of date** (Push A changed since the page loaded, **or today's draft moved since the card opened**, for example another edit or an Undo): lines go `text.secondary` under `Was suggested:`, Apply hidden, `Dismiss` shown (CR4, rule 5). The card records the routine version and the draft version it was built from; Apply sends both and is refused if either moved.
- `Done` (leaving Edit mode) closes an unapplied card; an applied one stays with its Undo.
- *As built after review B r1 B3 and S2; pending PM/Ben approval.*
- `Apply` is disabled with no line checked.
- Not listed: loads typed for today, and anything the time fit did.
- **Coach structural proposals (merge with coach tools, 12 Oct 2026).** A swap, removal or reorder Ben applies from a coach card (ADR 0020 §3) is written into the next workout's draft as his own `Swap today` / `Skip today` / order edits, so it shows on the overview with the page's own Undo, and on a saved workout it reaches the workout itself only through this card's lines and `Apply`. There is no second planning or template path for the coach. (`apps/mobile/test/coach-structural-library.test.ts`.)
- **Coach order and Ben's added exercises (merge r2 S1).** A coach reorder lists the plan's own exercises only. An exercise Ben added today keeps its place: it stays ahead of the slot it preceded in his earlier order. One he never moved, or had last, goes at the end. If that place would split a superset, it goes at the end too. The card's Undo brings back his order.
- **A refused coach Apply (merge r2 S2, PM default; Ben to confirm).** `Couldn't apply here` isn't final. Each overview load tries the whole Apply again, so it lands at a gym that can do it or once the plan has room (coach-tools review S1). When an Apply lands on a load after the one that refused it, the overview shows `Coach change applied` once and the card goes back to `Applied` with its Undo. It never lands without a word: when one load has several page toasts (`Earlier edits cleared`, `Coach change didn't fit here`, `Coach change applied`, `Plan changed · N edits removed`), they show one after another in that order (merge r3 S1). The stricter option (refused stays refused until Ben taps Apply again) would need the refusal stored and a second Apply on the card. Limit: the refusal is kept in memory, so after a force-close a late landing reads as a first-time apply, with no toast.

### 11.6 States

| State | Shows |
|---|---|
| Edit mode, no edits | §11.3 without markers; `Reset` hidden; no `Update` link |
| Edit mode with edits | Markers, `N EDITED`, live TIME / DONE BY / SETS |
| Stepper at a limit | That button disabled (`[−]` at 1, `[+]` at 10), VoiceOver "dimmed" |
| Add picker empty at this gym | `Nothing else here at Main gym.` + `Show all` (turns the filter off; a pick with no usable item shows `⚠ NO LOAD`) |
| Gym changed in Edit mode | Every row re-fits; Ben's loads re-fit from his intended values; added exercises with no usable item show `⚠ NO LOAD` |
| Routine edited elsewhere | `sets` / `reps` / `load` / `add` edits on slots that still exist apply; stale ones drop with `Plan changed · 1 edit removed` (v0.2) |
| Write failed | `Couldn't save that edit.` Row unchanged |
| Offline / no AI | Identical. Nothing in §11 needs network or AI |
| Force-close | Draft intact; reopening shows the edits (Edit mode closed) |
| AX1+ | `EditRow` stacks: name; steppers; load; pills; `↑` `↓` on their own line. Start stays in the bar |

Transitions:

```
Overview ─Edit─► Edit mode ─[+]/[−]/reps/load/↑↓─► same (live) ─Done─► Overview
                    ├─＋ Add exercise─► picker ─pick─► row ＋ ADDED (toast Undo)
                    ├─Update Push A ›─► inline card ─Apply─► routine v+1 (toast Undo)
                    └─Start workout─► [one transaction] ─► Workout
```

### 11.7 Interactions

| Edit | Taps from the overview |
|---|---|
| One more set | 2: `Edit` → `[+]` |
| Reps | 4: `Edit` → reps → stepper → `Done` |
| Today's load | 4+: `Edit` → load → keys → `Set target` |
| Add exercise | 3+: `Edit` → `Add exercise` → pick (search optional) |
| Make it permanent | 2: `Update Push A ›` → `Apply` |

Commands (all `opId` + `expectedDraftVersion`, through `services.overview.edit`):

| Edit | Payload | Undo |
|---|---|---|
| Add | `{kind: 'add', slotKey: <new id>, exerciseId, workingSets?}` (the `order` edit, if any, gets the new key at the end; `workingSets` from the sheet's bar, 2026-10-12) | Toast, or `Remove` |
| Sets | `{kind: 'sets', slotKey, workingSets}` (replaces the slot's previous `sets` edit) | `−` / `+`, or `Reset` |
| Reps | `{kind: 'reps', slotKey, reps: {min, max} \| null, durationS: number \| null}` | `Use planned`, or `Reset` |
| Load | `{kind: 'load', slotKey, load: Load}` (convention explicit) | Toast, or `Use planned` |
| Update Push A → Apply | `services.routines.applyTodayEdits({routineId, expectedRoutineVersion, draft: {id, expectedVersion}, editIds, opId})` | `services.routines.revert({actionId, opId})` |

Voice (for voice.md, step 5; deterministic, no coach): "add a set to incline" → `sets` +1 with Undo · "eight to ten reps on incline" → `reps` · "add face pulls" → opens the picker with the query filled (pick needs a tap).

VoiceOver: `EditRow` reads "2, Incline DB press, edited, 4 sets, 8 to 10 reps, target 30 kilograms each." Custom actions: Add set, Remove set, Change reps, Change target, Swap, Skip, Move up, Move down.

### 11.8 Copy

Loads in Edit mode are **targets** (`TARGET` header; `[Ben]` tag when typed by Ben). `No history` and `—` mean no target.

| Element | Text |
|---|---|
| Top bar | `Edit` · `Done` · `Reset` |
| Row | `3 sets` · `6–8 reps` · `0:45` · `100 kg` · `—  No history` · `Swap` · `Skip` · `Bring back` · `Remove` |
| Markers | `＋ ADDED` · `✎ EDITED` |
| Sheets | `Reps · Incline DB press` · `Range` · `Exact` · `Work time` · `Use planned` · `Done` · `Set target` · `Rounds to 97.5 kg here` · `Most here: 30 kg each` |
| Add | `Add exercise` · `Nothing else here at Main gym.` · `Show all` |
| Card | `Update Push A ›` · `Save to Workouts ›` · `Update Push A` · `Push A from now on` · `Changed` · `Added` · `Removed` · `Sets` · `Reps` · `Order` · `Not now` · `Apply` · `✓ Applied · Push A from now on` · `Was suggested:` · `Dismiss` |
| Toasts | `Face pull added` [Undo] · `Face pull removed` [Undo] · `Target 27.5 kg today` [Undo] · `Push A updated` [Undo] · `Today's edits reset` [Undo] |

### 11.9 Data needed

- **Schema (`packages/schemas/src/draft.ts`; JSON in `pre_start_drafts.data`, no migration):** `TodayEditSchema` gains `add`, `sets`, `reps`, `load` (and `fit`, slice C). `editBase` gains `author: 'ben' | 'coach'` (default `ben`) and `actionId?` (slice C). `SessionTodayEdits` gains `added[]` and `edited[]` (`{sessionExerciseId, slotKey, kinds}`).
- **Domain (pure):** `applyTodayEdits` (new kinds, order in TE12), `planWithTodayEdits` (unchanged contract), `addTargets(exercise, pasts, ctx)` (shares `substituteTargets`' path), `templateLinesFromEdits(routine, edits, outcomes)` → `StructuralChangeLine[]` with default checks (TE15), `applyEditsToRoutine(routine, lines, expectedVersion, opId, at)` → `RoutineChange`, `buildWorkoutOverview` (`edit` gains `added` / `edited`; `ChangeMarkerKind` gains `added`, `edited`).
- **Services:** `services.overview.edit` (new kinds), `services.overview.addCandidates({target, gymId, query})` (wraps the exercise library's pick search with this gym's filter and pain marks), `services.routines.applyTodayEdits`, `services.routines.revert`.
- **Not touched:** session tables, `skipped_by` values, coach context (the draft stays out of it).

### 11.10 Acceptance checks (slice B)

Fixture as §7, plus Face pull (cable, last 20 kg × 15 on 1 Oct) and Hotel gym.

- **TE-B1. Visible edit.** `Edit` is in the top bar on every overview basis. Edit mode shows sets, reps, load, Swap, Skip and `↑` `↓` on every row without opening a panel. Start is live and visible throughout, at AX3 too.
- **TE-B2. Preview = Start.** For every combination of the new kinds with the v0.2 ones, and every load convention, the rows equal the pending sets Start creates (the OV3 test extended).
- **TE-B3. Sets.** `[+]` on incline makes 4 working sets copying set 3's target; SETS and TIME update; Start creates 4. `[−]` at 1 is disabled. A superset member's `[+]` adds one round's set to that member only.
- **TE-B4. Reps.** 8–10 → 6–8 on incline changes every working set's target reps today; warm-ups unchanged; the routine unchanged.
- **TE-B5. Load.** Typing 37.5 kg each at Hotel gym (rack to 20) shows `Most here: 20 kg each`, the row shows 20 kg each, Start plans 20 kg each, and switching to Main gym re-fits from the intended 37.5 kg each (the nearest makeable value toward easier, capped at Main gym's max). Back-off sets keep their planned loads.
- **TE-B6. Add.** Face pull is added at the end with `＋ ADDED` and 20 kg × 12–15 from its own history (never derived from another exercise). An exercise with no history shows `—  No history`. A flagged pick asks first. `Remove` and the toast Undo both take it out.
- **TE-B7. Update card.** With a swap, an add, a sets change, an order change and a skip, `Update Push A ›` lists five lines with the skip unchecked. Apply makes routine v+1 without the skip; template loads for the swapped and added exercises are `Auto`. The applied edits become redundant and their markers go. Undo restores the routine and the edits. With Push A changed elsewhere first, the card shows `Was suggested:` and no Apply.
- **TE-B8. Today's loads stay today.** A typed load never appears on the card, and the routine's templates don't change after Start or Finish.
- **TE-B9. Rule 2.** No §11 action changes the routine except `Apply`. No completed set exists to touch.
- **TE-B10. Idempotent and versioned.** A repeated `opId` gives one edit; an old `expectedDraftVersion` is rejected and the page re-reads.
- **TE-B11. Force-close and expiry.** Edits survive a force-close and clear at local midnight as v0.2 (TE-A14, TE-A15).
- **TE-B12. Offline.** Airplane mode, no AI: every §11 action works; no provider call.
- **TE-B13. Next time.** After a workout with an added exercise and 4 incline sets, the next Push A overview (no Apply) has 3 incline sets and no face pull; face pull's own history is updated.
- **TE-B15. (2026-10-12) Sets when adding.** In Edit mode, `Add exercise` → bar `[+]` to 4 → tap Face pull adds it with 4 working sets (`＋ ADDED`, stepper reads `4 sets`); untouched, it adds 3. SETS and TIME update; Start creates that many. Same as exercise-library EL-B21.
- **TE-B14. Visual.** Steppers and pills ≥ 44pt; markers icon + word; numbers tabular; Start the only filled pill (Apply is secondary); light and dark.
