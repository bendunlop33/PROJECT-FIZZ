# Behind on the plan this week: the "Adjust today?" offer

**Summary (plain words, for Ben)**
1. You're **behind** when this week's plan days still to do won't fit in the training days you have left: your set weekdays (Set days), or your usual pace (Any days). One rule, computed by code.
2. When you're behind, today's best workout is **one session at your usual length**, not two crammed together. Start from the missed day that covers what nothing else this week will (main lifts not yet trained, then muscles with no sets yet), then use whatever room is left for the next most-missed muscles. Missed sets are dropped, not made up later.
3. With no AI, the built-in rule picks the **whole day** that scores best on the same order, labelled `Built-in`. The coach can swap up to 2 items in from other missed days.
4. It's only ever an offer, at most once a day. It's never shown in a lighter or deload week, after you've trained today, or when you've already picked today's day. Pain holds and every other guardrail apply unchanged.

*Library file with **candidate** rules MS1–MS9 (Coaching knowledge, CLAUDE.md rule 10). They aren't in the playbook until Ben approves them. Not medical advice: pain or injury holds progression on that movement and the coach suggests seeing a professional; it never diagnoses (CLAUDE.md rule 9, one-session hold per CHANGELOG 8 Nov). Compiled by the training researcher on 2026-11-08; all sources checked 2026-11-08 unless a line says otherwise. Builds on approved rules 1 (short week: keep loads, cut sets, no make-up), 2, 3, FQ1–FQ3, VC1–VC4, LW1–LW3, SF1–SF9 (approved 8 Nov), and training-blocks.md §4.1–4.1a (week counting, Up next, this week's slots).*

**Trigger.** Ben, 8 Nov 2026: *"If the app was good it would have seen this all too given I have a plan."* He'd missed Pull A and Upper B and had to ask the coach for the best workout for today. The coach replied: "back work first, then arms and core, not cramming every missed session into today". Ben approved a Today offer (CHANGELOG 8 Nov, "rules researched first").

## Candidate playbook rules

Terms (all derived from logs and the plan, never stored, never inferred: rule 6):
- **Week** = Mon–Sun in the plan's time zone (training-blocks §4.1).
- **Not done** = plan days this week that no workout has filled, using the existing one-workout-one-plan-day count. Days Ben skipped this week (`Skip this week`) and paused days aren't counted. In a lead-in or mid-week-start week, only days still possible from the start count (CHANGELOG 28 Oct).
- **Planning day** = today. Once a gym workout has been finished today, it's tomorrow (training-blocks §4.1a rule 3).
- **Direct sets** = hard working sets for a group's lead exercises (V1/V4 amendment, 1 Nov). Warm-ups and cardio never count (WU1, CW1).
- **Later days** = the plan days the week still has placed after the planning day. Set days: the scheduled weekdays ahead, as `setDaysWeekSlots` places them. Any days: the next *slots − 1* days in Up next order, leaving out the day being scored.

