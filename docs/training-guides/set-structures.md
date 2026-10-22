# Set structures, rep ranges and load profiles for planned blocks

**Summary**
1. Most set structures (straight sets, top set + back-offs, pyramids, clusters, drop sets, supersets) give about the same strength and muscle gains when hard sets and effort match. They differ in time, fatigue and ease of use, so the app can offer them as options (Strong–Moderate).
2. The builder's weak point isn't the weekly %. It's that reps never change while the load rises on the calendar. Real programmes lower reps as load rises, or add reps before load, and step load only when Ben has earned it (Practice; periodised slightly beats non-periodised for 1RM, Moderate).
3. Proposed: the plan stores **reps + target RPE** for each week. Load is worked out each week from the current estimated 1RM (`est.`) and snapped down. Back-offs come from reps and RPE, not a fixed 90%. When a plate jump would make a week flat, the reps change instead.
4. Default structures: Strength and Balanced use **top set + back-offs** with reps falling across the block. Muscle and Fitness use **straight sets, reps then load**. Optional: 3-week wave, heavy + volume days, reverse pyramid.
5. Bench from 100 × 6 (e1RM ≈ 116 kg est.), 8-week Strength: 92.5 × 5 → 95 × 5 → 97.5 × 4 → 97.5 × 5 → 100 × 3 → 102.5 × 3 → 105 × 2, then a deload or test week. The load or reps change every week.

*Library file with **candidate** rules (Coaching knowledge, CLAUDE.md rule 10). Nothing here is in the playbook until Ben approves it. Not medical advice. Pain or injury stops progression on that movement, and the coach suggests seeing a professional. It never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher on 2026-10-22 from four researchers' notes (structures, progression, loading, programmes). Those researchers checked the sources on 2026-10-22; they were not re-fetched for this compilation.*

**Trigger:** Ben said the plan builder ([plan-builder.md](../design/plan-builder.md)) is unrealistic. It gives one top set of 6 (5 on Strength) plus 2 back-offs at ~90% × 8, with load rising a flat ~1.2%/wk (Standard) or ~1.8%/wk (Push), snapped down so it sits flat for weeks. Reps never change, and the deload is −10% with one set fewer. He asked how sets are typically structured, and for options the app can offer.

## Candidate playbook rules

