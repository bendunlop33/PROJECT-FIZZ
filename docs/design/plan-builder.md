# Plan builder (goal-led)

Status: **Draft for Ben, 22 Oct 2026.** Prototype: [prototypes/plan-builder.html](prototypes/plan-builder.html) (example data only). Builds on [workout-builder-v3.md](workout-builder-v3.md) (chain Goal → Plan → Workout, §4 data), approved [training-blocks.md](training-blocks.md), [goal-adaptive.md](../training-guides/goal-adaptive.md) (GA1–GA19), [volume-by-frequency.md](../training-guides/volume-by-frequency.md), research [plans-and-plan-progress.md](../research/plans-and-plan-progress.md), and the pending [history-targets.md](../training-guides/history-targets.md).

> Ben: "Is there an option atm to build a plan and interact with the building of it?" · "the plan should be built around goals etc" · "where's the plan builder?" (22 Oct)

## 1. What it is (for Ben)

One screen flow that turns your goals and week into a plan you can adjust before applying. It's the same screen for a new plan and for editing the one you have.

1. **Goals**: main focus (Strength / Muscle / Both / Fitness / Maintain), lift targets with optional dates (Bench 110 by 15 Dec), priority muscles, runs on/off.
2. **Week**: which days you lift, which days you run (and the long run), session length, gym.
3. **Your plan**: proposed split, each day's focus and main lift, sets per muscle per week against target bands, and the 6-week block with a deload. Each day opens to its exercises with weights from your history (and opens in the workout builder).
4. **Adjust**: tap (change a day's focus, move a day) or tell the coach ("make it 3 days", "no legs before my long run", "more chest"). The words decide: a full description rebuilds the plan, a change request edits only that part, unclear asks **Build new / Change this one**. Every change has Undo.
5. **Apply** (Undo). Today, Library › Your plan and Progress then follow it.

**Offline:** the app builds the same plan from its rules, marked **Not reviewed**; tap edits still work, the coach box is disabled.

## 2. How the plan is made (code, deterministic; the coach may adjust within these rules)

- **Split from days and focus** (GA2–GA4, GA9): 2 days → full body ×2; 3 → push/pull/legs (Strength: full body ×3); 4 → push/pull/legs/upper (Strength: upper/lower ×2); 5 → PPL + upper + lower; 6 → PPL ×2. [Proposal]
- **Main lift first** on each day; heavy lifts never superset (workout-builder-v3 §3.4–3.5).
- **Sets per muscle per week** balanced into the target band: priority muscles 12–20, others 8–14, small muscles 4–10 (V4, GA3) by adding or removing a set on that muscle's accessories (2–5 sets each). Bands shown as a shaded range; ↑/↓ only when outside. [Proposal]
- **Length** caps exercises per day (≤ 45 min: 4, ≤ 60: 6, longer: 7); time budget per playbook D17.
- **Runs** (GA11, GA15): no legs the day before the long run; swapped with the furthest non-leg day.
- **Weights** from history per exercise (history-targets HT rules once approved; until then the Build C load order). Why? per exercise: "Last time 90 × 12".
- **Block**: 6 weeks, deload week 6 (training-blocks §2); lift-target dates fit the block length there.
- **Coach**: may reorder, swap accessories or adjust sets with a one-line reason; code checks every number (rule 3/4). Structural changes it suggests on its own are offers, never applied.

## 3. Entry points

- Today (no plan): `Set up a plan ›` opens this (fixes the current dead end into an empty Your plan).
- Library › Your plan: empty state `Build a plan`; with a plan, `Edit plan` opens it at step 3.
- Profile › Goal: changing the goal offers `Update plan?` → step 3 with the new goal.
- Coach chat: "build me a plan" opens this screen pre-filled instead of a card in chat.

## 4. Data (developer)

Writes the existing plan model (coach plan draft → applied, plan days as routines with `planDay`, templates per main lift, variations) via the same apply path as `propose_plan` (packages/coach/src/plan.ts), so Undo, versioning and stale-proposal rejection (rule 5) are unchanged. Goal fields go to Profile through the GA17 two-step (goal proposal, plan proposal) when they changed. A draft persists across app restarts until Applied or discarded.

## 5. Open questions for Ben

1. **Today with a plan (Ben, 22 Oct):** "if we have a defined plan, the plan tweaker on Today is just editing what we already planned, so it shouldn't be the default." Proposal: with a plan, Today shows the planned workout ready to **Start**; changing it is behind **Edit** (one-off for today) or **Edit plan** (here). The Set up screen only appears for a workout outside the plan (no plan, or "＋ New workout"). Agree?
2. Split defaults per days/focus (§2), OK?
3. Sets bands (priority 12–20, others 8–14, small 4–10), OK?
4. Should the plan carry fixed weekdays (Mon/Tue/Thu/Sat) or a rotation (A, B, C, D in order whenever you train)? Current app: rotation (D19). Runs need weekdays.
5. Coach-in-chat "build me a plan": open this screen (proposed) or keep the chat card?
