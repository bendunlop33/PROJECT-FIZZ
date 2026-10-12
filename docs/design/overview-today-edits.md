# Workout overview: today's edits (Swap today, Skip today, Do first, Reorder)

Status: v0.2, 11 Oct 2026. **Ready to build; PM defaults pending Ben** (§10). Schema: [ADR 0022](../decisions/0022-pre-start-draft.md) (pre-start draft, migration 7). Reconciled with the merged overview (`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx`, `packages/domain/src/session/overview.ts`).

This is the slice that [workout-overview.md](workout-overview.md) §6 and §11.3 deferred. Everything else on the overview is unchanged. Sources: [exercise-library.md](exercise-library.md) §2.5, EL4, EL9; [gym-switch.md](gym-switch.md) GS2–GS3; [change-review.md](change-review.md) CR3, CR4; [active-workout.md](active-workout.md) §4.4; CLAUDE.md rules 1–5, 9, 10 and the minimal-copy convention.

**Out of scope:** Lighter start after a break (its playbook rules R1–R6 aren't approved; ADR 0022 §1 leaves the seam), adding exercises, editing sets/reps/loads before Start, any AI call on this page.

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
| Stale draft version | Page re-reads; toast `Targets updated` | Rule 5 |
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
| Toasts | `Bench press → DB bench press · today` [Undo] · `Cable fly skipped today` [Undo] · `Incline DB press first` [Undo] · `Order reset` [Undo] · `Today's edits reset` [Undo] · `Push A changed` [Undo] · `Plan changed · 1 edit removed` · `Earlier edits cleared` · `Coach change didn't fit here` (an applied coach change the gym can't do; card reads `Couldn't apply here`, coach-tools review S1) · `Couldn't save that edit.` · `Can't undo: Push A changed since.` · `Targets updated` (existing) |
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
