# UK Product Ingredient Benchmark — the nutrient matrix

**Author:** `market-mapper` · **Date of all reads:** 2026-09-22 · **Companion dataset:** `research/ingredient-benchmark.csv` (97 rows, one per product, one column per nutrient)

**Scope discipline, per user direction.** No pricing analysis, no price ladder, no market sizing, no forecasts, no unit economics. **There is no price column in the CSV at all.** Nothing in this document compares, ranks or reasons about cost.

**Evidence discipline.** Every cell in the CSV is transcribed from a declared panel or left empty with a stated reason in `other_actives`. Nothing is estimated, interpolated or back-calculated into a data cell. Where prose below performs a calculation, it is labelled **ESTIMATE** with the method shown. Statements are labelled **FACT**, **ESTIMATE** or **OPINION** per house rule 6.

This document extends `research/cube-category-map.md`, `research/category-benchmarks.md` and `research/opportunity-areas.md`. It does not repeat them. Where it corrects them, it says so explicitly.

---

## 0. What was built, and how

**FACT.** 97 UK product rows across seven propositions. **69 carry at least one declared micronutrient figure; 28 carry none** — and those 28 empty rows are findings, not failures, because in every case the product is on sale in the UK making a functional claim while publishing no numbers.

| Proposition | Rows | Of which with a declared panel |
|---|---|---|
| 1 Everyday flavour-led | 6 | 4 |
| 2 Exercise / sports hydration | 38 | 27 |
| 3 Clinical rehydration | 3 | 2 |
| 4 Everyday vitamins | 11 | 6 |
| 5 Targeted vitamin | 21 | 18 |
| 6 Energy / stimulant | 8 | 6 |
| 7 Functional / experimental | 10 | 6 |

**Sourcing.** The Holland & Barrett product sitemap (11,661 URLs) was downloaded and filtered; 74 product pages were fetched and the full nutrition panel extracted from the embedded page state (the panel is **not** in the JSON-LD — it sits in a `"nutritionals"` array in the server-rendered app state, keyed by declaration heading, and includes the exact serving basis). That single source yielded 60 panels. The rest came from en.waterdrop.com (WebFetch), wellgard.co.uk, proplus.co.uk, bulk.com, humantra.co.uk, zooki.com, medicines.org.uk (Dioralyte SmPC) and shop.rowlandspharmacy.co.uk (a Shopify store with an open `/products/*.json` endpoint, which is the most productive route to pharmacy own-label and to Dioralyte).

**How things failed, recorded rather than worked around** (§8 has the full list): tesco.com, sainsburys.co.uk, superdrug.com, mcgrocer.com and weldricks.co.uk all returned **HTTP 403**; boots.com returned **HTTP 200 with a 6 KB Imperva challenge body** and no product content; ocado.com returned **HTTP 202 with a zero-length body**; nuunlife.co.uk **301-redirects to the US store** and uk.nuunlife.com **does not resolve (DNS ENOTFOUND)**; myprotein.com's electrolyte URL **404s**.

---

## 1. THE HEADLINE — which nutrients the UK market systematically does not carry

**FACT.** Presence/absence across the 69 products that publish any panel. "Declared" means a number appears on the panel. "At ≥15% NRV" applies the threshold that conditions every authorised vitamin and mineral health claim in GB.

| Nutrient | Declared in | % of panelled products | At ≥15% NRV |
|---|---|---|---|
| Vitamin C | 49 | 71.0% | 49 |
| Magnesium | 38 | 55.1% | 29 |
| Vitamin B12 | 31 | 44.9% | 31 |
| Potassium | 31 | 44.9% | 16 |
| Vitamin B6 | 30 | 43.5% | 30 |
| Zinc | 27 | 39.1% | 27 |
| Sodium | 27 | 39.1% | n/a (no NRV) |
| Pantothenic acid (B5) | 24 | 34.8% | 24 |
| Niacin (B3) | 24 | 34.8% | 24 |
| Thiamin (B1) | 23 | 33.3% | 23 |
| Calcium | 21 | 30.4% | 12 |
| Chloride | 20 | 29.0% | 18 |
| **Riboflavin (B2)** | **19** | **27.5%** | 19 |
| Folate (B9) | 17 | 24.6% | 17 |
| Biotin (B7) | 16 | 23.2% | 16 |
| **Vitamin D** | **13** | **18.8%** | 13 |
| **Vitamin E** | **9** | **13.0%** | 9 |
| **Selenium** | **9** | **13.0%** | 9 |
| **Vitamin A** | **7** | **10.1%** | 7 |
| **Manganese** | **6** | **8.7%** | 6 |
| **Copper** | **6** | **8.7%** | 6 |
| **Iron** | **5** | **7.2%** | 5 |
| **Vitamin K** | **4** | **5.8%** | 4 |
| **Chromium** | **4** | **5.8%** | 4 |
| **Iodine** | **3** | **4.3%** | 3 |
| Phosphorus | 3 | 4.3% | 1 |

Excluding the two swallowed-tablet reference rows, the drink-only picture is harsher still: **iodine 2 of 67, phosphorus 2 of 67, chromium 3 of 67, vitamin K 3 of 67, iron 4 of 67, copper 5 of 67, manganese 5 of 67.**

