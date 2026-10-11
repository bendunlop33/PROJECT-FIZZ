# Return to load: after a pain flag is cleared, and after a break

*Library file with **candidate** rules (Coaching knowledge, CLAUDE.md rule 10). Nothing here is in the playbook until Ben approves it. Not medical advice: pain or injury stops progression on that movement and the coach suggests seeing a physio or doctor; it never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher, sources checked 2026-10-11 unless stated.*

**Summary**
1. Breaks: strength losses grow with the length of the break (Strong), but strength is largely kept for about 3 weeks (Moderate) and comes back faster than it was first built (Moderate). No study tests *how much lighter* to start; every percentage below is coaching practice.
2. Proposed: a break counts from **14 days** without that exercise. Offer a lighter first session for **today only**: −10% (2–4 weeks), −20% (4–12 weeks), −40% (12+ weeks), same sets and reps, snapped down. Then climb back over about half the break in weeks, ≤ ~10% per step, only while reps are hit.
3. After a pain flag is cleared: no research gives a safe rate of return for a lifter without a clinician. Proposed (Practice): carry on from the flagged-period sets, at most one step back towards the pre-flag sets per session, ≤ ~10%, only after a session with no pain and all reps hit; reps and sets before load; never past the pre-flag sets by this route; always a proposal.
4. Any pain mention during either return stops it (rule 9). With no AI, the break offer runs as a labelled built-in rule; the pain return stays on 7-F's smallest steps (no jumps).
5. Two items need Ben and a PM/ADR note: a coach-raised offer at the start of a session (new prompt), and a built-in "return" step bigger than 7-F's smallest increment.

## Candidate playbook rules

Proposed numbering: **R1–R6** (return to load), to sit after rule 13 / G / T in playbook v1. Numbers marked *default* are editable.

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| R1 | **What counts as a break.** Gap = days since the last logged working set of this exercise on comparable equipment (rule 7 history). A gap of **≥ 14 days** *(default)* makes the exercise "returning". Today's hero line shows only when the whole workout's gap (days since any logged lifting session) is ≥ 14 days. Endurance sessions don't shorten the gap. | Building or starting a session; any exercise with a gap ≥ 14 days | Moderate (little strength loss up to ~3 weeks); Practice (14-day trigger) | McMaster 2013; Bosquet 2013; Ogasawara 2010/2013; Travis 2020 (via goal-adaptive.md) |
| R2 | **Lighter first session (today only).** Offer, for today only: **−10%** load for gaps of 14–27 days, **−20%** for 28–83 days, **−40%** for ≥ 84 days *(defaults)*, from the last comparable working load, snapped **down** to an achievable load. Same exercises, sets and reps; working sets aimed at RPE ≤ 7. Offer only, Apply/Undo; nothing changes if Ben ignores it. | R1 is true and Ben hasn't already lowered today's load | Strong (losses grow with gap length); Practice (the percentages) | Bosquet 2013; McMaster 2013; Nuckols/SBS 2022 (expert, commercial); StrongLifts app; Starting Strength (10% deload convention) |
| R3 | **Ramp back after a break.** After a lighter first session, return to the pre-break load over about **half the break in weeks** (at least 1 more session, at most 6 weeks) *(default)*. Equal steps, each **≤ ~10%**, snapped down; a step happens only if the last session hit every target rep at or below the planned RPE. The return route never goes above the pre-break load; normal progression (rule 7 / 7-F) resumes once it's reached. A miss holds the load. | Exercise is "returning" and Ben applied R2 (or chose his own lighter load) | Moderate (regaining is faster than first gains); Weak (the "half the gap" timing); Practice (≤ 10% steps) | Ogasawara 2013; Halonen 2024; Encarnação 2022; Nuckols/SBS 2022 |
| R4 | **After a pain flag is cleared.** Targets carry on from the sets logged while flagged (active-workout §2.14.3). Within the 8-week reference window, the coach may propose **one step per session** towards the `Before flag` sets: restore reps and sets first, then load; each load step is the next achievable increment or up to half the remaining gap, **capped at ~10%**, snapped down. Only after a session on that movement with **no pain mentioned and all target reps hit at or below the planned RPE**. Never above the `Before flag` sets by this route. Always a next-session **proposal** (Apply/Undo), never a D21 default. | Pain flag cleared by Ben in the last 8 weeks; Ben asks, or the post-workout review | Practice (no direct evidence for lifters); consensus supports graded, shared decisions (expert opinion) | Ardern 2016; Buist 2008; Impellizzeri 2020/21; active-workout §2.14.3 |
| R5 | **Pain during a return stops it.** Any pain mention on the movement during R3 or R4: the pain flow replaces any offer, progression stops (rule 9), and no return proposals are made until Ben clears a new flag. A second flag on the same movement within the 8-week window: no R4 proposals for that movement while the window runs; the coach suggests a physio or doctor. Wording states facts only ("Flag cleared 14 Oct"), never "safe", "healed" or a cause. If both a break and a cleared flag apply, R4/R5 win. | Any pain mention during a return | Practice (guardrail; CLAUDE.md rule 9) | CLAUDE.md rule 9; Ardern 2016 |
| R6 | **No-AI fallback and labels.** With the coach unavailable, R1–R3 run as a deterministic offer labelled `Built-in rule`, using the same numbers (no coach wording). The built-in R3 step may be up to ~10% (snapped down) instead of 7-F's smallest increment, until the pre-break load is reached. After a pain flag is cleared, the built-in rule uses plain 7-F only (smallest increment), with no return jumps. | Coach offline or unavailable | Practice | ADR 0006 (and amendment); playbook 7-F |