Proposed numbering **SS1–SS15**. Numbers marked *default* can be edited. "e1RM" means estimated 1RM, always shown as `est.` (rule 6). "Snap" means snapped **down** to the selected gym's real equipment, within min/max (rule 4). "RPE x" means 10 − x reps in reserve (RIR).

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| SS1 | **Main-lift defaults by focus (Standard effort).** **Strength:** 1 top set of 3–5 @ RPE 7→8.5, plus 2 back-offs at the same reps about 1 RPE easier. **Balanced:** 1 top set of 4–6 @ RPE 7→8.5, plus 2 back-offs of top reps + 2 at about 0.5 RPE easier. **Muscle:** 3 straight sets in 6–10 (compounds) @ RIR 3→1. **Fitness:** 2–3 straight sets of 10–12 @ RPE 6–7.5. Rest per approved rule 9 (heavy 2–5 min, 3–5 after a top set). | Building a main-lift slot | Strong (heavy loads for 1RM; muscle growth across a wide load range) + Practice (exact bands and arrangement) | [ACSM 2009](https://sfu.ca/~ryand/kin343/ACSMresistance.pdf); [Schoenfeld 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/); [Lopez 2021](https://jyx.jyu.fi/handle/123456789/75929); [Currier/ACSM 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823); approved rule 2 |
| SS2 | **Effort setting.** **Maintain:** top set + 1 back-off (or 2 straight sets), RPE ≤ 7.5 every week, no wave, no AMRAP. Load changes only when the e1RM changes. **Standard:** SS1. **Push:** the last 2 build weeks' RPE +0.5 (main lifts ≤ 9), plus 1 extra back-off **only if Ben confirms** it (rule 1: sets grow only when he asks). | Plan effort choice | Practice | [Currier/ACSM 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823) ("progression is not necessary" for health); rule 1 |
| SS3 | **The plan stores reps + target RPE, not loads.** Each week's load = e1RM × %(reps + RIR), snapped. It is recomputed from the current e1RM before each session. Any % shown is only a starting guess. | Every planned main-lift set | Moderate (RPE- and %-based loading give similar gains; rep–%1RM relation holds on average) / Weak (for one person: SD ≈ 2.5 reps at 80%) | [Hickmott 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/); [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/); [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212) |
| SS4 | **Back-offs come from reps and RPE, never a fixed %.** Load is worked out like SS3 at the back-off's reps and RPE, then snapped. It is never above today's top load, and back-off RPE is never above the top set's. Sanity band: 2–15% below the top (Strength 2–8%, Balanced 4–10%, Muscle 8–15%). When today's top is lowered, the back-offs drop by the same % (HT8). | Top set + back-off slots | Weak (Helms RPE-stop used 2/4/6% drops) + Practice | [Helms 2018 RPE-stop](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full); HT8; [RTS via FitnessVolt](https://fitnessvolt.com/rpe-training/guides/backoff-sets-guide/) (secondary) |
| SS5 | **Reps change across a block.** Strength/Balanced: top-set reps fall about 1 every 1–2 weeks (e.g. 5→4→3→2 or 6→5→4) as RPE rises. Muscle/Fitness/accessories: reps rise within a fixed range, then load steps up. Never plan ≥ 3 weeks of rising load at the same reps and RPE. | Plans ≥ 4 weeks | Moderate (periodised > non-periodised for 1RM, small; linear ≈ undulating) + Practice (patterns) | [Moesgaard 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/); [Williams 2017](https://www.springermedicine.com/comparison-of-periodized-and-non-periodized-resistance-training-/22255106); [Harries 2015](https://pubmed.ncbi.nlm.nih.gov/25268290/); [Grgic 2017](https://peerj.com/articles/3695) |
| SS6 | **Effort ramps across each block:** main lifts RPE 7 → 8.5 (Push 9), accessories RIR 3–4 → 1, then a deload or test week. RPE 10 only on planned last sets, AMRAPs or isolation work (rule 3). | All planned blocks | Weak (Helms 2018 ramped RPE 5–7 → 8–10) + Practice (RP, Juggernaut) | [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/); [RP](https://rpstrength.com/blogs/articles/progressing-for-hypertrophy) |
| SS7 | **No flat weeks from snapping.** If this week's snapped load ≤ last week's at the same or fewer reps: (a) if the gym profile lists microplates (D6), use the closer load; else (b) keep last week's load and do **+1 rep** (if the predicted RPE ≤ plan + 0.5); next week takes the full step. Never round up past the plan. Dumbbells and stacks (steps 4–10%+): reps-then-load only (HT9, 7-F). | Any week whose snapped load would repeat | Moderate (rep or load progression both work) + Practice | [Plotkin 2022](https://peerj.com/articles/14142); [Hostler 2001 via EQ4](equipment-aware-progression.md); [Alpha Progression](https://alphaprogression.com/en/blog/alpha-progression-guide) |
| SS8 | **Realistic pace.** For planning and sanity checks, an intermediate's e1RM rises about **0.5%/wk upper, 1%/wk lower** over months. Push is at most 1.5× that, Maintain 0. Top-set *load* may rise ~1.5–2.5%/wk inside a block **only because reps fall**. The plan never assumes gains; they arrive through logged sets (SS9). | Plan effort defaults; coach number checks | Practice (5/3/1 increments) + Weak (observational) | [5/3/1 via Lift Vault](https://liftvault.com/programs/strength/jim-wendlers-531-spreadsheet/); [Latella 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7448836/); [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/) |
| SS9 | **Next week follows what was lifted.** e1RM update: newest qualifying top or back-off set (1–10 reps; not warm-ups, drops, myo-reps or pain-flagged sets) raises it. It falls only after 2 lower sessions in a row. Then: **reps hit at ≤ planned RPE** → next week as planned. **One rating ≥ plan + 1** → e1RM not raised, next week as planned (a single rating holds, never cuts; rule 4). **Two in a row ≥ plan + 1 at that load** → next week's load ≤ this week's (HT11). **Missed by 1 rep** → repeat this week. **Missed by ≥ 2, or 2 misses in a row** → rule 8 proposal: a 5–10% reset, or SS13's stage change. **≤ plan − 2 with reps hit** → as planned (the higher e1RM lifts it), and the coach may offer more (rule 6). | After each finished session | Practice (RTS, 5/3/1, Boostcamp) + Moderate (RPE ≈ ±1 rep) | [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/); [Reynolds 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf); [Boostcamp](https://www.boostcamp.app/features/auto-progression); HT7, HT11; rules 4, 8 |
| SS10 | **Deload / test week.** **Deload:** sets about halved, reps at or below week 1's, RPE ≤ 6–7, load from e1RM (usually 0–10% below week 1). Same structure and exercises. **Test (optional):** top single @ RPE 9, or an AMRAP stopped at RPE 9 (P2) → new e1RM `est.` Placement: 4 wk none (reactive only, rule 10); 6 wk week 6; 8 wk week 8; 12 wk weeks 4, 8, 12. | Plan builder; replaces "−10%, −1 set" | Weak (one RCT) + Practice (expert consensus: cut sets, reps and effort; load can stay) | [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/); [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/) (RP-funded); [Pritchard 2016](https://pubmed.ncbi.nlm.nih.gov/26670988/); rule 10, HT12 |
| SS11 | **Accessories: reps then load on a fixed range** (HT9). Ranges by focus *(default)*: Strength 6–10, Balanced 8–12, Muscle 8–12 compounds / 12–20 isolation, Fitness 12–15. Effort RIR 3 → 1 across the block. +1 smallest step when every set reaches the top at ≤ planned RPE; reps go back to the range bottom. Above 12 reps, judge by reps, not RPE (rule 4). | Non-main slots | Moderate (rep or load progression both work; wide load range builds muscle) + Practice | [Plotkin 2022](https://peerj.com/articles/14142); [Schoenfeld 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/); [Robinson 2024](https://sportrxiv.org/index.php/server/preprint/view/295) |
| SS12 | **Time-savers, opt-in.** (a) Antagonist supersets (press + row, curl + triceps) are the first cut when a session is short; 60–90 s between paired exercises. (b) Drop set (last set to RPE 9–10, 1–2 drops of ~20–25%, each snapped, ending at the machine minimum) or myo-reps (activation set of 12–20 to RIR 0–1, then 3–5-rep mini-sets after 3–5 breaths, until 3 reps fail or 5 mini-sets): **last set of machine, cable or dumbbell isolation only**, never heavy barbell squat, bench or deadlift. Each series counts as 1 hard set (rule 1). Rule T ignores them. | Short sessions; Muscle/Balanced; Ben asks | Moderate (equal results, less time) / Weak (long-term supersets; rest-pause edge rests on 4 trials) + Practice (drop sizes, placement) | [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/); [Sødal 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10390395/); [Tsartsapakis 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12922048/); [Prestes 2019](https://pubmed.ncbi.nlm.nih.gov/28617715/) |
| SS13 | **Stall stages before resets.** After a rule 8 stall on a main lift, the first proposal keeps the load and splits the work: 3 × 5 → 5 × 3 → 6 × 2 (or clusters of 2–3 reps with 15–30 s between, 2–3 min between sets). Then a 5–10% reset. Always a proposal. | Rule 8 on a main lift | Practice (GZCLP, Texas Method) + Moderate (clusters ≈ traditional for strength and size) | [GZCLP](https://thefitness.wiki/routines/gzclp/); [Jukic 2021](https://cris.maastrichtuniversity.nl/en/publications/the-effects-of-set-structure-manipulation-on-chronic-adaptations-/); [Davies 2021](https://pubmed.ncbi.nlm.nih.gov/33475986/) |
| SS14 | **Structure options** (section 6) are chosen per plan, or per main lift, in the builder. Changing one mid-plan is a structural proposal (Apply/Undo). The app never swaps structure on its own or mid-session. | Plan builder, coach | n/a (guardrail) | CLAUDE.md rule 3 |
| SS15 | **Every set carries a role** (top, back-off, straight, drop, myo, cluster, AMRAP, test, deload), so rule T, HT10 and SS9 treat it correctly. Planned AMRAP, test, drop and myo sets never trigger rule T. Cluster mini-sets never count as "reps below range". | Logging and targets | Guardrail / Practice | rule T; HT10, HT13; [ADR 0031](../decisions/0031-exercise-performance-profile.md) |

**Guardrails (none overridden):**
- Every load is snapped down to the gym's equipment and never goes past the machine max (rule 4). A drop set ends at the machine minimum.
- A pain flag freezes every increase and every structure on that movement: steps, SS7 rep adds, AMRAPs, tests, drops and myo-reps (rule 9, HT12). Pain mentioned mid-series ends the series. The coach doesn't diagnose.
- e1RM, test results and % figures are labelled `est.` (rule 6).
- Next-week loads from SS9 are the coach's or the built-in rule's *small* next-session changes (rule 3, D21). Structure, rep scheme, stage and reset changes are proposals.
- Same-day changes stay with the approved rule 5/T thresholds. This file adds no new mid-session trigger.

**Conflicts to flag (not resolved here):**
- **Plan builder.** SS3, SS5, SS7 and SS10 replace the flat %/week, fixed reps, fixed 90% × 8 back-offs and −10%/−1-set deload. This is a design change for Ben and the designer.
- **HT7 "+1 step" vs a planned block.** When the plan lowers reps next week, the load comes from the e1RM (HT4/HT6 translation), not "+1 step". HT6 currently covers only 1–2 rep changes in the same zone, so HT1/HT6 need wording for planned blocks (question 3).
- **Formula.** HT4 uses RIR-adjusted Epley. The worked examples below use Nuzzo's bench data, which gives about 3% lighter loads at 3–6 reps. Pick one (question 2).
- **Push + sets.** Whether choosing "Push" in the builder counts as Ben asking for more sets under rule 1 (question 4).

---

## 1. Default main-lift prescription by focus and effort

Standard effort shown. Rows are *default* and editable.

| Focus | Main-lift structure | Top set (reps @ RPE, wk 1 → last build wk) | Back-offs | Sets | Typical %e1RM (est.) |
|---|---|---|---|---|---|
| Strength | Top set + back-offs | 5 @ 7 → 2–3 @ 8.5 | 2 × same reps, 1 RPE easier | 3 | 80 → 92% |
| Balanced | Top set + back-offs | 6 @ 7 → 4 @ 8 (–8.5) | 2 × (top reps + 2), 0.5 RPE easier | 3 | 78 → 86% |
| Muscle | Straight sets, reps then load | 3 × 6–10 @ RIR 3 → 1 | — | 3 | 72 → 82% |
| Fitness | Straight sets, reps then load | 2–3 × 10–12 @ RPE 6 → 7.5 | — | 2–3 | 68 → 74% |

| Effort | Change from Standard |
|---|---|
| Maintain | Top set + 1 back-off (or 2 straight sets). Hold week 1's reps and RPE ≤ 7.5. No wave, AMRAP or test. |
| Standard | As above. |
| Push | Last two build weeks +0.5 RPE (main lifts ≤ 9). An extra back-off only if Ben confirms it. |

Where it comes from: ACSM 2009 (strength progress in experienced lifters needs ≥ 80% 1RM; muscle mostly 6–12RM), Currier/ACSM 2026 (strength ≥ 80% for 2–3 sets, RIR 2–3 suggested), Schoenfeld 2021 and Lopez 2021 (wide load range builds muscle; heavy loads needed for 1RM), and Robinson 2024 (closeness to failure matters for muscle, barely for strength). The exact bands and set arrangement are **Practice**.

**Why the current back-off is wrong, and why the sources disagree.** The fixed 90% × 8 back-off ignores how hard the top set was. After 100 × 6, 90 kg × 8 is about RPE 8 if the top set was at failure (Nuzzo bench data). It is about RPE 6 if the top set was RPE 8 (Epley). One researcher called it "close to failure", another "too easy". Both are right for different top-set efforts. That is why SS4 works it out from reps and RPE.

## 2. Week-by-week profiles (worked bench example)

**Method (inference).** Bench, e1RM 116 kg `est.` (from 100 × 6, assumed near failure). Plates in 2.5 kg steps, no microplates. Load = 116 × %(reps + RIR), snapped down. The % comes from a straight-line interpolation of Nuzzo 2024's bench means (≈ 4 / 8.8 / 14.1 reps to failure at 90 / 80 / 70%):

| Reps to failure | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| % e1RM (bench, est.) | 93.3 | 90.0 | 87.9 | 85.8 | 83.8 | 81.7 | 79.6 | 77.7 | 75.8 | 73.9 | 72.0 |

The tables assume Ben makes each week's target exactly, so the e1RM stays at 116. That is deliberately conservative: real gains raise later weeks through SS9. Squat and leg lifts allow more reps at a given % (Nuzzo), so their tables would differ (question 2).

### 8 weeks, Strength, Standard (top set + 2 back-offs)

| Wk | Top set | Back-offs (2 ×) | Change |
|---|---|---|---|
| 1 | 92.5 × 5 @ 7 | 90 × 5 @ 6 | — |
| 2 | 95 × 5 @ 7.5 | 92.5 × 5 @ 6.5 | load |
| 3 | 97.5 × 4 @ 7.5 | 95 × 4 @ 6.5 | load, reps down |
| 4 | 97.5 × **5** @ ~8 | 95 × **5** @ ~7 | SS7: computed 4 @ 8 snaps to 97.5 again, so +1 rep |
| 5 | 100 × 3 @ 8 | 97.5 × 3 @ 7 | load, reps down |
| 6 | 102.5 × 3 @ 8.5 | 100 × 3 @ 7.5 | load |
| 7 | 105 × 2 @ 8.5 (Push: 107.5 × 2 @ 9) | 102.5 × 2 @ 7.5 | load, reps down |
| 8 | **Deload:** 2 × 90 × 5 @ ~6. **Or test:** top single @ RPE 9 (≈ 110 est.) or 100 × AMRAP stopped at RPE 9 → new e1RM | | |

Compared with the current builder: top-set load rises about 13% over 7 weeks *because reps fall 5 → 2*, and the estimated strength doesn't need to change. Planned at Standard 1.2%/wk with reps fixed at 6, the same load rise would assume a ~10% real e1RM gain in 8 weeks. That is more than SS8's pace for an intermediate bench (inference).

### 4 weeks, Strength (no planned deload; reactive only, rule 10)

| Wk | Top | Back-offs |
|---|---|---|
| 1 | 92.5 × 5 @ 7 | 2 × 90 × 5 |
| 2 | 97.5 × 4 @ 7.5 | 2 × 95 × 4 |
| 3 | 100 × 3 @ 8 | 2 × 97.5 × 3 |
| 4 | 102.5 × 3 @ 8.5, or a test (as week 8 above) | 2 × 100 × 3 |

### 6 weeks, Strength, 3-week wave (option C)

| Wk | Top | Back-offs | Note |
|---|---|---|---|
| 1 | 95 × 5 @ 7.5 | 2 × 92.5 × 5 | wave 1 |
| 2 | 100 × 3 @ 8 | 2 × 97.5 × 3 | |
| 3 | 105 × 2 @ 8.5 | 2 × 102.5 × 2 | |
| 4 | 97.5 × 5 (≈ RPE 8 if e1RM unchanged) | 2 × 95 × 5 | wave 2 = wave 1 + 1 step, **only if** wave 1 was logged at or below plan RPE. Otherwise wave 1's loads + 1 rep (SS7) |
| 5 | 102.5 × 3 | 2 × 100 × 3 | |
| 6 | Deload or test | | |

### 8 weeks, Muscle (straight sets 3 × 6–10, reps then load)

| Wk | Sets | Predicted RPE (e1RM unchanged) |
|---|---|---|
| 1 | 3 × 90 × 7 | ~7 |
| 2 | 3 × 90 × 8 | ~8 |
| 3 | 3 × 90 × 9 | ~9 |
| 4 | 3 × 92.5 × 7 | ~8 |
| 5 | 3 × 92.5 × 8 | ~9 |
| 6 | 3 × 95 × 6 | ~8 |
| 7 | 3 × 95 × 7 | ~9 |
| 8 | Deload: 2 × 87.5 × 7 (~RPE 6) | |

Later sets may lose a rep. The weakest set sets the next target (HT9). With real gains the RPE runs about 0.5 lower and the steps come sooner.

### 12 weeks, Balanced (3 × [3 build weeks + 1 deload])

| Block | Wk 1 (6 @ 7) | Wk 2 (5 @ 7.5) | Wk 3 (4 @ 8) | Wk 4 |
|---|---|---|---|---|
| 1 (e1RM 116) | 90 × 6; BO 2 × 85 × 8 | 95 × 5; BO 2 × 90 × 7 | 97.5 × 4; BO 2 × 92.5 × 6 | Deload |
| 2 (e1RM 118.5, *assumed* from wk 3 log) | 92.5 × 6 | 97.5 × 5 | 100 × 4 | Deload |
| 3 (e1RM 121, *assumed*) | 95 × 6 | 100 × 5 | 102.5 × 4 | Test or deload |

The assumed e1RM gain is about 2% per block (≈ 0.5%/wk, SS8). If the log shows less, the block repeats at the same loads, with +1 rep where SS7 allows.

**Other options in 12 weeks:** two 6-week blocks, or heavy + volume days (option D). For D, the heavy day follows the table above. The volume day is 3 × 8–10 @ RPE 7 from the same e1RM (≈ 85 × 8 → 85 × 10 → 87.5 × 8), using reps then load, each day on its own history (D7).

## 3. Plate jumps

- **The problem (inference).** On a 100 kg bench, the smallest step (2.5 kg) is 2.5%, which is about one rep (bench ≈ 2–2.5% per rep at 80–90%; Nuzzo 2024). A 1.2%/wk target that is snapped down therefore sits flat for 2 weeks, then jumps.
- **SS7 order.**
  1. Use microplates if the gym profile lists them (D6; EQ4, Hostler 2001, Weak).
  2. Otherwise keep the load and add 1 rep.
  3. Next week, take the full step and go back to the planned reps.
- **Bench example:** 100 × 6 → 100 × 7 → 102.5 × 6 → 102.5 × 7. That is about 1.2%/wk equivalent, and every week changes visibly.
- **Reps vs load** both work for size, with a small non-significant strength edge for load (Plotkin 2022).
- **Dumbbells, stacks and kettlebells** (steps 5–10%+): reps then load only, with 7-F's ~10% cap and banked reps (EQ3, HT9). Alpha Progression's "reps flex around weight steps" is the commercial precedent.

## 4. Accessories

- **Default:** SS11, reps then load on a fixed range, RIR 3 → 1, 3 sets.
- **Rest:** 1–2 min (rule 9). For muscle, rest more than 60–90 s ([Singer 2024](https://pubmed.ncbi.nlm.nih.gov/39205815/), Moderate).
- **Short sessions, cut in this order (inference):**
  1. Antagonist supersets (SS12a; ~37% less time, similar volume; [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/)).
  2. Drop set or myo-reps on the last isolation set (SS12b).
  3. One fewer accessory set.
  4. Never cut the main-lift load to save time (playbook "cut sets, not load").
- **Not proposed:** RP-style weekly set increases. Rule 1 grows sets only when Ben asks.

## 5. How next week adjusts

SS9 in practice (planned 100 × 3 @ 8, week 5 above):

| Logged | Next week (planned 102.5 × 3 @ 8.5) |
|---|---|
| 100 × 3 @ 7 | e1RM rises to ≈ 119 est. → 105 × 3 @ 8.5 |
| 100 × 3 @ 8 | as planned, 102.5 × 3 |
| 100 × 3 @ 9 (once) | e1RM held → 102.5 × 3 as planned; a second ≥ +1 in a row holds the load at 100 |
| 100 × 2 | repeat 100 × 3 |
| 100 × 1, or a second miss | rule 8 proposal: 5 × 2 at 100 (SS13), or a reset to ~92.5 |

Same day: when the top set trips rule T (≥ plan + 1.5 RPE), the approved rule 5 offer applies to the back-offs. Helms 2018's protocol (±2% per 0.5 RPE; a missed rep = 1 RPE) supports rule 5's 2–4% per point (D22). Below the rule T threshold, back-offs stay as planned.

## 6. Structure options for the builder

| Option | One line | Suits | Default for |
|---|---|---|---|
| **A. Top set + back-offs** | One heavy set at target RPE, then 2 lighter sets; reps fall across the block | Intermediates who log RPE; Strength, Balanced | **Strength, Balanced** |
| **B. Straight sets, reps then load** | Same load on every set; add reps to the top of the range, then a step | Everyone; simplest to log; DB/machine lifts | **Muscle, Fitness**, all accessories |
| **C. 3-week wave** | 5s / 3s / 2s (or 5-3-1) rising each week, repeat one step heavier, optional test | Strength, 2–4 days, 6/12-week plans | — |
| **D. Heavy + volume days** | Same lift twice a week: one heavy top-set day, one 3 × 8–10 day | Lift trained ≥ 2×/wk; Balanced | — (offered when frequency ≥ 2) |
| **E. Reverse pyramid** | Heaviest set first, then ~10–15% lighter with ~2 more reps each set (e.g. 6–8 / 8–10 / 10–12) | Muscle/Balanced intermediates, short sessions | — |

Evidence: every option is **Practice** as a named scheme. That the structures give similar results is Moderate–Strong (pyramids: [Angleri 2017](https://pubmed.ncbi.nlm.nih.gov/28130627/); clusters: Jukic 2021; periodisation models: Moesgaard 2022, Harries 2015). Option E's source is Andy Morgan ([RippedBody](https://rippedbody.com/reverse-pyramid-training/), commercial), who says it eventually stops giving enough stimulus for advanced lifters. A strict 5/3/1 training-max version of C stays a named programme in [programmes.md](programmes.md) (P1–P3).

## 7. Open questions for Ben

1. Replace the flat %/week with SS3 + SS5 (reps + RPE per week, load from e1RM)? Keep "Linear (reps fixed)" as an option, or drop it?
2. One conversion formula: HT4's Epley (simpler; ~3% heavier at 3–6 reps), or exercise-specific tables based on Nuzzo (closer to the data; needs per-pattern tables)?
3. Should HT1/HT6/HT7 say that in a planned block the next load comes from the e1RM, not "+1 step"?
4. Does picking **Push** count as asking for an extra back-off (rule 1), or should it still ask?
5. Default deload (SS10: about half the sets, RPE ≤ 6–7), or a test week at the end of 6/8/12-week plans?
6. Should option choice be per plan, or per main lift (SBS-style)?
7. Allow drop sets and myo-reps (SS12b) at all, or supersets only?
8. Should cluster sets go in the active-set UI (needs a 15–30 s intra-set timer), or only into SS13's "more sets of fewer reps"?

## 8. Sources, interests and copyright

| Source | Type | Interest |
|---|---|---|
| [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212) | Meta-regression, reps vs %1RM | Two authors previously at an equipment company |
| [ACSM 2009](https://sfu.ca/~ryand/kin343/ACSMresistance.pdf); [Currier/ACSM 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823) | Position stands (2026 full text partly paywalled) | None stated |
| [Schoenfeld 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/); [Lopez 2021](https://jyx.jyu.fi/handle/123456789/75929) | Review; network meta-analysis | None stated |
| [Robinson 2024](https://sportrxiv.org/index.php/server/preprint/view/295); [Refalo 2023](https://openrepository.aut.ac.nz/items/78679612-6ff4-4d00-95d1-7920d072a760/full); [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/) | Meta-analyses (failure, RIR accuracy) | None stated |
| [Moesgaard 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/); [Williams 2017](https://www.springermedicine.com/comparison-of-periodized-and-non-periodized-resistance-training-/22255106); [Harries 2015](https://pubmed.ncbi.nlm.nih.gov/25268290/); [Grgic 2017](https://peerj.com/articles/3695) | Meta-analyses (periodisation) | None stated. Moesgaard's "undulating > linear in trained lifters" seen only in secondary summaries |
| [Hickmott 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/); [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/); [Helms RPE-stop 2018](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full) | Meta-analysis; RCTs | Helms coaches and sells books (3DMJ) |
| [Plotkin 2022](https://peerj.com/articles/14142) | RCT, reps vs load progression | None stated |
| [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/); [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/); [Pritchard 2016](https://pubmed.ncbi.nlm.nih.gov/26670988/) | Delphi; RCT; interviews | Coleman funded by RP |
| [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/); [Sødal 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10390395/); [Tsartsapakis 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12922048/); [Prestes 2019](https://pubmed.ncbi.nlm.nih.gov/28617715/); [Jukic 2021](https://cris.maastrichtuniversity.nl/en/publications/the-effects-of-set-structure-manipulation-on-chronic-adaptations-/); [Davies 2021](https://pubmed.ncbi.nlm.nih.gov/33475986/); [Angleri 2017](https://pubmed.ncbi.nlm.nih.gov/28130627/) | Meta-analyses and trials (structures). Tsartsapakis reports inconsistent study counts | None stated |
| [Latella 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7448836/); [Reynolds 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf) | Observational; prediction study | None stated |
| [5/3/1 via Lift Vault](https://liftvault.com/programs/strength/jim-wendlers-531-spreadsheet/); [GZCLP](https://thefitness.wiki/routines/gzclp/); [Juggernaut via Liftosaur](https://www.liftosaur.com/programs/juggernaut-method); [RP](https://rpstrength.com/blogs/articles/progressing-for-hypertrophy); [RippedBody](https://rippedbody.com/reverse-pyramid-training/); [Boostcamp](https://www.boostcamp.app/features/auto-progression); [Alpha Progression](https://alphaprogression.com/en/blog/alpha-progression-guide); [FitnessVolt](https://fitnessvolt.com/rpe-training/guides/backoff-sets-guide/) | Coaching practice and apps (secondary for paid books) | All commercial |

**Paid or not fully read:**
- Abstracts or summaries only: Moesgaard 2022, Robinson 2024, Halperin 2022, Davies 2021, Jukic 2021 and Prestes 2019.
- Paid books and manuals: *5/3/1 Forever*, *Juggernaut Method 2.0* and the RTS manuals.

Only summaries are held here. Ben can add his own copies to the library.
