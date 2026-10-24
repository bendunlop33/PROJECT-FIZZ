# Warm-ups by goal: warm-up sets, general warm-up, stretching, lifting after a run

**Summary**
1. The useful part of a lifting warm-up is a few sets of the lift itself that get heavier, ending with a few easy reps at about 70–85% of the first working load.
2. No study compares warm-ups by goal: the goal changes warm-ups only through the first working set's reps and load (heavy sets of 1–6 get a 3–5 step ladder, sets of 7+ get 1–2 steps, an already-warm muscle gets 0–1) and through the run-before rule.
3. Easy cardio first is optional and is cut first when time is short; static stretching under 30 s per muscle is harmless; the app never claims either prevents injury.
4. Proposed: code builds warm-ups from a table, within the approved 10-min warm-up allowance (D17); they never count, trigger offers or progress, and the coach changes them only when Ben asks.
5. Trigger case: rows 90 kg × 12, first pull of the day → **45 kg × 8, 70 kg × 5** (~2 min); already warm → **70 kg × 5**.

> **Approved by Ben, 22 Oct 2026: WU1–WU12 as drafted** ("look good", after a plain-English walk-through of each). They are now playbook rules; defaults marked *default* stay editable.

*Library file with **candidate** rules (Coaching knowledge, CLAUDE.md rule 10). Nothing here is in the playbook until Ben approves it. Not medical advice: pain or injury stops progression on that movement and the coach suggests seeing a professional; it never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher on 2026-10-21; revised the same day after a fact-check review (16 findings, all applied; see "Review log"). Sources checked 2026-10-21 unless stated.*

**Trigger:** the coach gave barbell rows (working 90 kg × 12) a warm-up of a single rep. No source supports that. The playbook has no warm-up rule yet; it only says warm-ups aren't working sets (rule 1 counting, rule T) and allows ~10 min for warm-ups (D17, default approved 9 Oct 2026).

## Candidate playbook rules

