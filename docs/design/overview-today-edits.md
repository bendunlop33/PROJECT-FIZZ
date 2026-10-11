# Workout overview: today's edits (Swap today, Skip today, Do first / Reorder, Lighter start)

Status: v0.1 draft, 11 Oct 2026. **Needs Ben's go-ahead.** It adds a schema change (the pre-start draft, ADR draft [draft-pre-start-draft.md](../decisions/draft-pre-start-draft.md)), and the Lighter start offer depends on Ben approving candidate playbook rules R1, R2 and R6 ([return-to-load.md](../training-guides/return-to-load.md)).

This is the slice that [workout-overview.md](workout-overview.md) §6 and §11.3 deferred. It changes only what that spec lists as deferred; everything else on the overview is unchanged. Sources: workout-overview.md §3–§8 and §12, [routines.md](routines.md) §2.2 / §4.2 (`Swap ›` with `Today only` "made at Start"), [gym-switch.md](gym-switch.md) GS1–GS3 (`snapPlanToGym`, intended vs fitted), [exercise-library.md](exercise-library.md) §2.5, EL4, EL6, EL9, [active-workout.md](active-workout.md) §4.4 (in-workout swap and skip), [coach-adjustments.md](coach-adjustments.md) CA1, CA8 and B′, [check-in.md](check-in.md) CI5–CI7, [change-review.md](change-review.md) CR3, CR4, CR8, and [competitor-first-pages.md](../research/competitor-first-pages.md) ideas 6 and 13. CLAUDE.md rules 1–6, 9 and 10, plus the minimal-copy convention and [minimal-copy-audit.md](minimal-copy-audit.md).

**Dependencies (checked 11 Oct against the base branch `30555a4` and the worktrees):**
- workout-overview.md and `targetChangeMarker` exist only on branch `claude/workout-overview` (review: CHANGES NEEDED). This slice builds on that branch after its fixes merge.
- `rankSubstitutions`, `getComparableHistory` and `expireProposals` are **specified, not built** (no code on any branch). Swap today needs `rankSubstitutions` and the exercise-library §2.5 sheet first; the closest built helpers are `lastComparableSession` / `lastComparableHistory`. Skip, Do first, Reorder and the built-in Lighter start don't depend on them.
- Built: `snapPlanToGym` (mode `start` exists in `SnapModeSchema`), `nextTargetsFor`, `painFlagCovering`, `evaluateCheckInOffer`, `estimateRemainingDuration`, the `skip_exercise` command.

Borrowed patterns (not screens): a "just this workout" scope for swaps (Boostcamp), restoring the original after edits (Ladder), and a lighter first session after a break with before/after loads (StrongLifts). No competitor names, assets or layouts appear in the app.

---

## 1. Purpose

**Question:** "Before I start, can I fit today's plan to today: this machine is taken, I'll skip that one, I want to start with this, and it's been a while?"

**Primary action: still `Start workout`.** Every edit here is optional, one row away, and never between Ben and Start. An edited overview shows exactly what Start will create (OV3 still holds, now with the edits applied).

### 1.1 Decisions in this spec

| # | Decision | Reason |
|---|---|---|
| TE1 | **Today's edits live in a persisted pre-start draft**, not in a session. Opening the page still creates nothing. The first edit creates the draft. Start consumes it in the same transaction that creates the session | Keeps OV1 (no session before Start) and Resume semantics unchanged. Edits survive a force-close. See the ADR draft for the alternatives |
| TE2 | **Edits store intent, not numbers** (`swap` slot → exercise, `skip` slot, `order` of slots, `lighter_start` as the rule mode or the coach's intended loads, TE11). The page re-plans from the routine every time and applies the edits with one pure function, `applyTodayEdits`. Then `snapPlanToGym` fits the result | A gym change, a late D21 target or a routine edit can't leave a stale number in the draft. It's the same "fit from intended" rule as GS2 |
| TE3 | **Ben's own today-only edits apply at once with Undo.** There is no Apply card for Swap, Skip or Do first | Ben choosing is his consent (EL4). Nothing outside today changes (rule 2) |
| TE4 | **Template changes are always proposals.** After a swap, `Change Push A too ›` opens change-review with scope `Future sessions`, author `Ben`, and Apply/Undo. Skip and reorder have no template link here: the routine editor already does both | Rule 2. One link where it's useful, no new template paths. **Conflicts with routines.md §4.2**, where Ben's own `Change Push A` from a swap goes through the editor's normal Save with no change-review card. For Ben (§11.6) |
| TE5 | **Close keeps the draft.** The draft ends at Start, at `Reset today's edits`, when any other workout starts, or at local midnight in the draft's stored timezone. Expiry runs when the overview or Today opens (the same pass as change-review's `expireProposals`, CR8), **never while the overview is open**: a draft open across midnight stays until that page closes, so a late-night Start keeps its edits | A swipe down on a full-screen modal is easy to do by accident with one hand. Losing a swap to it would cost 3 taps. Reopening shows the edits on the rows, so nothing is hidden. **For Ben to confirm (§11.1)** |
| TE6 | **Lighter start is an offer**, raised by a deterministic trigger. The line shows when the **workout** gap (days since any logged lifting session) is ≥ 14 days (R1's hero-line rule). Each row is then judged on its **own** R1 gap (last working set of that exercise on comparable equipment, with R1's usual-spacing exception), and its R2 band (−10/−20/−40%) comes from that gap. It's one line on the page, then a before/after sheet with `Apply` and Undo. With no AI it uses R2's built-in numbers. With the coach live, tapping it counts as Ben asking (CA1), and the coach's numbers are validated the same way | Rules 2, 3 and 6; R1/R2 as written in return-to-load.md. Opening the page still makes no AI call |
| TE7 | **Swap candidates must be doable at the selected gym**, are never already in today's plan, and get targets from their **own** history, fitted with `snapPlanToGym` (mode `start`). Loads are never converted from the original exercise | Rule 4, EL4, GS5 |
| TE8 | **Pain flags still win.** A substitute with its own flag asks `… may hurt` first (EL9). A same-movement substitute of a flagged exercise is held (EL6, pending Ben). Lighter start can only lower targets, so flagged exercises and exercises with a flag cleared in the last 8 weeks are included. R5's "R4/R5 win" governs the climb back (R3 vs R4), which is out of scope here | Rule 9 |
| TE9 | **Skipped exercises stay in the session as skipped**, not deleted. In the workout they look like any skipped exercise, and `Add set` brings one back | Honest record. It reuses the existing skipped style and active-workout §4.4 |
| TE10 | **Applying Lighter start suppresses the check-in's lighter-session offer** (CI5) for this session | Two reductions stacked from two offers would be a surprise. Ben can still ask the coach in the workout |
| TE11 | **A built-in Lighter start is stored as intent** (`mode: 'rule'`, the playbook version), not as numbers: `applyTodayEdits` re-applies R2 to every returning slot of the current edited plan. A coach Lighter start stores its per-slot numbers (`mode: 'coach'`) | Same reason as TE2. A later swap, skip, gym change or D21 Undo just re-computes the built-in version instead of dropping it. Only the coach version can go stale (CR3) |

