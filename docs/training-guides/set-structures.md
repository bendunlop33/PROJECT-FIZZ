# Set structures, rep ranges and load profiles for planned blocks

**Summary**
1. Most set structures (straight sets, top set + back-offs, pyramids, clusters, drop sets, supersets) give about the same strength and muscle gains when hard sets and effort match. They differ in time, fatigue and ease of use, so the app can offer them as options (Moderate; reverse pyramid untested, Practice).
2. The builder's weak point isn't the weekly %. It's that reps never change while the load rises on the calendar. Real programmes lower reps as load rises, or add reps before load, and step load only when Ben has earned it (Practice; periodised slightly beats non-periodised for 1RM, Strong).
3. Proposed: the plan stores **reps + target RPE** for each week. Load is worked out each week from the current estimated 1RM (`est.`) and snapped down. Back-offs come from reps and RPE, not a fixed 90%. When snapping would make a week flat or clearly too easy, the reps change instead.
4. Default structures: Strength and Balanced use **top set + back-offs** with reps falling across the block (heavy + volume days when a lift is trained 2×/week). Muscle and Fitness use **straight sets, reps then load**. Optional: 3-week wave, reverse pyramid.
5. Bench from 100 × 6 (e1RM ≈ 116 kg est.), 8-week Strength: 92.5 × 5 → 95 × 5 → 97.5 × 4 → 97.5 × 5 → 100 × 4 → 102.5 × 3 → 105 × 2, then a deload or test week. The load or reps change every week.

*Library file with **candidate** rules (Coaching knowledge, CLAUDE.md rule 10). Nothing here is in the playbook until Ben approves it. Not medical advice. Pain or injury stops progression on that movement, and the coach suggests seeing a professional. It never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher on 2026-10-22 from four researchers' notes (structures, progression, loading, programmes). Those researchers checked the sources on 2026-10-22. Revised the same day after a reviewer's citation and arithmetic check (18 corrections; see "Reviewer notes" at the end).*

**Trigger:** Ben said the plan builder ([plan-builder.md](../design/plan-builder.md)) is unrealistic. It gives one top set of 6 (5 on Strength) plus 2 back-offs at ~90% × 8, with load rising a flat ~1.2%/wk (Standard) or ~1.8%/wk (Push), snapped down so it sits flat for weeks. Reps never change, and the deload is −10% with one set fewer. He asked how sets are typically structured, and for options the app can offer.

## Candidate playbook rules

