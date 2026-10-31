# Training blocks (light)

> **(Ben, 26 Oct): RIR replaces RPE in the UI.** Wherever this spec shows effort to Ben as RPE (targets, logged values, entry, sheets, Why?, coach text), the app shows and takes RIR = 10 − RPE (RPE 8.5 → RIR 1.5). Stored values and tool arguments are unchanged; see `workout-table-v3.md` §0.1.

Status: **Approved by Ben, 21 Oct 2026** (answers in §8). Backlog H4. **§1–§3 are for Ben; §4–§8 are for the developer.**

> **Revision (Ben, 22–23 Oct): what Ben's D1–D5 and D9 change here.** Prototype: `prototypes/training-blocks.html` (Today with a plan, Progress with a plan, block review).
> - **Today with a plan is lean (D3):** the header with the block week (§3.1, unchanged), the strip, the day control, then one card: day, `N exercises · ~M min`, any offer line (`◐ Deload this week? Apply ✕`, `✦ <change>? Apply ✕`), `Time [−] 60 min [+]` with its fit note, the session rows, `Why?`, `Start` / `Edit`. Main lift, accessories, abs and supersets are on Your workout (workout-builder-v3 §2.3a). No `Today only` tag, no Start prompt (D1). Full spec: workout-builder-v3 §2.0.2.
> - **Time (D9):** fit-to-time.md's 22 Oct revision; it runs after the deload transform (§4.4), so a deload week fits the lighter draft. The carry-over is an offer (`Carry over`, then `Undo`) and goes to each cut muscle's next day (triceps cut on Chest day → the next Shoulders day; abs → the next day), at most 4 sets in all (review 23 Oct S5, SP3: offer rather than default-on is a proposal for Ben).
> - **Edits from Your workout stay (review 23 Oct, D3 regression):** what Ben changes on Your workout (controls, exercises, set counts) is today's draft; back on Today the card shows it with `Edited`, Start starts it and Edit reopens it. They're replayed after the fit and the coach, so Time never undoes them (FT5).
> - **Coach offers (D2):** the coach's review of today's draft is an offer line, never applied until `Apply`. On Progress › Coach's changes, small next-session changes stay applied with Undo; the stall reset (`Row 3 × 8 → 4 × 6?`) and any extra set Ben didn't ask for are `Apply` / `Skip` (progress-goals.md).
> - **Back-offs (D4):** worked out from their reps and effort against the planned top set, snapped down, inside the plan's Main focus band (Balanced 4–10 % under the top; review 23 Oct S7: Strength and Muscle plans use their own band on Today and in the workout too). **When today's top is lowered, the back-offs drop by the same % and snap down** (training guides SS4, HT8; review 23 Oct): a pain hold (bench 102.5 held at 100) gives `100 / 92.5`, not `100 / 95`; a deload week (§4.4) takes the same −10 % off both, bench `105 / 97.5` → `92.5 / 87.5`. A repeat after hard sessions (the early-deload state: 100 planned) is not a lowering: `100 / 95`.
> - **Muscles (D5):** the block review and Progress count by the detailed list (§2.5, unchanged); rear delts count as Back.

> **Library › Plan v2 (Ben, 27 Oct; [plan-tab-v2.md](plan-tab-v2.md)).** Library's block view is now the plan's header card: `Week 3 of 6 · deload in week 6` (`Week 6 of 6 · Deload week` in it, `Block done` after), week chips `1 … N` with the deload chip reading `6 · Deload`, the current week dotted and the selected week filled, and one list of that week's days (done days ✓ with their date; a past week's days not done are plain, never "missed").

