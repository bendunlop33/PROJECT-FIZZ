# Equipment-aware progression (rewrite of shortlist rule 7)

*Training-researcher survey for Ben. All sources checked 2026-10-09; fact-checked and corrected the same day (log at the end). Not medical advice. Pain or injury: stop progressing that movement and see a professional (CLAUDE.md rule 9). Builds on [evidence-core.md](evidence-core.md) (E5–E8, E13).*

**Summary**
1. Adding reps or adding load both build muscle (Moderate). For strength, heavy loads (≥ ~80% 1RM) matter (Strong), but load *progression's* edge over rep progression is small and uncertain (Moderate). So goal and equipment can pick the lever.
2. A load step is really a % jump. ACSM 2009's "+2–10% after 1–2 reps over target on two consecutive sessions" is position-stand consensus that rests on one review (Weak/Practice). ACSM 2026 gives no number.
3. At the same effort, 1 rep ≈ 2–2.6 %1RM points, which is about 2.2–3.2% of the working load (Nuzzo 2024; Helms 2016) (Moderate). Requiring 1 rep per 2% before a big step is a cautious *inference* (Weak).
4. Microloading is only shown to be equal over 8 weeks (one study, n = 19). Apps and coaches switch to reps when the next weight is a big relative jump (Practice). Proposal: the coach picks the lever. The no-AI fallback checks reps on steps over 5% and caps load steps at 10%.

## Candidate playbook rules

All of these are candidates; Ben approves. None overrides a guardrail; EQ6 and EQ10 tighten them. The suggested condensed rule 7 is below the table.

| # | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| EQ1 | **Coach inputs.** Before changing load, reps or sets, the coach reads: (a) Ben's goal and how he's training (days/week, session length, other training that is planned, imported or reported); (b) the exercise's role and planned rep range/RPE; (c) the last ≥ 2 sessions of this exercise on the *same equipment and the same routine slot/rep scheme*, so a heavy day and a light day aren't mixed; (d) the **equipment step card**: current load, next achievable load up and down with % change, min/max, at-max flag, microplates/add-ons in the gym profile, unit and convention; (e) active pain flags; (f) what Ben asked or reported today. Achievable loads come from code (`getAchievableLoads`), never from the model. | Any progression or adjustment | Practice + guardrails (CLAUDE.md 3, 4, 6, 9) | [ADR 0006](../decisions/0006-coach-led-progression.md); [MacroFactor 390](https://help.macrofactorapp.com/en/articles/390-how-to-change-equipment-settings-to-simplify-weight-recommendations) |
| EQ2 | **Size steps in %, not kg.** State every load change in kg/lb *and* %. Normal increase: about 2–10% of the current load, typically 2–5% on main barbell lifts and the low end for small-muscle work. ACSM's trigger is 1–2 reps over target on *two consecutive* sessions. The app's double progression uses one session at the top of the range (common practice; see Disagreements). | Choosing a load increase | Weak/Practice (ACSM 2009 category B; its only citation is a narrative review). The 2–5% figure is Practice (consistent with NSCA increments). | [ACSM 2009 p. 690](https://sfu.ca/~ryand/kin343/ACSMresistance.pdf); [NSCA increments (secondary)](https://app.achievable.me/study/cscs/learn/program-design-for-resistance-training-training-frequency-exercise-order-and-training-load-and-repetitions) |
| EQ3 | **Reps check for bigger steps.** For a step of J% with J > 5%: take it only when every working set reached at least *rep-range minimum + ⌈J/2⌉* reps at or below the planned RPE. Otherwise progress reps first. Steps ≤ 5% use the normal qualification (all sets at the top of the range), so fixed-rep schemes (e.g. 5×5) aren't slowed. "2% per rep" is deliberately cautious: the research average is ≈ 2.2–3.2% of the working load per rep, with a large individual spread. | Load vs reps decision | Moderate (rep–%1RM relationship) / Weak (as a progression rule; inference) | [Nuzzo et al. 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212); [Helms et al. 2016](https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full); [Marzagão 2026](https://arxiv.org/abs/2603.17495) |
| EQ4 | **When the next step is too big** (fails EQ3 within the rep cap, or > 10%), don't jump by default. Offer one option that fits the goal and show "+X%": reps up to the cap; microplates/add-ons *if they're in the gym profile*; a heavier first set (today's sets: apply or offer per rule 3; future sessions: proposal); +1 set (future sessions: proposal, within the weekly-volume plan and session time); a unilateral or harder variant, or finer-step equipment (proposal); or the jump at a lower rep target. **If Ben asks for a specific achievable load, apply it with the % shown.** None of these apply to a movement with an active pain flag. | Coarse equipment: dumbbells, stacks, gyms without small plates, machine near max | Moderate (rep progression is viable) + Practice | [Plotkin et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/); [Chaves et al. 2024](https://europepmc.org/article/MED/38286426); [MacroFactor 392](https://help.macrofactorapp.com/en/articles/392-why-am-i-being-recommended-very-high-reps); [Contreras](https://bretcontreras.com/wp-content/uploads/10-Rules-of-Progressive-Overload.pdf); [Fitbod 2026](https://fitbod.me/blog/more-reps-or-more-weight-progressive-overload/) |
| EQ5 | **Goal picks the lever.** *Strength:* prefer load on the main lifts (microplates if available). Before a coarse step, add a rep (within ≤ ~8) or a set at the same load. *Muscle:* reps and load are equally good. Sets come from the weekly-volume rule (rule 1), not per exercise. *Maintain:* keep the load (intensity); fewer sets are fine. *General fitness:* progress slowly, reps first. *Other training alongside (running, cycling, classes):* progress as the goal says. Avoid adding lower-body sets near key endurance sessions (rules 11–12). Only in an *endurance-priority phase* or when a *named event is close*: keep loads and don't add sets (rule 13). *Short sessions:* never progress by adding sets. | Choosing the lever | Strong (≥ 80% 1RM for max strength); Moderate (reps ≈ load for hypertrophy; maintenance dose; little interference for most people); Practice (the mapping) | [Currier et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/); [Plotkin 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/); [Zourdos/SBS](https://www.strongerbyscience.com/progressive-overload/); [Spiering et al. 2021](https://europepmc.org/article/MED/33629972); [concurrent-training.md](concurrent-training.md) C1, C5 |
| EQ6 | **Rounding with direction.** Increases snap to the nearest achievable load; reductions and back-offs snap easier; nothing goes above the equipment max. After snapping, recompute the %. If the result is 0% or > 10%, don't apply it: switch to reps and say why. If it's larger than the coach intended but ≤ 10%, apply it (or offer it, per rule 3) with the real % shown in the guard note. | Every coach or fallback load | Practice + guardrail (CLAUDE.md 4) | [coach-adjustments §2.6](../design/coach-adjustments.md); `packages/domain/src/equipment.ts` |
| EQ7 | **Machines, cables, assisted, bodyweight.** Compare stack/cable numbers only on the same machine (pulley ratios and starting resistance differ). *Assisted:* less assistance = harder. % on effective load needs Ben's logged bodyweight; without it, move one assistance step and show "% unknown". This is the one place a step can exceed 10% unseen. *Weighted bodyweight:* add the smallest step. *Bodyweight only:* reps up to the cap, then propose a harder variant or added load. *At machine max:* reps up to the cap, then propose a unilateral version or substitute. | Non-barbell equipment | Practice + guardrails (CLAUDE.md 4, 6); Weak (variant progression) | [Lifespan cable ratio (commercial)](https://help.lifespanfitness.com.au/en-US/what-are-cable-ratio--how-much-weight-am-i-actually-pulling-on-your-cable-machines-600441); [Kotarsky et al. 2018](https://europepmc.org/article/MED/29466268); [Elitefts triple progression](https://elitefts.com/blogs/training/triple-progression-model) |
| EQ8 | **New gym or machine.** Machine/cable history doesn't transfer. The coach may estimate a starting load from free-weight history, labelled as an estimate, rounded easier and aiming at ≤ RPE 7 in the first session. The fallback restarts at "no comparable history". | Ben switches gym or equipment | Practice + rule 6; Moderate (strength is modality-specific) | [Haugen et al. 2023](https://europepmc.org/search?query=Haugen%20free-weight%20machine%202023); [MacroFactor 390](https://help.macrofactorapp.com/en/articles/390-how-to-change-equipment-settings-to-simplify-weight-recommendations) |
| EQ9 | **No-AI fallback ("Built-in rule (coach offline)").** Equipment-aware double progression (algorithm in §9): aim for +2.5%, snapped to an achievable load at least one step up. Reps check for steps > 5%. Never more than 10% where the % can be computed. Never changes sets. Otherwise one more rep per session up to the cap, then hold and explain. *Needs an ADR 0006 amendment:* the approved wording says "smallest achievable increment" and "reps or sets". | No AI available | Weak + Practice (the cap, threshold and constant are inference; double progression is common practice) | ACSM 2009; Nuzzo 2024; [evidence-core E8](evidence-core.md); [ADR 0006 amendment](../decisions/0006-coach-led-progression.md) |
| EQ10 | **Big-jump guard (for Ben to decide).** The validator adds a "Big jump: +X%" note to any increase > 10%. "Too easy" snapping may never round up past 10%: it offers reps instead. An explicit request from Ben for a specific achievable load is honoured, with the % shown. | Coach changes and proposals | Practice (inference) | [coach-adjustments §2.6](../design/coach-adjustments.md) |

**Suggested condensed rule 7 (revised):** *Progression follows Ben's goal and what this gym can load. When Ben asks or a clear signal warrants it, the coach picks load, reps, sets or a variant. It works from his goal and setup, the last ≥ 2 sessions of this exercise on this equipment in the same routine slot, the step card, pain flags and today's request. Load changes are stated in kg/lb and %. Normal increases are ~2–10% (typically 2–5% on main barbell lifts). A step over 5% needs every working set at ≥ range minimum + J/2 reps at or below the planned RPE; otherwise reps go up first. Steps over 10% are never applied by default or by rounding. The coach offers one option and shows "+X%"; Ben can still ask for the jump. Other training alongside doesn't stop progression by itself. Only an endurance-priority phase or a close event holds loads. With no AI, the labelled built-in rule is equipment-aware double progression (EQ9). Pain stops all increases for that movement; the coach suggests seeing a professional and never diagnoses.*

### Guardrail notes and findings for the PM (code read 2026-10-09, not executed)
- **The current built-in rule can propose very large jumps.** `builtInDefaultRule` sets `maxLoadJump: null`, so `nextHarderLoad` takes the next achievable step whatever its size: 10 → 12 kg dumbbells (+20%), 8 → 10 kg (+25%), a 20 → 25 kg stack pin (+25%). `maxLoadJump` is an absolute mass. A % cap, % aim, reps-per-% constant and reps-check threshold need a `ProgressionRule` schema change, a new rule version and an ADR (developer, not done here).
- **"Too easy" snapping can inflate jumps.** coach-adjustments §2.6 never rounds *below* the coach's number after "too easy". On a 2 kg-step rack, a coach's +5% (10.5 kg) becomes 12 kg (+20%). EQ6/EQ10 add a guard.
- **Heavy and light days of the same lift corrupt the fallback (worse than first reported).** `toHistorySessions` and `comparableSessions` match only on exercise, equipment, unit and convention, and `decidePrimary` uses the latest such session. Take squat heavy on Monday (3–6) and light on Thursday (8–12) on the same rack. For Thursday, Monday's 5-rep sets count as "below floor", so the fallback prescribes **Monday's heavy load for 8–12 reps** (`hold_after_miss`). For Monday, Thursday's 12-rep sets "hit the top", so it prescribes Thursday's light load + one step for 3–6 reps. This is more likely as days/week go up (rule 1 revised). Fix: match history on the routine slot or rule as well.
- **ADR 0006 amendment wording vs EQ9.** The amendment says the fallback "uses the smallest achievable increment and progresses reps or sets instead". Today's code uses +2.5 kg/5 lb nearest. EQ9 uses ~2.5% and never adds sets (consistent with README conflict 5). Ben/PM should pick one wording and amend the ADR.
- **No bodyweight in the schema.** % on assisted and weighted-bodyweight work can't be computed without inventing data (rule 6). An optional bodyweight entry would be *Your data* (rule 10). Open question.
- Pain still blocks every increase for that movement (rule 9), including harder variants and added sets. Completed sets are never edited, stale proposals are rejected, and future changes stay proposals (rules 2, 5).

---

## Details

### 1. Why the % matters: what common equipment actually allows

**Documented fact**
- ACSM 2009 position stand (Ratamess et al., MSSE 41:687–708, p. 690), evidence category B: apply "a 2–10% (lower percent for small muscle mass exercises, higher percent increase for large muscle mass exercises) increase in load" when the lifter can do the current workload for one to two reps over the desired number "on two consecutive training sessions". The only citation for this is ref. 68, Feigenbaum & Pollock 1999, a narrative review. Category B is defined as "RCT (limited body of data)". The stand also lists more reps, tempo, shorter rest and volume (2.5–5% increments, p. 688) as progression routes. <https://sfu.ca/~ryand/kin343/ACSMresistance.pdf> (checked 2026-10-09)
- ACSM 2026 overview of reviews (Phillips, Currier, Schoenfeld et al.; 137 systematic reviews) updates the 2009 stand. The public deck gives goal targets: strength ≥ 80% 1RM, 2–3 sets/session, ≥ 2 sessions/week; hypertrophy ≥ 10 sets/week. Its discussion slides say "Individualization is More Important Than Rigid Rules" and that machines vs free weights "did not consistently impact outcomes for the average healthy adult". **No increment number appears in the deck.** <https://acsm.org/wp-content/uploads/2026/03/Pronouncement-ppt-deck_resistance-training-ps.pdf> (checked 2026-10-09; full paper paywalled). Note: Currier co-authored both this and Currier 2023, so they aren't independent.
- NSCA textbook (Baechle & Earle), via a secondary study guide: the "2-for-2 rule" is 2+ reps over target on the last set in 2 consecutive sessions, then add load. Increments: upper body 1–2 kg (smaller/less trained) to 2–4 kg (larger/more trained); lower body 2–4 kg to 4–7 kg. <https://app.achievable.me/study/cscs/learn/program-design-for-resistance-training-training-frequency-exercise-order-and-training-load-and-repetitions> (secondary; textbook is paid; checked 2026-10-09)

**Worked examples (arithmetic only)**

| Equipment | Step | % jump |
|---|---|---|
| Barbell bench 80 kg, plates to 1.25 kg | 2.5 kg | 3.1% |
| Barbell overhead press 40 kg, smallest plate 2.5 kg | 5 kg | 12.5% |
| Same press with 1.25 kg plates / 0.5 kg fractionals | 2.5 / 1 kg | 6.25% / 2.5% |
| Dumbbells in 2 kg steps: 10→12 / 20→22 / 30→32 kg | 2 kg | 20% / 10% / 6.7% |
| Dumbbells in 2.5 kg steps: 10→12.5 kg | 2.5 kg | 25% |
| Stack in 5 kg pins: 20→25 / 50→55 kg | 5 kg | 25% / 10% |
| Same stack with a 2.5 kg add-on: 50→52.5 kg | 2.5 kg | 5% |
| Assisted pull-up, 80 kg person, assistance 40→35 kg | 5 kg | +12.5% effective (only computable with bodyweight) |

**The tension (inference):** ACSM wants the *smallest* % on small-muscle exercises, but those use the lightest loads, where fixed equipment steps give the *largest* %. With a 10% cap, 2 kg dumbbell steps allow load progression only from 20 kg up, and 5 kg pins only from 50 kg up.

### 2. How many reps a load step costs

**Documented fact**
- Nuzzo, Pinto, Nosaka & Steele (Sports Med 2024, online 2023; meta-regression of 269 studies, 952 tests, 7,289 people): mean reps to failure fall as %1RM rises along a curve: ~5 reps at 90%, ~15 at 70%. Bench ~4 / 9 / 14 and leg press ~9 / 13 / 19 at 90 / 80 / 70%. SD 2.51 reps at 80% and 4.36 at 60%. "Little influences of sex, age, or training status"; the exercise mattered. <https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212> (checked 2026-10-09)
- Helms, Cronin, Storey & Zourdos 2016 (SCJ 38(4):42–49), Table 2: RPE 8 runs from 91% (1 rep) to 73% (8 reps), about 2.6 %1RM points per rep. The authors say the chart is "based on the barbell back squat" and may change "with machine-based, single-joint, or upper-body exercises". Only three cells are measured (from Zourdos et al. 2016); the rest are estimates. <https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full> (PDF p. 45; checked 2026-10-09)
- Marzagão 2026 (arXiv preprint, not peer-reviewed; 303,494 near-failure sets from an unnamed consumer app; validated without measured 1RMs): "at light weights each additional repetition implies a larger fraction of maximal capacity". The author writes for Fitbod's blog, so a commercial interest is likely (inference). <https://arxiv.org/abs/2603.17495> (checked 2026-10-09)

**Inference (corrected):** the research slopes are in %1RM points. Relative to the *working* load, 1 rep ≈ 2.2–3.2% at 70–90% 1RM, and probably more at light absolute loads (Marzagão; Contreras's example below implies ~5%). So k = 2 (1 rep per 2% of working load) *overestimates* the reps a step costs. It's a cautious fallback default; k ≈ 2.5 is closer to the average. Individual spread is large (± 2.5 reps at 80%), so the coach should prefer Ben's own logged rep–load pairs and label any estimate (rule 6).

### 3. Load progression vs rep progression

**Documented fact**
- Plotkin et al. 2022 (PeerJ 10:e14142; 43 recruited, 38 completed, resistance-trained; 8 weeks; squat, leg extension, two calf raises; **all sets to momentary failure**): adding load within 8–12 reps vs adding reps at a fixed load gave similar hypertrophy. Rectus femoris thickness favoured REPS (preliminary). Squat 1RM: +21.8 vs +19.3 kg, with "differences of questionable practical significance". Rep progression "is particularly useful when greater loads may not be available". <https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/> (checked 2026-10-09)
- Chaves et al. 2024 (Int J Sports Med 45(7):504–510; 39 untrained, within-subject legs, 10 weeks, leg extension): load vs rep progression, 1RM 52.9→69.1 vs 51.7→66.8 kg, vastus lateralis CSA 21.3→23.5 vs 21.1→23.4 cm². No difference. <https://europepmc.org/article/MED/38286426> (abstract via Europe PMC; checked 2026-10-09)
- Currier et al. 2023 (BJSM network meta-analysis; 178 strength studies, 5,097 participants): "Higher-load (>80% of single repetition maximum) prescriptions maximised strength gains"; "all prescriptions comparably promoted muscle hypertrophy". **It does not compare load and rep progression.** <https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/> (checked 2026-10-09)

**Expert opinion**
- Zourdos (Stronger by Science; April 2024 MASS cover story; SBS sells MASS): load progression is "an essential and non-negotiable type of progression" for maximising 1RM. Hypertrophy allows "much more flexibility". When load can't go up, "it may be better to add an additional set or rep and then increase the load the following week". "Do not force progression every week." <https://www.strongerbyscience.com/progressive-overload/> (checked 2026-10-09)

**Observational / commercial**
- Fitbod blog (Marzagão for Fitbod, 28 Sept 2026; app logs; ~11k users for outcomes; not randomised): rep-first and weight-first users had similar e1RM gains (2.7% vs 3.0%). Users added reps more often when the next dumbbell/kettlebell was a proportionally larger jump (association, not causation). A 25% jump is "often too large to add cleanly". <https://fitbod.me/blog/more-reps-or-more-weight-progressive-overload/> (checked 2026-10-09)

**Disagreement:** for trained lifters chasing maximal strength, load progression may matter more (SBS opinion, Plotkin's non-significant edge). For hypertrophy, the trials show no difference. Both trials were short (8–10 weeks), Plotkin trained to failure, and neither tested coarse jumps directly. So EQ5 lets the goal pick the lever.

### 4. Microloading (small plates, add-ons)

- Hostler et al. 2001 (JSCR 15(1):86–91; n = 19 "short-term pretrained" men and women; bench and triceps press; 8 weeks): 0.22–0.44 kg increments were about as effective as traditional ones (2.2 kg bench, 1.1 kg triceps press). "Preliminary data" hinted traditional increments might work better over longer periods. Weak. <https://europepmc.org/article/MED/11708713> (abstract; checked 2026-10-09)
- Practice: lifting forums report presses stalling with 2.5 kg jumps. <https://startingstrength.com/resources/forum/general-programming/49826-microloading-minimum-useful-increments-post912104.html> (forum; Weak). Rippetoe's "The Correct Use of Fractional Plates" wasn't found: unverified.
- MacroFactor (commercial) "only recommends weights that match the equipment you indicate you have access to". Fractional plates produce odd loads such as 88.5 lb by design. <https://help.macrofactorapp.com/en/articles/390-how-to-change-equipment-settings-to-simplify-weight-recommendations> (checked 2026-10-09)

**Inference:** if Ben owns microplates or magnetic add-ons, they belong in the gym profile, and the coach then uses them automatically.

### 5. When to add sets (triple progression)

- **Practice:** Elitefts (Andrew Dykstra, 6 March 2025) describes progressing sets, then reps, then load, e.g. 3×3 → 5×5 over 9 weeks on a bodyweight push-up variant. He calls it "an excellent alternative for anyone with sparse equipment or only one heavier weight available". <https://elitefts.com/blogs/training/triple-progression-model> (checked 2026-10-09)
- **Evidence context:** hypertrophy rises with weekly sets with diminishing returns, while strength plateaus after a few sets (evidence-core §1; volume-by-frequency.md). Extra sets cost time and recovery.
- **Inference:** adding a set is a *weekly-volume* decision (rule 1 revised; README conflict 5), so the fallback never adds sets. The coach may offer a set for future sessions as a proposal when the goal is muscle, the weekly plan allows it and the session has time.

### 6. How other apps and coaches handle it (commercial practice)

| Source | Approach | Checked 2026-10-09 |
|---|---|---|
| RP Hypertrophy (RP Strength) | Raises weight "a few percentage points". If the next increment is too big (e.g. 10→15 lb dumbbells), it adds a rep per set instead. | [RP help](https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets): **HTTP 403; wording from a search summary only, unverified** |
| MacroFactor Workouts | Recommends only gym-profile loads. High reps when the jump is big (10→15 lb = 50% vs 100→105 lb = 5%). Fixes: heavier load at fewer reps, finer increments, or swap to a finer-resolution exercise (392). "Expand Rep Range" can suggest 100 lb × 9 instead of 105 × 8. A "Progression unavailable" warning appears when no load fits the rep range (305). | [305](https://help.macrofactorapp.com/en/articles/305-understanding-and-using-smart-progressions), [392](https://help.macrofactorapp.com/en/articles/392-why-am-i-being-recommended-very-high-reps) |
| Fitbod | Recommends double progression. Says a 25% jump is often too large. | [Fitbod blog](https://fitbod.me/blog/more-reps-or-more-weight-progressive-overload/) |
| Bret Contreras (coach; sells programmes), undated PDF | Light lifts (curls, lateral raises) should usually progress reps. "50 to 55 lb dumbbells is a 10% jump", "10 to 15 lb ... a 50% jump". Go from 10 reps to "a couple of sets of 20", then jump. That's an earned 50% jump after +10 reps. | [10 Rules PDF](https://bretcontreras.com/wp-content/uploads/10-Rules-of-Progressive-Overload.pdf) |

**Inference:** independent products and coaches converge on equipment-limited loads, reps when the jump is big, and a visible "can't progress within range" state. None publishes a threshold. Contreras accepts large jumps once enough reps are banked, so a *permanent* 10% cap is stricter than all of them.

### 7. Equipment-specific notes

- **Barbell / plate-loaded:** finest steps if small plates exist. Plate-loaded machines have sled/lever starting resistance not counted in "added plates", so a % computed on plates overstates the real jump. That errs cautious (inference; MacroFactor 390 mentions starting resistance).
- **Dumbbells (per hand):** compute % per dumbbell. Steps of 2–2.5 kg are > 10% below ~20–25 kg. Expect reps-first progression on most isolation and lighter compound work.
- **Weight stacks / cables:** the number shown is a stack reading. With a 2:1 pulley ratio, a 40 kg setting gives ~20 kg at the handle (manufacturer help page; commercial; no independent measurement found). Compare only on the same machine. With a fixed ratio the % change is the same. Add-ons (`addOns`) give half-steps.
- **Assisted machines:** harder = less assistance. With an 80 kg person, one 5 kg step at 40 kg assistance is +12.5% effective load. That can't be shown without Ben's bodyweight (rule 6).
- **Bodyweight / weighted bodyweight:** progress reps, then a harder variant or added load. Kotarsky et al. 2018 (JSCR 32(3):651–659; 23 moderately trained men; 4 weeks): progressive push-up variants raised bench 1RM similarly to bench training. Muscle thickness didn't change significantly in either group. Weak. <https://europepmc.org/article/MED/29466268>
- **Machine vs free weight:** Haugen et al. 2023 (BMC Sports Sci Med Rehabil; 13 studies, 1,016 participants): no difference in hypertrophy; "strength changes are specific to the training modality". **Inference:** swapping to a finer-increment machine or cable suits muscle goals more than strength-of-a-specific-lift goals. (Europe PMC record; DOAJ page returned 403; checked 2026-10-09)

### 8. Adapting to goal and how training is run (no special cases)

| Goal / setup | Preferred lever | Notes |
|---|---|---|
| Strength | Load on main lifts. A rep (≤ ~8) or +1 set at the same load before a coarse step | ≥ 80% 1RM (Strong; Currier, ACSM 2026). Set-or-rep-then-load: Zourdos (opinion) |
| Muscle | Reps or load, whichever the equipment allows more finely; weekly sets via rule 1 | Plotkin, Chaves (Moderate) |
| General fitness | Reps first, slow load steps | ACSM 2026: consistency over complexity (consensus) |
| Maintain | Hold load (intensity); fewer sets are fine | Spiering et al. 2021 (narrative review): younger adults kept strength and size up to 32 weeks with "1 session ... per week and 1 set per exercise" if load was kept. Older adults may need 2 sessions and 2–3 sets. <https://europepmc.org/article/MED/33629972> |
| Strength or muscle goal with other training alongside | Progress as the goal says; avoid adding leg sets in the 48 h before key endurance sessions | concurrent-training.md C1: little or no interference for most people (Moderate–Strong). Rules 11–12 |
| Endurance-priority phase, or a named event soon | Keep loads; don't add sets | Rule 13 / C5 (Moderate). Only uses training that is planned, imported or reported (rule 6) |
| Short sessions | Load or reps, never extra sets | Time cost (inference) |
| Same lift 2–3×/week | Progress each prescription on its own history | See the heavy/light-day finding above |

Expected pace (context): in a 2021 preprint of training records (Steele et al.; 14,690 people on a minimal-dose programme of one session/week, single sets to failure on six exercises), strength plateaued "around ~1 year". <https://sportrxiv.org/index.php/server/preprint/view/69>. Weak; it may not apply to higher-volume training. **Inference:** for a trained lifter, small % steps and patience matter more than any rule.

### 9. No-AI fallback algorithm (EQ9), corrected

Defaults (editable per rule): aim *p* = 2.5%; reps-per-% *k* = 2 (cautious; ≈ 2.5 is the research average); reps-check threshold 5%; cap 10%. Rep caps unchanged (main barbell 8, compound 12, isolation 15). History = same exercise, equipment *and routine slot/rule* (developer change).

1. **Pain flag active** → hold (`halted_pain`). Unchanged.
2. **Qualify** as now: every prescribed working set in the latest comparable session reached the top of the rep range at ≤ the RPE limit. Not qualified → existing hold / hold-after-miss / reduce (reductions snap easier, after ≥ 2 sessions).
3. **Candidate load** = the achievable load nearest to current × (1 + p), and at least the next harder achievable load. None harder → `at_max`: reps up to the cap, then hold and explain.
4. **J** = (candidate − current) / current × 100. *Assisted:* use effective load only if bodyweight is logged; otherwise allow one assistance step and show "% not checked: no bodyweight logged". *Weighted bodyweight:* only the smallest step.
5. **J > 10%** → no load increase. Target one more rep (max(lowest reps + 1, range top + 1)) at the same load, up to the cap. At the cap → hold ("ceiling"), naming the step and options: microplates/add-ons, a heavier first set, a variant, or ask the coach.
6. **J ≤ 5%** → increase to the candidate and target the full rep range (today's behaviour).
7. **5% < J ≤ 10%** → if every working set reached ≥ range min + ⌈J / k⌉ reps, increase to the candidate and target the full range. Otherwise target one more rep at the same load, up to the cap. If the cap is reached and the check still fails, hold ("ceiling") as in step 5.
8. **Explain** with the real step ("Next dumbbell is 12 kg, +20%: adding reps first"). Label: *Built-in rule (coach offline)*.

**Compared with today (corrected; the earlier "identical" claim was wrong):** the qualification is unchanged, and steps ≤ 5% still go up after one qualifying session. The kg chosen differs where 2.5% of the load rounds differently from +2.5 kg/5 lb. Heavier lifts get bigger steps (deadlift 180 → 185 kg instead of 182.5). Fractional plates give smaller ones (40 → 41 kg instead of 42.5). Coarse steps get reps first, or a hold, instead of +20–25% jumps.

**Worked examples (k = 2, p = 2.5%, threshold 5%, cap 10%)**

| Case | Outcome |
|---|---|
| Bench 80 kg, 3×6 (3–6), 1.25 kg plates | 82.5 (+3.1%) ≤ 5% → **82.5 kg × 3–6** |
| Squat 100 kg, fixed 5×5 (5–5), 1.25 kg plates | 102.5 (+2.5%) ≤ 5% → **102.5 × 5** (unchanged from today) |
| Deadlift 180 kg, 3–6, 1.25 kg plates | 184.5 → nearest 185 (+2.8%) → **185 × 3–6** (today: 182.5) |
| Overhead press 40 kg, 3×6, smallest plate 2.5 kg | 45 (+12.5%) > cap → 7, then 8 reps (cap) → **hold, ceiling**: "45 kg is +12.5%; add 1.25 kg plates to this gym or ask the coach" |
| Same press with 1.25 kg plates | 42.5 (+6.25%) needs ≥ 3 + 4 = 7 → 40 × 7 first, then **42.5 × 3–6** |
| DB incline 24 kg each, 3×10 (6–10), 2 kg steps | 26 (+8.3%) needs ≥ 6 + 5 = 11 → **24 × 11**, then 26 × 6–10 (with k = 2.5: jump straight away) |
| Lateral raise 8 kg each, 3×12 (8–12) | 10 kg = +25% > cap → reps to 15 → **hold, ceiling** (suggest a cable raise with add-on, or the coach) |
| Cable row 50 kg stack, 5 kg pins + 2.5 kg add-on, 3×10 (6–10) | 52.5 (+5%) ≤ 5% → **52.5 × 6–10** |
| Assisted pull-up, assistance 30 kg, 5 kg steps, no bodyweight | All sets at top → **25 kg assistance**, "% not checked" |

### 10. Coach decision procedure (guidance, not deterministic)

1. Guardrails first: pain flag (no increases of any kind for that movement; suggest a professional; no diagnosis), completed sets, equipment min/max. Code enforces these anyway.
2. Decide whether progress is warranted: a pattern over ≥ 2 sessions in the same routine slot, or one strong signal compared with the *planned* RPE (ADR 0006 amendment). Don't force progress every session.
3. Read the step card and compute J for the next achievable load.
4. Choose the lever by goal and setup (EQ5), then apply the reps check (EQ3) for steps > 5%.
5. If the step is too big, offer *one* EQ4 option and state the % ("Next dumbbell is +20%. Want to go for 11–12 reps at 24 kg first?"). If Ben asks for the jump, apply it with the % shown.
6. Mid-session "too easy" (E7): if the next step is > 10%, offer +1–2 reps rather than load. "Too hard" (E6): if the next easier load is > 10% lighter, keeping the load and cutting reps is often the better offer. If Ben mentions pain, use the pain flow (rule 9), not "too hard".
7. After snapping, recompute the %. If it's 0% or > 10%, switch to reps; otherwise show the real %.
8. Record the reason, lever, J and the evidence used (ADR 0006). Today's sets: apply with Undo when Ben asked; offer first when the coach raised it. Future sessions and templates: proposal with Apply/Undo.

### Disagreements and uncertainty
- **Reps-per-% constant:** population data give ≈ 2.2–3.2% of working load per rep at moderate loads (Nuzzo, Helms), probably more at light absolute loads (Marzagão preprint; Contreras ~5%). k = 2 is cautious and delays some jumps that would probably be fine.
- **10% cap vs earned big jumps:** ACSM's 2–10% is a typical range, not a ceiling. Contreras, MacroFactor ("heavier weight with fewer reps") and RP all eventually take bigger jumps on light dumbbells. A hard cap keeps the fallback safe, but light isolation work (dumbbells < 20 kg with 2 kg steps; stacks < 50 kg with 5 kg pins) will sit at the rep cap offline (open question 1).
- **One session vs two:** ACSM and NSCA wait for two consecutive sessions over target. The app's double progression (today and EQ9) moves after one session at the top of the range. That's common app/coach practice (Fitbod, RP), and the reps check covers bigger steps.
- **Microloading:** only shown equal short-term (Hostler, n = 19). Its benefit is practical.
- No trial has tested coarse vs fine increments on dumbbells or stacks directly. EQ3, EQ4 and EQ9 rest on the rep–load relationship plus converging practice.

### Copyright and availability
Only abstracts, open full texts, free help pages and short quotes are used. Paid or unread: NSCA *Essentials* (textbook), ACSM 2026 full paper (paywalled), Rippetoe's fractional-plates article (not found), RP help page (403). Ben can add his own copies to the app library.

### Fact-check log (2026-10-09)
Corrections made after re-reading every source:
- ACSM 2009's 2–10% downgraded from Moderate to Weak/Practice: one cited review; "two consecutive sessions" condition restored.
- Rep cost restated in % of working load (≈ 2.2–3.2% per rep, not 2–2.5%). k = 2 is labelled cautious.
- "Identical to today's rule" claim removed (wrong).
- Reps check limited to steps > 5% so fixed-rep schemes such as 5×5 aren't slowed.
- EQ6 no longer blocks ≤ 10% steps that are merely "more than double" the intent.
- EQ5 no longer holds loads for anyone who also runs, cycles or does classes (C1 shows little interference). Only endurance-priority phases or close events hold.
- Currier 2023 doesn't compare load vs rep progression; attribution fixed.
- Plotkin n = 38 completers, trained to failure.
- Steele is a 2021 minimal-dose preprint.
- ACSM 2026 and Currier share authors.
- MacroFactor article numbers fixed.
- Elitefts example is bodyweight.
- Spiering age caveat added.
- Heavy/light-day finding sharpened.
- ADR 0006 amendment mismatch flagged.
- Explicit-request and pain carve-outs added.
