# UK Vitamin Category Map — gender-targeted, everyday and creatine

**Author:** `market-mapper` · **Date:** 2026-09-22 · **Brief:** answer A-035 (creatine) and A-036 (gender-targeted vitamins), and judge the proposed five-range architecture.

**Scope note.** This file is additive. It does **not** modify `research/competitor-map.md` or `research/format-options.md` (house rule 8). It appends **32 new rows** to `research/competitors.csv` (now 77 rows) using that file's existing 26-column header and conventions.

**Mid-task addition (coordinator, 2026-09-22):** two user-named positioning references were added and are covered in **§5A (Wild Nutrition)** and **§5B (Ankhway)**. §5A materially revises the pricing conclusion of my first run; that revision is stated openly in §5A.2 rather than quietly reconciled.

---

## 0. Sourcing health warning — read this before using any number

**Every UK retailer and brand domain remains blocked by this session's egress proxy** (verified again today: `www.boots.com` and `pricespy.co.uk` both returned `EGRESS_BLOCKED`; the proxy status endpoint reports no per-host exceptions). This is environment policy, not a transient fault, and matches the previous two runs.

Consequence: **every price below comes from a search-engine summary of the named page, not a direct read.** No row in this report is rated above `med` confidence, and several are `low`. Where a figure rests on an inference (for example, that an 84-piece Wellman Max pack is a 28-day regimen) I have marked it ESTIMATE and shown the reasoning. Section 10 lists the exact pages that must be read directly before money is committed.

**One classification change, declared openly.** The original ring definition in `competitor-map.md` puts "standard vitamins" in the **substitute** ring. Under the proposed vitamin-led range they stop being substitutes and become the direct competitive set. To keep them on the price ladder I have classed swallowed multivitamins as **adjacent** (matching the precedent already set for the swallowed H&B electrolyte tablet), and reserved **direct** for effervescent vitamin products. This is a deliberate, flagged departure, not a silent one.

---

## 1. Market structure: how UK vitamins actually segment

### 1.1 Market size

| Figure | Source | Reliability |
|---|---|---|
| UK vitamins & supplements retail (narrow "vitamins and minerals" shelf) **~£568m in 2023**, forecast **+10% value 2023–2028** | Mintel, via search summary — https://store.mintel.com/report/uk-vitamins-and-supplements-market-report | **Medium.** Paywalled; figure read second-hand. The narrow definition is the right one for this question. |
| UK vitamin & supplement **manufacturing** £1.8bn in 2026, +3.5% | IBISWorld — https://www.ibisworld.com/united-kingdom/industry/vitamin-supplement-manufacturing/14445/ | **Low for our purpose.** Manufacturing output, not retail demand. Do not mix with the above. |
| Vitabiotics revenue **~£275m FY2025**; acquired by Bain Capital July 2026 at a reported **~$1.2bn / ~£900m** | https://www.bloomberg.com/news/articles/2026-07-24/bain-capital-to-buy-1-2-billion-uk-supplements-firm-vitabiotics ; https://www.baincapital.com/news/bain-capital-acquire-vitabiotics-uks-no1-vitamin-company | **Medium-high.** Reported by Bloomberg and confirmed by the acquirer's own release. Terms not officially confirmed. |
| UK creatine market **USD 31.1m (2023) → USD 80.2m (2030), 13.5–14.5% CAGR**; UK user gender split **59.4% male / 39.8% female** | https://www.grandviewresearch.com/industry-analysis/creatine-supplements-market-report ; https://www.theproteinworks.com/research/creatine-consumer-research-2026 | **Low-medium.** Vendor market report plus a brand's own consumer survey. Directional only. |

**FACT, and it is the single most important structural fact in this report.** Vitabiotics turns over **~£275m** — roughly **half the entire narrow UK vitamins shelf** on Mintel's sizing. One family-owned British brand, founded 1971, dominates the category V-Drop proposes to enter, and has just been bought by a global private equity house that will fund it. That is not a sleepy category with a premium gap.

### 1.2 The six price tiers, and who leads each

| Tier | £/serving inc VAT | Who | What carries the price |
|---|---|---|---|
| **T1 Own-label floor** | £0.022–0.088 | Sainsbury's, Superdrug, Asda, Tesco, Boots | Nothing. Pure distribution and scale. |
| **T2 National mass brand + gender badge** | £0.12–0.30 | Vitabiotics Wellman/Wellwoman/Feroglobin, Centrum Men/Women, Boots Complete Man | Brand age, pharmacy distribution, a gender badge, 100% NRV panel |
| **T3 Nutrient-form or personalisation story** | £0.33–0.50 | Together Health (food-state), Solgar (high potency), Vitl (personalised) | A *reason the same nutrients are different* — form, dose or a quiz |
| **T4 Depth / life-stage** | £0.60–1.01 | Vitabiotics Wellman Max & Wellwoman Max, Wild Nutrition 45+ | More dosage forms per day, or a specific life stage (45+, perimenopause) |
| **T5 Narrative + breadth** | £1.10–2.63 | Heights Vitals⁺, AG1 | A story (brain health, foundational nutrition) plus very heavy D2C marketing |
| **T6 Patented actives at trialled doses** | £4.97–6.63 | LYMA | Named patented ingredients dosed to their published human trials, plus hardware and membership |

