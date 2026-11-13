# History to targets: picking the right "last time" for each set

**Summary (plain words, for Ben)**
1. Each set's target starts from **the last comparable time**, like a coach: same exercise and kit, same role (top set, back-offs, other lifts) and same *planned* session type (heavy 5s vs volume 12s). Last session is the start only when it matches.
2. No history in today's rep zone: the weight comes from an estimated max (`est.`), aimed 1 RPE easier the first time. A 12s weight is never copied into a 6s day.
3. Top sets step up one small step when you hit the plan. Back-offs come from your last back-offs (or from today's top). Other lifts keep your own rep range and use double progression.
4. A break, pain, a deload or a run of hard ratings can hold the start point. A break or pain never adds weight. While pain is flagged, nothing goes above what you last did.
5. The coach can change any number. Code checks it, and every target's `Why?` names the session it came from.

*Library file with **candidate** rules HT1–HT19 (Coaching knowledge, CLAUDE.md rule 10). Nothing here is in the playbook until Ben approves it. Not medical advice: pain or injury stops progression on that movement, and the coach suggests seeing a professional; it never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher on 2026-10-21 and revised the same day after a review (verdict CHANGES NEEDED, 21 findings; see "Review log" at the end). Sources were checked 2026-10-21 unless a different date is given. The architecture is proposed in [ADR 0031](../decisions/0031-exercise-performance-profile.md).*

**Trigger.** On 21 Oct 2026 Ben asked how the app will make sure history properly guides workout weights. His refinement, verbatim (relayed by the workflow): *"Well last session should be starting point subject to type of session, if it's main lift etc like a coach would do"*. Three read-only code audits of branch `claude/builder-loads-21oct` (21 Oct) found about seven separate history readers. Each matches equipment, windows, set types and e1RM differently. None records set role, session type, planned rep zone, planned RPE or deloads, so "the most recent comparable exposure" can't be computed today. See the ADR for the inventory.

**How much of this is new.** The core idea is already approved:
- Rule 7 has the coach use "the last ≥ 2 sessions of this exercise on the same equipment and routine slot, so heavy and light days aren't mixed".
- Ben approved D7 on 9 Oct as its proposed default: "heavy and light days of the same lift each progress from their own history … Recommended yes; needs a developer change" ([playbook-v1.md](playbook-v1.md)).

These rules make that idea checkable and add what rule 7 doesn't cover: other rep zones, other roles, gaps, pain, deloads, sets, load conventions and timed sets. **They also change approved wording** (D7 and rule 7 say "same routine slot" and "last ≥ 2 sessions"; HT1 uses role + planned zone + optional day tag and lets the newest comparable exposure set the start point, with rule 7's ≥ 2-session pattern still governing *bigger* coach changes). Ben needs to approve that change explicitly (open question 1).

## Candidate playbook rules

Terms:
- **Reference** = the logged sets a target is built from, chosen per (set role, zone).
- **Zone** = the *planned* rep range of a set.
- **Step** = the next achievable load on the selected gym's equipment (code's step card).
- **Built-in target** = what HT1–HT19 give with no coach (the "before" Ben sees).
- **e1RM** = estimated 1RM, always labelled `est.`.

