# Training guides

This folder holds two things:
- **[playbook-v1.md](playbook-v1.md):** the **approved coaching playbook**. Ben approved it on 9 Oct 2026, with his amendments to rules 1 and 7 and the HYROX rule removed. The coach applies these rules every time.
- **Library:** everything else here. These are evidence-graded passages the coach looks up when they're relevant, plus *candidate* rules. A candidate isn't in the playbook until Ben approves it.

This is not medical advice. Pain or injury: stop progressing that movement and see a professional (CLAUDE.md rule 9).

Evidence grades: **Strong** = consistent meta-analyses. **Moderate** = several trials. **Weak** = single studies or mechanistic reasoning. **Practice** = coaching convention without direct evidence.

## Index

| File | Topic | Last checked |
|---|---|---|
| [playbook-v1.md](playbook-v1.md) | **Approved playbook v1**: rules 1–13 (1 and 7 revised; 14 removed), G (goal and setup), T (planned-vs-logged trigger), 7-F (built-in rule). Also covers the inputs the coach uses, rules by goal, guardrails, and open decisions D1–D22. Review fixes added 9 Oct | 2026-10-09 |
| [evidence-core.md](evidence-core.md) | Volume, load and rep ranges, proximity to failure and RPE reliability, progression methods, mid-session load drops, rest, deloads, frequency. *Citation fixes pending; see conflict 6* | 2026-10-08 |
| [concurrent-training.md](concurrent-training.md) | Strength + endurance interference, session order and spacing, protecting long runs and rides. HYROX is a library example only since 2026-10-09; its "Inference for Ben" is marked superseded | 2026-10-08 |
| [programmes.md](programmes.md) | 5/3/1 (+BBB, hybrid), RP, Juggernaut, GZCL, Starting Strength, StrongLifts, PPL, upper/lower, HYROX programmes (library examples) | 2026-10-08 |
| [volume-by-frequency.md](volume-by-frequency.md) | Rule 1 rewrite: weekly sets per muscle from stated days a week and session length, per-session cap, goal ranges, adding volume, short and long weeks (V1–V8, worked examples for 1–6 days; fact-checked) | 2026-10-09 |
| [equipment-aware-progression.md](equipment-aware-progression.md) | Rule 7 rewrite: % steps, reps check for steps > 5%, coarse dumbbell/stack/plate steps, microloading, goal-based lever choice, no-AI fallback (EQ1–EQ10; fact-checked). Replaces evidence-core E8 | 2026-10-09 |
| [goal-adaptive.md](goal-adaptive.md) | Rule G source: goal profiles (Strength, Muscle, General fitness, Maintain, Endurance), "also matters" floors, named events and tapers, how training is run, the endurance switch for rules 11–13, confirming goal changes (GA1–GA19; fact-checked). Library since v1: where it differs from the playbook, the playbook wins | 2026-10-09 |
| [return-to-load.md](return-to-load.md) | **Candidates R1–R6, awaiting Ben:** comeback after a break (14-day trigger, today-only lighter start −10/−20/−40%, ramp over ~half the gap) and returning towards pre-flag sets after a pain flag is cleared (one step per session, ≤ ~10%, proposal only; pain stops it). Unblocks active-workout §2.14.3 once approved. Flags: new session-start offer; built-in ramp step vs 7-F (ADR 0006 note) | 2026-10-11 |
| [warm-up.md](warm-up.md) | **Candidates WU1–WU12, awaiting Ben (fact-checked and revised 21 Oct):** code-generated warm-up sets from the first working load and reps; goal acts only through those (heavy band ≤ 6 reps: 3–5 step ladder; rep band: 50% × 8 then 80% × 4 or 5; already-warm muscle: 0–1 step), snapped to the gym's equipment, all within D17's 10-min session allowance with an ordered cut list; 1-rep steps only before sets of ≤ 3; general warm-up optional; stretching ≤ 30 s per muscle; no injury-prevention claims; warm-ups never count or trigger offers. Trigger: a 1-rep warm-up before rows 90 kg × 12 (now 45 × 8, 70 × 5). Flags: coach-output fallback, D17 time, rule T after hard runs, FitNotes warm-ups counted as hard sets (D18) | 2026-10-21 |
| [history-targets.md](history-targets.md) | **Candidates HT1–HT19, awaiting Ben (revised after review 21 Oct):** how history becomes targets. The reference is the most recent *comparable* exposure per set role and *planned* rep zone (plus day tag; not deload), with fallbacks (other role same zone, never a past top set for back-offs → e1RM translation at 1 RPE easier → no load → start light); gap per R1 (any exposure, usual-spacing exception), hold + R2 offer, no silent cut; top set + one step when the plan was hit; back-offs from back-offs or today's top, scaled down with it; fixed rep range per slot with double progression and personal cap; planned set count; one missing-RPE rule; pain hold ≤ the most recent exposure (R4 to go back); load conventions (stack, added, assistance, bodyweight, max); timed/distance/per-side sets; coach bounds per rule 3 (Ben asks → applies; coach-initiated small = one step on main lifts, ±10% elsewhere); per-set basis for `Why?`. Seven worked examples. Architecture in [ADR 0031](../decisions/0031-exercise-performance-profile.md). Flags: D7/rule 7 wording change, builder 6–8 main reps vs rule 2, silent gap cut, rep-range drift, 20% coach ceiling replaced, approval order | 2026-10-21 |