Proposed numbering **WU1–WU12**. Numbers marked *default* can be edited. "W" = the first working set's load, "R" = its target reps, both in the exercise's own load convention (total barbell, per dumbbell, stack, plate-loaded). For unilateral exercises, reps are **per side**. "%" always means % of W, never % of 1RM, so the app can compute it without an estimate.

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| WU1 | **What warm-ups are.** Warm-up sets are tagged `Warm-up`, come before the first working set, and are excluded from hard-set counts (rule 1), PBs, estimated 1RM, rule T triggers, 7-F history, stall detection (rule 8) and "performance holds". They never trigger an offer and never progress. Logged warm-ups are kept as logged and never silently changed (CLAUDE.md rule 2). | Always | Practice (already rule 1 counting, rule T) | playbook-v1 rules 1, T; StrongLifts; Hevy |
| WU2 | **Is the muscle already warm?** "Warmed" = earlier in today's session Ben logged a working set of an exercise with the **same catalogue primary muscle group or the same movement pattern** (squat, hinge, horizontal push/pull, vertical push/pull), or the exercise is a superset partner of one already started. Secondary muscles don't count. Cardio and running never warm a lifting pattern. Otherwise "not warmed". | Building each exercise's warm-ups | Practice (Weak mechanism: temperature decays within 15–30 min) | Fitbod; Israetel/RP; Bishop 2003; McGowan 2015 |
| WU3 | **Band.** Heavy band = R ≤ 6. Rep band = R ≥ 7. All goal profiles use the same tables; the goal acts only through R and W (and WU12's run-before rule). | Always | Practice (no trials by goal) | SBS (Wolf 2024); SS; StrengthLog; inference |
| WU4 | **Heavy band ladder** (main lift or heavy compound, not warmed). R 4–6: [bar × 5] → 40% × 5 → 60% × 3 → 80% × 2. R 1–3: [bar × 5] → 40% × 5 → 60% × 3 → 75% × 2 → 87.5% × 1 *(defaults)*. The bar step is included when it's a barbell lift that doesn't start from the floor and W ≥ 3 × bar weight. **Gap check, on snapped loads after WU8:** if any jump between steps (or from the last step to W) is > 25% of W, insert a step at the midpoint with the lighter step's reps, snap it, and re-apply WU8(b) and (e); max 6 steps. **Warmed:** 60% × 3 → 80% × 2 (+ 87.5% × 1 if R ≤ 3). | Main lift or heavy compound, R ≤ 6 | Practice (shape, counts) + Weak (heavy last step) | NSCA 1RM protocol (via HPRC); SS; 5/3/1; StrengthLog; StrongLifts; Ribeiro 2020 |
| WU5 | **Rep band, heavy compound** (main lift or heavy compound, R ≥ 7). Not warmed: 50% × 8 → 80% × 5 (R ≥ 10) or × 4 (R 7–9). Warmed: the 80% step only. | Main lift or heavy compound, R ≥ 7 | Weak (heavy last step) + Practice (light step) | Ribeiro 2020; Viveiros 2024 via Biolayne; SBS (Wolf 2024); Israetel/RP |
| WU6 | **Secondary compound** (e.g. dumbbell press, cable row, pulldown, lunge), and **machine compound with R ≤ 6** (e.g. hack squat, chest press; compound = catalogue pattern is squat, hinge, push or pull). Not warmed: R ≥ 10 → 80% × 5; R 7–9 → 80% × 4; R ≤ 6 → 60% × 3 → 80% × 2. Add 50% × 8 first only if it's the session's first exercise. Warmed: 0. | Secondary compound; machine compound R ≤ 6 | Practice + Weak (heavy step) | SBS; Fitbod; Alpha Progression; inference |
| WU7 | **Isolation and other machine work.** Not warmed: 1 step, 50% × 8. Warmed: 0. **Weighted bodyweight** (e.g. dips + 20 kg), not warmed: bodyweight only × min(5, ⌈R/2⌉). **Bodyweight or assisted compound** as the first exercise for its pattern with R ≤ 6: 1 step of the catalogue's easier variation (if available at this gym) × min(5, ⌈R/2⌉); otherwise 0. Other bodyweight/assisted: 0. **Cardio:** no warm-up sets (the first minutes are easy). **Plate-loaded machines:** % uses the sled-inclusive load when the gym profile records the sled weight; otherwise the plates-only load (warm-ups come out slightly light, accepted). | Isolation, machine, bodyweight, cardio | Practice | Fitbod; Alpha Progression; inference |
| WU8 | **Snapping.** Each step's load is snapped **down** to an achievable load on the selected gym's equipment (plates, rack, pin steps; CLAUDE.md rule 4). Then: (a) a step below the equipment minimum becomes the minimum; (b) steps that land on the same load merge, keeping the larger rep count (max 8); (c) the top step may not exceed 85% of W in the rep band or 90% in the heavy band, else the next load down; (d) in WU4/WU5, if the last step lands below 70% of W, use the next achievable load up if it stays within (c); (e) a step at or above W is dropped; (f) in a rep-band warm-up (WU5–WU7), a step before the top step that lands ≥ 60% of W is dropped. Then the WU4 gap check. If nothing is left, 0 warm-up sets. | Every generated or coach-edited warm-up | Guardrail (CLAUDE.md rule 4) + Practice | CLAUDE.md rule 4; Hevy; StrongLifts |
| WU9 | **Floor-start lifts** (deadlift variants, barbell row from the floor, power clean). No empty-bar step. The first step is the larger of its % load and the lightest load built with full-diameter plates, if the gym profile records plate diameters; if not, the % load is used and the coach may say "from blocks or the rack". WU8(f) then applies (rows: a 60 kg plates-on start at W 90 is dropped). | Floor-start barbell lifts | Practice (deadlift: SS); row inclusion is inference | SS; StrongLifts ("row starts heavier", no plates-on rule) |
| WU10 | **Don't tire Ben out.** Every step ≤ 8 reps; steps above 50% of W have ≤ max(R, 5) reps; ≤ 25 warm-up reps per exercise; each step should feel easy (about RPE ≤ 6). **1-rep steps only in the heavy band with R ≤ 3.** No separate potentiation sets or 6–10 min "PAP" waits. | Always | Weak (low-volume ramps cause little fatigue) + Weak–Moderate (one meta-analysis, low certainty: potentiation ≈ nothing after a full warm-up) + Practice | Blazevich & Babault 2019; Xu 2025; SS |
| WU11 | **Rest and time.** Rest 60 s *(default)* between warm-up steps; 2 min from the last warm-up to the first working set in the rep band, 3 min in the heavy band (within playbook rule 9, rest). **Warm-up time** per exercise = Σ(reps × 4 s) + 60 s × (steps − 1); the rest before the first working set is covered by D17's per-working-set time (inference). **Budget** = the D17 warm-up allowance for the whole session (10 min). If the session's warm-ups exceed it, cut in this order across the session, stopping once it fits: (1) the general warm-up (WU12); (2) WU6/WU7 steps, last exercise first; (3) the light step of WU5; (4) in WU4, drop the bar step, then use the short ladder 50% × 5 → 75% × 2 (R 4–6) or 50% × 5 → 70% × 3 → 85% × 1 (R ≤ 3). **Floors:** never below 2 steps on a not-warmed heavy-band lift, or 1 step on a not-warmed rep-band heavy compound. If the floors alone exceed the budget, the D17 budget formula drops working sets and this is noted once (behind `Why?`). | Session building | Practice | D17; playbook rule 1 budget; StrengthLog; Ribeiro 2020 (1 min / 3 min rests) |
| WU12 | **General warm-up and stretching.** Optional 3–5 min easy cardio or dynamic movement before the first exercise when it's a main lift or heavy compound (easy = can talk comfortably). Skipped if cardio or a run ended ≤ 30 min ago. Static stretching, if Ben wants it, ≤ 30 s per muscle, before the warm-up sets. The app and coach never present warming up or stretching as injury prevention, or as a fix for pain. | Session start | Practice (duration); Weak, conflicting (general warm-up); Strong (stretch dose); Strong (stretching doesn't prevent injury) | NSCA; Abad 2011; Neves 2024; Kay & Blazevich 2012; Behm 2016; Lauersen 2014; Boullosa 2026 |