### 1.1 What this changes about what the project already believed

**CONFIRMED and generalised — copper is the rarest claimable micronutrient in the UK market.** The project had found copper absent from every Waterdrop and Vitamin Well product. At market scale it is worse: **copper appears in 6 of 69 panels (8.7%), and in only 5 of 67 drink formats.** The six are Phizz Daily 3-in-1, Phizz Daily Immune+, Berocca Immuno, Vitabiotics Osteocare Fizz, Revival KIDS and Centrum Advance. **Copper is a genuine market-wide hole, and the finding survives the scale test.**

**CORRECTED — riboflavin is not a market-wide hole.** The project's finding was that riboflavin is absent from every Waterdrop and Vitamin Well product. That remains true of those two brands. But **riboflavin is declared by 19 of 69 products (27.5%)**, which puts it mid-table, ahead of folate, biotin, vitamin D and vitamin E. The "nobody carries riboflavin" framing was an artefact of looking at two brands. **The riboflavin absence is a Waterdrop-and-Vitamin-Well fact, not a category fact, and should not be used as a whitespace argument.**

There is, however, a real and separate riboflavin finding that the brand-level view missed. **FACT: riboflavin appears in the ingredient list as a COLOUR, with no declared amount, in at least seven products** — H&B High Strength Vit C & Zinc, H&B Vitamin D, H&B Hydration & Energy, Vitl Collagen & Vitamin C, Vitl Essential Magnesium, Numark Effervescent Vitamin C and Higher Nature Immune (as riboflavin-5-phosphate). **OPINION: a category that routinely puts riboflavin in the tablet as a dye and then declines to declare it as a nutrient is telling you the colour problem is solved and the declaration is a choice.** That is a more useful observation than "nobody uses riboflavin", and it cuts directly against the fluorescence objection recorded at `category-benchmarks.md` §3.

**CONFIRMED and sharpened — vitamin D, iodine and selenium.** No Waterdrop product carries any of the three; that holds. At market scale **vitamin D reaches 18.8%, selenium 13.0% and iodine 4.3%.** Iodine is the single most absent nutrient in the entire dataset. The three UK products that declare iodine are High5 Zero+ Vitamins (75 µg), Revival KIDS (70 µg) and Centrum Advance (100 µg) — **one sports sachet, one children's drink and one swallowed multivitamin. No adult everyday-vitamin drink in the UK declares iodine at all.**

**OPINION.** Rank the holes by how empty they are and how cheap they are in mass and you get one short list: **iodine, copper, manganese, vitamin K, chromium and selenium.** All six are microgram-to-low-milligram nutrients. All six are absent from more than 85% of the market. None of them is constrained by the mass arithmetic at A-066. Whether anyone wants them is a demand question this document cannot answer — and the market's near-unanimity is at least weak evidence that nobody has asked.

---

## 2. Does any UK product carry a complete authorised nutrient combination?

**Method.** Each product scored against the four complete sets. A nutrient counts as present **only at or above 15% NRV**, because that is the condition every one of these claims carries. NRV basis: Reg 1169/2011 Annex XIII as retained.

### The answer, set by set

| Set | Nutrients | Complete in UK | Who |
|---|---|---|---|
| **Antioxidant** | copper, manganese, riboflavin, selenium, vitamin C, vitamin E, zinc (7) | **1 product, and it is not a drink** | Centrum Advance (swallowed tablet) |
| **Immune** | copper, folate, iron, selenium, vitamin A, B6, B12, vitamin C, vitamin D, zinc (10) | **3 products, two of them drinks** | Centrum Advance; **Berocca Immuno**; **Phizz Daily Immune+** |
| **Iron system** | iron, vitamin C, copper, riboflavin, vitamin A (5) | **2 products, one of them a drink** | Centrum Advance; **Phizz Daily Immune+** |
| **Homocysteine** | folate, B6, B12 (3) | **15 products** | see below |

### 2.1 Best scorer on each set

**Antioxidant — best drink is 6 of 7, and there are three of them, each missing a different nutrient.**

| Score | Product | Missing |
|---|---|---|
| 7/7 | Centrum Advance (swallowed tablet) | — |
| 6/7 | High5 Zero+ Electrolytes and Vitamins Berry | **copper** |
| 6/7 | Phizz Daily 3-in-1 Mixed Berry | **selenium** |
| 6/7 | Phizz Daily Immune+ Orange | **manganese** |
| 5/7 | Berocca Immuno | manganese, riboflavin |
| 5/7 | Vitabiotics Osteocare Fizz | riboflavin, vitamin E |

**FACT: no UK drink format carries the complete authorised antioxidant set.** The project's earlier statement that "the complete authorised antioxidant combination has never been built by anyone in this category" **is confirmed for drink formats and disproved for the category as a whole** — Centrum Advance holds all seven, in a swallowed tablet, and has done so for years. **OPINION: that matters, because it removes the "nobody can build this" reading. The set is buildable; nobody has built it in a drink.**

**Immune — three products score 10 of 10, and this is the biggest correction in the exercise.**

