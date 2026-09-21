# Project V-Drop — Delivery Format Options

**Owner:** `market-mapper` · **Date checked:** 2026-09-21 · **Currency:** £ inc VAT unless stated
**Commissioned by:** CSO, following the Gate 1 decision to reopen format (`notes/decisions.md`, rows 4–5)
**Scope:** every plausible delivery format for a premium functional water-enhancer sold **D2C only** in the UK, standard and advanced, UK and international.
**Not modified by this task:** `research/competitor-map.md`, existing rows of `research/competitors.csv`. Three genuinely new products were **appended** to the CSV (see §12).

Statements are labelled **FACT** (sourced), **ESTIMATE** (method shown) or **OPINION**, per house rule 6.

---

## 0. Sourcing health warning — read before using any number

**FACT.** This session's egress proxy refuses CONNECT to UK retailer and brand domains. Confirmed blocked on attempt during this task: `www.jrspharma.com`, `eu.waterdrop.com`, `www.medicines.org.uk`, `www.stack3d.com`, `en.wikipedia.org`. The previous run recorded the same behaviour across ~25 retailer and brand hosts and established it is an organisation egress policy, not a transient fault. I did not retry.

**Consequence.** Every figure below that comes from a commercial page was read via a **search-engine summary of that page**, not the page itself. The URL given is the page the summary was drawn from, so a human can verify in one click. Confidence is stated per finding. Nothing in this report is rated `high`.

**The two figures that carry the most weight** — Applied Nutrition's 4.5 g effervescent tablet (§2) and the JRS Pharma glucosamine formulation (§2) — **must be re-read directly before any engineering or pricing decision is taken on them.** They are listed first in §11.

---

## 1. Executive summary — seven findings

1. **A compressed effervescent tablet CAN carry a gram-scale active payload, and one is on sale in the UK right now.** Applied Nutrition — a UK-listed sports nutrition company — sells **Creatine Monohydrate Effervescent Tablets**: a two-tablet, 9 g serving delivering **3,000 mg of creatine monohydrate**, i.e. **1,500 mg of active in a single 4.5 g compressed effervescent tablet**, with creatine declared **first** in the ingredient list (ahead of the citric acid and the sodium carbonates). That is a **33% active load** against V-Drop's briefed 15% / ~500 mg. **This answers the question the CSO reopened in A-019: the ~500 mg ceiling is a consequence of V-Drop's chosen 3.5 g serving size and its chosen active set — it is not a property of effervescent tablet technology.** (FACT, med confidence — §2.)

2. **But be precise about what that unlocks.** The gram-scale effervescent tablets that exist all carry actives that are highly water-soluble, compress well and are either taste-neutral or chemically *part of the effervescent couple* (ascorbic acid is the acid; calcium carbonate is the base). Mushroom and adaptogen extracts are the hardest possible case: bitter, dark, hygroscopic, poorly soluble — and taste-masking by spray-dried microencapsulation typically yields a powder that is only ~33% active, i.e. it **triples** the mass needed. **I found no effervescent tablet anywhere carrying a gram-scale mushroom extract.** So A-019's fix is real for **Energy** and **Recovery**, and remains weak for **Mind**. (§2.4)

3. **The Waterdrop de-positioning hypothesis is SUPPORTED, with one important qualification.** Waterdrop's cube is unambiguously effervescent — its declared ingredients include citric acid plus sodium and potassium carbonates, which is the textbook acid–base couple. The founder positioned it explicitly *against* "syrup... horrible packaging or even powder sticks", invented the category noun "microdrink", and built it D2C-first. So yes: category perception here was set by naming, geometry, packaging and channel, not by chemistry. **The qualification: Waterdrop changed four things at once (noun, shape, pack, channel). V-Drop proposes to change one (the carry case) while keeping the disc, the tube-shelf price logic and the word "tablet".** That is a weaker version of the same move. (§3)

4. **V-Drop's problem is both perception and payload, not one or the other.** Fix only the design and you are Waterdrop with a worse cost base. Fix only the formulation and you are Applied Nutrition. The recommendation in §9 fixes both.

5. **A new physical problem with the briefed tablet, not previously logged.** A 23.0 mm × 5.2 mm disc weighing 3,500 mg requires an apparent density of **1.62 g/cm³**. Effervescent tablets are deliberately porous (30–40% porosity is typical) to let water in, which puts realistic apparent density around **1.1–1.2 g/cm³**. On that basis the briefed tablet is either **~7.3 mm thick, not 5.2 mm**, or it weighs **~2.5 g, not 3.5 g** — which would cut the active core to ~360 mg at 15%. This compounds A-004 and A-019 simultaneously. Logged as **A-032**. (ESTIMATE, arithmetic shown — §2.5)

6. **Under D2C-only, one postal fact reshapes the format choice.** Royal Mail Large Letter has a **25 mm depth limit**. A standard effervescent tube is ~28–30 mm in diameter, so **tube-based brands cannot use Large Letter — they must ship a parcel.** A flat blister tray of tablets, or flat sticks, can. This is a genuine, structural D2C cost advantage for V-Drop's flat architecture over the incumbent tube, and it is the single best commercial argument the format has. It also explains W4 more convincingly than "nobody has thought of it". (§5)

7. **The W4 whitespace is narrowing while we deliberate.** Phizz now runs Subscribe & Save on Amazon UK (no fee, skip or cancel, two-weekly to six-monthly). And **Humantra** — a UK electrolyte stick-pack brand not in the previous run's 42-row set — runs a full D2C subscription (40% off first order, 20% thereafter, free delivery) while also sitting in Boots. The "no UK effervescent subscription" observation still holds for *brand-owned* effervescent subscriptions, but the marketplace route is already open to competitors and costs them nothing. (§6)

---

## 2. The A-019 question, answered: can a compressed effervescent tablet carry a competitive active load?

### 2.1 What the brief assumed

The master brief fixes a universal 3.5 g tablet split 60% effervescent base / 25% sensory & sweetener / **15% active core (~500 mg maximum)**. The previous run treated this as commercially binding, which it is — but then reached for a Tonic Health *sachet* to argue the format was not the constraint. The CSO correctly struck that inference out.

### 2.2 Counter-examples: compressed effervescent tablets carrying gram-scale actives