**Behaviour rules that go with WU1–WU12 (candidates, same status):**
- **Who sets warm-ups.** Code generates them from WU2–WU11 by default, with or without the coach (works offline, rule 1). The coach changes warm-ups **only when Ben asks** ("more warm-ups", "just one"); Ben's explicit request for an achievable warm-up is honoured as asked. Coach-proposed warm-ups pass WU8 and WU10. If a coach-proposed warm-up for a not-warmed main lift or heavy compound fails WU8(d) or is below WU11's floor, code uses the table instead and records why. In the UI the replaced warm-up just shows the table's rows; the reason sits behind a `Why?` tap only (minimal-copy rule). The coach never raises warm-up changes on its own.
- **Pain.** A pain flag on a movement still blocks every increase for it (CLAUDE.md rule 9). Pain mentioned on a warm-up set opens the pain flow for that movement, like a working set, and today's working load is not raised. The coach doesn't suggest more warming up or stretching as a way to train through pain, and never diagnoses.
- **UI copy.** Warm-up rows show load × reps and a `Warm-up` tag only.

**Conflicts and flags (for Ben and the PM; not resolved here):**
- **None with the guardrails.** All loads are snapped down and never reach W (CLAUDE.md rule 4). Pain still stops progression (rule 9). Completed sets aren't changed (rule 2). Warm-ups don't touch the coach-chosen working targets (rule 3).
- **Validation fallback.** Code replacing a coach-proposed warm-up is a guardrail like snapping, not a change to rule 3. Ben decides whether he wants it or only a warning (question 2).
- **D17 is tight for two heavy lifts.** Squat 140 × 5 + bench 100 × 3 + rows + one isolation ≈ 14.5 min of warm-ups with a general warm-up; WU11's first three cuts bring it under 10 (example 7). D17's default is approved; changing it is Ben's call (question 3).
- **D18 and imports.** FitNotes has no warm-up column, so imported warm-ups arrive as working sets ([ADR 0016](../decisions/0016-fitnotes-import.md), research S6), and under D18 sets with no RPE count as hard ("approx."), which inflates weekly hard-set counts. No automatic reclassification is proposed (CLAUDE.md rules 6 and 8); see question 6.
- **Running before lifting.** Fewer lower-body reps for up to ~8 h after hard aerobic work. Telling rule T to discount that changes an approved rule, so it's only a question (question 4).
- **Category comes from the catalogue.** The catalogue must carry category, movement pattern, primary muscle, an easier variation (for WU7) and, for plate-loaded machines, whether the gym profile has the sled weight.

