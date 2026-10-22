# Plan builder (goal-led)

Status: **Draft for Ben, 22 Oct 2026.** Prototype: [prototypes/plan-builder.html](prototypes/plan-builder.html) (example data only). Builds on [workout-builder-v3.md](workout-builder-v3.md) (chain Goal → Plan → Workout, §4 data), approved [training-blocks.md](training-blocks.md), [goal-adaptive.md](../training-guides/goal-adaptive.md) (GA1–GA19), [volume-by-frequency.md](../training-guides/volume-by-frequency.md), research [plans-and-plan-progress.md](../research/plans-and-plan-progress.md), and the pending [history-targets.md](../training-guides/history-targets.md).

> Ben: "Is there an option atm to build a plan and interact with the building of it?" · "the plan should be built around goals etc" · "where's the plan builder?" (22 Oct)

## 1. What it is (for Ben)

One screen flow that turns your goals and week into a plan you can adjust before applying. It's the same screen for a new plan and for editing the one you have.

1. **Gym goals** (title renamed, Ben 22 Oct): main focus (Strength / Muscle / Balanced / Fitness / Maintain, each defined behind an ⓘ), lift targets with optional dates (Bench 110 by 15 Dec), priority muscles, runs on/off.
2. **Length and effort** (Ben, 22 Oct): plan length (4 / 6 / 8 / 12 weeks, or to a target date) and how hard to push:
   - **Steady**: RPE 6–8, lower set bands, add load only when reps top out; deload only if needed. For busy spells or heavy run weeks.
   - **Standard**: RPE 7–9, middle bands, one step when you hit the plan; deload in the last week.
   - **Push**: RPE 8–9.5, higher bands (+1 back-off on main lifts), a step every session you hit it; deload every 4th week. Needs sleep, food and fewer hard runs.
   Each shows the main target lift's estimated top set at the end (`Bench est. 105`, labelled est., rule 6) and which level reaches a dated target, or says it isn't reachable in that length.