**FACT.** **Phizz Daily Immune+** declares copper 1 mg, folic acid 200 µg, iron 7 mg, selenium 110 µg, vitamin A 400 µg, B6 7.5 mg, B12 10 µg, vitamin C 500 mg, vitamin D 25 µg and zinc 10 mg — **all ten authorised immune nutrients, every one above 15% NRV, in a UK effervescent tablet on sale at Holland & Barrett today.** Berocca Immuno also completes the set (vitamin C 1000 mg, A 700 µg, D 10 µg, E 45 mg, B6 6.5 mg, B12 9.6 µg, folic acid 400 µg, zinc 10 mg, iron 5 mg, copper 0.9 mg, selenium 110 µg).

**This directly closes a gap the project had recorded as unobtainable.** `cube-category-map.md` §7 and §9.2 record the Phizz Daily Immune+ numeric panel as unreadable after phizz.co and four retailer listings failed. **It is published as plain text in Holland & Barrett's embedded product data.** The consequence is not procedural: the project had been reasoning about immunity whitespace on the assumption that the best UK attempt was partial. It is not. **The complete immune set is occupied, twice, in the exact format V-Drop proposes to compete in.**

**Iron system — Phizz Daily Immune+ is the only UK drink that completes it.**

| Score | Product | Missing |
|---|---|---|
| 5/5 | Centrum Advance (swallowed tablet) | — |
| **5/5** | **Phizz Daily Immune+** | — |
| 4/5 | Phizz Daily 3-in-1 | iron |
| 4/5 | Berocca Immuno | riboflavin |
| 3/5 | Berocca Mind | copper, vitamin A |
| 2/5 | Waterdrop Microlyte Berry | iron, copper, riboflavin |

`category-benchmarks.md` §7.2 recorded Berocca Immuno as the closest, at 4 of 5, and concluded "no product in the UK dry category is designed around a nutrient interaction." **The first half of that is now wrong — Phizz Daily Immune+ holds all five.** The second half survives: Phizz sells the product as immunity and says nothing about iron transport, absorption or metabolism on the page. **OPINION: the components are assembled; the idea is still unclaimed. That is a much weaker position for an entrant than "nobody has the nutrients", and the proposition work should be re-based on it.**

**Homocysteine — completed by 15 of 69 products, i.e. it is not whitespace at all.**

Waterdrop Microdrink Lemon, High5 Zero+ Vitamins, Phizz Daily 3-in-1, Berocca Energy, H&B Vitamin C/B/Zinc, H&B High Strength Energy, Vegan Wellness Multivitamin, Centrum Advance, Revival KIDS, Berocca Immuno, Berocca Mind, Phizz Daily Immune+, Vitl Rehydrate & Recovery, Pro-Ven Urgent-C, Tonic Energy & Hydration. **FACT: the folate + B6 + B12 trio is a routine by-product of any B-complex, not a design decision.** The project's observation that Waterdrop Microdrink Lemon holds it accidentally and sells it as "Lemon" is correct — but so do fourteen others, for the same reason. **OPINION: homocysteine should be dropped as a candidate combination. It is the least differentiating of the four.**

### 2.2 The five coverage markers (vitamin D, riboflavin, folate, iodine, selenium)

**FACT.** Only **two of 69 products carry all five at ≥15% NRV: High5 Zero+ Electrolytes and Vitamins Berry, and Centrum Advance.** One is a 7 g sports sachet; the other is a swallowed tablet. **Thirty-eight of the 69 products carry none of the five.**

| Score | Product |
|---|---|
| 5/5 | High5 Zero+ Electrolytes and Vitamins Berry (P2) |
| 5/5 | Centrum Advance (P4, swallowed tablet) |
| 4/5 | Revival KIDS (no riboflavin) |
| 4/5 | Phizz Daily Immune+ (no iodine) |
| 4/5 | Pro-Ven Urgent-C (no iodine) |
| 3/5 | Berocca Immuno (D, folate, selenium) |
| 2/5 | Berocca Energy, Berocca Mind, both H&B own-label B-complexes, Vegan Wellness, Phizz 3-in-1, Vitl Rehydrate, High5 Ultra Hydration, Osteocare Fizz, Tonic Daily Immunity |

**OPINION.** The coverage-headroom thesis in `cube-category-map.md` §4.3 survives the scale test and gets stronger. The UK drink category is overwhelmingly a **vitamin C + B-complex + electrolyte** category. The nutrients public health actually talks about — vitamin D, iodine, selenium — are carried by a handful of outliers, and the single best coverage product in the UK is a **sports** sachet, not an everyday vitamin drink.

---

## 3. Where formulation contradicts proposition

Assigned by how the brand sells the product, then tested against what it declares. **FACT in every case below; the OPINION is only in the framing.**

**A. Products sold on electrolytes that declare no sodium — 16 of 41 in propositions 2 and 3.**

The named ones with a real panel:

