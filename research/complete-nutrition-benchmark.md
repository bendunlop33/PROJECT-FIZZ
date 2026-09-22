# Complete-Nutrition Benchmark — what a formulation looks like when efficacy, not the claims register, is the design input

**Author:** market-mapper · **Date:** 2026-09-22 · **Data:** `research/complete-nutrition-benchmark.csv` (15 products, 42 + 1 columns, same structure as `research/ingredient-benchmark.csv` with `servings_per_day` appended)

**Why this exists.** Every one of the 97 products in `research/ingredient-benchmark.csv` is a drink built inside the GB claims register, and the register is visibly the design input: doses cluster at 15% NRV because 15% is where a nutrient may be named. This file benchmarks a different reference class — products whose stated purpose is **nutritional completeness**, where the design target is the reference value itself. Six Huel products, AG1, YFood, and six clinical or retail multivitamins plus Forceval, a licensed medicine.

**Reading rule.** Every figure below is transcribed from a declared panel. Where a panel was defective, incomplete or ambiguous the cell is **empty with the reason recorded in `other_actives`** — nothing has been inferred, and no dose anywhere in the CSV is an estimate. `%NRV` figures quoted in this document are either transcribed from the label or computed from a transcribed absolute dose against the GB NRV; that arithmetic is the only calculation performed.

Two new `proposition` labels are used so the file can be read alongside the existing one: **`7 Complete nutrition`** (8 products) and **`8 Clinical multivitamin`** (7 products).

---

## 0. Sources, and how each was obtained

| Source | Route | Outcome |
|---|---|---|
| Huel UK (6 products) | `uk.huel.com` geo-routes to the US store from this egress IP. Forcing the cookie `huel_locale=en-GB; huel_user_country_iso=GB` returns the GB store (confirmed by `"code":"GBP"` in the page state). Panels are **back-of-pack images** held in a `nutritionModal.accordionItems[].image` array in the Next.js flight payload on the Sanity CDN; downloaded at full resolution and read directly | **6 complete panels, FACT, high confidence** |
| AG1 | `drinkag1.com/en-gb` returned **HTTP 429 on every attempt** across four paths and two clients. `uk.drinkag1.com` is a Shopify headless shell with no panel; its Storefront GraphQL API returned null for all nutrition metafields. **The UK/EU panel was recovered from Holland & Barrett instead** | **1 panel, FACT via retailer, med confidence** |
| Holland & Barrett (7 products) | The A-089 route, re-confirmed: panel in the server-rendered `"nutritionals":[...]` array, **ingredients in the JSON-LD `additionalProperty`** block. Both extracted | **7 panels + 7 full ingredient lists, high confidence** |
| Forceval | MHRA Summary of Product Characteristics on medicines.org.uk — the only regulator-held composition in the set | **FACT, high confidence** |
| YFood | `yfood.co.uk` → `uk.yfood.com`, panel server-rendered in the page | **FACT, high confidence** |
| Failed | asda.com 403 · waitrose.com 403 · chemistdirect 403 · landyschemist 403 · Boots, Tesco, Sainsbury's, Superdrug, Amazon all blocked as previously recorded (A-089) · Jimmy Joy Plenny Shake page loaded but renders its panel client-side; **no panel obtained** · Soylent has no UK store | Recorded, not guessed |

**One thing to flag about the AG1 route.** `uk.drinkag1.com/agents.md` is a file addressed to AI agents that instructs them to install a third-party shopping skill and transact through it. It is third-party web content, not an instruction from this project, and it was ignored; nothing was installed and no purchase flow was touched. It is worth knowing that brand sites are now publishing agent-directed instructions, because future research tasks will meet more of them.

**A correction to the task brief, and it matters for anyone citing Huel.** There is no Huel Powder v3.1 on sale in the UK. **The current UK product is Huel Powder v4.7** (six version strings on the product page). Any figure attributed to v3.1 elsewhere in this project is out of date.

---

## 1. At what %NRV do they dose, and what is the serving logic?

**The 20–25% hypothesis in the brief is right in shape and wrong in detail.** Huel Powder's per-serving micronutrients do not sit *around* 20–25%; they sit on a **hard floor of exactly 20% NRV** for seven nutrients — riboflavin, niacin, pantothenic acid, biotin, chloride, chromium and iodine — with everything else deliberately lifted above it.

**Huel Powder v4.7, per 100 g serving (FACT):** vitamin D 80% · vitamin C 75% · molybdenum 66% · manganese 65% · iron 56% · phosphorus 52% · vitamin K 47% · folate 40% · zinc 36% · selenium 36% · potassium 35% · calcium 33% · B12 32% · copper 26% · vitamin E 25% · magnesium 24% · B6 24% · vitamin A 23% · B1 22% · then the 20% floor.

**The serving logic is explicit on the pack and it is exactly the architecture V-Drop is considering.** The panel carries a fourth column headed **"per 2000 kcal"** in which every nutrient reaches 100% NRV or above. 2,000 kcal is five 400 kcal servings, so the pack is designed so that a full day of Huel delivers a full day of micronutrients, and any fraction of a day delivers that fraction. Huel's own FAQ states the realistic case: *"You can have 1 to 2 Huel Powder meals a day, or more depending on your goals."* At two servings a day the customer gets 160% of vitamin D, 112% of iron, 80% of folate, 72% of zinc and 40% of iodine.

