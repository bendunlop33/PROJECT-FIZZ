# Earlier work in the same session: targets that account for it

**Summary (plain words, for Ben)**
1. You're right. When a muscle has already worked earlier in the session, as the main mover or as a helper, you get fewer reps on later exercises at the same weight. Studies show roughly 10–30% fewer reps when sets go to failure. Your sets stop short of failure, so expect about 1–2 reps fewer.
2. **Recommendation:** each target compares like with like. The app counts the sets each muscle has done so far today (full credit where it was a main mover, half where it helped). "Last time" for an exercise becomes the last time you did it after a **similar amount** of that work.
3. If no similar session exists (e.g. incline has only ever come first), the app keeps the weight and aims **1 rep lower** (2 after a lot of earlier work), marked `est.`. It never adds weight on that basis. After one session, the new order has its own history.
4. A rep drop caused by doing the exercise later never counts as a miss or a stall. The coach always sees "done so far today, by muscle" when it plans or adjusts sets.
5. No fixed "% off per set" rule. The evidence varies too much for that (rule 6). Pain still stops progression (rule 9).

*Library file with **candidate** rules SF1–SF9 (Coaching knowledge, CLAUDE.md rule 10). Nothing here is in the playbook until Ben approves it. Not medical advice: pain or injury stops progression on that movement and the coach suggests seeing a professional; it never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher on 2026-11-07; all sources checked 2026-11-07. Builds on [history-targets.md](history-targets.md) HT1/HT9/HT13 (candidates), approved rules 1, 4, 5, 7, 8/ST1–ST2 and E1's synergist counting.*

**Trigger.** Ben, 7 Nov 2026: *"if you're hitting a push session the coach should consider what you've already hit that day when making the set plan. It shouldn't just look at previous workouts' sets and reps, as I may have hit it secondary, which makes you weaker for the set."* His example: on Push A he does bench first and incline dumbbell press third. The incline "previous" comes from a session where incline was done first.

## Candidate playbook rules