| Product | Sold as | Sodium declared? | What is declared instead |
|---|---|---|---|
| **Waterdrop Microlyte Berry** | "electrolyte drink", collection titled *Electrolyte drinks for sport* | **No** | salt 0.16 g; **and no potassium at all**, despite potassium chloride being ingredient no. 2 |
| **Waterdrop Microlyte Lemon-Mint** | same | **No** | salt 0.31 g; **no potassium** |
| **Coleen Rooney Hydration Electrolyte** | "electrolyte" in the product name | **No** | salt 0.1 g, plus Celtic sea salt 100 mg as an ingredient quantity |
| **Cadence Core Hydration** | electrolyte soda | **No** | salt 1.25 g / 330 ml; sodium citrate is the lead electrolyte |
| **Ancient + Brave True Hydration** | hydration sachet | **No** | salt 0.3 g, Himalayan salt in the ingredients |
| **Vitl Rehydrate & Recovery** | "Rehydrate & Recovery" | **No** | no sodium, potassium, chloride or calcium at all — the only mineral is magnesium 56.25 mg |
| **Phizz Daily 3-in-1** | hydration + electrolytes | **Not on the H&B panel** | salt 0.8 g. The brand's own pack does state 320 mg, so this one is a retailer transcription gap rather than a formulation choice |

**The Waterdrop Microlyte finding is sharper than the project had it.** `category-benchmarks.md` §1 records Microlyte at ~124 mg sodium, derived from a declared salt figure of 0.31 g. **FACT, from a direct read on 2026-09-22: that 0.31 g figure is the Lemon-Mint panel. The Berry panel declares salt 0.16 g.** ESTIMATE, method: salt × 0.393 gives **~63 mg sodium for Berry and ~124 mg for Lemon-Mint**. So the flagship Microlyte variant — the one carrying nine vitamins and the RECHARGE name — **carries roughly half the sodium of its own sibling, and about 6% of the highest sodium figure in this dataset (Bulk, 1034 mg).** Against the benchmark that decides the category, Waterdrop's electrolyte product is not merely near the bottom; it is an order of magnitude below the top.

**B. Products sold on energy that declare no stimulant.**

| Product | Sold as | Caffeine |
|---|---|---|
| **Tonic Health Energy & Hydration** | "Energy" | **none declared** — the actives are a heavy B-complex plus Panax ginseng 50 mg |
| **H&B Hydration & Energy Effervescent** | "Hydration & Energy" | **none declared** — and no sodium either; the only vitamin is C at 40 mg |
| **Berocca Energy** | the UK's biggest effervescent "energy" brand | **none** (this was already established; recorded here for completeness) |

**C. Products sold as plain hydration that contain undeclared caffeine.**

**FACT.** **Wassen Hydrate & Replenish Electrolytes** declares green tea extract 20:1 at 7% caffeine *and* caffeine from green coffee beans in its ingredient list, and the listing carries a "contains caffeine" warning — while being merchandised as a hydration sachet. **No caffeine figure is published.** Its sibling Energy & Cognition has the identical caffeine sources and also publishes no figure. **SIS Hydro** likewise contains green tea extract with no caffeine figure. **Waterdrop Ice Tea Peach** declares 7% black tea extract, states "caffeine equivalent to a cup of tea" on the collection page, and publishes no caffeine number on the product page.

**D. Products sold as multivitamins that under-declare their own formula.**

**FACT.** **The Vegan Wellness Co. Multivitamin with Ginseng** lists ferrous lactate, potassium iodide and zinc citrate among its ingredients. Its nutrition table declares **no iron, no iodine and no zinc**. The ginseng in the product name is not quantified anywhere. **OPINION: this is the clearest instance in the dataset of a panel that is narrower than the product — and it means any presence/absence count of this category, including mine, systematically understates iron, iodine and zinc.**

**E. A multivitamin-and-electrolyte drink with no electrolytes declared.**

**FACT.** **Revival KIDS Daily Multi-Vitamin & Electrolyte Drink** declares copper, selenium, iodine, manganese, vitamins A, D, K, C, B6, B7, B9 and B12 — a coverage profile no adult drink in the dataset matches — and declares **no sodium, potassium, magnesium or calcium at all.** The word "electrolyte" is in the product name.

**F. An "amino energy + electrolytes" drink whose only electrolyte is magnesium.**

**FACT.** **Optimum Nutrition Amino Energy + Electrolytes** declares magnesium 70 mg per 250 ml and no other electrolyte, alongside 3125 mg of amino acids and 100 mg caffeine.

**G. Two hydration products whose only declared vitamin is the colour.**

**FACT.** **O.R.S. Hydration** and **High5 Zero+ Creatine** each declare exactly one vitamin — riboflavin — which in both cases is also functioning as the colourant. **OPINION: this is the honest version of what several competitors do silently (see §1.1).**

---

## 4. Proposition 1 — Everyday flavour-led

**Benchmark: flavour system and sweetener, then nutrient count.**

| Product | Sweetener | Sugar | Nutrient count | What it declares |
|---|---|---|---|---|
| Waterdrop Microdrink Lemon | sucralose | 0 g | **7** | C 20, B1 0.28, B3 4, B5 1.5, B6 0.35, B9 50 µg, B12 0.63 µg — a complete homocysteine trio in a 2.1 g cube |
| ViDrate Mixed Berry | steviol glycosides | 0 g | 5 | Na 38, K 51, Cl 107, C 25, B12 2.5 µg |
| Waterdrop Microdrink Blackcurrant | steviol glycosides from stevia | 0 g | 3 | C 20, B6 0.63, B12 1.0 µg |
| Waterdrop Ice Tea Peach | sucralose | 0 g | 2 | C 12, B3 2.4 — both at exactly 15% NRV |
| Robinsons Squash'd Orange & Peach | sucralose | 3.3 g /100 ml as sold | **0** | flavour only; no micronutrient at all |
| MiO | — | — | — | **UK availability not verified; no UK-format panel found** |