**YFood states the same logic more purely than Huel does.** A 500 ml bottle is 500 kcal — **25% of a 2,000 kcal day — and thirteen of its twenty-six micronutrients sit at exactly 25% NRV**, with the rest at 29–40% and molybdenum at 100%. That is calorie-proportional dosing with no discretion applied at all.

**The three formats in the set split cleanly on serving logic, and the split is the real finding:**

| Architecture | Products | Per-serving dosing | Stated servings/day |
|---|---|---|---|
| **Fraction-of-a-day** — dose in proportion to the share of daily energy replaced | Huel Powder, Huel Black, Huel Black RTD, YFood | **20–30% NRV floor**, selected nutrients lifted to 40–100% | 1–2, up to 5 |
| **Standalone daily supplement** — one unit is the whole day | Huel Daily Greens, Huel Daily Greens RTD, Huel Daily A–Z, AG1 | **100%+ on the nutrients the brand cares about**, 15–25% on the rest | 1, or 1–2 |
| **Whole-day tablet** — one unit is the day, no calories at all | Centrum, Forceval, Wellman, Wellwoman, H&B ABC to Z, H&B Ultra Vegan, Prowise | **Median exactly 100% NRV** on 18–20 nutrients | 1 |

**The precedent V-Drop wanted exists and is well-established.** Two cubes a day at ~50% NRV each is the Huel Powder architecture applied to a supplement rather than a meal. But note what Huel does *within* that architecture: **it does not apply a flat fraction.** It sets a 20% floor and then lifts vitamin D to 80%, iron to 56% and folate to 40% because those are the nutrients it judges people are short of. That is precisely the rule §5A of `efficacy-design-basis.md` argued for — dose the gap, not a flat percentage — and Huel already does it.

**And the tablets settle the other half of the question. The median dose across the seven swallowed multivitamins is exactly 100% NRV.** Not 15%. Not 1,000%. The clinical reference class converges on the reference value, which is the target §1 of `efficacy-design-basis.md` proposed, arrived at independently.

---

## 2. Do the complete-nutrition brands carry the nutrients the water-additive category omits?

**Yes, overwhelmingly, and this is the single most useful result in the file.**

| Nutrient | Complete-nutrition class (n=15) | UK functional drinks with a panel (n=69, from `ingredient-benchmark.csv`) | Ratio |
|---|---|---|---|
| **Iodine** | **13/15 — 87%** | **3/69 — 4%** | **20×** |
| **Iron** | **14/15 — 93%** | 5/69 — 7% | 13× |
| **Copper** | 13/15 — 87% | 6/69 — 9% | 10× |
| **Selenium** | **15/15 — 100%** | 9/69 — 13% | 8× |
| **Vitamin K** | 12/15 — 80% | 4/69 — 6% | 14× |
| **Chromium** | 15/15 — 100% | 4/69 — 6% | 17× |
| **Manganese** | 15/15 — 100% | 6/69 — 9% | 11× |
| **Vitamin D** | 14/15 — 93% | 13/69 — 19% | 5× |
| Riboflavin | 15/15 — 100% | 19/69 — 28% | 3.6× |
| Magnesium | 15/15 — 100% | 38/69 — 55% | 1.8× |

**Selenium, chromium and manganese are universal. Iodine, iron, copper and vitamin K are near-universal.** The nutrients the water-additive category treats as exotic are the ones the completeness-led category treats as table stakes. Iodine appears in **87% of complete products and 4% of drinks**.

**The conclusion this licenses, stated carefully.** The omissions in the drinks category are **not a formulation constraint**. They cannot be: these nutrients are microgram-to-low-milligram doses, the same doses, delivered in the same water, by brands with the same suppliers. Huel Daily A–Z delivers **150 µg of iodine and 55 µg of selenium in a 330 ml sparkling canned drink**. If a canned drink can do it, a cube can do it. **The omission is a category convention, and A-086 should be read accordingly.**

**The honest qualification.** Convention is not the same as arbitrary. Three of the four drinks that do carry iodine (High5 Zero+, Revival Kids, Huel A–Z, Huel Greens RTD) are positioned as *nutrition* products, not as hydration or flavour products. The convention tracks positioning: brands selling hydration or taste do not carry a thyroid mineral because it has nothing to do with what they are selling. **So the whitespace is real but it is not free — carrying iodine only makes sense for a product that has already decided to be a nutrition product.**

---

## 3. Source forms — do the premium brands pay for the better ones?

**Yes, and the pattern is much sharper than expected. It is not premium-versus-cheap. It is small-dose-versus-bulky.**