---

## 2. Layout (390 × 844)

The overview's regions are unchanged (workout-overview.md §3). This slice adds:
- the **Lighter start line** between the muscles line and the list header, only when offered;
- an **edit count** in the list header;
- **edit markers** and panel actions on rows;
- a **Reorder** mode;
- two sheets: Swap (the existing exercise-library §2.5 sheet) and Lighter start.

### 2.1 Overview with edits

Ben is back after 5 weeks. Bench is taken, so he swaps it and starts with incline. He skips cable fly.

```
┌────────────────────────────────────────┐
│ ⌄                     [Main gym ▾]  ⋯  │ ⋯ adds: Reorder · Reset today's edits
│ AFTER PULL A · MON 31 AUG              │
│ Push A                                 │
│────────────────────────────────────────│
│  ≈ 45 min  │  ≈ 18:50  │     12        │ recomputed: skips drop out
│  TIME      │  DONE BY  │    SETS       │
│────────────────────────────────────────│
│ Chest · Shoulders · Triceps            │
│ Last workout 5 weeks ago               │ LighterStartLine (fact = actual)
│                     ( Lighter start? ) │ outline pill, 44pt
│                                        │
│ 5 EXERCISES · 3 EDITED         TARGET  │
│ 01 Incline DB press          SAME      │ moved first (Do first)
│    3 × 8–10 · 2 warm-ups  30 kg each   │
│ 02 DB bench press         ⇄ SWAPPED    │
│    3 × 6–8              32.5 kg each   │
│  ┌──────────────────────────────────┐  │ row panel (open)
│  │ SWAPPED  For Bench press · today │  │
│  │ LAST   32.5 kg each × 8 · 17 Aug │  │ actual
│  │ (Undo swap) (Swap again)         │  │
│  │ (How to) (History) (Why?)        │  │
│  │ Change Push A too ›              │  │ → change-review, Future sessions
│  └──────────────────────────────────┘  │
│ SUPERSET                               │
│┃03 Lateral raise           SAME        │
│┃   3 × 12–15              10 kg each   │
│┃04 Triceps pushdown        ↑ REPS      │
│┃   3 × 10–12                  25 kg    │
│ 05 Cable fly              ⊘ SKIPPED    │ text.tertiary name + detail
│    3 × 12–15                     —     │
│                                        │
│ CHECK-IN        (1)(2)(3)(4)(5)        │ only when due
│ [            Start workout           ] │ the only filled pill
└────────────────────────────────────────┘
```

Rules:
- **Edit markers** take the `ChangeMarker` slot. They use the same type and colour (`text.secondary`, 12/600 caps, icon + word). The order of precedence is: `⊘ SKIPPED` > `⚠ HELD` > `⚠ NO LOAD` > `⇄ SWAPPED` > the overview §4 change markers (so a swapped `NEW` row shows `⇄ SWAPPED`, and its panel shows `NEW`). A swapped row's `CHANGE` panel line compares the substitute with **its own** last comparable session.
- **Moved rows have no marker.** The index numbers show the new order. `Do first` and Reorder count once each in `N EDITED` (one `order` edit), however many rows moved.
- **Skipped rows stay in place**, in `text.tertiary`, with the load cell `—`. They're still one button, so the panel can `Bring back`. They're left out of `TIME`, `DONE BY`, `SETS` and the muscles line.
- **The list header** reads `5 EXERCISES · 3 EDITED` when the draft has applied edits, otherwise `5 EXERCISES`. Lighter start counts as one edit.
- **Supersets:** a swapped member keeps the bracket and letter. Skipping a member leaves the others bracketed when two or more are left. With one left, the bracket goes for today. `Do first` on a member moves the whole group.
- **WARM-UP, PLATES and BEST** panel lines follow the overview rule ("first barbell exercise only") on the **edited** order.

### 2.2 Row panel actions (`OverviewRow` panel, outline pills, 44pt, wrapping)

