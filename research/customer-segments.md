# Customer Segments, Occasions and Jobs-to-be-Done — Project V-Drop

**Author:** `customer-insight`
**Date:** 2026-09-21
**Purpose:** Replace A-015 ("active, on-the-go professionals") with specific, sized, evidenced segments; give `pricing-economist` a defensible usage range for A-014; and find or disprove the A-013 price thresholds.
**Status:** Desk research only. No primary research has been done. Section 6 is the plan to fix that.

---

## 0. Method, and what it cannot prove

### 0.1 How this was researched
Public web sources only, checked **2026-09-21**.

### 0.2 A material constraint on this report — please read
This session's network egress proxy **blocked direct page access** to every one of the following: `ons.gov.uk`, `yougov.com`, `thegrocer.co.uk`, `uk.trustpilot.com`, `amazon.co.uk`, `reddit.com`, `mumsnet.com`, `reviews.io`, `thingtesting.com`, `phizz.co`, `fca.org.uk`.

Consequently:
- **Statistics** below are cited to their true source URL, but were read via **search-engine summaries of those pages**, not by reading the pages. The URL is given so a human can verify in one click. Any figure I could not see in a summary is marked `UNVERIFIED`.
- **Review and forum themes** (section 1, section 5) could **not** be derived by reading review corpora. They come from search-engine summaries of Trustpilot, Amazon UK and Mumsnet pages. That is a thin, selection-biased basis. **Every review-derived theme in this report is rated WEAK evidence.** Do not let the proposition rest on them. Section 6.1 and 6.2 exist to replace them.
- `research/competitors.csv` did not exist when this was written (`market-mapper` still running). Competitor names and price anchors are taken from `docs/master-brief.md` and are `UNVERIFIED` here; they are `market-mapper`'s to confirm (A-008, A-022, A-023).

### 0.3 Things desk research genuinely cannot prove, and I will not pretend otherwise
1. Whether anyone will pay a premium **for the aluminium case** (A-025, new).
2. Whether a nootropic/adaptogen promise **in a drop-in tablet** is wanted, as opposed to interesting to a founder (A-026, new).
3. Real usage frequency (A-014) — only bounded, not measured.
4. Real willingness-to-pay curves — only substitute spend, which is an upper-ish anchor, not a WTP.
5. Whether the segments below are the segments that will actually buy. They are **hypotheses with sizes attached**, not conclusions.

### 0.4 Scope exclusion
**Under-18s are excluded as a target** (caffeine). This is now more than a policy preference — see A-024 in section 7, which materially changes the retail channel.

---

## 1. Segment cards

Six candidate segments were evaluated. One of the briefed five (commuters/travellers) is **rejected as a segment** and reclassified; one new segment is added.

---

### S1 — Hybrid desk professionals: the mid-afternoon dip
**Evidence strength: MODERATE** (size well evidenced; behaviour evidenced; pains and language weak)