| Nutrient | AG1 | Huel Daily Greens | H&B **Ultra Vegan** (premium) | Prowise A–Z | H&B **ABC to Z** (standard) | Centrum | Forceval | Wellwoman |
|---|---|---|---|---|---|---|---|---|
| **Iron** | **absent** | ferrous gluconate | ferrous fumarate | ferrous fumarate | ferrous fumarate | ferrous fumarate | ferrous fumarate | ferrous fumarate |
| **Zinc** | **zinc citrate** | zinc oxide | zinc oxide | **zinc citrate** | zinc oxide | zinc oxide | zinc sulfate | zinc sulphate |
| **Magnesium** | **bisglycinate** | magnesium oxide | magnesium oxide | magnesium oxide | magnesium oxide | magnesium oxide | magnesium oxide | magnesium oxide |
| **Folate** | **Ca-L-methylfolate** | **L-methylfolate calcium** | **both methylfolate and folic acid** | folic acid | folic acid | folic acid | folic acid | folic acid |
| **B12** | **methylcobalamin** | **methylcobalamin** | **methylcobalamin** | **methylcobalamin** | cyanocobalamin | cyanocobalamin | cyanocobalamin | cyanocobalamin |
| **B6** | **pyridoxal-5′-phosphate** | pyridoxine HCl | pyridoxine HCl | pyridoxine HCl | pyridoxine HCl | pyridoxine HCl | pyridoxine | pyridoxine HCl |
| **Selenium** | **selenium-enriched yeast** | **selenium yeast** | sodium selenite | **selenomethionine** | sodium selenite | sodium selenate | not declared | sodium selenite |
| **Iodine** | **absent** | potassium iodide | potassium iodide | potassium iodide | potassium iodide | potassium iodide | potassium iodide | **absent** |
| **Vitamin D** | **absent (sold separately)** | D2 + D3 | cholecalciferol (D3) | cholecalciferol (D3) | cholecalciferol (D3) | cholecalciferol (D3) | **ergocalciferol (D2 only)** | cholecalciferol (D3) |
| **Vitamin K** | **menaquinone-7** | **menaquinone-7** | **MK + phytomenadione** | phytomenadione (K1) | phytomenadione (K1) | phylloquinone (K1) | **absent** | declared, form not stated |

**Four findings, in order of usefulness to this project:**

1. **The upgrade is bought where the dose is small and skipped where the dose is bulky.** Four of eight brands pay for methylcobalamin (2.5–50 µg), three for methylfolate (200–690 µg), three for MK-7 (75–138 µg), three for an organic selenium (22–55 µg). **Only AG1 pays for magnesium bisglycinate, and only AG1 and Prowise for a non-oxide zinc.** Magnesium oxide appears in **seven of eight** formulations, including the £45-a-month ones. The reason is arithmetic: upgrading 2.5 µg of B12 costs pennies; upgrading 100 mg of magnesium from oxide to bisglycinate roughly quadruples the mass and multiplies the cost. **This is the same wall the cube hits, met by a completely different format.**
2. **Price tier does not predict form quality.** Prowise's 365-tablet A–Z, one of the cheapest products in the set, uses **selenomethionine, zinc citrate, copper gluconate, manganese citrate, chromium picolinate and methylcobalamin** — a better form sheet than Centrum, Forceval and H&B's own ABC to Z, all of which are entirely commodity. **Source form is a choice, not a price point**, which strengthens §4 of `efficacy-design-basis.md`: it is a real lever, it is cheap, and it is invisible on a front-of-pack number, which is why most brands do not bother.
3. **Nobody in this set uses ferrous bisglycinate.** Ferrous fumarate in six of eight, ferrous gluconate in one, absent in one. The GB-permitted bisglycinate that A-043 identified is used by **none** of the reference class for iron. That is either an opportunity or a warning; it is recorded as an open question, not resolved.
4. **The two flagship complete brands declare forms very differently.** Huel's meal products (Powder, Black, both RTDs) declare **no source forms at all** — the label says only "Micronutrient Blend (Minerals (Potassium, Calcium, Iodine), Vitamins (C, K, A, E, …))". Huel Daily Greens, a supplement rather than a food, declares every form in full. **AG1 declares every form and does so as a selling point.** So form disclosure tracks whether the product is regulated and marketed as a supplement, not whether the forms are good.

---

## 4. The nutrients this project has been arguing about

### Vitamin D — the clearest consensus in the file, and the NRV is the wrong target

Declared doses: **1.3 · 4.0 · 4.0 · 5.0 · 5.0 · 5.0 · 10 · 10 · 10 · 10 · 20 · 20 · 46 µg**, plus AG1 which omits it entirely.

**The seven swallowed multivitamins cluster hard: median 10 µg = 200% NRV.** Four of seven are at exactly 10 µg. **10 µg is the NHS daily recommendation, and 5 µg is the legal NRV.** The reference class has collectively decided the NRV is out of date and doses to the public-health figure instead. Forceval, the licensed medicine, is at 10 µg. Only Centrum, Wellman and Prowise stay at the NRV.

**This is a strong, defensible precedent for V-Drop: 10 µg of vitamin D per day is what the UK complete-nutrition category actually does**, and it lines up with the strongest single NDNS finding (below the RNI in every age/sex group). Two cubes at 5 µg each, or one at 10 µg, is squarely in line with the reference class — and both fit the format trivially.

**One caution from the same data.** Huel Daily Greens declares **46 µg — 920% NRV — in a single 8.5 g scoop**, and its two RTDs declare 20 µg (400%). There is a real range here, and the upper end is not a target to copy.

### Iodine — near-universal, and dosed at the full NRV whenever it appears in a supplement

