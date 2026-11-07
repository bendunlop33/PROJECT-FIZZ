# Frequency, upper volume limits and the stall window

*Training-researcher survey for Ben, 2 Nov 2026. All sources checked 2026-11-02. Not medical advice: pain or injury stops progression on that movement and the coach suggests seeing a professional (CLAUDE.md rule 9). Builds on [volume-by-frequency.md](volume-by-frequency.md) (V1–V8), [playbook-v1.md](playbook-v1.md) rules 1, 2, 4, 8, 10 and the 1 Nov V1/V4 amendment, and [plan-muscles.md](../design/plan-muscles.md). **Ben approved FQ1–FQ3, VC1–VC4 and ST1–ST3 on 2 Nov 2026, with VC2's "> 30 total" backstop dropped (see the status note below).***

**Summary**
1. **Frequency:** with weekly sets equal, training a muscle 1× or 3× a week grows it about the same (Strong); 2×/week mainly helps by making room for more sets and, for strength, more practice of the lift (Moderate). Rebalance should *prefer* ≥ 2 days per group, *enforce* only the approved per-session cap and rule 2's main-lift 2×/week, and never flag a group just for being trained once.
2. **Upper limit:** no evidence that 11–20 direct sets a week is harmful or wasted for a non-priority group; returns shrink, they don't reverse (Strong/Moderate). Don't warn above 10. Keep the flag at > 20 direct and add a per-session flag at > 8 direct (the approved planning cap). ~~A backstop at > 30 total~~ was dropped by Ben (2 Nov). Rebalance trims only those; groups above their range are the first donors when a gap needs time.
3. **Stall:** 2 weeks without a new best is inside normal day-to-day noise for a trained lifter. Keep rule 8's miss stall at 2 comparable sessions (≥ 7 days apart), and define "no progress" as ≥ 3 comparable sessions and ≥ 3 weeks with no new best (Practice, supported by measurement-noise data).

## Playbook rules (approved 2 Nov 2026)

**Status (Ben, 2 Nov 2026):** FQ1, FQ2, FQ3, VC1, VC2, VC3, VC4, ST1, ST2 and ST3 are **approved**. VC2 is approved **without** the weak "> 30 total (direct + assisted)" backstop: assisted volume never flags a group. The struck text below records what was dropped. Rule 8's wording now reads as ST1/ST2 (playbook-v1.md). Built: one stall module (`packages/domain/src/stall.ts`) used by the built-in rule, the block view and the weekly review; VC3/FQ2 in Plan › Muscles and Rebalance; FQ1/FQ2 in the plan builder. IDs: FQ = frequency, VC = volume caps, ST = stall.

| # | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| FQ1 | **Prefer, don't require, 2×/week.** When planning or rebalancing, place a group's sets so it gets ≥ 2 exposures a week where Ben's days and split allow. An exposure = a session with ≥ 2 hard-set credits for the group (direct + assisted, V1 counting). It's a tie-breaker between otherwise equal options: never a reason to add sets, add time, change Ben's split or days, or block a plan. No flag or amber for a group trained once a week. | Muscle, General fitness, Maintain and no-goal plans; Rebalance and coach plan checks | Frequency doesn't matter for size when weekly sets are equal: **Strong** (two meta-analyses agree). 2× beats 1× when volume isn't equated: **Moderate**. Exposure threshold: **Practice** | [Schoenfeld 2019](https://pubmed.ncbi.nlm.nih.gov/30558493/), [Pelland 2025/26](https://pubmed.ncbi.nlm.nih.gov/41343037/), [Schoenfeld 2016](https://pubmed.ncbi.nlm.nih.gov/27102172/), [ACSM 2026](https://acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf) |
| FQ2 | **Frequency follows the per-session cap (enforced).** A group whose weekly direct target is > 8 must be spread over ≥ 2 days so no day exceeds ~8 direct hard sets for it (approved rule 1 cap). Rebalance never creates a day above 8 for a group. | Any plan with a group above 8 direct a week | Diminishing returns per session: **Moderate**. The 8 figure: **Weak** (preprint) | [Remmert 2025](https://sportrxiv.org/index.php/server/preprint/view/537), playbook rule 1 |
| FQ3 | **Strength: main lifts ≥ 2×/week stays a check** (approved rule 2, not new). Rebalance and trims never take a main lift below 2 exposures a week when Ben's days allow. | Strength focus, or strength "also matters" (floor 1–2) | **Moderate** | [Pelland 2025/26](https://pubmed.ncbi.nlm.nih.gov/41343037/), [Grgic 2018](https://pubmed.ncbi.nlm.nih.gov/29470825), rule 2 |
| VC1 | **No warning above a non-priority range.** Between the range top (8 or 10) and 20 direct sets a week, the bar stays neutral and nothing is flagged. Rebalance never trims such a group for its own sake; it is the first donor when a gap fill needs time on that day, and only down to its range top. | Muscle, General fitness, no-priority groups | More sets → more growth, diminishing returns, no plateau seen up to ~20: **Strong**. "Donor first": **Practice** | [Pelland 2025/26](https://pubmed.ncbi.nlm.nih.gov/41343037/), [Baz-Valle 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8884877/), [Heaselgrave 2019](https://pubmed.ncbi.nlm.nih.gov/30160627/) |
| VC2 | **Weekly flags.** Amber and a Rebalance trim when a group has **> 20 direct** sets a week (unchanged; priority groups may go above 20 only for 1–2 groups Ben chose, per V4). ~~or > 30 total (direct + assisted, V1 counting)~~ *(dropped by Ben, 2 Nov)*. Assisted volume never counts towards the top. | Plan › Muscles typical week, coach plan checks, weekly review | 20: **Practice** (top of approved range; little data above ~20–25). ~~30 total: **Weak**~~ (dropped) | [Pelland preprint](https://sportrxiv.org/index.php/server/preprint/view/460), V4, playbook rule 1 |
| VC3 | **Per-session flag.** Amber on the By day view when a day has **> 8 direct** hard sets for one group. Rebalance moves the excess to another of that group's split days if one has time, else trims to 8 (never a main lift, never below 2 sets a row). | Any plan or builder day | Diminishing returns: **Moderate**; 8: **Weak** | [Remmert 2025](https://sportrxiv.org/index.php/server/preprint/view/537), [volume-by-frequency.md](volume-by-frequency.md) V2 |
| VC4 | **Strength focus keeps its lower top.** The weekly review's high edge of 10 for non-main groups under a Strength focus stays. Extra accessory volume is spent on main-lift recovery. | Strength focus | **Weak** (one trial's trend) + inference | [Aube 2022](https://doi.org/10.1519/JSC.0000000000003524), [Pelland 2025/26](https://pubmed.ncbi.nlm.nih.gov/41343037/) |
| ST1 | **Miss stall (rule 8, made exact).** A stall is **2 consecutive comparable sessions** (same exercise, equipment and routine slot) missing the same target, with **≥ 7 days from the first miss to the second**; if they fell within 7 days, wait for a third. Then the existing offer: 5–10% reset or a rep-scheme change, Apply/Skip. One miss = note only. | Next-session targets (coach and 7-F) | **Practice** (StrongLifts uses 3 misses; GZCLP changes rep scheme after one failed stage). Rule 4's "pattern ≥ 2 sessions": **Moderate** | [StrongLifts](https://support.stronglifts.com/article/22-increments), [GZCLP](https://thefitness.wiki/routines/gzclp/), rule 4 |
| ST2 | **No-progress stall (one definition everywhere).** A lift is "stalled" when it has **no new best for ≥ 3 consecutive comparable sessions and ≥ 3 weeks** since its last best. Best = more load at the same or more reps, or more reps at the same load (est. 1RM may be shown, labelled "est."). Skipped: deload, lead-in, return-ramp and pain-flag weeks, planned light days, and a lift held at a machine max or rep cap (that's a "ceiling", not a stall). Under Maintain, only a drop counts (as approved). | Progress › block view, weekly review, coach context | **Practice**; noise argument: **Moderate** data, applied by inference | [Grgic 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7367986/), rule 4, [set-structures.md](set-structures.md) SS8 |
| ST3 | **What a no-progress stall does.** Display only ("Stalled") plus, when Ben opens a review or asks, one offer: rep-scheme change or variation first, reset 5–10% second. If ≥ 2 lifts stall in the same fortnight, or performance falls across ≥ 2 sessions, rule 10's deload proposal instead. No coach-raised prompt elsewhere. Pain flag: no offer to progress; pain flow only. | After ST2 fires | **Practice** | Rules 8, 10; [GZCLP](https://thefitness.wiki/routines/gzclp/) |

### Guardrail check

- **No guardrail is overridden.** Nothing here changes loads beyond rule 8's existing reset band; all loads still snap to achievable equipment and min/max, completed sets are untouched, and plan changes stay one Rebalance proposal (Apply/Undo, op ID, stale refused).
- **Pain (rule 9):** FQ1 and VC1 never move sets onto or away from a pain-flagged movement to "work around" it. Pain-flag weeks never count towards a stall (ST2), and a stall never prompts an increase on a flagged movement.
- **Rule 3 / ADR 0006:** ST3's offer appears only on surfaces Ben opens (weekly review, Library › Changes) or when he asks, like the existing muscle-gap offer. VC2/VC3 are flags on Plan › Muscles, not new coach prompts. If Ben wants a stall to raise a coach prompt elsewhere, that's an ADR 0006 amendment.
- **Rule 6:** "Best" and "stalled" come from logged sets only; est. 1RM is labelled; "approx." where RPE is missing.
- **Rule 10:** all thresholds here are Coaching knowledge; Ben's priorities and split are Your data.

---

## 1. Frequency: should every group be trained twice a week?

**For Ben, in plain words.** How often you train a muscle matters much less than how many hard sets it gets in the week. Twice a week is a good habit because it spreads the work and gives lifts more practice, so the app will lean that way, but it won't nag or force it.

**Fact (checked 2026-11-02)**
- **Schoenfeld, Ogborn & Krieger 2016**, *Sports Med* 46(11):1689–97, 10 studies: higher frequency gave a larger hypertrophy effect size (0.49 vs 0.30, p = 0.002); authors recommend "at least twice a week" and say whether 3× beats 2× "remains to be determined". Volume-matched-per-muscle analyses had too few studies. <https://pubmed.ncbi.nlm.nih.gov/27102172/>. *Opinion (critique):* Henselmans argues total work wasn't equated, so the 2× advantage may be extra volume (<https://mennohenselmans.com/training-frequency-2018-meta-analysis-review/>; he sells coaching).
- **Schoenfeld, Grgic & Krieger 2019**, *J Sports Sci* 37(11):1286–95, 25 studies: with volume equated, "no significant difference" between frequencies, including in trained people and upper vs lower body; without equating, higher frequency helped slightly. <https://pubmed.ncbi.nlm.nih.gov/30558493/>
- **Grgic et al. 2018**, *Sports Med*, strength: effect sizes 0.74 / 0.82 / 0.93 / 1.08 for 1 / 2 / 3 / 4+ sessions a week (p = 0.003), but with volume equated no significant effect (p = 0.421); frequency mattered more for upper-body multi-joint lifts. <https://pubmed.ncbi.nlm.nih.gov/29470825>
- **Pelland et al. 2025/26**, *Sports Med* (67 studies): for hypertrophy, frequency's effect is "compatible with negligible effects"; for strength, gains rise with frequency "albeit with diminishing returns". <https://pubmed.ncbi.nlm.nih.gov/41343037/>. Preprint figures (from volume-by-frequency.md): ~+3.3% strength gain per extra weekly session, biggest step 1 → 2 sessions. Authors declare fitness-industry roles.
- **ACSM 2026** infographic (re-read today): "Train all major muscle groups at least 2 days per week". This is a general-population starting rule, not a volume-equated finding. <https://acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf>
- **RP** (commercial opinion): maintenance ~6 sets when trained "at least twice weekly"; no frequency rule for growth. <https://rpstrength.com/training-volume-landmarks-muscle-growth/>

**Where sources disagree, and why.** Schoenfeld 2016 and ACSM say ≥ 2×; Schoenfeld 2019 and Pelland say frequency barely matters for size. The difference is volume equating: 2016 pooled studies where the higher-frequency group often did more work. For strength, Grgic (null when equated, 8 studies) and Pelland (positive, larger dataset, non-linear model) differ in method; both support ≥ 2× for main lifts as a default.

**Inference.** For an app, frequency is a *means*: (a) the per-session cap (~8 direct) means a group wanting > 8 sets needs ≥ 2 days, and (b) strength benefits from practising the lift twice. Outside those, 1× is fine if the sets are there.

**Practical rule by split (defaults from playbook rule 1):**

| Days / split | Exposures per group | FQ1 status |
|---|---|---|
| 2–3 full body | 2–3 | Met |
| 3 PPL (Ben's own choice) | 1 | Not met. Coach says once when planning that each group gets one day; nothing flagged; groups above 8 must move sets to another day (FQ2) |
| 4 upper/lower | 2 | Met |
| 5 U/L + fifth day | 2–3 | Met |
| 6 U/L ×3 or PPL ×2 | 2–3 | Met |

**What changes in the app**
- `rebalancePlan`: among candidate placements that pass all existing checks, prefer the one that gives the group a second exposure (tie-breaker). Today it spreads over "the group's own split days, at most two"; this formalises that, no new behaviour beyond the tie-break.
- New deterministic check: no day > 8 direct sets for one group (FQ2/VC3).
- Rule 2 check: trims never take a main lift below 2 exposures (FQ3).
- Plan › Muscles: no frequency flag. Optional: show "1 day" in the group's Why? line only.
- Resolves plan-muscles.md §7 open item 1.

## 2. Upper limit for non-priority groups

**For Ben, in plain words.** Doing more than 10 sets a week for a muscle that isn't a priority isn't harmful; it just pays back less per set and takes time. The app will only warn when a muscle is clearly overloaded (more than 20 sets a week, or more than 8 in one workout), and will borrow from "extra" muscles first when it needs time for a gap.

**Fact (checked 2026-11-02)**
- **Pelland 2025/26:** hypertrophy rises with weekly sets with diminishing returns; strength flattens sooner (<https://pubmed.ncbi.nlm.nih.gov/41343037/>). Preprint efficiency tiers (fractional sets/week): 5–10 highest efficiency, 11–18 intermediate, 19–29 lower, 30–42 lowest; few studies above ~25 (<https://sportrxiv.org/index.php/server/preprint/view/460>).
- **Baz-Valle 2022** (7 RCTs, trained men): 12–20 vs > 20 sets no different for quads (p = 0.19) or biceps (p = 0.59); triceps favoured > 20 (p = 0.01); suggests 12–20 as a standard. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8884877/>
- **Heaselgrave 2019** (*IJSPP*, 49 trained men, biceps 9 / 18 / 27 sets a week, 6 weeks): no significant group differences; effect sizes favoured 18–27 for strength. <https://pubmed.ncbi.nlm.nih.gov/30160627/>
- **Remmert 2025** (preprint, not peer reviewed): per-session growth stops being detectably better at ~11 fractional (~8 direct) sets; "insufficient data with very high per-session set volumes"; "interpreted cautiously". <https://sportrxiv.org/index.php/server/preprint/view/537>
- **Aube 2022** (35 trained, legs): 12 / 18 / 24 sets a week: size the same; squat 1RM trended worst at 24 (p = 0.052). <https://doi.org/10.1519/JSC.0000000000003524>
- **RP** (commercial opinion): MRV is "your upper limit—training beyond this prevents adequate recovery"; the sign is not matching last week's performance; no universal number (example "18 sets is the MRV for triceps"). <https://rpstrength.com/training-volume-landmarks-muscle-growth/>
- **Indirect work.** de França 2015 (*APNM*, 20 trained men): adding curls/extensions to compound work gave no extra arm size or strength (<https://pure.solent.ac.uk/en/publications/the-effects-of-adding-single-joint-exercises-to-a-multi-joint-exe/>). Mannarino 2019 (untrained): curls alone grew elbow flexors more than rows alone, 11.1% vs 5.2% (<https://paulogentil.com/pdf/Single-Joint%20Exercise%20Results%20in%20Higher%20Hypertrophy%20of%20Elbow%20Flexors%20Than%20Multijoint%20Exercise.pdf>). Pelland's ½ counting fitted best. Together: assisted work is real but worth less than direct, which supports Ben's 1 Nov 4–8 range.

**Where sources disagree.** Baz-Valle and Aube hint at a plateau or strength cost above ~20; Pelland's model shows no plateau but sparse data. RP frames limits as individual recovery, not a number. Nobody finds harm at 10–20 for size.

**Inference.**
- A warning above ~10 for non-priority groups would contradict the evidence (it isn't too much) and add noise. The real cost is time and fatigue that could go to priority groups or main lifts, so that belongs in Rebalance's donor order (VC1), not in a flag.
- The per-session cap is where "junk" sets most plausibly live (VC3), and it's already approved as a planning cap, so flagging it stays inside rule 1.
- ~~Assisted volume should count towards the top only as a backstop (VC2's 30 total)~~ (dropped, Ben 2 Nov): assisted volume doesn't count towards the top at all, because Ben decided bars use direct sets; counting it into the 20 would flag ordinary push/pull plans (e.g. triceps from presses).

**What changes in the app**
- `muscleStatus` / bars: unchanged for 10–20 (neutral). ~~Add `total = direct + assisted > 30` as an "above" condition.~~ (Dropped, Ben 2 Nov.)
- Plan › Muscles By day: amber when one day has > 8 direct sets for a group; gap line e.g. `Chest 10 on Mon · above 8`.
- `rebalancePlan`: step 1 also trims per-session > 8 (moving before trimming) ~~and total > 30~~; donor order for gap fills: groups above their range top first, never below it.
- Resolves plan-muscles.md §7 item 4.

## 3. The stall window

**For Ben, in plain words.** Two weeks without a new best is normal noise for someone who's been lifting a while. The app should call a lift "stalled" after about three weeks (and at least three sessions) with no new best, while still reacting after two missed sessions in a row.

**What the app does today (read from code, 2026-11-02; not run):**
- 7-F miss stall: `failuresBeforeReduce: 2` (`packages/domain/src/default-rule.ts`), reset offered, not applied.
- Block view: "Stalled" after 2+ trained weeks with no gain (`packages/domain/src/progress/block-lifts.ts`).
- Weekly review: no new best over the last 3 sessions (`packages/domain/src/review/weekly.ts`).
- Approved rule 8 says "2–3 sessions failing the same target". So there are three definitions; the question's "2 weeks" matches only the block view.

**Fact (checked 2026-11-02)**
- **Grgic et al. 2020** (*Sports Med Open*, systematic review of 1RM test–retest): CV 0.5–12.1%, median 4.2%; trained median 3.3%, untrained 5.5%. <https://pmc.ncbi.nlm.nih.gov/articles/PMC7367986/>
- Rule 4 (approved, Moderate): one RPE rating ≈ ± 1 rep, about 2–3% of load.
- **StrongLifts** (commercial app): deload 10% after failing all sets "for three sessions in a row" (configurable). <https://support.stronglifts.com/article/22-increments>
- **GZCLP** (community wiki): T1 failure → next rep stage (5×3 → 6×2 → 10×1), then retest and restart at 85% of a new 5RM. <https://thefitness.wiki/routines/gzclp/>
- **5/3/1**: secondary sources say reset the training max ~10% on a stalled lift; Wendler's own text is in paid books (not read). E.g. <https://arvo.guru/resources/methods/wendler-531> (app vendor).

**Inference.** Planned pace for trained lifters is ~0.5–1% a week (set-structures SS8, Practice). Two weeks' expected gain (1–2%) is smaller than a trained lifter's day-to-day variation (~3%), so a 2-week "no new best" window will often flag normal noise. About 3 weeks (and ≥ 3 sessions, so lifts trained once a week get 3 data points) separates signal from noise better. A *missed target* is a different, stronger signal (the lift failed a load it was meant to manage), so 2 consecutive comparable misses stay a valid trigger, with ≥ 7 days between them so a bad few days don't count twice.

**Grade:** Practice overall. The noise data are Moderate (one systematic review), the application to stall windows is inference. No trial compares stall windows.

**What changes in the app**
- Block view: `noGainRun >= 2` weeks → ST2 (≥ 3 comparable sessions and ≥ 3 weeks; skip deload, lead-in, return-ramp, pain-flag weeks and ceilings).
- Weekly review: 3 sessions → ST2 (adds the ≥ 3 weeks condition).
- 7-F: keep 2 misses, add the ≥ 7-day span (ST1).
- One shared pure function in `packages/domain` so all three agree; pin tests for each case.
- Rule 8's text changes from "2–3 sessions" to ST1/ST2 if Ben approves (an approved-rule wording change).

## Copyright and availability

Summaries and short quotes only. Paywalled or paid: Pelland journal version (preprint open), ACSM 2026 full text, Aube 2022, Heaselgrave 2019 full text, de França 2015 full text, *5/3/1 Forever* (Wendler). Ben can add his own copies to the library.