## Shortlist (14 rules): Ben's decisions, 9 Oct 2026

Ben's reply, verbatim:

> "Ok.
> 1 - it should be guided by how often people say they gym per week too, rather than starting from a random number
> 7 - i think this should be driven by a combination of AI and what the gym can offer, as a default rule won't always work best
> stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run"

The approved text, its guardrails and the open parameters are in **[playbook-v1.md](playbook-v1.md)**. The table below is the record of each rule's status.

| # | Rule | Applies when | Grade | From | Status |
|---|---|---|---|---|---|
| 1 | **Weekly sets per muscle come from Ben's stated days a week and session length.**<br>• **Start:** sessions that train the muscle × the sets that fit each session. That's ≈ (minutes − 10) ÷ 3 for a mixed session, or ~4 min per heavy main-lift set, shared across that session's muscles, max 8 direct sets per muscle per session. More days never start lower. With ≥ 4 logged weeks in the last 8, start from his own sets per lifting day × his stated days instead. Days, length or experience not set: the coach asks when he asks it to plan, and any assumed value is labelled (playbook "Missing inputs").<br>• **Goal range:** muscle 10–20 for priority groups (6–10 for the others), general 4–10, strength 3–6 hard sets per main lift, maintain ≥ ⅓ of recent.<br>• **Growth:** +1–2 sets per group, at most every 1–2 weeks. Only when Ben asks (offers are D1), and only while performance holds, time allows and no pain flag is active. Otherwise progress load or reps.<br>• **Short week:** keep loads, cut sets, no make-up.<br>• **Counting:** working sets at RPE ≥ 6; synergists count ½. | Any plan or weekly-volume advice | Strong (more weekly sets → more growth; frequency mainly spreads volume) / Moderate (strength needs few sets; maintenance dose) / Weak (exact per-session cap; adding sets for growth; starting from habit) / Practice (time maths, caps, step size) | V1–V8 | **Revised and approved** |
| 2 | Strength: main lifts mostly ≥ ~80% 1RM (≈ 1–6 reps at RPE 7–9), 2–3+ sets, each lift ≥ 2×/week. | Strength focus | Strong (heavy loads) / Moderate (frequency, sets) | E3, GA2 | **Approved** |
| 3 | Default working sets to RPE 7–9 on compounds. RPE 10 is for planned last sets, AMRAPs or isolation work. | Setting targets | Moderate | E4 | **Approved** |
| 4 | Treat one RPE as ± 1 rep. Change *future* targets only on a pattern (≥ 2 sessions), never on one rating. Distrust ratings on sets > 12 reps. | Interpreting logs | Moderate | E5, E13 | **Approved** |
| 5 | Unplanned RPE ≥ 9.5 (planned ≤ 8.5) or reps short by ≥ 2 → the coach **offers**, for the remaining sets of that exercise: −5–10% load (≈ 2–4% per RPE point over target, rounded down to achievable), or the same load with fewer reps. | Mid-session (rule T) | Weak + Practice | E6 | **Approved** |
| 6 | Unplanned RPE ≤ 6 (planned ≥ 8) on a working set → the coach **offers** the next achievable load up (+2–5%) or +1–2 reps. | Mid-session (rule T) | Practice | E7 | **Approved** |
| 7 | **Progression follows Ben's goal and what this gym can actually load.**<br>• When Ben asks, or a clear signal warrants it, the AI coach chooses load, reps, sets or a variant.<br>• It works from his goal and setup; the last ≥ 2 sessions on the same equipment and routine slot; the equipment step card from code (next achievable loads with % change, min/max, microplates and add-ons); pain flags; and today's request.<br>• Changes are shown in kg/lb and %. Steps over ~10% aren't applied by default: the coach offers one goal-appropriate option instead. An explicit request from Ben for an achievable load is honoured.<br>• **Built-in rule (7-F):** labelled, equipment-aware double progression. It applies the smallest achievable increment. If that jump is > ~10% or the machine is at max, it progresses reps up to the cap, then holds. It doesn't add sets (D2). | Ben asks; a rule T signal; the post-workout review; planning. 7-F: coach unavailable, or no coach target applied (D21) | Strong (≥ 80% 1RM for strength) / Moderate (reps ≈ load for muscle; rep–load relationship) / Weak (% steps; reps check; microloading) / Practice (step card, lever mapping). 7-F: Weak + Practice | EQ1–EQ10 (replaces E8) | **Revised and approved** |
| 8 | A stall (2–3 sessions failing the same target) → propose a 5–10% reset or a rep-scheme change. One bad session → note only. | Next-session targets | Practice | E13 | **Approved** |
| 9 | Rest 2–3 min (up to 5) on heavy compounds; 1–2 min on isolation work. | Rest presets, shortening sessions | Moderate | E10 | **Approved** |
| 10 | Deload when performance drops across ≥ 2 sessions (≈ halve sets, RPE ≤ 7, ~1 week), or every 4–8 weeks if Ben prefers. Always a proposal. | Future plan | Weak + Practice | E11 | **Approved** |
| 11 | Same day, strength priority: lift first, keep the endurance part easy. Key endurance session that day: do it first and cut leg volume. | Daily plan, only when the endurance switch is on. Lift-first only when lifting is the priority | Moderate | C1 | **Approved** |
| 12 | Keep heavy lower-body lifting and hard or long endurance ≥ 6 h apart (ideally ≥ 24 h). Keep heavy or high-volume leg work out of the 48 h before a key long run, ride or race. Show the trade-off as a proposal; never overwrite the run. | Weekly scheduling, only when the endurance switch is on | Moderate | C2, C3 | **Approved** |
| 13 | Keep ≥ 2 heavy strength exposures per week through endurance phases (fewer sets, same heavy loads). | When the endurance switch is on (a hard, long or key session in the plan or logged) **and** endurance is one of Ben's goals. This was "Endurance/HYROX blocks" | Moderate | C5 | **Approved** ("applies when" reworded per Ben's HYROX direction) |
| 14 | ~~HYROX-specific rule~~ | — | — | C7 | **Removed** |