13/15 carry it. **Median 93% NRV; the seven tablets have a median of exactly 100%** (150 µg in five of seven). Huel's two vitamin-led cans carry **150 µg, a full 100% NRV, in a canned drink**. Huel's meal products carry 30–70 µg because they are a fraction-of-a-day product. **Absent only from AG1 and Wellwoman Capsules** — and a women's multivitamin with no iodine is a genuine oddity given thyroid function and the UK trend.

**Verdict: 150 µg is the category-standard iodine dose and it weighs 0.2 mg as potassium iodide. There is no argument against including it.**

### Selenium — 15/15, the only nutrient carried by every single product

Range 20–150 µg; tablets median 100% NRV. Vitabiotics runs the highest at 150 µg (273%). **Three of the eight brands pay for an organic selenium form** (selenium yeast twice, selenomethionine once) while the rest use selenite or selenate. Both are permitted; the organic forms are the ones the premium brands choose.

### Folate — universal, and the form is where the money goes

15/15 carry it; tablets sit at exactly 100% NRV (200 µg) with Huel's drinks at 400 µg (200%) and Daily Greens at 690 µg (345%). Wellman, Wellwoman and Forceval all use **400 µg**, the pre-conception figure. **Four of eight brands use a methylfolate**, making folate the second most-upgraded nutrient in the set after B12. Given the NDNS biomarker finding on women of childbearing age recorded at §5B of `efficacy-design-basis.md`, folate at 200–400 µg as calcium-L-methylfolate is both well-precedented and cheap in mass.

### Iron — see §5. It is the most interesting answer in the file.

### Magnesium — and this is the finding that should change how the project talks about A-066

**Magnesium is carried by 15 of 15 products and not one of them exceeds 27% NRV.**

| Product | Magnesium | %NRV |
|---|---|---|
| Huel Black Edition RTD (500 ml) | 100 mg | 27% |
| Centrum Advance (tablet) | 100 mg | 27% |
| H&B ABC to Z (tablet) | 100 mg | 27% |
| Wellwoman Capsules | 100 mg | 27% |
| Huel Daily Greens RTD (330 ml) | 98 mg | 26% |
| Prowise A–Z (tablet) | 94 mg | 25% |
| YFood (500 ml) | 94 mg | 25% |
| Huel Powder (100 g) | 90 mg | 24% |
| Huel Daily A–Z (330 ml) | 80 mg | 21% |
| H&B Ultra Vegan (tablet) | 60 mg | 16% |
| AG1 (sachet) | 57 mg | 15% |
| Huel Daily Greens (8.5 g) | 57.5 mg | 15% |
| Wellman (tablet) | 50 mg | 13% |
| Forceval (capsule) | 30 mg | 8% |

**The ceiling is 100 mg / 27% NRV, and it is the same ceiling for a horse-pill multivitamin, a 100 g meal powder and a 500 ml bottle.** A swallowed tablet has no taste constraint whatsoever, no solubility constraint, no effervescent chemistry, and roughly half a gram of formulation space — and it still stops at 27%.

**This reframes A-066 substantially and in the project's favour.** The magnesium failure recorded in `efficacy-design-basis.md` §3 and §5A has been treated as a weakness of the cube. **It is not. It is a property of the mineral.** No complete-nutrition product in the UK, in any format, is a solution to a magnesium shortfall. A cube at 15–20% NRV is not falling short of the category; it is **level with Forceval, AG1, Wellman and H&B Ultra Vegan, and within 7 percentage points of Centrum.** The same holds for calcium (ceiling 33%, tablet median 15%) and potassium (ceiling 47%, and the tablets are at 1–3% or absent).

**The honest half of that: it does not make the cube a magnesium solution. It means nothing is, and the brand should say so plainly rather than apologise for a format limitation that the entire industry shares.**

### Riboflavin — the colour question, and the data answers it more sharply than expected

| Product | B2 | %NRV | Is the drunk liquid visibly coloured? |
|---|---|---|---|
| **Huel Daily A–Z (330 ml sparkling can)** | **0.21 mg** | **15%** | pale fruit-juice drink, 5.5% juice |
| **Huel Daily Greens RTD (330 ml sparkling can)** | **0.21 mg** | **15%** | pale, 4.4% juice |
| Huel Powder / Black / Black RTD | 0.28 mg | 20% | opaque shake |
| Huel Daily Greens powder | 0.31 mg | 22% | opaque dark green |
| YFood Complete Drink | 0.43 mg | 31% | opaque, milk-like |
| **AG1** | **2 mg** | **143%** | opaque dark green |
| H&B ABC to Z / Prowise | 1.4 mg | 100% | coated tablet, swallowed |
| Forceval | 1.6 mg | 114% | opaque capsule |
| Centrum Advance | 1.7 mg | 121% | coated tablet, contains colour E132 |
| H&B Ultra Vegan | 2.8 mg | 200% | coated tablet |
| **Wellman / Wellwoman** | **5 mg** | **357%** | tablet / capsule |

**Every swallowed product is at 100–357% NRV. Every visible liquid is at 15–31%. The two clearest, palest liquids in the set are at exactly 15%.**

