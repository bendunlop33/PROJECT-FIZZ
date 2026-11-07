# Evidence core: volume, load, effort, progression, rest, deloads, frequency

*Training-researcher survey for Ben. All sources checked 2026-10-08. Not medical advice.*

**Summary**
1. Hypertrophy rises with weekly hard sets (about 10+ per muscle is the long-standing anchor; benefit continues past 20 with diminishing returns); strength needs far less volume but heavier loads (≥~80% 1RM). Grades: Strong.
2. Growth happens across a wide load range if sets are taken close to failure; strength is load-specific. Going all the way to failure adds little and costs more recovery. Grades: Strong / Moderate.
3. RPE/RIR self-ratings are useful but noisy: lifters miss by about 1 rep on average with very wide spread, worse for high-rep sets. Act on large signals and trends, not one rating. Grade: Moderate.
4. RPE-based autoregulation is at least as good as percentage loading; reps or load progression both work. Mid-session load drops after an over-hard set are coaching practice (RTS, APRE), not tested rules. Grades: Moderate / Weak / Practice.
5. Longer rests (2–3+ min) suit heavy compound work; frequency matters mainly as a way to fit volume; scheduled deloads have no proven benefit but are a reasonable fatigue tool. Grades: Moderate / Strong / Weak.

## Candidate playbook rules

Each rule is a *candidate* for Ben to approve. "Guardrail note" flags interaction with CLAUDE.md / ADR 0006; none of these overrides a guardrail.

| # | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| E1 | Count a "hard set" as a working set finished at RPE ≥ 6 (≤ 4 RIR). Warm-ups are excluded. Count a compound's set fully for prime movers and as ½ for synergists (e.g. bench → ½ triceps). | Weekly volume summaries, coach volume advice | Practice (definition); fractional counting Moderate | [RP landmarks](https://rpstrength.com/training-volume-landmarks-muscle-growth/), [Pelland et al. 2026](https://sportrxiv.org/index.php/server/preprint/view/537) |
| E2 | Hypertrophy target: 10–20 hard sets per muscle per week. Start near 10 for a muscle and add 1–2 sets/week only if performance is holding and recovery is fine. Below ~10 is fine for maintenance or muscles that aren't a priority. | Muscle-gain focus | Strong (dose-response); upper bound Moderate | [Schoenfeld et al. 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC6303131/), [Pelland et al.](https://sportrxiv.org/index.php/server/preprint/view/537), [ACSM 2026 via Newswise](https://www.newswise.com/articles/acsm-unveils-landmark-2026-resistance-training-guidelines-first-update-in-17-years) |
| E3 | Strength target: main lifts mostly at ≥ ~80% 1RM (≈ 1–6 reps at RPE 7–9), 2–3+ working sets, each lift ≥ 2×/week. More volume beyond a few sets per lift adds little strength. | Strength focus | Strong | [Currier et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/), [Schoenfeld et al. 2017 load meta](https://pubmed.ncbi.nlm.nih.gov/28834797/), [ACSM 2026](https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/) |
| E4 | Working sets target 0–3 RIR (RPE 7–10). Default compounds to RPE 7–9; reserve RPE 10 / failure for the last set of an exercise or isolation/machine work, not every set of heavy barbell lifts. | Setting targets for any set | Moderate | [Refalo et al. 2023](https://link.springer.com/article/10.1007/s40279-023-01946-6), [Robinson et al. 2024](https://sportrxiv.org/index.php/server/preprint/view/295), [Morán-Navarro 2017](https://pubmed.ncbi.nlm.nih.gov/28965198/) |
| E5 | Treat one logged RPE as ± 1 rep uncertain. Don't change future targets on one rating; change them on a repeated pattern (≥ 2 sessions) or a big single signal (RPE 10 when ≤ 8 was planned, or reps short by ≥ 2). Ratings on sets > 12 reps are less trustworthy. | Interpreting RPE logs | Moderate | [Halperin et al. 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/), [Zourdos et al. 2016](https://openrepository.aut.ac.nz/items/efef3b25-6701-4fb5-bb82-55fcd2a26027/full) |
| E6 | After a set at RPE ≥ 9.5 that was planned at ≤ 8.5, or reps short by ≥ 2, the coach may **offer**: drop remaining sets of that exercise by ~2–4% per RPE point over target (typically 5–10%), or keep load and cut target reps by the overshoot. Snap to an achievable load, rounding down. | Mid-session, same exercise still has pending sets | Weak (APRE trial, RPE-stop study) + Practice (RTS) | [Mann et al. 2010](https://scholarship.miami.edu/esploro/outputs/journalArticle/THE-EFFECT-OF-AUTOREGULATORY-PROGRESSIVE-RESISTANCE/991031785742302976), [Helms et al. RPE-stop](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full), [RTS overview](https://elitefts.com/education/a-reactive-training-manual-overview), [RPE chart](https://fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained) |
| E7 | After a working set at RPE ≤ 6 where ≥ 8 was planned, the coach may **offer** +2–5% (next achievable load) or +1–2 reps on remaining sets. | Mid-session, pending sets remain | Practice (mirror of E6; APRE adds load after high reps) | [Mann et al. 2010](https://scholarship.miami.edu/esploro/outputs/journalArticle/THE-EFFECT-OF-AUTOREGULATORY-PROGRESSIVE-RESISTANCE/991031785742302976), [APRE summary](https://longtermtraining.substack.com/p/apre-removing-the-guesswork-for-strength) |
| E8 | Built-in fallback (double progression): give each exercise a rep range (e.g. 6–10). When every working set reaches the top of the range at or below target RPE, raise the load by the smallest achievable increment next session and restart at the bottom. If that increment is > ~10% (big dumbbell jumps, stack steps, machine max), keep progressing reps or add a set instead. | No AI, or Ben asks for "the rule" | Moderate (reps-or-load progression both work) + Practice | [Plotkin et al. 2022](https://peerj.com/articles/14142) |
| E9 | Top set + back-offs: back-off sets ~5–10% below the top set, or "RPE stop" (repeat at a reduced load until target RPE is reached). | Strength blocks, RPE-based programmes | Weak / Practice | [Helms et al. RPE-stop](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full), [RTS overview](https://elitefts.com/education/a-reactive-training-manual-overview) |
| E10 | Rest 2–3 min (up to 5) between heavy compound sets; 1–2 min is acceptable for isolation work. Shorter rest is fine when time is short but expect fewer reps. | Rest presets, shortening sessions | Moderate | [Singer et al. 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/text) |
| E11 | Deload is a tool, not a schedule requirement. Propose one (≈ halve sets, keep loads moderate, RPE ≤ 7, ~1 week) when performance falls across ≥ 2 sessions despite normal sleep/stress, or every 4–8 weeks if Ben prefers a fixed rhythm. | Future-plan proposals | Weak (one RCT) + Practice (Delphi) | [Coleman et al. 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/), [Bell et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/), [Bell et al. 2025 practical guide](https://shura.shu.ac.uk/35313/) |
| E12 | Train each muscle ≥ 2×/week; use frequency to spread volume (≤ ~6–8 hard sets per muscle per session is a practical cap) rather than as a goal in itself. Strength of a specific lift benefits from practising it more often. | Building or reshaping a weekly plan | Strong (volume-matched null), Moderate (strength-frequency slope) | [Schoenfeld et al. 2019](https://pubmed.ncbi.nlm.nih.gov/27102172/), [Grgic et al. 2018](https://vuir.vu.edu.au/37695/), [Pelland et al.](https://sportrxiv.org/index.php/server/preprint/view/537) |
| E13 | A stall = 2–3 consecutive sessions failing the same target. Then propose (future scope) a 5–10% load reset or a rep-scheme change; one bad session only gets a note. | Next-session targets | Practice | [StrongLifts support](https://support.stronglifts.com/article/22-increments), [GZCLP](https://thefitness.wiki/routines/gzclp/) |

**Guardrail notes on these rules**
- E6/E7 are exactly the ADR 0006 trigger cases. Under ADR 0006 the coach **offers** them, and they apply only if Ben accepts, or straight away if Ben asked. Every load is snapped by `roundToAvailableLoad` (round down after an overshoot) and bounded by equipment min/max. No conflict.
- ADR 0006 trigger thresholds (RPE ≥ 9.5, reps short ≥ 2, RPE ≤ 6) fit E5's ~1-rep rating error. **Flag:** RPE ≤ 6 on a set > 12 reps, or on a warm-up mislabelled as working, is likely noise. Suggest the trigger ignores warm-ups and optionally sets > 12 reps. For Ben to decide.
- **Flag:** RPE 10 is not automatically bad. On a planned last set, an AMRAP or isolation work, RPE 10 may be the target (E4). The trigger should compare against the *planned* RPE where one exists, not fire on any RPE 10. This refines ADR 0006 and needs Ben's approval.
- E8/E13 are the labelled offline fallback. Future changes stay proposals (rule 2).
- Any %1RM or e1RM derived from RPE charts is an **estimate** and must be labelled (rule 6).
- Pain overrides all of these. Progression for that movement stops and the coach doesn't diagnose (rule 9).

---

## Details

### 1. Weekly volume per muscle

**Documented fact**
- Schoenfeld, Ogborn & Krieger (J Sports Sci 2017; 15 studies): graded increase in hypertrophy from < 5 to 5–9 to 10+ weekly sets per muscle (5.4% → 6.6% → 9.8%). There was little data above 10 sets, and only 2 of the studies used trained lifters. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6303131/> (checked 2026-10-08)
- Pelland et al. (Sports Medicine, 2026; preprint 2024; 67 studies, 2,058 participants): hypertrophy keeps rising with volume, with diminishing returns. Strength plateaus much earlier. Counting indirect sets as ½ ("fractional") fitted best. A related preprint reported no detectable extra benefit beyond ~31 fractional sets/week for hypertrophy and ~3 for strength. Those figures are provisional. <https://sportrxiv.org/index.php/server/preprint/view/537> (checked 2026-10-08; full journal text not read)
- ACSM 2026 position stand (umbrella review of 137 systematic reviews, chair S. Phillips): about 10 sets per muscle per week for hypertrophy. Any regular training beats none. <https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/>, <https://www.newswise.com/articles/acsm-unveils-landmark-2026-resistance-training-guidelines-first-update-in-17-years> (checked 2026-10-08; full text paywalled)

**Expert opinion**
- RP (Israetel et al.) "volume landmarks": MV ≈ 6 sets/week; MEV → MRV progression within a block (example 12 → 20 sets over 5 weeks, then deload). Sets are judged by soreness and performance scores. RP sells an app and books (commercial interest). <https://rpstrength.com/training-volume-landmarks-muscle-growth/> (2017 article, checked 2026-10-08)

**Disagreement:** sources agree that more volume helps hypertrophy. They disagree on the upper range (20 vs 30+ sets). Very high volumes come mostly from a few trials that drew debate. For a time-limited person also doing endurance work, 10–20 is the practical range (inference).

### 2. Load and rep ranges

**Documented fact**
- Schoenfeld et al. 2017 (JSCR; 21 studies, sets to failure): low (≤ 60% 1RM) and high loads gave similar hypertrophy, and high loads were better for 1RM strength. <https://pubmed.ncbi.nlm.nih.gov/28834797/>
- Currier et al. 2023 (BJSM network meta-analysis; 178 strength / 119 hypertrophy studies): > 80% 1RM maximised strength. The top strength prescription was high-load, multi-set, 3×/week. All prescriptions grew muscle comparably; multi-set ranked highest. <https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/>
- ACSM 2026: ~80% 1RM, 2–3 sets per exercise for strength; 30–70% 1RM moved fast for power. (Newswise link above.)

**Practice:** RP treats 5–30 reps at 30–85% 1RM within 0–4 RIR as productive hypertrophy work (RP link above).

### 3. Proximity to failure, RPE/RIR and its reliability

**Documented fact**
- Refalo et al. 2023 (Sports Med; 15 studies): no clear advantage of momentary failure over non-failure for hypertrophy. A trivial edge (ES 0.19) appeared under loose failure definitions. Possibly a non-linear relationship. <https://link.springer.com/article/10.1007/s40279-023-01946-6>
- Robinson et al. 2024 (Sports Med; meta-regressions, RIR estimated from study descriptions): hypertrophy increases as sets get closer to failure. Strength gains are largely unaffected by proximity. <https://sportrxiv.org/index.php/server/preprint/view/295>
- Morán-Navarro et al. 2017 (Eur J Appl Physiol; n = 10): failure protocols needed markedly longer neuromuscular recovery, around 24–48 h more, than matched non-failure work. <https://pubmed.ncbi.nlm.nih.gov/28965198/>
- ACSM 2026: training to failure did not consistently improve outcomes for average adults (Newswise link).
- Zourdos et al. 2016 (JSCR): the RIR-based RPE scale (RPE 10 = 0 RIR, 9 = 1 RIR …) tracks bar velocity inversely. Experienced lifters rated more accurately near maximum. <https://openrepository.aut.ac.nz/items/efef3b25-6701-4fb5-bb82-55fcd2a26027/full>
- Halperin et al. 2022 (Sports Med; 12 studies, 414 people): people under-predict reps to failure by ~1 rep on average (95% CI 0.17–1.73) with huge heterogeneity (I² ≈ 98%). Accuracy is better closer to failure and in lower-rep sets. <https://pubmed.ncbi.nlm.nih.gov/34542869/>

**Inference:** a single RPE 10 or RPE 6 is a strong enough signal to *offer* a change (ADR 0006). A 0.5-point difference is within noise and shouldn't drive changes.

### 4. Progression methods

| Method | Evidence | Notes |
|---|---|---|
| Double progression (reps then load) | Moderate: Plotkin et al. 2022 (PeerJ, 8 wk, trained): rep progression and load progression gave similar hypertrophy; strength slightly favoured load (+2 kg, CI crosses 0). <https://peerj.com/articles/14142> | Fits equipment with coarse increments (brief §4: dumbbell racks, stacks, machine max) |
| Top set + back-offs | Weak/Practice: RPE-stop back-offs at 2/4/6% below the top set raised volume as the drop grew (Helms et al., 12 powerlifters). <https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full> | Common in RTS / Barbell Medicine style programmes |
| Percentage-based (from training max) | Moderate: as effective as autoregulation for strength in pooled data. | 5/3/1, Juggernaut (see programmes.md) |
| RPE-based autoregulation | Moderate: Hickmott et al. 2022 (Sports Med Open; 15 studies): autoregulated vs standard load prescription gave similar strength (MD +2.1 kg, p = 0.09). RPE-based subgroup trended in favour (+3.2 kg, p = 0.06). <https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/>. Helms et al. 2018: RPE loading ≥ %1RM loading for strength (n = 21). <https://pmc.ncbi.nlm.nih.gov/articles/PMC5877330/>. Larsen et al. 2021 review: subjective + objective methods both effective. <https://peerj.com/articles/10663> | Depends on rating accuracy (§3) |
| APRE (rep-based set-to-set adjustment) | Weak: Mann et al. 2010 (JSCR; n = 23 college football players, 6 wk) APRE > linear periodisation for bench and squat. <https://scholarship.miami.edu/esploro/outputs/journalArticle/THE-EFFECT-OF-AUTOREGULATORY-PROGRESSIVE-RESISTANCE/991031785742302976> | Reps on set 3 set the load for set 4 and next week (e.g. APRE-6: 3 reps → −5 lb; 5 reps → same; 8–12 → +5–10 lb; per <https://longtermtraining.substack.com/p/apre-removing-the-guesswork-for-strength>) |

### 5. Reducing load mid-session after a very hard set (RPE 10 / rep miss)

There is **no trial** testing "what to do after an unplanned RPE 10 mid-session." The relevant material:
- **APRE (Weak):** a formal rule that adjusts the next set's load from reps achieved. Too few reps → reduce. Many reps → increase. (Links above.)
- **RTS "load drop" / fatigue percent (Practice):** after reaching the target RPE, drop ~3–7% (low/medium/high stress) and repeat until the RPE comes back. Tuchscherer is a commercial coach (RTS). <https://elitefts.com/education/a-reactive-training-manual-overview> (secondary overview)
- **RPE-to-%1RM charts (Practice):** each RPE point ≈ 2–3% of 1RM at moderate reps, larger near singles. These are population averages and need personal calibration. <https://fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained>
- **Juggernaut (Practice):** "Making reps makes you stronger, missing them doesn't." Heavy sets stay around RPE 8–9.5 (Chad Wesley Smith, 2013). <https://www.jtsstrength.com/going-heavy-on-the-juggernaut-method>
- **Fatigue cost (Moderate):** failure sets lengthen recovery (Morán-Navarro 2017; Pareja-Blanco 2019 velocity-loss studies, summarised in §3).

**Inference for the coach:** after an over-target RPE 10 on a compound with sets remaining, the defensible options are (a) reduce load ~5–10% (round down to achievable), (b) keep load and cut reps by the overshoot, or (c) drop one set if time or fatigue matters. Which option fits depends on the goal (strength: keep load, cut reps; hypertrophy: cut load, keep reps). For the brief's scenario 1 (bench 115 kg × 4 @ RPE 10), assuming it was planned for ~RPE 8, a typical offer is 105–110 kg for the remaining sets at the planned reps, or 115 kg × 2–3. Final numbers come from the coach and are snapped by the guardrails.

### 6. Rest intervals

- Singer et al. 2024 (Front Sports Act Living; Bayesian meta; 9 studies): hypertrophy estimates slightly favour longer rest for arm/thigh in controlled comparisons (credible intervals cross 0). Short and long rest are both viable for untrained people; longer may help trained people. <https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/text>
- The brief's preset examples (warm-up 60 s, standard 90 s, heavy 180 s) are consistent with this. Ben may prefer 120 s as "standard" for compounds (inference).

### 7. Deloads

- Coleman et al. 2024 (PeerJ; trained; 9 weeks): a 1-week full break at week 5 gave no hypertrophy or power benefit and slightly worse lower-body strength than training straight through. <https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/>
- Bell et al. 2023 (Sports Med Open; Delphi, 21–34 coaches): defines deload as reduced training stress to manage fatigue and improve preparedness. Background practice is every 4–6 weeks for ~7 days. Volume and effort are the variables most often reduced. <https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/>. A 2025 practical guide says every 4–8 weeks, commonly pre-planned. <https://shura.shu.ac.uk/35313/>
- **Disagreement:** coaches value deloads; the only RCT (a full break, not a reduced-load week) found no benefit. Reduced-load deloads are untested (inference: low risk, possible benefit for joints/motivation, especially with concurrent endurance load).

### 8. Frequency

- Schoenfeld, Grgic & Krieger 2019 (J Sports Sci; 25 studies): with volume equated, frequency doesn't meaningfully change hypertrophy. Higher frequency helps when it adds volume. <https://pubmed.ncbi.nlm.nih.gov/27102172/> (the PubMed record linked is the 2016 predecessor meta-analysis; the 2019 update agrees)
- Grgic et al. 2018 (Sports Med): strength benefit from higher frequency disappears when volume is equated. <https://vuir.vu.edu.au/37695/>
- Pelland et al. (2026): when modelled jointly, frequency has a positive, diminishing effect on strength and a negligible one on hypertrophy. (Link above.)
- ACSM 2026: each major muscle group ≥ 2×/week.

### Copyright and availability
All summaries above are from abstracts, open-access full texts or free coach pages. ACSM 2026 full text is paywalled (HTTP 402 when checked). If Ben has access, he can add a copy to the app library for exact tables.