**FACT.** All four Waterdrop rows and ViDrate are zero-sugar; the only sugar in this proposition is Robinsons, and its panel is declared per 100 ml **as sold**, not per prepared serving, so it is not comparable with anything else here and the CSV says so.

**Conspicuously absent from proposition 1:** vitamin D (0 of 6), iodine (0), selenium (0), copper (0), riboflavin (0), iron (0), calcium (0), magnesium (0). **OPINION: the everyday flavour-led tier in the UK is a vitamin C and B-vitamin tier and nothing else.** Ice Tea Peach dosed at exactly 15% NRV on exactly two nutrients is the clearest statement of intent in the dataset: the minimum at which a claim becomes lawful, and not one milligram more.

---

## 5. Proposition 2 — Exercise / sports hydration

**Benchmark: sodium first, then potassium, magnesium, carbohydrate.**

Ranked on declared sodium (all figures per stated serving; blank means not declared):

| Sodium mg | Potassium | Magnesium | Calcium | Chloride | Sugar | Product |
|---|---|---|---|---|---|---|
| **1034** | 306 | 30 | 184 | — | — | Bulk Electrolyte Powder *(serving basis ambiguous — see CSV)* |
| **1000** | 250 | 100 | 50 | — | — | Puresport Ultra Electrolytes |
| **1000** | 300 | 70 | 120 | **1814** | — | Free Soul Hydrate |
| 750 | 150 | 80 | — | — | 0.3 | Hunter & Gather Restore |
| 570 | 370 | — | — | — | — | Liquid I.V. Hydration Multiplier |
| 550 | 400 | 75 | 120 | 362 | 1.2 | High5 Zero+ Ultra Hydration |
| 500 | 400 | 150 | — | 100 | — | Verve Pure Hydra |
| 500 | 300 | 100 | — | 450 | — | Bloom Hydration |
| 500 | 300 | — | — | — | 5.3 | Revival Rehydration & Recovery |
| 345 | 65 | 8.1 | 102 | 269 | 0 | SIS Hydro *(per 4 tablets)* |
| 300 | 300 | 150 | 120 | 272 | — | **High5 Zero+ Electrolytes and Vitamins** |
| 300 | 300 | 150 | — | 272 | — | High5 Zero+ Creatine |
| 300 | 200 | 62.5 | 125 | — | 0 | Wellgard ElectroMight |
| 300 | 300 | 56.25 | — | 641 | — | Spacegoods Hydro Dust |
| 270 | 100 | 25 | 15 | — | 0 | Applied Nutrition Electrolyte Hydration |
| 250 | 50 | 15 | — | — | — | Adday Complete+ |
| 204 | 300 | — | 60 | 253 | 0.5 | Starpowa Hydration |
| 200 | 200 | 55 | 81 | 295 | 1.3 | Punchy Daily Hydration Reset |
| 170 | 300 | — | — | — | 0 | Revival ZERO |
| 120 | 400 | 120 | — | 120 | 0.6 | Applied Nutrition Hydration+ Powder |
| 116 | 300 | 65 | — | 180 | — | HIRO Hydration |
| **not declared** | — | 56.3 | 120 | 120 | 0 | **Waterdrop Microlyte Berry** (salt 0.16 g) |
| **not declared** | — | 56.3 | 120 | 120 | 0 | **Waterdrop Microlyte Lemon-Mint** (salt 0.31 g) |
| not declared | 350 | 57 | 120 | — | 1.1 | Coleen Rooney Hydration |
| not declared | 190 | 30 | — | — | 0 | Cadence Core Hydration (salt 1.25 g) |
| not declared | 210 | 108 | — | — | 2.8 | Ancient + Brave True Hydration (salt 0.3 g) |
| **no panel at all** | | | | | | Ten Percent Club, REPOWR, Virtue, NUYU, XO Fitness, MaxiNutrition, Plusssz, Humantra, Nuun |

**FACT: the sodium range in a single UK proposition is 116 mg to 1034 mg — a factor of nine — and eight sports-hydration products on sale in the UK publish no numeric panel of any kind.**

**Conspicuously absent from proposition 2:** iodine (1 of 27 panelled — High5 Zero+ Vitamins alone), copper (1 of 27 — Phizz 3-in-1 alone), iron (0 of 27), vitamin K (2), vitamin A (1), selenium (2), manganese (2). **OPINION: the sports tier is a mineral tier with a B-complex bolted on. The trace elements that carry the antioxidant, immune and iron-system claims are essentially absent from it, with High5 Zero+ Vitamins the lone exception — 22 declared nutrients, the broadest panel of any UK drink in this dataset.**

---

## 6. Proposition 3 — Clinical rehydration

**Benchmark: WHO ORS spec compliance.** The WHO/UNICEF 2002 low-osmolarity formulation is, per litre: sodium 75 mmol, glucose 75 mmol, potassium 20 mmol, chloride 65 mmol, citrate 10 mmol, total osmolarity 245 mOsm/L.