3. **Week** (Ben, 22 Oct): sessions a week, then **Set days** (pick them) or **Fit them in** (next session in order whenever you train; no legs the day before a long run). Runs and long run, session length, gym.
4. **Your plan**: proposed split, each day's focus and main lift, sets per muscle per week against target bands, and the 6-week block with a deload. Each day opens to its exercises with weights from your history (and opens in the workout builder).
5. **Adjust**: tap (change a day's focus, move a day) or tell the coach ("make it 3 days", "no legs before my long run", "more chest"). The words decide: a full description rebuilds the plan, a change request edits only that part, unclear asks **Build new / Change this one**. Every change has Undo.
6. **Apply** (Undo). Today, Library › Your plan and Progress then follow it.

**Offline:** the app builds the same plan from its rules, marked **Not reviewed**; tap edits still work, the coach box is disabled.

**Layout update (Ben, 22 Oct):** Plan length and Effort moved onto Gym goals as two compact rows (4 / 6 / 8 / 12 weeks; Steady / Standard / Push), with a collapsed `What to expect in N weeks` panel for the chosen pair (what the level means, RPE, sets, deload, and each main lift now → week N est.). The separate length-and-effort step is gone: Check your lifts (if needed) → Gym goals → Your week → Your plan. Option boxes are 36 pt, same corners and text size.

**Focus vs effort (Ben, 22 Oct):** Main focus is what you build (Strength / Muscle / Balanced / Fitness); Effort is how hard (Maintain / Standard / Push). Maintain moved from focus to effort; Steady dropped (★ sports already give the lighter dose). Maintain: fewer sets (others 4–8, priority 8–12), same weights, reps only if easy, no deload, no projected gain.

## 1a. Priority and lift check (Ben, 22 Oct)

- **Priority, up to 2 groups** (Chest, Back, Shoulders, Legs, Arms, Core); none picked = Balanced. A priority does three things: top of its set range, trained at least twice a week, and its exercises come straight after the main lift. When time is short, non-priority work is cut first; nothing drops below maintenance. Sub-muscles ("more upper chest") only through the coach.
- **Coach suggestion line**, only when logs show a real gap: `✦ Back: 8 sets a week vs Chest 15 · Use`. Code computes the facts (last 8 weeks: sets/week vs range and vs comparable groups, sessions/week, stalled main lift < 1% over 4+ weeks with 3+ exposures, push:pull > 1.5 : 1); a group needs one strong or two medium signals; at most 2; pain-flagged muscles never. Relative strength between lifts never counts on its own. Offline, code makes the same pick.
- **Check your lifts** (step 2, shown only when needed): main lifts with no history or nothing in 8 weeks. Stale: `Still right` / `Edit`. None: an estimate from his **closest similar lift first** (Ben, 22 Oct), e.g. OHP from DB shoulder press (both dumbbells × 1.2), then machine shoulder press, then another main lift (OHP ≈ 0.6 × bench); `Use`, `Other lift` (pick the source) or `Enter` one recent set (saved as Your data, "you entered"). Estimates are labelled est., planned a step lighter, and replaced by the first logged session. Read-across factors are practice-level rules of thumb, listed per lift in code with tests. Recent lifts show with ✓ and need nothing.
- **Strength balance** (Ben, 22 Oct), under Check your lifts: each main lift's est. 1RM ÷ bench est. 1RM on a bar against a rough usual band (squat 1.2–1.5×, barbell row 0.7–1.0×, DB shoulder press 0.22–0.30× per hand; crowd-sourced strength standards and coaching rules of thumb), with Below / In range / Above (Below in amber) and an ⓘ that says it's a rule of thumb, not a target. It also feeds the priority pick as a supporting signal only (with low sets, low frequency or a stalled lift), never on its own. Later: his own ratio trend over time on Progress › Lifts.
- **Other training** (Ben, 22 Oct): chips for Running, Cycling, Swimming, Boxing, Football, HIIT, Climbing, Yoga and `＋ Other`; each chosen one gets a day picker on the Week step (running also a long run) and shows on the plan's week strip. Leg-heavy ones (long run, cycling, football, HIIT) keep heavy legs off the day before (GA11). The app schedules lifting around them; it doesn't plan them.
- **Check your lifts extras** (Ben, 22 Oct): full lift names; `＋ Add a lift` for Deadlift, Front squat, Romanian deadlift, Overhead press, Incline bench press (entered or from history). Strength balance shows every lift, bench included (its usual range is the average of what the other lifts would usually go with), with Below / In range / Above only; ratios and usual ranges (deadlift 1.5–1.9×, front squat 0.95–1.2×, RDL 1.0–1.3×, OHP 0.6–0.7×, incline 0.8–0.9×) live behind the ⓘ.
- **Priority sports** (Ben, 22 Oct): tap a chosen sport again for ★; any number can be starred. With one or more ★, lifting supports them (GA6/GA11): Steady-level set bands, all their days protected from heavy legs the day before, and the coach flags more than 3 lifting days ("2–3 is usual"). Main focus still decides what the lifting builds. Later: sport-specific exercise choice, Easy/Hard per day, and an optional event with build → specific → taper phases (GA8), each a proposal.
- **No training history** (Ben approved, 22 Oct): nothing pre-selected. Only if a confirmed lift is clearly out of line (more than ~15% below its usual range next to bench) an un-ticked line offers it (`✦ Back squat is low next to your bench (est.). Make Legs a priority? Add`). The one exception to "balance never counts alone". After ~4 weeks of logs the weekly review checks the full signals and may offer a priority.

## 2. How the plan is made (code, deterministic; the coach may adjust within these rules)

- **Split from days and focus** (GA2–GA4, GA9): 2 days → full body ×2; 3 → push/pull/legs (Strength: full body ×3); 4 → push/pull/legs/upper (Strength: upper/lower ×2); 5 → PPL + upper + lower; 6 → PPL ×2. [Proposal]
- **Main lift first** on each day; heavy lifts never superset (workout-builder-v3 §3.4–3.5).
- **Priority** is picked by group: Chest, Back, Shoulders, Legs (quads, hamstrings, calves), Arms (biceps, triceps), Core (Ben, 22 Oct). Sets are still counted per muscle.
- **Sets per muscle per week** balanced into the effort level's band (Standard: priority 12–20, others 8–14, small 4–10; Steady and Push shift down/up, §1) (V4, GA3) by adding or removing a set on that muscle's accessories (2–5 sets each). Bands shown as a shaded range; ↑/↓ only when outside. [Proposal]
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
4. ~~Fixed weekdays or rotation?~~ Answered (22 Oct): Ben chooses per plan, Set days or Fit them in.
6. Effort level names and numbers (Steady / Standard / Push, §1), and the estimated weekly gain behind `Bench est.` (Steady +0.6, Standard +1.25, Push +2 kg a week on the top set, an assumption to be replaced by his own trend once history-targets is built)?
7. Also ask in the flow? Proposed extras, all optional and prefilled from Profile/history: experience (sets starting volume), exercises to always include or avoid, variety (keep the same accessories vs rotate each block), supersets on/off, abs/cardio finishers, injuries (existing pain flags shown, not re-asked), start date.
5. Coach-in-chat "build me a plan": open this screen (proposed) or keep the chat card?