---

## Worked examples (inference from the rules above)

Assumed equipment: 20 kg barbell, plate pairs down to 1.25 kg (2.5 kg total steps), dumbbells in 1 kg steps up to 10 kg, leg press loaded in pairs. Real gyms differ; snapping uses the gym profile. Times exclude the rest before the first working set (WU11).

**1. Barbell row 90 kg × 12, Muscle goal, first pull of the session (the trigger).** Rep band, heavy compound, not warmed (WU5). Floor-start (WU9): no bar step.
- 50% = 45 kg × 8 (bar + 2 × 12.5 kg). If the 12.5s aren't full-diameter: pull from blocks or the rack, or the plates-on start (bar + 2 × 20 = 60 kg, 67% of W) is dropped by WU8(f), leaving the top step only.
- 80% = 72 kg → snapped down to **70 kg × 5** (78%, above the 70% floor).
- Result: **45 × 8, 70 × 5**, 60 s between, 2 min before 90 × 12. 13 reps, ≈ 2 min.
- After pulldowns or cable rows (same primary muscle, warmed): **70 × 5** only.
- Short on time: 70 × 5 only (WU11 cut 3).
- The coach's single rep breaks WU5, WU8(d) and WU11's floor, so it would be replaced by the table (if Ben approves the fallback).