| Product | Territory | Active load per tablet | Tablet mass | **Active as % of tablet** | Evidence |
|---|---|---:|---:|---:|---|
| **Applied Nutrition Creatine Monohydrate Effervescent** | **UK, on sale** | **1,500 mg creatine monohydrate** | **4.5 g** | **33%** | Serving = 2 tablets (9 g) delivering 3 g creatine; creatine is the **first-declared ingredient**, ahead of citric acid and sodium carbonates ([appliednutrition.uk](https://appliednutrition.uk/products/creatine-monohydrate-effervescent-tablets), [thesupplementstore.co.uk](https://www.thesupplementstore.co.uk/products/applied-nutrition-effervescent-creatine-tablets), [stack3d](https://www.stack3d.com/2026/04/applied-nutrition-effervescent-creatine/)) |
| JRS Pharma glucosamine effervescent (formulation example) | EU, industry reference | 1,500 mg glucosamine | 3,980 mg | 38% | Direct-compression formulation example, 25 mm die ([JRS Pharma](https://www.jrspharma.com/pharma-wAssets/docs/formulation-examples/fe-glusosamine.pdf)) |
| Calvive 1000 / Calcium Sandoz 1000 effervescent | **UK licensed medicine** | calcium lactate gluconate 2,263 mg + calcium carbonate 1,750 mg = **4,013 mg of active salts** | not stated (>4 g) | >50% | SmPC ([emc](https://www.medicines.org.uk/emc/product/1191/smpc)); composition corroborated by the Sandoz PIL ([Sandoz](https://my-sandoz-com-za-en.cms.sandoz.com/sites/default/files/2023-04/Calcium%20Sandoz%20Forte%20PIL_0.pdf)) |
| Tonic Health Immunity & Vitality **tablets** (20s) | UK, on sale | vitamin C **1,000 mg** + vitamin A, E, zinc 10 mg, D3 25 µg, selenium 100 µg, plus phytonutrients | not published | ≥20% at any plausible tablet mass | ([tonichealth.co](https://www.tonichealth.co/products/immunity-and-vitality), [McGrocer](https://mcgrocer.com/products/tonic-health-immunity-natural-raspberry-lemon-20-effervescent-tablets)) |
| Boots / Tesco High Strength Vitamin C effervescent | UK, on sale | 1,000 mg ascorbic acid | ~4 g (ESTIMATE) | ~25% | Already in `competitors.csv` rows 15–16 |

**FACT (med confidence).** At least three compressed effervescent tablets sold in the UK carry **1,000 mg or more of declared active in a single tablet** — two to three times V-Drop's entire briefed active core.

**This resolves the CSO's correction in V-Drop's disfavour but in the project's favour:** the previous run's *conclusion* ("the format is not the constraint") was right; its *evidence* was wrong. The corrected evidence is the Applied Nutrition tablet, which is a compressed effervescent tablet, sold in the UK, at a gram-scale payload, with the active declared ahead of the effervescent base.

### 2.3 Why the brief's 60% base assumption is too conservative

The brief asserts a "Universal Effervescent Base (60% / 2,100 mg)". The A-019 note hardened this into "roughly 50–75% of its mass as acid/bicarbonate base". The evidence does not support that as a floor:

- **FACT.** The Applied Nutrition ingredient list runs: *Creatine Monohydrate, Acid (Citric Acid), Acidity Regulator (Sodium Carbonates), Bulking Agent (Sorbitol), Anti-Caking Agent (PEG), Sweetener (Sucralose), Colour, Flavouring.* Under EU/GB food law ingredients are declared in descending order of weight. **Creatine therefore exceeds citric acid, which exceeds the sodium carbonates.** The base cannot be 60% of that tablet. ([appliednutrition.uk](https://appliednutrition.uk/products/creatine-monohydrate-effervescent-tablets))
- **FACT.** Two mechanisms let the active displace the base: (a) **the active is the acid** — ascorbic acid in a vitamin C effervescent is simultaneously the payload and half the couple; (b) **the active is the base** — calcium carbonate in Calvive/Calcium Sandoz is simultaneously the payload and the CO₂ source. ([vinmec explainer](https://www.vinmec.com/eng/blog/how-many-mg-of-c-does-1-effervescent-tablet-contain-en), [emc SmPC](https://www.medicines.org.uk/emc/product/1191/smpc))
- **FACT.** Effervescent disintegration is driven by porosity as much as by gas volume; published work on commercial effervescent tablets describes target porosity of **30–40%**, and notes that reducing bicarbonate reduces porosity and slows disintegration. So there is a real floor — but it is a *disintegration-speed* floor, not a 60% mass floor. ([Applied Sciences 13:3171](https://doi.org/10.3390/app13053171))

**ESTIMATE.** A practical design envelope for a fast, clear-dissolving effervescent tablet with a non-acidic, non-carbonate active is **25–35% active load**, with 35–50% acid/carbonate couple and the balance binder, sweetener, flavour and lubricant. *Method: triangulating the Applied Nutrition 33%, the JRS glucosamine 38% and the ~25% implied by 1,000 mg vitamin C in a ~4 g tablet, then discounting the top of the range because ascorbic acid and calcium carbonate self-serve the couple and a mushroom extract does not.*

### 2.4 What this does and does not fix for V-Drop

| SKU | Brief's core | At 30% of a 4.5 g tablet (**1,350 mg**) | Verdict |
|---|---:|---|---|
| **Energy** | ~300 mg named | Caffeine 75 mg + L-theanine 200 mg + fully dosed B-complex + a real electrolyte load, with headroom | **FIXED.** Out-doses Vitatech (100 mg / 200 mg) on theanine and matches the A-024-safe 150 mg/L caffeine ceiling |
| **Recovery** | ~430 mg | Ashwagandha **300 mg** (bottom of the studied 300–600 mg range, A-011) + vitamin C 200 mg + zinc + D3/K2 + minerals | **FIXED — this is the first arithmetic route to a studied ashwagandha dose** |
| **Mind** | ~460 mg | Alpha-GPC 200 mg (at EFSA's proposed 203.7 mg/day ceiling, A-010) + lion's mane 500 mg + cordyceps 300 mg + B vitamins | **IMPROVED, NOT FIXED.** Still 2–6× below Spacegoods (1,000 mg lion's mane) and DIRTEA (2,000 mg) |

**The Mind problem is now a taste-and-solubility problem, not an arithmetic one.** Three reasons:

- **FACT.** Spray-dried microencapsulation is the standard route to masking bitter, earthy botanical extracts in a beverage — but flavour-masking encapsulation typically yields a powder containing only **~33% of the starting active**. ([Nutritional Outlook](https://www.nutritionaloutlook.com/view/microencapsulation-flavor-masking), [Food Chemistry](https://www.sciencedirect.com/science/article/abs/pii/S0308814615007967)) A "1,000 mg lion's mane" claim would therefore need ~3,000 mg of encapsulated powder — back above the ceiling.
- **FACT.** I could find **no effervescent tablet, anywhere, carrying a gram-scale mushroom extract.** Searches returned capsules only. That absence is evidence, though not proof.
- **OPINION.** Given A-026 (78% of Britons have heard little or nothing about functional mushrooms; 3% trial), the honest read is that **Mind should be dropped or deferred on format grounds as well as demand grounds.** It is the only SKU the format genuinely cannot serve competitively.

### 2.5 New finding: the briefed tablet geometry does not close (A-032)

**ESTIMATE, arithmetic shown.**
- Briefed disc: 23.0 mm diameter × 5.2 mm thick. Volume = π × (1.15 cm)² × 0.52 cm = **2.161 cm³**.
- Briefed mass 3,500 mg → required apparent density = 3.5 ÷ 2.161 = **1.62 g/cm³**.
- True densities of the blend components are roughly: sodium bicarbonate ~2.2, citric acid ~1.67, sorbitol ~1.5 — so a fully dense compact would be ~1.7–1.8 g/cm³. At the 30–40% porosity that effervescent tablets require ([Applied Sciences 13:3171](https://doi.org/10.3390/app13053171)), apparent density lands at roughly **1.1–1.25 g/cm³**.
- At 1.15 g/cm³, a 3,500 mg tablet occupies 3.04 cm³ → at 23 mm diameter it is **7.3 mm thick**, not 5.2 mm.
- Conversely, a 23.0 × 5.2 mm effervescent disc weighs roughly **2.5 g**, which at 15% gives an active core of **~370 mg**, not 500 mg.

**Cross-check against a real product.** Applied Nutrition's effervescent tablet is 4.5 g — larger than anything in the brief — and the industry-standard tube internal diameter is ~2 mm over the tablet, with tubes made in 84/96/99/133/144 mm heights (previously sourced in `competitor-map.md` §4.1). Nothing in the commercial range suggests a 3.5 g effervescent disc as thin as 5.2 mm.

**Consequence.** The case dimensions (A-004), the 15% active cap (A-019) and the pocket-depth claim (11 mm) are all downstream of a tablet geometry that has not been checked by anyone with a density figure. **Phase 2 must ask a contract manufacturer for the achievable apparent density before any case tooling is quoted.** Logged as **A-032**.

---

## 3. The Waterdrop hypothesis: how far can format *perception* be engineered away from format *technology*?

### 3.1 Is the Microdrink actually effervescent? Verified.

**FACT (med confidence).** Yes. Declared ingredients across Microdrink variants include **citric acid** plus **sodium carbonates** and **potassium carbonates** — the classic acid/carbonate couple — and product descriptions state the carbonation is generated by the reaction of a bicarbonate/carbonate compound with an acid. ([eu.waterdrop.com Cola](https://eu.waterdrop.com/products/cola), [Amazon US listing, hydration cubes](https://www.amazon.com/waterdrop-Microdrink-Hydration-Drink-Cubes/dp/B0BYKHS379))

The CSV's `format = effervescent cube` is correct. **Waterdrop is an effervescent tablet manufacturer that has never once used the phrase.**

### 3.2 How the de-positioning was done

Four levers, not one:

| Lever | What Waterdrop did | Evidence |
|---|---|---|
| **The noun** | Invented a category — "microdrink" — and never competed for the word "tablet" | INSEAD case: "waterdrop is in a category of its own — 'a microdrink'" ([INSEAD](https://digital.insead.edu/post/in-the-case-microdrink-revolution-digital-tech-innovation-branding/)) |
| **The geometry** | Chose a cube deliberately, as a break from the whole supplement/squash vocabulary | Founder: "A cube is a significant departure from any kind of syrup that has preservation chemicals, horrible packaging or even powder sticks" ([Food Dive](https://www.fooddive.com/news/waterdrop-ceo-hydration-beverages-drinks-microdrink-microlyte-retail-martin-donald-murray/708592/)) |
| **The design register** | Explicitly benchmarked to consumer electronics: "we wanted to make something beautiful and easy to use like an Apple product" | ([FoodNavigator](https://www.foodnavigator.com/Article/2022/02/14/Waterdrop-CEO-outlines-US-ambitions-We-wanted-to-make-something-beautiful-and-easy-to-use-like-an-Apple-product/)) |
| **The channel** | D2C-first, because "unlike most drinks, the cubes can be sold online" — a *beverage without water* is a light, cheap parcel | ([INSEAD](https://digital.insead.edu/post/in-the-case-microdrink-revolution-digital-tech-innovation-branding/), [Forbes](https://www.forbes.com/sites/claraludmir/2023/10/30/how-waterdrop-aims-to-become-a-leading-hydration-brand-without-ever-selling-water/)) |

### 3.3 Verdict on the hypothesis

**SUPPORTED, with a material qualification.**

**Supported, because the commercial result is unarguable.** Waterdrop charges **£0.749 a serving** for a cube declaring **B6 0.63 mg (45% NRV) and B12 1 µg (40% NRV)** — a functional intensity of 1/5 on our own rubric. It is the most expensive *low-potency* product in the entire 42-row set. **Nothing but design, language and channel is holding that price up.** So perception alone demonstrably can sustain a premium in this category. (Prices and vitamin figures per `competitors.csv` row 4 and A-023.)

**Qualified, because Waterdrop did not merely rename an existing object.** It changed the noun *and* the physical geometry *and* the primary pack *and* the route to market. V-Drop as briefed changes one thing — it adds an aluminium carry case to a 23 mm disc that it still calls a tablet, sold at a price benchmarked against a tube on a Boots shelf. **The same trick, attempted with one lever instead of four.**

**A counter-example in the other direction, for balance.** Applied Nutrition calls its product an effervescent tablet, makes no attempt to invent a category, and prices at **£0.744/serving — within a penny of Waterdrop** — while delivering 3,000 mg of active. It competes on payload, not on naming. Berocca, similarly, owns the pharmacy shelf with no repositioning whatever. **So naming is a lever, not a law: you can win on perception (Waterdrop) or on payload (Applied Nutrition), but V-Drop as briefed is currently attempting neither at a higher price than both.**

**OPINION — the practical instruction this yields.** Retire the word "tablet" from all consumer-facing language. Name the object, not the dosage form. Change the geometry so the object does not read as a pharmacy disc. Keep effervescence as a *sensory* promise ("dissolves clear in under a minute, no grit") and never as a *category* label. And do all of that **in addition to** raising the payload, not instead of it.

---

## 4. Evaluation scorecard — criteria, weights and rubrics

Weights reflect the **D2C-only** decision. Shelf standout and retailer margin are excluded entirely. Letterbox economics, moisture robustness in a repeat-delivery model, and differentiation under paid-social acquisition are weighted up.

| # | Criterion | Weight | 0 | 5 |
|---|---|---:|---|---|
| C1 | **Achievable active payload per serving** (the A-019 question) | **20%** | under 100 mg | 3,000 mg+ with no structural ceiling |
| C2 | COGS per serving | 5% | prohibitive at launch volume | pennies |
| C3 | Tooling, MOQ and capital to launch | 5% | six figures and bespoke tooling | off-the-shelf, low MOQ |
| C4 | **Letterbox and postal economics** (A-006) | **15%** | cannot be posted (cold chain, liquid, over-depth) | Large Letter, sub-100 g, flat |
| C5 | Moisture stability and shelf life (A-005) | 10% | unstable without cold/dry chain | individually hermetically sealed |
| C6 | Portability **and** compatibility with the reusable case (A-025) | 10% | bulky, and kills the case concept | pocketable and *needs* the case |
| C7 | Sustainability and recyclability | 5% | multi-laminate, single-use, non-recyclable | reusable or mono-material |
| C8 | Regulatory simplicity (novel format, caffeine labelling, A-024 150 mg/L) | 5% | novel food / novel format questions | plainly a food supplement or drink mix |
| C9 | Differentiation and difficulty of copying | 10% | commodity, copied in weeks | defensible asset or real barrier |
| C10 | Time to market | 5% | 18 months+ | under 3 months |
| C11 | Sensory and dissolution experience | 10% | gritty, slow, sediment | dissolves clear and fast; the experience is the product |

**Veto column.** A weighted average can hide a fatal flaw (a capsule scores well and is not a drink). Each row therefore carries an explicit veto note.

---

## 5. Format-by-format analysis

### F-A. Effervescent tablet, 3.5 g, in a standard tube — the incumbent
- **Payload:** ~1,000 mg achievable; ~500 mg as briefed.
- **Postal:** the killer. **Royal Mail Large Letter depth limit is 25 mm; a standard tube for a 23–27 mm tablet is ~28–30 mm in diameter.** A tube is a **parcel**, not a large letter. ([Royal Mail prices, April 2026](https://www.royalmail.com/sites/royalmail.com/files/2026-03/our-prices-april-2026-v1-ta.pdf); tube dimensions from `competitor-map.md` §4.1)
- **Moisture:** solved and proven — extruded aluminium or PP tubes with a **silica-gel desiccant chamber in the cap** are the industry standard. ([Pharmapproach](https://www.pharmapproach.com/packaging-of-effervescent-tablets/), [AGM Container Controls](https://www.agmcontainer.com/blog/desiccant-case-studies/effervescent/))
- **Differentiation:** none. Berocca, Phizz, HIGH5, SiS, Boots, Tesco, Applied Nutrition and an Amazon long tail all use it.
- **Verdict:** the baseline V-Drop must beat, and the one format that is structurally *bad* for letterbox D2C.

### F-B. Effervescent tablet, 3.5 g, loose in a reusable aluminium case — V-Drop as briefed
- **Payload:** ~500 mg (A-019); possibly ~370 mg if A-032 holds.
- **Postal:** good — 16 × 3.5 g = 56 g of tablets; a flat card mailer lands around 95–100 g total (ESTIMATE), at the boundary of the cheapest Royal Mail Large Letter band.
- **Moisture: the weak point, and now better evidenced.** **FACT.** Effervescent blends must be manufactured at **below 20% RH (often nearer 10%)** and sealed immediately in moisture-proof primary packaging. ([ProSafe Nutra](https://prosafenutra.com/effervescent-tablet-manufacturer-mastering-stability-moisture-control/), [JinLu](https://www.jinlupacking.com/blogs/effervescent-tablets-guide/)) A case opened several times a day, relying on a paper-thin silica sheet, is the opposite of that specification. **A-005 should move from DISPUTED to LIKELY INCORRECT as specified.** The fix is individually sealed blister trays inside the case — which is exactly what the 4.5 g option below assumes.
- **Case compatibility:** by construction, 5/5 — but per A-004 the case holds 8, and per A-023 it is roughly half as volume-efficient per serving as the tube it replaces.
- **Verdict:** the briefed format is the *worst* of the effervescent options on payload and stability, and only average on everything else.

### F-C. Effervescent tablet, 4.5–5 g, sealed blister tray, 1–2 tablets per serving — **the revised option**
- **Payload: 1,350–1,500 mg per tablet at a 30–33% load; up to ~3,000 mg with a two-tablet serving.** Precedent: Applied Nutrition (§2.2).
- **Postal:** 16 × 4.5 g = 72 g; with blister foil and a card mailer, ~110–120 g (ESTIMATE) — into the 101–250 g Large Letter band, still flat, still a letter. A two-tablet serving doubles that to ~185 g, still within 250 g.
- **Moisture:** solved. A sealed blister per tablet is the pharmaceutical standard and removes the A-005 argument entirely.
- **Case compatibility:** works, but the case now holds *trays* rather than loose tablets, and a 25 mm disc worsens A-004's long-axis problem. The case becomes an **accessory and a brand object**, not the primary pack — which is also what A-025's evidence gap argues for.
- **Regulatory:** unchanged. Caffeine at ≤75 mg per 500 ml keeps the Energy SKU under the 150 mg/L threshold in A-024.
- **Time/capital:** fastest of the serious options. Round tablet punches are standard tooling; effervescent MOQs run **~100,000 tablets (≈5,000 tubes of 20), with some houses at 10,000 tubes**. ([ProSafe Nutra](https://prosafenutra.com/tablet-manufacturing/), [Leben Formulation](https://www.lebenformulation.com/blog/effervescent-tablet-formulation-contract-manufacturing))
- **Verdict:** **the highest-scoring option that keeps the brand idea intact.**

### F-D. Effervescent cube, bespoke geometry — the Waterdrop play
- **Payload:** a cube of the same mass has the same limits; Waterdrop's own is intensity 1/5.
- **Differentiation:** the strongest available on design, and demonstrably worth £0.749/serving in the market — but it is **copying the incumbent's exact move**, and Waterdrop has a decade and nine-figure revenue of head start.
- **Capital:** bespoke punches and a custom pack format; **ESTIMATE £15,000–£40,000 tooling and 8–12 months**, versus standard round punches at a fraction of that. (ESTIMATE, unsourced — flagged for Phase 2.)
- **Verdict:** high differentiation, low payload, slow and expensive. Viable only if V-Drop concedes the potency argument entirely — which §7 says it should not.

### F-E. Powder stick pack / sachet, non-effervescent
- **Payload: effectively unconstrained.** 3–10 g per stick with no acid–base couple to accommodate. This is how Spacegoods gets to 3,305 mg and DIRTEA to 2,000 mg.
- **Moisture:** best in class — each serving is individually sealed in foil laminate.
- **Capital:** lowest. MOQ ~**50,000 sticks (2,500 boxes of 20)** with project minimums around **$10,000** and some houses starting at $2,500. ([Nutra Connection](https://www.nutraconnection.com/stick-pack-manufacturing), [StickPax](https://stickpax.com/))
- **Sensory: the recorded weakness.** Grittiness and poor dissolution are the most consistent complaint theme across Spacegoods and DIRTEA reviews (`customer-segments.md` §1 S4, rated WEAK) — and the customer-insight report names *"actually dissolves / not gritty"* as V-Drop's strongest ownable phrase.
- **Sustainability:** worst in class. Multi-laminate foil sticks are not kerbside recyclable.
- **Differentiation: none.** Liquid I.V., Tonic Health, Humantra, Spacegoods, DIRTEA and London Nootropics all use it.
- **Case compatibility: none.** A stick pack kills the reusable-case concept outright.
- **Verdict:** wins the payload argument and loses the brand argument.

### F-F. **Effervescent powder in a stick or sachet — the hybrid**
- The Tonic Health High Dose Immunity sachet (10 × 5.5 g, ~2,500 mg active) and the Fast&Up range are the precedents. ([Tonic Health](https://www.tonichealth.co/products/immunity-and-vitality), [Fast&Up effervescent range](https://in.fastandup.com/collections/effervescent-tablets))
- **Payload:** high, because no compression step constrains the blend; still needs a couple for the fizz, but a 5.5–8 g serving leaves 2,000–3,000 mg.
- **Moisture:** individually sealed — solves A-005.
- **Sensory:** keeps the effervescent theatre and the "dissolves clear" promise that the powder brands fail on.
- **Differentiation:** low-moderate. Kills the case.
- **Verdict: the strongest *pure* performer on the scorecard, and the option to hold in reserve if the tablet cannot hit its dissolution or payload targets.**

### F-G. Non-effervescent compressed dispersible tablet
- Fixes moisture and cost. **Vetoed on sensory:** without gas evolution, dispersion is slow and sediment-prone, which destroys the one customer-evidenced advantage V-Drop has. Not recommended.

### F-H. Oral thin film / dissolvable strip
- **FACT.** Leading commercial energy strips carry **~50 mg caffeine + ~30 mg L-theanine + B12**. ([NuStrips](https://nustrips.com/pages/energy-strips)) Boots has run consumer education on melting vitamin strips, so UK awareness exists. ([Boots Health Hub](https://www.boots.com/healthhub/vitamins-supplements/are-melting-vitamin-strips-the-future-of-supplements))
- **Payload: ~100 mg total, an order of magnitude below requirement. VETO for a functional water-enhancer.** Also: it is not a drink, so it abandons the entire "add it to your water" proposition and the hydration halo.
- **Worth noting for one reason only:** postal economics are unbeatable (16 strips ≈ 2 g) and it is the most *pocketable* format that exists. If V-Drop ever wants a low-cost trial or sampling unit, this is it.

### F-I. Capsules / F-J. Gummies
- Capsules score well mechanically and are **vetoed by the proposition**: they are not a drink, they conflict with D-002's water-based decision, and they compete in the most commoditised shelf in the UK.
- Gummies are the fastest-growing non-pill format (among non-pill formats: gummies 37%, powders 24%, liquids 15%, quick-dissolve 8% — [Nextin Research](https://www.nextinresearch.com/consumer-insights-report/supplement-trends); [Modern Retail](https://www.modernretail.co/operations/brands-briefing-why-2025-was-the-year-of-the-gummy-supplement/)). But they carry low payload, need sugar or polyol mass, melt in a summer letterbox, and are not a drink. **Vetoed.**

### F-K. Liquid concentrate drops / F-L. RTD
- **Both excluded by a logged user decision** (`decisions.md` row 2, 2026-09-21: the product stays water-based; RTD and liquid concentrate pouches are out of scope). Recorded here for completeness only. RTD is also postally impossible and would collapse the letterbox model.

### F-M. Bottle-cap cartridge / pod system — Cirkul
- The obvious international reference and genuinely D2C-subscription-native: customers buy a bottle, then subscribe to flavour cartridges; each cartridge flavours roughly six 20 oz servings. ([Cirkul](https://drinkcirkul.com/pages/cirkul-subscribe-page))
- **FACT.** **No official UK operation.** The only UK purchase routes I could find were import marketplaces. ([Ubuy](https://www.u-buy.co.uk/brand/cirkul))
- **Vetoed for V-Drop:** it requires proprietary bottle hardware, it ships liquid (postally heavy, leak risk), and the capital is a bottle programme, not a supplement programme.
- **The cautionary evidence is strong.** Pod-based beverage systems have a poor survival record: Keurig/AB InBev's **Drinkworks shut down abruptly in December 2021** despite having just doubled sales, and refunded customers ([Food Dive](https://www.fooddive.com/news/keurig-for-cocktails-abruptly-decides-to-shutter-operations/611684/), [Heaven Hill](https://heavenhill.com/news-and-notes/drinkworks-shutting-down-effective-immediately/)). PepsiCo's **Drinkfinity** bottle-and-pod system is likewise no longer a going concern ([Food Dive launch coverage](https://www.fooddive.com/news/pepsico-launches-water-bottle-and-flavored-pod-system/517286/)). Hardware lock-in cuts both ways.

### F-N. Scent pods and bottle — Air Up (Germany), and what it teaches about the case
- **FACT.** Air Up sells a bottle plus scent pods that flavour water by retronasal olfaction. It has a **UK D2C store** and is in **Boots and Sainsbury's**; UK pod packs run **£4.99–£6.99 for three pods**, each pod scenting ~5 litres. ([air up UK](https://shop.air-up.com/gb/en/flavors), [Boots listing](https://www.boots.com/air-up-pods-apple-3s-10362094), [PriceSpy](https://pricespy.co.uk/s/air-up-pods/))
- **FACT.** Revenue passed **€200m by 2024**, ~**75% from its own e-commerce**, with a razor-and-blade model and a **2025 loyalty/subscription launch at 15% off**. ([Bigblue case study](https://www.bigblue.co/blog/air-ups-recipe-for-success-dazzling-growth-and-8-figure-revenue), [Five Seasons Ventures](https://fiveseasonsventures.medium.com/why-we-led-air-ups-40m-series-b-520200a9f2dc))
- **The finding that matters for A-025.** The same sources report that **in the UK, around 60% of Air Up consumers turned out to be children**, with parents aged 40+ buying the bottles for them. **A hardware-led water-flavouring brand achieved its UK scale by becoming a children's product.** (FACT, med confidence — single-source, an agency case study; treat as directional.)
- **OPINION.** That is the most relevant evidence yet found on A-025, and it is a warning rather than a veto. A beautiful reusable object attached to flavoured water is a proven way to build a nine-figure D2C business — and also a proven way to end up with an audience you did not price for. V-Drop's Energy SKU is age-restricted from April 2027 (A-024); acquiring a family audience would be actively harmful.
- **Payload: zero actives. VETO as a format for V-Drop.** Included because the *business model* is the closest working analogue to the briefed one.

### F-O. Water-soluble PVOH film pouch — drop the whole sachet in
- **FACT.** Food-grade PVOH film is commercially established for drink mixes, instant coffee and protein shake portions; it dissolves in seconds to minutes and passes through the gut unmetabolised. ([Cflex](https://consumer.cflex.com/products/water-soluble-film/), [FoodNavigator-USA](https://www.foodnavigator-usa.com/Article/2019/10/16/Where-next-for-edible-packaging-From-dissolvable-pre-workout-protein-packs-to-instant-oatmeal/), [Cortec EcoSol](https://www.cortecvci.com/products/vpci-packaging-products/ecosol-water-soluble-packaging-solution/))
- **Genuine appeal for V-Drop:** it combines the stick pack's unlimited payload and hermetic seal with a tablet-like single-object ritual (one thing goes in the water, nothing is left in your hand), and it removes the foil-waste objection.
- **Risks:** a PVOH pouch must still be over-wrapped for humidity; UK consumer acceptance of ingesting a plastic film is untested; and the FSA position on PVOH as a food ingredient rather than a food-contact material needs checking by `claims-regulatory`.
- **Verdict:** the most interesting *unoccupied* format in this report, and the one I would put behind the recommended two. Nobody in the UK functional-drink set uses it.

### F-P. Dual-chamber cap / two-stage delivery
- **FACT.** Cap-in-cap and twist-to-activate closures that hold powder above a liquid and release it on opening are mature, with multiple commercial suppliers. ([Nutritional Outlook](https://www.nutritionaloutlook.com/view/dual-chamber-supplement-bottle-makes-north-american-debut), [Quantix](https://www.quantixcap.com/twist-to-activate-caps-manufacturer/), [Pont infusion cap](https://nutraceuticalbusinessreview.com/subtle-twist-from-pont-packing-s-new-infusion-cap-140125))
- **Vetoed:** it requires shipping the liquid, which is the exact thing the water-based decision (D-002) and the letterbox economics exclude. It is a good answer to a question V-Drop is not asking.

### F-Q. Freeze-dried, lyophilised and flash-frozen
- Cometeer's flash-frozen coffee pucks are the reference: 26 g of extract per aluminium capsule, 18-month frozen shelf life, **shipped on dry ice with a maintained cold chain**, at roughly $69 per 32-capsule subscription shipment. ([Cometeer](https://cometeer.com/), [Tasting Table review](https://www.tastingtable.com/1253768/frozen-coffee-capsules-review/))
- **Vetoed for V-Drop: a cold chain destroys letterbox delivery, which is the entire D2C cost model.** Conventional (non-frozen) lyophilisation remains relevant only as an *ingredient* process — it is a way to make a botanical extract more soluble and less bitter before it enters a tablet or stick, not a consumer format.

---

## 6. Master scorecard

Scores 0–5. Weighted total = Σ(score × weight) ÷ 100. Formats excluded by a logged user decision are shown in italics and not ranked.

| Format | C1 Payload 20% | C2 COGS 5% | C3 Capital 5% | C4 Postal 15% | C5 Moisture 10% | C6 Port+case 10% | C7 Sustain 5% | C8 Reg 5% | C9 Diff 10% | C10 TTM 5% | C11 Sensory 10% | **Weighted** | Veto? |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---:|---|
| **F-F Effervescent powder stick/sachet** | 4 | 3 | 4 | 4 | 5 | 3 | 2 | 5 | 2 | 5 | 4 | **3.75** | — |
| **F-C Effervescent tablet 4.5–5 g, blister + case** | 4 | 3 | 2 | 4 | 4 | 4 | 3 | 5 | 3 | 3 | 4 | **3.70** | — |
| **F-E Powder stick pack (non-eff.)** | 5 | 4 | 4 | 4 | 5 | 3 | 2 | 5 | 1 | 5 | 2 | **3.70** | — |
| F-G Non-eff. dispersible tablet | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 5 | 2 | 4 | 1 | **3.65** | sensory |
| **F-D Effervescent cube (bespoke)** | 2 | 3 | 1 | 5 | 3 | 5 | 4 | 5 | 4 | 2 | 4 | **3.50** | — |
| F-O PVOH dissolvable pouch | 4 | 2 | 2 | 4 | 4 | 4 | 4 | 2 | 4 | 2 | 3 | **3.50** | reg. unknown |
| F-H Oral thin film | 1 | 5 | 3 | 5 | 4 | 5 | 2 | 4 | 4 | 3 | 3 | **3.40** | **payload** |
| F-B Effervescent tablet 3.5 g, loose in case (**as briefed**) | 2 | 2 | 2 | 4 | 2 | 4 | 4 | 5 | 3 | 3 | 4 | **3.10** | — |
| F-J Gummy | 2 | 3 | 3 | 3 | 2 | 4 | 2 | 4 | 1 | 4 | 5 | **2.85** | not a drink |
| F-A Effervescent tablet 3.5 g in tube | 2 | 4 | 3 | 1 | 4 | 3 | 3 | 5 | 1 | 5 | 4 | **2.75** | postal |
| F-M Cap cartridge / pod (Cirkul) | 3 | 1 | 0 | 1 | 4 | 2 | 1 | 4 | 5 | 1 | 4 | **2.60** | liquid, hardware |
| F-P Dual-chamber cap | 3 | 1 | 0 | 1 | 5 | 2 | 1 | 4 | 4 | 1 | 4 | **2.60** | ships liquid |
| F-N Scent pod + bottle (Air Up) | 0 | 1 | 0 | 3 | 4 | 3 | 1 | 5 | 5 | 1 | 3 | **2.35** | **zero actives** |
| *F-I Capsule* | *3* | *5* | *5* | *5* | *5* | *5* | *3* | *5* | *0* | *5* | *3* | *3.80* | **not a drink** |
| *F-K Liquid concentrate drops* | *3* | *3* | *3* | *1* | *5* | *4* | *2* | *4* | *2* | *4* | *3* | *2.95* | **D-002** |
| *F-Q Freeze-dried / flash-frozen* | *4* | *1* | *0* | *0* | *5* | *1* | *2* | *4* | *5* | *1* | *5* | *2.80* | **cold chain** |
| *F-L RTD* | *5* | *1* | *1* | *0* | *5* | *1* | *2* | *5* | *1* | *3* | *5* | *2.80* | **D-002** |

**Worked example (F-C):** (4×20 + 3×5 + 2×5 + 4×15 + 4×10 + 4×10 + 3×5 + 5×5 + 3×10 + 3×5 + 4×10) ÷ 100 = (80+15+10+60+40+40+15+25+30+15+40) ÷ 100 = **3.70**.

**OPINION on how to read this.** The scorecard is a comparison device, not a decision. The capsule scores highest and is useless; the three formats that matter are separated by 0.05, which is noise. The real content is in the **columns**: F-E wins payload and loses sensory and differentiation; F-C wins the brand and loses capital and speed; F-F wins almost everything except the case and any claim to being distinctive.

---

## 7. Letterbox and postal economics by format (A-006)

**FACT.** Royal Mail Large Letter maximum is **353 × 250 × 25 mm and 750 g**, banded by weight. Prices effective 7 April 2026, per Royal Mail's published price list: **Large Letter 1st class 100 g £1.80, 250 g £3.30, 750 g £8.05**; the 2nd class figures returned were 100 g £1.77, 250 g £2.86, 750 g £5.45. ([Royal Mail, our prices April 2026](https://www.royalmail.com/sites/royalmail.com/files/2026-03/our-prices-april-2026-v1-ta.pdf), via search summary)

**Caution.** The returned 1st and 2nd class 0–100 g figures are implausibly close (£1.80 vs £1.77). **Do not model on the 2nd-class numbers until someone reads the PDF directly.** The *band structure* — a step at 100 g and another at 250 g, and a hard 25 mm depth limit — is what the analysis below relies on, and that is not in doubt.

| Format | Product mass, 16 servings | Est. total mailer mass | Depth | Band | Comment |
|---|---:|---:|---:|---|---|
| Eff. tablet 3.5 g, flat tray | 56 g | ~95–100 g | ~12 mm | **0–100 g, marginal** | Any packaging upgrade pushes it over the cheapest band |
| **Eff. tablet 4.5 g, blister, 1/serving** | 72 g | ~110–120 g | ~14 mm | 101–250 g | Comfortably a Large Letter |
| Eff. tablet 4.5 g, blister, 2/serving | 144 g | ~185 g | ~20 mm | 101–250 g | Still a letter; doubles COGS per serving |
| Powder stick 4 g | 64 g | ~95–105 g | ~15 mm | 0–100 g, marginal | Foil adds ~8 g |
| Eff. powder sachet 5.5 g | 88 g | ~130 g | ~18 mm | 101–250 g | Fine |
| Spacegoods-class stick 8 g | 128 g | ~165 g | ~20 mm | 101–250 g | Fine |
| **Eff. tablet in a tube** | 56–72 g | ~120 g | **~30 mm** | **Parcel — fails the 25 mm depth limit** | The incumbent format cannot use Large Letter |
| Oral thin film | 1.6 g | ~25 g | ~5 mm | 0–100 g | Cheapest possible, but no payload |
| Cirkul-style liquid cartridge | 300 g+ | 350 g+ | >25 mm | Parcel | Shipping water again |
| RTD / frozen | 4–8 kg | — | — | Impossible | — |

**Three "so whats".**
1. **The flat architecture is V-Drop's only *sourced, quantified* cost advantage over the incumbents.** It is worth stating in exactly those terms and not dressing it up as "pocket convenience".
2. **The 100 g band is a design constraint, not an outcome.** At a 16-tablet monthly pack (per A-014) a 3.5 g tablet keeps you at the boundary; a 4.5 g tablet does not. The pricing model should assume the **101–250 g band** and be pleasantly surprised, not the reverse. This further weakens the brief's "under £1.60" claim in A-006.
3. **The postal case argues against the 24-tablet pack from a second direction.** A-014 already says 24 over-ships by ~45%; the tariff bands say 24 × 4.5 g = 108 g of tablets alone pushes every option into a higher band. 16 is the right number for both reasons.

---

## 8. What each format does to the price-to-potency position

Baseline from the previous run: **V-Drop subscription £1.81 (Mind) / £1.94 (Recovery) / £2.78 (Energy) per gram of declared active**, against Spacegoods £0.39–0.49, Tonic Health £0.36, DIRTEA £0.52, Phizz £0.61, Neutonic £1.54.

**New benchmark added this run.** Applied Nutrition Creatine Effervescent: **£5.95 for 8 servings = £0.744/serving**, 3,000 mg active per serving = **£0.248 per gram of active.** *(FACT on price and dose, med confidence; ESTIMATE on the division.)* **In fairness to V-Drop: creatine monohydrate is one of the cheapest bulk actives in the industry, so this is not a like-for-like potency comparison — but it is a like-for-like *format* comparison, and it is priced within a penny of Waterdrop.**

| Scenario | Active/serving | Price/serving | **£ per g active** | Where that lands |
|---|---:|---:|---:|---|
| V-Drop as briefed, subscription (Mind) | 460 mg | £0.833 | **£1.81** | Worse than everything except Waterdrop |
| V-Drop as briefed, retail tube (Mind) | 460 mg | £0.466 | £1.01 | Still behind Phizz |
| **F-C: 4.5 g tablet at 30% load, £0.83/serving** | **1,350 mg** | £0.833 | **£0.62** | **Level with Phizz (£0.61)** |
| F-C at 30% load, £0.75/serving | 1,350 mg | £0.750 | **£0.56** | Ahead of Phizz and DIRTEA |
| F-C, two 4.5 g tablets, £1.20/serving | 2,700 mg | £1.200 | **£0.44** | **Inside the Spacegoods band (£0.39–0.49)** |
| F-F: 5.5 g effervescent sachet, ~2,500 mg, £0.83 | 2,500 mg | £0.833 | **£0.33** | **Beats Tonic Health (£0.36)** |
| Applied Nutrition creatine effervescent (benchmark) | 3,000 mg | £0.744 | £0.25 | Cheap commodity active |
| Waterdrop Microdrink (benchmark) | ~1.6 mg | £0.749 | ~£468 | Sells on design alone |

**FACT (arithmetic).** Moving from a 3.5 g / 15% tablet to a 4.5 g / 30% tablet improves V-Drop's cost per gram of active by roughly **3×**, at the same retail price, and takes it from worst-in-class to mid-table. **This is the single highest-leverage change available to the proposition, and it costs a die change and a reformulation, not a business model.**

**The honest caveats.**
- Cost per gram of active is a crude metric. It rewards cheap bulk actives (creatine, vitamin C, glucosamine) and punishes expensive ones (Alpha-GPC, standardised mushroom extracts). It should sit alongside per-active comparisons, not replace them.
- A 4.5 g tablet raises COGS per serving. At an ESTIMATE of £0.06–£0.10 per 3.5 g tablet, a 4.5 g tablet with higher-value actives is plausibly £0.12–£0.20 — still leaving a very large gross margin at £0.83, but the pricing model must be re-run. (ESTIMATE, unsourced — `pricing-economist` to replace.)
- Building an effervescent line is **30–60% more expensive than a standard tablet line**, so the format carries a structural COGS premium over powder regardless of what is in it. ([JinLu](https://www.jinlupacking.com/blogs/effervescent-tablets-guide/), [Selvita](https://selvita.com/our-science/resources/blog-articles/effervescent-tablets-a-lasting-trend))

---

## 9. Ranked recommendation

### Rank 1 — **Effervescent tablet, 4.5–5 g, individually blistered, one tablet per serving, case as an accessory (F-C)**

**Why.** It is the only option that fixes A-019, A-005 and the price-to-potency hole simultaneously while keeping the brand idea, the "dissolves clear" sensory advantage and the flat letterbox architecture. It is also the only option with a live UK proof point in the exact format.

- **Capital, ESTIMATE:** standard round punch set and blister change parts, low five figures; effervescent MOQ ~100,000 tablets ≈ 6,250 subscriber-months at a 16-tablet pack, implying roughly **£10,000–£20,000 of first-run stock** at an assumed £0.10–£0.20/tablet, plus formulation, stability testing and artwork. **Total to first shippable batch: ~£35,000–£70,000 ESTIMATE**, excluding the aluminium case. *Method: MOQ figures sourced ([ProSafe Nutra](https://prosafenutra.com/tablet-manufacturing/), [Leben](https://www.lebenformulation.com/blog/effervescent-tablet-formulation-contract-manufacturing)); all £ figures are my assumptions and must be replaced by real quotes.*
- **Time, ESTIMATE:** 4–7 months to first shipment (formulation and taste iteration dominate; accelerated stability runs in parallel).
- **Price-to-potency effect:** **£1.81–£2.78/g → ~£0.62/g** at an unchanged £0.83 subscription price. Mid-table rather than worst-in-class.
- **What it costs you:** the case becomes an accessory rather than the hero, because tablets now arrive in sealed trays. Given A-025 is unproven and A-005 is close to disproven, **that is a feature, not a concession.** A 25 mm tablet also worsens A-004's long-axis arithmetic — the case must be redesigned or the tablet kept at 23–24 mm with a thickness increase.

### Rank 2 — **Effervescent powder in a stick or sachet (F-F)**

**Why.** Highest raw scorecard result. Unconstrained payload, hermetic per-serving seal, fastest and cheapest route to market, and it keeps the fizz and the clear dissolution that the powder incumbents fail on.

- **Capital, ESTIMATE:** MOQ ~50,000 sticks with project minimums around **$10,000 (≈£7,900 at 1.27)**; some houses from $2,500. **Total to first shippable batch: ~£15,000–£30,000 ESTIMATE.** ([Nutra Connection](https://www.nutraconnection.com/stick-pack-manufacturing), [StickPax](https://stickpax.com/))
- **Time, ESTIMATE:** 3–5 months.
- **Price-to-potency effect:** **~£0.33/g** at 2,500 mg and £0.83 — better than every competitor benchmark in the set.
- **What it costs you:** the reusable case, the differentiation, and the sustainability story (foil laminate). You become a better-dosed Tonic Health. **OPINION: this is the right answer if the user's priority is a defensible product; the wrong answer if the priority is a defensible brand.**

### Rank 3 — **Effervescent cube with bespoke geometry (F-D)**

**Why.** The highest-differentiation option, and §3 shows the de-positioning play genuinely works — Waterdrop sustains £0.749/serving on design alone. A cube in a reusable case is a coherent object in a way that a disc in a case is not.

- **Capital, ESTIMATE:** bespoke punches, custom pack format and likely a higher MOQ: **£40,000–£90,000 to first shippable batch (ESTIMATE, unsourced).**
- **Time, ESTIMATE:** 8–12 months.
- **Price-to-potency effect:** **little or none** — a cube of similar mass has similar limits. You would be choosing to compete on perception, against the company that invented the move and has a ten-year lead.
- **Verdict: only pursue this if the user decides the potency argument is unwinnable and the brand is the whole asset.** I do not recommend it on current evidence.

### Do not pursue
Tube (postally disqualified), loose tablets in a case (moisture, A-005), capsules and gummies (not a drink), thin film (payload), cap cartridges, dual-chamber caps, RTD and frozen (all ship liquid or need a cold chain, and two are excluded by a logged decision).

### Hold as an option worth one week of desk work
**PVOH dissolvable pouch (F-O).** It is the only genuinely unoccupied format in the UK set, it combines the stick's payload with a tablet-like single-object ritual, and it removes the foil-waste objection. It needs a regulatory read from `claims-regulatory` before it can be scored properly.

---

## 10. Consequences for the assumptions register

| ID | Change |
|---|---|
| **A-019** | Status **OPEN → PARTLY DISPROVED**. The ~500 mg cap is a consequence of the chosen 3.5 g serving and active set, not of the format. Counter-example: Applied Nutrition 4.5 g effervescent tablet at 1,500 mg creatine (33% load), UK, on sale. Caveat retained for mushroom extracts. |
| **A-025** | Status **UNVERIFIED → UNVERIFIED, with new directional evidence.** Air Up proves a hardware-plus-consumable D2C model reaches nine figures — and that in the UK ~60% of its consumers are children. The case is a viable model and an audience risk. The fake-door cell D test remains necessary. |
| **A-005** | Strengthened from DISPUTED towards **LIKELY INCORRECT as specified**: effervescent blends require <20% RH manufacture and immediate moisture-proof sealing; a repeatedly-opened case with a silica sheet does not meet that. Sealed blister trays inside the case are the fix. |
| **A-006** | Strengthened. Royal Mail April 2026 Large Letter bands sourced; the 25 mm depth limit is what disqualifies the incumbent tube and validates V-Drop's flat architecture. The sub-100 g band is unattainable at a 4.5 g tablet. |
| **A-030 / W4** | Narrowed, not withdrawn. Phizz now runs Amazon Subscribe & Save; Humantra runs a full brand-owned D2C subscription in a competing dry format. |
| **A-032 (new)** | The briefed tablet geometry (23.0 × 5.2 mm at 3,500 mg) implies 1.62 g/cm³, above plausible effervescent apparent density. Either thickness or mass is wrong. |
| **A-033 (new)** | Format perception can be engineered independently of format technology — Waterdrop is effervescent and has never used the word — but it required four simultaneous changes (noun, geometry, pack, channel), not one. |
| **A-034 (new)** | Taste-masking a botanical by spray-dried microencapsulation typically yields ~33% active, roughly tripling the mass required. This, not compression, is the binding constraint on a mushroom effervescent. |

---

## 11. What I could not verify — priority list for someone with browser access

**Priority 1, load-bearing on the central finding:**

| # | What to get | Page |
|---|---|---|
| 1 | Applied Nutrition Creatine Effervescent: confirm 2 tablets = 9 g, 3 g creatine, full ingredient order, tube count and UK RRP | [appliednutrition.uk](https://appliednutrition.uk/products/creatine-monohydrate-effervescent-tablets), [thesupplementstore.co.uk](https://www.thesupplementstore.co.uk/products/applied-nutrition-effervescent-creatine-tablets) |
| 2 | JRS Pharma glucosamine effervescent formulation example: full composition table, tablet weight, % base | [JRS PDF](https://www.jrspharma.com/pharma-wAssets/docs/formulation-examples/fe-glusosamine.pdf) |
| 3 | Achievable apparent density and minimum thickness for a 23–25 mm effervescent tablet — ask a contract manufacturer directly (settles A-032 and A-004) | Nutra Direct / Principle Healthcare |
| 4 | Whether a 30% active load of a *dual-extracted mushroom powder* is compressible and dissolves clear — the single question that decides the Mind SKU | contract manufacturer |
| 5 | Royal Mail April 2026 Large Letter 2nd class bands, read from the PDF (the returned figures look wrong) | [royalmail.com](https://www.royalmail.com/sites/royalmail.com/files/2026-03/our-prices-april-2026-v1-ta.pdf) |

**Priority 2:**

| # | What to get | Page |
|---|---|---|
| 6 | Waterdrop cube mass in grams and the full per-cube vitamin panel — needed to compute cube payload properly | [eu.waterdrop.com](https://eu.waterdrop.com/products/cola) |
| 7 | Humantra UK prices: 15-sachet and 20-sachet RRP, and the actual subscription price | [humantra.co.uk](https://humantra.co.uk/), [Boots](https://www.boots.com/humantra-himalayan-lime-electrolyte-powder-15-x-3-7g-sachets-10362531) |
| 8 | Tonic Health **tablet** SKU: tablet mass and whether reishi is in the tablet as well as the sachet, and at what dose | [tonichealth.co](https://www.tonichealth.co/products/immunity-and-vitality) |
| 9 | Air Up UK: confirm the 60%-children figure from a primary source, not an agency case study | [air up UK](https://shop.air-up.com/gb/en) |
| 10 | Real UK quotes for: 4.5 g effervescent tablet COGS, blister tooling, stick-pack tolling, bespoke cube punches | contract manufacturers |
| 11 | FSA/GB position on PVOH as an ingested film in a food supplement | `claims-regulatory` |

**Things desk research genuinely cannot settle.** Whether a 30% mushroom load tastes acceptable; whether customers will pay for the case; whether a cube reads as premium or as a gimmick when it is not Waterdrop's cube. All three need a physical prototype and a panel.

---

## 12. New rows appended to `research/competitors.csv`

Checked against the existing 42 rows first; none of these was present. Existing rows were not modified.

| Brand | Product | Ring | Why it matters |
|---|---|---|---|
| Applied Nutrition | Creatine Monohydrate Effervescent Tablets | direct | **The A-019 counter-example.** Compressed effervescent tablet, 1,500 mg active per 4.5 g tablet, UK, £0.744/serving |
| Humantra | Electrolyte powder sachets | direct | New UK entrant with a brand-owned D2C subscription in a dry format; narrows W4 |
| air up | Scent pod starter set and pods | adjacent | The working hardware-plus-consumable D2C analogue; evidence for A-025 in both directions |

---

*Prepared by `market-mapper`, 2026-09-21. No figure in this report was read from a primary page directly; see §0.*