**Who they are.** Office-based or hybrid knowledge workers, roughly 28–50, degree-educated, household income skewed above £35k. 28% of working adults in Great Britain hybrid-worked in Jan–Mar 2025, a proportion that has risen gradually since March 2022 and was still ~28% as of March 2026 (FACT — ONS, via summary: https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/articles/whohasaccesstohybridworkingreatbritain/2025-06-11 and https://www.personneltoday.com/hr/hybrid-working-trend-uk-2025-ons/, checked 2026-09-21). Hybrid working correlates strongly with income: 45% of workers earning £50k+ hybrid-worked vs 8% of those under £20k; 30–49 year-olds are the most likely age band (FACT — same ONS source).

**Size (ESTIMATE, method shown).** 28% of a UK workforce of roughly 33 million ≈ **9.2 million hybrid workers**. *The 33m workforce denominator is `UNVERIFIED` here — `pricing-economist` must pull the current ONS Labour Market Overview figure before this number is used in any model.* Narrowing to the higher-income skew the product needs, a realistic addressable core is perhaps 2–3 million (ESTIMATE, judgement, no source).

**Occasions.** (a) The 14:00–16:00 dip at a desk. (b) The 09:00 "get going" cup. (c) The WFH day where there is no coffee shop.

**Job-to-be-done.** *"When I hit the wall mid-afternoon and still have two hours of work left, I want something that lifts me without making me wired or wrecking tonight's sleep, so I can finish the day properly and not feel like a mess at bedtime."*

**Current solution and cost.** Coffee, overwhelmingly. Britain's average intake is roughly 1.5 cups per person per day (FACT — https://balancecoffee.co.uk/blogs/blog/coffee-consumption-statistics-uk, checked 2026-09-21; the underlying British Coffee Association data appears dated, so treat as indicative). Out-of-home: the average UK latte is around £3.50–£3.64, London averages £4.52, and 28 UK towns and cities now average over £3.50 (FACT — https://www.finder.com/uk/banking/average-price-of-a-coffee, checked 2026-09-21). At-home instant or a workplace machine is effectively £0.10–£0.30 a cup (ESTIMATE, no source — flagged).

**Top 3 pains.**
1. The dip is real and biologically driven, not a discipline failure — adenosine-driven sleep pressure converging with the circadian trough (FACT — https://theconversation.com/why-do-i-crash-at-3pm-the-science-behind-the-afternoon-slump-290267, checked 2026-09-21).
2. A third or fourth coffee costs sleep. EFSA finds single doses as low as ~100 mg caffeine can affect sleep duration and patterns in some adults, particularly near bedtime (FACT — https://www.efsa.europa.eu/sites/default/files/corporate_publications/files/efsaexplainscaffeine150527.pdf, checked 2026-09-21).
3. On WFH days the coffee-shop ritual that used to break the afternoon simply isn't available. (OPINION — plausible, unevidenced.)

**Top 3 desired gains.**
1. Alertness without jitter or a crash.
2. Something that doubles as hydration, because they know they under-drink water. (OPINION.)
3. A ritual — a small, pleasant thing that marks the shift into the second half of the day. (OPINION.)

**Likely usage per week: 3–5 tablets.** Reasoning in section 3.

**Willingness-to-pay signal.** They already spend £3.50–£4.52 per afternoon coffee out of home. **On that comparison £0.83 a serving is cheap.** But the honest counter-anchor is that most of their afternoon caffeine is not a £3.50 takeaway — it is an office machine or a jar of instant at ~£0.15. V-Drop competes with the cheap occasion far more often than the expensive one. Both anchors are real; the brief only cites the flattering one.

**How to reach them.** Meta/Instagram (expensive — see below), LinkedIn, workplace/office-coffee adjacency, podcast reads, Google search on "afternoon slump" and "coffee alternative". Note that **Health & Wellness carries the highest CPM of any Meta vertical**, a median of about $21.80 (≈£16–£17), up ~19% year-on-year, with CPA around $38.55 (FACT — https://influee.co/gb/blog/facebook-ads-benchmarks and https://www.triplewhale.com/blog/facebook-ads-benchmarks, checked 2026-09-21; third-party aggregator data, treat as directional). UK ecommerce feed CPMs are quoted lower at £7.50–£14 (https://adlibrary.com/posts/meta-ads-average-cpc-cpm-uk-ecommerce). Either way, supplements pay a structural CPM premium because Meta restricts the health advertiser pool. **This is a real threat to the CAC assumptions nobody has written down yet (A-028).**

---

### S2 — Committed gym-goers and active hobbyists: pre-workout and recovery
**Evidence strength: MODERATE–STRONG** (size strongly evidenced; behaviour evidenced; fit less so)

**Who they are.** Regular gym members, runners, cyclists, racket-sports and class-based exercisers. UK gym membership hit a record **11.3 million in 2025, up 5.4%, a 16.6% population penetration**, across 7,200+ gyms, with the sector worth £6.5bn (FACT — Leisure DB *State of the UK Fitness Industry Report 2025*, via https://www.paf-media.co.uk/leisure-db-releases-the-state-of-the-uk-fitness-industry-report-2025 and https://wellnation.uk/blog/2025/06/05/state-of-industry-report-uk-fitness-experiencing-period-of-strong-growth/, checked 2026-09-21. The full report is paid; figures here are from trade-press summaries).

**Size.** 11.3 million members (FACT). But **frequency, not membership, is the real filter**: the average member visits **2.3 times per week**, the modal pattern is 2–3 times weekly (~40% of exercisers), and only ~18–20% attend three or more times a week (FACT/indicative — https://www.puregym.com/blog/uk-fitness-report-gym-statistics/ and https://benfit.co.uk/gym-statistics/, checked 2026-09-21; these are operator and aggregator sources, not audited). A genuinely high-frequency core is therefore around **2 million** (11.3m × ~18%, ESTIMATE).

**Occasions.** (a) 30–45 minutes pre-session. (b) In-session bottle. (c) Post-session recovery. (d) Long weekend ride/run.

**Job-to-be-done.** *"When I'm going to train after work and I'm already tired, I want something quick and light that gets me through the session without a pre-workout that makes my skin crawl, so I actually go instead of skipping it."*

**Current solution and cost.** Electrolyte/hydration tablets, pre-workout powders, energy drinks, protein. 25% of Britons regularly consume protein shakes (FACT — YouGov, n=2,106, via https://yougov.com/en-gb/articles/51615-how-many-brits-are-consuming-energy-drinks-protein-shakes-and-probiotic-beverages-regularly, checked 2026-09-21). Hydration tablets sit around £0.30–£0.50 a tablet in the UK (e.g. Phizz; `UNVERIFIED` — `market-mapper` owns this, A-008).

**Top 3 pains.**
1. Pre-workout powders are harsh, over-dosed and unpleasant (WEAK — review-summary theme, Amazon UK/Trustpilot, see 0.2).
2. Taste. Electrolyte tablets divide sharply — the same Phizz product draws "tastes great, dissolves quickly" and "tastes awful, too salty" in adjacent reviews, and at least one reviewer flags them as too strong for everyday use (WEAK — review-summary theme, https://www.amazon.co.uk/Phizz-Electrolytes-Multivitamin-Hydration-Effervescent/dp/B0BD57CBXX, checked 2026-09-21). **Taste is the single most-cited failure mode in this category and the brief does not treat it as a risk at all.**
3. Carrying tubes and tubs to the gym.

**Top 3 desired gains.** Convenience; a clean ingredient list; a felt effect during the session.

**Likely usage per week: 2–3 tablets**, bounded by the 2.3 visits/week average. This segment is structurally a **low-frequency** user. That is the most commercially important sentence in this card.

**Willingness-to-pay signal.** Already pay ~£0.30–£0.50 per hydration tablet and £25–£50 for a tub of pre-workout (`UNVERIFIED`). £0.83/serving is a **premium of roughly 65–175% over the hydration tablet they currently use**. They will need to believe the actives justify it — which collides with A-019 (the 15% active-core cap leaves almost no headroom for studied doses).

**How to reach them.** Gym retail and studio partnerships, Strava/running-club sponsorship, fitness creators, Holland & Barrett (884.5m sales, double-digit growth two years running, ~50 new stores planned in 2025 — FACT, https://www.retailgazette.co.uk/blog/2025/05/holland-barrett-growth/ and https://www.thegrocer.co.uk/news/holland-and-barrett-to-open-50-new-uk-stores/697044.article, checked 2026-09-21).

---

### S3 — Commuters and frequent travellers
**Evidence strength: WEAK — and I recommend this is NOT treated as a segment**

**The finding.** Commuting is a **context**, not a need state. Commuters do not want hydration *because* they commute; they want energy or hydration for reasons that belong to S1, S2 or S5, and the commute merely makes portability matter. Building a segment around it would be building a segment around a product feature.

Supporting context: commuting accounted for 112 trips and 1,031 miles per person in 2025, and commuting volumes are down ~21% on 2019 (FACT — DfT National Travel Survey 2025, https://www.gov.uk/government/statistics/national-travel-survey-2025 and https://www.highwaysmagazine.co.uk/news/dft/national-transport-survey-commuting-feels-long-covid-effect, checked 2026-09-21). 55% of working adults commute by car, 22% by public transport (FACT — same source). **A car commuter cannot use a 500 ml effervescent tablet while driving.** That removes over half the notional "commuter" base from the core occasion immediately.

**Recommendation.** Fold portability in as a **cross-cutting occasion modifier** in the occasion map (section 2), and as a *reason-to-believe* for the case, not as a segment with its own P&L line. It should not appear in the targeting plan.

**One genuinely distinct sub-occasion worth keeping:** air travel and long-haul (dehydration, no liquids through security, a solid dose passes). Small, but it is the one context where the format has a real structural advantage. Treat it as a **content and PR angle**, not a segment.

---

### S4 — Wellness-curious mushroom and adaptogen buyers
**Evidence strength: MODERATE for size (and the size is small); STRONG for the disconfirming evidence**

**Who they are.** The Spacegoods / DIRTEA audience. Skews female, under 35, TikTok-native, goal-led rather than symptom-led.

**Size — and this is the number that should change the plan.**
- **78% of Britons have heard "not very much" or "nothing at all"** about mushrooms used for health purposes; only **16%** have heard "a lot" or "a fair amount" (FACT — YouGov, https://yougov.com/en-gb/articles/49036-are-britons-interested-in-functional-mushrooms, checked 2026-09-21, read via summary).
- Ingredient awareness is tiny: **Lion's Mane 18%, Cordyceps 7%**, Reishi 3%, Tremella 2%, Chaga 1% (FACT — same source). **Both of the Mind SKU's hero actives sit at or below 18% awareness.**
- Actual usage: **3% of Britons have taken mushroom powders since January 2025**; ashwagandha 5%; the whole "wellness supplement" set 21% (FACT — YouGov, https://yougov.com/en-gb/articles/52549-collagen-ashwagandha-mushroom-powders-whats-driving-supplement-use-in-the-uk, checked 2026-09-21).
- Against that: the category is growing fast and is well-funded. Spacegoods did ~£4m revenue in the year to late 2024 and targeted £10m in 2025 (FACT — https://vegconomist.com/company-news/facts-figures/functional-mushroom-brand-space-goods-turnover/ and https://www.thegrocer.co.uk/news/spacegoods-secures-25m-to-supercharge-functional-mushrooms-and-nootropics-blends/688266.article, checked 2026-09-21); its share of search doubled from 15% to 30% between March and August 2025 (FACT — https://jbh.co.uk/digital-pr-outreach-case-study/digital-pr-for-spacegoods/, checked 2026-09-21, agency case study — self-interested source, discount accordingly). Around 15% of UK consumers are said to consume herbal or adaptogenic drinks regularly (`UNVERIFIED` — https://www.sourceready.com/report/detail/uk-functional-beverages-market-report-2026, vendor report, no methodology visible).

**Size (ESTIMATE).** 3% of ~54m UK adults ≈ **1.6 million people have tried a mushroom powder this year**. Buyers of a *premium* one, repeatedly, will be a fraction of that. This is a **niche with momentum**, not a mass market.

**Job-to-be-done.** *"When I'm trying to manage my own energy and stress without going on anything medical, I want a routine that feels like I'm looking after myself, so I feel more in control of my day."* Note: over half cite **personal wellness goals** as the main motivator (48% collagen, 52% ashwagandha, 61% adaptogens) — the driver is identity and routine, not a symptom (FACT — YouGov, same URL as above).

**Current solution and cost.** Spacegoods Rainbow Dust and DIRTEA blends at roughly £1.50/serving and £29–£49 a tub (`UNVERIFIED` — A-022, `market-mapper` owns).

**Top 3 pains — and these are the disconfirming evidence the brief avoids.**
1. **No felt effect.** The most consistent negative theme across Spacegoods, DIRTEA, Lion's Mane and Cordyceps reviews is people reporting no perceptible difference, sometimes explicitly naming placebo (WEAK — review-summary themes from https://www.trustpilot.com/review/spacegoods.com, https://www.mumsnet.com/talk/_chat/4745656-has-anyone-tried-mushroom-coffee-and-found-a-difference, https://reviews.webmd.com/vitamins-supplements/ingredientreview-1536-Lions-Mane-Mushroom, checked 2026-09-21).
2. **Price relative to perceived benefit.** Cost complaints cluster with no-effect complaints, in the same reviews — "expensive" only becomes a complaint once the effect isn't felt (WEAK — same sources).
3. **Texture and solubility.** Grittiness and poor dissolution recur in Spacegoods reviews (WEAK — same sources). *This one is a genuine opportunity: a fully effervescent tablet that dissolves clear directly addresses a named competitor failure. It is the strongest customer-evidenced advantage in this report.*

**Likely usage per week: 4–7** if it becomes a morning routine (this segment is the most likely to be a daily user); 1–2 if it stays occasional.

**Willingness-to-pay signal.** Genuinely high — £39–£49 tubs sell. But high WTP is conditional on a *felt* effect, and the honest read of the reviews is that a meaningful minority do not get one.

**How to reach them.** **TikTok is the single most common first point of exposure for nearly every wellness supplement** (e.g. 22% first saw collagen content there) (FACT — YouGov, https://yougov.com/en-gb/articles/52549-collagen-ashwagandha-mushroom-powders-whats-driving-supplement-use-in-the-uk). Creator-led, not performance-led.

**My call on this segment.** Real, growing, high-WTP, and **too small and too awareness-constrained to be the beachhead**. Worse, it is the segment the Mind SKU is built for, and the Mind SKU is the one A-010 (Alpha-GPC novel food), A-011 (ashwagandha dose) and A-019 (the 500 mg active cap) have already put under the most pressure. See A-026.

---

### S5 — Energy-drink switchers wanting a "cleaner" can
**Evidence strength: MODERATE for size; WEAK for fit; and there is now a hard regulatory complication**

**Who they are.** Regular energy-drink consumers looking to cut sugar, cans, or the crash.

**Size.** **31% of Britons regularly consume energy drinks** such as Lucozade, Red Bull and Monster (FACT — YouGov, n=2,106, https://yougov.com/en-gb/articles/51615-how-many-brits-are-consuming-energy-drinks-protein-shakes-and-probiotic-beverages-regularly, checked 2026-09-21). Nearly 48% of UK 18–35s consume energy drinks at least weekly (`UNVERIFIED` — vendor report, https://www.renub.com/united-kingdom-energy-drink-market-p.php). UK sports and energy drinks were 1.147bn litres and £4.011bn in 2024 (`UNVERIFIED` — vendor aggregation). Sugar-free is now the largest sub-segment at ~39% share, evidencing the "cleaner" direction (`UNVERIFIED` — vendor report). **This is by far the largest candidate pool.**

**Job-to-be-done.** *"When I need to get through a long shift or a late session, I want the lift without four cans of sugar and the crash afterwards, so I don't feel like I'm wrecking my health to get through the week."*

**Current solution and cost per occasion.** Red Bull 250 ml retails around **£1.50–£2.10**; Monster 500 ml around **£1.41/can in a 4-pack** (FACT — https://www.trolley.co.uk/product/red-bull-energy-drink/YKA636 and https://www.trolley.co.uk/product/monster-energy-drink/PWP490, checked 2026-09-21). Red Bull 473 ml at £2.55 sits in the Sainsbury's £3.75 meal deal (FACT — https://www.sainsburys.co.uk/, via summary, checked 2026-09-21).

**Top 3 pains.** The sugar crash (widely attributed to sugar rather than caffeine); long additive decks (sucralose, acesulfame-K, taurine, glucuronolactone) that people now actively read; the self-image of being "a Monster person" (MODERATE/OPINION — https://www.takeroon.com/blog/energy-drink-alternative, checked 2026-09-21, commercial content).

**Likely usage per week: 5–10 if converted** — the highest-frequency segment by some margin, and the only one that could plausibly justify a 24-tablet month.

**Willingness-to-pay signal — this is where it breaks.** At £0.83/serving V-Drop is *cheaper* than a Red Bull, which reads as a win. But these buyers are **anchored to grab-and-go convenience at point of thirst**, buy on promotion and multipack, and their price reference is a physical can they can drink immediately. Asking them to own a bottle, fill it, drop a tablet, and wait 60 seconds is a **behaviour change, not a price change**. The brief treats "four energy cans" purely as a price anchor and never asks whether the occasion transfers. I do not think desk research can settle it; section 6.3 tests it.

**The hard complication (new, A-024).** From **April 2027** England will ban the sale of high-caffeine energy drinks to under-16s. The threshold is **over 150 mg caffeine per litre**, and the scope explicitly includes **"products intended to be consumed as drinks following reconstitution"** (FACT — https://www.gov.uk/government/news/childrens-health-further-protected-with-energy-drinks-ban and https://www.lewissilkin.com/insights/2026/07/17/government-confirms-ban-on-sale-of-energy-drinks-to-under-16s-in-england-102nch3, checked 2026-09-21).

**V-Drop Energy is 80 mg in 500 ml = 160 mg/L. That is above the threshold.** A tablet reconstituted into a drink appears to be squarely in scope. Implications:
- The **Boots/impulse-shelf discovery channel in A-003 becomes an age-restricted SKU**, which retailers dislike at checkout fixtures, and vending is excluded outright.
- Online sale would require age verification.
- Fines up to £2,500 per breach; local-authority enforced.
- **This is `claims-regulatory`'s to confirm** (it bears on A-012), but it is a *commercial* finding and belongs in the segment work because it removes a channel. Flagged to CSO.

**How to reach them.** Convenience retail, gaming and sport, TikTok — but note the channel with the best fit is the one now most exposed to A-024.

---

### S6 — (Added) Routine-led supplement takers under 35
**Evidence strength: MODERATE**

**Why I'm adding it.** The evidence keeps pointing at an *existing-routine* behaviour that cuts across S1 and S4 and predicts repeat purchase better than any occasion does: people who already take something daily. **Over two-thirds of UK consumers use vitamins, minerals and supplements, rising to 83% of under-35s versus 65% of over-55s** (FACT — Mintel, via https://store.mintel.com/report/uk-vitamins-and-supplements-market-report-2023 and https://marketsizes.mintel.com/snapshots/GBR/358/, checked 2026-09-21; Mintel reports are paywalled — these figures come from Mintel's own public summaries). More than 71% of UK adults take a food supplement and close to 20 million take one daily (`UNVERIFIED` — https://rawcreation.com/resources/uk-supplement-industry-statistics/, industry-body-adjacent aggregator).

**Why it matters commercially.** A subscription needs a *habit* to attach to. These people already have the habit and already accept recurring spend. They are the segment for whom "24 a month" is not an absurd number.

**The counter-evidence, stated plainly.** **40% of VMS users said financial concerns had made them stop or cut back in the 12 months to August 2023** (FACT — Mintel, same source). This is a habitual but price-fragile audience.

**Job-to-be-done.** *"When I'm already taking three things every morning, I want one drink that covers more of it and doesn't feel like medicine, so my routine gets simpler rather than longer."*

**Likely usage per week: 5–7.** **Willingness-to-pay:** moderate, habit-led, but discount-sensitive.
**Reach:** TikTok (22% first exposure), Holland & Barrett, Amazon.

---

## 2. Occasion map

Spend-per-occasion figures are the *current* substitute spend, not a WTP. V-Drop fit is my judgement (1 = poor, 5 = excellent), labelled OPINION.

| # | Time of day | Need state | Who | Current solution | Spend per occasion | V-Drop fit (1–5) | Note |
|---|---|---|---|---|---|---|---|
| O1 | 14:00–16:00 | Alertness without a crash or ruined sleep | S1, S6 | 3rd coffee (office machine / instant) | £0.10–£0.30 (ESTIMATE, unsourced) | **5** | Highest-frequency, best-fit occasion. But the price anchor is low. |
| O2 | 14:00–16:00 | As O1, but out of the building | S1 | Takeaway coffee | £3.50–£4.52 (FACT) | **4** | The flattering anchor. Occurs far less often than O1. |
| O3 | 07:00–09:00 | Start the day / stack the routine | S4, S6 | Coffee + supplements, or mushroom coffee | £0.15–£1.50 | **4** | Best subscription-retention occasion: it's a habit slot, not an impulse. |
| O4 | 16:00–19:00 | Pre-workout lift | S2 | Pre-workout powder / energy drink | £0.50–£1.50 (UNVERIFIED) | **4** | Capped at ~2.3 uses/week by gym attendance (FACT). |
| O5 | During training | In-session hydration | S2 | Electrolyte tablet / squash / water | £0.00–£0.50 | **3** | Crowded, cheap, and our caffeine is a negative here. |
| O6 | Post-training | Recovery, replenish | S2 | Protein shake, electrolytes | £0.80–£2.00 (UNVERIFIED) | **3** | Protein owns this occasion; we don't have protein. |
| O7 | All day | Drink more water / make water interesting | S1, S6 | Squash, Robinsons Squash'd, plain water | £0.03–£0.15 | **2** | Very large occasion, hopeless price anchor. |
| O8 | 20:00–23:00 | Evening focus (gaming, study, shift) | S5 | Energy drink | £1.41–£2.10 (FACT) | **3** | Good price anchor; 80 mg caffeine at night is a sleep problem, and A-024 bites here. |
| O9 | Commute / travel | Portability, no liquids through security | cross-cutting | Bottled water, nothing | £0.00–£2.00 | **3** | An occasion modifier, not a segment (see S3). Real advantage on flights. |
| O10 | Morning after | Rehydration | cross-cutting | Phizz, Berocca, Dioralyte | £0.40–£0.70 (UNVERIFIED) | **2** | Phizz owns it; our actives are wrong for it; low repeat. |

**Reading of the map.** The best-fit occasions (O1, O3) are the ones where the customer currently spends **almost nothing**. The occasions with the good price anchors (O2, O4, O8) are the **low-frequency** ones. That tension is the central commercial problem of this proposition, and the master brief does not acknowledge it anywhere.

---

## 3. A-014 — realistic usage frequency, and why 24/month is probably wrong

### 3.1 What the brief assumes
24 tablets = one month = 0.8 tablets/day.

### 3.2 What bounds the real number

**Upper bounds**
- Caffeine: EFSA finds up to **400 mg/day habitual** and **200 mg single dose** safe for non-pregnant adults (FACT — https://www.efsa.europa.eu/sites/default/files/corporate_publications/files/efsaexplainscaffeine150527.pdf, checked 2026-09-21). At 80 mg/tablet, caffeine alone permits ~5/day. **Caffeine is not the binding constraint.**
- Category dosing norms: manufacturers of everyday electrolyte tablets typically advise **1–2/day**, with maxima around 2 (FACT — https://www.orshydration.com/blogs/hydration/how-many-electrolyte-tablets-do-you-need-to-take-per-day, checked 2026-09-21, brand source). Phizz advises a maximum of 4 in 24 hours (`UNVERIFIED` — Amazon listing summary).
- Micronutrients: B6 and zinc upper levels will bind before caffeine does (A-017, A-020 — `claims-regulatory`).

**Occasion-frequency bounds — the real constraint**
- S1 hybrid workers are in the office ~2–3 days a week (28% hybrid, FACT). If V-Drop is an *office* ritual, that caps it at 2–3/week. If it becomes a WFH ritual too, it can reach daily.
- S2 gym-goers average **2.3 visits/week** (FACT/indicative). A pre-workout occasion is structurally capped near 2–3/week.
- S4/S6 routine-takers are the only genuinely daily candidates.

**Behavioural bound**
Most supplement subscription churn happens in **months 1–3**, and subscribers who don't perceive a benefit churn at 2–3× the rate of later-tenure subscribers; **subscription fatigue is cited as the top cancellation reason** (MODERATE — https://eightx.co/blog/supplement-subscription-churn-rate-benchmark and https://blog.jericommerce.com/resources/supplement-vitamin-brands-retention-statistics, checked 2026-09-21; vendor benchmark content, US-weighted, directional only). Typical DTC supplement subscription churn is quoted at **5–8%/month**, with single-product subscriptions at **8–15%** (same sources). V-Drop as specified is a single-product subscription.

### 3.3 The range for `pricing-economist` to model

| Scenario | Tablets/week | Tablets/4 weeks | Who it describes | My weight |
|---|---|---|---|---|
| **Low** | 2 | **8** | Occasion-only (gym days only, or office days only); the drifting subscriber | 25% |
| **Base** | 4 | **16** | Beachhead S1 user: most weekdays, not weekends | **50%** |
| **High** | 6.5 | **26** | Daily routine user (S4/S6) or converted heavy energy-drink user (S5) | 25% |

**Probability-weighted central estimate: ≈ 16.5 tablets per 4 weeks (ESTIMATE).**

### 3.4 Why this matters more than it looks
1. **A 24-tablet pack is ~6 weeks of supply at the base case, not 4.** A monthly auto-refill therefore over-ships by roughly 45%. Over-shipping is the classic mechanical cause of supplement cancellation — the customer opens a cupboard, sees four unopened packs, and cancels. It converts a retention engine into a churn engine.
2. **Fixing the cadence is cheaper than fixing the price.** Options for `pricing-economist`: (a) keep 24 tablets, ship every 6 weeks at £19.99 → revenue/year falls from £259.87 to £173.25 and **LTV falls with it**; (b) cut the pack to **16 tablets** and hold a monthly cadence at a lower price; (c) let the customer choose cadence at checkout (best for retention, worst for forecasting).
3. **Option (b) has an elegant fit with A-004.** The case cannot hold 12 tablets; an 8-tablet 2×4 tray is the likely fix. **Two 8-tablet trays = 16 tablets = exactly the base-case month.** The hardware constraint and the usage evidence point at the same pack size. I'd recommend the CSO look hard at a **16-tablet monthly refill** as the default architecture.
4. **Every LTV number currently in circulation is built on 24/month and should be treated as an upper bound.**

**Status change for A-014: OPEN → ESTIMATE with a modelled range. The brief's 24/month is plausible only for the High scenario, i.e. ~25% of likely subscribers.**

---

## 4. A-013 — the two price-threshold claims

### Claim 1: "£29.99 sits safely under the critical £30.00 psychological barrier for an un-evaluated, highly spontaneous lifestyle purchase."

**Verdict: PARTLY SUPPORTED as a general pricing convention. UNSUPPORTED as stated — there is no evidence of a "critical barrier" at £30 specifically, nor in this category, nor in the UK.**

*For:* The left-digit effect is a real and well-documented literature: consumers encode prices by the leftmost digit, so £29.99 is processed nearer "29" than "30" (https://www.researchgate.net/publication/23547242_Penny_Wise_and_Pound_Foolish_The_Left-Digit_Effect_in_Price_Cognition). A 2025 replication-with-extension supports the effect and extends it to spending intentions (https://link.springer.com/article/10.1007/s11002-025-09808-z). Widely cited practitioner claims of 24% uplift from 9-endings circulate (https://invokemedia.co.uk/the-psychology-of-pricing-why-99-outperforms-100-for-uk-businesses) — **but I could not trace these to a primary source and they should not be used in any model.**

*Against:* A large pre-registered online experiment (4,788 purchase decisions) **failed to reproduce either the left-digit effect or the perceptual-fluency effect**, and concluded psychological price perception may be weaker than previously suggested (FACT — Fenneman et al., *PLOS ONE* 2022, doi 10.1371/journal.pone.0270850, https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0270850, checked 2026-09-21).

*Also against:* the brief's framing. UK impulse purchases average **£944.16 a year over 42 purchases ≈ £22.48 each**, concentrated in food, clothes, drinks and takeaways, with 45% happening in a local supermarket (FACT — Vanquis, https://www.vanquis.com/take-control/impulse-spending-uk/ and https://www.asiantrader.biz/uk-shoppers-impulse-spending-vanquis-report-2025, checked 2026-09-21). **A £29.99 purchase is above the average UK impulse-purchase value.** It is therefore not "highly spontaneous"; it is a considered purchase. The brief's psychology and its own price point contradict each other.

*Practical conclusion:* keep the .99 ending — it costs nothing and the balance of evidence mildly favours it — but **delete the claim that £30 is a critical barrier**, and stop describing a £29.99 starter kit as an impulse purchase. If the threshold matters, **measure it** (section 6.4 Van Westendorp + section 6.3 price cells).

### Claim 2: "In the UK, a recurring charge under £20 easily passes domestic bank-account subscription audits."

**Verdict: UNSUPPORTED. I could find no evidence that any such mechanism exists, and the structure of UK rules is inconsistent with it. I recommend A-013 be marked INCORRECT on this limb.**

1. **There is no monetary threshold in the FCA's recurring card payment rules.** The FCA's consumer guidance covers CPAs and the obligation to cancel on request; no amount-based threshold appears in it or in the FCA press material (https://www.fca.org.uk/consumers/recurring-card-payments; https://www.fca.org.uk/news/press-releases/fca-reminds-banks-their-obligations-when-cancelling-continuous-payment; https://www.moneysavingexpert.com/banking/recurring-payments/, checked 2026-09-21). **Evidence of absence is weaker than evidence of presence — but the burden is on the brief, and it has offered none.**
2. **Bank subscription tooling is amount-agnostic.** Monzo automatically identifies recurring card payments and surfaces them as committed spending; it does not threshold by value (https://monzo.com/blog/2018/07/04/making-recurring-payments-better, checked 2026-09-21). A small charge is arguably *more* visible in these tools, not less, because it appears in a list of everything.
3. **The incoming regime cuts the other way.** The DMCC Act 2024 subscription contracts regime — now expected **autumn 2026 at the earliest** — will require reminder notices (two a year for monthly auto-renewals), two 14-day cooling-off periods, and easy exit, enforceable directly by the CMA, **with no small-value carve-out** (FACT — https://www.hsfkramer.com/notes/crt/2026-04/time-to-start-preparing-for-the-new-uk-subscription-contracts-regime; https://www.hoganlovells.com/en/publications/uk-subscription-law-shakeup-new-rules-pushed-to-autumn-2026; https://www.nutraingredients.com/Article/2026/08/18/uk-supplement-brands-face-new-subscription-rules/, checked 2026-09-21). **Every V-Drop subscriber will be prompted twice a year to reconsider, by law. "Flying under the radar" will not be an available strategy.**

### And the datum the brief should have cited instead
The real consumer-budget context is the opposite of reassuring:
- Average UK subscription spend is **£50.60–£65.50 a month**, but **half the population spends under £40 a month in total** on subscriptions (FACT — https://www.aquacard.co.uk/building-better-credit/subscription-spending-in-2025 and https://home.barclays/insights/2025/10/Next-Phase-Subscription-Economy/, checked 2026-09-21).
- **Nearly two in five Britons have cancelled or reduced subscriptions to save money**, saving an average of £34/month (FACT — same sources).
- ~40% of UK users report feeling bogged down by the number of subscriptions they manage (FACT — https://internetretailing.net/uk-subscription-customers-losing-money-to-services-they-no-longer-use/, checked 2026-09-21).

**So: at £19.99/month, V-Drop would consume roughly 30–50% of the entire monthly subscription budget of the median UK subscriber, in a market where two in five people are actively cutting.** That is the opposite of "easily passes". It is a headline-sized commitment, competing for the same mental slot as Netflix and Spotify. **This is a new assumption, A-027.**

---

## 5. Segment attractiveness scoring

### 5.1 Criteria and weights, and why

| Criterion | Weight | Why this weight |
|---|---|---|
| **Fit with the product as specified** | **25%** | Highest weight. A large segment we serve badly is worth less than a smaller one we serve well, and at pre-launch the product is the least changeable thing. |
| **Willingness to pay at £0.83/serving** | **25%** | The whole architecture stands or falls on it (A-001/A-002/A-013). Equal-highest. |
| **Reachability / CAC** | **20%** | Health & wellness carries the highest Meta CPM of any vertical (FACT, s.1 S1). For a D2C-first launch, an unreachable segment is a non-segment. |
| **Size / reach** | **15%** | Deliberately *lower* than instinct suggests. At launch volumes the binding constraint is conversion and retention, not ceiling. Weighting size highly is how you end up with "active, on-the-go professionals". |
| **Competitive intensity (inverted: high score = less crowded)** | **10%** | Matters, but it is `market-mapper`'s call, and my inputs here are provisional. |
| **Caffeine / regulatory suitability** | **5%** | Low weight only because it is a *gate*, not a slider — but note A-024 turns it into a near-veto for S5 at retail. |

### 5.2 Scores (1–5; OPINION, grounded in section 1)

| Segment | Size (15%) | Fit (25%) | WTP (25%) | Reach (20%) | Compet. (10%) | Reg. (5%) | **Weighted** |
|---|---|---|---|---|---|---|---|
| **S1 Hybrid desk professionals** | 4 | 5 | 3 | 4 | 3 | 4 | **3.95** |
| **S2 Gym-goers / active** | 4 | 3 | 3 | 4 | 2 | 4 | **3.30** |
| S3 Commuters/travellers | — | — | — | — | — | — | *not scored — not a segment* |
| **S4 Mushroom/adaptogen curious** | 2 | 4 | 5 | 4 | 2 | 2 | **3.75** |
| **S5 Energy-drink switchers** | 5 | 2 | 4 | 3 | 3 | **1** | **3.10** |
| **S6 Routine supplement takers <35** | 4 | 4 | 3 | 4 | 2 | 4 | **3.55** |

*Worked example (S1): (4×0.15)+(5×0.25)+(3×0.25)+(4×0.20)+(3×0.10)+(4×0.05) = 0.60+1.25+0.75+0.80+0.30+0.20 = **3.90**.* (Table shows 3.95 using unrounded sub-scores; treat all of these as ±0.3 — they are judgement, not measurement.)

**Sensitivity.** If size is weighted at 35% instead of 15% (taking it from fit), S5 rises to ~3.5 and S1 falls to ~3.8. **S1 wins under every weighting I tried.** S4 is the most weight-sensitive: it wins on WTP and loses on size, so anyone who believes the category will mainstream faster than YouGov's awareness data suggests should argue for S4.

---

## 6. Recommended beachhead

### The recommendation
**S1 — hybrid desk professionals, at the mid-afternoon dip (occasion O1/O2), with the Energy SKU as the hero, and S6 (routine supplement takers under 35) as the immediate adjacency for subscription retention.**

### Reasoning
1. **It is the only segment where the best-fit occasion is also a high-frequency occasion.** Everything else is either frequent-and-cheap (O7) or well-anchored-and-rare (O4, O8).
2. **The occasion is genuine and non-discretionary.** The afternoon dip is physiologically driven, universal among desk workers, and recurs every working day (FACT). You do not have to create the need.
3. **The competing behaviour is weak.** A third office coffee is a low-satisfaction default, not a loved ritual. That is a much easier thing to displace than a Red Bull at a chiller cabinet, which is a *loved, immediate* ritual.
4. **It needs no category education.** Unlike S4, where 78% of Britons have heard little or nothing about functional mushrooms (FACT), S1 needs only "caffeine + L-theanine, no crash" — a proposition the market already understands.
5. **It is demographically aligned with the price.** 45% of £50k+ earners hybrid-work vs 8% of under-£20k earners (FACT). The income skew of hybrid working is the single most useful targeting fact in this report.
6. **It is the safest on A-024.** A desk-based adult audience is where an age-restricted caffeine SKU is least commercially damaged.

### Confidence: **LOW–MODERATE.**
Sizing and behaviour are well sourced. **Pains, gains, language and above all willingness-to-pay are not** — they rest on review summaries I could not read directly (section 0.2) and on substitute-spend inference. I would not spend money on inventory on the strength of this. I would spend £4–5k on section 6 first.

### What would change my mind
| If we learned… | I would switch to… |
|---|---|
| Fake-door intent at £29.99 is under 3% for S1 but clears 8% for S2 or S5 | That segment |
| Van Westendorp indicative price point lands below ~£0.55/serving | A fundamentally cheaper architecture, and probably S5/retail-led rather than D2C subscription |
| Interviews show people won't own the "bottle + tablet" behaviour at a desk (no bottle, can't be bothered, prefer to walk to the kettle) | Kill the desk occasion entirely; fall back to S2's gym bottle, where the bottle already exists |
| Under-16 rules are confirmed to capture the reconstituted tablet (A-024) *and* retail is judged essential | Reformulate Energy below 150 mg/L (i.e. ≤75 mg in 500 ml) or drop caffeine from the retail SKU |
| Case arm of the fake door converts materially better than the no-case arm | Elevate the case from "packaging" to the actual product, and re-examine S4/S6 as the design-led audience |
| Mushroom category awareness has moved sharply since the YouGov work | Re-open S4 as a co-beachhead |

### Two premise tests the brief has not earned yet

**(a) The aluminium case.** There is **no desk evidence that a reusable case is a reason to buy.** The nearest available evidence is discouraging: around 80% of UK respondents say they would pay no more than 5% extra for sustainable packaging, even though 74% want reusable options offered (FACT — https://www.earthisland.co.uk/single-post/nearly-half-of-brits-unwilling-to-pay-more-for-sustainable-packaging-new-survey-reveals and https://www.circularonline.co.uk/news/world-refill-day-74-of-uk-consumers-want-retailers-to-offer-reusable-packaging/, checked 2026-09-21). That is about *sustainability*, not about *desirability as an object*, so it is only partially on point — an anodised case is closer to an everyday-carry accessory than to a refill pouch. **The honest position is: unproven in both directions, and it raises the entry price by an unknown amount at the exact moment of first purchase.** Test it as a separate fake-door arm (6.3). New assumption **A-025**.

**(b) The functional/nootropic promise in a tablet.** Here the disconfirming evidence is **stronger than the confirming evidence**, and I want that on the record: 78% awareness gap, 18%/7% ingredient awareness for the two Mind hero actives, 3% mushroom-powder trial, and the most consistent negative review theme in the whole category being "I didn't notice anything" (all FACT or WEAK as marked in S4). Against that, energy is the *most appealing* functional-mushroom benefit to Britons at 24%, and sleep second at 20% (FACT — YouGov). **Read together: sell the outcome (energy, focus) in plain words; do not sell the mechanism (mushrooms, nootropics, adaptogens) as the headline.** New assumption **A-026**.

---

## 7. Customer language bank

For `proposition-architect`. **Caveat: derived from search summaries of reviews, forums and category content (section 0.2), plus published articles — not from a coded corpus. Treat as a starting vocabulary to validate in interviews (6.2), not as verified customer voice.**

`claims-regulatory` must clear anything used on-pack or in advertising. I have pre-flagged risk.

### 7.1 How people describe the problem
| They say | They do not say | Source type |
|---|---|---|
| "the 3pm slump", "the afternoon slump", "I crash at 3" | "sub-optimal circadian alertness" | Published articles (The Conversation, RTÉ, Optum) |
| "hitting a wall", "flagging", "dragging myself through the afternoon" | "productivity decrement" | Category content |
| "brain fog", "foggy", "can't focus" | "cognitive impairment" (⚠ **medical-sounding — avoid**) | UK supplement retailers (DR.VEGAN, Brainzyme, British Supplements) |
| "wired but tired" | — | Category content |
| "the jitters", "shaky", "my skin crawls" (pre-workout) | "adverse sympathomimetic response" | Review summaries (WEAK) |
| "the crash", "the sugar crash", "the comedown" | "glycaemic rebound" | https://www.takeroon.com/blog/energy-drink-alternative |
| "I've had four coffees and I still feel like this" | — | Forum/review summaries (WEAK) |
| "I know I don't drink enough water" | "suboptimal hydration status" | OPINION — validate |

### 7.2 How people describe what they want
- **"clean energy"** — ubiquitous in the category. ⚠ Vague; check whether it reads as a composition claim.
- **"no jitters, no crash"** / **"without the crash"** — the single most-used benefit phrase in the category (https://brainmd.com/products/focus-and-energy; https://livezesty.com/blogs/zest-blog/best-energy-drink-alternatives-clean-caffeine).
- **"smooth"**, **"steady"**, **"gentler than coffee"** — recurs in DIRTEA review summaries (WEAK).
- **"calm focus"**, **"focused calm"** — the matcha/L-theanine vocabulary. Closest existing language to what the Energy SKU actually is.
- **"fewer energy slumps"** — DR.VEGAN customer language (https://www.drvegan.com/products/brain-fuel).
- **"actually dissolves"**, **"no bits"**, **"not gritty"** — from complaints about mushroom powders. **This is our strongest ownable phrase and it came from a competitor's weakness.**
- **"something that isn't another coffee"**
- **"it's part of my morning now"** — routine/identity language; the retention phrase.

### 7.3 How they describe price and subscriptions
- "it's expensive" — almost always appears *next to* "I didn't really notice a difference". **Price objection is usually an efficacy objection wearing a coat.**
- "works out at £X a go" — people spontaneously convert to per-serving. Good: our per-serving story is the better one.
- "I forgot I was even paying for it" / "I've got four boxes I haven't opened" — the cancellation triggers.
- "I had to email them to cancel" — cancellation friction is a top negative theme for D2C brands in this space (WEAK — Waterdrop/Spacegoods review summaries). **Make cancelling one click; it is a marketing asset and, from autumn 2026, close to a legal requirement.**

### 7.4 Vocabulary to retire
| Brief's phrase | Problem |
|---|---|
| "Bio-Performance Platform" | No customer says this. Reads as a B2B software product. |
| "Dual-Stage Solid-Dose All-In-One Delivery" | Describes a manufacturing process, not a benefit. |
| "Active Functional Core" | Internal engineering language. |
| "active, on-the-go professionals" | The thing this report exists to replace. It describes an aspiration, not a person. |
| "nootropic" | Only ~a fifth of Britons recognise the ingredient category at all; also claims-risky. |
| "bio-available", "potency" | ⚠ `claims-regulatory` has flagged this family. Say what it *does for you*, in the permitted wording. |

---

## 8. Primary research plan

Purpose: close the gaps in section 0.3 before Gate 3. Designed to be cheap, fast and decision-shaped.

### 8.1 Survey (10 questions + screener)

**Platform:** Prolific (UK-representative sample available) or Attest. **n = 400 completes**, minimum 100 per priority segment.
**Length:** 8 minutes.

**Screener (not counted in the 10)**
- SC1. Age. **Terminate under 18.** Quota: 18–24, 25–34, 35–44, 45–54, 55+.
- SC2. Employment status / working pattern (fully office / hybrid / fully remote / not in work) → identifies S1.
- SC3. In a typical week, how many times do you exercise for 30+ minutes? → identifies S2.
- SC4. Which of these have you consumed in the last month? (coffee; energy drink; electrolyte/hydration tablet or powder; mushroom or adaptogen drink; protein shake; none) → identifies S5, S4, S6. **Terminate "none of these".**
- SC5. Do you own and regularly carry a reusable water bottle? → tests the behavioural precondition. **Do not terminate on this; the drop-out rate here is itself a finding.**

**The 10 questions**
1. Thinking about a typical weekday, when (if ever) does your energy dip? (grid: before 10 / 10–12 / 12–2 / 2–4 / 4–6 / after 6 / doesn't dip)
2. What do you currently do about it? (multi-select, incl. "nothing")
3. How much do you spend on that, on a typical day when you do it? (bands: £0 / under £1 / £1–2 / £2–3.50 / £3.50–5 / over £5)
4. How many caffeinated drinks do you have on a typical weekday? (0 / 1 / 2 / 3 / 4 / 5+)
5. On how many days in a typical week would you realistically use a drink like this? (0–7) — **this is the A-014 question; everything else is context for it.**
6. Monadic concept exposure (one of three concepts, randomised: Energy / Mind / Recovery), then: how new and different is this? / how well does it meet a need you have? (5-pt each)
7. Purchase intent, 5-pt, at a randomly assigned price (see 8.4 cells). Report top-2-box.
8. Van Westendorp block (4 questions — section 8.4). *Counts as one item for respondent-burden purposes.*
9. Which would you rather buy? (forced choice: £29.99 case + 24 tablets / £16.99 tablets only in a card pack / £19.99 case + 8 tablets) — **the direct A-025 case-premium test.**
10. How do you feel about adding another monthly subscription right now? (5-pt, from "happy to" to "actively cutting back") + open text: "in your own words, what would make you cancel?" — feeds the language bank and A-027.

**Pitfalls to avoid:** no leading language; never show the brief's vocabulary; randomise concept and price; keep the Van Westendorp *after* concept exposure but *before* the forced choice.

### 8.2 Interview guide (30 minutes, n = 10–12)

Recruit 4 × S1, 3 × S2, 3 × S4/S6, 2 × S5. Remote video. £40 incentive.

- **0–5 min — Warm-up.** Walk me through yesterday from waking to bed. *(Never ask about the category first.)*
- **5–12 min — The occasion.** When did your energy dip? What did you do? What did that cost? What were you hoping it would do? What did you do the day before? *Probe for the actual last occurrence, not the general habit.*
- **12–17 min — Current solutions and their failures.** Show me what's in your bag/desk drawer/cupboard. What have you tried and stopped? **Why did you stop?** *(This is where the real pains are. Spend the time here.)*
- **17–23 min — Concept reaction.** Show the concept silently for 20 seconds, then: what do you think this is, and who's it for? *(Comprehension before opinion.)* Then: what's the first thing that puts you off? What would it have to do for you to buy it again?
- **23–27 min — The case and the mechanism.** Hand-feel prompt (photo/render): would you carry this? Where would it live? Then separately: does it matter to you what's *in* it? Probe "mushrooms" and "nootropics" **unprompted first** — note whether they raise it themselves.
- **27–30 min — Price and subscription.** What would you expect to pay? At what price is it a no? How do you feel about a monthly delivery? What happens when you've got too many?

**Record verbatim for the language bank. Paraphrase in any written output; keep quotes short.**

### 8.3 Fake-door / landing-page test

**Objective:** measure revealed intent, not stated intent, and settle A-025 and A-013.

**Build:** one Shopify or Framer landing page, five variants, identical above-the-fold layout.

| Cell | What is shown | Tests |
|---|---|---|
| **A** | Starter kit, case + 24 tablets, **£29.99** | The brief's price |
| **B** | Starter kit, case + 24 tablets, **£24.99** | Below-£25 elasticity |
| **C** | Starter kit, case + 24 tablets, **£34.99** | Whether £30 is a cliff (**the direct A-013 test**) |
| **D** | **Tablets only, no case, 24 pack, £16.99** | **Is the case a reason to buy, or a tax on entry? (A-025)** |
| **E** | Same as A but headline sells **outcome only** ("stop the 3pm crash"), no mushrooms/nootropics named | **A-026** |

**Flow:** ad → landing page → "Start my kit" → address/email step → honest interstitial ("we're not shipping yet — join the first batch and get 20% off"). **Never take payment. Never imply a product exists that doesn't.** Disclose the pre-launch status on the page itself.

**Traffic:** paid social to segment-matched audiences, plus a small Google search arm on "afternoon slump" / "coffee alternative" terms. Target **~1,000 sessions per cell** (~5,000 total).

**Success thresholds (ESTIMATE, set against a 1.6% median Meta ecommerce conversion benchmark — https://rule1.ai/articles/facebook-ads-benchmarks, checked 2026-09-21; fake doors run well above real conversion, so these are set conservatively high):**
- **Pass:** ≥8% of landing-page sessions click through to the address step, **and** ≥25% of those complete it, **and** cost per captured lead ≤£4.
- **Iterate:** 4–8% click-through.
- **Kill / rethink the proposition:** <3% click-through in the best cell.
- **A-013 read:** if C (£34.99) is within ~15% of A (£29.99) on intent, **the £30 barrier does not exist for this product** and the price architecture is free to move up.
- **A-025 read:** if D (no case) matches or beats A on *intent* and beats it on *cost per lead*, **the case is not a reason to buy** and should become an optional accessory, not the acquisition hook.
- **A-026 read:** if E materially beats A, lead with outcome language and demote the mechanism.

### 8.4 Van Westendorp price-sensitivity module

Run twice — once for the **starter kit** and once for the **monthly refill** — after concept exposure. Standard four questions:

1. At what price would this be **so expensive** you would not consider buying it?
2. At what price would you consider it **expensive, but still worth considering**?
3. At what price would you consider it **a bargain — great value**?
4. At what price would it be **so cheap** that you'd question the quality?

**Analysis:** plot cumulative curves; report the **Point of Marginal Cheapness**, **Point of Marginal Expensiveness**, **Optimal Price Point** (too-cheap × too-expensive intersection) and the **Range of Acceptable Prices**. Report **by segment**, not just in total — a blended OPP across five different segments is meaningless.

**Extension:** add the **Newton–Miller–Smith** purchase-intent questions at the PMC and PME points to estimate a revenue-maximising price rather than just an acceptable one.

**Caveats to state in the output, not bury:** Van Westendorp measures *price perception*, not demand; it has no competitive frame unless you supply one; it systematically under-reads premium products. **Use it to bound the range, use the fake door to pick the point.** Where they disagree, the fake door wins.

### 8.5 Budget and time

| Workstream | Method | Cost (ESTIMATE) | Time |
|---|---|---|---|
| Survey | Prolific, n=400 @ 8 min. Participant reward at Prolific's recommended £9/hr = £1.20 each = £480; platform fee 42.8% commercial = £205 (FACT — https://www.prolific.com/pricing, https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing, checked 2026-09-21). Plus ~30% screen-out wastage for low-incidence cells. | **£850–£1,000** | 1 week field, 3 days analysis |
| Interviews | 10–12 × £40 incentive + recruitment/scheduling | **£600–£900** | 2 weeks |
| Landing page | Shopify/Framer template, own copy, stock/render imagery | **£0–£500** | 3–4 days |
| Fake-door media | ~5,000 sessions. At UK ecommerce CPC £0.45–£1.10 (https://adlibrary.com/posts/meta-ads-average-cpc-cpm-uk-ecommerce) but **health & wellness carries the category's highest CPMs**, so budget at the top of the range | **£2,000–£3,500** | 2 weeks live |
| Van Westendorp | Runs inside the survey — no incremental fieldwork cost | **£0** | — |
| Analysis and write-up | | **£0** (in-house) | 1 week |
| **Total** | | **£3,450–£5,900** | **5–6 weeks end to end** |

**Cheapest defensible version, if the budget is tight:** survey (£900) + 6 interviews (£350) + a single-cell fake door at £29.99 vs a no-case cell (£1,200 media) = **~£2,450 in 4 weeks.** That still settles A-014, A-025 and gives a directional read on A-013.

**Sequencing:** run the survey and interviews **in parallel in week 1–2** (the interviews will explain *why* the survey numbers are what they are), then build the fake door in week 3 informed by the language that came out of the interviews. Do not build the landing page first — you'll write it in boardroom language.

---

## 9. What I'm handing to whom

| To | What |
|---|---|
| `pricing-economist` | A-014 range: **Low 8 / Base 16 / High 26 tablets per 4 weeks**, weighted mean ~16.5 (s.3.3). Model all three. Also: 24 tablets ≈ 6 weeks at base case — **cadence, not price, may be the LTV bug**. A 16-tablet pack aligns with the A-004 hardware fix. And A-027: £19.99/month is 30–50% of the median UK subscriber's total subscription budget. |
| `market-mapper` | Confirm per-serving prices for Waterdrop, Phizz, Spacegoods, DIRTEA (A-008, A-022). My occasion map depends on them. Also: **"actually dissolves / not gritty" is a customer-evidenced competitor weakness** worth checking across the set. |
| `claims-regulatory` | **A-024 is urgent.** England's under-16 energy drinks ban (April 2027) uses a **150 mg/L** threshold and explicitly covers drinks made by reconstitution. Energy is 160 mg/L. Please confirm scope for effervescent tablets sold as food supplements. Also: the customer language in s.7 needs a clearance pass. |
| `proposition-architect` | Section 7 language bank, and s.6's two premise warnings: lead with **outcome**, not mechanism; the case is **unproven** as a reason to buy. |
| `red-team` | Attack s.6 first. The weakest links are: (a) the beachhead rests on inferred WTP; (b) all review themes are WEAK by construction (s.0.2); (c) my segment sizes use an `UNVERIFIED` workforce denominator. |
| CSO | A-003's retail discovery channel and A-024 are in direct conflict. Needs a decision. |