**Segment leaders (FACT where sourced, OPINION on "leads"):** Vitabiotics leads T2 outright — it claims nine category-leading ranges and an 87% share of UK pre/postnatal nutrition (https://en.wikipedia.org/wiki/Vitabiotics). Centrum is the global challenger. Own-label leads T1 by definition. T5 is led by AG1 on spend, T6 by LYMA with no real rival.

---

## 2. Price ladder — the vitamin category, with V-Drop marked

Standard RRP inc VAT, never promotional (house rule). Net column = ÷1.2 (house rule 5). Per-serving = pack price ÷ servings.

| # | £/serv inc VAT | £/serv net | Product | Tier | Conf. |
|---:|---:|---:|---|---|---|
| 1 | £0.022 | £0.018 | Sainsbury's Multivitamins & Iron, 180 | T1 | med |
| 2 | £0.036 | £0.030 | Superdrug Multi-Vitamins with Iron, 180 | T1 | med |
| 3 | £0.042 | £0.035 | Asda Wellbeing Multivitamins & Iron, 90 | T1 | low-med |
| 4 | £0.060 | £0.050 | **Tesco Health effervescent vitamin C 1000 mg, 20** *(existing row)* | T1 | med |
| 5 | £0.066 | £0.055 | Tesco Health 50+ A-Z Multivitamin, 60 | T1 | med |
| 6 | £0.088 | £0.073 | **Boots High Strength effervescent vitamin C 1000 mg, 20** *(existing row)* | T1 | med |
| 7 | £0.123 | £0.103 | Vitabiotics Feroglobin B12, 30 | T2 | low |
| 8 | £0.200 | £0.167 | Boots Complete Man 50+, 30 | T2 | med |
| 9 | £0.200 | £0.167 | Boots Multivitamins for Women, 30 | T2 | med |
| 10 | £0.207 | £0.173 | Vitabiotics Wellman Original — *subscription, order 6+ (30% off)* | T2 | med |
| 11 | £0.217 | £0.181 | Centrum Men, 60 | T2 | med |
| 12 | £0.236 | £0.197 | Vitabiotics Wellman Original — *subscription, orders 1–2 (20% off)* | T2 | med |
| 13 | £0.245 | £0.204 | Centrum Women, 60 | T2 | med |
| 14 | £0.261 | £0.218 | Solgar Formula VM-75, 180 | T3 | med |
| 15 | £0.295 | £0.246 | **Vitabiotics Wellman Original, 30 — brand RRP** | T2 | med |
| 16 | £0.300 | £0.250 | Vitabiotics Wellwoman Original, 30 | T2 | low-med |
| 17 | £0.333 | £0.278 | Together Health WholeVit Women's, 30 | T3 | low-med |
| 18 | £0.467 | £0.389 | Solgar Formula VM-75, 30 | T3 | med |
| 19 | **£0.466** | **£0.388** | **V-DROP retail tube (£6.99 ÷ 15)** — *superseded by the D2C-only decision, shown for continuity* | — | n/a |
| 20 | £0.498 | £0.415 | Vitl Essential One (D2C subscription) | T3 | low |
| 21 | £0.500 | £0.417 | **Berocca Immuno, 30** *(existing row — effervescent)* | — | med |
| 22 | £0.600 | £0.500 | Vitabiotics Wellman Max — subscription (20% off) | T4 | med |
| 23 | £0.643 | £0.536 | Vitabiotics Wellwoman Max — subscription (20% off) | T4 | med |
| 24 | £0.666 | £0.555 | **Berocca Mind, 15** *(existing row — effervescent)* | — | med |
| 25 | £0.744 | £0.620 | **Applied Nutrition Creatine Effervescent** *(existing row — verified today)* | — | med |
| 26 | £0.749 | £0.624 | **Waterdrop Microdrink, 12** *(existing row)* | — | med |
| 27 | £0.750 | £0.625 | Vitabiotics Wellman Max, 28-day — RRP | T4 | med |
| 28 | £0.800 | £0.667 | **Ankhway 10-in-1 Mushroom Gummies — subscription** *(see §5B)* | — | low-med |
| 29 | £0.804 | £0.670 | Vitabiotics Wellwoman Max, 28-day — RRP | T4 | med |
| **30** | **£0.833** | **£0.694** | **★ V-DROP SUBSCRIPTION (£19.99 ÷ 24) ★** | — | n/a |
| 31 | £0.833 | £0.694 | Novomins Creatine Gummies 5000 mg, 30 servings | — | low-med |
| 32 | £0.950 | £0.792 | Wild Nutrition Food-Grown Women's 45+ — refill | T4 | med |
| 33 | £1.000 | £0.833 | Ankhway 10-in-1 Mushroom Gummies — one-time | — | low-med |
| 34 | £1.013 | £0.844 | **Wild Nutrition Food-Grown Women's 45+, 60 caps** *(user's named premium reference — see §5A)* | T4 | med |
| 35 | £1.100 | £0.917 | Heights Vitals⁺ — quarterly subscription | T5 | low-med |
| 36 | £1.250 | £1.042 | **V-DROP starter kit, month 1 (£29.99 ÷ 24)** | — | n/a |
| 37 | £1.433 | £1.194 | Heights Vitals⁺ — monthly subscription | T5 | low-med |
| 38 | £2.633 | £2.194 | AG1 — monthly subscription | T5 | med |
| 39 | £3.233 | £2.694 | AG1 — one-off pouch | T5 | med |
| 40 | £4.967 | £4.139 | LYMA — monthly refill | T6 | med |
| 41 | £6.633 | £5.528 | LYMA — starter kit month 1 (incl. copper vessel) | T6 | med |

*Unpriced (no UK figure obtainable this session): Applied Nutrition Multivitamin Effervescent 20s, H&B Ultra Man / Ultra Woman, Form Nutrition Multi, Applied Nutrition Creatine Gummies (servings/pack unknown), Bear Balanced (no UK route).*

### 2.1 Where V-Drop lands

1. **FACT. £0.833 is not an outlandish price for a UK vitamin.** It sits at position 30 of 41, below Wild Nutrition, Heights, AG1 and LYMA, and within 4% of Vitabiotics Wellwoman Max (£0.804). **The flat claim that "the vitamin category cannot sustain a premium" is wrong, and I will not report it that way.** The category sustains prices up to **£4.97/serving** (LYMA refill), and a **£275m** UK brand has just been valued at **~£900m**. **Wild Nutrition — the user's own named reference — is 22% MORE expensive per serving than V-Drop's subscription (§5A).** Anyone benchmarking V-Drop only against the £0.40–£0.67 effervescent ladder is using a format anchor and calling it a category anchor.

2. **FACT, and this is the sharp edge. £0.833 is a catastrophic price for an *effervescent* vitamin.** Restricting the ladder to the effervescent format only: Tesco £0.060 → Boots £0.088 → Berocca Immuno £0.500 → Berocca Mind £0.666 → Applied Nutrition Creatine £0.744. **V-Drop at £0.833 would be the most expensive effervescent tablet of any kind in a 74-row UK dataset**, 25% above Bayer's flagship and **9.5–13.9× the own-label effervescent vitamin C.**

3. **FACT. The premium tier and the effervescent format do not overlap anywhere.** Every product above £0.90 in the ladder is a swallowed capsule (Wild Nutrition, Heights, LYMA) or a powder (AG1). Not one premium UK vitamin brand uses an effervescent tablet. That is a 39-product observation, not an impression.

4. **ESTIMATE, and it is the finding that matters most.** The premium tiers migrated *away* from the shelf where own-label competes hardest. Effervescent vitamin C is the single most commoditised sub-format in the category (1,000 mg for 6p at Tesco), and the format therefore carries a **low price anchor in the consumer's head**. Capsules do not have a 6p reference point in the same way — a shopper has no idea what a food-state B-complex "should" cost. **Premium survives in UK vitamins by avoiding comparability. An effervescent vitamin tablet maximises comparability.**

---

## 3. The Vitabiotics case — quantifying a real UK premium

This is the brief's key case, so I have taken it apart properly.

### 3.1 The premium, measured

| Comparison | Multiple | Working |
|---|---:|---|
| Wellman Original RRP £0.295 vs Sainsbury's own-label £0.022 | **13.6×** | 0.295 ÷ 0.0217 |
| Wellman Original RRP £0.295 vs Boots Complete Man £0.200 | **1.48×** | 0.295 ÷ 0.200 |
| Wellman Max £0.750 vs Boots Complete Man £0.200 | **3.75×** | 0.750 ÷ 0.200 |
| Wellwoman Max £0.804 vs Sainsbury's own-label £0.022 | **37×** | 0.804 ÷ 0.0217 |

**So a 13–37× premium over own-label is demonstrably sustainable in UK vitamins.** V-Drop's £0.833 is a 38× premium over the Sainsbury's floor — *marginally* beyond, but in the same order of magnitude as Wellwoman Max. On raw price ratio alone, the proposal is not absurd.

### 3.2 But the premium leaks badly

**FACT.** Vitabiotics' brand RRP holds almost nowhere in the trade. trolley.co.uk shows Wellman Original at **£4.99–£7.89** across Savers, Asda, Morrisons and seven-plus other retailers against a £8.85 brand RRP (https://www.trolley.co.uk/product/vitabiotics-wellman-tablets/RNK235). Wellwoman Original: **£4.99–£6.95** (https://www.trolley.co.uk/product/vitabiotics-wellwoman/RVH300). Wellwoman Max: £22.50 at Superdrug against a PriceSpy best of **£14.81** (https://pricespy.co.uk/product.php?p=2975400). Three-for-two vitamin events run near-permanently at Boots and H&B.