> **Revision (Ben, 23 Oct: plan length = block 1; gap report Q-B1).** A plan made in the plan builder carries its own length (4 / 6 / 8 / 12 weeks), effort and deload schedule (plan-builder.md): **that length is block 1**, so there is no `Start a block` on a builder plan and no `TrainingBlock` document for it (the week is derived from the plan's Apply, pauses and plan workouts as in §4.1; no migration). Deload weeks follow the plan's Effort (Standard: the last week; Push: every 4th; Maintain: none) with §4.4's draft (−10 % rounded down, a set fewer, never below 2, RPE ≤ 7). Today's header shows `Week 3 of 6` / `Week 6 of 6 · Deload` / `Block done`; Library › Your plan has the week strip (done weeks read-only) and, at the end, `Block done · Start next block ›` (the plan builder with the same answers). The block review, planned-vs-done status and early deload (TB3–TB5, V8) are still to build; `Start a block` stays for coach plans made before the builder.

Builds on the approved [workout-builder-v3.md](workout-builder-v3.md) (§1 chain, §4 data, §6 reviews, §8 order), prototypes [today-v2.html](prototypes/today-v2.html) and [progress-reviews.html](prototypes/progress-reviews.html), research [plans-and-plan-progress.md](../research/plans-and-plan-progress.md) (proposals 4 and 6), and the plan pause (`PlanPauseSchema`). Tokens: [design-system.md](design-system.md). Nothing here adds a step to Active set, Rest or Summary.

> Ben: "ideally we would have a longer term plan however which means we dont need to rebuild it much"; "i wouldn't imagine chest sessions should change much week on week, it's more about rotating".

**Flags (need Ben, then CHANGELOG):**
- H4 says "weights … never prescribed week-by-week" and "e.g. 8 weeks". This brief asks for per-week main-lift targets and 6 weeks. §2.2 reconciles them (Q1, Q2).
- `lift-targets.ts` says "the app never predicts when he'll reach it". Ben approved the prototype's `about mid-Nov at this rate`. §3.2 keeps that line as a labelled projection with strict limits (Q8).
- weekly-plan.md WP18 and check 30 count programme weeks by calendar ("Week 2 of 6 whatever was done"). §2.4 makes an empty week not count, to match D19's "no missed" (Q5).
- Spec §6 reserved `blockId?` / `weekN?` on `Routine.planDay` too. Templates outlive blocks, so this puts them on sessions only (Q11).

---

## 1. Purpose

A block is a stretch of usually **6 weeks** on the plan Ben already has: 5 build weeks, then a lighter week. The plan days, templates and variations stay as they are. The block adds three things:
- **Where am I?** `Week 3 of 6` or `Deload week`.
- **Am I on plan?** Each main lift has a planned top set for each week (bench 100 → 102.5 → 105 …), shown next to what he actually lifted.
- **What's next?** At the end, a review shows what happened, asks how it felt and proposes the next block, with fresh accessories if he wants them. Ben applies it with one tap.

No rebuilds: a new block reuses the same plan days. Only the targets move on, plus any accessory swaps Ben approves.

## 2. How it works (plain English)

### 2.1 Start
- When a plan is in use with no block, the goal card offers `Start a block`. A block can also come with a new plan from the coach.
- The code drafts the block: 6 weeks, deload in week 6, and a target path for each main lift from his current top sets. If a lift target has a date (`Bench 110 by 15 Dec`), the block length is fitted to it (4–8 weeks). If more than 8 weeks are left, the card shows `Block 1 of 2`.
- With AI available, the coach can adjust the draft (path size, length). Code checks every number. Ben sees it and taps `Start block` (Undo available).

### 2.2 Weekly targets (planned vs done)
- Each main lift gets a **planned top set per week**: one achievable step per build week (2.5 kg on a barbell, the next dumbbell or the next stack pin), from what he's lifting now. On a Muscle goal, reps go up first, then load.
- **Recommended (Q1):** the path is the plan he's measured against, as in Runna. **Today's load still comes from his last sessions** (the approved load order, Q12). If he's ahead, he stays ahead. If he falls behind, the weekly review raises it. The app doesn't jump to a planned number he hasn't earned. This keeps H4's "weights from performance" and gives him "planned vs done".

### 2.3 Deload
- **Planned:** the last week of the block. Every session that week drafts lighter: loads −10 % (rounded down), one set fewer per exercise (never below 2), and target effort around RPE 7. Ben's playbook rule 10 is "cut sets, keep load if RPE ≤ 7 allows". The exact size is in Q3.
- **Early:** when real signals say so (§4.3), the app **offers** `Deload this week?` in the weekly review or as a line on Today. It never forces one. If Ben accepts, that week is the deload and the block ends after it (Q4).
- Ben can also `Skip deload` (block ends after week 5) or ask the coach for a deload at any time.

### 2.4 Holidays and gaps
- **Pause** (existing): paused days don't count. The block waits, and its end date moves later by the paused time.
- **Empty week** (no lifting, not paused): the week doesn't count and the block waits. Nothing is marked missed (D19). (Q5)
- After a gap of 14 days or more, Today offers `Light first session?` (research proposal 6; the existing −10 % fallback, ADR 0010). It's an offer with Undo.

### 2.5 End of block
- The block review runs on first open after the block's last week. **Facts** (code): weeks done, sessions vs his aim, each main lift's planned vs done, targets hit (`5 of 6`), est. 1RM start → end (labelled `est.`), and weekly sets per muscle (the shared list: Chest, Back, Shoulders, Quads, Hamstrings, Calves, Biceps, Triceps, Core; weeks labelled by their Monday; 22 Oct, design review V1/V2/V4/V6).
- **How did it feel?** `Too easy` · `About right` · `Too hard` (one tap, optional).
- **The coach proposes the next block:** new path, length, and up to 2 accessory swaps per plan day (same muscles and role as `Mix it up`). Main lifts stay, unless Ben asks or a lift has stalled for 2 blocks (then it's an offer only). Ben gets `Apply` / `Skip` per item, and Undo.
- **No AI:** the facts show, with `Not reviewed`. Code offers `Start next block`: same days and accessories, path from the built-in rule, labelled.
- The next block never starts by itself. If he skips the review, the plan carries on as it does now, without the week line (Q9).

## 3. Screens (plain English)

### 3.1 Today: one small line
Today shows the block week in the header after the day name. It shows nothing else, and nothing on the session card (Ben removed `plan day N of 4`).

```
│ Tuesday · Week 3 of 6     ✦  🎙  [⌂ Main ▾]│   build week
│ Tuesday · ◐ Deload week    ✦  🎙  [⌂ Main ▾]│   deload week (icon + word)
```

| State | Header text | Notes |
|---|---|---|
| No block | `Tuesday` | as now |
| Build week | `Tuesday · Week 3 of 6` | `text.secondary`, tabular; tap → Progress › Reviews › Goal |
| Deload week | `Tuesday · ◐ Deload week` | card loads already lower; `Why?` gets `Deload week: −10 % load, 1 set fewer` |
| Early deload offered | header as build week; one line on the card: `Deload this week? · Apply` | an offer (rule 3); `✕` dismisses for the week |
| Paused | the existing pause state wins; no block text | |
| Block finished, review waiting | `Tuesday · Block done ›` | opens the block review |
| Offline / no AI | same text | the week comes from code; nothing hidden |

At accessibility text sizes the week text wraps under the day name. VoiceOver reads it as "Training block, week 3 of 6".

### 3.2 Progress › Reviews › Goal card (with block strip)

```
GOAL
┌──────────────────────────────────────────┐
│ Bench 110 kg × 6              ● On plan  │  status = icon + word
│ Top set · 102.5 now · wk 3 plan 105      │  actual · target
│                                          │
│ BLOCK 1 OF 2 · 12 Oct – 22 Nov           │
│ ┌────┬────┬────┬────┬────┬────┐          │  each cell ≥ 44 pt
│ │ ✓1 │ ✓2 │ ●3 │  4 │  5 │ ◐6 │          │  ✓ done ● now ◐ deload
│ └────┴────┴────┴────┴────┴────┘          │
│  Build ──────────────────────▶ Deload    │
│ Paused 26 Oct – 1 Nov · end moved 1 wk   │  only if paused
│                                          │
│ [trend: done ── solid, plan ┈┈ dotted]   │  existing chart + plan path
│ Plan at block end: 110                   │  target
│ 110 about mid-Dec at this rate     ⓘ    │  projection; hidden if unsure
│                                          │
│ Squat top set   117.5   +5 in 4 wk       │  actual
│ Row top set      92.5   level 3 wk       │
└──────────────────────────────────────────┘
```

- **Status** (code, per lift, vs this week's planned top set): `▲ Ahead` (one step or more above), `● On plan` (within one step), `▼ Behind` (two steps or more below). Icon plus word. It's a comparison, not a score.
- **Cell tap → week sheet** (half height). Each main lift is shown as `Bench · plan 105 × 6 · done 102.5 × 6 @ 8`, with sessions `2 of your 3 days`. Future weeks show plan only. A pain-flagged lift shows `Held · pain` (rule 9).
- **Projection** (`at this rate`): only when there are ≥ 4 weeks of data for that lift, the trend is rising, and the date is ≤ 6 months away. Otherwise the line is hidden. It's a straight line through weekly best top sets, rounded to early/mid/late month. `ⓘ` explains it.
- **No block:** the strip is replaced by `Start a block` (secondary button). **No goal:** the card shows main-lift trends only.

### 3.3 Block review (from Reviews › Latest, or `Block done ›`)
A sheet like the weekly review: verdict line (coach), then facts, then `How did it feel?`, then proposals:
```
│ Block 1 · 6 weeks · done 22 Nov                │
│ Bench   plan 110 × 6 · done 107.5 × 6   ▼ 1 step│
│ Squat   plan 125 × 5 · done 125 × 5       ✓    │
│ Sessions 16 of 18 · targets hit 9 of 12        │
│ How did it feel?  [Too easy] [About right] [Too hard] │
│ NEXT BLOCK (proposal)                          │
│ 6 weeks · bench 107.5 → 115 · squat 125 → 135  │
│ Chest · bench: Cable fly → Cable crossover     │
│ [ Apply all ]   Apply each ›   Skip            │
```
`Apply all` is the primary action. Applying shows `Block 2 started · Undo`.

### 3.4 Copy
`Week 3 of 6` · `Deload week` · `Block done` · `Start a block` · `Start block` · `Block 1 of 2` · `Plan` (target) · `done` (actual) · `On plan` / `Ahead` / `Behind` · `Deload this week?` · `Skip deload` · `Light first session?` · `How did it feel?` · `Too easy` / `About right` / `Too hard` · `Start next block` · `at this rate` · `Not reviewed` · `Out of date. Ask again.` · `Held · pain`. Spoken cues: none new. No lines that explain the rules.

---

## 4. Rules: what code decides vs the coach

| Decision | Code | Coach |
|---|---|---|
| Block week, end date, pause shift, empty weeks | `blockWeekOf` (always) | — |
| Default draft: length, deload week, path | `draftBlock` (labelled fallback without AI) | may change length 4–8, path step size, within bounds |
| Path loads | snapped down to the gym (`snapPlanToGym`), ≤ machine max, ≤ 1 step per build week (Strength), path end ≤ `capE` from est. 1RM | proposes the end value; code clamps |
| Today's working load | approved §3.1 order, unchanged; deload transform on top | small next-session changes as now (rule 3) |
| Deload size | `deloadDraft` (fixed numbers, Q3) | — |
| Early deload | `deloadSignals` decides whether to offer | words the offer; may raise it from the check-in or memories, still as an offer |
| Status Ahead/On plan/Behind, facts, projection | `blockFacts`, `projectGoalDate` | cites them; numbers checked by `checkCoachClaims` |
| Accessory swaps | shortlist (`Mix it up` rules 2 and 4) | picks from the shortlist, max 2 per plan day |
| Next block | `draftBlock` from the end state | `propose_block` |

### 4.1 Week counting (`blockWeekOf`)
Weeks run Mon–Sun in the plan's tz. Week 1 = the week the block is applied when it is applied on its Monday. **Lead-in (Ben, 28 Oct):** applied on any other day, that week is a lead-in: it runs week 1's days, its workouts count as that week's done days (from its Monday, even before Apply) and for Up next, and Today reads `Plan starts Mon 2 Nov` (Library › Plan: `Starts Mon 2 Nov`); week 1 starts the following Monday, so the plan's N weeks and its deload are full weeks after it. A `Move day` in the lead-in is that week's only. Derived from the stored Apply time (no migration): a plan already in its first week becomes a lead-in. A week counts if it has ≥ 1 finished plan session and isn't fully paused. Otherwise the week number holds. Partly paused weeks count if they have a session. Pure function of (block, sessions, pauses, today), never stored, so corrections and deletions re-derive it.

**(Ben, 30 Oct): edits never restart the block.** The block starts at its first Apply. Changes to the plan in use keep its start, its lead-in, its week numbers and its deload, and keep this week's done days and this week's changes (moves, skips, one-week edits): Edit plan (Goals, Days and time, preferences, exercises), Every week edits, plan swaps, re-applying the same plan from the builder (`Set up a plan` while the block runs is Edit plan on it), Pause/Resume (a fully paused week still holds the number, as above). Only a genuinely new plan restarts: `Start next block` on a finished block, a plan built with none in use, or Previous › `Start again`. If an Apply makes a new plan document over the running block, it continues the block (`applied.block`: the block's first Apply and the earlier documents whose workouts count). A plan re-applied before this rule gets its block start back on app open, derived from the plans it superseded. A restore keeps everything exactly as in the backup.

### 4.1a Up next and this week's days (Ben, 31 Oct)
**(Ben, 31 Oct): Up next = least recently trained of the days left this week; schedule breaks ties.** Builder plans, Set days and Any days alike (a coach-built plan has no weeks and keeps the 20 Oct rule):
1. The plan day not done this week whose split type (push, pull, legs, upper, lower, full body; else its body parts) Ben trained longest ago. Every workout of that type counts: plan, off-plan, imported.
2. Ties (the same last-trained date, or never trained): Set days by the schedule (the planning day's own day first, then the earliest scheduled); Any days by plan order.
3. The planning day is today, or **tomorrow once a gym workout is finished today**. An open workout or an activity (a run) doesn't count.
4. Every plan day done this week: the least recently trained day overall. A day skipped this week comes only after those.
5. Ben's own pick wins: the card picker, `Make next` (a pin), and this week's moves. A day he moved onto the planning day is first; one he moved to a later date isn't Up next before it.

This week's dates on Set days (`setDaysWeekSlots`; tiles, the day sheet, Library › Plan's This week):
- The schedule, with Ben's moves.
- **What he did** (implicit swap, this week only, never stored): a plan day done on a weekday scheduled for another day makes that weekday the done day's (never `Missed`). The day it displaced takes the done day's own slot if that is still ahead and free, else the next free day this week, else it is genuinely missed.
- **Up next is the day on the planning day.** The day that held that slot takes Up next's slot if it is ahead, else the next free day. A rest day (no plan day on it) stays a rest day unless Up next's own day has passed. A day still on the date Ben moved it to is never moved by this.
- The day sheet's `Do today instead` and `Move to…` place days where the sheet shows them (the `place` week change), so a change made on this view does what it shows.

One domain rule (`upNextOrder`, `planDaysTypeLastTrained`, `setDaysTieRank`, `upNextPlanningWeekday`, `finishedGymWorkoutOn`, `setDaysWeekSlots` in `packages/domain`) feeds Today's card, Library › Plan's NEXT and This week, the tiles, the day sheet, the morning reminder's first day and the coach's Up next. **Ben's week:** Fri 30 before training, Legs B (legs last Mon); after Legs B, and Sat 31, Pull B (pull last Tue, push last Wed) on Saturday's tile.

**Week changes across plan documents (Ben, 31 Oct).** A re-apply that makes a new plan document within the running block brings this week's moves, skips and one-change edits with it. A plan re-applied before this fix gets them back once on app open, after the 30 Oct block-start repair.

### 4.2 Path (`blockPath`)
Per main lift: `start` = the working top set from §3.1 at Apply, per (splitDayId, mainLift). Build week k = start + (k−1) steps, where a step is the gym's smallest achievable increase for that lift (`loadDirection`). Muscle goal: reps +1 per week up to the top of the range, then +1 step with reps reset. Deload week = the last build week's value × 0.9, rounded down (plan line only). Assisted lifts step down in assistance. Bodyweight lifts get a reps path.

### 4.3 Early-deload signals (`deloadSignals`, real data only, rule 6)
Offer when either of these holds in the last 2 counted weeks:
- (a) 2 or more main lifts are `Behind` by 2 or more steps, and top-set RPE is ≥ 9 on 3 sessions;
- (b) the pre-session review's existing "clear signal" fired on 3 sessions (RPE 9–10, big rep miss, low check-in).

Never in week 1–2. At most one offer a week. `✕` stops the offer for that week. Thresholds go to the training-researcher as playbook candidates.

### 4.4 Deload transform (`deloadDraft`)
Applied by the Today drafter after §3.1 and **before** fitting (fitting runs on the deloaded draft; review 23 Oct S4): working loads × 0.9 rounded down, back-offs included (they drop by the same −10 % as the top, SS4/HT8; D4, Ben 22–23 Oct; workout-builder-v3 §3.1 item 9); sets −1 per exercise (min 2; main lift keeps the top set, back-offs −1); RPE targets min(target, 7). Warm-ups follow. Only today's draft is touched. Templates and completed sets are never changed (rule 2), and `Keep for next time?` measures Ben's changes against the template, not the deloaded draft (workout-builder-v3 §2.8).

**Deload history (PM, 23 Oct).** A workout started in the deload week is marked at Start (`WorkoutSession.deload`, migration 34). The built-in rule, next-session targets, lift estimates (the next block's 6-rep estimate and week-1 loads) and the coach's history read skip it while a normal week compares, or label it; Progress volume and history count it as any workout. See the changelog entry of 23 Oct.

### 4.5 Gym change, pain, units
- Path values are stored with unit and convention, and re-snapped down for the gym Ben is using.
- A lift the gym lacks shows `—` for that week.
- A pain flag freezes that lift's path at its last value until cleared (rule 9).

---

## 5. Data model (developer)

- **`TrainingBlock`** (Your data, new document kind `training_blocks`, migration 0031):
  `{ id, ownerId, planId, n, appliedOnDate, weeks: 4–8, deloadWeek: int | null, lifts: [{ splitDayId, mainLiftExerciseId, exerciseId, reps, start: Load, path: { weekN, reps, load: Load }[], heldByPainAtUtc? }], status: 'active' | 'ended' | 'undone' | 'superseded', ended?: { reason: 'completed' | 'early_deload' | 'skipped_deload' | 'ben' | 'plan_ended', atUtc, opId }, earlyDeload?: { weekN, opId, atUtc }, feel?: 'easy' | 'right' | 'hard', source: 'code' | 'coach', reason?: string, opIds, version, createdAt, tz, updatedAtUtc }`. `Load` = `{ value, unit, convention }`.
- One active block per plan, enforced in the write transaction. Plan End or Supersede ends it (`plan_ended`), and that write's Undo reopens it (same as pauses).
- **Session `planDay`** gains `blockId?`, `weekN?`, `deload?: boolean`, stamped at Start (provenance only). Spec §6 also reserved them on `Routine.planDay`: **drop that** (Q11).
- **Reviews:** `kind: 'block'` with `blockId`. Facts are stored separately from coach text (spec §6.2). The proposal carries `preconditions: { planVersion, blockVersion, templateVersions: { routineId, version }[] }`.
- **Coach tool `propose_block`** (new, strict): `{ weeks?, deloadWeek?, lifts?: [{ exerciseId, endLoad | stepsPerWeek }], swaps?: [{ splitDayId, mainLiftExerciseId, from, to }], reason }`. Code runs §4, the gym checks and `doableHere`, and shows before/after. Swaps write template versions in the same transaction as the block (one opId). Undo = a versioned inverse write.
- **`offer_deload`** isn't a tool: code raises the offer. The coach only adds wording.
- Context to coach: block week, path vs done per lift, feel, pauses. Your data and Coaching knowledge labelled separately (rule 10).
- Backup/export/delete: blocks and block reviews go with Your data. All fields are optional on old rows, so old backups parse.
- View functions: `buildBlockLine` (Today), `buildGoalCardView` (adds `block`), `buildBlockWeekView`, `buildBlockReviewView`. Domain: `draftBlock`, `blockPath`, `blockWeekOf`, `deloadDraft`, `deloadSignals`, `blockFacts`, `projectGoalDate`.

## 6. Product rules

- **Rule 2:** starting, changing or ending a block, the deload, and accessory swaps are proposals with before/after and Undo. Completed sets and templates are never changed by the block. The deload touches today's draft only.
- **Rule 3:** the coach doesn't change loads week to week because of the block. The path is a comparison (Q1). Early deload and the next block are offers. Small next-session changes stay as approved.
- **Rule 5:** every block write has an opId and `expectedVersion`. A proposal whose preconditions moved (template edited, block changed, plan changed) shows `Out of date. Ask again.` and nothing applies.
- **Rule 6:** status comes only from logged sets. Est. 1RM is labelled `est.`. The projection appears only under §3.2's limits and is labelled `at this rate`. No readiness or recovery score. `feel` is Ben's own answer, stored as he gave it.

## 7. Build slices (after the weekly review and Reviews area, per spec §8)

**TB1 Schema and pure domain.** `TrainingBlock`, migration 0031, the session stamp, §4 functions.
- Block applied Wed 14 Oct, sessions in the weeks of 12, 19 and 26 Oct, nothing 2–8 Nov: on 10 Nov `blockWeekOf` = 4 and the end date is 29 Nov (was 22 Nov). The same holds if 2–8 Nov was paused.
- Bench start 100, 1.25 kg plates: path 100, 102.5, 105, 107.5, 110, deload 99 → 97.5 (rounded down). A stack max of 90 caps the path at 90.
- A pain flag on bench set in week 3 (path then 102.5 done): weeks 3–5 show `102.5 · Held · pain` until cleared.
- `deloadDraft` on Chest (bench 4 sets, fly 3): bench top set ×0.9 rounded down, 2 back-offs, fly 2 sets, no RPE above 7; the template's version is unchanged.
- Old backups parse. A backup round-trip keeps blocks.

**TB2 Start a block + Today line.** `Start a block` → draft → `Start block` → `Undo`.
- Airplane mode: the block starts from the code draft labelled as the built-in rule. Today shows `Week 1 of 6`.
- In week 6, Today's card loads are 10 % lower and rounded down. `Why?` shows the deload line. Start, then Summary: nothing on the Summary mentions the block.
- Force-close during `Start block`: either the block exists or it doesn't. Retrying with the same opId writes once.
- Plan End ends the block, and End's Undo restores it as `active`.

**TB3 Goal card strip + week sheet.**
- Cells ≥ 44 pt. VoiceOver reads "Week 3, current, build" and "Week 6, deload". Status never relies on colour alone.
- Bench done 102.5 vs plan 105 at 2.5 kg steps → `On plan`. Done 100 → `Behind`.
- With 3 weeks of data, or a flat trend, the projection line is absent.

**TB4 Weekly review uses the block.**
- The weekly facts list planned vs done per main lift for that block week.
- Signals (a) met in week 4 → one `Deload this week?` offer. Apply → that week drafts as a deload and the block ends after it. Undo restores the week. Week 2 never offers.

**TB5 Block-end review + next block.**
- On first open after week 6, the review appears with facts that match a code recount. A coach sentence with a wrong number is hidden.
- `propose_block` with 3 swaps on one plan day → clamped to 2, with a note. A swap to an exercise the gym lacks is refused.
- Edit `Chest · bench` after the proposal → `Out of date. Ask again.`. Other days' items still apply.
- No AI: facts + `Not reviewed` + `Start next block` (same templates, built-in path).
- Skip: no new block. Today shows no week text. Up next is unchanged.

---

## 8. Ben's answers (21 Oct 2026)

All as recommended, with one change:
1. Weekly targets are what he's compared against; today's weights still come from what he actually lifted. **Yes.**
2. Block length 6 weeks (5 build + deload). **Yes.**
3. Deload: loads −10 %, one set fewer per exercise, about RPE 7. **Yes.**
4. Accepting an early deload ends the block after that week. **Yes.**
5. A week with no lifting (not paused) doesn't count; the block waits; nothing marked missed. **Yes.**
6. Block week in Today's header (`Tuesday · Week 3 of 6`). **Yes.**
7. **Changed:** `How did it feel?` stays after every workout (one tap on Summary, already built in Wave 3) and feeds both the weekly and the block review; the block review shows the block's Easy/Good/Hard counts.
8. `about mid-Nov at this rate` kept (≥ 4 rising weeks, within 6 months, labelled est.). **Yes** (already decided in Progress v3).
9. A next block never starts by itself; skipping the review carries the plan on without a block. **Yes.**
10. At most 2 accessory swaps per plan day per block; the main lift changes only if he asks or it stalls for 2 blocks. **Yes.**
11. Block IDs on sessions only; templates carry over. **Yes.**

Status: **Approved by Ben, 21 Oct 2026.** Build after Build B. Progress Overview shows `Block 1 · week 3 of 6` in the This week header once a block is running.

## 8a. Original questions (for reference)


1. Weekly targets are the plan to compare against (planned vs done). Today's weights still come from what he actually lifted, not the planned number. **Yes** / prescribe the planned number. *Recommended: yes* (keeps H4 and the approved load order).
2. Default block length: **6 weeks (5 build + deload)** / 8 weeks. *Recommended: 6.*
3. Deload week = loads −10 %, one set fewer per exercise, effort around RPE 7. **Yes** / no. *Recommended: yes.*
4. If he accepts an early deload, the block ends after that week (vs pushing the remaining build weeks later). **Yes** / no. *Recommended: yes.*
5. A week with no lifting (and not paused) doesn't count, and the block waits, with nothing marked missed. **Yes** / count calendar weeks. *Recommended: yes.*
6. Block week text sits in Today's header (`Tuesday · Week 3 of 6`) / on the week strip's Monday divider. *Recommended: header.*
7. `How did it feel?` is asked only at block end, not weekly. **Yes** / no. *Recommended: yes.*
8. Keep the `110 about mid-Dec at this rate` line, shown only with ≥ 4 weeks of data and a rising trend (and update the lift-targets "never predicts" note). **Yes** / no. *Recommended: yes.*
9. A next block never starts by itself. If he skips the review, the plan carries on without a block. **Yes** / auto-start the same block again. *Recommended: yes.*
10. At most 2 accessory swaps per plan day per block. The main lift is never proposed for change unless he asks or it has stalled for 2 blocks. **Yes** / no. *Recommended: yes.*
11. Block IDs go on sessions only, not on the plan-day templates (templates carry over between blocks). **Yes** / no. *Recommended: yes.*