Proposed numbering **SS1–SS15**. Numbers marked *default* can be edited. "e1RM" means estimated 1RM, always shown as `est.` (rule 6). "Snap" means snapped **down** to the selected gym's real equipment, within min/max (rule 4). "RPE x" means 10 − x reps in reserve (RIR).

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| SS1 | **Main-lift defaults by focus (Standard effort).** **Strength:** 1 top set of 3–5 @ RPE 7→8.5, plus 2 back-offs at the same reps about 1 RPE easier. **Balanced:** 1 top set of 4–6 @ RPE 7→8.5, plus 2 back-offs of top reps + 2 at about 0.5 RPE easier. **Muscle:** 3 straight sets in 6–10 (compounds) @ RIR 3→1.5 (RPE 7→8.5; Push up to RPE 9). **Fitness:** 2–3 straight sets of 10–12 @ RPE 7→8 (~68–74% e1RM, est.); an RPE 6 start depends on D9, which isn't in force. Rest per approved rule 9 (heavy 2–5 min, 3–5 after a top set). **When a main lift appears ≥ 2×/week** (approved rule 2 for Strength): either (a) *default* option D: the heavy day as tabled, plus a volume day of 3 × 8–10 @ RPE 7, or (b) repeat the same week's prescription each session, with weekly steps unchanged. Weekly hard sets per main lift stay within 3–6 (V4). | Building a main-lift slot | Strong (heavy loads for 1RM; muscle growth across a wide load range) + Moderate (≥ 2×/week) + Practice (exact bands and arrangement) | [ACSM 2009](https://sfu.ca/~ryand/kin343/ACSMresistance.pdf); [Schoenfeld 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/); [Lopez 2021](https://jyx.jyu.fi/handle/123456789/75929); [Currier/ACSM 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823) ("≥ 2 sessions per week"); approved rules 2, 3; V4 |
| SS2 | **Effort setting.** **Maintain:** top set + 1 back-off (or 2 straight sets), RPE ≤ 7.5 every week, no wave, no AMRAP. Load changes only when the e1RM changes. **Standard:** SS1. **Push:** the last 2 build weeks' RPE +0.5 (main lifts ≤ 9), plus 1 extra back-off **only if Ben confirms** it (rule 1: sets grow only when he asks). | Plan effort choice | Practice | [Currier/ACSM 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823) ("progression is not necessary" for health); rule 1 |
| SS3 | **The plan stores reps + target RPE, not loads.** Each week's load = e1RM × %(reps + RIR), snapped. It is recomputed from the current e1RM before each session. Any % shown is only a starting guess. Prefer e1RMs from sets of ≤ 10 reps. | Every planned main-lift set | Moderate for strength (RPE- and %-based loading give similar 1RM gains); no pooled hypertrophy evidence / Weak (for one person: SD ≈ 2.5 reps at 80%; prediction less accurate from higher-rep sets) | [Hickmott 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/); [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/); [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212); [Reynolds 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf) |
| SS4 | **Back-offs come from reps and RPE, never a fixed %.** Load is worked out like SS3 at the back-off's reps and RPE, then snapped. It is never above today's top load, and back-off RPE is never above the top set's. Sanity band: 2–15% below the top (Strength 2–8%, Balanced 4–10%, Muscle 8–15%). When today's top is lowered, the back-offs drop by the same % (HT8). | Top set + back-off slots | Weak (Helms RPE-stop used 2/4/6% drops) + Practice | [Helms 2018 RPE-stop](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full); HT8; [RTS via FitnessVolt](https://fitnessvolt.com/rpe-training/guides/backoff-sets-guide/) (secondary) |
| SS5 | **Reps change across a block.** Strength/Balanced: top-set reps fall about 1 every 1–2 weeks (e.g. 5→4→3→2 or 6→5→4) as RPE rises. Muscle/Fitness/accessories: reps rise within a fixed range, then load steps up. Never plan ≥ 3 weeks of rising load at the same reps and RPE. | Plans ≥ 4 weeks | Strong (periodised > non-periodised for 1RM, small: Williams 2017 ES 0.43; Moesgaard 2022 ES 0.31) + Weak–Moderate (linear vs undulating: sources disagree; Moesgaard favours undulating in trained lifters, Harries 2015 null) + Practice (patterns) | [Moesgaard 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/) via [sci-sport summary](https://sci-sport.com/en/effects-intensity-volume-periodization-strength-hypertrophy-238/); [Williams 2017](https://www.springermedicine.com/comparison-of-periodized-and-non-periodized-resistance-training-/22255106); [Harries 2015](https://pubmed.ncbi.nlm.nih.gov/25268290/); [Grgic 2017](https://peerj.com/articles/3695) (hypertrophy only) |
| SS6 | **Effort ramps across each block:** main lifts RPE 7 → 8.5 (Push 9), for every focus including Muscle straight sets; accessories RIR 3–4 → 1. Then a deload or test week. RPE 10 only on planned last sets, AMRAPs or isolation work (rule 3). | All planned blocks | Weak (Helms 2018 ramped RPE 5–7 → 8–10) + Practice (RP, Juggernaut) | [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/); [RP](https://rpstrength.com/blogs/articles/progressing-for-hypertrophy) |
| SS7 | **No flat or too-easy weeks from snapping.** If this week's snapped load ≤ last week's at the same or fewer reps: (a) if the gym profile lists microplates (D6), use the closer load; else (b) keep last week's load and do **+1 rep** (if the predicted RPE ≤ plan + 0.5); next week takes the full step. Also, if snapping drops the *predicted* RPE by ≥ 0.75 below plan, consider +1 rep, within the focus's rep band and not on fixed-rep named schemes (option C). Never round up past the plan. The builder shows both planned and predicted RPE. Dumbbells and stacks (steps 4–10%+): reps-then-load only (HT9, 7-F). | Any week whose snapped load would repeat or undershoot | Moderate (rep or load progression both work) + Practice | [Plotkin 2022](https://peerj.com/articles/14142); [Hostler 2001 via EQ4](equipment-aware-progression.md); [Alpha Progression](https://alphaprogression.com/en/blog/alpha-progression-guide); prediction from the Nuzzo table in §2 (inference) |
| SS8 | **Realistic pace.** For planning and sanity checks, an intermediate's e1RM rises about **0.5%/wk upper, 1%/wk lower**. That matches 5/3/1's training-max increments (+5 lb upper / +10 lb lower per 4-week cycle ≈ 0.55%/wk and 0.9%/wk at Ben's training maxes). Long-term competitive data suggest slower (Latella 2020). Push is at most 1.5× that, Maintain 0. Top-set *load* may rise ~1.5–2.5%/wk inside a block **only because reps fall**. The plan never assumes gains; they arrive through logged sets (SS9). | Plan effort defaults; coach number checks | Practice | [5/3/1 via Lift Vault](https://liftvault.com/programs/strength/jim-wendlers-531-spreadsheet/); [Latella 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7448836/) (context only) |
| SS9 | **Next week follows what was lifted.** e1RM update (qualifying sets: top or back-off, 1–10 reps; not warm-ups, drops, myo-reps or pain-flagged sets): it **rises** only on reps achieved above plan (computed at the planned RPE) or after ≥ 2 sessions in a row rated ≤ plan − 2. A single rating never raises it (rule 4). It falls only after 2 lower sessions in a row. Then: **reps hit at ≤ planned RPE** → next week as planned; if rated ≤ plan − 2 once, the coach may offer more (rule 6). **One rating ≥ plan + 1** → next week as planned (a single rating holds, never cuts; rule 4). **Two in a row ≥ plan + 1 at that load** → next week's load ≤ this week's (HT11). **Missed by 1 rep** → repeat this week. **One miss by ≥ 2** → a note; repeat or hold the load next week. **Two misses in a row** → rule 8 proposal: SS13's stage change or a 5–10% reset. | After each finished session | Practice (RTS, 5/3/1, Boostcamp) + Moderate (RPE ≈ ±1 rep) | [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/); [Boostcamp](https://www.boostcamp.app/features/auto-progression); HT7, HT11; rules 4, 6, 8 |
| SS10 | **Deload / test week.** **Deload:** sets about halved, reps at or below week 1's, RPE ≤ 7 (approved rule 10), load from e1RM (usually 0–10% below week 1). Same structure and exercises (top + 1 back-off, or fewer straight sets). **Test (optional):** top single @ RPE 9, or an AMRAP stopped at RPE 9 (P2) → new e1RM `est.` Placement: 4 wk none (reactive only, rule 10); 6 wk week 6; 8 wk week 8; 12 wk weeks 4, 8, 12. | Plan builder; replaces "−10%, −1 set" | Practice. Delphi consensus (21 coaches): reduce volume (sets, reps or days); effort may stay high or drop; load and length not agreed. Coleman 2024 (RP-funded; deload = complete cessation for a week) found no hypertrophy benefit and a possible small strength cost. No RCT tests reduced-volume deloads | [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/); [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/); [Pritchard 2016](https://pubmed.ncbi.nlm.nih.gov/26670988/); rule 10, HT12 |
| SS11 | **Accessories: reps then load on a fixed range** (HT9). Ranges by focus *(default)*: Strength 6–10, Balanced 8–12, Muscle 8–12 compounds / 12–20 isolation, Fitness 12–15. Effort RIR 3 → 1 across the block. +1 smallest step when every set reaches the top at ≤ planned RPE; reps go back to the range bottom. Above 12 reps, judge by reps, not RPE (rule 4). | Non-main slots | Moderate (rep or load progression both work; wide load range builds muscle) + Practice | [Plotkin 2022](https://peerj.com/articles/14142); [Schoenfeld 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/); [Robinson 2024](https://sportrxiv.org/index.php/server/preprint/view/295) |
| SS12 | **Time-savers, opt-in.** (a) Antagonist supersets (press + row, curl + triceps) are the first cut when a session is short; 60–90 s between paired exercises. (b) Drop set (last set to RPE 9–10, 1–2 drops of ~20–25%, each snapped, ending at the machine minimum) or myo-reps (activation set of 12–20 to RIR 0–1, then 3–5-rep mini-sets after 3–5 breaths, until 3 reps fail or 5 mini-sets): **last set of machine, cable or dumbbell isolation only**, never heavy barbell squat, bench or deadlift. Each series counts as 1 hard set (rule 1). Rule T ignores them. | Short sessions; Muscle/Balanced; Ben asks | Moderate (equal results, less time) / Weak (long-term supersets; rest-pause edge rests on 4 trials) + Practice (drop sizes, placement) | [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/); [Sødal 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10390395/); [Tsartsapakis 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12922048/); [Prestes 2019](https://pubmed.ncbi.nlm.nih.gov/28617715/) |
| SS13 | **Stall stages before resets.** After a rule 8 stall on a main lift, the first proposal keeps the load and splits the work: 3 × 5 → 5 × 3 → 6 × 2 (or clusters of 2–3 reps with 15–30 s between, 2–3 min between sets). Then a 5–10% reset. Always a proposal. | Rule 8 on a main lift | Practice (GZCLP, Texas Method) + Moderate (clusters ≈ traditional for strength and size) | [GZCLP](https://thefitness.wiki/routines/gzclp/); [Jukic 2021](https://cris.maastrichtuniversity.nl/en/publications/the-effects-of-set-structure-manipulation-on-chronic-adaptations-/); [Davies 2021](https://pubmed.ncbi.nlm.nih.gov/33475986/) |
| SS14 | **Structure options** (section 6) are chosen per plan, or per main lift, in the builder. Changing one mid-plan is a structural proposal (Apply/Undo). The app never swaps structure on its own or mid-session. | Plan builder, coach | n/a (guardrail) | CLAUDE.md rule 3 |
| SS15 | **Every set carries a role** (top, back-off, straight, drop, myo, cluster, AMRAP, test, deload), so rule T, HT10 and SS9 treat it correctly. Planned AMRAP, test, drop and myo sets never trigger rule T. Cluster mini-sets never count as "reps below range". | Logging and targets | Guardrail / Practice | rule T; HT10, HT13; [ADR 0031](../decisions/0031-exercise-performance-profile.md) |

**Guardrails (none overridden):**
- Every load is snapped down to the gym's equipment and never goes past the machine max (rule 4). A drop set ends at the machine minimum.
- A pain flag freezes every increase and every structure on that movement: steps, SS7 rep adds, AMRAPs, tests, drops and myo-reps (rule 9, HT12). Pain mentioned mid-series ends the series. The coach doesn't diagnose.
- e1RM, test results, predicted RPE and % figures are labelled `est.` (rule 6).
- Next-week loads from SS9 are the coach's or the built-in rule's *small* next-session changes (rule 3, D21). Structure, rep scheme, stage and reset changes are proposals.
- A single rating never raises or cuts future targets (rule 4); one bad session gets a note only (rule 8).
- Same-day changes stay with the approved rule 5/T thresholds. This file adds no new mid-session trigger.
- Working sets on compounds stay at RPE 7–9 (rule 3). Deload and warm-up sets are not working sets.

**Conflicts to flag (not resolved here):**
- **Plan builder.** SS3, SS5, SS7 and SS10 replace the flat %/week, fixed reps, fixed 90% × 8 back-offs and −10%/−1-set deload. This is a design change for Ben and the designer.
- **HT7 "+1 step" vs a planned block.** When the plan lowers reps next week, the load comes from the e1RM (HT4/HT6 translation), not "+1 step". HT6 currently covers only 1–2 rep changes in the same zone, so HT1/HT6 need wording for planned blocks (question 3).
- **Formula.** HT4 uses RIR-adjusted Epley. The worked examples below use Nuzzo's bench data, which gives about 3% lighter loads at 3–6 reps. Pick one (question 2).
- **Push + sets.** Whether choosing "Push" in the builder counts as Ben asking for more sets under rule 1 (question 4). With a lift trained 2×/week, an extra back-off each session would take weekly sets above V4's 3–6.
- **Fitness RPE 6.** Only if Ben approves D9.

---

## 1. Default main-lift prescription by focus and effort

Standard effort shown. Rows are *default* and editable. The % column is for the bench example in section 2.

| Focus | Main-lift structure | Top set (reps @ RPE, wk 1 → last build wk) | Back-offs | Sets | Typical %e1RM (est.) |
|---|---|---|---|---|---|
| Strength | Top set + back-offs | 5 @ 7 → 2–3 @ 8.5 | 2 × same reps, 1 RPE easier | 3 | ~80 → 91% |
| Balanced | Top set + back-offs | 6 @ 7 → 4 @ 8 (–8.5) | 2 × (top reps + 2), 0.5 RPE easier | 3 | ~78 → 86% |
| Muscle | Straight sets, reps then load | 3 × 6–10 @ RIR 3 → 1.5 (Push 1) | — | 3 | ~75 → 82% |
| Fitness | Straight sets, reps then load | 2–3 × 10–12 @ RPE 7 → 8 (RPE 6 start only if D9) | — | 2–3 | ~68 → 74% |

**Lift trained ≥ 2×/week** (rule 2 for Strength; also offered for Balanced): (a) *default* heavy day as above + volume day 3 × 8–10 @ RPE 7 (option D), or (b) the same week's prescription each session. Weekly hard sets per main lift 3–6 (V4).

| Effort | Change from Standard |
|---|---|
| Maintain | Top set + 1 back-off (or 2 straight sets). Hold week 1's reps and RPE ≤ 7.5. No wave, AMRAP or test. |
| Standard | As above. |
| Push | Last two build weeks +0.5 RPE (main lifts ≤ 9). An extra back-off only if Ben confirms it. |

Where it comes from: ACSM 2009 (strength progress in experienced lifters needs ≥ 80% 1RM; muscle mostly 6–12RM); Currier/ACSM 2026 (strength ≥ 80% for 2–3 sets, ≥ 2 sessions a week; RIR 2–3 mentioned as one option, no RIR target specified because the evidence is too thin); Schoenfeld 2021 and Lopez 2021 (wide load range builds muscle; heavy loads needed for 1RM); and Robinson 2024 (closeness to failure matters for muscle, barely for strength). The exact bands and set arrangement are **Practice**.

**Why the current back-off is wrong, and why the sources disagree.** The fixed 90% × 8 back-off ignores how hard the top set was. After 100 × 6, 90 kg × 8 is about RPE 8 if the top set was at failure (Nuzzo bench data). It is about RPE 6 if the top set was RPE 8 (Epley). One researcher called it "close to failure", another "too easy". Both are right for different top-set efforts. That is why SS4 works it out from reps and RPE.

## 2. Week-by-week profiles (worked bench examples)

**Method (inference).** Bench, e1RM 116 kg `est.` (from 100 × 6, assumed near failure). Plates in 2.5 kg steps, no microplates. Load = 116 × %(reps + RIR), snapped down. The % comes from a straight-line interpolation of Nuzzo 2024's bench means (≈ 4 / 8.8 / 14.1 reps to failure at 90 / 80 / 70%), with 1 rep = 100% as the upper anchor. Nuzzo was published online in Oct 2023 (Sports Med 54:303–321, 2024); main-model SD ≈ 2.5 reps at 80%.

| Reps to failure | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| % e1RM (bench, est.) | 93.3 | 90.0 | 87.9 | 85.8 | 83.8 | 81.7 | 79.6 | 77.7 | 75.8 | 73.9 | 72.0 |

"Plan" is the RPE the week asks for. "Pred." is the RPE the snapped load predicts from this table (est., ±1 rep for one person). Unless a table says otherwise, the e1RM stays at 116 (Ben makes each target exactly). That is deliberately conservative: real gains raise later weeks through SS9. Squat and leg lifts allow more reps at a given % (Nuzzo), so their tables would differ (question 2).

### 8 weeks, Strength, Standard (top set + 2 back-offs)

| Wk | Top set (plan / pred.) | Back-offs 2 × (plan / pred.) | Change |
|---|---|---|---|
| 1 | 92.5 × 5 (@ 7 / ~6) | 90 × 5 (@ 6 / ~5) | — (easy ramp-in: +1 rep would leave the 3–5 band) |
| 2 | 95 × 5 (@ 7.5 / ~7) | 92.5 × 5 (@ 6.5 / ~6) | load |
| 3 | 97.5 × 4 (@ 7.5 / ~7) | 95 × 4 (@ 6.5 / ~6) | load, reps down |
| 4 | 97.5 × **5** (@ 8 / ~8) | 95 × **5** (@ 7 / ~7) | SS7: computed 4 @ 8 snaps to 97.5 again, so +1 rep |
| 5 | 100 × **4** (@ 8 / ~8) | 97.5 × 4 (@ 7 / ~7) | load; SS7: 100 × 3 would predict ~7, so +1 rep |
| 6 | 102.5 × 3 (@ 8.5 / ~8) | 100 × 3 (@ 7.5 / ~7) | load, reps down |
| 7 | 105 × 2 (@ 8.5 / ~8) (Push: 107.5 × 2 @ 9 / ~9) | 102.5 × 2 (@ 7.5 / ~7) | load, reps down |
| 8 | **Deload:** top 90 × 5 + 1 back-off 87.5 × 5 (~RPE 4–5, est.). **Or test:** top single @ RPE 9 (≈ 110 est.) or 100 × AMRAP stopped at RPE 9 → new e1RM | | |

Predicted top-set RPE runs ~6 → 7 → 7 → 8 → 8 → 8 → 8, so the ramp never goes backwards (without the week 5 rep add, week 4 at ~8 would be harder than week 5 at ~7).

Compared with the current builder (inference, numbers from the tables above): the current builder (1.2%/wk, reps fixed at 6) raises load ~8.4% over 7 weeks. At fixed reps that needs ~8% real e1RM gain, against SS8's ~3.5% (0.5%/wk) for an intermediate bench. This block raises top-set load 13.5% (92.5 → 105) with no e1RM gain, because reps fall 5 → 2.

### 6 weeks, Balanced, Standard (lift trained 2×/week, option D)

Heavy day uses top set + 2 back-offs; volume day is 3 straight sets, reps then load (HT9), each day on its own history (D7). Weekly hard bench sets: 6 (V4: 3–6).

| Wk | Heavy day: top set (plan / pred.) | Heavy day: back-offs 2 × (plan / pred.) | Volume day 3 × (RPE 7) |
|---|---|---|---|
| 1 | 90 × 6 (@ 7 / ~6) | 85 × 8 (@ 6.5 / ~6) | 87.5 × 8 (~7) |
| 2 | 95 × 5 (@ 7.5 / ~7) | 90 × 7 (@ 7 / ~7) | +1 rep if all 3 sets were 8 at ≤ RPE 7, else repeat |
| 3 | 97.5 × 4 (@ 7.5 / ~7) | 90 × 6 (@ 7 / ~6) | reps then load: at 10 reps, +2.5 kg and back to 8 |
| 4 | 97.5 × **5** (@ 8 / ~8) | 90 × 7 (@ 7.5 / ~7) | as above |
| 5 | 100 × 4 (@ 8.5 / ~8) | 92.5 × 6 (@ 8 / ~7) | as above |
| 6 | **Deload:** top 90 × 5 + 1 back-off 87.5 × 5; volume day 2 × 85 × 8 (all ~RPE 4–6, est.). **Or test:** top single @ RPE 9 (≈ 110 est.) | | |

Week 4 is SS7 (4 @ 8 snaps back to 97.5, so +1 rep). Week 1 is easy because 6 @ 7 computes to 92.3 kg and snaps to 90; +1 rep would leave the 4–6 band. With the e1RM unchanged, the volume day mostly repeats 87.5 × 8: it moves only when the log shows gains. That is honest, not flat by rounding. With one bench day a week, drop the volume column (or use option (b)).

### 4 weeks, Strength (no planned deload; reactive only, rule 10)

| Wk | Top (plan / pred.) | Back-offs 2 × (pred.) |
|---|---|---|
| 1 | 92.5 × 5 (@ 7 / ~6) | 90 × 5 (~5) |
| 2 | 97.5 × 4 (@ 7.5 / ~7) | 95 × 4 (~6) |
| 3 | 100 × 4 (@ 8 / ~8; SS7 +1 rep on 100 × 3) | 97.5 × 4 (~7) |
| 4 | 102.5 × 3 (@ 8.5 / ~8), or a test (as week 8 above) | 100 × 3 (~7) |

### 6 weeks, Strength, 3-week wave (option C; fixed reps, so no SS7 rep add for easy weeks)

| Wk | Top (plan / pred.) | Back-offs 2 × (pred.) | Note |
|---|---|---|---|
| 1 | 95 × 5 (@ 7.5 / ~7) | 92.5 × 5 (~6) | wave 1 |
| 2 | 100 × 3 (@ 8 / ~7) | 97.5 × 3 (~6) | |
| 3 | 105 × 2 (@ 8.5 / ~8) | 102.5 × 2 (~7) | |
| 4 | 97.5 × 5 (~8 if e1RM unchanged) | 95 × 5 (~7) | wave 2 = wave 1 + 1 step, **only if** wave 1 was logged at or below plan RPE. Otherwise wave 1's loads + 1 rep (SS7) |
| 5 | 102.5 × 3 (~8) | 100 × 3 (~7) | |
| 6 | Deload or test | | |

### 8 weeks, Muscle (straight sets 3 × 6–10, reps then load, Standard cap RPE 8.5)

This table **assumes** SS8's pace (e1RM +0.5%/wk: 116 → ~119.5 by week 7), because straight sets at a fixed e1RM run out of room under the RPE 8.5 cap by about week 4. If the log shows no gain, SS9 holds the load and reps instead.

| Wk | Sets | Predicted RPE (est.) |
|---|---|---|
| 1 | 3 × 90 × 7 | ~7 |
| 2 | 3 × 90 × 8 | ~7.5 |
| 3 | 3 × 92.5 × 7 | ~7.5 |
| 4 | 3 × 92.5 × 8 | ~8.5 |
| 5 | 3 × 95 × 7 | ~8.5 |
| 6 | 3 × 97.5 × 6 | ~8 |
| 7 | 3 × 97.5 × 6 (~8); Push: 3 × 97.5 × 7 (~9). +1 rep at Standard only if week 6 was logged ≤ RPE 7.5 | |
| 8 | Deload: 2 × 87.5 × 7 (~RPE 5–6) | |

Later sets may lose a rep. The weakest set sets the next target (HT9).

### 12 weeks, Balanced (3 × [3 build weeks + 1 deload])

| Block | Wk 1 (6 @ 7) | Wk 2 (5 @ 7.5) | Wk 3 (4 @ 8) | Wk 4 |
|---|---|---|---|---|
| 1 (e1RM 116) | 90 × 6 (pred. ~6); BO 2 × 85 × 8 | 95 × 5 (~7); BO 2 × 90 × 7 | 97.5 × 4 (~7; SS7 may make it × 5, ~8); BO 2 × 90 × 6 | Deload |
| 2 (e1RM 118.5, *assumed* from wk 3 log) | 92.5 × 6 (~6) | 97.5 × 5 (~7.5) | 100 × 4 (~7.5) | Deload |
| 3 (e1RM 121, *assumed*) | 95 × 6 (~6.5) | 100 × 5 (~7.5) | 102.5 × 4 (~7.5) | Test or deload |

The assumed e1RM gain is about 2% per block (≈ 0.5%/wk, SS8). If the log shows less, the block repeats at the same loads, with +1 rep where SS7 allows.

**Other options in 12 weeks:** two 6-week blocks, or heavy + volume days (option D, as in the 6-week table). For D, the heavy day follows the table above. The volume day is 3 × 8–10 @ RPE 7 from the same e1RM (start 87.5 × 8, ~7), using reps then load, each day on its own history (D7).

## 3. Plate jumps

- **The problem (inference).** On a 100 kg bench, the smallest step (2.5 kg) is 2.5%, which is about one rep (bench ≈ 2–2.5% per rep at 80–90%; Nuzzo 2024). A 1.2%/wk target that is snapped down therefore sits flat for 2 weeks, then jumps.
- **SS7 order.**
  1. Use microplates if the gym profile lists them (D6; EQ4, Hostler 2001, Weak).
  2. Otherwise keep the load and add 1 rep.
  3. Next week, take the full step and go back to the planned reps.
- **Bench example (SS7 mechanics only, not a realistic pace):** from a submaximal start, 92.5 × 6 → 92.5 × 7 → 95 × 6 → 95 × 7. With the e1RM unchanged, predicted RPE runs ~7 → 8 → 8 → 9 (est.), so the last step only happens if logged sets show a gain (SS8, SS9). Every week changes visibly.
- **Reps vs load** both work for size, with a small non-significant strength edge for load (Plotkin 2022: ~2 kg squat 1RM point estimate, CI includes reps).
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

SS9 in practice (planned 100 × 4 @ 8, week 5 of the 8-week Strength table; next week planned 102.5 × 3 @ 8.5):

| Logged | Next week |
|---|---|
| 100 × 5 (reps above plan) | e1RM rises (5 @ planned 8 → ≈ 119 est.) → 105 × 3 @ 8.5 |
| 100 × 4 @ 6 (≤ plan − 2), once | e1RM not raised by one rating (rule 4) → 102.5 × 3 as planned; the coach may offer more (rule 6). A second session in a row ≤ plan − 2 raises the e1RM |
| 100 × 4 @ 7–8.5 | as planned, 102.5 × 3 |
| 100 × 4 @ 9 (once) | as planned, 102.5 × 3; a second ≥ +1 in a row holds the load at 100 |
| 100 × 3 (missed by 1) | repeat 100 × 4 |
| 100 × 2 (missed by 2), once | note only (rule 8); repeat 100 × 4 or hold 100 |
| Second miss in a row | rule 8 proposal: 5 × 2 at 100 (SS13), or a reset to ~92.5 |

Same day: when the top set trips rule T (≥ plan + 1.5 RPE), the approved rule 5 offer applies to the back-offs. Helms 2018's protocol (±2% per 0.5 RPE; a missed rep = 1 RPE) supports rule 5's 2–4% per point (D22). Below the rule T threshold, back-offs stay as planned.

## 6. Structure options for the builder

| Option | One line | Suits | Default for |
|---|---|---|---|
| **A. Top set + back-offs** | One heavy set at target RPE, then 2 lighter sets; reps fall across the block | Intermediates who log RPE; Strength, Balanced | **Strength, Balanced** (1 exposure/week) |
| **B. Straight sets, reps then load** | Same load on every set; add reps to the top of the range, then a step | Everyone; simplest to log; DB/machine lifts | **Muscle, Fitness**, all accessories |
| **C. 3-week wave** | 5s / 3s / 2s (or 5-3-1) rising each week, repeat one step heavier, optional test | Strength, 2–4 days, 6/12-week plans | — |
| **D. Heavy + volume days** | Same lift twice a week: one heavy top-set day, one 3 × 8–10 day | Lift trained ≥ 2×/wk; Strength, Balanced | **Strength, Balanced when a lift is trained ≥ 2×/wk** (SS1) |
| **E. Reverse pyramid** | Heaviest set first, then ~10–15% lighter with ~2 more reps each set (e.g. 6–8 / 8–10 / 10–12) | Muscle/Balanced intermediates, short sessions | — |

Evidence: every option is **Practice** as a named scheme. That structures give similar results when volume and effort match is Moderate: clusters ≈ traditional (Jukic 2021, Davies 2021); [Angleri 2017](https://pubmed.ncbi.nlm.nih.gov/28130627/): crescent pyramid (light to heavy) ≈ traditional for strength and CSA in trained men. No trial was found on the reverse pyramid, so option E is Practice only (Andy Morgan, [RippedBody](https://rippedbody.com/reverse-pyramid-training/), commercial; he says it eventually stops giving enough stimulus for advanced lifters). Varying intensity across days or weeks has some support: Moesgaard 2022 favoured undulating over linear for 1RM, more so in trained lifters, while Harries 2015 found no difference. That makes option D a real alternative, not just a convenience. A strict 5/3/1 training-max version of C stays a named programme in [programmes.md](programmes.md) (P1–P3).

## 7. Open questions for Ben

1. Replace the flat %/week with SS3 + SS5 (reps + RPE per week, load from e1RM)? Keep "Linear (reps fixed)" as an option, or drop it?
2. One conversion formula: HT4's Epley (simpler; ~3% heavier at 3–6 reps), or exercise-specific tables based on Nuzzo (closer to the data; needs per-pattern tables)?
3. Should HT1/HT6/HT7 say that in a planned block the next load comes from the e1RM, not "+1 step"?
4. Does picking **Push** count as asking for an extra back-off (rule 1), or should it still ask? With a lift trained twice a week, that would take weekly sets above 6.
5. Default deload (SS10: about half the sets, RPE ≤ 7), or a test week at the end of 6/8/12-week plans?
6. Should option choice be per plan, or per main lift (SBS-style)?
7. Allow drop sets and myo-reps (SS12b) at all, or supersets only?
8. Should cluster sets go in the active-set UI (needs a 15–30 s intra-set timer), or only into SS13's "more sets of fewer reps"?
9. For a lift trained twice a week: heavy + volume days (default), or the same prescription each session?
10. Should the builder show the predicted RPE next to the planned one (e.g. behind a "Why?" tap, per the minimal-copy rule)?

## 8. Sources, interests and copyright

| Source | Type | Interest |
|---|---|---|
| [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212) | Meta-regression, reps vs %1RM (online Oct 2023; Sports Med 54:303–321, 2024) | Two authors previously at an equipment company (Vitruvian) |
| [ACSM 2009](https://sfu.ca/~ryand/kin343/ACSMresistance.pdf); [Currier/ACSM 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823) | Position stands (2026 full text partly paywalled) | None stated |
| [Schoenfeld 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/); [Lopez 2021](https://jyx.jyu.fi/handle/123456789/75929) | Review; network meta-analysis | None stated |
| [Robinson 2024](https://sportrxiv.org/index.php/server/preprint/view/295) (Sports Med 2024, doi 10.1007/s40279-024-02069-2); [Refalo 2023](https://openrepository.aut.ac.nz/items/78679612-6ff4-4d00-95d1-7920d072a760/full); [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/) | Meta-analyses (failure, RIR accuracy) | None stated |
| [Moesgaard 2022](https://pubmed.ncbi.nlm.nih.gov/35044672/) (via [sci-sport summary](https://sci-sport.com/en/effects-intensity-volume-periodization-strength-hypertrophy-238/)); [Williams 2017](https://www.springermedicine.com/comparison-of-periodized-and-non-periodized-resistance-training-/22255106); [Harries 2015](https://pubmed.ncbi.nlm.nih.gov/25268290/); [Grgic 2017](https://peerj.com/articles/3695) | Meta-analyses (periodisation; Grgic hypertrophy only) | None stated. Moesgaard subgroup figures (UP > LP ES 0.31; trained 0.61, beginners 0.06) are from a secondary summary |
| [Hickmott 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/); [Helms 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/); [Helms RPE-stop 2018](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full) | Meta-analysis; RCTs | Helms coaches and sells books (3DMJ) |
| [Plotkin 2022](https://peerj.com/articles/14142) | RCT, reps vs load progression | None stated |
| [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/); [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/); [Pritchard 2016](https://pubmed.ncbi.nlm.nih.gov/26670988/) | Delphi; RCT (full week off); interviews | Coleman funded by RP |
| [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/); [Sødal 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10390395/); [Tsartsapakis 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12922048/); [Prestes 2019](https://pubmed.ncbi.nlm.nih.gov/28617715/); [Jukic 2021](https://cris.maastrichtuniversity.nl/en/publications/the-effects-of-set-structure-manipulation-on-chronic-adaptations-/); [Davies 2021](https://pubmed.ncbi.nlm.nih.gov/33475986/); [Angleri 2017](https://pubmed.ncbi.nlm.nih.gov/28130627/) | Meta-analyses and trials (structures). Tsartsapakis reports inconsistent study counts (23 vs 24) | None stated |
| [Latella 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7448836/) | Observational (15 years of Australian powerlifting totals; kg/day, no upper/lower split). Context for SS8 only | None stated |
| [Reynolds 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf) | Prediction study (JSCR 20(3):584–592; 1RM prediction from 1/5/10/20RM; 5RM most accurate, ≤ 10 reps advised) | None stated |
| [5/3/1 via Lift Vault](https://liftvault.com/programs/strength/jim-wendlers-531-spreadsheet/); [GZCLP](https://thefitness.wiki/routines/gzclp/); [Juggernaut via Liftosaur](https://www.liftosaur.com/programs/juggernaut-method); [RP](https://rpstrength.com/blogs/articles/progressing-for-hypertrophy); [RippedBody](https://rippedbody.com/reverse-pyramid-training/); [Boostcamp](https://www.boostcamp.app/features/auto-progression); [Alpha Progression](https://alphaprogression.com/en/blog/alpha-progression-guide); [FitnessVolt](https://fitnessvolt.com/rpe-training/guides/backoff-sets-guide/) | Coaching practice and apps (secondary for paid books) | All commercial |

**Paid or not fully read:**
- Abstracts or summaries only: Moesgaard 2022, Robinson 2024, Halperin 2022, Davies 2021, Jukic 2021, Prestes 2019 and Reynolds 2006 (UNM PDF returned HTTP 503 to the reviewer on 2026-10-22; details from the search record).
- Paid books and manuals: *5/3/1 Forever*, *Juggernaut Method 2.0* and the RTS manuals.

Only summaries are held here. Ben can add his own copies to the library.

**Warm-ups:** nothing here conflicts with WU1–WU12 ([warm-up.md](warm-up.md)). Changing weekly reps feeds WU3/WU4 through R. The test single and the 2-rep weeks get the R ≤ 3 ladder, and back-offs aren't warm-ups.

## Reviewer notes

All 18 reviewer corrections (2026-10-22) were applied. Where the revision differs from the reviewer's exact wording, here is why:

- **1 (arithmetic).** Applied as worded. 1.2%/wk × 7 = 8.4% simple; compounded it is ~8.7%, which doesn't change the point.
- **3 (planned vs predicted RPE).** Predicted RPEs were recomputed from this file's own table, so a few differ slightly from the reviewer's (week 1: ~6.1 here vs 6.4; week 5: ~7.2 vs 7.1). The "+1 rep when predicted RPE drops ≥ 0.75" clause is limited to the focus's rep band and excluded for option C. Otherwise week 1 of Strength would become 92.5 × 6, outside 3–5, and the 5/3/2 wave would lose its shape.
- **5 (SS8).** Applied. Grade is now Practice only. Latella is kept as context, not support.
- **8 (periodisation).** Applied. I confirmed Moesgaard's UP > LP figures (ES 0.31; trained 0.61; beginners 0.06) and the overall periodised > non-periodised ES 0.31 only from a secondary summary (sci-sport), not the full text; PubMed wouldn't load. The reviewer's "periodised > non-periodised in trained participants only" isn't confirmed, so it isn't stated as fact here.
- **12 (Fitness).** Applied RPE 7 → 8. From this file's table, 10–12 reps @ RPE 7–8 is ~68–74% e1RM (est.), not the reviewer's ~66–72%. Reps to failure above 14 use a straight-line extrapolation below Nuzzo's 70% anchor.
- **13 (Muscle vs SS6).** Took the cap option: Muscle main lifts RPE 8.5 at Standard, 9 under Push, so SS6 is unchanged. The table wasn't fixed by repeating 90 × 8. Instead it now *assumes* SS8's 0.5%/wk, labelled, because at a fixed e1RM the cap makes straight sets hold from about week 4. Repeating weeks is the "flat" pattern Ben objected to, so that behaviour is stated rather than tabled.
- **14 (frequency).** Both of the reviewer's options were added. (a) heavy + volume day is marked *default*, and the choice is open question 9. The new 6-week Balanced table uses (a).
- **16 (Reynolds).** Moved to SS3. A search record confirms the paper's subject (JSCR 20(3):584–592; 5RM predicts best; ≤ 10 reps advised); the PDF wasn't re-read.
- **18 (deload).** Used the reviewer's loads (top 90 × 5 + 87.5 × 5). From this file's table, though, they predict ~RPE 4–5, not 5–6 (87.5 × 5 is ~75% with ~11 reps to failure). That is within SS10's RPE ≤ 7 cap, so the loads stand.