Numbers marked *default* can be edited.

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| HT1 | **Reference = the most recent comparable exposure, per role and zone.** A logged exposure is *comparable* to today's set only if all match: (a) **exercise identity** after alias and import mapping; (b) **equipment class** (HT2); (c) **set role**: top, back-off, working, or `unknown` (legacy/imported, derived at read time); (d) **zone**: the exposure's *planned* target reps fall within today's planned range ± 2 *(default)*. Only legacy and imported sets, which have no plan, use achieved reps. Today's range always comes from the slot, plan, template or Ben, **never from history**; (e) not a deload session. When both today and the exposure carry a day tag (Heavy/Volume, set by Ben or a plan), the tags must match too. The newest comparable exposure wins over older or heavier ones, **including a missed session** (planned 5, got 2), so HT7's repeat and rule 8's reset can fire. Pain-held sessions are comparable (HT12). | Every path that sets a load, reps or sets for a pending or future set | Practice (RTS, 5/3/1, GZCL tiers); Moderate (strength is specific to load range and equipment) | Rule 7, D7, EQ1; [Schoenfeld 2017](https://pubmed.ncbi.nlm.nih.gov/28834797/); [Haugen 2023](https://doaj.org/article/a7282dba5e674176bde2a8239832d2f7); [programmes.md](programmes.md) |
| HT2 | **Equipment class.** Barbell: same bar kind and mass (EZ, trap, Smith each separate; ADR 0030). Dumbbells: any rack, per dumbbell. Kettlebells: any set, per bell. Cable/stack and plate-loaded machines: **the same machine only**. Bodyweight, weighted or assisted: same exercise, same convention. kg↔lb converted for comparison, original kept as provenance. **Imports** (FitNotes rows have no equipment ID): the class is the catalogue's default kit for that exercise. Free-weight imports are normal references. Machine and cable imports are **`est.` only**: they can seed the first target on a machine (no step, snapped down; HT18 for cross-zone), until one session on that machine is logged. | Matching history | Moderate (strength is modality-specific) + Practice | EQ7, EQ8, rule 7 guidance 6–7; [Haugen 2023](https://doaj.org/article/a7282dba5e674176bde2a8239832d2f7) |
| HT3 | **Fallbacks, in this order**, each named in `Why?`. (a) Same role and zone: use it (HT6–HT9). (b) Same zone, another role, e.g. working ↔ back-off, or an accessory's working sets for a secondary slot: use that load, no load added for fewer reps this first time. **Never** use a past *top set* as the reference for several working sets, and for back-offs HT8 comes first. (c) Same exercise and class, other zone: **translate via e1RM** (HT4; `total`/`per_hand` only, otherwise HT18). (d) Related exercise or another class: **no load** (start light / Ben enters). Only if Ben asks may the coach estimate one, labelled `est.`, rounded down, ≤ RPE 7. (e) Nothing: start light. | No HT1 reference | Practice; Moderate (specificity) | Rule 7 guidance 7; EQ8; workout-builder B6 (pending) |
| HT4 | **One e1RM, one translation.** e1RM = load × (1 + (reps + RIR) ÷ 30), RIR-adjusted Epley *(default)*, from the chosen reference's best qualifying set (1–12 reps; no warm-ups, drop sets or flagged sets). RIR = logged RIR, else 10 − logged RPE. **A set with no rating counts as RIR 0 only here**, which gives the lowest estimate, labelled `est.`. Target load = e1RM ÷ (1 + (target reps + target RIR) ÷ 30), snapped **down**. **The first exposure in a new zone aims 1 RPE easier** (not below RPE 7), for every role in that exposure. After that the zone has its own reference. Same formula on every path. Only for `total` and `per_hand` loads (HT18). | HT3 (c); HT8 with no back-off history; deloads; coach checks | Moderate (reps vs %1RM, averaged); Weak (for one person; worse the further apart the zones); Practice (the cushion) | [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212); [Helms 2016](https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full); [Marzagão 2026 (preprint)](https://arxiv.org/abs/2603.17495) |
| HT5 | **Gaps and old references.** **Gap** = R1's definition: days since *any* working set of this exercise on comparable equipment, any role or zone, with R1's usual-spacing exception (a lift done every 3 weeks isn't "returning" after 3 weeks). Choosing the reference (HT1) and measuring the gap are separate. **Not returning:** normal decisions, even when the role/zone reference is weeks old (a 3-weekly heavy day still steps). If that reference is > 84 days old *(default)* and a newer exposure in another zone exists, also translate the newer one (HT4) and use the lower load. **Returning (R1):** no step; hold the reference; R2's lighter start is *offered* for today; if applied, R3's ramp-back follows. No silent cut and no extra HT4 cushion on top (no double count). **Gap ≥ 84 days:** no "start light" cliff; the old level is used through R2's −40% (open question 4 on whether that is the default or an offer). | Building any target | Strong (losses grow with gap length); Moderate (strength largely kept ~3 weeks); Practice (cut-offs) | [return-to-load.md](return-to-load.md) R1–R3; Bosquet 2013; McMaster 2013 |
| HT6 | **Load at today's reps, same zone.** If today's planned reps differ from the reference's by 1–2: same or more reps → keep the load; fewer reps and qualified for a step (HT7/HT9) → same-effort translation (HT4, no cushion), snapped down; otherwise keep the load. | HT1 reference with slightly different planned reps | Moderate (≈ 2.2–3.2% load per rep) + Practice | Rule 7; EQ3; [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212) |
| HT7 | **Main-lift top set.** From the last comparable **top set**, judged against *its planned* target. **Qualified** = planned reps reached at ≤ planned RPE, or with no rating (reps decide, as in 7-F). Qualified → **+1 step** when ≤ 5% (typically 2–5% on main barbell lifts, rule 7 step 2); > 5% only with banked reps (rule 7 step 3); > 10% (coarse kettlebells, stacks) → rule 7 guidance 4's single option, default reps up to the cap. **Repeat:** within 1 rep of target; or one logged rating ≥ planned + 1 (a single rating can hold a step, never cause one); or missed by ≥ 2 reps. A second miss in a row → rule 8's reset proposal. Strength focus: the lever is load. Muscle: load or reps. | Slot role = main (one stored definition: plan, builder `main` flag or Ben's choice) | Practice (RTS, 5/3/1); Weak (% steps); Moderate (rep–load link) | Rules 7, 7-F, 8; EQ2, EQ3; E9; [programmes.md](programmes.md) |
| HT8 | **Back-offs.** Precedence: (1) last comparable **back-offs** → their own HT7-style decision (step if every back-off hit target at ≤ planned RPE or unrated; else repeat); (2) no back-off history → from **today's** top via HT4 at the back-off reps and RPE, with the first-exposure cushion, labelled `est.` (E9's 5–10% below top is a sanity check). Always ≤ today's top load. **When today's top is lowered** (Ben, coach, R2 offer, pain hold), back-offs drop by the same % and are snapped down. Raising the top never raises back-offs. | Main lift with back-offs | Weak / Practice (RTS) | E9; [Helms RPE-stop](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full); [RTS overview](https://elitefts.com/education/a-reactive-training-manual-overview) |
| HT9 | **Secondary compounds and accessories: double progression on a fixed range.** The slot's range is **fixed when the progression starts**: from the plan, from Ben, or once from his pattern P (median top reps over the last 3 comparable sessions) as P − 2 … P *(default)*, within 5–30. It is stored on the slot (Your data) and changes only when Ben, the plan or a goal change changes it (rule G; a proposal), **never recomputed from sessions after a step**. Reps climb to the top of the range; every working set at the top at ≤ planned RPE (or unrated) → +1 step. Steps > 5% need banked reps (rule 7 step 3), so reps may go past the range top up to the bottom + ⌈J/2⌉, within the **personal cap** = max(category cap, range top + 3) (Your data). After a step, aim reps by same-effort HT4, floored, never below the range bottom. Above 12 reps judge by reps, not RPE (rule 4). | Slot role ≠ main | Moderate (rep or load progression both work for size) + Practice | Rules 4, 7, 7-F; E8; [Plotkin 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/) |
| HT10 | **Set count.** = the **planned** count of the last comparable exposure, by role (top + back-offs). Sessions cut by fit-to-time, ended early or with skipped sets are **not** references for set count. Ben's or his saved workout's count wins (WL7). Fit-to-time can cut today. Sets never grow unless Ben asks (rule 1, D2). Defaults (main: 1 top + 3 back-offs; others 3) only with no history. | Building any slot | Practice; Moderate (few sets suffice for strength) | Rule 1, D2; ADR 0006 (WL7) |
| HT11 | **Target RPE and ratings.** Target RPE: Ben's, then coach's, then plan's, then the built-in rule's defaults in `default-rule.ts` (rule 3 allows RPE 10 on isolation work). **One rule for ratings:** a missing rating neither holds nor allows a step (decide on reps); it counts as RIR 0 only when estimating a max (HT4, `est.`). A single logged rating may hold a step but never causes a step or a cut. **Drift:** last 2 comparable exposures both ≥ planned + 1 at the same load → hold even if reps were hit. Both ≤ planned − 2 with reps hit → the step is allowed, and the coach may offer more (rule 7). | Building targets; reading logs | Moderate (RPE ≈ ±1 rep) + Practice | Rules 3, 4, 7-F, T; [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/); [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/) |
| HT12 | **Pain and deloads.** **Active pain flag** on the movement (the exercise *and* its catalogue same-movement IDs), or pain at check-in: load ≤ the **most recent** exposure's load (pain-held sessions included), reps ≤ its reps, sets ≤ its sets. No increase of any kind. No history → no load, no estimates, no plan loads. Back to pre-flag numbers **only** through R4 after the flag is cleared. **Deload** (planned deload week or an applied rule 10 proposal): about half the sets, RPE ≤ 7, each role from its own reference via HT4 (other conventions: HT18). Deload sessions are never references; afterwards, resume from the pre-deload reference with the decision it had. | Every target | Practice; Strong/Moderate for detraining facts | Rules 9, 10; R4, R5; [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/); [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/) |
| HT13 | **What counts as history.** Finished sessions, FitNotes imports included (D18), and builder top/back-off sets by role. **Excluded:** warm-ups (WU1), drop sets, flagged or excluded sets, deload sessions, other equipment classes. Legacy and imported sets get role `unknown` and pain-held/return status **at read time** (from `source = import` and flag timestamps); finished rows are never rewritten (rule 2). The heaviest lower-rep set in an otherwise single-load session is not assumed to be a top set. Aliases resolve to one identity before matching. | Reading history | Practice + guardrails (rules 2, 6, 8) | D18; WU1; [ADR 0016](../decisions/0016-fitnotes-import.md) |
| HT14 | **Coach numbers.** Code compares every coach number with the **built-in target** for that set (the "before"). **Ben asked** (rule 3): today's sets change immediately with the % shown and one-tap Undo (in the builder before Start, a proposal with Apply/Skip); EQ10's "Big jump +X%" note above 10%. **Coach-initiated, and the D21 next-session default:** *small* = one step or ≤ 5% on a main lift, ±10% elsewhere; reps within the slot range ± 2; sets ± 1. Small → applies per rule 3 / D21. Otherwise → an *offer* today or a *proposal* for next time, with before/after and the reference. Always: snapped to achievable loads, ≤ equipment max, and any increase on a pain-flagged movement is refused. Assisted and bodyweight: HT18. In chat, a number is checked only when the coach ties it to an exercise, set role and reps through a tool; free text never applies. | Any coach number | Practice (bounds) + guardrails (rules 3, 4, 9) | Rule 7 steps 2–4; EQ10; ADR 0006 amendment 2 |
| HT15 | **Basis per set for `Why?`.** Every planned set stores its own basis (top and back-offs differ): reference session and set IDs with their version, role, planned zone, the HT3 path (a–e), the decision (step, repeat, hold, reps first, reset, deload), the step % or translation, adjustments (gap, pain, deload, drift, snap down, max, unit conversion, gym switch) and the source (Ben, coach, plan, rule, repeat). E.g. `Last heavy day 14 Oct: 120 × 5 @8 → +2.5 kg` or `From rows 90 × 12 (est. max 126 kg) → 6s @7`. Stored when planned, never recomputed. | Every target | Guardrail (ADR 0006) | ADR 0006; CLAUDE.md rules 3, 6 |
| HT16 | **Warm-ups follow the targets.** Generated from the final first working load and reps by WU1–WU12 (pending). They read no history except "already warm" today (WU2) and are never references. | Building warm-ups | See [warm-up.md](warm-up.md) | WU1–WU12 |
| HT17 | **One answer everywhere.** The same `SlotSpec` (exercise, role, planned range, RPE, sets, day tag, gym, overrides) with the same history and date gives the same target on every path: builder, Today card, Start, plan day, Summary "Next time", swap, add, coach read tools. Saved workouts and Ben's overrides are part of the `SlotSpec`, so they may legitimately differ from a fresh build. | Always | Guardrail (Practice) | Audits 21 Oct; CLAUDE.md rule 3 |
| HT18 | **Load conventions** (`packages/schemas` `LoadConvention`). `total`, `per_hand`: all rules as written. `stack` and `added` (not the true resistance): same machine only; steps and % bands on the machine's own numbers; **no e1RM translation**: across zones, fewer reps today → hold the last load (`est.`, never raised on first exposure); more reps today → no load (Ben enters, or a coach estimate if he asks). `assistance` (bigger = easier): progress by **one assistance step down**; % shown only with Ben's bodyweight (D5), else "% not checked" (EQ7); no translation (fewer reps → hold; more reps → one step more assistance, `est.`); "small" = one assistance step. `bodyweight` (load 0): reps-only progression to the personal cap, then a proposal for a harder variant or added load; no % bands, "small" = reps ± 2, sets ± 1. **Equipment max:** if a step, translation or coach number lands above max, load = max and reps go up to the cap, then a unilateral or substitute proposal (rule 7 guidance 6; CLAUDE.md rule 4). | Any non-`total`/`per_hand` load, or at max | Practice + guardrail (rule 4) | Rule 7 guidance 4 and 6; EQ7, EQ9; D5 |
| HT19 | **Timed, distance and per-side sets; logged RIR.** Timed (`durationS`) and distance (`distanceM`) sets are matched by load and convention and progress the measure like reps: at the planned value at ≤ planned RPE → next session +5 s or +10% of duration, whichever is larger, or +10% distance *(defaults)*; load is stepped only when Ben or the plan sets a time/distance cap. Per-side sets (`side` L/R) count as **one** set for HT10 and P; targets are per side and the weaker side's result decides. A logged RIR is used as RPE = 10 − RIR. | Planks, carries, holds, unilateral work | Practice (inference) | Rules 4, 7; `SetValuesSchema`, `SetSideSchema` |

### Conflicts and flags (for Ben and the PM; not resolved here)

1. **D7 / rule 7 wording.** HT1 replaces "same routine slot" and "last ≥ 2 sessions" (for the starting point) with role + planned zone + day tag. That changes approved wording, so it needs Ben's explicit approval.
2. **Main-lift reps.** The builder fixes main lifts at 6–8. Under a Strength focus, rule 2 says mostly 1–6 and the built-in rule uses 3–6. HT takes reps from the slot/plan. A 6–8 builder default is a rule 2 / profile question for Ben.
3. **Silent gap cut vs the R2 offer.** The builder's e1RM path silently cuts by gap (14/28/84 days); R2 makes it an offer; the built-in rule ignores gaps. HT5 proposes hold + offer, no silent cut. The ≥ 84-day default is open question 4.
4. **Rep-range drift toward the goal.** `personalRepRange` moves an accessory's range up to 2 reps per session toward the default. HT9 keeps a fixed range unless Ben or the plan changes it. Changes current behaviour.
5. **Isolation rep cap of 15** holds high-rep accessories for ever (shrugs). HT9's personal cap is **Your data** on the slot (rule 10), not a rule-category change.
6. **HT14 replaces two existing bounds**: the step classifier `classifyNextSessionChange` and the 20% `LOAD_CHOICE_LINE` coach ceiling. Ben should confirm the new bands (open question 6).
7. **RPE defaults.** HT11 now defers to `default-rule.ts` (8.5 / 9 / 9). The first draft's "main 8, others 8/9, never above 9" contradicted it and rule 3 (RPE 10 allowed on isolation) and has been dropped.
8. **Labels.** HT uses `est.` only. D18 (approved) still says "approx." for unrated sets in hard-set counts; aligning it to `est.` is Ben's call.
9. **Rule 9 risks found by the audits** (must be fixed whatever Ben decides): the builder's coach target skips D21's pain and stale checks; with a pain flag and no history the builder still plans loads; the old draft's pain hold could plan *above* the in-pain load (fixed in HT12).
10. **Unbounded coach paths.** `edit_today` and coach-added loads have no history bound (the 20% line is prompt text only). `corrections.ts` says "from his last session of it", which contradicts HT1.
11. **Drop sets count toward e1RM in the builder.** HT4/HT13 exclude them.
12. **Session data doesn't exist yet.** Planned range, planned RPE, planned sets, role, day tag and deload must be recorded at logging (ADR 0031). Until then HT1 falls back to achieved reps plus the builder's top/back-off set types.
13. **Pending dependencies.** HT5 needs R1–R3, HT12 needs R4–R5, HT16 needs WU1–WU12, HT3 (d) relies on B6. Suggested approval order: (1) D7/rule 7 wording change; (2) HT1–HT4, HT6–HT11, HT13, HT15, HT17–HT19, which stand alone; (3) R1–R5, then HT5 and HT12; (4) WU1–WU12, then HT16; (5) HT14 last, as it replaces existing bounds.
14. **No HT rule overrides a guardrail.** Loads stay achievable and within min/max (rule 4), reductions round down, completed sets are never edited (rule 2), stale proposals are rejected (rule 5), pain blocks every increase (rule 9), estimates are labelled (rule 6).

---

## 1. What the evidence says

### Documented fact

- **Reps vs %1RM varies a lot between people.** Nuzzo et al. 2024 (*Sports Med* 54:303–321), a meta-regression of 952 rep-to-failure tests from 7,289 people across 269 studies: between-person SD "2.51 repetitions" at 80% 1RM and 4.36 at 60%; leg press allowed more reps than bench at the same %. <https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212> (checked 2026-10-21). **Moderate** for the average, **Weak** for one person's translation.
- **Strength is specific to load range and equipment.** Heavy loads maximise 1RM gains ([Schoenfeld 2017](https://pubmed.ncbi.nlm.nih.gov/28834797/), checked 2026-10-08); free-weight vs machine strength transfers incompletely ([Haugen 2023](https://doaj.org/article/a7282dba5e674176bde2a8239832d2f7), checked 2026-10-09). **Moderate to Strong.**
- **Varying rep zones within a week works.** Grgic et al. 2017 (*PeerJ* 5:e3695), meta-analysis of 13 studies: linear vs daily undulating periodisation, no hypertrophy difference (d = −0.02). <https://pmc.ncbi.nlm.nih.gov/articles/PMC5571788/> (checked 2026-10-21). Heavy and volume days are a normal structure the app must track separately.
- **RPE-based and %-based load choice give similar strength.** Hickmott et al. 2022 (*Sports Med Open* 8:9), 6 studies: 1RM MD 2.07 kg, p = 0.09. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/> (checked 2026-10-21). Helms et al. 2018 (*Front Physiol* 9:247; n = 21): no significant difference, small edge to RPE. <https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/> (checked 2026-10-21). **Moderate.** Supports building targets from his own reps and ratings.
- **Single RPE ratings are about ±1 rep** ([Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/)). **Moderate.**
- **The Epley formula's origin is weak.** A 2026 single-author arXiv preprint (not peer reviewed; unnamed consumer-app data, 303,494 near-failure sets) reports Epley came from a training-manual chart and classical formulas are inconsistent across loads. <https://arxiv.org/abs/2603.17495> (checked 2026-10-21). **Weak.**
- **Detraining:** see [return-to-load.md](return-to-load.md). Losses grow with gap length (Strong); strength largely kept for ~3 weeks (Moderate).

### Expert opinion and coaching practice

- **Top set from last top set; back-offs from the top set or their own history.** RTS / Tuchscherer sets back-offs from the day's top set by RPE or percentage, so a lighter top means lighter back-offs (E9; [RTS overview](https://elitefts.com/education/a-reactive-training-manual-overview), checked 2026-10-08). 5/3/1 and Juggernaut run each zone off one training max (in effect an e1RM translation). GZCL tiers (T1/T2/T3) each progress on their own history. Commercial authors (Wendler, Smith/JTS, LeFever sell books and apps). **Practice.**
- **Double progression on a fixed range** is standard coach practice: the range stays put and load goes up when the top is reached (E8, EQ4). **Practice**; rep progression itself is **Moderate** (Plotkin 2022).

### Where sources disagree, and why

- **How far to trust a cross-zone translation.** Percentage programmes trust the training max fully. Nuzzo's spread says a 12-rep set predicts a 6-rep load only to within roughly ±5–8% (my inference: ±2.5 reps × 2.2–3.2% per rep). Hence HT4's 1-RPE cushion, rounding down and "first exposure only".
- **Which past session to use.** The current code takes the max e1RM over 3 sessions; Ben's direction is the last comparable one. Max-of-3 can lift today's target off an old good day; last-only can drag after one bad day. HT7/HT11 handle the bad day: a miss means repeat, never a cut, and a single rating only holds.

### My inference (not evidence)

- The zone window (± 2 reps), the 84-day line, the 1-RPE cushion, the "small" bands, P − 2 … P and the timed/distance steps are design choices, in line with rule 7 step 2, EQ10 and rule 4. Each is marked *default*.

## 2. How it fits GymSmarter

- **Order of sources for a pending set:** 1. Ben's value. 2. The coach's value (HT14). 3. A named programme or plan prescription (GA14; a plan load older than newer history yields to it). 4. The built-in target (HT1–HT19). 5. Start light. Rule 7-F becomes "HT with no coach", so both read the same reference.
- **Session type** = the slot's planned zone, plus an optional day tag (Heavy, Volume, Deload) set by Ben or a plan. No inference from the calendar.
- **Your data vs Coaching knowledge.** HT rules and defaults are Coaching knowledge. References, fixed slot ranges, personal caps, e1RMs, flags and bases are Your data (rule 10).
- **Minimal copy.** Numbers only; the basis sits behind `Why?`; `est.` is the only inline label.

## 3. Worked examples

Barbell with 1.25 kg plates (2.5 kg steps), total-barbell convention, 3 sets where unstated. Snapped down where HT says so.

**A. Ben's rows: Fri 80 × 12 @ RPE 6, Sat 90 × 12 (no rating).** Both planned as 10–12 volume days; every set reached 12. (If unplanned, achieved reps give the same answer.)
- **Next volume (12s) day.** HT1: reference = Saturday (same role, same zone, newest). Reps hit, no rating → reps decide (HT11). Friday's RPE 6 is older and a single rating can't cause anything. Step: 92.5 kg (+2.8%). HT9: range stays 10–12; same-effort aim (90 × 12 → 92.5) ≈ 10.8 → **92.5 kg × 10–12, aim 10**. `Why?`: `Last 12s day Sat: 90 × 12, 12, 12 → +2.5 kg`.
- **Next heavy (6s) day, rows as the main pull.** No 6s exposure → HT3 (c). HT4 on Saturday's unrated best set as RIR 0: 90 × 1.4 = **126 kg est.** (a lower bound; Friday gives 122.7). Top 6 @ 8, first exposure @ 7: 126 ÷ 1.3 = 96.9 → **95 kg × 6 @ 7 (est.)**. Back-offs (HT8, from today's top, @ 7): 95 × (1 + 9/30) = 123.5 est. → 8s: 123.5 ÷ (1 + 11/30) = 90.4 → **90 kg × 8 @ 7 (est.)**. Copying 90 × 6 as the top would be about RPE 4 at most.
- Gap: rows were done within the week, so the heavy day is not "returning" (HT5). Next heavy day progresses from its own 95 × 6.

**B. Shrugs, 15 reps last time** (dumbbells, 30 kg each × 15, 15, 15; rack steps 2 kg).
- The builder's isolation default (8–12, cap 15) would move him to 8–12s and then hold at 15.
- HT9: range fixed once at 13–15 (P = 15); personal cap 18. Next dumbbell 32 kg is +6.7% (> 5%), so banked reps: every set ≥ 13 + ⌈6.7/2⌉ = 17 first. **Target: 30 kg × 13–15, reps first up to 17 (aim 16).**
- Once every set reaches 17: **32 kg**, same-effort aim 30 × (47/30) ÷ 32 ≈ 1.469 → **14 reps** (range still 13–15). RPE above 12 reps isn't used to judge (rule 4).

**C. Main lift after a 3-week gap** (squat; 21 days ago top 120 × 5 @ 8, back-offs 105 × 8 × 3 @ 8; no squat since; normally weekly).
- R1: returning. HT5: hold, no step. **Targets: 120 × 5 @ 8, then 105 × 8 × 3.**
- R2 offer, today only (pending): −10% → 108 → **107.5 × 5**; back-offs drop by the same % (HT8): 94.5 → **92.5 × 8**. If applied, R3 ramps back.
- The built-in rule today would say +2.5 kg; the builder's calc path would silently cut (conflict 3).

**D. Accessory used as today's main lift** (RDL, usually 100 × 10 @ 8 as an accessory; today main: top 6 @ 8 plus back-offs of 8).
- **Top.** Zone differs → HT3 (c): e1RM 100 × (1 + 12/30) = 140 est.; first exposure @ 7: 140 ÷ 1.3 = 107.7 → **107.5 × 6 @ 7 (est.)**.
- **Back-offs.** No back-off history → HT8 (2), before HT3 (b): today's top 107.5 × (1 + 9/30) = 139.75 est.; 8 @ 7: 139.75 ÷ (1 + 11/30) = 102.3 → **100 × 8 @ 7 (est.)** (7% below top; E9 check passes). Set count from the slot (HT10).
- Next time RDL is main, today's top and back-offs are its references.

**E. Swap to a similar exercise with no history** (barbell bench → a chest-press machine never used).
- HT3 (d): **no load** (start light / enter). Reps from the slot's planned zone; sets from the slot. If Ben asks, the coach may estimate from bench, `est.`, rounded down, ≤ RPE 7. After one session the machine has its own reference.

**F. Deload week** (squat reference 120 × 5 @ 8, back-offs 105 × 8 × 3 @ 8).
- HT12: about half the sets, RPE ≤ 7. Top: 120 × (1 + 7/30) = 148 → 5 @ 7: 148 ÷ (1 + 8/30) = 116.8 → **115 × 5**. Back-off: 105 × (1 + 10/30) = 140 → 8 @ 7: 140 ÷ (1 + 11/30) = 102.4 → **100 × 8, one set**.
- The week after, the deload isn't a reference: targets come from 120 × 5 and 105 × 8 with the decision they had.

**G. Pain flag** (squat 100 × 5 before the flag; 80 × 5 logged while flagged).
- Next session with the flag still active: **≤ 80 × 5**, sets ≤ last time (HT12). Not 100. The same hold covers same-movement IDs (e.g. a squat variant).
- After Ben clears the flag: targets carry on from 80 × 5, and R4 may propose steps back toward 100.

## 4. Open questions for Ben

1. **D7 / rule 7 wording:** OK for the starting point to be the newest exposure in the same role and *planned* zone (plus day tag), instead of "same routine slot, last ≥ 2 sessions"?
2. HT1: is ± 2 reps the right zone window? Wider treats 8s and 12s as one zone.
3. HT4: first exposure in a new zone 1 RPE easier, or exactly at target?
4. HT5: for a break of 84+ days, should the −40% lighter start be the default (labelled `est.`), or only an offer like shorter breaks?
5. HT9: keep each lift's rep range fixed until you change it (proposed), or drift toward the goal's range?
6. HT14: when the coach changes things on its own, is "one step (≤ 5%) on main lifts, ±10% elsewhere, ±2 reps, ±1 set" the right "small"? This replaces the current 20% coach ceiling. When you ask, changes always apply straight away with Undo.
7. D18: switch the unrated-set label from "approx." to `est.` everywhere?
8. HT19: are +5 s / +10% sensible defaults for timed and distance sets?

**Review findings partly rejected or adjusted (reasons):**
- Finding 12 (`gapDays` can't live on the profile): kept on the profile, because finding 2 redefines the gap per R1 as "any exposure of the lift on comparable kit", which doesn't depend on the chosen reference. The other per-reference fields (`e1rmEst`, pattern, staleness) moved into the per-set reference pick, as asked.
- Finding 20 (`est.` only): applied to HT and the ADR. D18's approved "approx." label isn't changed here; it is question 7.
- Finding 18 (">180 days start light"): accepted; the cliff is removed. Whether the −40% is a default or an offer is left to Ben (question 4) because R2, as drafted, says offer.

## Sources (checked 2026-10-21 unless noted)

| Source | Type | Commercial interest | URL |
|---|---|---|---|
| Nuzzo et al. 2024, *Sports Med* | Meta-regression (269 studies) | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212> |
| Grgic et al. 2017, *PeerJ* | Meta-analysis (13 studies) | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC5571788/> |
| Hickmott et al. 2022, *Sports Med Open* | Systematic review + meta-analysis | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/> |
| Helms et al. 2018, *Front Physiol* | RCT (n = 21) | Lead author runs a coaching business (3DMJ) | <https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/> |
| Marzagão 2026, arXiv 2603.17495 | Preprint, not peer reviewed | Data from an unnamed consumer app | <https://arxiv.org/abs/2603.17495> |
| Schoenfeld et al. 2017 (load) | Meta-analysis | None stated | <https://pubmed.ncbi.nlm.nih.gov/28834797/> (checked 2026-10-08) |
| Haugen et al. 2023 | Meta-analysis | None stated | <https://doaj.org/article/a7282dba5e674176bde2a8239832d2f7> (checked 2026-10-09) |
| Halperin et al. 2022 | Meta-analysis | None stated | <https://pubmed.ncbi.nlm.nih.gov/34542869/> (checked 2026-10-08) |
| Plotkin et al. 2022 | RCT | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/> (checked 2026-10-09) |
| Helms et al. 2016 (RIR scale) | Validation study | As above | <https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full> (checked 2026-10-09) |
| Coleman 2024; Bell 2023 (deloads) | RCT; Delphi | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/>; <https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/> (checked 2026-10-08) |
| RTS, 5/3/1, Juggernaut, GZCL | Coaching practice | Yes (books, apps, coaching) | Via [programmes.md](programmes.md) and evidence-core E9 (checked 2026-10-08) |
| Detraining sources | See [return-to-load.md](return-to-load.md) | — | — |

**Copyright and availability.** Summaries and short quotes only. Paid: *5/3/1 Forever*, *Juggernaut Method 2.0*, the RTS manuals, and full texts behind journal access (Schoenfeld 2017, Halperin 2022). Ben can add his own copies to the app library.

## Review log

- 21 Oct 2026, review of the first draft (CHANGES NEEDED, 17 blocking + 4 non-blocking + 3 spec issues). Applied: planned-zone matching (1), R1 gap (2), pain hold at the most recent exposure incl. same-movement IDs (3), one missing-RPE rule (4), HT8 precedence (5), fixed HT9 range (6), planned set count (7), HT14 per rule 3 (8), HT18 conventions (9), import equipment class (10), HT19 (11), read-time derivation (17), example F arithmetic (14), coach-practice fixes and conflicts (18–19), copy (20), three audits (21). ADR items (12, 13, 15, 16) are in ADR 0031. Partial rejections: see §4.