**2. Back squat 140 kg × 5, Strength goal, first exercise.** Heavy band, R 4–6 (WU4). 140 ≥ 3 × 20, so the bar step is in.
- Bar 20 × 5 → 40% = 56 → **55 × 5** → 60% = 84 → **82.5 × 3** → 80% = 112 → **110 × 2**.
- Gap check on snapped loads: 35, 27.5, 27.5, then 30 to 140. None > 35 (25% of W), so no step is inserted. (Unsnapped, 56 − 20 = 36 would have inserted one; that's why the check runs after snapping.)
- 15 reps: 60 s + 3 × 60 s = **4.0 min**; with a 3-min general warm-up ≈ 7 min.
- Short on time: no general warm-up; then 70 × 5, 105 × 2 (~1.5 min).

**3. Bench press 100 kg × 3, Strength goal, after squats (push not warmed).** Heavy band, R ≤ 3 (WU4).
- Bar 20 × 5 → **40 × 5** → **60 × 3** → **75 × 2** → **87.5 × 1**. Gaps 20, 20, 15, 12.5, 12.5 (≤ 25).
- 16 reps ≈ 64 s + 4 × 60 s ≈ 5 min. The single is allowed only because R ≤ 3.
- Short on time: 50 × 5, 70 × 3, 85 × 1 (~2.5 min).

**4. Dumbbell lateral raise 10 kg × 15 (per dumbbell).** Isolation (WU7).
- First exercise for side delts: 50% = **5 kg × 8** (~0.5 min).
- After overhead pressing (same primary muscle, warmed): **0**.

**5. Leg press 200 kg × 10, after squats.** Knee-dominant pattern already warmed (WU2).
- Catalogue says heavy compound (WU5, warmed): 80% = **160 kg × 5**, 2 min, then 200 × 10.
- Catalogue says machine (WU7, warmed): **0**.

**6. Lifting after a run.** 30 min easy run, then squat 140 × 5 within 30 min.
- General warm-up: **none** (WU12). Squat warm-up sets unchanged (running doesn't warm the squat pattern, WU2). After a hard run, lower-body reps may fall short; see question 4.

**7. Session budget (WU11).** Strength day: squat 140 × 5, bench 100 × 3, row 90 × 12, lateral raise 10 × 15.
- General 3 + squat 4.0 + bench 5.1 + row 1.9 + raise 0.5 ≈ **14.5 min**, over D17's 10.
- Cut 1 (general) → 11.5. Cut 2 (raise step) → 10.9. Cut 3 (row's light step; 70 × 5 stays) → **9.4 min**. Fits, so cut 4 isn't needed; working sets untouched.

---

## Evidence

Grades follow [README.md](README.md): **Strong** = consistent meta-analyses; **Moderate** = several trials; **Weak** = single studies or mechanism; **Practice** = coaching convention. Fact (what a source says), expert opinion and my inference are marked.

### Evidence table

| # | Claim | Grade | Sources (checked 2026-10-21) |
|---|---|---|---|
| 1 | Warming up improves performance in most measures, with little sign of harm (mostly non-lifting tasks). | Moderate | Fradkin 2010 MA; McCrary 2015 SR |
| 2 | A specific warm-up with a **heavier last set (~75–85% of the working load)** beats a light-only one for reps or bar speed. | Weak | Ribeiro 2020 (squat result post hoc only); Viveiros 2024 (primary text unread). Null: Souza 2024 |
| 3 | A specific warm-up beats none for set-1 bar speed. | Weak | Ribeiro 2021 JOMH |
| 4 | A light-only warm-up (~40%) is the least effective option. | Weak | Ribeiro 2020; Viveiros 2024 |
| 5 | Number of warm-up sets scales with the working load; 3–5 for heavy barbell work, 1–2 for rep work, 0–1 once warm. | Practice | SS; StrongLifts; StrengthLog; 5/3/1; NSCA 1RM protocol; SBS; Fitbod |
| 6 | Short, low-volume ramps don't cause fatigue that matters. | Weak (mechanism + 1 trial) | Blazevich & Babault 2019; Viveiros 2024 |
| 7 | Deliberate potentiation sets add ~nothing (ES ≈ 0.01) after a thorough warm-up. | Weak–Moderate (one MA, low certainty, high risk of bias) | Xu 2025; cf. Wilson 2013 |
| 8 | A general (cardio) warm-up raised leg-press 1RM in small studies; it didn't change submaximal reps or speed in others. | Weak, conflicting | Abad 2011; Barroso 2013 (unverified); Neves 2024 |
| 9 | Warmer muscle improves rate of force development and power, **not maximal force**. | Moderate | Wilson, Nunes & Blazevich 2025 MA (abstract) |
| 10 | Static stretching ≥ 60 s per muscle costs ~4–5% strength; < 30 s costs ~1% or nothing. | Strong | Kay & Blazevich 2012; Behm 2016 |
| 11 | Stretching doesn't prevent sports injury. No warm-up injury trials exist in lifters; lifting injury rates are low. | Strong (stretching); Weak (warm-ups); Moderate (epidemiology) | Lauersen 2014; Fradkin 2006; Boullosa 2026; Keogh & Winwood 2017; Aasa 2017 |
| 12 | Warm-up effects fade within ~15–30 min of stopping. | Weak (mechanism) | Bishop 2003; McGowan 2015 |
| 13 | Hard or long aerobic work reduces lower-body reps for up to ~8 h; upper body unaffected. | Weak–Moderate | Sporer & Wenger 2003; [concurrent-training.md](concurrent-training.md) |
| 14 | No source recommends a single 1-rep warm-up before a 12-rep working set. | Practice (absence across sources) | All of the above; inference |

### 1. Specific warm-up sets (documented fact)

- **Ribeiro, Neiva et al. 2020**, *IJERPH* 17:6882. Randomised crossover, n = 40 (14 squat, 26 bench), Smith machine, 3 × 6 at 80% 1RM. Warm-ups of 6 reps: 40% then 80% of the training load; 80% only; 40% only; 1 min between steps, 3 min before work. Bench: the two-step ramp gave more total work than 40%-only (ES 0.54). Squat: total work didn't differ; 80%-only's bar-speed advantage comes from post hoc tests after non-significant overall tests (p = .08 and .12). Weak. <https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980>
- **Viveiros et al. 2024.** n = 15 per Biolayne; journal unconfirmed (the earlier draft wrongly attributed "15 men" and the journal to SBS, which gives neither n nor p and doesn't name the study). One warm-up set at 40% of 10RM × 15, 60% × 10 or 80% × 5, then 3 sets to failure at 10RM; 80% × 5 reportedly gave the most total volume. Primary text not read. Weak. <https://biolayne.com/reps/issue-29/can-heavier-warm-up-sets-boost-your-training-performance/> (commercial); <https://www.strongerbyscience.com/heavier-warm-ups/> (Wolf, SBS, commercial). *Note:* the SBS article reports Ribeiro 2020 as 8 reps (the paper says 6) and Souza 2024 as positive (the authors say it wasn't).
- **Souza, … Gentil 2024**, *PeerJ* 12:e17347. All did 45% × 8, then 90% × 3, 45% × 6 or nothing; 3 sets to failure at 75% 1RM. Total reps 21 vs 19 vs 19 (p = .17; power 0.36). Set-1 difference only on post hoc testing (p = .04; overall per-set condition effect p = .10). Authors: it "did not potentiate subsequent performance enhancement over multiple sets." Weak. <https://pmc.ncbi.nlm.nih.gov/articles/PMC11243969/>
- **Ribeiro et al. 2021**, *J Men's Health* 17(4). 34 trained men: a specific warm-up beat **none** for set-1 bar speed (not a heavy-vs-light comparison). Weak. <https://article.imrpress.com/journal/JOMH/17/4/10.31083/jomh.2021.069/226-233%20JOMH2021041602.pdf>
- **Ribeiro et al. 2021 systematic review**, *Motricidade* (11 studies, no meta-analysis). Mixed; strength and reps seemed to improve when the specific warm-up approached maximal loads. Weak. <https://revistas.rcaap.pt/motricidade/article/view/21143> (503 on fetch; indexed abstract)
- **Abad et al. 2011**, *JSCR* 25(8):2242–5. n = 13; specific warm-up 50% × 8 then 70% × 3; adding 20 min cycling at 60% HRmax raised leg-press 1RM 8.4% (p = .002). Weak. <https://pubmed.ncbi.nlm.nih.gov/21544000/> (confirmed via the Europe PMC record)
- **Enes, … Schoenfeld 2025**, *Sports Med Health Sci*, doi 10.1016/j.smhs.2025.08.002: 1 vs 2 vs no warm-up sets before 10RM work. **Results not retrieved** (403). The most relevant trial for WU5/WU6; re-check once read. <https://rgu-repository.worktribe.com/output/2989564>
- **Not verified, not used:** Barroso 2013; Ribeiro AS 2014; a 2025 SportRxiv preprint cited by StrengthLog; a "Fortier" study.

**Disagreements.** Heavy vs light last step: Ribeiro 2020 (bench clearly; squat only post hoc) and Viveiros 2024 favour heavy; Souza 2024 was null (everyone had a 45% set first, longer gap, low power). Heavy is at least not worse, which is why WU5 keeps it (*inference*). No study links warm-up structure to long-term gains.

### 2. Potentiation and fatigue

- **Blazevich & Babault 2019**, *Front Physiol* 10:1359 (expert review): voluntary enhancement peaks ~6–10 min after a conditioning set, typically 1–5%, possibly largely a temperature effect; fatigue minor after low-volume conditioning. <https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2019.01359/full>
- **Xu, Blazevich et al. 2025**, *Sports Med* 55:977–1008: ES 0.30 vs control (prediction interval −0.38 to 0.97); ES 0.01 after a comprehensive warm-up; authors report "high risk of bias and low certainty". <https://ro.ecu.edu.au/ecuworks2022-2026/5865>
- **Wilson et al. 2013**, *JSCR*: ES 0.38 on power output; not about sets of 8–12. <https://pubmed.ncbi.nlm.nih.gov/22580978/>
- *Inference:* a separate potentiation block isn't worth the time; one heavy, low-rep last warm-up step gets most of the benefit (WU10).

### 3. General warm-up, temperature, stretching, injury

- **Fradkin, Zazryn & Smoliga 2010**, *JSCR* 24(1):140–8: improvement in 79% of measures. <https://pubmed.ncbi.nlm.nih.gov/19996770/>
- **McCrary, Ackermann & Halaki 2015**, *BJSM* 49(14):935–42: high-load dynamic warm-ups improve upper-body strength and power. <https://pubmed.ncbi.nlm.nih.gov/25694615/>
- **Wilson, Nunes & Blazevich 2025**, *J Sport Health Sci*: heat helps rate of force development and power, not maximal force. <https://lida.sport-iat.de/ta/Record/4096747?lng=en>
- **Neves, Neiva et al. 2024**, *Retos* 53: general + specific vs specific only, no differences (snippet only). <https://www.revistaretos.org/index.php/retos/article/view/101851>. Disagrees with Abad 2011, which measured 1RM after 20 min cycling; Neves measured submaximal speed.
- **NSCA** (practice): 5–10 min low-to-moderate cardio, then dynamic movement. <https://www.nsca.com/education/articles/kinetic-select/introduction-to-dynamic-warm-up/>. 3–5 min (WU12) is Practice, sized to D17.
- **Decay:** Bishop 2003 <https://pubmed.ncbi.nlm.nih.gov/12744717/>; McGowan 2015 <https://link.springer.com/article/10.1007/s00421-015-3294-6>
- **Kay & Blazevich 2012**, *MSSE* 44(1):154–64 (106 studies): < 30 s −1.1%, 30–45 s −1.9%, losses likely from 60 s. "Shorter durations of stretch (<60 s) can be performed in a preexercise routine without compromising maximal muscle performance." <https://ro.ecu.edu.au/ecuworks2012/623>
- **Behm, Blazevich, Kay & McHugh 2016**, *APNM* 41(1):1–11: ≥ 60 s −4.6% vs < 60 s −1.1%. <https://ro.ecu.edu.au/ecuworkspost2013/2642/>
- **Lauersen, Bertelsen & Andersen 2014**, *BJSM* 48(11):871–7: stretching RR 0.963 (n.s.); strength training RR 0.315. <https://bjsm.bmj.com/content/48/11/871>
- **Fradkin, Gabbe & Cameron 2006**: evidence "insufficient to endorse or discontinue" warm-ups for injury. <https://www.epistemonikos.org/en/documents/37c16cdbcfefc6931afc5fedccdc51fbbceb9cd6>
- **Boullosa, Blazevich et al. 2026**, *IJSPP* 21(9):982–995, Delphi (23 experts): general → specific → conditioning; "no support for acute injury protection". Expert opinion. <https://ro.ecu.edu.au/ecuworks2022-2026/9152>
- **Injury rates:** Keogh & Winwood 2017 <https://pubmed.ncbi.nlm.nih.gov/27707741/>; Aasa 2017 <https://bjsm.bmj.com/content/51/4/211>
- *Inference (CLAUDE.md rule 6):* justify warm-ups on performance and practice grounds only.

### 4. Lifting after a run

- **Sporer & Wenger 2003**, *JSCR* 17(4):638–44: 36 min of cycling cut leg-press reps at 4 h and 8 h, recovered by 24 h; bench unaffected. <https://dspace.library.uvic.ca/items/d9c6f404-d74b-453e-99b0-816a42a46e45>
- *Inference:* an easy run just before lifting replaces the general warm-up but not the lift-specific sets. No study found on warm-ups for concurrent runners specifically.

### 5. Practitioner programmes and apps (Practice)

| Source | Warm-up approach (summary) | Commercial interest | Verified how |
|---|---|---|---|
| Starting Strength (Rippetoe) | Empty bar × 5 × 2, then 3–5 even jumps; ≤ 5 reps, tapering to 2 or 1; deadlift starts with plates. <https://startingstrength.com/training/our-warm-up-is-a-warm-up> | Book, coaching | Page 403; snippets |
| 5/3/1 (Wendler) | 40/50/60% of the training max × 5/5/3. <https://liftvault.com/resources/531-calculator/> | Books (paid) | Third-party calculator |
| NSCA 1RM protocol | Light × 5–10; 3–5 reps heavier; 2–3 reps; then attempts. <https://www.hprc-online.org/articles/one-rep-max-for-strength> | Professional body | HPRC page |
| StrongLifts | Heavier load → more sets; jumps ≤ 20 kg; deadlift and row start heavier; warm-ups kept out of history. <https://support.stronglifts.com/article/87-how-to-warmup> | App | Support article |
| StrengthLog | 3–5 ramp sets, 45–90 s rests; rows 30/50/70/85%; lighter jumps for 10–12-rep work. <https://www.strengthlog.com/warm-up-before-lifting/> | App | Article |
| RP / Israetel | Short general warm-up; specific sets on the first lift only. <https://fitnessvolt.com/exercise-scientist-talk-warm-ups-rest-periods> | RP app | Secondary report |
| SBS (Wolf) | Heavier set is the key part; 1–2 sets when short on time or warm. <https://www.strongerbyscience.com/heavier-warm-ups/> | Programmes, MacroFactor | Article (study details misreported, see §1) |
| Hevy | Default 40% × 5, 60% × 5, 80% × 3, rounded to plates. <https://www.hevyapp.com/features/warm-up-set-calculator/> | App | Feature page |
| Fitbod | Automatic; weighted exercises only; first exercise per muscle group only. <https://help.fitbod.me/hc/en-us/articles/360006337634-Warm-Up-Sets> | App | 403; snippets |
| Alpha Progression | From exercise type, first-set reps, experience, available weights. <https://alphaprogression.com/en/glossary/specific-warmup> | App | Glossary page |
| JuggernautAI | Rates each warm-up and adjusts the day's top load. <https://www.jtsstrength.com/?p=685137> | App | Article |

*Inference:* these agree once load is accounted for: extra steps matter as the working set nears maximal; for 8–15-rep work 1–2 steps are enough.

## Open questions for Ben

1. **Approve WU1–WU12 and their defaults?** Or a simpler "rep band = 1 heavy step only" version. Should isolation get 0 warm-ups instead of 1? Bodyweight compounds (e.g. pull-ups ≤ 6 reps): one easier-variation set (WU7), or 0?
2. **Validation fallback:** if the coach proposes a warm-up below the minimum (like the 1-rep row), should code replace it with the table, or only warn?
3. **Time and general warm-up:** keep D17's approved 10 min for all warm-ups (with WU11's cuts), or allow 10 min + ~3–5 min per extra heavy (≤ 6-rep) main lift? Suggest 3–5 min easy cardio first, or show warm-up sets only?
4. **After a hard run:** should rule T hold off "too hard" offers for lower-body lifts within ~8 h of a hard run? (Changes an approved rule.)
5. **Warm-up as a readiness check** (JuggernautAI-style): if the last warm-up feels heavy, may the coach *offer* a lighter working load? Today warm-ups never trigger offers.
6. **Imported warm-ups (D18):** FitNotes imports carry no warm-up flag, so they count as hard sets. Should the import preview flag sets ≤ 60% of that day's top load on the exercise, logged before the first top-load set, as "likely warm-up?" for you to confirm? Nothing would be reclassified automatically.
7. **Gym profile:** add "full-diameter plates" (WU9) and the sled weight of plate-loaded machines (WU7)?
8. **Paid material:** add your own *Starting Strength*, *5/3/1 Forever*, Helms's *Muscle & Strength Pyramid: Training* or NSCA *Essentials* to check their warm-up chapters.

## Review log (2026-10-21)

All 16 review findings were applied; none rejected. Main changes: WU10 rep cap rewritten (no longer contradicts WU4/WU5); WU2 example fixed (deadlifts don't warm rows); gap check runs on snapped loads; WU11 time excludes the final rest and the budget is per session with an ordered cut list and floors; evidence row 2 regraded Weak with the Ribeiro 2020 post hoc caveat, Ribeiro 2021 JOMH moved to its own row, Viveiros attribution corrected, Xu 2025 regraded Weak–Moderate; goal clause removed from WU3; WU6 made deterministic; machine compounds, bodyweight compounds, plate-loaded machines and unilateral reps covered; WU8(f) drops a near-duplicate first step; row plates-on start marked inference; D18 import question added (confirmed from ADR 0016: imported sets are all working sets); "playbook rule 9 (rest)" clarified; questions merged. Also corrected: the draft called D17 "open", but Ben approved its default on 9 Oct 2026 (playbook-v1, "Decisions by Ben").