**Conflicts and flags (for Ben and the PM; not resolved here):**
- **R2 is a coach-raised offer at session start.** CLAUDE.md rule 3 allows the coach to offer when "a clear signal suggests it should"; a gap of ≥ 14 days is proposed as such a signal. It is a new prompt type, so Ben's approval of R2 is the approval of that prompt. Scope stays today-only; templates never change.
- **R6's built-in step (up to ~10%) is bigger than 7-F's smallest increment.** That changes built-in behaviour, so it needs an ADR 0006 note and a developer change (7-F currently has `maxLoadJump: null`, playbook PM notes). Alternative if Ben prefers: the built-in ramp uses 7-F's smallest increment (slower, simpler).
- **R3 steps under D21.** Proposed: once Ben has applied R2, each R3 step (≤ ~10%, not above the pre-break load) counts as a coach "small adjustment" and is the D21 default with reason and Undo. If Ben wants every step as a proposal, R3 behaves like R4.
- **R4 relaxes the current block** in active-workout §2.14.3 ("the coach makes no return-to-load proposals" until a rule is approved). It keeps that section's guard: any jump of more than one step above the last session stays a `CoachTargetProposal`, never a default.
- **No guardrail is overridden:** loads are snapped to the gym's equipment and min/max (rule 4), reductions round down, completed sets are untouched (rule 2), stale proposals are rejected (rule 5), and pain blocks every increase (rule 9).

---

## 1. Coming back after a break

### 1.1 What the research says