| Row state | Pills, in order |
|---|---|
| Normal | `Swap today` · `Skip today` · `Do first` (hidden on the first row or group) · `How to` · `History` · `Why?` (+ coach `Undo` / `Use coach target` from overview §5) |
| `⚠ NO LOAD` | Same, with `Swap today` first and its panel line `ROUNDED`/missing item as overview §8 |
| Swapped | `Undo swap` · `Swap again` · `Skip today` · `Do first` · `How to` · `History` · `Why?`, then the link `Change Push A too ›` (routine basis only) |
| Skipped | `Bring back` · `How to` · `History` |
| The only exercise not skipped | `Skip today` hidden |

Panel lines added: `SWAPPED  For Bench press · today` and `SKIPPED  Today`. Lighter start adds `TODAY  Lighter start · 100 → 80 kg` to each changed row.

Long-press on a row opens the iOS context menu with the same actions (`Swap today`, `Skip today` / `Bring back`, `Do first`, `Move up`, `Move down`). It's a shortcut only; every action is also a visible button.

### 2.3 Reorder mode (`⋯` → `Reorder`)

```
┌────────────────────────────────────────┐
│ Reset order                      Done  │ Reset only when the order changed
│ Push A                                 │
│ 5 EXERCISES                            │
│ ≡ 01 Incline DB press        [↑] [↓]   │ ReorderRow: drag handle + 44pt buttons
│ ≡ 02 DB bench press          [↑] [↓]   │
│ ┃≡ 03 Lateral raise ┐        [↑] [↓]   │ a superset moves as one row
│ ┃   Triceps pushdown┘                  │
│ ≡ 05 Cable fly · skipped     [↑] [↓]   │
│                                        │
│ [            Start workout           ] │ still live
└────────────────────────────────────────┘
```

- Each move writes a new `order` edit at once (drag on release; `↑`/`↓` per tap). There's no separate save. `Done` leaves the mode. `Start workout` stays visible and live, so starting from Reorder mode keeps the order.
- `Reset order` removes the `order` edit (toast with Undo).
- No reorder animation (premium-feel §4.3, "Lists"). With Reduce Motion, nothing changes: there is no motion to remove.

### 2.4 Swap sheet (reuses exercise-library §2.5, large detent)