**Added with v1** (full text in [playbook-v1.md](playbook-v1.md)):
- **G:** targets follow the goal and how training is run. This comes from Ben's HYROX instruction and is built on GA1–GA19.
- **T:** mid-session triggers compare logged effort with planned effort (conflict 1).
- **7-F:** the equipment-aware built-in rule, as worded in the ADR 0006 amendment. It sets next-session targets when the coach is unavailable, and today also when no coach target has been applied. Whether the coach's target should apply instead is D21, for Ben.

**Candidates awaiting Ben (not in force):** R1–R6 in [return-to-load.md](return-to-load.md); WU1–WU12 in [warm-up.md](warm-up.md); HT1–HT19 in [history-targets.md](history-targets.md).

**Endurance switch (one definition, used everywhere):** on when a hard, long or key endurance-type session (run, ride, swim, row, class or HIIT, match or sport) is in the plan (planned or usual) or logged (imported or reported). Easy sessions never turn it on. Details in the playbook under "How training is run".

## HYROX: no special case

Ben (9 Oct 2026): "stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run".
- The **"HYROX or strength?" question is dropped.** The coach works from Ben's current goal and how his training is run (rule G).
- HYROX stays **in the library only**, as one example of a named event:
  - [concurrent-training.md](concurrent-training.md) C7 and §5 (race format, Brandt 2025);
  - [programmes.md](programmes.md) (paid HYROX programmes).