**Documented fact**
- **Bosquet et al. 2013**, *Scand J Med Sci Sports* 23(3):e140–e149, meta-analysis of 103 studies. Stopping resistance training reduced submaximal strength (SMD −0.62), maximal force (−0.46) and maximal power (−0.20). "A dose-response relationship between the amplitude of SMD and the duration of training cessation was identified." Effects were larger in people over 65 and in inactive people. The abstract gives **no time threshold**. <https://doi.org/10.1111/sms.12047>; abstract read via <https://www.inigomujika.com/en/2013/02/> (checked 2026-10-11). **Strong** for "losses grow with gap length".
- **McMaster et al. 2013**, *Sports Med*, review of 27 studies in elite rugby and American football players: "Strength levels can be maintained for up to 3 weeks of detraining", after which decay speeds up; mean loss 14.5% over 7.2 ± 5.8 weeks. <https://ro.ecu.edu.au/ecuworks2013/788> (checked 2026-10-09 in goal-adaptive.md). **Moderate**; population is elite athletes.
- **Ogasawara et al.** (bench press, 75% 1RM, 3×/week, young untrained men, n = 14):
  - 2010 conference abstract: during a 3-week break muscle size fell but "strength was maintained"; 6 weeks of retraining gave gains as large as the first 6 weeks. <https://coachsci.sdsu.edu/csa/vol171/ogasawar.htm> (checked 2026-10-11).
  - 2013 full paper (*Eur J Appl Physiol* 113:975–985): 3-week breaks every 6 weeks gave similar 24-week size and strength gains to continuous training. <https://link.springer.com/article/10.1007/s00421-012-2511-9> (abstract via search, checked 2026-10-11).
- **Halonen et al. 2024**, *Scand J Med Sci Sports* 34(10):e14739, RCT, 55 untrained adults, whole-body training 2×/week. A 10-week break reduced 1RM, muscle size and jump height, but the losses were "regained rapidly during retraining", and both groups ended with similar adaptations. Conclusion: trainees "should not be too concerned about occasional short-term training breaks". <https://jyx.jyu.fi/handle/123456789/97584> (checked 2026-10-11).
- **Encarnação et al. 2022**, *Muscles* 1(1):1–15, systematic review and meta-analysis. Strength stayed above untrained controls after 16–24 weeks of detraining, but not at 32 or 48 weeks. Only 2 studies were pooled, rated moderate/high risk of bias; no hypertrophy meta-analysis was possible. <https://www.mdpi.com/2813-0413/1/1/1/htm> (403 when fetched; details from search snippets, checked 2026-10-11). **Weak**.
- **Travis et al. 2020** (powerlifting taper review): a 2–7-day training cessation is acceptable before competition. Via [goal-adaptive.md](goal-adaptive.md) §5.

**Grades:** losses grow with gap length: **Strong**. Little strength loss in the first ~3 weeks for trained younger lifters: **Moderate** (McMaster, Ogasawara; muscle size may fall sooner than strength). Retraining is faster than first gains ("muscle memory"): **Moderate** (several trials). Older lifters lose faster: **Moderate** (a Bosquet subgroup); the app doesn't ask Ben's age, so this is used only if he says it.

**Where sources disagree, and why**
- *When losses start.* McMaster says ~3 weeks; Greg Nuckols' reading of the Bosquet figure says strength is "mostly unaffected" up to ~28 days; Halonen shows clear losses at 10 weeks. Different populations (elite athletes vs untrained adults) and measures (1RM vs isometric force) explain much of this. The 28-day figure is a secondary reading of a graph, not in the Bosquet abstract.
- *Size vs strength.* Ogasawara saw muscle size fall within 3 weeks while strength held. A 2–4-week break may cost a little size but little strength.
- *Strength endurance and work capacity* drop sooner than maximal strength (Nuckols, below). This is why a lighter first session can be sensible even when 1RM is barely down: the risk is mainly a hard, very sore first session, not lost strength.

### 1.2 What coaches and apps do (expert opinion and practice)

- **Greg Nuckols, Stronger By Science / MASS, "Detraining" (Sept 2022 MASS cover story; MASS is a paid subscription, so commercial interest).** <https://www.strongerbyscience.com/detraining/> (checked 2026-10-11). Expert opinion:
  - younger adults can "get away with" about a month off before performance suffers much; older adults perhaps ~2 weeks;
  - breaks under a month: "just bump your training loads down by about 20%", treated like an extended deload;
  - longer breaks: first week with the same exercises, sets and reps at "about 1/3rd as much weight", then ramp up;
  - retraining takes "approximately half as long as the preceding period of training cessation" (range ⅓–⅔), described by the author as a best guess on limited data;
  - avoid ramping heavy loads quickly at low volume.