| Product | Declared per stated serving | Serving basis |
|---|---|---|
| **Dioralyte Natural** (licensed medicine) | sodium chloride 0.47 g, potassium chloride 0.30 g, disodium hydrogen citrate 0.53 g, glucose 3.56 g; **SmPC states ~300 mg sodium per sachet** | 1 sachet in 200 ml |
| **O.R.S. Hydration Tablets** | sodium 277 mg, potassium 193 mg, chloride 350 mg, glucose 3.27 g, riboflavin 0.84 mg | 2 tablets in 200 ml |
| DioraHydrate | **no numeric panel published** — retailer states only "electrolytes including sodium, potassium, chloride and glucose" | 1 tablet in 200 ml |

**ESTIMATE, method shown — per-litre reconstruction, ×5 from the 200 ml serving basis, converting by atomic mass (Na 23, K 39.1, Cl 35.45, glucose 180.16):**

| | Sodium | Potassium | Chloride | Glucose |
|---|---|---|---|---|
| WHO low-osmolarity target | 75 mmol/L | 20 mmol/L | 65 mmol/L | 75 mmol/L |
| Dioralyte Natural | ~65 mmol/L (1500 mg/L) | ~20 mmol/L | ~22 mmol/L from NaCl+KCl | ~99 mmol/L (17.8 g/L) |
| O.R.S. Hydration | ~60 mmol/L (1385 mg/L) | ~25 mmol/L | ~49 mmol/L | ~91 mmol/L (16.4 g/L) |

**FACT.** O.R.S.'s retailer listing states the product "follows the World Health Organisation guidelines for low osmolarity". **OPINION, and it is a caution rather than an accusation:** on the declared figures, neither product sits exactly on the WHO numbers — both run sodium a little low and glucose a little high against the 2002 formulation, and Dioralyte's chloride is well below it because a substantial share of its anion load is citrate rather than chloride. Dioralyte is a licensed medicine whose composition predates the 2002 revision and is not obliged to match it. **What the comparison actually shows is that "ORS spec" is used loosely in UK retail, and that the only two products in this proposition with published numbers are not identical to each other or to WHO.**

**Conspicuously absent:** everything. Between them these products declare **four** micronutrients (sodium, potassium, chloride, riboflavin). No vitamin C, no zinc, no magnesium. **OPINION: that is correct clinical design, not a gap, and any entrant borrowing "ORS" language while adding a vitamin load is borrowing credibility it has not earned.**

---

## 7. Propositions 4 to 7 — the remaining benchmarks

### 7.1 Proposition 4 — Everyday vitamins. Benchmark: coverage of the five markers.

| Product | D | B2 | Folate | Iodine | Selenium | Score | Nutrient count |
|---|---|---|---|---|---|---|---|
| **Centrum Advance** *(swallowed tablet reference)* | 5 µg | 1.7 mg | 200 µg | 100 µg | 30 µg | **5/5** | 23 |
| Revival KIDS | 3 µg | — | 100 µg | 70 µg | 20 µg | 4/5 | 12 |
| Berocca Energy | — | 13.6 mg | 366 µg | — | — | 2/5 | 11 |
| H&B Vitamin C, B & Zinc | — | 4.20 mg | 200 µg | — | — | 2/5 | 10 |
| H&B High Strength Energy | — | 15 mg | 400 µg | — | — | 2/5 | 12 |
| Vegan Wellness Multivitamin | — | 1.4 mg | 200 µg | *(iodine in ingredients, not declared)* | — | 2/5 | 12 |
| Applied Nutrition Multivitamin | **panel published as an image only** | | | | | — | 0 |
| 3-in-1 Formula, Numark Energy Release, Superdrug, Sainsbury's own-label | **no panel obtainable** | | | | | — | 0 |

**FACT: no adult everyday-vitamin DRINK on the UK market scores better than 2 of 5 on the coverage markers.** The only two products in the whole dataset that score 5/5 are a sports sachet and a swallowed tablet. **The everyday-vitamin drink tier in the UK is a B-complex-plus-vitamin-C tier with no vitamin D, no iodine and no selenium.**

**Conspicuously absent:** vitamin D (1 of 6 panelled, and it is the children's product), iodine (2 of 6, one children's one swallowed tablet), vitamin K (2 of 6, same two), iron (2 of 6, same two), copper (2 of 6, same two).

### 7.2 Proposition 5 — Targeted vitamin. Benchmark: how much of the relevant authorised claim set the product actually carries.

| Product | Territory | Relevant set | Score |
|---|---|---|---|
| **Phizz Daily Immune+** | immunity | immune (10) | **10/10 — complete** |
| **Berocca Immuno** | immunity | immune (10) | **10/10 — complete** |
| Tonic Daily Immunity | immunity | immune (10) | 5/10 (no copper, iron, folate, B6 usable, B12 present) |
| Higher Nature Immune | immunity | immune (10) | 3/10 (C, D, zinc) |
| H&B High Strength Vit C & Zinc | immunity | immune (10) | 2/10 |
| Vitabiotics Ultra Vitamin C & Zinc | immunity | immune (10) | 2/10 |
| Bionutrica BioC, Numark Vit C, Natures Aid Vit C, Voost Vit C | immunity | immune (10) | 1/10 each |
| Tesco own-label, Sainsbury's own-label | immunity | immune (10) | 2/10 each *(search-grade)* |
| Berocca Mind | cognition | homocysteine (3) | 3/3 complete; iron 12 mg is the cognitive lead |
| Vitabiotics Osteocare Fizz | bone | — | D 10 µg + Ca 400 mg + Mg 60 mg + Zn + Cu + Mn + Se + C: the broadest mineral panel of any targeted tablet |
| Bioglan Beauty Collagen | beauty | beauty claims | C, biotin and selenium **all at exactly 15% NRV and nothing above it** |
| Vitl Collagen & Vitamin C | beauty | beauty claims | 1 nutrient |