- C7 is not a playbook rule. These passages are used only if Ben names a HYROX race as an event, and they're labelled as library material.
- The closing line of concurrent-training.md §5 ("The coach should ask which is primary") is superseded by rule G's event questions: what it is, when, what it demands, and whether it's the priority.

## Conflicts and decisions: status

1. **Trigger compares against planned RPE** (skip warm-ups and planned AMRAP/"+" sets; no "too easy" above 12 reps).
   - **Approved:** the ADR 0006 amendment and rule T. The PM read Ben's "Ok." as covering this.
   - *PM:* `docs/decisions/provisional-2026-10-09.md` item 4 still lists it as Ben's to decide, so that file needs reconciling. Ben's only reply was "Ok.", so confirm with him first.
2. **No guardrail overrides.** Holds for v1. Every load passes achievable-load snapping (rounding **down** after an overshoot), equipment min/max, the pain block, completed-set immutability and version checks.
3. **Data honesty.** Holds, and is built into rule G's endurance switch. Fatigue rules use only planned, imported or Ben-reported sessions. No inferred recovery scores. Strength and endurance load stay separate metrics (brief §3).
4. **Sled work (any programme).** Plate-loaded sled resistance isn't comparable across surfaces, so it's logged as plates loaded, not as an equivalent load (brief §4). *Open: flag for the designer.*
5. **Volume offers vs "no unprompted adjustments".** *Open: D1 and D2.* Until Ben decides, sets grow only when he asks. The built-in rule never adds a set: at the rep cap it holds.
6. **Citation fixes needed in evidence-core.md.** *Pending; library only, the playbook already cites the correct sources.*
   - **Link label (E1, E2, E12):** the link `sportrxiv.org/.../preprint/view/537` is labelled "Pelland et al.", but it is **Remmert et al. 2025**, the per-session preprint. Only the label is wrong: that preprint does quote the ~31 / ~3 weekly figures, attributing them to Pelland. Those figures aren't in Pelland's open preprint, so they remain unverified. The weekly paper is Pelland et al., *Sports Medicine* 2026;56(2):481–505, doi 10.1007/s40279-025-02344-w (preprint SRXIV.460).
   - **Wrong URL (E2 and Details §1):** "Schoenfeld et al. 2017" links PMC6303131, which is Schoenfeld 2019 *MSSE*. The 2017 meta-analysis is doi 10.1080/02640414.2016.1210197; its < 5 / 5–9 / 10+ comparison was a non-significant trend (p = 0.074).
   - **E12:** better stated as ≈ 8 direct (≈ 11 fractional) sets per session, as a planning cap rather than a proven ceiling.
7. **Rule 13: 1 heavy session a week in an endurance competition period.** *Open: D8.* The evidence is Weak.
8. **Rule 3: RPE 6–8 for General fitness and new lifters.** *Open: D9.* This is Practice only.
9. **Goal inputs.**
   - *D13: designed, pending Ben's bulk approval.* General fitness and Support other training as main-focus options, an "Other training" field (type, effort, usual and key days) and an event field are in the onboarding and Profile specs and listed in [open-decisions.md](../design/open-decisions.md) §B.
   - *Open: D14.* The coach schedules lifting around endurance but doesn't write endurance plans.
   - *Built into rule G:* an event's phase targets apply only through proposals Ben applies.