Terms:
- **Earlier sets (P)** for an exercise today = for each of its *primary* muscles (catalogue), the hard sets that muscle has already done in this workout. A set counts **1** where the muscle was primary for the earlier exercise and **½** where it was secondary (same counting as E1 and rule 1). P is the highest value across the exercise's primary muscles.
- **Hard set** = as already defined (working sets at RPE ≥ 6 or unrated, per D18; warm-ups never count, WU1).
- **Context** of a logged exposure = its P at the time it was done (from that session's logged order), plus a tag if it was in a same-muscle superset.

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| SF1 | **Count earlier work by muscle.** For every exercise not yet started, code computes P from today's logged hard sets and the catalogue's primary and secondary muscles (1 if primary, ½ if secondary). It uses only this workout's sets. An earlier workout the same day is shown to the coach (SF7) but isn't added to P. Exercises with no catalogue muscles have P "unknown". | Every target for a pending set; every coach context build | Moderate (later exercises lose reps, more so with shared muscles) / Practice (the ½ weight, which matches E1) | [Simão 2012](https://read.qxmd.com/read/22292516/exercise-order-in-resistance-training); [Soares 2016](https://jssm.org/jssm-15-111.xml-Fulltext); [Behm 2021](https://pure.solent.ac.uk/en/publications/non-local-muscle-fatigue-effects-on-muscle-strength-power-and-end-2/); E1 |
| SF2 | **Like-for-like reference.** A past exposure is comparable only if its P is within **2 sets** (*default*) of today's P. This adds condition (f) to HT1. Same-muscle superset exposures are comparable only with same-muscle superset exposures (SF8). The newest comparable exposure wins, as HT1 already says. **Stale context:** if the comparable exposure is more than **28 days** (*default*) older than the newest exposure in another context, also work out SF3 from the newer one and use the **lower** load (as HT5 does for old zones). Exposures with unknown context (no order recorded, e.g. some imports) are used only when no known-context exposure exists. | Picking "last time" (HT1, rule 7's "same routine slot") | Practice (like-for-like comparison; Hevy's "same routine" option, rule 7's slot) + Moderate (order changes reps) | Rule 7; HT1, HT5; [Hevy help](https://help.hevyapp.com/hc/en-us/articles/34105442929943); [Simão 2012](https://read.qxmd.com/read/22292516/exercise-order-in-resistance-training) |
| SF3 | **No like-for-like history: a small, labelled cushion, never a bonus.** Use the newest exposure from another context. If today's P is **≥ 2 higher** than it was then, keep the load and aim **1 rep fewer** per set. If it's **≥ 5 higher**, aim **2 fewer**. **No load step this session** for that exercise, because there's no comparable reference to judge from. If the aim falls below the slot's range bottom, drop **one achievable load step** (snapped down) and aim at the range bottom. Label it `est.`. If today's P is **lower** (fresher), there's no upward adjustment; normal HT decisions apply. | HT1 found nothing comparable under SF2 | Weak (size of the drop: 10–33% fewer reps at failure in trials, smaller below failure) / Practice (1 rep = 1 RPE per rule 4; the 2/5 cut-offs) | [Simão 2012 Table I](https://paulogentil.com/pdf/Exercise%20Order%20in%20Resistance%20Training.pdf); [Spreuwenberg 2006](https://read.qxmd.com/read/16503673/influence-of-exercise-order-in-a-resistance-training-exercise-session); [Soares 2016](https://jssm.org/jssm-15-111.xml-Fulltext); [Morán-Navarro 2017](https://pubmed.ncbi.nlm.nih.gov/28965198/); rule 4 |
| SF4 | **No fixed percentage per earlier set.** No "−x% per set" factor is used anywhere: not in the built-in target, the coach's bounds or e1RM translations. The trials vary 3-fold, mostly test sets to failure and don't model rest between exercises. SF3's rep cushion plus rule T (the first set's logged RPE) do the correcting. | Always | Weak (magnitudes inconsistent) + guardrail (rule 6: no invented precision) | [Simão 2012](https://read.qxmd.com/read/22292516/exercise-order-in-resistance-training); [Trindade 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9022698); [Fitbod blog](https://fitbod.me/blog/should-you-care-about-your-workout-order-for-strength-training-what-1-5m-data-points-say/) |
| SF5 | **Progression and stalls compare like with like.** Step decisions (HT7, HT9, 7-F) read only comparable references (SF2). An exposure in another context is **skipped** by ST1 (miss stall), ST2 (no-progress stall), rule 8 and the block view, as deload weeks already are. It is neither a miss nor a new best. When SF3 planned the target, rule 5's "reps short by ≥ 2" compares against that adjusted plan. | Next-session targets, stall checks, weekly review | Practice (consistent with ST1's "comparable sessions") | ST1–ST3; rule 8; [frequency-and-volume-caps.md](frequency-and-volume-caps.md) |
| SF6 | **Today's order changes: recompute built-in targets only.** When Ben reorders, skips, swaps or adds an exercise today, code recomputes P and the **built-in** targets of exercises not yet started (SF2/SF3), the same way warm-ups already follow "already warm" (WU2). Ben's typed values and coach targets he applied are never changed. If they now look off, the coach may *offer* ("Want me to adjust?"), per rule 3. Undo of the reorder restores the old targets. | Today-only edits before or during the workout | Practice + guardrails (rules 2, 3) | CLAUDE.md rules 2–3; WU2 |
| SF7 | **Coach context: "done so far today".** Each coach turn that plans or adjusts sets gets, as facts from code: (a) per muscle, hard sets so far in this workout split into direct (primary) and secondary; (b) for the exercise in question, today's P, the reference's P and date, and whether SF3 applied; (c) any earlier workout today, and any hard or long endurance session logged earlier today (endurance-switch data only, not converted into sets). The coach's set plan has to account for these facts, and its `Why?` names them in one line. Coach numbers are still checked by HT14's bounds, snapped to real loads and blocked by pain flags. | Coach plans, adjusts or explains a set plan (rule 3) | Practice + guardrails (rules 3, 4, 6, 9) | CLAUDE.md rules 3, 6; [concurrent-training.md](concurrent-training.md) C1 |
| SF8 | **Supersets and circuits.** Partner sets count towards P as they are logged. A **same-muscle** superset or circuit (partners share a primary muscle) is its own context: compare it only with the same kind (SF2). With no such history, SF3 applies counting P as if the partners were done straight. **Antagonist** or unrelated pairs (e.g. bench + row) count only by real overlap (often 0) and stay comparable with straight sets. | Supersets (SS12a), circuits | Moderate (same-muscle supersets cut volume; antagonist pairs keep it) | [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/); [Wallace 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6359665) |
| SF9 | **Guardrails unchanged.** SF never raises a load. On a pain-flagged movement, HT12's hold (≤ the most recent exposure in **any** context) wins over a higher like-for-like reference. Every load is snapped **down** to achievable equipment loads and stays within min/max (rule 4). Estimates show `est.` (rule 6). Completed sets are never edited (rule 2). Warm-ups, drop-set drops and cardio never add to P. | Always | Guardrail | CLAUDE.md rules 2, 4, 6, 9; HT12 |

### Conflicts and flags (for Ben and the PM; not resolved here)

1. **Builds on HT1, which is still a candidate.** SF2 adds condition (f) to HT1. If HT1 isn't approved first, SF2 instead refines approved rule 7's "same equipment and routine slot". Either way the wording of an approved rule (7, and D7) changes, so Ben needs to OK it explicitly.
2. **ST1/ST2 and rule 8 (approved 2 Nov).** SF5 adds "exposure in another context" to the list of sessions they skip. That's a wording change to approved rules.
3. **SF6 vs rule 3.** Built-in targets change on screen after Ben reorders. I read this as Ben's own action plus code arithmetic, as with warm-ups, not an unprompted coach change. Coach and typed values are untouched. PM to confirm.
4. **Data needed.** A context needs the logged order (or set timestamps) and catalogue muscles. It's derived at read time, so there's no migration and completed rows aren't rewritten (HT13). The developer should check whether the FitNotes import keeps within-day order. If it doesn't, imported exposures have unknown context (SF2).
5. **Endurance before lifting** isn't turned into sets (rule 6). It's a coach fact only (SF7c). The open warm-up flag about discounting lower-body rep shortfalls after a hard run (README conflict 13) is still open and is related.
6. **No guardrail overrides** (SF9).

---

## 1. Plain-words recommendation for Ben

Adopt SF1–SF9 as one package. In practice:
- "Last time" for incline after bench means **the last time you did incline after a similar amount of chest and shoulder work**.
- With no such session yet, the first time it's the same dumbbells for one rep fewer (`est.`). From then on it progresses from its own history.
- A lower number because you did it later doesn't count against you.
- The coach always knows what you've done so far today when it plans sets.

Why not a fixed "% lighter per earlier set": studies range from about 10% to 33% fewer reps depending on the muscles, the rest, how hard the sets were and the person. A fixed factor would look precise without being so. Your own logs from the same order will be better within one session.

## 2. What the evidence says

### Documented fact

**Later in a session → fewer reps at the same load (direction: Moderate; size: Weak).** There's no meta-analysis of the acute effect. Simão et al.'s narrative review (*Sports Med* 2012;42:251–265; 16 studies; [abstract](https://read.qxmd.com/read/22292516/exercise-order-in-resistance-training), [author-hosted PDF](https://paulogentil.com/pdf/Exercise%20Order%20in%20Resistance%20Training.pdf)) concludes that total reps and volume were greater "when an exercise was placed at the beginning of an RT session, irrespective of the relative amount of muscle mass involved". Figures from its Table I (sets to failure):

| Study | Load, rest | Exercise | Earlier position (reps per set) | Later position (reps per set) | Drop in total reps (my arithmetic) |
|---|---|---|---|---|---|
| Simão 2005 (recreationally trained) | 10RM, 2 min | Bench | 9.9, 9.7, 8.5 (1st) | 8.3, 6.9, 6.7 (last, after triceps ext, curl, shoulder press, pulldown) | −22% |
| Simão 2005 | as above | Biceps curl | 10, 10, 9.6 (2nd, after triceps ext) | 10, 9, 6.5 (4th, after pulldown) | −14% |
| Simão 2005 | as above | Triceps ext | 9.5, 9.9, 9.5 (1st) | 9.3, 7.9, 7.8 (last, after bench and shoulder press) | −13% |
| Simão 2005 | as above | Shoulder press | middle in both orders | no significant change | — |
| Simão 2007 (trained women) | 80% 1RM, 2 min | Bench | 10.2, 8.2, 6.7 (1st) | 6.7, 6.0, 5.3 (last, after legs, triceps ext, shoulder press) | −28% |
| Monteiro (cited in Simão 2012) | 10RM | Bench | 9.9, 9.9, 9.1 | 9.5, 8.6, 8.0 | −10% |
| Spreuwenberg 2006 (9 trained men) | 85% 1RM | Back squat, set 1 | 8.0 ± 1.9 (1st) | 5.4 ± 2.7 (after a whole-body session) | −33% (set 1) |

Note that the biggest drops came where earlier exercises shared muscles (curl after pulldown, triceps after bench and press). The shoulder press, in the middle of both orders, didn't change. Spreuwenberg: [abstract](https://read.qxmd.com/read/16503673/influence-of-exercise-order-in-a-resistance-training-exercise-session). RPE didn't differ between orders, so the fatigue shows up as fewer reps, not as a higher rating at the end of a set taken to failure.

**A helper muscle worked first costs reps on the compound (Weak; single trials).** Soares et al. 2016 (*J Sports Sci Med* 15:111–117; 14 trained men; [full text](https://jssm.org/jssm-15-111.xml-Fulltext)):
- One set of triceps pushdowns at 10RM before bench cut bench from **10 ± 0 to 8 ± 2 reps** at the same 10RM load (−20%, d = 1.41).
- Bench then pushdowns cut the pushdowns by the same amount.

Gentil 2007 and Augustsson 2003 (pec deck → bench; leg extension → leg press) found fewer reps on the second exercise too. They also found the helper muscles (e.g. triceps) took over more of the work ([Trindade 2022 narrative review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9022698); Simão 2012 Table II).

**Unrelated muscles matter much less (Moderate).** Behm et al. 2021 (*Sports Med* 51:1893–1907; meta-analysis, 278 effects; [record](https://pure.solent.ac.uk/en/publications/non-local-muscle-fatigue-effects-on-muscle-strength-power-and-end-2/)) found fatigue in other muscles had a trivial effect on strength (0.11) and power (−0.01), but a moderate, imprecise effect on endurance-type outcomes (−0.54). The authors conclude the findings "do not support the existence of a general NLMF effect". This is why SF1 counts shared muscles only.

**Rest between exercises helps, but fatigue lasts minutes, not seconds (Moderate).**
- Senna et al. ([2011](https://pubmed.ncbi.nlm.nih.gov/21993029/); [2016](https://read.qxmd.com/read/26907842/effect-of-different-interset-rest-intervals-on-performance-of-single-and-multijoint-exercises-with-near-maximal-loads)): bench reps fell from set 2 with 1-minute rests and from set 3 even with 3–5 minutes.
- Wallace et al. 2019 (*Sports* 7:14; 11 trained men; [full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC6359665)): flat then incline bench with no rest between them gave about 10–18% less volume load than with 3 minutes between exercises. Per-exercise reps weren't reported.
- Zhang 2025 (meta-analysis, in library): antagonist supersets keep volume, while same-muscle supersets reduce volume load ([PMC12011898](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/)).
- In Soares, 30 minutes between conditions restored 10RM performance after a single set. No study I found gives a usable decay curve over a normal session.

**Sets to failure leave more fatigue (Weak to Moderate).** Morán-Navarro et al. 2017 (*Eur J Appl Physiol* 117:2387–2399; 10 men; [PubMed](https://pubmed.ncbi.nlm.nih.gov/28965198/)): 3 × 10 to failure caused larger acute drops and slower recovery than volume-matched sets stopping halfway. Ben's sets are mostly at RPE 7–9, so his drop is likely smaller than the trials' (inference). That's why SF3 uses 1–2 reps.

**Long term, order hardly matters for growth (Moderate).** Nunes et al. 2021 (*Eur J Sport Sci* 21:149–157; meta-analysis, 11 studies; [PubMed](https://pubmed.ncbi.nlm.nih.gov/32077380/)):
- Hypertrophy: no effect of order (ES 0.03).
- Strength: no effect overall, though multi-joint strength favoured going first (ES 0.32), and strength gains were largest on whichever exercise came first.

So doing incline third is fine for muscle. It just needs a target that fits that position.

### Coaching and app practice (Practice; vendor statements)

- **Hevy:** a setting chooses whether the PREVIOUS column comes from "any workout" or the "same routine". Hevy says the latter compares performance more accurately. It's display only and doesn't change targets. Seen via search snippet; the help page returned 403 ([Hevy help](https://help.hevyapp.com/hc/en-us/articles/34105442929943)). Commercial.
- **Fitbod:**
  - Models per-muscle recovery *between* sessions (0–100%) and favours fresher muscles ([help section](https://help.fitbod.me/hc/en-us/sections/360001078993-Understanding-Fitbod-How-It-Works), snippet; 403).
  - Its help centre reportedly treats an RIR rating on a superset exercise "as if you performed the exercise fresh". That's the gap SF8 closes.
  - Its blog claims only ~4% weight difference between the 1st and 7th exercise in Fitbod-built sessions, from 1.5M sets. That's vendor data, confounded by Fitbod's own ordering ([blog](https://fitbod.me/blog/should-you-care-about-your-workout-order-for-strength-training-what-1-5m-data-points-say/), snippet; 403).
  - I found no documentation that Fitbod lowers a later exercise's target for same-session overlap.
- **JuggernautAI** (C. W. Smith; sells the app): set-to-set adjustment from RPE on main lifts, RIR on accessories, plus readiness and warm-up feedback ([help](https://help.jtsstrength.com/en/articles/3-how-juggernautai-is-individualized-to-you), snippet). This is autoregulation rather than order modelling. The app's rule T does the same job.
- **RP Hypertrophy app** (Israetel; commercial): exercises stay in fixed days and positions through a mesocycle, so each one progresses like for like by design (third-party review; RP's own pages not verified, [RP help](https://hypertrophy.zendesk.com/hc/en-us/articles/32430129362327)).
- **Coaches generally** (RTS, 5/3/1, GZCL tiers in [programmes.md](programmes.md)): accessories progress from their own history in a fixed slot, with effort targets (RPE/RIR) absorbing day-to-day fatigue. That's the same idea as SF2 plus rule T.

### Where sources disagree, and why

- **Size of the drop.** It ranges from −10% (Monteiro) to −33% (Spreuwenberg). The studies differ in how many earlier exercises shared muscles, the load (10RM vs 85%), the population (trained men, women, recreational) and the rest. All took sets to failure. Hence SF4: no fixed factor.
- **Fitbod's ~4%** vs the trials' 10–30%. Fitbod measures *weight chosen* in sessions it ordered to avoid overlap. The trials measure *reps at a fixed load* with deliberate overlap. They answer different questions.
- **Does position matter without overlap?** Simão's review says order matters "irrespective" of muscle size. Behm's meta-analysis says fatigue elsewhere barely affects strength. My reading is that the position effects in the order studies come mainly from shared muscles (see the curl and shoulder-press rows above). That's inference.

### My inference (not evidence)

- The ½ weight for secondary muscles reuses E1/rule 1 so there's one counting method. No trial tests ½ specifically.
- The 2-set window, the 2/5 cut-offs, the 28-day stale line and the 1–2 rep cushion are design choices. They're tied to rule 4 (1 RPE ≈ 1 rep): a 1-rep difference sits inside rating noise, so comparing within ~2 sets of earlier work is "close enough". Each is a *default*.
- Not modelling rest or time decay is deliberate (rule 6). Ben's sessions follow similar rest patterns, so like-for-like history already contains his typical rest.

## 3. Worked example: Push A

Assumptions:
- Catalogue: bench press is primary for chest and front delts, secondary for triceps. Incline dumbbell press is primary for chest and front delts, secondary for triceps.
- Dumbbell rack in 2 kg steps per dumbbell. Incline slot range 8–10 (HT9).
- History: incline has only ever been the first exercise, last time **30 kg × 9, 9, 9** at planned RPE 8 (P = 0).

**Today:** bench 3 working sets (warm-ups don't count), then an exercise with no chest or delt overlap, then incline.
1. **SF1:** chest P = 3, front delts P = 3, so P = 3. Triceps has 1.5 secondary, which isn't an incline primary.
2. **SF2:** the reference P is 0, a difference of 3 (> 2), so it isn't comparable. There's no other incline history.
3. **SF3:** the difference is ≥ 2 and < 5, so keep 30 kg and aim **1 rep fewer**: **30 kg × 8, 8, 8 `est.`** at RPE 8. 8 is the range bottom, so no load drop. There's no load step this session.
   - Without SF, HT9 would have planned **30 kg × 9–10** (aim 10) off a fresh-first history. That's likely RPE 9–10 after bench.
4. **`Why?`** (one line): `After 3 chest sets today; last time first: 30 × 9 → 8 est.`
5. **During the set:** if the first set still logs RPE 10 or 6 reps, rule 5/T offers as usual (−5–10% or fewer reps). If it's RPE ≤ 6, rule 6 offers more. Nothing applies without Ben.
6. **Ben logs 30 × 9, 9, 8.** This becomes incline's **after-bench reference** (P = 3). It isn't a miss and isn't compared with the fresh 30 × 9s (SF5).
7. **Next Push A** (same order): the reference is now like for like, so HT9 runs normally: **30 kg × 9, aim to get all three sets to 9**, then 10s. A 32 kg step (+6.7%) needs banked reps (rule 7 step 3).
8. **A day Ben does incline first** (P = 0) still uses the fresh-first 30 × 9 history, with its own progression. The two contexts progress separately, as heavy and volume days do under D7.

**Variants**
- **Bench 3 + overhead press 3 before incline:** front delts P = 6, so P = 6 (≥ 5) and the aim is −2 reps → 7, which is below the range bottom of 8. Drop one step: **28 kg × 8 `est.`** (snapped down).
- **Bench and incline as a same-muscle superset:** its own context (SF8). With no history, use P as if done straight, so the first time is the same as above.
- **Ben moves incline to first today** (SF6): P = 0, so the built-in target returns to 30 × 9–10 from the fresh history. If he'd typed 30 × 8 himself, that stays.
- **Pain flag on pressing** (SF9, HT12): no step in any context, and the load is ≤ the most recent incline exposure, whatever the order.

## 4. What changes in the app (for the PM and developer; no code edited)

- **Domain (`packages/domain`):** a pure function, `earlierSetsByMuscle(todaySets, catalogue) → { muscle: { direct, secondary } }`, and P per pending exercise. Hard-set definition and warm-up exclusion are reused from the volume code (D18, WU1).
- **Reference pick (HT1 / ADR 0031):** each exposure carries a read-time `context = { p, sameMuscleSuperset, known }`, derived from the logged order of that session. Comparable means |Δp| ≤ 2 and the same superset kind. SF3's cushion feeds the per-set basis (HT15: `adjustments: ["earlier-work −1 rep"]`).
- **Stall and progression checks:** the shared ST2 function skips other-context exposures.
- **Today edits:** reorder, skip, swap and add recompute built-in targets for unstarted exercises (SF6). Coach and typed values are untouched.
- **Coach context (`packages/coach`):** a "done so far today" block by muscle (direct and secondary), plus the reference's context and date for the exercise being planned, and earlier same-day workouts and endurance sessions as facts.
- **UI:** numbers only. `est.` inline when SF3 applied. The one-line reason sits behind `Why?`. No explanatory copy (UI rule).
- **Data:** no migration, and completed rows are never rewritten. Needs the catalogue's primary and secondary muscles (`primaryMuscles` / optional `secondaryMuscles`, already in `packages/schemas/src/exercise.ts`) and the logged order or timestamps (check the FitNotes import). Exercises without `secondaryMuscles` count only their primaries.

## 5. Open questions for Ben

None need a choice from you beyond **approve SF1–SF9 as recommended**. The defaults you could change later are:
- the 2-set window;
- the −1/−2 rep cushion at 2/5 earlier sets;
- the 28-day stale line.

## Sources (checked 2026-11-07)

| Source | Type | Commercial interest | URL |
|---|---|---|---|
| Simão, de Salles, Figueiredo, Dias, Willardson 2012, *Sports Med* 42:251–265 | Narrative review (16 studies) | None stated | <https://read.qxmd.com/read/22292516/exercise-order-in-resistance-training>; PDF (author-hosted; publisher copyright) <https://paulogentil.com/pdf/Exercise%20Order%20in%20Resistance%20Training.pdf> |
| Nunes et al. 2021, *Eur J Sport Sci* 21:149–157 | Meta-analysis (11 studies) | None stated | <https://pubmed.ncbi.nlm.nih.gov/32077380/> |
| Soares et al. 2016, *J Sports Sci Med* 15:111–117 | Crossover trial (n = 14) | None stated | <https://jssm.org/jssm-15-111.xml-Fulltext> |
| Spreuwenberg et al. 2006, *JSCR* 20:141–144 | Crossover trial (n = 9) | None stated | <https://read.qxmd.com/read/16503673/influence-of-exercise-order-in-a-resistance-training-exercise-session> |
| Trindade et al. 2022, *Int J Exerc Sci* 15:507–525 | Narrative review (pre-exhaustion) | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC9022698> |
| Behm et al. 2021, *Sports Med* 51:1893–1907 | Meta-analysis (non-local fatigue) | None stated | <https://pure.solent.ac.uk/en/publications/non-local-muscle-fatigue-effects-on-muscle-strength-power-and-end-2/> |
| Wallace et al. 2019, *Sports* 7:14 | Crossover trial (n = 11) | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC6359665> |
| Senna et al. 2011; 2016 | Trials (rest intervals) | None stated | <https://pubmed.ncbi.nlm.nih.gov/21993029/>; <https://read.qxmd.com/read/26907842/effect-of-different-interset-rest-intervals-on-performance-of-single-and-multijoint-exercises-with-near-maximal-loads> |
| Morán-Navarro et al. 2017, *Eur J Appl Physiol* 117:2387–2399 | Trial (n = 10) | None stated | <https://pubmed.ncbi.nlm.nih.gov/28965198/> |
| Zhang et al. 2025 | Meta-analysis (supersets) | None stated | <https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/> |
| Hevy help centre | Vendor documentation (snippet; page 403) | Yes (app) | <https://help.hevyapp.com/hc/en-us/articles/34105442929943> |
| Fitbod help and blog | Vendor documentation and vendor data (snippets; pages 403) | Yes (app) | <https://help.fitbod.me/hc/en-us/sections/360001078993-Understanding-Fitbod-How-It-Works>; <https://fitbod.me/blog/should-you-care-about-your-workout-order-for-strength-training-what-1-5m-data-points-say/> |
| JuggernautAI help | Vendor documentation (snippet) | Yes (app, books) | <https://help.jtsstrength.com/en/articles/3-how-juggernautai-is-individualized-to-you> |
| RP Hypertrophy help | Vendor documentation (snippet; not verified) | Yes (app, books) | <https://hypertrophy.zendesk.com/hc/en-us/articles/32430129362327> |

**Copyright and availability.** Summaries and short quotes only. Read in full: Soares 2016, Wallace 2019 and Trindade 2022 (open access), and the Simão 2012 review via an author-hosted copy that carries the publisher's copyright notice; only its table figures are summarised here. Abstract or record only: Nunes 2021, Behm 2021, Spreuwenberg 2006, Senna, Morán-Navarro. Paid or paywalled: the journal versions of Nunes 2021, Behm 2021 and Simão 2012, Gentil 2007 and Augustsson 2003. Ben could add his own copies to the library.