The header is `Swap Bench press` / `At Main Gym · today only`. Intents, reasons, pain warnings and `Search all exercises ›` are unchanged. Overview-specific rules:
- **Candidates** come from `rankSubstitutions(exerciseId, gymId, intent, {excludeExerciseIds})`. They are limited to exercises doable with the **selected** gym's usable equipment (out-of-order items excluded; there's no `Busy today` before Start). Anything already in today's plan after edits is excluded, including skipped exercises (bring those back instead).
- The substitute keeps the slot's set types, sets, reps, effort and rest (exercise-library §2.5). Each row's trailing value is the **target load** it would get today (`Target 32.5 kg each × 6–8`), from `nextTargetsFor` on its own history and fitted with `snapPlanToGym` (mode `start`). With no comparable history it shows `No history` (shortened per the minimal-copy convention from exercise-library's `No history: start light, enter your load.`), and the row gets `NEW` with load `—`.
- Choosing a row closes the sheet and applies the swap (TE3). A substitute with its own pain flag asks `DB bench press may hurt` [Add anyway] [Choose another] first (EL9).
- `Swap again` reopens the sheet for the **original** slot. The original exercise is listed first as `Bench press · planned` so Ben can swap back. Choosing it is the same as `Undo swap`.

### 2.5 Lighter start sheet (medium detent; large at AX1+)

```
┌────────────────────────────────────────┐
│ Lighter start                    Close │
│ [▦ Today only]                         │ ScopeBadge
│ Last workout Mon 31 Aug                │ actual
│                                        │
│                         TARGET         │
│ Incline DB press  30 → 22.5 kg each    │ before → after, tabular
│ DB bench press    32.5 → 25 kg each    │ −20% of last load, rounded down
│ Lateral raise     10 → 7.5 kg each     │
│ Triceps pushdown        25 → 20 kg     │
│                                        │
│ Why? ›                                 │
│ (Not now)                  [ Apply ]   │ Apply = this sheet's PrimaryButton
└────────────────────────────────────────┘
```

- **Built-in numbers (R2):** for each returning exercise (TE6), after = its **last comparable working load** × (1 − band %), snapped **down** at the selected gym, and never above today's target. Sets and reps stay as planned, and the planned RPE of those working sets is capped at 7 (R2; not shown on the sheet, only in `Why?` and on the set card's effort target).
- **Equipment minimum (R2):** if the reduced load is below the item's minimum, the load goes to the minimum. If that is no lighter than today's target, the load stays and the rep target drops by 2 at both ends, not below 1 (the line reads `Lateral raise  2.5 kg each · 12–15 → 10–13`). R2 says "1–2 reps"; 2 is chosen so the session is lighter in every case. If neither load nor reps change, the exercise isn't listed.
- One line per exercise that changes. Exercises that don't (not returning, bodyweight, timed, `NEW`, `NO LOAD`, already at or below the reduced load) go into one `No change: …` line in `text.secondary`, omitted when empty. Skipped exercises aren't listed. If no line would change, the offer isn't shown at all.
- With the coach live: the header adds the `Coach` SourceTag. Without the coach, the sheet has no author tag (overview §5: no `Built-in rule` on screen; R6). `Why?` says who set it.
- `Why? ›` (info sheet, no AI): `Last workout 31 Aug · 41 days.` · `4–12 weeks: 20% lighter, rounded down to loads here.` · `Same sets and reps. Effort RPE 7 or less.` · `Set by Built-in rule` (or `Set by Coach`, with the coach's one-line reason in quotes). Per-row gaps that differ from the workout gap show on that row's line (`Lateral raise · 13 weeks: 40%`).

After `Apply`, the page line becomes:

```
│ ↓ Lighter start · today          Undo  │ Undo = 44pt text button
```

---

## 3. States

### 3.1 Draft and page

| State | Shows | Notes |
|---|---|---|
| No draft | Overview as workout-overview.md | The first edit creates the draft |
| Draft, edits applied | Markers, `N EDITED`, recomputed strip | — |
| Saving an edit | Nothing visible (local write). The row updates on success | `timing.placeholderDelay` doesn't apply to writes |
| Edit write failed | Toast `Couldn't save that edit.` The row stays as it was | Retry reuses the opId |
| Edit rejected as stale (draft version moved) | The page re-renders from the stored draft, with toast `Targets updated` | Rule 5. Rare: one page, one writer, but late coach writes exist |
| An edit no longer fits the plan (routine edited and the slot is gone, an `order` whose slot set changed, a **coach** Lighter start whose base target moved) | The edit is marked `stale` and dropped from the view. Toast `Plan changed · 1 edit removed` | All-or-nothing per edit (CR3). A built-in Lighter start never goes stale (TE11): it re-computes. After a stale coach one, the offer re-computes if R1 still holds |
| Edit made redundant (a template change now matches it) | The edit is dropped silently. The row shows the same exercise, with no `SWAPPED` marker | Applying `Change Push A too ›` does this in the same transaction |
| Reopened, draft still open | Edits shown as left | Same day, same basis |
| Page open across local midnight | Nothing changes while the page is open; Start consumes the draft as normal | TE5. Expiry runs on the next open |
| Another routine opened (`⋯` → `Other routine`) | That routine's own draft, if any (one open draft per basis, ADR draft §1). The first routine's draft is kept until expiry or any Start | — |
| Reopened after expiry (midnight) or after another workout started | No edits. A one-time toast `Earlier edits cleared` if the draft had edits Ben hadn't started with | Honest, once |
| Gym changed on the page | Every row re-fits. Edits are kept. A swapped substitute that isn't doable at the new gym shows `⚠ NO LOAD` with `Swap again` first | Lighter start stores intended loads, so it re-fits and doesn't go stale |
| Check-in What's up? adds a pain flag | The affected row shows `⚠ HELD` before Start. A swap or lighter start on it stays (both only hold or lower) | — |
| Reorder mode | §2.3 | Start live |
| Every exercise but one skipped | That row's `Skip today` is hidden | Ben can use `⋯` → `Empty workout` |
| Start with a draft | One transaction: re-plan, apply edits, check `expectedPreviewKey` (which now includes the draft id and version), create the session, mark the draft consumed | A stale key creates nothing (OV4) |
| Force-close at any point | Relaunch → Today. The draft is intact. Opening the overview shows it. Today's Up next rows reflect it too (§9 follow-up) | Never a session |
| Offline / no AI | Everything works. Lighter start uses built-in numbers | Rule 1 |
| Workout active (another path) | Overview unreachable (OV11). Any start discards every open draft | — |

### 3.2 Lighter start

| State | Trigger | Shows |
|---|---|---|
| Not offered | Workout gap < 14 days, no returning exercise, nothing would change, a playbook rule (R1/R2) not approved, or Ben turned it off (§4.5) | Nothing. No placeholder |
| Offered | R1 holds | `Last workout 5 weeks ago` + `Lighter start?` |
| Sheet, built-in | No coach configured, or coach not merged yet | Built-in numbers at once |
| Sheet, coach checking | Coach live and reachable (after coach v1) | `Checking…` (static `ellipsis`, no shimmer) for up to `timing.coachTimeout`. `Not now` works; `Apply` is hidden |
| Sheet, coach answered | Validated coach proposal | Coach numbers + `Coach` tag. Guard notes (`No increases in a lighter session.`, rounding) appear only in `Why?` |
| Sheet, coach failed / offline / timed out | Route exists but can't answer | Built-in numbers with `wifi.slash` + `Coach offline` under the title (minimal-copy audit C11). Honest, no coach wording |
| Applied | `Apply` | Sheet closes. Line `↓ Lighter start · today` + `Undo`. Changed rows get their marker from `targetChangeMarker` as usual (normally `↓ DOWN`; `↓ REPS` for an equipment-minimum row) and the panel `TODAY` line. Toast `Lighter start · today` [Undo] |
| Undone | Toast or line `Undo` | Previous targets back. The offer line returns |
| Not now | `Not now` / `Close` / swipe down | Nothing changes. The line stays (static, never repeated as a pop-up) |
| Plan changes after Apply (swap, skip, gym, D21 Undo) | Built-in (TE11) | The rows re-compute with R2 applied to the current plan. A swapped-in returning substitute gets its own lighter target; a skipped row drops out. No toast |
| Stale | Coach version only: the base intended target of any changed exercise moved | The edit drops (toast `Plan changed · 1 edit removed`). The offer re-computes |

### 3.3 Transitions

```
Overview ─row─► panel ─Swap today─► Swap sheet ─pick─► Overview (row ⇄ SWAPPED, toast Undo)
                  │                      └─may hurt─► confirm ─Add anyway─► same
                  ├─Skip today─► row ⊘ SKIPPED (toast Undo) ─Bring back─► row restored
                  ├─Do first─► row moves to 01 (toast Undo)
                  └─Change Push A too ›─► change-review (Future sessions) ─Apply─► routine v+1, today edit absorbed
Overview ─⋯ Reorder─► Reorder mode ─moves─► … ─Done─► Overview
Overview ─Lighter start?─► sheet ─(Checking…)─► before/after ─Apply─► Overview (↓ line, toast Undo)
                                                          └─Not now─► Overview (unchanged)
Overview ─Start─► [one transaction] ─ok─► Workout (Ready, first pending set of the edited order)
                                   └─stale─► Overview re-rendered, `Targets updated`
Overview ─Close─► Today (draft kept until midnight / any start / Reset)
```

---

## 4. Interactions

### 4.1 Tap counts (from the overview)

| Edit | Taps | Then to the first logged set |
|---|---|---|
| Skip one exercise | 2 (row, `Skip today`) | +2 (Start, Log) |
| Do first | 2 (row, `Do first`) | +2 |
| Swap | 3 (row, `Swap today`, pick) | +2 |
| Lighter start | 2 (`Lighter start?`, `Apply`) | +2 |
| Undo any edit | 1 (toast `Undo`, within `timing.undoToast`), or 2 later (row → `Undo swap` / `Bring back`; line `Undo`) | — |

With no edits the path is unchanged: Start → Start → Log (OV2).

### 4.2 Commands (every write: op ID + expected draft version)

| Action | Call | Undo |
|---|---|---|
| Swap today | `services.overview.edit({basis, edit: {kind: 'swap', slotKey, toExerciseId}, expectedDraftVersion, opId})` | `services.overview.undoEdit({draftId, editId, expectedDraftVersion, opId})` |
| Skip today / Bring back | `edit({kind: 'skip', slotKey})` / `undoEdit(editId)` | Toast, or `Bring back` |
| Do first / Move up / Move down / drag | `edit({kind: 'order', slotKeys[]})`. It replaces the previous `order` edit (the old one is marked removed, not deleted) | Toast (Do first only), or `Reset order` |
| Lighter start Apply | Built-in: `edit({kind: 'lighter_start', mode: 'rule', ruleRef: 'R2', playbookVersion, workoutGapDays})`. Coach: `edit({kind: 'lighter_start', mode: 'coach', coachActionId, changes[{slotKey, beforeIntended, afterIntended, repsAfter?}]})` | Toast or line `Undo` |
| Reset today's edits | `services.overview.resetEdits({draftId, expectedDraftVersion, opId})`: every open edit is marked removed | Toast `Today's edits reset` [Undo] → `restoreEdits` |
| Change Push A too › | Opens change-review with a Ben-authored `future_template` proposal. On Apply: `updateRoutine` (new version) and, in the same transaction, the matching today edit is marked `redundant` | Change-review's Undo (the routine version is reverted; the today swap comes back as an edit) |
| Start | `services.workout.start({…, draft: {id, expectedVersion}, expectedPreviewKey, opId})` | Workout `⋯` → `Discard workout` (unchanged) |

Edits are never deleted: Undo appends `removedAt`/`removedOpId` to the edit, and the draft version bumps. Repeating an `opId` is a no-op that returns the current draft.

### 4.3 After Start

- Swapped rows start as the substitute exercise, with `planned.provenance` noting `Swapped before start · Bench press`. In-workout `Why?` shows it. Undo is no longer offered for a pre-start edit after Start: Ben uses the normal workout actions (`Swap exercise`, `Skip exercise`, `Add set`).
- Skipped rows start as `skipped` sets (`skippedBy: 'before_start'`), shown in the Skipped style. `Add set` brings the exercise back (TE9).
- The order is the session's exercise order. The first pending set is the first row.
- Lighter-start sets carry `planned.source` (`rule` or `coach`), planned RPE ≤ 7 (R2), and a provenance reason (`Lighter start · last workout 31 Aug`). The check-in's lighter-session offer isn't raised (TE10).
- Next-session targets: a skipped exercise keeps its current next target (no done sets). A swapped-away exercise is unchanged. The substitute progresses on its own history. The ramp back after a lighter start (R3) is out of scope here: it needs Ben's approval of R3.

### 4.4 Voice (for voice.md; no voice on this page until build step 5)

Deterministic local commands, no coach:

| Say | Result | Voice strip |
|---|---|---|
| "skip cable fly" / "skip cable fly today" | Skip edit, with Undo | `Cable fly skipped today` [Undo] |
| "do incline first" | Do first | `Incline DB press first` [Undo] |
| "swap bench" | Opens the Swap sheet (a pick needs a tap) | — |
| "lighter start" | Opens the Lighter start sheet. **Apply needs a tap** (it changes targets; same reasoning as GS9) | — |
| "start" / "start workout" | Start | — |
| "undo" | Undoes the latest edit | `Undone` |

No spoken cues come from this page.

### 4.5 Settings

Profile → Coaching → `Lighter start after a break` (On by default once R1/R2 are approved). The thresholds and percentages are **Coaching knowledge** (playbook R1/R2), edited in the playbook, not here (rule 10).

### 4.6 Accessibility

- All pills are ≥ 44pt; Reorder `↑`/`↓` are 44 × 44; the Lighter start pill is 44pt high.
- VoiceOver row labels add the edit: "2, DB bench press, swapped for Bench press today, 3 sets of 6 to 8, target 32.5 kilograms each." / "5, Cable fly, skipped today." The Reorder buttons are "Move Incline DB press up". A long-press context menu is also exposed as VoiceOver custom actions.
- Lighter start sheet lines read "Incline DB press, target 30 to 22.5 kilograms each."
- At AX1+: the Lighter start line stacks (fact, then pill full width), the sheet goes large and each line stacks (name, then before → after), and Reorder rows put the buttons under the name. Numbers never truncate. Start stays in the fixed bar.

---

## 5. Copy (complete for this slice)

All loads here are **targets**, except `LAST` and the `Last workout …` fact, which are **actuals**.

| Element | Text |
|---|---|
| Row pills | `Swap today` · `Skip today` · `Do first` · `Undo swap` · `Swap again` · `Bring back` |
| Context menu | `Swap today` · `Skip today` · `Bring back` · `Do first` · `Move up` · `Move down` |
| Markers | `⇄ SWAPPED` · `⊘ SKIPPED` |
| Panel lines | `SWAPPED  For Bench press · today` · `SKIPPED  Today` · `TODAY  Lighter start · 100 → 80 kg` |
| List header | `5 EXERCISES · 3 EDITED` |
| `⋯` menu | `Reorder` · `Reset today's edits` |
| Reorder | `Reset order` · `Done` · `· skipped` |
| Swap sheet (overview) | `Swap Bench press` · `At Main Gym · today only` · `Bench press · planned` · `Target 32.5 kg each × 6–8` · `No history` · `Change Push A too ›` |
| Lighter start line | `Last workout 5 weeks ago` · `Lighter start?` · after Apply `↓ Lighter start · today` · `Undo` |
| Lighter start sheet | `Lighter start` · `Today only` · `Last workout Mon 31 Aug` · `TARGET` · `30 → 22.5 kg each` · `No change: …` · `2.5 kg each · 12–15 → 10–13` · `Checking…` · `Coach offline` · `Why? ›` · `Not now` · `Apply` · `Close` |
| Lighter start `Why?` | `Last workout 31 Aug · 41 days.` · `2–4 weeks: 10% lighter` / `4–12 weeks: 20% lighter` / `12+ weeks: 40% lighter` `, rounded down to loads here.` · `Same sets and reps. Effort RPE 7 or less.` · `Set by Built-in rule` / `Set by Coach` |
| Toasts | `Bench press → DB bench press · today` [Undo] · `Cable fly skipped today` [Undo] · `Incline DB press first` [Undo] · `Lighter start · today` [Undo] · `Today's edits reset` [Undo] · `Order reset` [Undo] · `Plan changed · 1 edit removed` · `Earlier edits cleared` · `Couldn't save that edit.` · `Targets updated` (existing) |
| Pain confirm (EL9, shortened per minimal-copy audit A25) | `DB bench press may hurt` · `Shoulder pain flagged 6 Oct.` · `Add anyway` · `Choose another` |
| Settings | `Lighter start after a break` |
| Voice strip | `Cable fly skipped today` · `Incline DB press first` · `Undone` |

"5 weeks ago" is `floor(days / 7)` weeks. VoiceOver reads the date ("Last workout Monday 31 August, 5 weeks ago").

There are no reassurance lines, no rule names on the page and no explanations outside `Why?`. "Same sets and reps" lives only in `Why?`: on the sheet it would be a reassurance line, and it isn't true for an equipment-minimum row.

---

## 6. Data needed

**Existing:** `buildWorkoutOverview`, `previewKey`, `services.overview.load`, `services.workout.start`, `planRoutineStart` / `startFromSession` (`preview: true`), `snapPlanToGym` (mode `start`), `rankSubstitutions`, `nextTargetsFor`, `getComparableHistory`, `painFlagCovering`, `estimateRemainingDuration`, `targetChangeMarker`, `evaluateCheckInOffer`, `requestCoachAdjustment` / `validateCoachProposal` (after coach v1), change-review's `future_template` proposal + `updateRoutine`, `expireProposals`.

**New (pure, `packages/domain`, unit-tested):**

| Function | Contract |
|---|---|
| `applyTodayEdits(plan, edits, ctx)` | `plan` = the unfitted dry-run plan (slots with intended targets). Applies open edits in a fixed order (skip, swap, order, lighter_start) and returns `{plan, outcomes: {editId, result: 'applied' \| 'stale' \| 'redundant' \| 'blocked', reason?}[]}`. A swap re-plans the slot with the substitute's own `nextTargetsFor`. A `lighter_start` in `mode: 'rule'` runs `buildLighterStartOffer` on the edited plan and applies its changes (never stale; it changes nothing if the offer is now `null`). In `mode: 'coach'`, a change applies only if the slot's current `intended` equals `beforeIntended`; otherwise the whole edit is `stale`, except that changes on skipped slots are ignored. An `order` edit whose slot set no longer matches is `stale`. Never touches equipment fitting: `snapPlanToGym` runs after it |
| `buildLighterStartOffer(plan, history, playbook, gym, now)` | Returns `null` or `{workoutGapDays, lastSessionDate, changes[{slotKey, gapDays, percent, beforeIntended, afterIntended, beforeFitted, afterFitted, repsBefore?, repsAfter?}], noChange[slotKey]}`. Uses R1 (workout gap ≥ 14 days for the offer; each slot's own gap and usual-spacing exception for `returning`) and R2 (band by the slot's gap, from its last comparable working load, snapped down, capped at today's target, equipment-minimum rep cut, RPE ≤ 7). A slot lands in `changes` only if its fitted load or reps go down. Returns `null` when there are no changes. Skipped slots are ignored |
| `swapCandidatesForOverview(slot, plan, gym, history, painFlags)` | Thin wrapper over `rankSubstitutions` with `excludeExerciseIds` (plan after edits) and the gym's usable equipment, plus each candidate's fitted target and `mayHurt` |
| `previewKey(...)` | Adds `draftId` + `draftVersion` to the inputs (workout-overview §7) |

**New service calls:** `services.overview.edit`, `undoEdit`, `resetEdits`, `restoreEdits`, `services.overview.lighterStart({draftId?, gymId})` (built-in now; the coach path after coach v1 calls `requestCoachAdjustment(…, {origin: 'break_offer', intent: 'lighter_start'})` against the **draft**, not a session, with the validator dropping any increase (`lighter_no_increase`) and anything below the equipment minimum). `services.overview.load` returns the draft and its edit outcomes. `services.workout.start` accepts `draft`.

**Schema:** the `PreStartDraft` record and `TodayEdit` union in the ADR draft, with `lighter_start` split into `mode: 'rule'` and `mode: 'coach'` variants (TE11; the ADR draft §1–§2 still shows one numbers-only variant and needs the matching change). `SetStatus` gets the `skippedBy?: 'before_start' | 'in_workout'` provenance. `session.source.todayEdits?` keeps the applied edits for history and `Why?`.

The screen formats only. It never applies an edit, computes a target or decides an offer.

---

## 7. Acceptance checks

Fixture: Push A at Main Gym (bench 3 × 100 kg × 6–8 with 2 warm-ups, incline 3 × 30 kg each × 8–10, superset lateral raise 3 × 10 kg each + triceps pushdown 3 × 25 kg stack, cable fly 3 × 50 kg stack × 12–15). Last lifting session (Pull A) 41 days ago, Mon 31 Aug; each exercise's last comparable working load equals today's target, and DB bench press was last done 17 Aug at 32.5 kg each × 8. Hotel · Lisbon: dumbbells 2.5–20 kg each, no barbell, no cable.

- **TE-A1. Nothing before Start.** Making, undoing and resetting any edit creates no session row. Close returns to Today with no session. The draft row exists with its edits.
- **TE-A2. Preview = Start.** For every combination of swap, skip, order and lighter start (property test over the fixture plus generated plans, every load convention), the overview rows equal the pending sets, order and skipped sets of the session Start creates.
- **TE-A3. Skip.** `Skip today` on cable fly is 2 taps. The row shows `⊘ SKIPPED`, `SETS` drops by 3 and `TIME` drops. After Start, cable fly's 3 sets are `skipped` with `skippedBy: 'before_start'`, and `Add set` in the workout brings it back. The last unskipped exercise has no `Skip today`.
- **TE-A4. Swap.** `Swap today` on bench lists only exercises doable at the selected gym that aren't already in the plan. Each shows a target from its own history fitted to the gym, or `No history…`. A load is never converted from bench's 100 kg. Picking DB bench press shows `⇄ SWAPPED`, and the toast Undo restores bench exactly.
- **TE-A5. Swap and pain.** With a shoulder flag on DB bench press, picking it asks `… may hurt` first, and `Choose another` changes nothing. With a flag on bench, a same-movement substitute's target is never above its own last working load (EL6, if approved).
- **TE-A6. Do first and reorder.** `Do first` on incline makes it `01` and Start opens Ready on incline set 1. `Do first` on lateral raise moves the whole superset. Reorder works with buttons only (no drag) and with VoiceOver custom actions. `Reset order` restores the routine order.
- **TE-A7. Template is a proposal.** `Change Push A too ›` opens change-review with scope `Future sessions`, author `Ben`. The routine version doesn't change until Apply. After Apply the row shows DB bench press with no `SWAPPED` marker, the draft edit is `redundant`, and Undo on the change-review toast brings both back.
- **TE-A8. Lighter start offer.** With a 41-day gap and R1/R2 approved, the line shows `Last workout 5 weeks ago` and `Lighter start?`. With a 13-day gap, or the setting off, nothing renders. Opening the page makes no AI call (provider log).
- **TE-A9. Lighter start values.** The built-in sheet shows −20% (41-day gap) from each exercise's **last comparable working load**, rounded down to loads at the selected gym and never above today's target (incline 30 → 24 → `22.5 kg each` on a 2.5 kg rack; bench 100 → `80 kg`). No line is higher than before. Bodyweight, timed, `NEW` and `NO LOAD` rows are under `No change`. Sets and reps are unchanged and the changed working sets carry planned RPE ≤ 7. Unit tests also cover: a 20-day gap (−10%), a 90-day gap (−40%), a per-exercise gap that differs from the workout gap, R1's usual-spacing exception (an exercise done every 3 weeks isn't returning at 20 days), and the equipment minimum (load kept, reps −2 at both ends, not below 1).
- **TE-A10. Lighter start apply and undo.** Nothing changes until `Apply`. After `Apply`, the rows, `CHANGE` panel lines and the Start-created session all have the lighter targets, with provenance `lighter_start` and source `rule`. The toast or line `Undo` restores every target exactly.
- **TE-A11. Lighter start with the coach (after coach v1).** Tapping `Lighter start?` with the coach live sends one request, scoped to the draft. A reply that raises any load has that change dropped (`No increases in a lighter session.` in `Why?`). A timeout shows the built-in numbers with `Coach offline`, never coach-styled text. With no coach configured, no `Coach` tag or coach text appears anywhere.
- **TE-A12. Lighter start + check-in.** After a lighter start is applied and a check-in score of 2 is given, the first set card shows no `Want a lighter session today?` offer.
- **TE-A13. Gym change keeps edits.** Switching to Hotel · Lisbon keeps the skip and order. The swapped DB bench press re-fits (capped at 20 kg each), and the built-in lighter start re-computes for the new gym without going stale. A swapped substitute needing a cable shows `⚠ NO LOAD` with `Swap again` first.
- **TE-A14. Stale edits (rule 5).** Undoing a D21 coach target on a row covered by a built-in lighter start re-computes that row with no toast; with a **coach** lighter start it drops the edit (`Plan changed · 1 edit removed`) and the offer re-computes. Swapping a row after a built-in lighter start gives the substitute its own lighter target if it's returning. Editing Push A to remove cable fly drops the skip edit. An edit command with an old `expectedDraftVersion` is rejected and the page re-renders.
- **TE-A15. Idempotent.** Repeating any edit, undo or Start `opId` (double tap, retry after a simulated write error) gives exactly one change and at most one session.
- **TE-A16. Force-close.** Kill the app after a swap, a skip and a lighter start. Relaunch → Today (no session). The overview shows all three edits. Start consumes the draft, and a second overview open shows no edits.
- **TE-A17. Expiry.** A draft with edits expires at the first open after local midnight (in the draft's timezone), and is discarded when any workout starts from another path (Empty workout, Repeat, voice). The next overview open shows `Earlier edits cleared` once. With the overview left open from 23:55, Start at 00:05 keeps the edits.
- **TE-A18. Offline.** In airplane mode with no AI, every edit, Undo, Reset, the built-in Lighter start and Start work.
- **TE-A19. Backup.** A backup taken with an open draft restores with that draft marked `discarded` (restore never revives a draft). Drafts are exported and deleted with **Your data**, and never appear in coach context before Start, except the one Lighter start request Ben taps (TE6), which carries today's edited plan only.
- **TE-A20. Visual.** Only one filled pill is visible on the page (Start). The Lighter start sheet's `Apply` is the only filled pill while the sheet is up. Markers carry icon + word. Every pill is ≥ 44pt. At AX3 on 375pt, nothing scrolls sideways and Start stays visible in Reorder mode too.

---

## 8. Proposed design-system additions (components only; no new colour, type or timing tokens)

| Component | Spec |
|---|---|
| `ChangeMarker` variants | `swapped` (`arrow.left.arrow.right` + `SWAPPED`) and `skipped` (`minus.circle` + `SKIPPED`), `text.secondary`, same frame as the other markers |
| `OverviewRow` skipped style | Name and detail in `text.tertiary`, load `—`, still a 64pt button |
| `LighterStartLine` | `type.callout` fact (`text.secondary`) + an outline pill (`border.control`, 44pt, `radius.pill`, label `type.headline` in `text.primary`, **never accent**). Applied variant: `arrow.down` + text, trailing `Undo` text button. Stacks at AX1+ |
| `BeforeAfterLine` | Name left, `30 → 25 kg each` right (tabular, `→` read as "to"). Stacks at AX1+ |
| `ReorderRow` | Existing (routines.md); here also used for a superset as one row with a bracket |

These go into design-system.md §9 when that file is free (same as workout-overview.md's follow-ups).

---

## 9. Effects on other specs (follow-ups for the product manager; not edited here)

- **workout-overview.md:** §6's "Not in the first slice" points here. OV1/OV3/OV4/OV9 extend to drafts (OV9: the only possible AI call is `Lighter start?` with the coach live, after coach v1). §5's "the page has no lighter-session offer" becomes "no check-in lighter-session offer".
- **today.md / premium-feel §2.3:** the Up next rows read the same preview, so they show today's edits (substitute names, skipped rows left out, new order). No extra words. Otherwise Today and the overview disagree.
- **routines.md §4.2:** the detail's `Swap ›` → `Today only` "made at Start" is this slice (the overview replaced the routine sheet and detail Start).
- **check-in.md CI5 / coach-adjustments B′:** TE10 suppression.
- **active-workout.md §4.4:** the `skippedBy: 'before_start'` provenance shows in `Why?` and the Skipped style. There's no new in-workout UI.
- **voice.md:** §4.4 grammar.
- **draft-pre-start-draft.md:** the `lighter_start` `mode` split (TE11), expiry "never while the overview is open" (TE5), and the one coach request that may read the draft (TE-A19).
- **coaching-playbook.md:** the R1/R2/R6 approval gates the offer. `Lighter start after a break` setting in profile-and-settings.
- **workout-summary.md:** swapped and skipped-before-start exercises appear like in-workout ones.

---

## 10. Out of scope

- The R3 ramp back after a lighter start, and any R4 return after a pain flag.
- Adding an exercise before Start (use `⋯` → `Edit routine`, or add in the workout).
- Editing sets, reps or loads per row before Start (Ben edits on the set card, where the keypad and Log live).
- Multi-day or future-session edits (always change-review).

---

## 11. For Ben to confirm

1. **Close keeps today's edits** until midnight, Start, Reset or another workout (TE5). The alternative is that Close discards them, with an Undo toast on Today.
2. **Is this slice worth a schema change now?** The cheaper option is an in-memory draft: the same UI, no migration, and the edits are lost on force-close. The ADR draft compares them.
3. **Lighter start needs R1, R2 and R6 approved** (14 days; −10/−20/−40%; built-in fallback). Is it on by default once approved?
4. **The coach path for Lighter start** makes the overview's only possible AI call (after coach v1, only when Ben taps `Lighter start?`). The alternative is built-in numbers only, with the coach reachable from the workout as now.
5. **EL6** (a same-movement substitute of a flagged exercise is held) is still pending. This slice follows whatever is decided there.
6. **`Change Push A too ›`: change-review card or routine editor?** TE4 sends Ben's own template change through change-review (before/after, Apply, Undo). routines.md §4.2 already sends the same kind of change through the editor's normal Save with no card. One of the two specs should change.