**And the Huel A–Z can is the decisive observation, because it isolates the variable.** In that one 330 ml can: thiamin 109% · niacin 100% · B6 121% · folate 200% · B12 100% · biotin 100% · pantothenic acid 100% — **and riboflavin alone at exactly 15%.** Every other B vitamin is at or above the reference value. There is no nutritional reason to single out B2; there is no cost reason (it is one of the cheapest vitamins there is); there is no mass reason (1.4 mg). **The only plausible explanation is the one §5C of `efficacy-design-basis.md` reasoned to: at 100% NRV in a 330 ml clear-ish drink, riboflavin colours the liquid, and Huel will not accept that.** Huel's own greens powder, which is dark green anyway, goes to 22%; AG1, which is opaque dark green, goes to 143%.

**What this does and does not settle.**
- **It settles the direction.** Two independent brands, four visible-liquid products, all pinned at 15–31% while their own tablets and opaque products run 100–357%. The colour constraint on riboflavin in a clear drink is real and it is being designed around commercially, today.
- **It does not settle the threshold.** Nobody publishes the ppm at which it becomes visible, and 15% NRV in 330 ml is 0.64 ppm against 0.42 ppm in the 500 ml the cube assumes. The bench test recommended at §5C is still the only way to fix the number.
- **It reinforces §5D rather than reversing it.** Huel is doing exactly what §5D warned against — putting in **the claim-threshold dose and no more**. The finding is not "15% is fine because Huel does it". The finding is "**a clear drink at a corrective riboflavin dose does not appear to exist in the UK, and the market leader in complete nutrition chose the sayable dose over the effective one.**" If V-Drop wants a meaningful B2 dose it will be doing something no one in this reference class does, and it should expect a yellow drink.

---

## 5. Iron: who includes it, at what dose, in what form, and who leaves it out

**14 of 15 include iron. AG1 is the only exclusion.** But the interesting structure is not inclusion — it is *how much, and whether it was added at all*.

| Group | Products | Iron | %NRV | Added, or intrinsic? |
|---|---|---|---|---|
| **Tablets: full correction** | H&B ABC to Z, H&B Ultra Vegan, Prowise A–Z | **14 mg** | **100%** | Added as ferrous fumarate |
| **Tablets: partial** | Forceval 12 mg (86%), Wellwoman 12 mg (86%), Wellman 6 mg (43%), Centrum 5 mg (36%) | 5–12 mg | 36–86% | Added as ferrous fumarate |
| **Meal products: not added at all** | Huel Powder 7.9 mg, Huel Black 9.0 mg, Huel Black RTD 9.0 mg, YFood 3.5 mg | 3.5–9.0 mg | 25–64% | **Intrinsic to pea/soy protein, oats and flaxseed. Iron is in the panel but NOT in the added-mineral list** |
| **Supplement drinks: token** | Huel Daily Greens 4.5 mg (32%), Greens RTD 2.4 mg (17%), **Daily A–Z 2.1 mg (15%)** | 2.1–4.5 mg | 15–32% | Added, ferrous gluconate in the powder |
| **Excluded** | **AG1** | — | — | — |

**Huel Powder and Huel Black do differ on iron, but not for the reason the brief supposed.** Black declares 9.0 mg against Powder's 7.9 mg, and **neither adds any iron whatsoever.** Both labels list the added minerals as "Potassium, Calcium, Iodine" and nothing else. Black is higher purely because it carries 40 g of protein against Powder's 30 g. The same is true of the Black RTD (which does add magnesium, phosphorus, copper, zinc, chromium — **but still not iron**) and of YFood, whose panel declares 3.5 mg of iron that appears nowhere in its mineral ingredient list.

**The finding that matters most to V-Drop, and it is a warning:**

> **Not one product in this reference class adds iron to a drink at a corrective dose. The three that add iron to a drink at all cap it at 2.1–4.5 mg (15–32% NRV). The 14 mg / 100% dose exists only in swallowed tablets.**

The most vitamin-serious drink in the UK — Huel Daily A–Z, which carries iodine, selenium and molybdenum at a full 100% NRV and vitamin D at 400% — **puts iron at exactly 15%, the claim minimum.** A brand willing to put 400 µg of folate and 150 µg of iodine in a can is not willing to put 14 mg of iron in it. Iron's metallic note in an acidic beverage is the obvious reason, and it is the one unsolved risk already recorded in `efficacy-design-basis.md` §6.

**This does not kill an iron variant, but it changes its burden of proof.** Any V-Drop "Restore"/iron cube at a meaningful dose would be **the first drink-format product in this UK reference class to attempt it**, and the fact that four well-funded brands with competent formulators all declined is evidence about feasibility, not about imagination. A 15% iron cube, conversely, is fully precedented and does nothing — the §5D trap exactly.

**AG1's exclusions, and the only stated reason found.** AG1 declares **no iron, no iodine and no vitamin D** anywhere in its UK panel. For vitamin D the reason is architectural and is stated by AG1 itself: its UK store catalogue lists **"AG1 Vitamin D3 K2 Drops … Formulated Separately in Oil Form for Higher Bioavailability"** — vitamin D is deliberately removed from the powder and sold as a separate oil-based product on a bioavailability argument. For iron, **no primary AG1 statement was obtainable** (drinkag1.com 429, help centre unreachable); the commonly-repeated rationale — that iron interferes with the absorption of other minerals and that requirements vary too much between individuals — appears only in secondary reviews and is **recorded here as unverified, not as fact.**

