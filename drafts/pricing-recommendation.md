# V-Drop — Pricing Recommendation

**Author:** `pricing-economist` · **Date:** 2026-09-22 · **Model:** `model/unit-economics.xlsx` (1,580 live formulas, recalculated and checked — zero errors)

---

## 0. Read this before anything else

**The model is illustrative until manufacturers quote.** There is not one real COGS number in this project. Every cost line is an ESTIMATE with a method or an ASSUMPTION with a low/base/high range. I have been deliberately pessimistic where the brief asked me to be, and I have said so on every row.

**Three things I have modelled that the brief does not contain at all:** customer acquisition cost, payment fees, and promotional leakage. The first of those decides the business.

**Sourcing caveat.** This session's egress policy refuses retailer and brand domains at the proxy (confirmed across four runs). Every competitor price in sheet 02 is inherited from a search-engine summary, not a direct read. Nothing in this document rated above **medium** confidence on a competitor price. The Royal Mail tariffs I use are also search summaries, and they **contradict** the figures recorded in A-006 — see §6.

**Two decisions relayed by the CSO mid-run** (positioning "clinical but tasty and cool" with branded actives; and the product becoming caffeine-free) are modelled throughout, but were not yet written into `notes/decisions.md` when I read it. The CSO should log them.

---

## 1. The corrected economics of the brief's pricing, in plain English

The brief claims an 80–82% gross margin on the starter kit and 88–89% on the refill. Neither survives contact with VAT, and neither survives contact with the costs of actually shipping a box.

### What the brief did

It computed margin on the **price the customer pays**, which includes 20% VAT that belongs to HMRC and was never V-Drop's money. £29.99 is **£24.99** net. £19.99 is **£16.66** net. That single error inflates every margin in the brief by a quarter (A-001, A-002, A-007).

It then stopped. There is no fulfilment, no postage, no payment processing, no breakage, no returns and no promotional discounting anywhere in the document.

### What the numbers actually are

Base case, 30-tablet daily pack, 3.5 g tablet, commodity source forms, caffeine-free:

| | Brief says | Gross margin (actual) | Contribution (actual) |
|---|---|---|---|
| **Starter kit £29.99 (case + 30 tablets)** | 80–82% | **£7.15 / 30.8%** | **£2.09 / 9.0%** |
| **Monthly refill £19.99 (30 tablets)** | 88–89% | **£10.23 / 66.1%** | **£5.98 / 38.6%** — £0.199 per serving |
| Retail tube £6.99/15 (out of scope; 40% retailer margin) | not stated | £0.23 / 8.4% | **−£0.26 — loss-making** |

**Where the starter kit's margin went.** Not mainly to VAT. To the case. At my base estimate the aluminium case costs **£10.83** per unit including tooling amortisation — £9.50 of CNC-milled, anodised part at launch volumes plus £1.33 of fixtures and programming spread over 3,000 units. That is 47% of the kit's net revenue, consumed by an object whose desirability is **unproven** (A-025) and which the format review has already demoted to an accessory (A-005: loose tablets in a repeatedly-opened case do not meet the moisture specification; sealed blisters do). The brief's £5.50 was supposed to cover the case *and* 24 tablets.

