# Project V-Drop — UK Competitor Map (Phase 1, Step 1)

**Owner:** `market-mapper` · **Date checked:** 2026-09-21 · **Currency:** £ inc VAT unless stated
**Database:** `/home/user/PROJECT-FIZZ/research/competitors.csv` (42 rows: 27 Direct, 8 Adjacent, 7 Substitute; 2 of the Direct rows are V-Drop's own proposed SKUs, included as reference lines, and 2 Substitute rows are behavioural baselines)
**Charts:** `/home/user/PROJECT-FIZZ/research/charts/map-a-price-vs-intensity.png`, `/home/user/PROJECT-FIZZ/research/charts/map-b-design-vs-portability.png`

---

## 0. Sourcing health warning — read this before using any number

**FACT.** Every UK retailer and brand domain I attempted was refused by this session's egress proxy with a 403 on CONNECT. That includes `waterdrop.com`, `en.waterdrop.com`, `phizz.co`, `spacegoods.com`, `boots.com`, `tesco.com`, `amazon.co.uk`, `hollandandbarrett.com`, `superdrug.com`, `sainsburys.co.uk`, `ocado.com`, `groceries.morrisons.com`, `healthysupplies.co.uk`, `nuun.co.uk`, `scienceinsport.com`, `highfive.co.uk`, `precisionhydration.com`, `myprotein.com`, `tenzingnaturalenergy.com`, `triptdrinks.com`, `grenade.com` and `redbull.com`. Verified with both the `WebFetch` tool and `curl`; proxy status endpoint reports no relay failures, so this is an organisation egress policy, not a transient fault.

**Consequence.** **I read no competitor page directly.** Every figure below comes from a search-engine result summary that quotes a named UK page, and the URL recorded in the CSV is the page the summary was drawn from. Under the house rules that is weaker than a direct read, so:

- **No row in the CSV is rated `high` confidence.** 20 are `med`, 19 are `low`, 3 are `n/a` (V-Drop's own proposal and two behavioural baselines).
- `med` means the figure appeared explicitly in a search summary attributed to a named UK source, and ideally was corroborated by a second.
- `low` means the figure is a range, came from a non-UK listing, came from an aggregator rather than a retailer, or could not be found at all.
- **Before this map is used to set price, someone with unrestricted browser access must re-read the ~12 pages that carry the load.** They are listed in §10.

Statements are labelled FACT (sourced), ESTIMATE (method shown) or OPINION.

---

## 1. Market structure summary

### 1.1 How the category actually segments

The UK "put something functional in your water" market is not one category. It is five, with different shelves, different buyers and a 40× price spread:

| Segment | What it is | Who leads (UK) | Typical £/serving | Design cue |
|---|---|---|---|---|
| **Commodity effervescent vitamin** | Retailer own-brand vitamin C / vitamin C+zinc tubes | Tesco Health, Boots own brand | £0.06 – £0.09 | clinical |
| **Sports hydration tablet** | Electrolyte tubes on the cycling/running shelf | HIGH5, SiS, Nuun, Applied Nutrition, Precision Engineered (H&B) | £0.25 – £0.40 | sporty |
| **Pharmacy multi-benefit effervescent** | The big-brand "does several things" tablet | Berocca (Bayer), Phizz, Tonic Health | £0.40 – £0.90 | clinical → lifestyle |
| **Premium lifestyle water-enhancer** | Design-led cubes and sticks | Waterdrop, Liquid I.V. | £0.75 – £1.07 | premium-design / lifestyle |
| **Functional powder & nootropic** | Mushroom, adaptogen and nootropic mixes and RTDs | Spacegoods, DIRTEA, London Nootropics, Neutonic, TRIP | £0.52 – £2.50 | premium-design / lifestyle |

**OPINION.** V-Drop's brief assumes the market is a line running from cheap squash to clinical tablets, with a hole in the middle. It is better read as five separate shelves. A single product cannot sit "between" them; it must pick one shelf and beat the leader there. The Direct ring's mid-price band that V-Drop's retail tube targets (£0.40–£0.67) is the **most crowded** band in the whole dataset, containing Phizz, HIGH5, Berocca Immuno, Berocca Mind and DIRTEA Coffee.

### 1.2 Who leads each segment

- **Phizz** has the broadest Direct-ring distribution I could evidence: Boots, Tesco, Superdrug, Morrisons, Rowlands, independents and its own D2C store. It is the reference product for "effervescent that does hydration + vitamins". ([phizz.co](https://www.phizz.co/products/3-in-1-hydration-electrolytes-vitamins-20), [Tesco](https://www.tesco.com/groceries/en-GB/products/312575988), [Boots](https://www.boots.com/phizz-orange-3-in-1-hydration-electrolytes-and-vitamins-effervescent-tablets-20-tablets-10285064))
- **Berocca (Bayer)** owns the pharmacy effervescent shelf and has already extended into V-Drop's intended claim territories: **Berocca Mind** (focus, £9.99/15 at Boots) and **Berocca Immuno** (immunity, £15.00/30). ([Boots Mind](https://www.boots.com/berocca-mind-berry-tablets-15s-10358306), [Boots Immuno](https://www.boots.com/berocca-immuno-orange-effervescent-tablets-30s-10372054))
- **Waterdrop** owns premium-design portability, D2C-first with a tiered subscription. ([waterdrop](https://en.waterdrop.com/products/microdrink-blackcurrant), [subscription](https://en.waterdrop.com/collections/subscription))
- **Spacegoods** and **DIRTEA** lead UK functional mushrooms; both are D2C-first with heavy subscription discounts and both now sit in Holland & Barrett. ([H&B Spacegoods](https://www.hollandandbarrett.com/shop/product/spacegoods-rainbow-dust-chocolate-240g-6100002032))
- **Neutonic** sets the UK dose expectation for "focus" in an RTD: Cognizin 500 mg, L-theanine 400 mg, rhodiola 400 mg, ginseng 200 mg, caffeine 120 mg. ([neutonic.com](https://www.neutonic.com/products/productivity-drink-strawberry-lemonade-uk), [Amazon UK](https://www.amazon.co.uk/Neutonic-Productivity-Energy-Drink-Boost/dp/B0C9D4TJQ9))

### 1.3 Market-size figures — and why to distrust them

| Figure | Source | Reliability |
|---|---|---|
| UK vitamins & supplements retail ≈ **£568m (2023)** | Mintel, cited second-hand | **Medium-low.** Mintel is a credible house, but I could not reach the report itself; this is a citation of a citation. Also a narrow definition that excludes sports nutrition. ([Mintel store page](https://store.mintel.com/report/uk-vitamins-and-supplements-market-report)) |
| UK dietary supplements **$8.14bn (2024) → $18.15bn (2035)** | Market Research Future | **Low.** SEO-driven vendor report; implies a doubling in 11 years with no method shown; scope is very broad. ([MRFR](https://www.marketresearchfuture.com/reports/uk-dietary-supplements-market-47647)) |
| UK functional drinks **$15.07bn by 2035, 7.81% CAGR** | Spherical Insights | **Low.** Same class of vendor; forecast-only, no base year given in the summary. ([Spherical Insights](https://www.sphericalinsights.com/reports/united-kingdom-functional-drinks-market)) |
| UK water-enhancer market "led by Kraft's MiO" | Mordor Intelligence | **Low, and likely stale.** Contradicted by the fact that I could find no mainstream UK grocery listing for MiO — only import marketplaces. A 2014 trade article reported UK water-enhancer sales being held back by "poor value" perceptions. ([Mordor](https://www.mordorintelligence.com/industry-reports/uk-water-enhancer-market), [BeverageDaily 2014](https://www.beveragedaily.com/Article/2014/10/20/Poor-value-perception-shakes-UK-water-enhancer-sales-Canadean/)) |

**OPINION.** Do not put any of these numbers in an investor deck. The only sizing figure worth quoting is the Mintel one, and only with the caveat attached. If Phase 1 needs a real number, buy the Mintel report or pull Nielsen/Kantar EPOS for the effervescent-tablet subcategory specifically.

---

## 2. Price ladder (the priority section)

All prices are **standard RRP inc VAT**, never promotional, per house rule. Direct and Adjacent rings only. V-Drop's three price points are marked in bold.

| # | £/serving | Brand & product | Ring | Intensity | Conf. |
|---:|---:|---|---|---:|---|
| 1 | £0.060 | Tesco Health High Strength Vitamin C 1000 mg, 20 | direct | 2 | med |
| 2 | £0.088 | Boots High Strength Vitamin C 1000 mg, 20 | direct | 2 | med |
| 3 | £0.111 | Holland & Barrett Electrolyte, 180 tabs (swallowed) | adjacent | 2 | low |
| 4 | £0.250 | Applied Nutrition Electrolyte Hydration (Vimto), 20 | direct | 2 | med |
| 5 | £0.250 | Precision Engineered (H&B) Hydration & Energy, 20 | direct | 2 | med |
| 6 | £0.333 | Phizz Daily 3-in-1, 3 × 20 bundle | direct | 3 | low |
| 7 | £0.350 | SiS GO Hydro, 20 | direct | 2 | med |
| 8 | £0.400 | **Phizz Daily 3-in-1, 20** | direct | 3 | med |
| 9 | £0.400 | HIGH5 ZERO, 20 | direct | 2 | med |
| **10** | **£0.466** | **V-DROP retail tube (£6.99 ÷ 15)** | direct | **2–4** | n/a |
| 11 | £0.500 | Berocca Immuno Orange, 30 | direct | 2 | med |
| 12 | £0.516 | DIRTEA Coffee Super Blend, 60 servings | adjacent | 3 | med |
| 13 | £0.666 | **Berocca Mind Berry, 15** | direct | 3 | med |
| 14 | £0.749 | **Waterdrop Microdrink, 12** | direct | 1 | med |
| 15 | £0.817 | Dioralyte Blackcurrant, 6 sachets | direct | 3 | med |
| **16** | **£0.833** | **V-DROP subscription (£19.99 ÷ 24)** | direct | **2–4** | n/a |
| 17 | £0.900 | Tonic Health High Dose Immunity sachets, 10 | direct | 4 | low |
| 18 | £1.000 | London Nootropics Adaptogenic Coffee, 12 (sub price) | adjacent | 3 | med |
| 19 | £1.032 | DIRTEA Lion's Mane Powder, 30 servings | adjacent | 4 | med |
| 20 | £1.067 | Liquid I.V. Hydration Multiplier, 15 sachets | direct | 2 | med |
| **21** | **£1.250** | **V-DROP starter kit, month 1 (£29.99 ÷ 24)** | direct | **2–4** | n/a |
| 22 | £1.300 | Spacegoods Rainbow Dust, 30 (subscription) | adjacent | 4 | med |
| 23 | £1.625 | TRIP Mindful Blend, 4 × 250 ml | adjacent | 2 | med |
| 24 | £1.633 | **Spacegoods Rainbow Dust, 30 (one-time RRP)** | adjacent | 4 | med |
| 25 | £2.250 | TENZING Natural Energy, 250 ml | adjacent | 3 | med |
| 26 | £2.499 | Neutonic Productivity Drink, 12 × 330 ml | adjacent | 5 | med |

Unpriced (no UK RRP obtainable this session, all `low`): Waterdrop Microenergy, Waterdrop Microlyte, Berocca Energy 15s, Berocca Boost 20s, Tonic Health tablets 20s, Nuun Sport, Precision Fuel & Hydration PH 1000, Hydralyte, Myprotein THE Electro, Vitatech Energy Effervescent, Science Fitness Energy Effervescent, Phizz 80s.

### 2.1 What the ladder says

1. **FACT. V-Drop's subscription would be the most expensive effervescent tablet per serving in this dataset.** At £0.833 it sits above Waterdrop's cube (£0.749, +11%), above Berocca Mind (£0.666, +25%), above Berocca Immuno (£0.500, +67%) and above Phizz (£0.400, +108%). The only Direct-ring items above it are two sachet products (Tonic Health £0.900, Liquid I.V. £1.067) and a licensed medicine (Dioralyte £0.817, which it also exceeds). *Method: figures from the table above.*

2. **FACT. V-Drop's retail tube sits in the most crowded band on the ladder.** £0.466 lands between HIGH5/Phizz (£0.400) and Berocca Immuno (£0.500) — a 10p-wide band containing four established national products.

3. **FACT (arithmetic). Retail undercuts subscription by 44%.** (£0.833 − £0.466) ÷ £0.833 = 44.1%. A-003 records this as 45%; 44% is the exact figure from £6.99÷15 and £19.99÷24.

4. **ESTIMATE. The inversion is worse once retailer margin is modelled.** Net of VAT the subscription realises £0.694/serving (£19.99 ÷ 1.2 ÷ 24). The retail tube nets £0.388/serving before the retailer's cut (£6.99 ÷ 1.2 ÷ 15). At a conventional Boots health-and-beauty margin of ~40% on the sell price, V-Drop would realise roughly £4.19 inc VAT / £3.49 net per tube = **~£0.233/serving net — about one third of what a subscriber delivers.** *Method: 40% retailer margin is an assumption, not a sourced figure; filed as a new assumption A-029.*

5. **OPINION — shelf credibility and channel conflict.** Two things follow and they pull in opposite directions. (a) A shopper who sees £6.99/15 at Boots and is then asked for £19.99/24 online has been shown a 79% price increase per serving for the same tablet; that is a subscription-cancellation argument handed to the customer for free. (b) Conversely, a £6.99 impulse tube next to Berocca at £9.99 and Phizz at £7.99 reads as *cheaper than the pharmacy brands*, which sits awkwardly with "premium bio-performance". V-Drop cannot be both the value option on the Boots shelf and the premium option in the inbox. **This needs a decision, not a reconciliation.**

---

## 3. Map A — Price per serving vs functional intensity

**PNG:** `/home/user/PROJECT-FIZZ/research/charts/map-a-price-vs-intensity.png` (log x-axis; V-Drop's three SKUs plotted separately at both price points)

### 3.1 Scoring rubrics (reproduce these to re-score)

**Functional intensity, 0–5.** Score on the *declared, dosed* actives per serving. Undeclared doses cannot earn points.

| Score | Test | Worked example from this dataset |
|---|---|---|
| **0** | Flavour only; no functional active | Robinsons Squash'd — flavour, acid, sweetener |
| **1** | Token vitamins, all under 50% NRV | **Waterdrop Microdrink** — B6 0.63 mg (45% NRV), B12 1 µg (40% NRV) |
| **2** | Meaningful vitamins (≥100% NRV) **or** meaningful electrolytes, but nothing beyond | Boots vitamin C 1000 mg (1,250% NRV); Nuun Sport (Na 300 mg, K 150 mg) |
| **3** | At least one active at a studied dose (e.g. caffeine ≥75 mg; vitamin D 1000 IU; ORS-standard electrolytes) | TENZING (caffeine 80 mg); Phizz (vit C 300 mg + 7 electrolytes); Dioralyte (WHO-pattern ORS) |
| **4** | Several actives, **some** at studied doses | Spacegoods (caffeine 80 mg at a studied dose; 1 g each of three mushroom extracts; ashwagandha 200 mg below range); Tonic Health (vit C 1000 mg, D3 25 µg, reishi 1500 mg) |
| **5** | Several actives, **all at or near** studied doses | Neutonic (citicoline 500 mg — the dose used in cognition trials; L-theanine 400 mg; rhodiola 400 mg; caffeine 120 mg; 8 B vitamins at 100% NRV) |

**Portability, 1–5.** 1 = bulky tub or bottle. 2 = can or large pouch. 3 = standard effervescent tube (~30 mm × 133–144 mm). 4 = slim tube. 5 = pocket or wallet-sized (cube pack, sachet, flat case).

### 3.2 V-Drop's own intensity scores, with evidence

| SKU | Score | Evidence and reasoning |
|---|---:|---|
| **Energy** | **4** | Caffeine 80 mg clears the ≥75 mg studied threshold. L-theanine 120 mg sits inside the commonly studied 100–200 mg band. Two actives at studied doses = level 4. It does **not** reach 5 because the "Vitamin B-Complex (B3, B6, B9, B12)" carries **no doses at all** and "Trace Minerals: 100 mg" names no species (A-021, A-020) — undeclared actives cannot score. |
| **Recovery** | **3** | Vitamin C 200 mg (250% NRV) and D3 1,000 IU (25 µg) are meaningful, studied doses. Ashwagandha 150 mg is **below** the 300–600 mg studied range (A-011). Zinc bisglycinate 10 mg is ambiguous: if that is 10 mg of the chelate it delivers ~2 mg elemental zinc, ~20% NRV (A-020). "Full-Spectrum Minerals: 70 mg" names nothing. One-to-two actives at studied doses, several below or undeclared = 3. |
| **Mind** | **2** | This is the weak one. Lion's mane 200 mg of a 20:1 extract, cordyceps 150 mg of a 10:1, Alpha-GPC 100 mg — **none of these is at a dose used in the cognition literature**, where Alpha-GPC trials typically run 300–600 mg/day and EFSA's 2026 novel-food assessment proposed a maximum of 203.7 mg/day, i.e. V-Drop sits at under half the *ceiling*, let alone the studied dose (A-010). B6/B12 are undosed and the spec is unusable as written (A-021). Several actives, none clearly at a studied dose → the rubric gives 2, not 4. |

**This is the single most important finding in the report and it is a direct consequence of A-019.** The 15% / ~500 mg cap on the Active Functional Core means Mind (≈460 mg) and Recovery (≈430 mg) have essentially zero headroom. Raising Alpha-GPC to 300 mg or ashwagandha to 300 mg would each consume most of the remaining core on its own.

### 3.3 Mermaid — Map A

```mermaid
quadrantChart
    title Map A - Price per serving (x) vs functional intensity (y), UK, 2026-09-21
    x-axis "Cheap (£0.00)" --> "Expensive (£2.60)"
    y-axis "Low intensity (0)" --> "High intensity (5)"
    quadrant-1 "Premium potency (earn the price)"
    quadrant-2 "Value potency (hard to beat)"
    quadrant-3 "Commodity"
    quadrant-4 "Danger zone: paying for the packaging"
    "Tesco vit C 1000mg": [0.023, 0.40]
    "Boots vit C 1000mg": [0.034, 0.40]
    "Applied Nutrition Vimto": [0.096, 0.40]
    "SiS GO Hydro": [0.135, 0.40]
    "Phizz Daily 3-in-1": [0.154, 0.60]
    "HIGH5 ZERO": [0.155, 0.41]
    "V-DROP retail £0.47": [0.179, 0.60]
    "Berocca Immuno": [0.192, 0.40]
    "DIRTEA Coffee": [0.198, 0.60]
    "Berocca Mind": [0.256, 0.60]
    "Waterdrop Microdrink": [0.288, 0.20]
    "Dioralyte": [0.314, 0.60]
    "V-DROP sub £0.83": [0.320, 0.61]
    "Tonic Health sachets": [0.346, 0.80]
    "London Nootropics": [0.385, 0.60]
    "DIRTEA Lion's Mane": [0.397, 0.80]
    "Liquid I.V.": [0.410, 0.40]
    "Spacegoods sub": [0.500, 0.80]
    "TRIP Mindful Blend": [0.625, 0.40]
    "Spacegoods RRP": [0.628, 0.81]
    "TENZING": [0.865, 0.60]
    "Neutonic": [0.961, 1.00]
```

**Reading it.** V-Drop retail sits in a defensible spot: mid-price, mid-to-high intensity, clearly above Waterdrop on both counts. V-Drop subscription moves right without moving up — the same tablet, 79% more per serving. On this map the subscription price is what puts V-Drop's Mind SKU (intensity 2 at £0.833) closest to the danger quadrant, next to Waterdrop and Liquid I.V.

---

## 4. Map B — Design cue vs portability

**PNG:** `/home/user/PROJECT-FIZZ/research/charts/map-b-design-vs-portability.png`

### 4.1 The portability claim, tested (A-023)

The brief asserts Phizz and Berocca are "bulky, non-portable tubes". **PARTLY DISPROVED.**

**FACT.** Standard effervescent tube packaging for ~27 mm tablets is manufactured in heights of 84, 96, 99, 133 and 144 mm, with the tube internal diameter conventionally ~2 mm greater than the tablet diameter. ([Xinfuda](https://www.xinfuda-group.com/news/effervescent-tablet-tube-sizes.html), [Sanner](https://www.sanner-group.com/moisture-management/tubes-for-effervescent-tablets))

**ESTIMATE.** A 20-tablet Phizz or HIGH5 tube is therefore approximately **Ø30 mm × 140 mm**, a cylinder of ≈99 cm³ holding 20 servings = **≈4.9 cm³ per serving**.

**ESTIMATE.** The V-Drop case at 110 × 62 × 11 mm is **75 cm³**. Per A-004 it holds **8** tablets, not 12 (6 × 23 mm = 138 mm exceeds the 110 mm long axis). That is **≈9.4 cm³ per serving — roughly twice the volume per serving of a conventional tube.**

**Verdict, stated plainly:**
- **The case wins on cross-section.** 11 mm flat versus a ~30 mm cylinder is a genuine, meaningful difference for a trouser pocket, jacket pocket or laptop sleeve. The case is also shorter than the tube (110 mm vs ~140 mm).
- **The case loses on volume efficiency.** It carries fewer servings per cm³ than the thing it is meant to replace, and holds 8 servings against a tube's 20.
- **"Non-portable" is an overstatement.** Three Direct-ring competitors already score 5 on portability: Waterdrop's cube pack, Liquid I.V.'s sticks and Tonic Health's sachets. A sachet is flatter and lighter than any metal case will ever be.
- **"Tastes clinical" is UNVERIFIED and unverifiable from desk research.** It requires a sensory panel. Do not repeat it as fact.

### 4.2 Mermaid — Map B

```mermaid
quadrantChart
    title Map B - Design cue (x, clinical to lifestyle) vs portability (y), UK, 2026-09-21
    x-axis "Clinical" --> "Lifestyle / premium-design"
    y-axis "Bulky (1)" --> "Pocket-sized (5)"
    quadrant-1 "Lifestyle + pocketable (the contested corner)"
    quadrant-2 "Clinical + pocketable"
    quadrant-3 "Clinical + bulky"
    quadrant-4 "Lifestyle + bulky"
    "Dioralyte": [0.10, 0.98]
    "Hydralyte": [0.09, 0.78]
    "Precision F&H": [0.12, 0.79]
    "Phizz": [0.08, 0.58]
    "Berocca Mind": [0.11, 0.59]
    "Berocca Boost": [0.13, 0.57]
    "Boots vit C": [0.06, 0.60]
    "Tesco vit C": [0.15, 0.61]
    "Vitatech Energy Eff.": [0.09, 0.62]
    "H&B electrolyte": [0.12, 0.70]
    "Nuun Sport": [0.33, 0.78]
    "SiS GO Hydro": [0.34, 0.57]
    "HIGH5 ZERO": [0.31, 0.56]
    "Applied Nutrition": [0.38, 0.58]
    "Precision Eng. H&B": [0.35, 0.60]
    "Myprotein THE Electro": [0.37, 0.62]
    "Red Bull": [0.33, 0.38]
    "Grenade Energy": [0.36, 0.37]
    "Tonic Health sachets": [0.68, 0.99]
    "Liquid I.V.": [0.71, 0.97]
    "Robinsons Squash'd": [0.74, 0.96]
    "Tonic Health tabs": [0.69, 0.57]
    "Neutonic": [0.70, 0.37]
    "TRIP": [0.72, 0.36]
    "TENZING": [0.75, 0.38]
    "Monster": [0.73, 0.19]
    "Waterdrop Microdrink": [0.90, 0.98]
    "Waterdrop Microenergy": [0.92, 0.97]
    "London Nootropics": [0.94, 0.96]
    "DIRTEA Lion's Mane": [0.91, 0.38]
    "DIRTEA Coffee": [0.93, 0.37]
    "Spacegoods": [0.90, 0.19]
    "V-DROP (proposed)": [0.96, 1.00]
```

**Reading it.** V-Drop's intended corner (top-right: premium-design *and* pocketable) is **not empty**. Waterdrop occupies it outright, London Nootropics sits in it, and Tonic Health and Liquid I.V. are one notch to the left with equal portability. What V-Drop would add is a *reusable metal object*, which none of them has. That is a real point of difference — but it is a hardware difference, not a formulation one, and it is the one thing Phase 1 has explicitly put out of scope for costing.

---

## 5. Channel map

`D` = D2C own store · `A` = Amazon UK · `B` = Boots · `T` = Tesco · `S` = Sainsbury's · `H` = Holland & Barrett · `SD` = Superdrug · `G` = gyms/sports · `O` = other (Ocado, Morrisons, pharmacy, independents, convenience)

| Brand | D | A | B | T | S | H | SD | G | O | Model | Subscription visible? |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| Waterdrop | ● | ● | | | | | | | ● Selfridges | **D2C-first** | **Yes** — tiered 15% (4–5 packs), 18% (6–7), 20% (8+); free delivery >£16 |
| Phizz | ● | ● | ● | ● | | | ● | | ● Morrisons, Rowlands | **Retail-first**, D2C secondary | Bundles and "subscription savings" referenced; terms not verified |
| Berocca (Bayer) | | ● | ● | ● | ● | | ● | | ● pharmacy | **Retail-only** | **No** |
| Tonic Health | | ● | ● | | | | | | ● grocery | Retail-first | Not observed |
| Boots own brand | | | ● | | | | | | | Single-retailer | No |
| Tesco own brand | | | | ● | | | | | | Single-retailer | No |
| SiS | ● | ● | | ● | | ● | | | ● cycle/run | Mixed | Not observed |
| HIGH5 | ● | ● | ● | ● | | | | | ● Halfords, cycle | Retail-first | Not observed |
| Nuun | | ● | ● | | | ● | | | ● specialist | Retail-first (UK) | US store only |
| Precision Fuel & Hydration | ● | ● | | | | | | | ● endurance | **D2C-first** | Not verified |
| Liquid I.V. (Unilever) | ● | ● | ● | | | ● | | | | D2C brand pushed into retail | D2C only |
| Dioralyte | | | ● | ● | ● | | ● | | ● pharmacy | Retail-only (licensed medicine) | No |
| Applied Nutrition | | ● | | | | ● | | ● | | Retail + gym | No |
| Precision Engineered (H&B) | | | | | | ● | | | | Retailer own brand | No |
| Myprotein | ● | ● | | | | | | | | D2C-first | Not observed |
| Vitatech Health | ● | | | | | | | | | D2C only | Not verified |
| **Spacegoods** | ● | ● | ● | | | ● | | | ● Ocado, Healf, ~400 stores | **D2C-first, retail expanding** | **Yes** — £49 one-time → ~£39 subscription |
| **DIRTEA** | ● | ● | | | | | | | ● independents | **D2C-first** | **Yes** — ~42% off cited on Coffee Super Blend |
| London Nootropics | ● | ● | | | | ● | | | | **D2C subscription-first** | **Yes** — £12/month, free UK delivery |
| Neutonic | ● | ● | | | | | | ● | ● forecourt, sports nutrition | D2C + broad wholesale | Yes, % not verified |
| TRIP | ● | ● | | ● | ● | | | | ● Ocado, convenience | **Grocery-first** | D2C only |
| TENZING | ● | ● | | ● | ● | ● | | | | Grocery-first | Not observed |
| Red Bull / Monster / Grenade | | ● | | ● | ● | | | ● | ● convenience | Grocery/convenience | No |

### 5.1 The pattern that matters

**FACT.** Every brand in this dataset with a visible consumer subscription — Waterdrop, Spacegoods, DIRTEA, London Nootropics, Liquid I.V., Neutonic — sells a **powder, cube, sachet or can**. **Not one mainstream UK effervescent-tablet brand runs a consumer subscription as its primary model.** Berocca, Phizz's retail lines, SiS, HIGH5, Dioralyte, Applied Nutrition and the retailer own brands are all pure retail.

**Two readings, and V-Drop must pick one:**
- **Opportunity.** Nobody has built a subscription around an effervescent tablet. V-Drop would be first.
- **Warning.** It may be absent because a tube of 20 tablets at £4–£8 is a low enough ticket to buy on impulse at Boots, and a subscription adds friction with no saving. Note that in V-Drop's own architecture the subscription is **more expensive per serving than the retail tube**, which removes the one reason subscriptions normally work.

**OPINION.** The second reading is the stronger one on current evidence, and it is testable cheaply (see §10).

---

## 6. Claims map

How each competitor gets to a claim territory. Three mechanisms: **[NHC]** authorised nutrition/health claim carried on a vitamin or mineral; **[ING]** ingredient-led — naming the ingredient and letting the consumer infer; **[LIFE]** vague lifestyle language with no regulated claim underneath.

| Brand | Energy | Focus | Immunity | Hydration | Recovery | Calm | Dominant mechanism |
|---|---|---|---|---|---|---|---|
| Waterdrop | | | | ● [LIFE] | | | **[LIFE]** — "drink more water"; vitamins present but not claimed hard |
| Waterdrop Microenergy | ● [ING] | | | ● [LIFE] | | | [ING] caffeine + "no taurine/aspartame" comparison |
| Phizz | ● [NHC] | | ● [NHC] | ● [ING] | ● [ING] | | **[NHC]** — vitamin C at 375% NRV does the regulatory work; "3-in-1" is the structure |
| Berocca Energy | ● [NHC] | | | | | | **[NHC]** — B-vitamin/magnesium "reduces tiredness and fatigue" |
| Berocca Mind | ● [NHC] | ● [NHC]+[ING] | | | | | [NHC] on B vitamins + [ING] Spanish sage for the cognitive story |
| Berocca Boost | ● [NHC]+[ING] | ● [ING] | | | | | [NHC] vitamins + [ING] caffeine/guarana |
| Berocca Immuno | | | ● [NHC] | | | | [NHC] vitamin C / D / zinc |
| Tonic Health | | | ● [NHC] | | ● [ING] | | [NHC] vit C/D/zinc + [ING] reishi 1500 mg |
| Boots / Tesco own brand | ● [NHC] | | ● [NHC] | | | | **[NHC] only** — no lifestyle layer at all |
| SiS / HIGH5 / Nuun / Applied Nutrition | ● [NHC] B vits | | | ● [ING] | ● [ING] | | [ING] electrolytes, with Informed Sport as the trust cue |
| Precision Fuel & Hydration | | | | ● [ING] | ● [ING] | | [ING] + a **diagnostic service** (sweat testing) as proof |
| Liquid I.V. | | | | ● [LIFE]+[ING] | | | [LIFE] "hydrates better than water" framing |
| Dioralyte | | | | ● medicinal | | | **Licensed medicine** — the only true clinical claim in the set |
| Spacegoods | ● [NHC] B5 | ● [ING] | | | | ● [ING] ashwagandha | **[ING]** — mushroom and adaptogen names carry the claim; B5 provides the legal fig leaf |
| DIRTEA | ● [NHC] B vits | ● [ING] | | | | | [ING] |
| London Nootropics | ● [ING] | ● [ING] | | | | ● [ING] | **[ING] with standardisation** — publishes beta-glucan % and withanolide % |
| Neutonic | ● [NHC] B vits | ● [ING] | | | | | [ING] branded actives (Cognizin) + [NHC] B vitamins |
| TRIP | | ● [LIFE] | | | | ● [NHC] magnesium | [LIFE] "your calm in the chaos" over an [NHC] magnesium base |
| TENZING | ● [ING] | | | | | | [ING] natural caffeine, clean-label |
| Red Bull / Monster / Grenade | ● [NHC]+[LIFE] | | | | | | Brand-led |

### 6.1 Implications for V-Drop

**OPINION.** The category's dominant pattern is *ingredient-led claims with an authorised vitamin claim underneath as legal cover*. Spacegoods does this most efficiently: vitamin B5 supplies the permitted "reduction of tiredness and fatigue", and the mushrooms do the persuading without ever being claimed for.

V-Drop **cannot currently replicate this** for two of three SKUs, because:
- Mind's only NHC-eligible nutrients are B6 and B12, and their doses are specified as a single combined "10 mg" figure that cannot be assessed (A-021). Without separated per-vitamin doses there is **no legal cover** for the cognitive story.
- Recovery's zinc dose is ambiguous (A-020); if it is 10 mg of the chelate, that is ~2 mg elemental zinc (~20% NRV), which supports "source of zinc" but not the fuller immune claim set the brief assumes.
- Energy is the cleanest: caffeine is self-evident and the B-complex would qualify — **once doses are actually specified**.

This is `claims-regulatory`'s territory, but it is a commercial finding too: **the SKU with the weakest potency (Mind) is also the one with the weakest claims footing.**

---

## 7. Price-to-potency comparison (the priority section)

The brief instructs Agent Beta to "highlight where our price-to-potency ratio **outperforms** legacy players like Waterdrop and Spacegoods". That is a directive to a conclusion. I have tested it in both directions. **It holds against Waterdrop. It does not hold against Spacegoods, DIRTEA or Neutonic on any per-milligram basis.**

Throughout: V-Drop retail = £0.466/serving, V-Drop subscription = £0.833/serving.

### 7.1 Total declared actives per serving, and cost per gram of active

| Product | Declared actives per serving | £/serving | **£ per gram of declared active** |
|---|---:|---:|---:|
| Tonic Health sachet | ~2,500 mg (vit C 1000 + reishi 1500) | £0.900 | **£0.36** |
| Spacegoods (sub) | ~3,305 mg | £1.300 | **£0.39** |
| Spacegoods (RRP) | ~3,305 mg | £1.633 | **£0.49** |
| DIRTEA Lion's Mane | 2,000 mg | £1.032 | **£0.52** |
| Phizz | ~655 mg named (vit C 300 + electrolyte salts 355) + 16 further micronutrients | £0.400 | **£0.61** |
| **V-Drop Mind (retail)** | ~460 mg | £0.466 | **£1.01** |
| **V-Drop Recovery (retail)** | ~430 mg | £0.466 | **£1.08** |
| Neutonic | ~1,620 mg | £2.499 | **£1.54** |
| **V-Drop Energy (retail)** | ~300 mg named (B-complex and trace minerals undosed) | £0.466 | **£1.55** |
| **V-Drop Mind (subscription)** | ~460 mg | £0.833 | **£1.81** |
| **V-Drop Recovery (subscription)** | ~430 mg | £0.833 | **£1.94** |
| **V-Drop Energy (subscription)** | ~300 mg named | £0.833 | **£2.78** |
| Waterdrop Microdrink | ~1.6 mg of declared vitamins | £0.749 | ~£468 (illustrative of an intensity-1 product) |

**FACT.** On cost per gram of declared active, **every V-Drop subscription SKU is more expensive than every Direct- and Adjacent-ring competitor in this table except Waterdrop.** At the retail price V-Drop improves but still sits behind Phizz, DIRTEA, Spacegoods and Tonic Health. *Method: mg figures from the CSV; £/g = £ per serving ÷ (mg ÷ 1000).*

### 7.2 Closest five competitors, active by active

#### (a) Caffeine — V-Drop **Energy** vs the energy-drink set

| Product | Caffeine | £/serving | **£ per 100 mg caffeine** |
|---|---:|---:|---:|
| **V-Drop Energy (retail)** | 80 mg | £0.466 | **£0.58** |
| Grenade Energy 330 ml | 155 mg | £1.333 | £0.86 |
| **V-Drop Energy (subscription)** | 80 mg | £0.833 | **£1.04** |
| Monster Original 500 ml | 160 mg | £1.750 | £1.09 |
| Red Bull 250 ml | 80 mg | £1.425 | £1.78 |
| Neutonic 330 ml | 120 mg | £2.499 | £2.08 |
| TENZING 250 ml | 80 mg | £2.250 | £2.81 |

**Verdict: V-Drop wins here, and this is its strongest commercial argument.** At retail it is the cheapest caffeine in the set by 33% over the nearest rival. **But be precise: at the subscription price V-Drop loses to Grenade by 21%** (£1.04 vs £0.86), and Grenade delivers 1.9× the caffeine in a single serving. Anyone whose occasion is "I need a lot of caffeine now" is better served by a can.

**Also note the direct-ring threat.** Vitatech Health sells a UK effervescent with **caffeine 100 mg + L-theanine 200 mg + B complex** — 25% more caffeine and 67% more L-theanine than V-Drop Energy, in the same format. Its price is UNVERIFIED, so the ratio cannot be computed, but the dose comparison alone removes any claim that V-Drop Energy is unique. ([vitatechhealth.com](https://www.vitatechhealth.com/shop/energy-effervescent/))

#### (b) L-theanine — V-Drop **Energy**

| Product | L-theanine | £/serving | **£ per 100 mg** |
|---|---:|---:|---:|
| **V-Drop Energy (retail)** | 120 mg | £0.466 | **£0.39** |
| Neutonic | 400 mg | £2.499 | £0.63 |
| London Nootropics Zen | 153 mg | £1.000 | £0.65 |
| **V-Drop Energy (subscription)** | 120 mg | £0.833 | **£0.69** |

**Verdict: mixed, and it flips at the subscription price.** V-Drop retail is the cheapest per mg. **V-Drop subscription is 11% more expensive per mg than Neutonic and 6% more than London Nootropics — while delivering 3.3× less L-theanine than Neutonic in absolute terms.**

#### (c) Lion's mane — V-Drop **Mind** vs Spacegoods and DIRTEA

This is where the brief's directive fails most clearly. Two metrics, two different answers, and honesty requires both.

| Product | Lion's mane | Extract ratio | Raw equivalent | £/serving | **£ per 100 mg extract** | **£ per 100 mg raw-equiv** |
|---|---:|---|---:|---:|---:|---:|
| DIRTEA Lion's Mane | 2,000 mg | not published | — | £1.032 | **£0.05** | — |
| Spacegoods (sub) | 1,000 mg | 5:1 | 5,000 mg | £1.300 | **£0.13** | £0.026 |
| Spacegoods (RRP) | 1,000 mg | 5:1 | 5,000 mg | £1.633 | **£0.16** | £0.033 |
| **V-Drop Mind (retail)** | 200 mg | 20:1 | 4,000 mg | £0.466 | **£0.23** | **£0.012** |
| London Nootropics Flow | 250 mg | 8:1, >42% beta-glucans | 2,000 mg | £1.000 | **£0.40** | £0.050 |
| **V-Drop Mind (subscription)** | 200 mg | 20:1 | 4,000 mg | £0.833 | **£0.42** | **£0.021** |

**Verdict, stated plainly because it cuts against the brief:**

- **On mass of extract actually delivered — the metric a consumer can check on a label — V-Drop loses to everyone.** V-Drop retail is **43% more expensive per mg of extract than Spacegoods at full RRP** and **79% more expensive than Spacegoods on subscription**. Against DIRTEA it is **4.5× more expensive per mg** at retail and **8× more expensive** at subscription. Spacegoods delivers **5× the mass** per serving; DIRTEA delivers **10×**.
- **On the brief's own raw-equivalent arithmetic, V-Drop wins** — 2.8× cheaper than Spacegoods RRP at retail, 20% cheaper than Spacegoods subscription at subscription.
- **OPINION: the raw-equivalent metric should not be relied on in customer-facing claims.** Extract-ratio arithmetic is a marketing convention, not a potency standard. A 20:1 extract is not automatically four times as potent as a 5:1 at equal mass; potency depends on the standardised marker compound (for lion's mane, beta-glucan content). **Neither V-Drop's brief nor Spacegoods publishes a beta-glucan specification.** London Nootropics does (>42%), which is precisely why it is the transparency benchmark. If a competitor or a journalist asks "what is your beta-glucan content?", the raw-equivalent argument collapses.

#### (d) Choline donor — V-Drop **Mind** vs Neutonic

| Product | Choline donor | £/serving | **£ per 100 mg** |
|---|---:|---:|---:|
| **V-Drop Mind (retail)** | Alpha-GPC 100 mg | £0.466 | **£0.47** |
| Neutonic | Cognizin citicoline 500 mg | £2.499 | £0.50 |
| **V-Drop Mind (subscription)** | Alpha-GPC 100 mg | £0.833 | **£0.83** |

**Verdict: V-Drop retail is 7% cheaper per mg; V-Drop subscription is 67% more expensive.** And Neutonic delivers **5× the mass**, of a branded, trial-backed ingredient, at a dose (500 mg) that matches the cognition literature. **A-010/A-019 bite hard here:** EFSA's 2026 assessment proposed a maximum of 203.7 mg/day of L-alpha-GPC, so even the regulatory ceiling is roughly double V-Drop's dose — and V-Drop's 500 mg active core has no room to get there without displacing the mushrooms.

#### (e) Ashwagandha — V-Drop **Recovery**

| Product | Ashwagandha | £/serving | **£ per 100 mg** |
|---|---:|---:|---:|
| **V-Drop Recovery (retail)** | 150 mg (KSM-66, brief says 10:1) | £0.466 | **£0.31** |
| **V-Drop Recovery (subscription)** | 150 mg | £0.833 | **£0.56** |
| Spacegoods (sub) | 200 mg | £1.300 | £0.65 |
| Spacegoods (RRP) | 200 mg | £1.633 | £0.82 |
| London Nootropics Zen | 110 mg KSM-66, 5.5% withanolides | £1.000 | £0.91 |

**Verdict: V-Drop wins on cost per mg at both price points — but this is a hollow win.** All three products are below the 300–600 mg range used in ashwagandha trials (A-011). Being the cheapest per milligram of a sub-therapeutic dose is not a price-to-potency advantage; it is a cheaper way of buying not enough. Note also that KSM-66 is not conventionally described as a 10:1 extract, which needs resolving before any label is printed.

#### (f) Vitamin C — V-Drop **Recovery**

| Product | Vitamin C | £/serving | **£ per 100 mg** | vs V-Drop retail |
|---|---:|---:|---:|---|
| Tesco Health effervescent | 1,000 mg | £0.060 | **£0.006** | V-Drop is **39× dearer** |
| Boots High Strength | 1,000 mg | £0.088 | **£0.009** | V-Drop is **27× dearer** |
| Tonic Health sachet | 1,000 mg | £0.900 | **£0.090** | V-Drop is **2.6× dearer** |
| Phizz | 300 mg | £0.400 | **£0.133** | V-Drop is **75% dearer** |
| **V-Drop Recovery (retail)** | 200 mg | £0.466 | **£0.233** | — |
| **V-Drop Recovery (subscription)** | 200 mg | £0.833 | **£0.417** | 79% dearer again |

**Verdict: a decisive loss.** Vitamin C and immunity are unwinnable territory. A shopper standing in Tesco can buy 1,000 mg for 6p. **Recovery must not be sold on vitamin C or immunity.** Its only defensible actives are D3 1,000 IU and, if the ambiguity is resolved upward, zinc.

#### (g) Electrolytes / hydration

**FACT.** V-Drop declares "Full-Spectrum Minerals: 70 mg" (Recovery) and "Trace Minerals: 100 mg" (Energy), naming no species and no sodium content. Phizz delivers 135 mg sodium chloride + 220 mg potassium chloride = 355 mg of electrolyte salts at £0.400. Nuun Sport delivers 300 mg sodium + 150 mg potassium. Precision Fuel & Hydration delivers 1,000 mg sodium per litre.

**Verdict: V-Drop is not a hydration product and should not claim to be one.** It carries roughly one fifth of Phizz's declared electrolyte mass at 17% higher retail price, and there is no room in the 500 mg core to fix that.

### 7.3 The one place the brief is right: Waterdrop

| | V-Drop retail | V-Drop sub | Waterdrop Microdrink |
|---|---:|---:|---:|
| £/serving | £0.466 | £0.833 | £0.749 |
| Functional intensity | 2–4 | 2–4 | **1** |
| Declared actives | 300–460 mg | 300–460 mg | ~1.6 mg |
| Portability | 5 | 5 | 5 |

**FACT.** Waterdrop's BOOST cube declares B6 0.63 mg (45% NRV) and B12 1 µg (40% NRV) — both **below 50% NRV**, which is precisely the rubric's definition of a level-1 "token vitamin" product. **The brief's characterisation of Waterdrop as "low-potency, baseline vitamin micro-doses" is CONFIRMED.**

**Verdict: V-Drop genuinely outperforms Waterdrop on price-to-potency at both price points** — 38% cheaper per serving at retail with far more active, and 11% more expensive at subscription but with 200–300× the declared active mass. **This is the only competitor comparison where the brief's directive survives contact with the evidence.**

---

## 8. Whitespace analysis — and is A-016 supported?

For each gap: the case that it is an opportunity, and the case that it is empty for a reason.

### W1 — A reusable flat metal carry case for effervescent tablets
- **Opportunity:** genuinely unoccupied. No competitor in 40 rows ships a reusable carry object. It creates a physical brand asset, a repeat-purchase lock-in and a gifting/starter-kit hook.
- **Empty for a reason?** Partly. A-004 shows the case as specced holds 8 tablets, not 12, and §4.1 shows it is ~2× less volume-efficient per serving than the tube it replaces. Competitors have chosen sachets and cube packs, which are flatter, lighter and cost pennies. A metal case is also trivially copied once proven — it is not defensible IP.
- **Verdict: REAL but THIN.** A design advantage with a short half-life, and one Phase 1 has put out of scope for costing.

### W2 — An effervescent tablet with nootropics at genuinely studied doses
- **Opportunity:** none of the big pharmacy effervescents (Phizz, Berocca Energy, Berocca Immuno) carries caffeine + L-theanine at studied doses.
- **Empty for a reason?** **No — it is already occupied.** Vitatech Health sells a UK effervescent at caffeine 100 mg + L-theanine 200 mg. Berocca Boost has carried caffeine and guarana for years. Amazon UK carries a long tail of caffeinated effervescents (e.g. Science Fitness). And **Berocca Mind already occupies the focus-effervescent position nationally at £0.666**.
- **Verdict: NOT WHITESPACE.** V-Drop Energy is a good product in a contested space, not a first mover.

### W3 — An effervescent adaptogen/mushroom product at pharmacy scale
- **Opportunity:** no mainstream UK effervescent carries lion's mane or cordyceps.
- **Empty for a reason?** **Yes, and the reason is arithmetic, not demand.** Meaningful mushroom doses are measured in grams — Spacegoods 3 g across three species, DIRTEA 2 g of one. V-Drop's entire Active Functional Core is **500 mg (A-019)**, of which Mind spends 350 mg on two mushrooms. And the format is *not* the barrier: **Tonic Health already sells an effervescent carrying 1,500 mg of reishi plus 1,000 mg of vitamin C**, i.e. five times V-Drop's whole active core, in a tablet. The constraint is not "nobody has tried an effervescent mushroom" — it is "V-Drop's 3.5 g tablet architecture cannot carry a competitive dose."

> **[CSO correction, 2026-09-21]** The last two sentences overreach the CSV. The 1,500 mg Tonic Health product is the *High Dose Immunity drink sachets, 10 × 5.5 g*, recorded in `competitors.csv` as `format = effervescent powder sachet` — not a tablet. Tonic Health's tablet SKU carries no dose data at all. The comparison is confounded on both format (sachet vs compressed tablet) and serving size (5.5 g vs 3.5 g), so it cannot show that the format is not the barrier. The verdict below is unaffected — V-Drop cannot carry a competitive mushroom dose either way — but the reason matters for what fixes it: if the ceiling is largely physical (an effervescent tablet needs ~50–75% of its mass as acid/bicarbonate base), then reformulating inside the tablet will not reach Spacegoods-class loads, and only serving size or leaving the tablet format will. See A-019.
- **Verdict: NOT WHITESPACE FOR V-DROP.** The gap exists but V-Drop's own tablet spec disqualifies it from filling it. **This is the strongest single argument for reconsidering the Mind SKU.**

### W4 — A subscription built around an effervescent tablet
- **Opportunity:** **structurally real.** Zero mainstream UK effervescent brands run a consumer subscription (§5.1). Every subscription brand in the set sells powder, cubes, sachets or cans. A tablet's low weight makes letterbox fulfilment genuinely attractive.
- **Empty for a reason?** Possibly. Tubes are cheap impulse buys at Boots; a subscription adds friction for a £5–£8 item. And V-Drop's own architecture makes the subscription **more expensive per serving than retail**, which removes the normal reason to subscribe.
- **Verdict: REAL, and the most interesting gap in the report — but only if the price architecture is inverted so the subscription is the cheaper unit.**

### W5 — "Clean caffeine at less than the price of a coffee, in your pocket"
- **Opportunity:** V-Drop Energy at £0.466 retail is the cheapest caffeine per mg in the dataset (§7.2a), it is pocketable at 5/5, and it replaces a can rather than competing with a tablet.
- **Empty for a reason?** Not empty — Vitatech occupies the format, energy drinks own the occasion, and coffee owns the ritual. But it is the one place where V-Drop's numbers genuinely stack up.
- **Regulatory caveat (A-024, logged by `customer-insight`):** at 80 mg per 500 ml V-Drop Energy is 160 mg/L, above the 150 mg/L threshold for England's April 2027 under-16 sales restriction, which explicitly covers reconstituted drinks. Reformulating the retail tube to 75 mg per 500 ml sidesteps this and costs almost nothing competitively (see §9 item 1).
- **Verdict: THE STRONGEST POSITION AVAILABLE, subject to the 75 mg reformulation.**

### 8.1 Is A-016 supported?

**A-016 states: "Positioning gap: premium 'bio-performance' between cheap squash, lifestyle hydration and clinical tablets."**

**Verdict: PARTLY DISPUTED.**

**What the evidence supports:**
- A design/portability gap exists for a *reusable premium carry object*. Nobody has one. (W1)
- A structural gap exists for *subscription attached to an effervescent tablet*. Nobody has one. (W4)
- The brief's characterisation of Waterdrop as low-potency is correct, so there is real room to be "the potent one" relative to lifestyle hydration. (§7.3)

**What the evidence contradicts:**
- **The price band is not empty — it is the most crowded on the ladder.** £0.40–£0.67 contains Phizz, HIGH5, Berocca Immuno, Berocca Mind and DIRTEA Coffee.
- **The "premium design + pocketable" corner is already occupied** by Waterdrop, and shared by London Nootropics, Tonic Health sachets and Liquid I.V. (Map B)
- **V-Drop would enter the "bio-performance" segment from below on potency, not above.** Against the products that define the segment it aims to bridge into — Spacegoods, DIRTEA, Neutonic — V-Drop delivers 5–10× less active mass per serving and costs more per milligram (§7.2c–d). It is not bridging a gap between hydration and performance; on two of three SKUs it sits nearer the hydration end while charging performance prices.
- **"Clinical tablets are non-portable" is overstated** (§4.1), and **"they taste clinical" is unverified**.

**OPINION.** The gap V-Drop has identified is a *format and design* gap, not a *potency* gap. The brief treats it as both. If the proposition is rebuilt around format, occasion and the Energy SKU, A-016 becomes defensible. If it is sold as superior potency, the evidence will not carry it.

---

## 9. Top 10 "so whats" for V-Drop

1. **Lead with Energy. It is the only SKU whose numbers survive scrutiny.** Intensity 4 (caffeine 80 mg and L-theanine 120 mg both at studied doses), and the cheapest caffeine per mg in the dataset at retail — 33% below Grenade, 47% below Monster, 67% below Red Bull. *(§3.2, §7.2a)*
   **Cross-reference, added after reading a sibling agent's entry: this recommendation conflicts with A-024.** `customer-insight` has logged that England will restrict sale of drinks over **150 mg caffeine per litre** to over-16s from April 2027, and V-Drop Energy at 80 mg in 500 ml is **160 mg/L** — above the threshold, with "products intended to be consumed as drinks following reconstitution" explicitly in scope. That would make the hero SKU age-restricted on the very impulse shelf the brief designates as the discovery channel. **Mitigation that preserves this recommendation: reformulate the retail Energy tube to 75 mg per 500 ml (150 mg/L), which stays inside the rubric's level-3 studied-dose threshold (≥75 mg) and only moves cost per 100 mg caffeine from £0.58 to £0.62 — still the cheapest in the dataset.** CSO decision needed.

2. **The subscription price, not the retail price, is the commercial problem.** At £0.833 V-Drop would be the most expensive effervescent tablet per serving in the UK set: +25% on Berocca Mind, +11% on Waterdrop, +108% on Phizz, and above a licensed medicine (Dioralyte, £0.817). *(§2.1)*

3. **The channel inversion in A-003 is worse than recorded.** Retail is 44% cheaper per serving *and* must still absorb retailer margin. Net of VAT and an estimated 40% Boots margin, a retail serving returns ~£0.233 against a subscriber's £0.694 — roughly a third. The cheaper channel is also the less profitable one, and it teaches subscribers to defect. *(§2.1)*

4. **Mind cannot be sold on dose, and probably should not be sold at all in its current form.** Spacegoods delivers 5× the lion's mane mass, DIRTEA 10×, Neutonic 5× the choline donor — and V-Drop is 43–79% more expensive per mg of lion's mane extract than Spacegoods and 4.5–8× more than DIRTEA. A-019 means there is no arithmetic route to fixing this inside a 3.5 g tablet. *(§7.2c–d, §8 W3)*

5. **The brief is right about Waterdrop and only about Waterdrop.** Waterdrop's BOOST cube is B6 0.63 mg (45% NRV) and B12 1 µg (40% NRV) — level 1 on the rubric. V-Drop beats it decisively on price-to-potency at both price points. Use this comparison; retire the Spacegoods one. *(§7.3)*

6. **The Spacegoods pricing anchor is wrong, and the £19.99 logic rests on it.** Actual: £49.00 one-time (£1.633/serving) and ~£39.00 subscription (£1.300/serving). The brief's "£1.50/serving" is neither, and the brief never says which it means. Re-derive the price architecture from the correct numbers. *(A-022, §2)*

7. **"Bulky, non-portable" will not survive a fact-check.** The case is flatter (11 mm vs ~30 mm) and shorter (110 mm vs ~140 mm) than a tube — genuine advantages — but it carries roughly **half the servings per cm³** and holds 8 tablets against a tube's 20. Three Direct-ring competitors already score 5/5 on portability. Claim flatness, not superiority. *(§4.1, A-023)*

8. **The real structural whitespace is subscription, not potency — and V-Drop's pricing currently destroys it.** No mainstream UK effervescent brand runs a consumer subscription. Every subscription brand in the set sells powder, cubes, sachets or cans. V-Drop could be first, but only if the subscription becomes the *cheaper* unit. *(§5.1, §8 W4)*

9. **Abandon vitamin C and immunity.** Tesco sells 1,000 mg effervescent for £0.060 a serving; V-Drop Recovery's 200 mg would cost 39× more per mg at retail. Recovery's only defensible actives are D3 1,000 IU and — pending the A-020 ambiguity — zinc. *(§7.2f)*

10. **The format is not protected and the incumbents are already moving.** Berocca has launched **Mind** (focus, £0.666, national Boots distribution) and **Immuno**. Tonic Health puts 1,500 mg of reishi in an effervescent. Vitatech sells a UK effervescent at caffeine 100 mg + L-theanine 200 mg — out-dosing V-Drop Energy in the same format. Amazon UK carries a long tail of caffeinated effervescents. There is no first-mover advantage in the tablet; the only novel asset is the case. *(§1.2, §8 W2)*

---

## 10. Gaps and next research

### 10.1 What I could not verify — and the exact pages someone with browser access must re-read

**Priority 1, load-bearing on price architecture:**

| # | What to get | Page |
|---|---|---|
| 1 | Waterdrop Microdrink 12-pack UK price + the subscription price at the *entry* tier | https://en.waterdrop.com/products/microdrink-blackcurrant and https://en.waterdrop.com/collections/subscription |
| 2 | Spacegoods Rainbow Dust one-time vs subscription price, GBP, and the full dose panel | https://spacegoods.com/products/rainbow-dust-vanilla |
| 3 | Phizz Daily 3-in-1 20s official price + full nutrition panel with per-nutrient mg | https://www.phizz.co/products/3-in-1-hydration-electrolytes-vitamins-20 |
| 4 | Berocca Mind 15s Boots price + the per-nutrient dose panel (currently qualitative only) | https://www.boots.com/berocca-mind-berry-tablets-15s-10358306 |
| 5 | Berocca Boost caffeine dose — sources give **both 75 mg and 40 mg**; and the GB RRP | https://www.berocca.co.uk/products/caffeine/berocca-boost-effervescent-tablets |

**Priority 2, needed for a complete Direct ring:**

| # | What to get | Page |
|---|---|---|
| 6 | Nuun Sport UK price for a single 10-tablet tube | https://fitstuff.co.uk/products/nuun |
| 7 | Precision Fuel & Hydration PH 1000 UK price | https://www.precisionhydration.com/us/en/products/ph-1000-electrolyte-drink-mix/ |
| 8 | Tonic Health Immunity & Vitality **tablets** 20s Boots price | https://www.boots.com/-10380484 |
| 9 | Vitatech Energy Effervescent price and pack size | https://www.vitatechhealth.com/shop/energy-effervescent/ |
| 10 | Waterdrop Microenergy and Microlyte UK GBP prices | https://www.waterdrop.com/collections/microenergy |
| 11 | Robinsons Squash'd 66 ml Tesco shelf price (returned £0.00 guide price) | https://www.tesco.com/groceries/en-GB/products/282138037 |
| 12 | Whether MiO has genuine UK grocery distribution or only import marketplaces | shelf check + Kraft Heinz UK |

### 10.2 Other unresolved items

- **Waterdrop's full vitamin panel per cube.** I have B6 and B12 for the BOOST variant only. Vitamin C, E, B1, B3, B7, B8 are cited across the range without mg figures. Until these are read, the intensity-1 score is well-founded but incomplete.
- **Spacegoods 7-sachet SKU at £7.99–£10** (claimed in A-008): **not found.** Trial packs, sample packs and bulk-buy SKUs exist; no 7-sachet pack at that price surfaced. Treat as unsupported.
- **Serving sizes in grams** are missing for most Direct-ring rows, so £/g of product cannot be computed alongside £/g of active.
- **Real pack dimensions.** All tube dimensions in §4.1 are estimates built from packaging-industry standard sizes, not from measured products. Someone should physically measure a Phizz 20s, a Berocca 15s and a Waterdrop 12-pack.
- **Sensory claims.** "Tastes clinical" cannot be desk-verified. It needs a small blind taste panel — cheap, and it would either validate or kill a core plank of the brief.
- **Subscription churn and repeat rates** for Waterdrop, Spacegoods and DIRTEA. Publicly invisible; would need trade press, Similarweb-style data or ex-employee interviews.
- **Retailer margin.** The 40% Boots assumption in §2.1 is mine, not sourced. Logged as new assumption A-024.

### 10.3 Three cheap tests I would run next

1. **Shelf audit.** One hour in a large Boots and a large Tesco: photograph the effervescent fixture, record facings and shelf prices for Berocca (all variants), Phizz, Tonic Health, own-brand and Liquid I.V. This resolves half of §10.1 and gives real distribution data rather than inferred.
2. **The £0.83 test.** Show 100 target consumers a Berocca Mind tube at £9.99 and a V-Drop subscription at £19.99/24, side by side, and ask which they would buy. This tests the single riskiest number in the plan directly.
3. **The beta-glucan question.** Ask a contract manufacturer what beta-glucan content a 20:1 lion's mane extract at 200 mg actually delivers, and what Spacegoods' 5:1 at 1,000 mg delivers. If the answer favours Spacegoods, the raw-equivalent argument in §7.2c must be dropped entirely from customer-facing copy.