**FACT.** The immunity shelf is bimodal: two products carry the complete ten-nutrient authorised set, and eleven carry one or two nutrients. **There is almost nothing in between.**

### 7.3 Proposition 6 — Energy / stimulant. Benchmark: caffeine mg and any second active.

| Caffeine | Second active | Product |
|---|---|---|
| 120 mg | chaga, cordyceps, ashwagandha, lion's mane, maca — **all unquantified** | Spacegoods Rainbow Dust *(classified P7)* |
| 100 mg | guarana 30 mg, Panax ginseng 30 mg | Pro Plus Fizz |
| 100 mg | BCAA 2000 mg, taurine 500 mg, 5 further aminos | Optimum Nutrition Amino Energy |
| 100 mg | elderberry 200 mg, beta-glucans 100 mg, CoQ10 10 mg, 4 probiotic strains | Pro-Ven Urgent-C |
| 100 mg | L-theanine 200 mg | Zooki Energy & Focus *(no numeric panel)* |
| 90 mg | none | Waterdrop Microenergy |
| **none declared** | Panax ginseng 50 mg | **Tonic Health Energy & Hydration** |
| **none declared** | none | **H&B Hydration & Energy** |
| **present but unquantified** | green tea 20:1 at 7% caffeine + green coffee caffeine | Wassen Energy & Cognition |

**FACT: the declared-caffeine band in the UK is narrow — 90 to 120 mg, five of the six clustered at 90–100 mg.** Nobody is at 50 mg and nobody is at 200 mg. **OPINION: that band is a regulatory artefact, not a pharmacological one — it sits just above the 75 mg threshold that made the (never-adopted) EFSA alertness opinions relevant, and just below the point where the mandatory "high caffeine content" warning becomes commercially awkward on an everyday product.**

### 7.4 Proposition 7 — Functional / experimental. Benchmark: hero active, dose, novel-food status.

| Product | Hero active and dose | Micronutrients declared | Status note |
|---|---|---|---|
| Spacegoods Astro Dust | L-glycine 3000 mg, reishi 1000 mg, tremella 1000 mg, maitake 1000 mg, ashwagandha 500 mg, L-tryptophan 220 mg | **1** (magnesium 169 mg) | ashwagandha under live FSA/COT safety review per project records |
| DIRTEA Matcha | lion's mane extract 1250 mg, tremella extract 1250 mg | **4** (B5, B6, B7, B12) | lion's mane concentrated extract has an unresolved GB novel-food position |
| London Nootropics Mush Love | lion's mane 160 mg, chaga 160 mg, **cordyceps sinensis 160 mg** (5% cordycepin) | **0** | cordyceps is subject to an FSA stop-sale position recorded in this project |
| Spacegoods Rainbow Dust | chaga, cordyceps, ashwagandha, lion's mane, maca — **all unquantified** | **0** | as above; caffeine 120 mg declared in advisory text only |
| Tonic Health Rest & Recover | ashwagandha KSM-66 100 mg, lemon balm 500 mg | **1** (magnesium 300 mg) | brand advertises "no melatonin" |
| DIRTEA Coffee | lion's mane 16%, chaga 12%, tremella 12% — **percentages only, no absolute doses** | **0** | — |
| London Nootropics Flow | lion's mane, rhodiola — **unquantified** | **0** | — |
| Wassen Relax & Unwind / Hydrate & Replenish | chamomile 10:1, lemon balm 4:1, Montmorency cherry — **unquantified** | **0** | — |
| Goodrays Re:Focus | lion's mane extract — **unquantified** | **0** | prints three authorised magnesium claims with no magnesium figure |

**FACT: of the ten functional/experimental rows, six declare zero micronutrients and six publish no absolute dose for their hero active.** **FACT: gram-scale actives appear only in powders and sachets — Astro Dust at 8 g and DIRTEA Matcha at 6 g. No effervescent tablet or cube in the entire 97-row dataset carries a gram-scale botanical.** The heaviest botanical in a tablet is Tonic Rest & Recover's 500 mg lemon balm extract (from 50 mg of a 10:1 concentrate). **This confirms `category-benchmarks.md` §4 at market scale and at a much larger sample.**

---

## 8. What I could not verify, and exactly how each failed