**Where the refill's margin went.** Three places. The VAT correction takes it from 89% to about 78%. My COGS, at **£0.175 per serving** (tablet £0.147 + blister £0.015 + a share of carton and insert) against the brief's implied £0.092, takes it to 66%. Then fulfilment (£1.30), postage (£1.72), payment fees (£0.55 — charged on the VAT-inclusive amount, so partly on HMRC's money), breakage and returns take it to 38.6%.

**Why my COGS is higher than the brief's, deliberately.** The user has decided that **taste and ease of use are the differentiator**. That makes the flavour system the hero of the formulation, not overhead: a premium natural flavour, high-grade Reb-M steviol glycosides (monk fruit is deleted — not an authorised GB sweetener, A-018) and spray-dried fruit powders. I have costed that as its own line at **£0.015 / £0.035 / £0.070** per tablet. At the high end it is 23% of tablet COGS on its own. **A taste-led strategy costed like a commodity one is the fastest route to a false margin**, and the brief's £2.20 refill COGS is exactly that.

**The single best piece of news in the model.** Royal Mail Large Letter caps depth at 25 mm. A standard effervescent tube for a 23–27 mm tablet is 28–30 mm across, so every tube competitor must ship a **parcel** and V-Drop's flat blister architecture need not. Modelled explicitly, that is worth **£1.16 per order** — the only sourced, quantified D2C cost advantage the format has. It is real and it is small. It does not rescue anything on its own.

---

## 2. The finding that matters more than any of the above

**A-028 was the gap. It is now the answer, and the answer is uncomfortable.**

There is no retail discovery route. Every customer must be bought. Health and wellness carries the highest median CPM of any Meta vertical (~$21.80, CPA ~$38.55 — third-party aggregator, directional). My blended base CAC across Meta 55% / Google 20% / influencer 15% / organic 10% is **£44.35**, and I have modelled £25.80 to £76.05.

Against that, a single-product supplement subscription churns at **8–15% per month**. My base is 10% voluntary plus 1% involuntary, with an additional 18% who never take a second shipment.

Those two facts collide:

> **At 11% monthly churn a subscriber's expected lifetime is 7.5 refills. The maximum contribution any customer can EVER deliver on the brief's pricing — at an infinite horizon, with unlimited marketing patience — is £46.65. The cost of acquiring them is £44.35.**

That is a ceiling of **1.05×**, not a forecast. No retention email, no 24-month window and no amount of waiting gets past it, because the ceiling is set by churn and price, not by time. On a 12-month view the brief's architecture returns **0.80× LTV:CAC with a 25-month payback**.

This is the number to put in front of the user. It is not "the margins are thinner than we thought". It is "on these assumptions the business acquires customers at roughly what they are worth".

---

## 3. Which price ladder should V-Drop be judged on?

Both. They give opposite answers, and the honest position is to say so.

| Ladder | Where V-Drop's £0.666/serving sits | Where £0.833 sits |
|---|---|---|
| **Effervescent format** (Tesco £0.060 → Boots £0.088 → Berocca Immuno £0.500 → Berocca Mind £0.666 → Applied Nutrition £0.744 → Waterdrop £0.749) | Level with Berocca Mind. **11.1× Tesco own-label.** | **13.9× Tesco.** Dearest effervescent tablet in a 77-row dataset. |
| **Vitamin category** (Sainsbury's £0.022 → Vitabiotics £0.295 → Wellwoman Max £0.804 → Wild Nutrition £1.013 → Heights £1.43 → AG1 £2.633 → LYMA £4.967) | 23rd of ~40. **34% below Wild Nutrition**, the user's own named reference. | 18% below Wild Nutrition, 68% below AG1. |

**My view.** Under D2C-only there is no shelf, so the comparison does not happen on a Boots fixture — it happens in search and paid social, against daily morning supplements. The vitamin-category ladder is the right one to *price* against, and it has far more headroom than the effervescent ladder suggests. **But the £0.060 anchor does not disappear because we would prefer it to.** It is one Google search away, it is the most commoditised price in UK vitamins, and the authorised health claims V-Drop can make are word-for-word the same claims Tesco can make at 6p (A-045).

Two consequences follow, and they are the whole positioning problem:

1. **Never let "effervescent tablet" be the headline noun.** Waterdrop is unambiguously effervescent — citric acid plus sodium and potassium carbonates — and has never once used the word. It sustains £0.749/serving on roughly 1.6 mg of declared vitamins, purely on taste and design (A-033, A-023). That is the single most relevant precedent V-Drop has, and V-Drop at the same price with a real daily panel is strictly better value on the same proposition.
2. **Claims buy the right to speak, not the right to charge.** The premium has to be argued on taste, ritual, design and convenience — none of which is a regulated claim, and all of which are ownable.

---

## 4. The architectures compared

All D2C. All base-case inputs. Full workings on sheet 07.

| | **A1 Brief, corrected** | **A2 Subscription-first** | **A3 Premium ritual, quarterly** | **A4 Value-led** | **A5 RECOMMENDED HYBRID** |
|---|---|---|---|---|---|
| **Entry** | £29.99 — case + 30 tablets | £14.99 intro — 30 tablets, no case | £34.99 — case + 30 tablets | £12.99 — 30 tablets | **£19.99 — 30 tablets, no case** |
| **Ongoing** | £19.99 / 30 / monthly | £22.99 / 30 / monthly | £54.99 / 90 / quarterly | £15.99 / 30 / monthly | **£74.99 / 90 / quarterly** |
| **Actives grade** | commodity | commodity | commodity | commodity | **branded / patented** |
| **£ per serving inc VAT** | £0.666 | £0.766 | £0.611 | £0.533 | **£0.833** |
| **£ per serving net** | £0.555 | £0.639 | £0.509 | £0.444 | **£0.694** |
| **Effective £ / month** | £19.99 | £22.99 | £18.33 | £15.99 | **£25.00** |
| **vs Waterdrop £0.749** | −11% | +2% | −18% | −29% | **+11%** |
| **vs Wild Nutrition £1.013** | −34% | −24% | −40% | −47% | **−18%** |
| **× Tesco own-label £0.060** | 11.1× | 12.8× | 10.2× | 8.9× | **13.9×** |
| **Ongoing gross margin** | 66.1% | 70.5% | 64.8% | 57.6% | **61.8%** |
| **Ongoing contribution** | 38.6% | 46.0% | 49.7% | 24.4% | **48.9%** |
| **Contribution / calendar month** | £5.98 | £8.19 | £7.06 | £3.03 | **£9.48** |
| **Starter contribution** | £2.09 | £2.29 | £5.78 | £0.81 | **£3.48** |
| **12-month LTV (contribution)** | £35.64 | £48.27 | £50.09 | £17.79 | **£63.00** |
| **24-month LTV** | £43.93 | £59.62 | £61.03 | £21.99 | **£77.71** |
| **LTV:CAC — 12 months** | 0.80× | 1.09× | 1.13× | 0.40× | **1.42×** |
| **CAC payback** | 25.4 months | 10.0 months | 9.1 months | **never** | **6.2 months** |
| **Lifetime ceiling (infinite horizon)** | £46.65 | £63.35 | £64.62 | £23.36 | **£82.53** |
| **Max LTV:CAC (the real 3× test)** | 1.05× | 1.43× | 1.46× | 0.53× | **1.86×** |
| **Within A-027's ~£20/month ceiling?** | Yes (just) | No — £22.99 | Yes | Yes | **No — £25.00** |

**What each one is really betting on.**

- **A1** bets that an unproven £10.83 case earns its place at the moment of highest purchase friction. It does not. It halves the starter kit's gross margin and pushes payback past two years.
- **A2** bets that the taste is genuinely better, because £22.99/month is above Waterdrop, Berocca Mind and Wellwoman Max per serving with nothing but taste to justify it. Its virtue is that an intro discount is a far cheaper acquisition subsidy than a £10.83 piece of aluminium.
- **A3** bets that fewer decision points beat compounded churn.
- **A4** is in the table to kill an argument. "Price it cheaper" is not available under a £44 CAC: at £15.99/month the payback is *never*, at any horizon.
- **A5** combines every lever that works: no hardware at entry, quarterly cadence, and a price high enough to fund branded source forms.

---

## 5. Recommendation

### Adopt A5, with the entry price tested hard.

**Starter: £19.99 for 30 blistered tablets, no case. Then £74.99 per quarter for 90 tablets (£0.833/serving, £25.00/month). Case sold separately as a £19.99 accessory.**

Five reasons, in order of how much money each is worth:

1. **Cadence is the cheapest lever in the model, and nobody has been pulling it.** Fulfilment, postage and the fixed part of the payment fee are charged **per order, not per serving**. At an unchanged price per serving, moving from monthly to quarterly lifts contribution per calendar month from **£5.98 to £8.28 — a 39% gain that costs the customer nothing**. It also cuts cancellation decision points from twelve a year to four. Sheet 04 §F. (Six-monthly is better still at £8.88 but breaches the 750 g Large Letter ceiling and becomes a parcel — that is exactly where the format's postal advantage runs out.)
2. **Take the case out of the acquisition step.** It costs £10.83, it consumes 47% of the starter kit's net revenue, its desirability is unproven and the moisture specification has already demoted it to an accessory. Sold separately at £19.99 it becomes margin-positive instead of a tax on every new customer. If the fake-door test says customers want it, put it back — as an upsell, not as a hurdle.
3. **Branded source forms are the only modelled lever that buys a defensible premium.** The authorised claims are identical at £0.833 and at £0.060 (A-045), so claims cannot carry the price. Branded, bioavailable forms at trialled doses are the LYMA pattern and the one thing own-label cannot copy. They raise tablet COGS from £0.147 to £0.227 and the price floor for a 60% contribution margin from £32.15 to £41.29 per month — **less than the premium they unlock.** The risk is not cost; it is A-043.
4. **£0.833/serving is defensible on the ladder that matters.** 18% below Wild Nutrition, 68% below AG1, 11% above Waterdrop — for a full daily panel against Waterdrop's 1.6 mg.
5. **It is the only architecture with a payback inside two quarters** (6.2 months) and the highest lifetime ceiling (£82.53).

### What must be true

A5 still only reaches **1.86× on the lifetime ceiling**. It is the best of five and it is not yet a fundable business. Four conditions, in priority order:

| # | Condition | Current base | Required | How we find out |
|---|---|---|---|---|
| 1 | **Blended CAC at or below £35** | £44.35 | ≤ £35 | A live £3–5k Meta/Google test against a real landing page. Nothing else settles it. |
| 2 | **Monthly churn at or below 7%** | 11% | ≤ 7% | Quarterly cadence should do much of this mechanically. The rest depends on the taste being repeat-worthy. |
| 3 | **Tablet COGS at or below £0.22 with branded forms** | £0.227 | ≤ £0.22 | Three manufacturer quotes. |
| 4 | **The branded forms are permitted GB source forms** | unknown | confirmed | One read of Schedule 2, or one consultant email. **Do this before designing the story, not after.** |

I have run that state through the model rather than asserting it. **At CAC £35 and churn 7%, A5 returns a lifetime ceiling of £122.68 — 3.51× CAC — with a 4.2-month payback and a 12-month LTV:CAC of 2.08×. It is the only one of the five architectures that passes the 3× ceiling test in that state** (A1 reaches 2.06×, A2 2.81×, A3 2.70×, A4 1.04×). At CAC £44 and churn 11% none of them does. **The gap between those two states is the entire Phase 1 question, and conditions 1 and 2 are the only ones that close it** — conditions 3 and 4 protect the premium rather than create it.

### What I would refuse to sign off

- **Any architecture that bundles the case at entry** until A-025 is tested. It is £10.83 of unproven benefit charged at the point of maximum friction.
- **Any price below £19.99/month.** A4 demonstrates that the value end is arithmetically closed at this CAC.
- **A "premium" price on commodity source forms.** That is a £0.833 product with a £0.060 ingredient story, one journalist's question away from collapse.

### The tension I cannot resolve for you

A5 costs **£25.00/month**. Half of UK consumers spend under **£40/month on subscriptions in total** (A-027), so A5 is ~62% of the median subscriber's entire subscription budget. The economics want a higher price; the customer's wallet wants a lower one. **This is a genuine conflict, not a modelling artefact**, and only primary research settles it. If willingness to pay caps out at £19.99/month, then A5 is unavailable and the answer is not a different price — it is a lower CAC, a longer cadence, or a different business.

---

## 6. Price points to test in customer research

Give these to `customer-insight` for the Van Westendorp module and the fake-door cells.

**Ongoing subscription, monthly-equivalent** — the core ladder:
£14.99 · £17.99 · **£19.99** · £22.99 · **£24.99** · £27.99 · £29.99

**Quarterly prepay (90 tablets)** — test that quarterly is acceptable *at all* before optimising it:
£49.99 (£16.66/mo) · £59.99 (£20.00/mo) · **£74.99 (£25.00/mo)** · £84.99 (£28.33/mo)

**Entry / first order (30 tablets, no case)**:
free + £3.95 postage · £9.99 · £14.99 · **£19.99** · £24.99

**The case, as a separate accessory** — this is the A-025 test and it is the cheapest decision in the project:
£14.99 · **£19.99** · £24.99 · £29.99

**Three forced choices worth more than any price ladder:**
1. £19.99/month monthly **vs** £54.99/quarter (£18.33/month) — does the discount buy the commitment, or does the larger charge simply frighten people?
2. £19.99 starter with no case **vs** £29.99 starter with the case — what does the case actually convert at?
3. Same price, commodity panel **vs** named branded actives at trialled doses — does "clinical" move willingness to pay, or is taste doing all the work?

**And one non-price question that outranks all of them:** at the end of a free 7-day taste trial, how many people subscribe? Under D2C-only, that conversion rate is worth more than any point on the price ladder.

---

## 7. The inputs that most need real data

Ranked by how much they move the answer, not by how easy they are to get.

| # | Input | Status | Why it matters | Cost to resolve |
|---|---|---|---|---|
| 1 | **Manufacturer COGS quote** — 3.5 g effervescent tablet, full daily panel, premium flavour system, at 30k / 100k / 250k tablets | No quote exists | Swings 12-month LTV:CAC from **0.99× to 0.12×** across £0.10–£0.32. The widest COGS-side swing in the model. | Three emails. **Do this first.** |
| 2 | **Blended CAC** | Third-party aggregate benchmark only | Swings LTV:CAC from **1.43× to 0.38×** across £25–£95. Unhedged: there is no retail route. | £3–5k live test, two weeks |
| 3 | **Monthly churn** | Vendor benchmark, US-weighted | Sets the **ceiling** on lifetime value. At 11% the ceiling is 5% above CAC. | Cannot be desk-researched. Proxy: cohort data from a comparable UK brand, or a 90-day pilot |
| 4 | **MOQ on a shared base with three short layer runs** | Assumed | If every SKU carries a full MOQ, three products is ~3× the working capital and the answer is **one** product. Shared base: ~£31k NPD and ~135k first-run tablets vs ~£48k and 300k. | One question in the first manufacturer call |
| 5 | **Permitted GB source forms (A-043)** | Unverified | If the branded forms are not in Schedule 2, the "clinical" premium has no substance behind it. GB froze at end-2020 and has taken **one** amendment since. | One consultant email |
| 6 | **Case unit cost and tooling** | Assumption, £6.00–£15.00 + £1.5k–£9k | Decides whether the case is ever in the kit. | Two CNC quotes |
| 7 | **Royal Mail business / Mailmark rates and 3PL tariff** | Assumed 22% discount; fulfilment £1.30 | £3.02 per order is ~19% of net revenue at a monthly cadence. | Two rate cards |
| 8 | **Royal Mail published Large Letter tariff** | **Contradicts A-006** | See below. | One PDF read |

**On A-006 specifically.** I re-checked the tariffs and what I found does not match what is recorded. A-006 records "Large Letter 1st class 100 g £1.80, 250 g £3.30" and 2nd class "100 g £1.77, 250 g £2.86". This session returns **2nd class Large Letter 0–100 g £1.55, 101–250 g £2.20, 251–500 g £2.85, 501–750 g £3.75**, with 2nd class prices unchanged at the 7 April 2026 revision, and 1st class Large Letter 0–100 g at £3.30. A-006 appears to have conflated the 1st class **Letter** price (£1.80) with the **Large Letter** price. I have modelled the figures above and flagged both on the input rows. **Neither set has been read from the tariff PDF directly — royalmail.com and every reseller mirror are blocked by the proxy.** Somebody on an open connection must read it. It is a £0.65-per-order question, which at 12 orders a year is £7.80 per subscriber — about 17% of CAC.

**What the structure tells us regardless of the exact pence:** 30 × 3.5 g = 105 g of tablets alone, so **the sub-100 g band is unreachable at a daily pack in either tablet size**. The brief's "under £1.60" is not achievable at any plausible pack. Model the 101–250 g band and be pleasantly surprised.

---

## 8. Two secondary findings worth a minute of the CSO's time

**The 3.5 g tablet wins, and it is not close.** With potency no longer the differentiator and caffeine removed, nothing needs the extra payload. The 3.5 g tablet is ~20% cheaper per unit, 30 g lighter per pack, and eases both the A-032 density problem and the A-004 case geometry. The 4.5 g tablet existed to win a price-to-potency argument the user has declined to have. **Specify 3.5 g and put the burden of proof on anyone arguing for 4.5 g.**

**Caffeine-free is worth more than the ingredient it removes.** The saving on caffeine and L-theanine is about £0.028 per tablet — trivial. What it removes is an entire workstream: the >150 mg/L test, age verification at the D2C checkout (a per-transaction cost *and* a conversion cost at the single most fragile step in the funnel), two sets of FIC Annex III warning statements competing for space on a small pack, the EGCG exposure (A-044) and the open L-theanine novel-food question (A-037). I have modelled the per-order age-verification cost at £0.12–£0.45 and the one-off compliance cost at £3,000–£15,000, both now zero. **This was a good decision and it was not made for cost reasons.**

---

## 9. Assumptions touched

Updated: **A-001, A-002, A-006, A-013, A-014, A-027, A-028**.

New: **A-058** (the premium flavour system is a material COGS line) · **A-059** (cadence is the largest available lever, and the 750 g Large Letter ceiling caps it at quarterly) · **A-060** (the business fails on the LTV *ceiling*, not the horizon) · **A-061** (branded source forms are the only lever that buys a defensible premium, and may not be permitted in GB) · **A-062** (the shared-base three-SKU architecture, and the one unasked question it rests on) · **A-063** (the case consumes the starter kit's contribution) · **A-064** (list price is not realised price).

*Numbering note: `claims-regulatory` took A-052–A-057 concurrently with this run, so my new items begin at A-058. No existing row was overwritten.*

---

*`pricing-economist`, 2026-09-22. Model: `model/unit-economics.xlsx`. Every figure in this document is reproducible from that workbook; none of it is reproducible from a manufacturer's quotation, because none exists yet.*