- **StrongLifts (Mehdi Hadim; commercial app).** The Google Play listing describes an "automatic deload after time off lifting" (via search snippet of <https://www.apkmirror.com/apk/stronglifts/stronglifts-5x5-workout>, checked 2026-10-11; the threshold isn't published). The app shows a `Welcome Back!` card with a `Deload` button and a 50% slider with before/after loads ([competitor-first-pages.md](../research/competitor-first-pages.md) idea 13). Its failure deload is −10% after 3 failed sessions (<https://support.stronglifts.com/article/22-increments>). No official guidance on how much to drop for a given gap was found.
- **Starting Strength (Rippetoe; book paid).** Its deload convention is ~10% and only when needed (secondary: forum quotes of the book; the article "Why I stopped taking weight off the bar" returned 403, so it isn't summarised). Some SS coaches argue against cutting load after short interruptions. Practice.

**Inference (mine).** For gaps under ~4 weeks, a 10% lighter first session protects against an unexpectedly hard, sore session at little cost, and gets back to normal in one or two sessions. Nuckols' 20% for under a month is more cautious than that; I've used 20% from 4 weeks, where McMaster's ~14.5% mean loss suggests the old load would now be near-maximal. Nuckols' "⅓ of the weight" for long breaks is very conservative and not tied to a gap length; StrongLifts defaults to 50%. −40% for 12+ weeks sits between them and aims for an easy first session. All of these are **Practice**: no trial compares return percentages.

### 1.3 How R1–R3 fit GymSmarter

- **Offer, today only.** Today's hero shows the gap fact and an offer, e.g. `Last session 5 weeks ago · Lighter start?`, which opens a before/after for today's sets (Apply/Undo). If Ben starts without applying, today's targets are unchanged. Scope is never the template (rule 3).
- **Snapped down.** −10% of 60 kg = 54 kg → with 2.5 kg plate steps, 52.5 kg. Dumbbells at 22 kg with 2 kg steps: −10% = 19.8 → 18 kg (−18%). If the snapped drop is more than double the target %, prefer the next load up only if it's still lighter than the old load; otherwise keep the old load and cut 1–2 reps per set (same idea as rule 5's guardrail). Unit and load convention shown as usual.
- **Ramp (R3), worked example.** Squat 100 kg, 6-week gap → R2: −20% → 80 kg. R3: half the gap = 3 weeks to return. At 2 squat sessions a week that is ~5 more sessions: about +5 kg a session (80 → 85 → 90 → 95 → 100), each ≤ 10%, each only if the previous session hit all reps at ≤ planned RPE. Then rule 7 / 7-F as normal.
- **Interaction with other rules.** An R2 session counts as a light session: don't also propose a deload (rule 10) that week, and don't count it as a stall (rule 8). Rule T still runs: an RPE ≤ 6 on a planned RPE ≥ 8 set can fire the normal "too easy" offer. A check-in of `Ill` keeps the existing gentle suggestion to rest; the coach doesn't infer illness from a gap.
- **Data honesty (rule 6).** The gap is a logged fact. The app doesn't estimate "strength lost"; any estimated 1RM stays labelled as an estimate.

## 2. Returning towards previous loads after a pain flag is cleared

### 2.1 Current design (context)

[active-workout.md](../design/active-workout.md) §2.14.3: only Ben clears a flag. After clearing, targets "carry on from the recent sets" with normal small steps (7-F or the coach's D21 changes). The `Before flag` sets are reference only for 8 weeks. Any coach next-session target more than one achievable step above the last session is a `CoachTargetProposal`, never a default, and until this rule is approved the validator drops such jumps.

### 2.2 What the evidence says (and doesn't)

**Documented fact**
- **Ardern et al. 2016**, *BJSM* 50:853–864, consensus statement from the First World Congress in Sports Physical Therapy (Bern). Return to sport is "complex and multifactorial", a risk-management exercise placed along a continuum within rehabilitation, decided collaboratively by clinicians, athletes and coaches. <https://pubmed.ncbi.nlm.nih.gov/27226389/> (abstract via search, checked 2026-10-11). Expert consensus; it supports *graded* return and shared decisions but gives no lifting percentages.
- **Buist et al. 2008**, *Am J Sports Med* 36(1):33–39, RCT, 532 novice runners: a graded programme based on the "10% rule" did not reduce running injuries (20.8% vs 20.3%, P = .90). <https://research.rug.nl/en/publications/no-effect-of-a-graded-training-program-on-the-number-of-running-r/> (checked 2026-10-11). **Moderate** that the 10% cap isn't itself protective (running, single large RCT).
- **Impellizzeri et al. 2020/2021**: the acute:chronic workload ratio's link to injury is a conjecture and the framework "should be dismissed" (contested by its proponents). <https://iris.univr.it/retrieve/e34cfb98-e922-4c2f-aab5-18583ab7e31b/Impellizzeri_What%20Role%20Do%20Chronic%20Workloads%20Play_SportMed_2021.pdf> (checked 2026-10-11). So the app shouldn't present load ratios as injury protection.
- **Clinician-led pain monitoring.** Silbernagel et al. 2007 (*Am J Sports Med* 35(6):897–906, RCT, n = 38, Achilles tendinopathy) found no negative effects from continued loading under a pain-monitoring model run by clinicians (<https://search.pedro.org.au/search-results/record-detail/18389>). Smith et al. 2017 (*BJSM* 51:1679–1687, meta-analysis of 7 trials) found painful exercise gave a small short-term benefit in chronic musculoskeletal pain (<https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5739826/>). Both are **clinical, supervised** contexts.

**Why these clinical findings are not used for rules.** They show that some pain during loading can be acceptable *under a clinician*. GymSmarter can't assess pain, so CLAUDE.md rule 9 wins: any pain mention stops progression and the app never decides what pain level is acceptable. They're listed so the coach doesn't overstate "any pain means damage" either: it just stops and suggests a professional.

**Grade for R4/R5:** **Practice.** No study tells a lifter without a clinician how fast to return to pre-pain loads. The design choices (one step per session, ≤ ~10%, reps and sets before load, pain-free session first, cap at pre-flag sets) are conservative conventions borrowed from graded-exposure practice and the app's existing guardrails. The ≤ 10% cap is used as a size limit consistent with rule 7, **not** as an injury-prevention claim (Buist 2008).

### 2.3 How R4/R5 fit GymSmarter

- **Order of return.** Example: before the flag 55 kg × 6, 6, 6; since the flag 50 kg × 8, 8, 8 (rep range 6–8). The flagged-period work already meets the rep target, so the first proposal is the load step: next achievable up, or up to half the gap (2.5 kg), ≤ 10% → 52.5 kg × 6–8. Next session, if no pain was mentioned and all reps were hit: 55 kg. Return complete; normal rule 7 from there. If sets were cut while flagged, sets come back first (one per session), then load.
- **Where it appears.** In the post-workout review, or when Ben asks ("Can I go back up on overhead press?"). Proposal before/after shows the `Before flag` reference as a fact. Copy states facts only: `Flag cleared 14 Oct · Before flag 55 kg × 6`. Never "safe" or "healed".
- **Window.** After the 8-week reference window (`timing.painReferenceWindow`), the `Before flag` sets are no longer shown and R4 stops; ordinary rule 7 progression applies from current sets.
- **No AI.** The built-in rule keeps plain 7-F (smallest increment, reps first when the step is > ~10%). It makes no return jumps and never references the pre-flag sets as a target.

## 3. Open questions for Ben

1. R1's 14-day trigger: right, or 21 days (closer to McMaster's ~3 weeks)?
2. R2 percentages (−10 / −20 / −40): keep, or use a single slider like StrongLifts (default 50% is much more cautious)?
3. R3 ramp steps: D21 defaults with Undo (proposed) or proposals each time?
4. R6 built-in ramp: up to ~10% steps (needs ADR 0006 note and code), or 7-F's smallest increment?

## Sources (all checked 2026-10-11 unless noted)

| Source | Type | Commercial interest | URL |
|---|---|---|---|
| Bosquet et al. 2013 | Meta-analysis (103 studies) | None stated | <https://doi.org/10.1111/sms.12047> (abstract via <https://www.inigomujika.com/en/2013/02/>) |
| McMaster et al. 2013 | Systematic review (27 studies, elite athletes) | None stated | <https://ro.ecu.edu.au/ecuworks2013/788> (checked 2026-10-09) |
| Encarnação et al. 2022 | Systematic review + meta-analysis (2 studies pooled) | None stated | <https://www.mdpi.com/2813-0413/1/1/1/htm> (403; snippets) |
| Ogasawara et al. 2010 (abstract), 2013 | Small trials | None stated | <https://coachsci.sdsu.edu/csa/vol171/ogasawar.htm>; <https://link.springer.com/article/10.1007/s00421-012-2511-9> |
| Halonen et al. 2024 | RCT (n = 55) | None stated | <https://jyx.jyu.fi/handle/123456789/97584> |
| Nuckols, "Detraining" (SBS/MASS 2022) | Expert review | Yes (MASS subscription) | <https://www.strongerbyscience.com/detraining/> |
| StrongLifts help and app listing | Commercial practice | Yes (paid app) | <https://support.stronglifts.com/article/22-increments>; <https://www.apkmirror.com/apk/stronglifts/stronglifts-5x5-workout> |
| Ardern et al. 2016 | Consensus statement | None stated | <https://pubmed.ncbi.nlm.nih.gov/27226389/> |
| Buist et al. 2008 | RCT (n = 532 runners) | None stated | <https://research.rug.nl/en/publications/no-effect-of-a-graded-training-program-on-the-number-of-running-r/> |
| Impellizzeri et al. 2021 | Analysis/critique | None stated | <https://iris.univr.it/retrieve/e34cfb98-e922-4c2f-aab5-18583ab7e31b/Impellizzeri_What%20Role%20Do%20Chronic%20Workloads%20Play_SportMed_2021.pdf> |
| Silbernagel et al. 2007 | RCT (clinical) | None stated | <https://search.pedro.org.au/search-results/record-detail/18389> |
| Smith et al. 2017 | Meta-analysis (clinical) | None stated | <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5739826/> |

**Copyright and availability.** Summaries and short quotes only. Paid or blocked: MASS (Stronger By Science subscription), *Starting Strength* (book), the Bosquet, Buist and Ardern full texts (journal access). Ben can add his own copies to the app library.

## Rules for Ben to approve (plain words)

1. **R1.** If you haven't done an exercise for 14 days or more, the app treats it as a comeback.
2. **R2.** On a comeback, the app offers a lighter session for today only: 10% lighter after 2–4 weeks off, 20% lighter after 4–12 weeks, 40% lighter after 12+ weeks. Same sets and reps, rounded down to weights your gym has. Nothing changes unless you tap Apply, and Undo puts it back.
3. **R3.** After that lighter session, loads climb back to where you were over about half as many weeks as you were away (at most 6 weeks), no more than about 10% at a time, and only while you're hitting your reps. Once you're back to your old weight, normal progression takes over.
4. **R4.** After you clear a pain flag, the app starts from what you were lifting while flagged. The coach can then suggest one small step a session back towards your pre-pain sets (sets and reps first, then weight, no more than about 10% a step), only after a session with no pain and all reps done. It's always a suggestion you apply or not, and it never goes past your pre-pain sets this way.
5. **R5.** Any pain on that exercise during a comeback stops it straight away: no increases, and the coach suggests seeing a physio or doctor. It never says a movement is safe or what's wrong.
6. **R6.** Without the AI coach, rules 1–3 still work as a labelled built-in rule. After a pain flag, the built-in rule only goes up by the smallest weight step, never in bigger jumps.