**OPINION.** The realised average selling price of a "premium" UK vitamin is roughly **60–70% of its stated RRP**. Anyone modelling V-Drop revenue off a shelf price is modelling a number the category does not actually achieve. D2C-only partly protects against this — V-Drop controls its own price — but it also means V-Drop must *win the customer at full price* against a Wellman the customer can buy at Savers for £4.99.

### 3.3 What actually carries the Vitabiotics premium

Ranked by my judgement of contribution (OPINION, each grounded in a sourced fact):

1. **Brand age and pharmacy legitimacy.** Founded 1971; four Queen's Awards for Enterprise; "UK's No.1 vitamin company" verified on Nielsen GB ScanTrack; 87% share of pre/postnatal (https://www.baincapital.com/news/bain-capital-acquire-vitabiotics-uks-no1-vitamin-company). **V-Drop has none of this and cannot buy it.**
2. **Distribution ubiquity.** Boots, Tesco, Sainsbury's, Superdrug, Savers, Asda, Morrisons, H&B, independent pharmacy. The brand is *seen* constantly; the price is only encountered occasionally. **V-Drop is D2C-only (decision, 2026-09-21) and therefore has zero passive brand-building.**
3. **Range depth as a price ladder.** Original → Sport → Conception → 50+ → 70+ → Max. Max is a **3-in-1 regimen** (micronutrient tablet + omega 3-6-9 capsule + a third tablet) — the price triples because the *quantity of product* triples, not because the branding got better (https://www.vitabiotics.com/products/wellman-max-tablets-and-capsules). **This is the honest mechanism: Vitabiotics charges £0.75–0.80/day by shipping three dosage forms a day.** One effervescent tablet cannot replicate that.
4. **Life-stage and condition specificity.** Conception, 50+, 70+, Pregnacare, Feroglobin. Note Feroglobin: it is *de facto* female-targeted but sold on a **symptom** (fatigue from low iron), not on gender — and at £0.123/serving.
5. **Its own D2C subscription, already running.** 20% off orders 1–2, 25% off orders 3–5, **30% off order 6 onwards**, free delivery with no minimum (https://www.vitabiotics.com/pages/subscribe). **This is the finding that should worry us most: the incumbent already operates the exact business model V-Drop proposes, at a third of V-Drop's price, with a loyalty ladder that gets cheaper the longer you stay.** V-Drop's proposed subscription is *more expensive per serving than its own retail* (A-003). Vitabiotics does the opposite, and deepens the discount with tenure.

### 3.4 Verdict on question 2, stated plainly

**A premium price CAN survive in the UK vitamin category. A premium price is very unlikely to survive on an effervescent tablet sold as a vitamin.**

The honest formulation:

- **£0.833/serving is credible** if the product is sold on *specificity* (a life stage, a defined physiological state), *potency at trialled doses* (LYMA's model), or *depth of regimen* (Wellman Max's model) — and if it never invites a like-for-like nutrient comparison.
- **£0.833/serving is not credible** if the product is sold as "everyday vitamins in a nicer format". That proposition is priced at £0.022–£0.088 by four retailers and £0.20–£0.30 by two national brands, and the format V-Drop has chosen is the very format in which the cheapest comparison is most visible. §7 of `competitor-map.md` already found V-Drop **27–39× dearer per mg of vitamin C than own-brand**; nothing found today softens that.
- **The gendered split makes this worse, not better.** Gender is the *cheapest* differentiator in the category — Boots does it at £0.200, Centrum at £0.217–0.245, Superdrug does its own gendered SKUs. Gender targeting is table stakes at T2, not a premium lever. The premium levers in the female half of the market are **life stage and condition** (Wild Nutrition 45+ at £1.013, perimenopause complexes, Feroglobin's iron story) — none of which is what the proposal describes.

**So the answer is not "the vitamin category is the worst possible ground for a premium play." It is: "a premium play in this category has to be bought with specificity, dose or proof — and the proposal as stated buys it with gender and format, which are the two cheapest things in the category."**

---

## 4. One genuine point in the pivot's favour

**FACT, and it cuts against our own prior findings.** A-019 and A-034 established that V-Drop's ~500 mg active core (or ~1,350 mg on the 4.5 g fix) cannot carry gram-scale mushroom extracts or a 3 g creatine dose. **That constraint does not bind for vitamins.** A complete A-Z multivitamin panel at 100% NRV is a few hundred milligrams of nutrient mass in total, and the format demonstrably carries far more: Tonic Health's effervescent tablet declares vitamin C 1,000 mg plus A, E, D3, zinc and selenium (https://www.tonichealth.co/products/immunity-and-vitality), and Boots and Tesco sell 1,000 mg vitamin C effervescents for pennies.

**Implication.** Of the three proposed new ranges, the everyday-vitamin one is the only V-Drop range where the tablet can deliver **genuine dose parity with the incumbent**. That is real and should be said.

**But the sting is in the tail.** Parity is also the *ceiling*. If the tablet can match Centrum's panel, so can Berocca (it does, at £0.500–0.666) and so can Tesco (it does, at £0.060). **There is no potency story available to justify a premium in vitamins, precisely because the nutrients are cheap and the doses are capped by NRV convention.** The format constraint stops binding, and the differentiation problem replaces it.

---

## 5. Gender targeting: what the market actually does

| Brand | How the split is executed | Price impact of the split |
|---|---|---|
| Centrum | Same tablet format, same shelf, different micronutrient emphasis (women: iron, B6, B12, calcium, D, biotin; men: zinc, selenium, magnesium) | Men 60s £0.217 vs Women 60s £0.245 — **but at different retailers, so this is not a clean read.** Both sit in the low-20p band. |
| Vitabiotics | Two flagship *brands* (Wellman, Wellwoman) each with its own sub-range ladder | No systematic premium for either gender; the ladder (Original → Max) is what prices, not the gender |
| Boots | Own-label gendered SKUs at a single price | Man 50+ £0.200, Women £0.200 — **identical** |
| Superdrug | Own-label "Men's Health" and "Advanced Mens Health" SKUs | Unpriced, but own-label |
| Wild Nutrition | Female-only brand positioning, split by **life stage** (Women's, Women's 45+, Perimenopause Complex) | £0.950–1.013 — **the only genuine premium found, and it is bought with life stage, not gender** |
| Ritual (US) | Gendered *and* age-banded (Essential for Women 18+, 50+), 9 nutrients only, every dose published, USP Verified | ~USD 1.00/serving subscription — premium bought with **transparency and subtraction** |
| Feroglobin | De facto female, sold on the **symptom** (iron, fatigue) | £0.123 — cheap, because symptom-selling is competitive |

**FACT: there is no authorised GB health claim that is gender-specific.** Every claim a male or female range could make is the same claim set available to an unisex product (B6/B12/iron for fatigue, biotin and zinc for hair and skin, calcium and D for bones, zinc for fertility and reproduction). `claims-regulatory` should confirm, but the practical point is settled by observation: Centrum's women's copy uses exactly the standard authorised wording. **Gender targeting is a marketing device, not a claims advantage.** That matters because the decisions log (2026-09-22) justified the vitamin pivot partly on vitamins being "the only claim territory with authorised GB NHC wording" — true, but the *gendered* split adds nothing on that axis.

**OPINION.** The market's revealed answer is unambiguous: **gender splits are how you compete at £0.20, and life-stage or condition splits are how you compete at £1.00.** If a female-targeted V-Drop range is pursued, it should be a *perimenopause / iron-and-fatigue* range, not a "for women" range. There is no evidence anywhere in this dataset that "for men" supports a premium at all.

---

## 5A. Wild Nutrition — the user's named premium reference (and it changes the pricing conclusion)

### 5A.1 The figures

| Item | Figure | Net of VAT | Source / confidence |
|---|---:|---:|---|
| Women's 45+ Daily Multi Nutrient, 60 caps (2/day = 30 days) | **£30.40** = **£1.013/serving**, **£30.40/month** | £25.33 = **£0.844/serving** | Planet Organic — https://www.planetorganic.com/products/wild-nutrition-bespoke-woman-daily-multi-nutrient-45-60-caps · **med** |
| Same, **refill** pack | **£28.50** = **£0.950/serving** | £23.75 = £0.792/serving | Planet Organic — https://www.planetorganic.com/products/wild-nutrition-bespoke-woman-daily-multi-nutrient-45-refill-60-caps · **med** |
| Subscription | **20% off every order**, plus **two free 30-minute nutritionist consultations** | — | https://www.wildnutrition.com/pages/supplement-subscription · **med** |
| Implied subscription price | **~£24.32/month = ~£0.811/serving** | ~£20.27 = £0.676/serving | ESTIMATE: £30.40 × 0.80 |
| Standard Women's Daily Multi Nutrient (non-45+) | **UK RRP NOT OBTAINED.** US site lists the 45+ at USD 52.00 (USD 41.60 with 20% off) | — | **low** — must be read directly |
| Acquisition promotions | **50% off the first 3-month subscription**; 50%-off Fertility Support and New Year events run continuously | — | https://www.wildnutrition.com/pages/new-year-savings · **med** |

**Format: CONFIRMED capsules**, 60 per pack, 2 per day.

### 5A.2 The premium it sustains

| Against | V-Drop-relevant comparison | Multiple |
|---|---|---:|
| Sainsbury's own-label multivitamin (£0.022) | £1.013 ÷ £0.022 | **47×** |
| Boots Multivitamins for Women (£0.200) | £1.013 ÷ £0.200 | **5.1×** |
| Vitabiotics Wellwoman Original (£0.300) | £1.013 ÷ £0.300 | **3.4×** |
| **Berocca Mind (£0.666)** | £1.013 ÷ £0.666 | **1.52×** |
| **V-Drop subscription (£0.833)** | £1.013 ÷ £0.833 | **1.22× — Wild Nutrition is 22% MORE expensive than V-Drop** |

**The coordinator's hypothesis is correct and I am upgrading the conclusion accordingly.** A UK premium supplement brand does sustain **£28.50–£30.40 per month**, and on subscription still ~£24/month. **£19.99/month is therefore not a heroic price in this category — it is a 21–34% discount to a brand the user already regards as the reference.** The £0.50–0.67/serving effervescent ladder is a *format-specific* anchor, not a category-wide one, and using it as the only benchmark understated what the market will bear.

**This materially changes §2.1 and §3.4 of this report, and I am stating the revision explicitly rather than quietly reconciling it:** my first-run framing ("£0.833 is indefensible") was right about the *effervescent vitamin* shelf and too pessimistic about the *category*. The binding question is not "can £0.83 be charged for a vitamin" — Wild Nutrition, Heights, AG1 and LYMA all answer yes. It is "**can £0.83 be charged for a vitamin *in this format*, to a customer who has a 6p reference point for it**".

### 5A.3 What carries the premium — five things, and V-Drop has none of them

1. **Life-stage segmentation, not gender.** ~90 products organised around fertility, pregnancy, postpartum, perimenopause, menopause, 45+, 50+ (https://www.wildnutrition.com/pages/menopause-hub ; https://wildnutrition.com/collections/pregnancy). The woman buying Perimenopause Support is buying an answer to a specific, felt, time-bound problem. This is the point made in §5 of this report, now evidenced at the reference brand itself: **the female half of this market monetises life stage, not "for women".**
2. **A proprietary, trademarked mechanism.** "Food-Grown®" gives the brand a *reason its nutrients are different* that no competitor can copy or price against. It is the same lever Solgar pulls with high potency and Ritual pulls with traceability. **V-Drop's briefed equivalent is "it fizzes and comes in a case" — which is a delivery convenience, not a nutrient mechanism.**
3. **Founder authority and a service layer.** Founded by nutritionist Henrietta Norton; the subscription includes **two free 30-minute nutritionist consultations**. That is a service the customer cannot get from Tesco at 2.2p, and it is the cleanest justification for a recurring charge in the whole dataset.
4. **Credentialed values.** Certified B Corporation, overall B Impact score **89.6** (https://www.bcorporation.net/en-us/find-a-b-corp/company/wild-nutrition-ltd/).
5. **Distribution breadth *with* price integrity.** 355 Holland & Barrett stores, plus Boots, Sainsbury's, Amazon, Planet Organic — **and** Selfridges, Harrods and Liberty. The luxury listings do brand work that the grocery listings then monetise. Note the contrast with Vitabiotics (§3.2), whose RRP leaks to £4.99 at Savers: Wild Nutrition holds its price far better because it is not in the discount channel.

**Brand tone (OPINION, from page titles and copy fragments):** warm, editorial, founder-voiced, nature-referencing, female-authored. Not clinical, not sporty. Closest register in our dataset to TRIP and DIRTEA; furthest from Phizz and Berocca.

### 5A.4 Range architecture, and the warning inside it

~90 SKUs. **But note the sequence: Wild Nutrition did not launch with 90 products, or with five ranges.** It built out from a founder's single expertise (women's nutrition through life stages) over a decade. This is the same pattern as AG1 and LYMA (§7.2) and it is the single most consistent finding across every premium brand in this report: **the range follows the customer base; it does not create it.** That is the evidence base for §11's verdict, and Wild Nutrition strengthens rather than weakens it.

### 5A.5 The ASA ruling — a direct, recent warning for V-Drop

**FACT.** In **March 2026** the ASA **upheld** a complaint against a Wild Nutrition poster on the London Underground (seen 21 July 2025). It ruled that "Wild by nature / Food-Grown" misleadingly implied the nutrients were food-derived, when the production process **starts from isolated nutrients, some of which are chemically synthesised**, before being cultured into yeast, probiotic or citrus pulp over ~72 hours. Breaches of CAP Code rules **3.1, 3.3 (misleading) and 3.7 (substantiation)**. (https://www.asa.org.uk/rulings/wild-nutrition-ltd-a25-1310999-wild-nutrition-ltd.html ; https://www.nutraingredients.com/Article/2026/03/10/uk-watchdog-blocks-wild-nutrition-food-grown-advertising/ ; https://foodcomplianceinternational.com/industry-insight/news/6036-asa-bans-the-claim-wild-by-nature-food-grown-in-dietary-supplement-advertising)

**Two lessons, and they pull in opposite directions.**
- The naturalness premium is worth enough that the category's most admired premium brand pushed it until the regulator stopped it.
- **A "natural" story is a regulatory liability in GB, and it is enforced.** `claims-regulatory` should log this: the ASA is actively policing naturalness implications in supplement advertising, on top of the NHC register. Any V-Drop copy leaning on "clean", "natural" or "from food" needs substantiation for *every starting material*.

### 5A.6 The format conflict the coordinator flagged — it is real, and it is worse than stated

**The coordinator's instinct is correct.** A Wild Nutrition-style positioning and an effervescent tablet are in genuine tension. The effervescent tablet is, by construction, **50–75% citric acid and sodium/potassium carbonates** (A-019), plus a high-intensity sweetener, spray-dried flavour powders, a bulking agent, an anti-caking agent and usually a colour. Applied Nutrition's own creatine effervescent declares polyethylene glycol and sucralose (existing CSV row). **A tablet whose largest ingredient by mass is an acid–carbonate couple cannot credibly be sold as minimally processed.** It is a *manufactured* object in a way a capsule of cultured yeast is not.

**Is there a precedent? Partially — and the pattern is instructive.**

**FACT.** Natural-positioned UK brands *do* sell effervescents. Natures Aid's Vegan Vitamin C 1000 mg Effervescent declares: citric acid, vitamin C, sodium bicarbonate, sweetener (sorbitol), sodium carbonate — with "no added sugar, no artificial colours or flavours, non-GMO, vegan, free from dairy/gluten/soya/nuts" as the clean-label proof (https://www.naturesaid.co.uk/vegan-c16/vitamin-c-1000mg-effervescent-p242). The Vegan Wellness Co. does the same with natural lemon flavouring (https://theveganwellnessco.uk/products/vitamin-c-effervescents). Higher Nature sells a magnesium effervescent.

**But — and this is the finding — every one of them sits mid-market, and none of them claims to be *minimally processed*.** They buy their clean label with **"free-from" language** (no artificial colours, no GMO, vegan) rather than with a **food-state or whole-food story**. That distinction is the whole game:

- **"Free-from" is compatible with an effervescent tablet.** It is a statement about what you left out.
- **"Food-grown / whole-food / minimally processed" is not.** It is a statement about what the product *is*, and an effervescent tablet contradicts it on the ingredient list a consumer can read.

**OPINION, stated plainly:** V-Drop can credibly claim *sugar-free, no artificial colours, vegan, naturally flavoured*. It cannot credibly claim *natural, whole-food or minimally processed*, and if it tries, §5A.5 shows what happens. **No precedent exists anywhere in this dataset for a premium-priced, natural-positioned effervescent.** The two premium effervescent-adjacent successes we have — Waterdrop (£0.749) and Berocca (£0.666) — win on *design* and *pharmacy authority* respectively. Neither claims to be natural.

---

## 5B. "Ankhway" — CONFIRMED, it exists, and it is a direct threat to the Mind range

**The brand is real and the spelling is correct.** Ankhway is a UK-facing functional mushroom gummy brand trading at **ankhway.com** ("Mushroom Wellness Gummies in UK"), also listed on **Amazon UK** and **eBay UK**, with a US mirror at ankhwaylife.com. One review source attributes it to **ATC MN LTD**. No substitution or guessing was required.

| Attribute | Figure | Confidence |
|---|---|---|
| Product | 10-in-1 Mushroom Gummies, 60 gummies, **2 per serving = 30 servings**, vegan, natural raspberry | med |
| Actives | **250 mg fruiting-body extract per species × 10 species = 2,500 mg per serving** (lion's mane, cordyceps, chaga, maitake, shiitake, reishi, tremella, royal sun, black fungus, white button). Stated **10:1** extract. **Fruiting body, not mycelium-on-grain** | med |
| Price | **£29.99** one-time = **£1.000/serving** · **£23.99/month subscription** = **£0.800/serving** | **low-med — single review source; must be read directly** |
| Net of VAT | £0.833/serving one-time · **£0.667/serving subscription** | arithmetic |
| Amazon UK spread | £12.99–£35.99 across pack sizes and bundles (3-pack, 5-pack, buy-2-get-1-free) | low |
| Proof points | 60-day money-back guarantee on first pack; lab tested; "filler free"; claims 300,000+ customers | low (brand's own claims) |
| Positioning | Focus, mood, gut health, immune support, brain support — **entirely ingredient-led lifestyle language**. No authorised GB botanical claim exists for any of these species (all on hold, A-009) | med |

**Why this matters more than any other row added today.**

| | V-Drop **Mind** (subscription) | **Ankhway** (subscription) |
|---|---:|---:|
| £/serving inc VAT | £0.833 | **£0.800** |
| Declared actives | ~460 mg | **2,500 mg** |
| **£ per gram of active** | **£1.81** | **£0.320** |
| Mushroom species | 2 (lion's mane, cordyceps) | **10** |
| Extract basis | 20:1 / 10:1, no marker compound published (A-031) | 10:1, fruiting body declared |
| Format friction | make a drink | chew two sweets |

**FACT. Ankhway delivers 5.4× the active mass of V-Drop Mind at 4% below V-Drop's price, and is 5.7× cheaper per gram of active.** It is cheaper per gram than Spacegoods (£0.39–0.49), DIRTEA (£0.52) and Tonic Health (£0.36) — i.e. **it may be the best price-to-potency mushroom product in the entire 77-row dataset**, and it sits at almost exactly V-Drop's proposed subscription price.

**OPINION — and this is the hardest thing in the report.** If Ankhway is the user's positioning reference for the mushroom product, then the reference *is the competitor*, and V-Drop Mind loses to it on every measurable axis except portability: fewer species, a fraction of the mass, no published marker compound, a higher price, and more friction at the moment of use. Read with A-026 (78% of Britons have heard little or nothing about functional mushrooms; 3% trial) and A-034 (no effervescent tablet carrying a gram-scale mushroom extract exists anywhere), **this is now the third independent argument for dropping or deferring the Mind SKU, and it is the most concrete of the three.**

**Caveat, stated honestly.** The £29.99/£23.99 price pair rests on **one review site**. The Amazon UK spread (£12.99–£35.99) is wide enough that the true per-serving figure could move materially. The 300,000-customer figure is the brand's own marketing. **Before this is used to kill a range, ankhway.com must be read directly** — it is now item 1 in §12.

---

## 6. Creatine (A-035)

### 6.1 The CSV row is verified

**CONFIRMED.** Applied Nutrition Creatine Monohydrate Effervescent: **£5.95** per tube, **16 tablets = 8 servings**, **2 tablets (9 g) = 3 g creatine**, i.e. **£0.744/serving** and 1,500 mg creatine per 4.5 g tablet. Re-confirmed today by a second independent source, which also discloses a **6-tube bulk pack at £4.99 per tube** (£0.624/serving) and 19 kcal per serving (https://www.stack3d.com/2026/04/applied-nutrition-effervescent-creatine/ ; https://appliednutrition.uk/products/creatine-monohydrate-effervescent-tablets ; https://www.amazon.co.uk/Applied-Nutrition-Creatine-Effervescent-Tablets/dp/B0GY5MXB3N). Confidence: med.

### 6.2 The going rate for creatine in the UK

| Format | Product | £/serving | g creatine/serving | **£ per gram of creatine** | vs powder |
|---|---|---:|---:|---:|---:|
| Powder (bulk) | Myprotein Creatine Monohydrate 1 kg, £26.49 | £0.132 | 5.0 | **£0.0265** | 1.0× |
| Gummy | Novomins 5000 mg, 90 gummies, £24.99 | £0.833 | 5.0 | **£0.167** | **6.3×** |
| Effervescent (bulk) | Applied Nutrition, 6-tube pack @ £4.99 | £0.624 | 3.0 | **£0.208** | **7.8×** |
| Effervescent (single) | Applied Nutrition, £5.95 | £0.744 | 3.0 | **£0.248** | **9.4×** |
| Gummy | Applied Nutrition 400 g tub, £20.00 | UNVERIFIED | 3.0 | UNVERIFIED | — |

**FACT. The UK creatine format premium is large and real: convenience formats sustain 6–9× the commodity powder price per gram.** This is the strongest single piece of evidence in the whole project that *format alone* can carry a price premium in a supplement — stronger than the Waterdrop case, because here the active is identical and the comparison is unambiguous.

**But it caps out below V-Drop's price.** The most expensive creatine format in the UK dataset is £0.833/serving (Novomins gummies) — **identical to V-Drop's proposed subscription price, for 5 g of a studied active.** The format-matched competitor, Applied Nutrition's effervescent, is at **£0.744 for 3 g**. A V-Drop creatine tablet at £0.833 would be the most expensive creatine serving in the UK, carrying less creatine than either.

### 6.3 Dose and format are in direct conflict — A-035 confirmed

- Authorised claim threshold is **3 g/day**. Applied Nutrition reaches it with **two 4.5 g tablets**.
- V-Drop's briefed tablet is **3.5 g**. At the highest demonstrated active load (~33%, the Applied Nutrition benchmark) that is **~1,155 mg — 38% of the claim threshold.**
- Reaching 3 g requires two tablets per serving, which halves servings per pack, doubles COGS per serving, and breaks the one-tablet ritual. Reaching 5 g (the common consumer dose) is not achievable in this format at all.
- **Creatine at any useful dose consumes the entire active budget.** Creatine and mushrooms are mutually exclusive in one tablet. This is the clearest version of A-035's limb (b) and it holds.

### 6.4 The claims position — decisive against putting creatine in Mind

**FACT (strong, but `claims-regulatory` owns the final GB register check).**

- **Authorised:** "Creatine increases physical performance in successive bursts of short-term, high-intensity exercise", conditioned on a **3 g daily intake** (EU Register on nutrition and health claims — https://ec.europa.eu/food/food-feed-portal/backend/claims/files/euregister.pdf).
- **Also authorised (2016):** daily creatine combined with resistance training enhances muscle strength in **adults over 55** (https://www.nutraingredients.com/Article/2016/02/24/EFSA-thumbs-up-for-creatine-muscle-strength-in-older-adults/).
- **REFUSED:** the cognitive-function claim. EFSA's Article 13(5) opinion found the acute working-memory effect appeared only at **20 g/day for 5–7 days**, and was **not** seen at 2.2–14 g/day or with continuous 5 g/day supplementation (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11574456/ ; https://www.nutritioninsight.com/news/efsa-health-panel-dismisses-claims-linking-creatine-and-improved-cognitive-function.html).

**So the entire rationale for putting creatine in a focus range is unsayable in GB.** The regulator has specifically examined and rejected it. Worse, the doses at which a cognitive effect was observed (20 g/day) would need **thirteen 4.5 g tablets a day**.

**Corroborating market evidence.** The only product found anywhere that sells creatine on focus — Bear Balanced (US) — has to bolt on L-theanine, L-tyrosine and B12 to say anything about focus at all, and is not available in the UK except via import marketplaces (https://creatinegummies.com/products/creatine-gummies-watermelon). The cognitive-creatine trend is real in media and consumer interest (https://www.newhope.com/vitamins-and-supplements/creatine-emerges-in-brain-health-supported-by-mainstream-science ; UK female uptake at ~40% of users, https://www.theproteinworks.com/research/creatine-consumer-research-2026), but it is a **narrative trend that UK regulation will not let a brand monetise in copy.**

### 6.5 Verdict on creatine

**Creatine belongs in a performance range, not a focus range.** The evidence is threefold and consistent: the only authorised claims are athletic and age-related-strength; the cognitive claim was assessed and refused; and the dose requirement (3 g) is incompatible with a single 3.5 g effervescent tablet. **OPINION: it does not belong in V-Drop's launch at all.** A V-Drop creatine SKU would be a two-tablet serving, priced above the only two UK creatine convenience formats that exist, carrying less active than both, for a segment (S2 gym-goers, 3.30) that is not the recommended beachhead. Creatine's only genuine attraction is that it is cheap — 3 g costs **~£0.08** at commodity rates — which flatters `£ per gram of active` optics without adding anything a customer will pay for.

---

## 7. Segment-to-range fit under D2C-only

`research/customer-segments.md` scores six segments. Mapping the proposed five ranges onto them:

| Proposed range | Best-fitting segment | Score | Fit assessment |
|---|---|---:|---|
| **Energy** | S1 hybrid desk professionals (recommended beachhead) | **3.95** | **Strong.** Physiologically-driven daily occasion, weak incumbent (a third office coffee), no category education needed, income-skewed. |
| **Mind + creatine** | S4 mushroom-curious (3.75) for the mushrooms; S2 gym-goers (3.30) for the creatine | 3.30–3.75 | **Incoherent as a single range.** The two halves point at different people. A-026 already found 78% of Britons have heard little or nothing about functional mushrooms; §6.4 above finds the creatine cognitive claim refused. The range now has two actives, neither of which can be sold on the benefit that motivated including it. |
| **Everyday vitamins** | S6 routine supplement takers <35 | **3.55** | **Moderate fit, terrible economics.** S6 is real (>2/3 of UK adults use VMS, 83% of under-35s — Mintel via A-015). But "routine" means *repeat purchase of a commodity*, which is precisely the behaviour anchored at £0.022–£0.088. S6 is the segment most exposed to the price comparison V-Drop loses worst. |
| **Male-targeted** | **None of S1–S6** | — | **New acquisition problem.** Not one of the six evidenced segments is defined by gender. Wellman's buyer is a demographic slice, not a need state. V-Drop would be building a funnel for a person it has never profiled. |
| **Female-targeted** | **None of S1–S6** | — | Same, with one caveat: a *perimenopause* or *iron-and-fatigue* range would define a genuine need state and could be scored — but that is not what was proposed, and it is not in `customer-segments.md`. |

### 7.1 The D2C-only multiplier

**This is the part I would press hardest.** Under the 2026-09-21 D2C-only decision there is no shelf doing discovery. Every range is therefore its own acquisition funnel: its own creative, landing page, keyword set, audience and conversion rate.

- **FACT.** Health & wellness carries the **highest median CPM of any Meta vertical (~$21.80, up ~19% YoY), with CPA ~$38.55** (A-028, https://influee.co/gb/blog/facebook-ads-benchmarks).
- **FACT.** The brief contains **no CAC line at all** (A-028).
- **FACT.** Care/of — a personalised vitamin subscription, 70%-owned by **Bayer** at a reported ~$225m valuation — **cancelled all subscriptions and closed on 17 June 2024**, laying off all 143 staff, because Bayer stopped funding it (https://techcrunch.com/2024/06/15/subscription-vitamin-company-care-of-is-shutting-down/ ; https://www.nutraingredients.com/Article/2024/06/28/The-rise-and-fall-of-Care-of-A-financial-perspective/).

**OPINION.** Five ranges at launch means five CAC lines, against one brand with no passive discovery, in the most expensive paid vertical there is, in a category where the best-funded D2C entrant in the world failed. The five-range proposal does not spread risk — it multiplies the one cost the model has never quantified.

### 7.2 One counterweight, for fairness

AG1 sustains **£2.633/serving on subscription in the UK** with *less* dose transparency than V-Drop proposes (proprietary blends, no per-ingredient doses), and LYMA sustains **£4.967/serving** with a hardware-led starter kit structurally identical to V-Drop's case-and-refill architecture (https://lyma.life/products/lyma-supplement-starter-kit-v4). **D2C vitamin subscriptions at 3–6× V-Drop's price demonstrably work in the UK today.** The constraint is not the price point or the business model. It is that both of those brands spent years and very large sums building a single, narrow, highly specific proposition — one product, one story — before they had a range.

---

## 8. Whitespace: is a gendered effervescent vitamin an opportunity or an empty room?

**FACT.** I could not find an established UK brand selling a **gender-targeted effervescent multivitamin**. Searches surfaced only Amazon long-tail unisex products ("for Men & Women"), retailer category filters, and Applied Nutrition's unisex Multivitamin Effervescent. So the space is genuinely unoccupied.

**Evidence it is an opportunity:**
- Vitabiotics proves gendered vitamin *brands* are the largest business in UK VMS.
- The format constraint does not bind for vitamins (§4), so V-Drop could deliver true dose parity.
- No incumbent effervescent brand runs a brand-owned consumer subscription (A-030, narrowed).

**Evidence it is empty because there is no demand — and I judge this the stronger side:**
1. **The jobs are different.** A gendered daily multivitamin is a *routine* product: swallow it, think nothing, 20p. An effervescent is an *occasion* product: you must want a drink, have a glass, have water, wait for it to dissolve. Asking someone to perform a two-minute ritual every single morning, forever, for the same nutrients they currently swallow in two seconds, is **more friction for identical benefit**. Nobody has built it because it is a worse way to do the job.
2. **The price anchor is fatal in this specific format.** Effervescent vitamin C at 6p is the most visible price in the category. A gendered effervescent invites exactly that comparison.
3. **Gender does not price.** Boots charges £0.200 for both genders; Centrum sits in the low-20p band for both. The market has already told us gender is a merchandising device worth roughly nothing in margin.
4. **Bayer already tested the adjacent idea and stopped.** Berocca is a premium effervescent vitamin with national distribution. It has extended into Mind and Immuno — **but not into Wellman-style gendered SKUs**, despite owning the format. A £40bn pharma company with the strongest effervescent vitamin brand in Britain has declined to make this product.
5. **Care/of is the precedent for the business model failing even with a better proposition** (personalisation) and vastly more capital.

**Conclusion: this is a real gap and a weak one.** It is the kind of whitespace that exists because the two halves — the gendered-vitamin job and the effervescent format — solve for different customer needs.

---

## 9. Answers to A-035 and A-036

**A-035 — "Creatine can be carried at an effective dose inside the Mind range's tablet": DISPROVED on two independent grounds.** (i) Dose: 3 g requires two 4.5 g tablets in the only UK product that does it; a 3.5 g tablet reaches ~1,155 mg, 38% of the claim threshold. (ii) Claims: the authorised creatine claims are athletic performance (3 g/day) and muscle strength in over-55s; **the cognitive claim was assessed and refused by EFSA.** The CSO's recollection recorded in A-035 was correct on both limbs. Creatine belongs in a performance range or nowhere.

**A-036 — "A gender-targeted vitamin range is a viable premium D2C position in the UK": DISPUTED, with an important correction to the CSO's framing.** The category is *not* uniformly price-competitive — it sustains £0.83 to £4.97 per serving across Wellwoman Max, Wild Nutrition, Heights, AG1 and LYMA. But **none of that premium is bought with gender, and none of it is bought in an effervescent format.** Gender is the category's cheapest differentiator (£0.20 at Boots own-label). The viable premium levers are life stage, condition, trialled doses and transparency.

---

## 10. Top "so whats" for V-Drop

1. **Do not describe this as "vitamins".** The moment a SKU is labelled everyday vitamins, it is benchmarked against 2.2p. Every premium brand in this category has a noun that is not "multivitamin" — Vitals⁺, Rainbow Dust, AG1, the LYMA Supplement. *(§2.1, §4)*
2. **£0.833 is defensible as a price, indefensible as an effervescent vitamin price.** It sits mid-ladder overall and top of a 74-row set within its own format. *(§2)*
3. **The incumbent already runs V-Drop's business model, better.** Vitabiotics Subscribe & Save: 20% → 25% → **30% off by order 6**, free delivery, no minimum. V-Drop's subscription is currently *dearer* per serving than its retail tube (A-003). Fix the direction of the subscription discount before anything else. *(§3.3)*
4. **Gender is the cheapest differentiator in the category. Life stage is the expensive one.** If a female range is pursued, make it perimenopause or iron-and-fatigue, not "for women". Wild Nutrition holds £1.013/serving that way; Boots holds £0.200 the other way. *(§5)*
5. **There is no gender-specific authorised health claim.** The gendered split adds zero claims advantage, which undercuts part of the stated rationale for the pivot. *(§5)*
6. **Vitamins are the one range where the payload constraint disappears — and the one range where that buys nothing.** Parity with Centrum is achievable and is also the ceiling. *(§4)*
7. **Creatine cannot be sold on cognition in GB.** EFSA examined it and said no. Any "creatine for focus" copy is a regulatory exposure, not a positioning. *(§6.4)*
8. **Creatine's format premium is the best evidence in the project that format can carry price — 6–9× commodity — but it tops out at £0.833 for 5 g (gummies) and £0.744 for 3 g (effervescent).** V-Drop would enter above both with less active. *(§6.2)*
9. **Five ranges under D2C-only is five CAC lines in the highest-CPM vertical on Meta, with no shelf doing discovery, against a precedent (Care/of, Bayer-owned) that failed at exactly this.** *(§7.1)*
10. **Premium D2C vitamin subscriptions do work in the UK — AG1 £2.633, LYMA £4.967.** Both won with *one* proposition held for years. Neither launched a portfolio. *(§7.2)*
11. **The price ceiling is higher than my first run implied.** Wild Nutrition holds £28.50–£30.40/month (£0.95–£1.01/serving) across grocery, H&B *and* Harrods. **£19.99/month is a 21–34% discount to the user's own reference brand.** The problem was never the price point; it is the format's comparability and the absence of a nutrient mechanism. *(§5A.2)*
12. **A "natural / minimally processed" story is incompatible with an effervescent tablet, and the ASA is enforcing naturalness claims.** It upheld a complaint against Wild Nutrition's "Food-Grown" advertising in March 2026. Natural-positioned UK brands that do use effervescents (Natures Aid, Higher Nature) buy their clean label with **"free-from"** language, not a food-state story — and all sit mid-market. *(§5A.5, §5A.6)*
13. **Ankhway exists, is UK-facing, and beats V-Drop Mind on every axis but portability** — 2,500 mg of fruiting-body extract at £0.800/serving on subscription (£0.320/g of active) against Mind's ~460 mg at £0.833 (£1.81/g). The user's mushroom reference is the competitor that kills the range. *(§5B)*

---

## 11. Verdict on the proposed five-range architecture

**It is portfolio thinking applied too early, and I would not launch it.**

The reasoning, stated as plainly as I can:

- **Range count is the wrong axis to add on.** Under D2C-only the binding constraint is CAC, and CAC scales with the number of distinct propositions, not with the number of SKUs. Going from three ranges to five multiplies the one cost the model has never quantified (A-028). Retail range architecture buys shelf presence; D2C range architecture buys nothing until there is a customer base to cross-sell into.
- **Two of the five ranges have no target.** The male and female ranges map to none of S1–S6. They are a new acquisition problem dressed as a range extension.
- **One of the five is actively unsafe.** Mind + creatine pairs an active whose cognitive claim was refused by EFSA with a botanical 78% of Britons have never heard of, in a tablet that cannot carry either at a studied dose.
- **One of the five enters at 9.5–13.9× the own-label price of the same format.** Everyday vitamins in an effervescent tablet is the single worst price comparison available to this business.

**One correction to my own first-run reasoning, made explicit.** The two brands the user named have moved my position on *price* but not on *architecture*. Wild Nutrition shows the category's ceiling is ~£1.01/serving sustained in real UK distribution, so **£0.833 is not the problem**. Ankhway shows the Mind range is beaten on price-to-potency by a live UK competitor at a lower price. And Wild Nutrition's own history — a decade from one founder's expertise to ~90 SKUs — is the clearest available evidence that **range breadth is an output of a business, not an input to one.** All three findings point the same way: fewer ranges, priced confidently, with a mechanism the customer can name.

### The subset I would back

**Launch one range. Energy. To S1, at the mid-afternoon dip.** It is the only range with an evidenced segment (3.95, wins under every weighting tested), a daily non-discretionary occasion, a weak incumbent behaviour, no category education requirement, and a proposition the market already understands. Resolve A-024 (the ≤150 mg/L reformulation question) and ship it alone.

**Hold a second range in reserve, and make it the one with a defensible premium lever.** On today's evidence that is **not** everyday vitamins and **not** a gender badge. It is a **life-stage or condition** proposition — the Wild Nutrition / Feroglobin / perimenopause territory — where UK customers demonstrably pay £0.95–£1.01 per serving and where the authorised fatigue, bone and hair-and-skin claims are genuinely available. That is a Phase 2 question, and it needs `customer-insight` to profile the segment before `proposition-architect` writes it.

**Drop creatine from Mind. If creatine is wanted at all, it is a performance SKU at a two-tablet serving, and it should be judged against Applied Nutrition at £0.744 for 3 g, which it would not beat.**

**If the everyday-vitamin range is pursued against this advice,** the minimum conditions for it to be survivable are: (a) it is never called a multivitamin; (b) it is not priced per serving against a nutrient a shopper can price at Tesco; (c) it carries something own-label cannot — a patented active at its trialled dose, in the LYMA pattern; and (d) the subscription is cheaper than any other way to buy it, with a tenure ladder in the Vitabiotics pattern.

---

## 12. Gaps, and what I could not verify

**Must be read directly by someone with browser access, in priority order:**

0a. **ankhway.com/products/mushroom-gummies** — the £29.99 / £23.99 price pair rests on a **single review site**, and Amazon UK listings span £12.99–£35.99. §5B argues this product undermines the whole Mind range; that argument must not be acted on until the brand's own page is read. Also confirm gummies per serving (2) and whether the 250 mg-per-species figure is per serving or per gummy.

0b. **wildnutrition.com** — the standard Women's Daily Multi Nutrient UK RRP (not obtained; the 45+ sibling at £30.40 is the read-across), the exact subscription discount on that SKU, and whether the 20% is the standing rate or promotional. This is the anchor on which §5A.2's revised pricing conclusion rests.

1. **vitabiotics.com** — Wellman Original, Wellwoman Original, Wellman Max, Wellwoman Max RRPs and pack regimens; confirm the 28-day assumption behind the Max per-day figures (this underpins §3.1 and the closest price analogue to V-Drop).
2. **vitabiotics.com/pages/subscribe** — confirm the 20/25/30% tier structure and whether it applies across the range.
3. **boots.com** — Boots Complete Man, Boots Multivitamins for Women, Centrum Men/Women; and whether the 3-for-2 vitamin event is genuinely permanent (it changes every realised price in §2).
4. **hollandandbarrett.com** — H&B Ultra Man / Ultra Woman pack sizes (currently unpriceable); Novomins creatine gummies serving size (2 vs 3 gummies — sources conflict, and it moves £/g by 50%); Applied Nutrition creatine gummies servings per 400 g tub.
5. **appliednutrition.uk** — Multivitamin Effervescent price. **This is the single most important missing number in the report**: it is the exact format-matched competitor to a V-Drop everyday-vitamin SKU and I could not price it.
6. **wildnutrition.com** — confirm 2-capsules-per-day dosing and the subscription discount percentage.
7. **heights.com / vitl.com / formnutrition.com** — one-off vs subscription prices; Vitl's £14.95 is a third-party promotional reference, not a read RRP; Form is entirely unpriced.
8. **GB NHC register** — `claims-regulatory` to confirm the creatine claim wording and the refusal of the cognitive claim under **GB** (not EU) law, and to confirm that no gender-specific claim exists.

**Not attempted and still open:**
- Realised average selling price vs RRP in UK vitamins. I have shown RRPs leak badly (§3.2) but could not quantify the leak properly. This materially affects any competitive revenue estimate.
- Demographics of gendered-multivitamin buyers in the UK. Without this, §7's claim that the male/female ranges are a *new* acquisition problem rests on the absence of a matching segment in `customer-segments.md`, not on positive evidence about who buys Wellman.
- Whether Vitabiotics' Subscribe & Save is materially subscribed, or a rarely-used option. This changes how threatening §3.3 really is.
- Any UK effervescent product positioned on life stage or condition. Did not search for this specifically; it is the obvious follow-up to §11.

---

## 13. Assumptions touched

| ID | Action |
|---|---|
| A-035 | Updated to **DISPROVED**. `claims-regulatory` had already settled the claims limb in parallel; I appended the market-side evidence (UK £/gram of creatine by format, the 6–9× convenience premium and its £0.744–0.833 ceiling, and the absence of any UK cognitive-creatine precedent). |
| A-036 | Updated to **DISPUTED**, with the full six-tier ladder, the gender-vs-life-stage finding, the format constraint, the Vitabiotics scale and subscription threat, and the Care/of precedent. |
| A-039 | Updated to **DISPUTED** (was OPEN). The natural-positioning / effervescent conflict is real; the only precedents are mid-market brands using "free-from" rather than food-state language; plus the March 2026 ASA ruling against Wild Nutrition. |
| A-040 | Updated to **CONFIRMED**. Ankhway exists, the spelling is correct, it is UK-facing, and its price-to-potency beats V-Drop Mind decisively. |
| **A-049** | **New.** Premium price in UK vitamins is carried by specificity, dose or proof — never by format, design or gender. Six-tier ladder documented. |
| **A-050** | **New.** A gendered effervescent vitamin is unoccupied whitespace, but the routine-vs-occasion job mismatch is the likelier reason than oversight. Includes the finding that the payload constraint lifts for vitamins — and that parity is therefore also the ceiling. |
| **A-051** | **New.** Under D2C-only, each additional range is an independent CAC line; range breadth is an output of a business, not an input. |
| A-019 / A-026 / A-031 / A-034 | **Cross-reference only (not edited).** Ankhway (§5B) adds a third independent argument against the Mind SKU. Flagged to the CSO rather than written into those rows, since they are jointly owned. |
| A-041 (claims-regulatory) | **Conflict flagged.** `claims-regulatory` records cordyceps as subject to an FSA stop-sale instruction. **Ankhway contains cordyceps**, so the benchmark product in §5B may itself be non-compliant — which weakens it as a *durable* competitor while leaving its price-to-potency arithmetic intact. The same instruction applies to V-Drop Mind. |

**Note on numbering.** I originally reserved A-037–A-039 for `claims-regulatory`. In the event it claimed **A-037 through A-048**, so my new items were renumbered to **A-049–A-051** on writing. **A-039 and A-040 were already opened by the CSO for exactly the two questions the coordinator sent mid-task (the natural/effervescent conflict and the Ankhway identity), so I updated those rows rather than creating duplicates.** No ID collision occurred.