10. **goal-adaptive.md decisions 7–10.**
    - 7 → D10 ("too easy" during a taper or under Maintain).
    - 8 → D11 (goal-change questions the coach raises).
    - 9 → D12 (new-lifter cut-off).
    - 10 → **resolved**: rule 13's "applies when" is reworded, per Ben's HYROX direction.
11. **equipment-aware-progression.md open questions.** These are D2–D7: fallback step size and sets, the 10% cap vs an earned bigger jump, the "Big jump" note, a bodyweight entry, microplates, and heavy/light-day history. *Developer finding:* the built-in rule has `maxLoadJump: null`, so it can currently propose +20–25% jumps, which conflicts with 7-F. Details are in the playbook's PM notes.
12. **return-to-load.md (R1–R6), open for Ben.** R2 adds a coach-raised offer at session start (a gap ≥ 14 days as the "clear signal" under CLAUDE.md rule 3). R6's built-in ramp step (up to ~10%) is larger than 7-F's smallest increment, so it needs an ADR 0006 note and code, or Ben picks the slower 7-F step. R4 lifts the block in active-workout §2.14.3 but keeps every pain-return step as a proposal.
13. **warm-up.md (WU1–WU12), open for Ben.** Warm-ups become code-generated (works with no AI); the coach changes them only when Ben asks. Open points: whether code replaces a coach warm-up that fails the minimum (e.g. the 1-rep row) or only warns; D17's approved 10 min fits a two-heavy-lift session only after WU11's cuts, so Ben may want more; whether rule T should discount lower-body rep shortfalls within ~8 h of a hard run (would change an approved rule); FitNotes imports carry no warm-up flag, so under D18 imported warm-ups count as hard sets (proposed: an import-preview "likely warm-up?" flag, no automatic change); gym-profile fields for full-diameter plates and sled weight; the catalogue must carry category, movement pattern, primary muscle and an easier variation. Enes 2025 (1 vs 2 warm-up sets at 10RM) is still unread.
14. **history-targets.md (HT1–HT19), open for Ben.** Makes approved rule 7's "same routine slot" and D7 concrete, but **changes their wording** (role + planned zone + day tag; newest comparable exposure as the start point), so Ben must approve that explicitly. Open points: zone window; first-exposure cushion; −40% after 84+ days as default or offer; fixed rep ranges vs drift toward the goal; coach "small" band replacing the 20% ceiling; D18 "approx." vs `est.`; timed/distance defaults. Depends on pending R1–R5, WU1–WU12 and B6 (approval order in the file). **Guardrail bugs, not candidates (PM):** the builder's coach target skips D21's pain and stale checks; with a pain flag and no history the builder still plans loads (rule 9). Architecture: [ADR 0031](../decisions/0031-exercise-performance-profile.md), proposed.

## Paid material Ben may want to add to the library

- *5/3/1 Forever* (Wendler)
- *Juggernaut Method 2.0* (C. W. Smith)
- RP books and app
- *The Hybrid Athlete* (A. Viada)
- *Starting Strength* (Rippetoe)
- *Muscle & Strength Pyramid: Training* (Helms) (warm-up chapter)
- ACSM 2026 position stand full text (MSSE; paywalled when checked)
- Pelland et al. *Sports Medicine* journal version (the preprint is free)
- Rønnestad & Mujika 2014 (*Scand J Med Sci Sports*) journal version
- NSCA *Essentials* textbook
- MASS Research Review (Stronger By Science subscription; Sept 2022 "Detraining" issue)
- Bosquet et al. 2013 and Ardern et al. 2016 full texts (journal access)
- Enes et al. 2025 (*Sports Med Health Sci*) full text, and Viveiros et al. 2024 (journal unconfirmed)
- Reactive Training Systems manuals (Tuchscherer), for top-set and back-off conventions

Only summaries are held here.