| ID | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| MS1 | **One definition of "behind".** Behind by *k* = not-done plan days − training slots left this week (planning day to Sunday), and the offer needs *k* ≥ 1. **Set days:** slots = the plan's own scheduled weekdays from the planning day on. Rest days the reflow might borrow aren't counted. **Any days:** slots = ⌈N × days left ÷ 7⌉, capped at days left, where N = plan days a week and days left includes the planning day. That is his usual pace, so finishing doesn't depend on training every remaining day. Shown as `2 days behind`. | A plan in use (builder plan with weeks) | **Practice** (no study defines "behind"; built on approved week counting) | training-blocks.md §4.1–4.1a; CHANGELOG 28 Oct, 31 Oct |
| MS2 | **When not to offer.** No offer when: it's a deload or lighter week (extends approved LW3, "never counts as behind"); the plan is paused today; a gym workout is finished or open today; Ben has already chosen today's day (picker, `Make next`, `Do today instead`, a move onto today); today's check-in says ill (the check-in's rest suggestion wins); or a return-to-load offer applies (≥ 14-day gap, candidate R2). **At most once a day:** Skip or ✕ hides it until tomorrow. | Before showing the offer | **Practice** + approved LW3 | LW3; check-in.md; [return-to-load.md](return-to-load.md) R1–R2 |
| MS3 | **One session at the usual length; no make-up.** Today's offer fits Ben's usual session length (today's `Length`, else his stated minutes) through approved rule 1's budget, warm-ups inside D17's 10 min. It never merges two full days, adds sets beyond a day's planned counts, or puts > 8 direct sets on a group (FQ2/VC3). Missed days' sets are dropped, not carried into later days (rule 1, "short week: keep the loads, cut sets, no make-up"). Longer only if Ben asks; his yes then overrides the coach's limits (CHANGELOG 8 Nov) but not achievable loads (rule 4). | Building the offer | Short gaps cost little: **Moderate**. Weekly sets drive growth (losing sets loses some stimulus): **Strong**. Per-session diminishing returns: **Moderate**; the 8: **Weak** | [Halonen 2024](https://europepmc.org/article/MED/39364857); [Ogasawara 2011](https://europepmc.org/article/MED/21771261); [McMaster 2013](https://ro.ecu.edu.au/ecuworks2013/788) (checked 2026-10-09); [Pelland 2025/26](https://doi.org/10.1007/s40279-025-02344-w); [Remmert 2025](https://sportrxiv.org/index.php/server/preprint/view/537) (checked 2026-11-02); rule 1 |
| MS4 | **Priority order for today (shared by the coach and the built-in rule).** Score each not-done plan day as today's base. Higher in the list wins; later items only break ties. (1) **Main lifts:** the most plan main lifts that would get their first exposure this week today and aren't on a later day. (2) **Uncovered groups:** the most direct sets for groups with 0 direct sets this week and none on a later day. (3) **Yesterday:** prefer a day whose lead groups didn't get ≥ 4 direct hard sets yesterday. This is a soft tie-break, never a block; the run rule (RUN1) still applies as approved. (4) **Up next's existing order** (least recently trained, then schedule or plan order). | Choosing today's base day | (1) frequency helps strength: **Moderate**; main lifts first: **Practice**. (2) weekly sets per muscle drive growth: **Strong**; "0 first": **Practice**. (3) 24–48 h recovery, longer after failure: **Weak–Moderate**; same muscle on consecutive days still works at moderate per-session volume: **Moderate** | [Pelland 2025/26](https://doi.org/10.1007/s40279-025-02344-w); [Schoenfeld 2019](https://doi.org/10.1080/02640414.2018.1555906); [Morán-Navarro 2017](https://doi.org/10.1007/s00421-017-3725-7); [Pareja-Blanco 2020](https://europepmc.org/article/MED/30036284); [Helland 2020](https://peerj.com/articles/10044); [Saric 2019](https://doi.org/10.1519/JSC.0000000000002909); [Colquhoun 2018](https://doi.org/10.1519/JSC.0000000000002414); [SBS (Pritchard)](https://www.strongerbyscience.com/adaptable-training-program/) |
| MS5 | **Coach's offer: base day + up to 2 swaps.** The coach starts from MS4's top day. It may replace that day's lowest-priority items (last accessories first, never its main lift) with **at most 2 exercises** from other not-done days. Those exercises must cover an uncovered group (MS4-2) or a main lift (MS4-1), at that day's planned sets and targets. Order: main lift first, then by group gap. It stays within MS3 and comes back through the existing today-only proposal (`propose_workout`, Apply/Skip, Undo). Its `Why?` names the facts in one line (`Back 0 sets this week; Upper B and Legs B won't fit`). | AI coach available | **Practice** (the coach's own 8 Nov reply; SBS "order by value") | [SBS (Pritchard)](https://www.strongerbyscience.com/adaptable-training-program/); CLAUDE.md rule 3 |
| MS6 | **Built-in offer (no AI): one whole day.** Labelled `Built-in`, it offers MS4's top day **as planned** (its own exercises, built-in targets, warm-ups, SF/HT rules), with no swaps or merging. If that day is already today's card, there's no `Adjust today?`, only the `2 days behind` status. | Coach unavailable (rule 1, ADR 0006) | **Practice** | ADR 0006; rule 7-F |
| MS7 | **The rest of the week stays as it is.** The offer changes today only. Later days, templates and the split aren't touched. If Ben trains an extra day, Up next carries on as now. Folding missed sets into later days is a structural change, so it's a proposal only when Ben asks (rule 3), and it must fit those days' usual length. | Always | **Practice** + rule 3 | CLAUDE.md rule 3; rule 1; [TrainRight](https://trainright.com/missed-workouts-guide-to-adjusting-training/) (contrast) |
| MS8 | **Guardrails unchanged.** A movement on a pain hold keeps its hold (that session and the next, CHANGELOG 8 Nov). Volume isn't moved onto or away from it to work around pain unless Ben asks. The offer never lifts a load above what the normal target rules give. Loads are snapped to the gym's real equipment within min/max (rule 4); completed sets are untouched (rule 2); the proposal is versioned, and a stale one is refused (rule 5). | Always | Guardrail | CLAUDE.md rules 2, 4, 5, 9 |
| MS9 | **Coach facts.** When Ben taps `Adjust today?` or asks what to do today, code sends: *k* and the not-done days; later days; per group, direct sets done this week vs the plan's weekly number; main lifts' exposures this week; yesterday's groups and hard sets; usual minutes and the set budget; pain holds; deload or lighter week. All are numbers from logs, nothing inferred (rule 6). | Coach context for the offer | Guardrail (rule 6) + Practice | CLAUDE.md rules 6, 10; SF7 pattern |

### Conflicts and flags (for Ben and the PM; not resolved here)

1. **Set days count vs this week's reflow.** MS1 counts Ben's scheduled weekdays only. When Up next's own day has passed, `setDaysWeekSlots` may place displaced days on rest days (training-blocks §4.1a), so the tiles could show every day placed while the card says `2 days behind`. Recommendation: keep MS1 as written (it compares against the days he chose to train) and have the designer make the tiles match, e.g. a borrowed rest day shown as a rest day with the day greyed. That's PM/designer work.
2. **Any days pace.** ⌈N × days left ÷ 7⌉ makes Any days "behind" once finishing would mean training every day left. The simpler option (behind only when it truly can't fit) would have stayed silent on Ben's Thursday in Any days. Ben may prefer that.
3. **MS2 extends LW3** ("a lighter week never counts as a stall or as behind") from the planned path to this offer. That's a small extension of an approved rule.
4. **Rule 3.** The offer is coach-raised, but Ben approved this specific offer (8 Nov) and it only applies on Apply. That fits rule 3's "offers … doesn't apply until Ben accepts". Swapping today's day is structural only for today; nothing future changes (MS7).
5. **CLAUDE.md rule 9 wording.** It still says pain "stops progression for that movement". The 8 Nov CHANGELOG makes that a one-session hold. MS8 follows the CHANGELOG; the PM owns CLAUDE.md.
6. **No guardrail overrides** (MS8).

---

## 1. Recommendation for Ben (one option)

Adopt MS1–MS9 together:
- Today's card says `2 days behind · Adjust today?` when this week's plan days won't fit in the days left (your weekdays, or your usual pace on Any days).
- Tap it and you get **one workout at your usual length**. It starts from the missed day that covers what nothing else this week will (main lifts first, then muscles with zero sets). With the coach, up to two exercises come in from other missed days. Without it, the built-in rule picks the whole day.
- The rest of the week isn't touched, and missed sets aren't made up. Not in deload weeks, at most once a day, and only an offer.

Why not cram two days into one: per session, the extra sets for one muscle are worth less and less above about 8. Missing a few days barely costs strength or size. A 90-minute session also blows your time and leaves you tired for the next one. Why not spread the missed sets over the rest of the week: it makes every later session longer or harder, and it's a change to future days, which stays your call (rule 3).

## 2. What the evidence says

### Documented fact

**Weekly sets drive growth; frequency mainly spreads them (Strong).**
- Schoenfeld, Grgic & Krieger 2019 (*J Sports Sci* 37:1286–95, 25 studies): "resistance training frequency does not significantly or meaningfully impact muscle hypertrophy when volume is equated". <https://doi.org/10.1080/02640414.2018.1555906> (abstract via Europe PMC, checked 2026-11-08).
- Pelland, Remmert, Robinson, Hinson & Zourdos 2026 (*Sports Med* 56(2)): gains rise with weekly volume with diminishing returns, more steeply so for strength. Frequency has consistent effects only on strength. <https://doi.org/10.1007/s40279-025-02344-w> (abstract via Europe PMC, checked 2026-11-08). The authors declare fitness-industry roles.
- *Implication:* for size, what a missed week loses is the sets, not the frequency. For strength, a main lift's exposure also matters, which supports MS4-1.

**Diminishing returns per session (Moderate; the cut-off is Weak).** Remmert et al. 2025 (preprint, not peer reviewed): per-session gains stop being detectably better at about 11 fractional (about 8 direct) sets, to be "interpreted cautiously". <https://sportrxiv.org/index.php/server/preprint/view/537> (checked 2026-11-02 for frequency-and-volume-caps.md). Merging two days' back work into one session would push back past that point for little extra.

**Short breaks cost little and come back fast (Moderate).**
- Halonen et al. 2024 (*Scand J Med Sci Sports*), continuous vs periodic training: "trainees should not be too concerned about occasional short-term training breaks"; losses during breaks "regained rapidly during retraining". <https://europepmc.org/article/MED/39364857> (abstract via Europe PMC, checked 2026-11-08).
- Ogasawara et al. 2011 (15 untrained men, 3-week break): no significant loss of muscle CSA or 1RM during the break, and similar 15-week outcomes. <https://europepmc.org/article/MED/21771261> (from a search summary of the abstract; full text not read).
- McMaster et al. 2013: strength is largely kept for about 3 weeks. <https://ro.ecu.edu.au/ecuworks2013/788> (checked 2026-10-09; playbook "Goal changes").
- *Implication:* two missed days in a week don't need making up (MS3, MS7).

**Recovery takes 24–48 h, longer after failure (Weak–Moderate, small crossover trials).**
- Morán-Navarro et al. 2017 (*Eur J Appl Physiol*): non-failure protocols recovered "significantly faster between 24 and 48 h". Failure "considerably increases the time needed for the recovery of neuromuscular function". <https://doi.org/10.1007/s00421-017-3725-7> (abstract via Europe PMC, checked 2026-11-08).
- Pareja-Blanco et al. 2020 (*JSCR*): sets to failure, especially high-rep ones, gave "greater fatigue accumulation and slower rates of neuromuscular recovery". <https://europepmc.org/article/MED/30036284>
- Helland et al. 2020 (*PeerJ*, 16 strength-trained, 5RM loads): the strength session "required more than 48 h" of recovery. The introduction cites fatigue "typically requires 1–3 days of recovery". <https://peerj.com/articles/10044>

**Same muscles on consecutive days still work at moderate per-session volume (Moderate).**
- Saric et al. 2019 (*JSCR*, 27 trained men, 3 vs 6 times a week, volume equated): "similar strength gains". <https://doi.org/10.1519/JSC.0000000000002909>
- Colquhoun et al. 2018 (*JSCR*, 28 trained men, 3 vs 6 times a week, volume equated): no group differences. <https://doi.org/10.1519/JSC.0000000000002414>
- Zaroni et al. 2019 (*JSCR*, 18 trained men, each muscle 5 days a week vs once a week): similar strength and more muscle thickness for the high-frequency group (volume equating not stated in the abstract). <https://doi.org/10.1519/JSC.0000000000002643>
- All three via Europe PMC, checked 2026-11-08; full texts paywalled.
- *Implication:* "not the same muscles two days running" is a good tie-break but shouldn't block a pick (MS4-3). Ben's sets stop short of failure (rule 3), which is the faster-recovering case.

### Coaching practice (no direct evidence)

- **Stronger By Science, Hayden Pritchard** (evidence-based coaching site that sells programmes; undated, read 2026-11-08): with no deadline, "push the session, and all subsequent sessions, back by one day"; with a weekly structure, "carry on with the session we were up to and skip the last day of the week"; making up a day in a four-day week means "you are likely to end up with more sessions back-to-back"; order the week and each session by value ("days are performed in order of priority"); use set ranges such as "2-4 sets of 5" on busy days. <https://www.strongerbyscience.com/adaptable-training-program/>
- **TrainRight / CTS, Chris Carmichael** (endurance coaching company, updated 7 Mar 2025): for 1–2 missed days for low-stress reasons, "move on with your training like nothing happened". For 3–7 missed days, "redistribute 50-75% of the missed volume across future workouts within 3-4 weeks". This is endurance practice and is used here only as a contrast. <https://trainright.com/missed-workouts-guide-to-adjusting-training/>
- **Barbell Logic** (coaching company; podcast page, undated): "Combining or condensing sessions", identifying "anchor lifts", and resting when a miss reflects life overload. <https://barbell-logic.com/my-training-plan-got-destroyed-how-to-adapt-a-workout-plan/>
- **Approved rule 1** (playbook): "Short week: keep the loads, cut sets, and don't make them up later". Short weeks get merged full-body sessions with each main lift once plus priority groups. MS3–MS5 apply the same idea to a week that became short unplanned.
- **Couldn't read or verify:** RP's help page on missed days (HTTP 403). Wendler (5/3/1), Juggernaut and Starting Strength guidance on missed days is in paid books. Secondary summaries of Rippetoe say "do the missed session on the next available day", but I couldn't find a primary source. No meta-analysis or trial compares ways of handling missed sessions.

### Where sources disagree, and why

- **Carry on in order and drop the last day (SBS)** vs **do the missed day next (Starting Strength, secondary)** vs **redistribute 50–75% over weeks (TrainRight).** The difference is the programme type. A novice linear programme rotates the same few lifts, so the next session *is* the missed one. A weekly split loses different muscles depending on which day goes. Endurance plans build aerobic load over weeks, which is why they redistribute. For Ben's 4–6-day split, "which day goes" matters most, and that is what MS4 decides.
- **Combine (Barbell Logic) vs don't cram (SBS).** Both can be right. Combining *selected* key work within normal time is what MS5 allows. Combining two full sessions isn't.

### Inference (mine)

- Under Ben's plans, the cost of a missed day falls mostly on the groups and main lifts that **no other day this week** covers. Scoring on those (MS4-1, MS4-2) is what "most important missed day" means in a split, and it reproduces the coach's 8 Nov answer.
- The built-in rule shouldn't compose new sessions (MS6). Without AI, a mix of exercises from two days has no tested order, warm-ups or target history. A whole planned day keeps all of that.

## 3. Worked example (Ben's week, 8 Nov pattern)

*Exercise lists are illustrative. Real numbers come from his plan's Plan › Muscles.* Five-day Set days plan: Mon Push A, Tue Pull A, Wed Upper B, Thu Legs B, Sat Legs A. Muscle focus, main lifts bench (Push A), barbell row (Pull A), overhead press (Upper B), deadlift (Legs B), squat (Legs A). Today is Thu, about 60 min, nothing trained Wed.

**MS1.** Not done: Pull A, Upper B, Legs B, Legs A (4). Slots from Thu: Thu, Sat (2). **Behind by 2**, so the card shows `2 days behind · Adjust today?` (Any days instead: days left 4, ⌈5 × 4 ÷ 7⌉ = 3 slots, behind by 1, with the same pick below.)

**MS3 budget.** 60 min with a 3-set heavy main lift (h = 3): 3 + ⌊(60 − 10 − 12) ÷ 3⌋ = **15 working sets**.

**MS4 scoring** (later day: Legs A on Sat):

| Candidate | (1) Main lifts first this week, not later | (2) Direct sets for uncovered groups | (3) Yesterday | Result |
|---|---|---|---|---|
| Pull A (row 3, pulldown 3, cable row 2, face pull 2, curl 3) | 1 (row) | back 8 + biceps 3 + rear delts 2 = **13** | nothing trained | **Top** |
| Upper B (OHP 3, pull-up 3, DB bench 3, cable row 3, lateral 2, curl 2, pushdown 2) | 1 (OHP) | back 6 + biceps 2 = 8 | nothing | 2nd |
| Legs B (deadlift 3, leg press 3, leg curl 3, calf 3, leg raise 3) | 1 (deadlift) | core 3 (Legs A has none) | nothing | 3rd |

Quads, hamstrings, glutes and calves are covered by Saturday's Legs A. Chest, shoulders and triceps were done Monday.

**Built-in (no AI), MS6:** offers **Pull A** as planned (13 sets, about 52 min), `Built-in`. Apply or Skip.

**Coach, MS5:** base Pull A (13 sets) + 2 sets of hanging leg raise from Legs B (core uncovered) = 15 sets, about 60 min. Back stays at 8 direct (at the cap, not above). `Why?`: `Back 0 sets this week; Upper B and Legs B won't fit; core from Legs B`. If Ben's focus were Strength, the coach might instead swap face pull + cable row (4 sets) for 3 heavy OHP sets (main lift with 0 exposures), keeping h and the budget in check.

**After:** Saturday is still Legs A. Upper B and Legs B are dropped for this week (no make-up). If Ben trains Fri or Sun anyway, Up next offers the next day as it does now. Week totals: back 8 of the plan's 14, biceps 3 of 5, legs 1 exposure. Nothing is flagged for being trained once (FQ1).

**Pain variant:** if the row was mentioned for pain on Mon's session, it's on its one-session hold. It stays at its held target, the offer doesn't add other back sets to make up for it, and the coach suggests seeing a professional if pain continues (MS8).

**Deload variant:** in a deload or lighter week, no offer (MS2).

## 4. What changes in the app (for PM, designer, developer; no code here)

- **Domain (pure, derived, tested):** a `weekBehind` function returning *k*, the not-done days, slots and mode (MS1), with MS2's exclusions. A `behindPick` that scores candidates (MS4) and gives the built-in day (MS6). Both read the existing week count, `setDaysWeekSlots`, `upNextOrder`, muscle-set counting (V1/V4) and the plan's weekly numbers. Unit tests: the worked example (Set days k = 2 → Pull A; Any days k = 1), a deload week (no offer), a finished-today case, a pin, a pain hold and the 6-day pace edge.
- **Today card:** `2 days behind` plus `Adjust today?` (copy minimal; explanation behind `Why?`). Tapping it opens the coach's today-only proposal (Apply/Skip, Undo) or the labelled built-in day. Skip or ✕ means no offer until tomorrow. Applying makes the workout fill the chosen plan day through the existing link rules, so tiles and Up next reflow as now.
- **Coach:** the MS9 facts and MS3/MS5 bounds in the instruction. Its proposal is checked by code: within the set budget, ≤ 8 direct per group, ≤ 2 swapped-in exercises, main lifts at their normal targets, pain holds kept, loads snapped.
- **Not changed:** later days, templates, Up next's rule, the week count, rest-day reflow (but see flag 1), and 7-F targets.

## Copyright and availability

Summaries and short quotes only. Paid or paywalled: Saric 2019, Colquhoun 2018, Zaroni 2019, Halonen 2024 and Pareja-Blanco 2020 full texts; Pelland journal version; *5/3/1 Forever*, *Juggernaut Method 2.0*, *Starting Strength* (missed-day guidance); RP's help centre (blocked when checked). Ben can add his own copies to the library.