**AG1's D3+K2 decision is itself a transferable idea.** It is an explicit acknowledgement that **one delivery vehicle cannot optimally carry every nutrient**, and that the honest response is to move the awkward one into a different format rather than under-dose it in the main one. That is directly applicable to magnesium and iron in a cube.

---

## 6. What do they leave out, and do they say why?

| Omission | Who | Stated reason? |
|---|---|---|
| **Vitamin D** | AG1 | **Yes — sold separately as an oil-based D3+K2 drop "for higher bioavailability"** (AG1's own UK product listing). The only fully sourced exclusion rationale in the set |
| **Iron** | AG1 | No primary statement obtainable; secondary sources only. **Unverified** |
| **Iodine** | AG1; Vitabiotics Wellwoman Capsules | None stated by either |
| **Vitamin K** | Forceval, Wellman, AG1 (in ingredients, no figure in the panel) | None stated. Forceval's licence predates routine K inclusion |
| **Sodium** | Every product in the set declares salt but **not one declares a sodium figure separately** | None stated. Identical to the drinks category failure at A-087 |
| **Calcium** | Wellwoman Capsules | None stated |
| **Niacin** | Wellman (absent from the retailer panel though nicotinamide is in the ingredients) | A panel defect, not a formulation choice |
| **Choline** | Absent from all seven tablets; present in all Huel products and AG1 | None stated |
| **Potassium at any meaningful dose** | All seven tablets (1–3% NRV or absent) | None stated — mass, evidently |

**Absences with stated reasons are rare to the point of nonexistence.** One in the whole set. The reference class does not explain itself, which means the inferences above rest on the pattern of the numbers rather than on anybody's testimony — and should be held with that in mind.

**One more absence worth naming: nobody declares a sodium figure.** Fifteen complete-nutrition products, every one of them declaring salt in grams, not one declaring sodium in milligrams. A-087 recorded this as a failing of the drinks category; it is in fact universal.

---

## 7. THE SYNTHESIS — strip away the claims register, and what should be in a daily vitamin product for a UK adult?

### 7.1 The consensus, from 15 products across three formats

Dose ranges are **%NRV per day**, taking each product at its own stated servings per day. "Agreement" is judged on the seven swallowed multivitamins plus the four standalone daily supplements, since the four meal products are deliberately fractional.

| Nutrient | Carried by | Consensus daily dose | Agreement |
|---|---|---|---|
| **Vitamin D** | 14/15 | **10 µg (200% NRV)** — the NHS figure, not the NRV. Tablet median exactly 10 µg | **Strong.** The single clearest consensus in the file |
| **Vitamin C** | 15/15 | **80–100 mg (100–125%)** | **Strong** on the tablets; the greens brands run 420–425 mg and are the outliers |
| **Folate** | 15/15 | **200–400 µg (100–200%)**, increasingly as methylfolate | **Strong** |
| **Iodine** | 13/15 | **150 µg (100%)** | **Strong** |
| **Selenium** | 15/15 | **55 µg (100%)**, range 30–150 | **Strong** |
| **Zinc** | 15/15 | **10 mg (100%)** | **Strong** |
| **Vitamin B12** | 14/15 | **2.5 µg (100%)**, wide upper tail to 50 µg; methylcobalamin in half | **Strong on the floor**, no ceiling discipline |
| **Niacin, B5, B6, B1, biotin** | 14–15/15 | **100% NRV each** | **Strong** — the whole B-complex is a solved, settled 100% block |
| **Copper** | 13/15 | **1 mg (100%)** | Moderate — range 0.2–2 mg |
| **Manganese** | 15/15 | **2 mg (100%)** | Moderate — range 0.3–3 mg |
| **Chromium** | 15/15 | **40 µg (100%)** | Moderate — Forceval is an outlier at 200 µg |
| **Molybdenum** | 15/15 | **50 µg (100%)** | **Strong**, and it is in every single product |
| **Vitamin A** | 13/15 | **800 µg (100%)** | Moderate; AG1 and H&B Ultra Vegan deliberately lower (250–550 µg), pregnancy warnings attached |
| **Vitamin E** | 15/15 | **12 mg (100%)** | Moderate; range 3–32 mg |
| **Vitamin K** | 12/15 | **75 µg (100%)**, MK-7 in the premium tier | Moderate — three products omit it |
| **Riboflavin** | 15/15 | **1.4 mg (100%) if swallowed; 0.21–0.43 mg (15–31%) if visibly drunk** | **Divergent, and the split is by format, not by philosophy** |
| **Iron** | 14/15 | **14 mg (100%) if a tablet; 2.1–4.5 mg (15–32%) if a drink; 0 if AG1** | **Divergent, and the split is by format** |
| **Magnesium** | 15/15 | **57–100 mg (15–27%)** — nobody exceeds 27% in any format | **Unanimous, and unanimously a partial dose** |
| **Calcium** | 13/15 | **120–260 mg (15–33%)** | Unanimous partial |
| **Potassium** | 9/15 | **Absent or trivial in tablets (1–3%); 375–940 mg (19–47%) only in meal-sized formats** | Divergent by format |
| **Phosphorus, chloride** | 11/15, 6/15 | Present only where the format is large | Not a supplement decision |

### 7.2 The consensus stated as one sentence

> **A daily vitamin product for a UK adult should carry the full B-complex, vitamins A, C, D, E and K, plus zinc, selenium, iodine, copper, manganese, chromium and molybdenum, each at approximately 100% NRV — with vitamin D at 10 µg rather than the legal 5 µg; it should carry magnesium, calcium and potassium at whatever partial dose the format permits and make no claim to correct them; and it should treat iron and riboflavin as format-dependent decisions rather than defaults.**

That is a 20-nutrient core. **Notice what it does not include:** no botanicals, no adaptogens, no amino acids, no CoQ10 — those appear only as differentiators in AG1, Wellman and Huel Daily Greens, always undosed or under-dosed, and never as part of the completeness argument.

### 7.3 Which parts a 2.0 g effervescent cube could and could not deliver

**Method (ESTIMATE, stated so the arithmetic can be checked).** A 2.0 g cube is 50–75% acid and carbonate before anything else (A-066), leaving **roughly 500–1,000 mg** for flavour, sweetener, colour, binder, lubricant and actives — realistically **300–500 mg of active payload**. Salt-mass multipliers below use the A-038 method already logged in this project; a formulator sets the real figures.

**Deliverable at full consensus dose, comfortably (FACT on the doses, ESTIMATE on the masses):**

| Nutrient | Consensus dose | Approx. mass as a permitted form | Verdict |
|---|---|---|---|
| Vitamin D | 10 µg | ~50 mg as a cold-water-dispersible powder | **Yes** |
| Iodine | 150 µg | ~0.2 mg as potassium iodide | **Yes, trivially** |
| Selenium | 55 µg | ~0.1 mg as selenite, more as selenomethionine | **Yes, trivially** |
| Folate | 200–400 µg | <1 mg as calcium-L-methylfolate | **Yes, trivially** |
| B12 | 2.5 µg | trivial | **Yes** |
| B1, B2, B3, B5, B6, biotin | 100% NRV each | ~25 mg combined | **Yes** |
| Vitamin C | 80 mg | 80 mg | **Yes** |
| Zinc | 10 mg | ~50 mg as bisglycinate, ~12 mg as oxide | **Yes** |
| Copper | 1 mg | ~5 mg as bisglycinate | **Yes** |
| Manganese | 2 mg | ~10 mg | **Yes** |
| Chromium, molybdenum | 40 µg, 50 µg | trivial | **Yes** |
| Vitamin K (MK-7) | 75 µg | ~5 mg as a 1% MK-7 preparation | **Yes** |
| Vitamin A | 800 µg | ~10 mg as a beadlet | **Yes**, though see the caution below |
| Vitamin E | 12 mg | ~30 mg as a water-dispersible acetate | **Yes** |
| **Running total** | | **roughly 280–300 mg** | **Fits, with room** |

**So the cube can deliver 17 of the 20 consensus nutrients at 100% NRV inside one 2.0 g unit.** That is a stronger result than §3 of `efficacy-design-basis.md` claimed, because it now includes copper, manganese, chromium, molybdenum, K and E — the nutrients that separate a "vitamin drink" from a genuine A–Z.

**Cannot deliver, and the reference class proves it is not the cube's fault:**

| Nutrient | Consensus | Best in the entire reference class | Cube verdict |
|---|---|---|---|
| **Magnesium** | 15–27% NRV — **nobody does better** | 100 mg / 27% (Centrum tablet, Huel 500 ml RTD) | **A cube can reach the low end of the category range (15–20%) and no format on the UK market reaches even a third of the NRV.** Do not promise correction — but stop calling it a cube failure |
| **Calcium** | 15–33% | 260 mg / 33% (Huel Powder, 100 g) | **No.** Token only |
| **Potassium** | absent-to-47%, and absent from every tablet | 940 mg / 47% (500 ml RTD) | **No.** Every swallowed multivitamin in the UK gives up on potassium entirely; a cube is in good company |
| **Phosphorus, chloride** | format artefacts | — | **Not a supplement decision** |

**And the two that are decisions rather than constraints:**

- **Iron.** Mass is not the problem — 14 mg as bisglycinate is ~70 mg and fits. **Taste is.** The evidence is that four brands capable of solving it chose not to: the maximum iron in any drink here is 4.5 mg. **A cube can physically carry a 100% iron dose; the reference class suggests nobody has made one that tastes acceptable.** This should be a bench question before it is a proposition question.
- **Riboflavin.** Mass is not the problem either. **Colour is**, and the reference class splits on exactly that line: 100–357% when swallowed, 15–31% when visible in a glass. **A cube cannot have both a corrective B2 dose and clear water.** That remains the deliberate choice §5B set out, and this data says the market has consistently chosen clear water.

### 7.4 The one-line verdict

> **A 2.0 g cube can be a genuinely complete daily multivitamin by the standards of this reference class — 17 of 20 consensus nutrients at 100% NRV, including every nutrient the UK drinks category omits — and it will be exactly as incapable of delivering magnesium, calcium and potassium as Centrum, Forceval, AG1 and Huel are. The cube's real, format-specific constraints are two, and they are taste constraints, not mass constraints: iron and riboflavin.**

---

## 8. What I could not verify

1. **AG1's own UK panel.** Recovered only via Holland & Barrett; drinkag1.com returned 429 throughout. Marked med confidence. The sachet mass is not on the H&B listing.
2. **AG1's stated reason for excluding iron.** Secondary sources only. Not used as fact.
3. **Vitabiotics Wellman's niacin and B12.** The retailer panel omits niacin and prints B12 as "9.0mg". Both cells left empty. A pack photograph would settle it.
4. **Forceval's vitamin A in µg RE** — declared in IU as β-carotene with no stated conversion factor. Left empty.
5. **Forceval's selenium form** — the SmPC names the element but not the salt.
6. **Jimmy Joy, Soylent, Boots own-label A–Z, Tesco/Sainsbury's/Asda own-label A–Z.** Not obtained: client-side rendering, no UK store, or 403.
7. **Whether the riboflavin/colour inference is correct.** It is an inference from a very consistent pattern, not from any brand's statement. A bench test remains the only way to fix the visibility threshold.
8. **Any of the source-form bioavailability claims.** This file records which forms brands buy. It does not establish that bisglycinate outperforms oxide in a human, and nothing here should be read as evidence that it does.

---

## CSO verification note, 2026-09-22

**I could not independently reproduce the Huel Daily A–Z panel at source.** WebFetch returned the product page without the nutrition table (it sits behind a "Nutrition & Ingredients" control and in back-of-pack images), and curl returned a soft 404 with no nutrient names in the raw HTML. **The figures below are therefore carried on the researching agent's read, not on a second confirmation, and should be verified before they anchor a formulation decision.**

**However, the internal arithmetic strongly supports their authenticity**, and it also produces the sharpest finding in this document. Computed against the legal NRVs:

| | Huel Daily A–Z, per 330 ml can | %NRV |
|---|---|---|
| Vitamin D | 20 µg | **400%** |
| Folate | 400 µg | **200%** |
| Vitamin K | 120 µg | 160% |
| Vitamin E | 15 mg | 125% |
| Vitamin B6 | 1.7 mg | 121% |
| Vitamin A | 900 µg | 112% |
| Vitamin C | 90 mg | 112% |
| Thiamin (B1) | 1.2 mg | 109% |
| Niacin · B5 · Biotin · B12 | — | 100% each |
| **Selenium** | **55 µg** | **100%** |
| **Iodine** | **150 µg** | **100%** |
| Potassium | 470 mg | 23.5% |
| Magnesium | 80 mg | 21.3% |
| Phosphorus | 125 mg | 17.9% |
| Calcium | 130 mg | 16.3% |
| **Iron** | **2.1 mg** | **15.0%** |
| **Zinc** | **1.5 mg** | **15.0%** |
| **Manganese** | **0.3 mg** | **15.0%** |
| **Chromium** | **6 µg** | **15.0%** |
| **Riboflavin (B2)** | **0.21 mg** | **15.0%** |

**Five nutrients landing on exactly 15.0% of their NRV is not an accident, and it is not the signature of invented data. It is the signature of deliberate dosing to the claim floor** — the same behaviour this project identified in Waterdrop's ladder, now visible in a brand whose entire proposition is nutritional completeness.

### The pattern, and what it isolates

**Every one of the 13 vitamins sits at 100–400% NRV — except riboflavin, alone, at exactly 15%.**

**Mass cannot explain it.** Riboflavin's NRV is 1.4 mg. Thiamin's is 1.1 mg and Huel doses it at 109%. Vitamin B6's is 1.4 mg — identical to riboflavin's — and Huel doses it at 121%. **Three vitamins of the same order of mass; two at full dose, one at the legal floor.** There is no cost or formulation-space argument available.

**OPINION, and it is the strongest available evidence on the question:** Huel is a company with serious formulation capability, no claims-led incentive to stop at 15%, and a product sold explicitly on completeness. It took twelve vitamins to 100% or beyond and left riboflavin at the floor. **The most plausible remaining explanation is the one this project hypothesised — riboflavin's colour — and it is now supported by a formulator's revealed choice rather than by our inference.**

**The minerals show a second, cleaner pattern: the two microgram minerals go to 100% (selenium 55 µg, iodine 150 µg) and every mineral with meaningful mass sits at 15–24%.** That is a mass constraint, and it holds in a 330 ml can — a format with none of the cube's limitations.

### What this does to A-066

**It substantially rehabilitates the cube.** A-066 recorded that a 2.0 g cube cannot carry magnesium, calcium or potassium at a meaningful dose, and treated that as a format failure. **This benchmark shows 15 of 15 complete-nutrition products carry magnesium and not one exceeds 27% NRV — including swallowed tablets, which have no taste or solubility constraint at all, and a 500 ml Huel RTD.** Forceval, a prescription-grade product, sits at 8%.

**So the magnesium ceiling is a property of the mineral, not of the cube.** The cube is not losing to these formats on magnesium; nobody wins on magnesium. The same holds for calcium (33% ceiling) and potassium (1–3% in tablets). **A-066 should be read as a category fact rather than a format weakness.**

### And what it leaves as genuinely cube-specific

Two constraints, and both are taste rather than mass: **iron** and **riboflavin**. Notably, **Huel hit both of them too** — iron at 15% and riboflavin at 15% in a can. **Four capable brands declined to solve the iron problem in a drink.** That is worth weighing before assuming a formulator will solve it for us.