| Target | How it failed | Consequence |
|---|---|---|
| tesco.com | **HTTP 403** to curl and WebFetch | Tesco own-label row is search-grade, low confidence |
| sainsburys.co.uk | **HTTP 403**; the mcgrocer.com mirror also **403** | Sainsbury's rows search-grade / empty, low confidence |
| superdrug.com | **HTTP 403** to curl and WebFetch | Superdrug own-label row is empty |
| boots.com | **HTTP 200, 6 KB Imperva "Pardon Our Interruption" body.** Confirms the prior record: a challenge, not a network refusal | No Boots own-label panel |
| ocado.com | **HTTP 202, zero-length body** (Akamai queue) | Not used |
| amazon.co.uk | **HTTP 200, ~3.8 KB captcha body** | Not used |
| nuunlife.co.uk | **301 to the US nuunlife.com**; uk.nuunlife.com **DNS ENOTFOUND**; not in the H&B catalogue | Nuun row recorded with no figures |
| myprotein.com | electrolyte product URL **404** | MyProtein not covered |
| precisionhydration.com | pages load but publish **no nutrition table** on either PH 1000 or PH 1500 | Precision Fuel & Hydration not covered |
| humantra.co.uk | loads; **prose only, no numeric panel** | Row recorded empty, low confidence |
| zooki.com | loads; publishes a **single aggregate "1788 mg electrolytes"** figure and no breakdown | Row recorded with caffeine and theanine only |
| phizz.co | loads; **no numeric panel** on either Daily Energy or Daily Immune+ | **Resolved via Holland & Barrett, which publishes both panels as text** |
| proplus.co.uk | loads; actives listed but **no %NRV, no tablet mass, no sweetener, no full ingredient list** | Row medium confidence |
| appliednutrition.uk | multivitamin panel **published as an image only**; Rowlands listing has ingredients but no table | Row empty, low confidence |
| voost.com | **HTTP 202, empty body**; no voost.co.uk; UK reseller publishes no panel | Row low confidence |
| bulk.com | loads, but the active table is headed "Per Serving (2 servings)" — **ambiguous serving basis** | Row low confidence, ambiguity recorded in the cell |
| Berocca, Vitabiotics, H&B own-label, Tonic, Bioglan, Vitl **tablet masses** | **none of these brands publishes a per-tablet mass** anywhere | Mass-normalised comparison remains impossible outside Waterdrop (2.0–2.3 g), Phizz (4.3 g), Applied Nutrition (4 g), SIS (4.5 g), High5 (7 g / 11.5 g), Coleen Rooney (7 g), Humantra (3.7 g), Adday (3 g), ViDrate (3 g), Verve (6.7 g), Hunter & Gather (5.1 g), Wellgard (5 g), Voost (4 g) |
| **Prepared volume** | **Only 11 of 97 rows publish one.** Waterdrop (500 ml), Wellgard (200 ml), Dioralyte and O.R.S. (200 ml), Applied Nutrition tablets (200–500 ml), Humantra and Zooki (500–1000 ml) | **This is the single biggest comparability problem in the category.** A 300 mg sodium sachet in 250 ml and the same sachet in 1000 ml are different products, and most brands do not say which they are |
| MiO | every panel located is a **US formulation**; no UK listing found | Row recorded with no figures rather than transcribing a US panel as UK |

---

## 9. The ten things that matter, each tied to a row in the CSV

1. **FACT.** Copper is declared by 6 of 69 UK products (8.7%) and 5 of 67 drinks. It is the rarest claimable nutrient that unlocks multiple authorised combination claims. The project's copper finding survives the scale test.
2. **CORRECTION, FACT.** Riboflavin is declared by 19 of 69 products (27.5%) — mid-table, not absent. The "nobody carries riboflavin" claim was a two-brand artefact and should be withdrawn.
3. **FACT.** Riboflavin appears as an undeclared **colourant** in at least seven products. The fluorescence objection to using riboflavin as a nutrient is weaker than the project assumed, because the category is already putting it in the tablet.
4. **FACT.** Iodine is the most absent nutrient in the UK market: 3 of 69, and only 2 of 67 drinks — one of which is a children's product.
5. **FACT, and it closes an open gap.** Phizz Daily Immune+ carries the **complete ten-nutrient authorised immune set** and the **complete five-nutrient iron system**, in a UK effervescent tablet, today. The panel the project recorded as unobtainable is published in Holland & Barrett's product data.
6. **FACT.** **No UK drink carries the complete seven-nutrient antioxidant set.** The best are three products at 6 of 7, each missing a different nutrient (copper, selenium, manganese). Centrum Advance completes it in a swallowed tablet, so buildability is not in question.
7. **FACT.** The homocysteine trio is completed by 15 of 69 products. It is a by-product of any B-complex and is not a differentiator.
8. **FACT.** Waterdrop Microlyte **Berry** declares salt 0.16 g, not the 0.31 g the project had recorded from the Lemon-Mint panel. ESTIMATE: ~63 mg sodium, against a category range topping 1000 mg. Neither Microlyte declares potassium at all.
9. **FACT.** Sixteen of 41 products in the two hydration propositions declare no sodium figure, and eight publish no numeric panel of any kind.
10. **FACT.** Only 11 of 97 products publish a prepared volume. Any cross-brand concentration comparison in this category is, strictly, unsupported by the declared data.

**OPINION, and the limit of all of it.** This is a supply-side map. It establishes what is declared and what is not. It says nothing about whether a buyer wants iodine, copper or a complete antioxidant set, and the customer-insight work on file found nobody asking for any of it. The empty columns are opportunities only if demand exists, and demand is not what this exercise measured.
