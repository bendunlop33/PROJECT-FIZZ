# Opportunity Areas — Benefit Territories, Claims Feasibility, Graveyard, Defensibility

**Owner:** `market-mapper` (territory/whitespace layer) · **Date:** 2026-09-22 · **Geography:** Great Britain
**Commissioned by:** CSO, under `docs/market-mapping-brief.md`
**Scope discipline:** no pricing, no price ladder, no market sizing, no TAM/SAM, no forecasts, no quantified opportunity. Opportunities here are **described and evidenced, never sized.** Prices seen during research have been deliberately omitted.
**Companion work:** another agent owns the product-by-product supply-side panel (`research/cube-category-map.md`, `research/competitors.csv`). This document is the layer above it and does not duplicate it.

> **The question this half answers:** of the benefit territories the UK functional-drink market uses, **which are open to a more functional, vitamin-led effervescent cube sold D2C in GB** — and which are open only because nothing lawful can be said in them.

---

## 0. Method and evidence base

**Primary source for all claims work.** The GB Nutrition and Health Claims register spreadsheet (version **19 May 2026**) was **downloaded and parsed row by row** for this task, not read from search summaries.
Source: https://www.gov.uk/government/publications/great-britain-nutrition-and-health-claims-nhc-register → `great-britain-nutrition-and-health-claims-spreadsheet-19-may-2026.xlsx`. Checked 2026-09-22.

**FACT.** The file contains 2,555 claim rows. Status breakdown as parsed: **267 authorised for GB** (261 "Authorised for use in Great Britain" + 6 asterisked, authorised on proprietary data), **2,082 non-authorised**, 206 blank continuation rows. This **confirms the 267 figure recorded at A-009** independently.

Every "authorised wording" string quoted below was taken verbatim from that spreadsheet's `Claim` column, and every condition from its `Conditions of use` column. Where a claim is described as RED, it is because a keyword sweep of both the authorised and non-authorised sets returned **no** authorised entry for that health relationship.

**Brand occupancy evidence.** Direct page reads where the domain permitted. Failures recorded honestly:

| Domain | Result 2026-09-22 |
|---|---|
| `gov.uk`, `assets.publishing.service.gov.uk` | **Readable.** Register spreadsheet downloaded. |
| `find-and-update.company-information.service.gov.uk` | **Readable.** Company statuses read directly. |
| `tonichealth.co` | **Readable via rendering fetch.** Raw `curl` hits a bot interstitial; `products.json` blocked. |
| `vitaminwell.com` | **Readable via raw fetch with a browser user-agent** (product pages). The `/our-products/` index is behind a bot check. |
| `en.waterdrop.com` | **Readable.** |
| `web.archive.org` | **Readable** over HTTPS (the `http://` CDX endpoint is blocked by egress policy). |
| `berocca.co.uk` | **Refused at its own edge**, HTTP 403 with an explicit anti-bot message, for both WebFetch and browser-UA curl. Berocca facts below are therefore search-summary grade and marked accordingly. |
| `hollandandbarrett.com` | Returns a shell page; product content is client-rendered and was not retrieved. |
| `ocado.com`, `groceries.morrisons.com`, `phizz.com` | 403 / 403 / 522. |

---

## 1. Benefit territory map

Eleven territories. For each: GB occupancy split **LIQUID/RTD** vs **DRY** (tablet, cube, sachet, powder), the authorised GB wording if any, and a claims RAG.

**RAG definitions**
- **GREEN** — authorised nutrient claims exist, are cheap to satisfy at 15% NRV, and the gating nutrient masses fit inside a ~2.0 g cube (A-066).
- **AMBER** — authorised, but conditioned, awkward, restricted to a sub-population, or gated on a nutrient mass that is hostile to the cube format.
- **RED** — no authorised route. Brands operating in the territory are relying on on-hold claims, implication, or non-compliance.

### 1.1 The table

| # | Territory | LIQUID / RTD occupancy in GB | DRY occupancy in GB | Authorised GB wording | RAG |
|---|---|---|---|---|---|
| 1 | **Immunity / defence** | Vitamin Well **Defence** (direct read) | Heavy: Tonic Health **Immunity + Vitality** effervescent tablet (direct read); Berocca **Immuno** (search); Phizz **Daily Immune+** (search); Boots / Superdrug / H&B effervescent multivitamin and vitamin C (search) | 11 nutrients each carry "**[Nutrient] contributes to the normal function of the immune system**": copper, folate, iron, selenium, vitamin A, B12, B6, C, D, zinc (+ a children's vitamin D variant). All at 15% NRV. Plus one conditioned: "Vitamin C contributes to maintain the normal function of the immune system during and after intense physical exercise" | **GREEN** |
| 2 | **Energy / alertness** | Vitamin Well **Awake** (direct read) | Heavy: Berocca / Berocca **Boost** (search); Tonic **Energy + Hydration** (direct read); Waterdrop **Microenergy** / "Hydration + Energy" (direct read) | **Nine** nutrients carry the tiredness claim: folate, iron, **magnesium**, niacin, pantothenic acid, riboflavin, B12, B6, vitamin C. Eight read "contributes to **the** reduction of tiredness and fatigue"; **magnesium alone reads "contributes to *a* reduction of tiredness and fatigue"** — verified verbatim in the register, and a real artwork trap. Plus "…contributes to normal energy-yielding metabolism" across biotin, calcium, copper, iodine, iron, magnesium, manganese, niacin, pantothenic acid, phosphorus, riboflavin, thiamine, B12, B6, C | **GREEN** for "tiredness"; **RED** for "alertness" (see §2.2) |
| 3 | **Focus / cognition** | Vitamin Well **Awake** (direct read); nootropic RTDs (Brite, Adapt, Neutonic — search only, low confidence) | Tonic **Focus + Mind** effervescent tablet (direct read); Berocca **Boost** (search); Waterdrop Microenergy is merchandised as "**Fix your focus** with natural caffeine" (direct read) | "**Pantothenic acid contributes to normal mental performance**" — conditioned only on SOURCE OF, i.e. 0.9 mg. Cognitive function: iodine, iron, zinc. Psychological function: biotin, folate, magnesium, niacin, thiamine, B12, B6, C | **GREEN but narrow** — see §2.3 |
| 4 | **Hydration / electrolytes** | Vitamin Well **Hydrate**; sports RTDs | Heavy: Waterdrop **Microlyte** ("a sugar-free electrolyte drink with 9 vitamins and zinc", direct read); Phizz; Nuun; SIS; Humantra | **There is no authorised hydration claim available to a water enhancer.** See §2.4 — this is the single most consequential finding in the document | **RED** for a zero-sugar cube; AMBER only via magnesium |
| 5 | **Recovery** | Vitamin Well **Recover** / **Reload** | Tonic **Rest + Recover** (direct read); sports effervescents | "Magnesium contributes to normal muscle function"; "Vitamin D contributes to the maintenance of normal muscle function"; "Potassium contributes to normal muscle function"; creatine and protein claims | **AMBER** — every route is mass-hostile (§2.5) |
| 6 | **Sleep / relax** | **None found in GB RTD.** TRIP / Goodrays occupy "calm" adjacent (search only, low confidence) | **One**: Tonic **Rest + Recover** effervescent tablet (direct read) | Melatonin carries two authorised claims — **but melatonin is a prescription-only medicine in the UK and is not permitted in food supplements.** Everything else refused | **RED** |
| 7 | **Beauty (skin / hair / nails)** | Collagen drinks (Skinade, Gold Collagen, Absolute Collagen — not verified this session, **UNVERIFIED**) | H&B **Bovine Collagen effervescent**; Bioglan **Beauty Collagen effervescent**; Vitl **Collagen & Vitamin C effervescent** (all search-level; H&B pages are client-rendered and were not read) | **14 authorised claims** (CSO recount, 2026-09-22 — the 23 originally recorded here counted the five *non-beauty* vitamin C collagen claims for bones, cartilage, gums, teeth and blood vessels, which are structural rather than cosmetic, plus biotin’s mucous-membranes claim; the territory verdict is unaffected), all at 15% NRV: biotin (hair / skin), zinc (hair / nails / skin), selenium (hair / nails), copper (hair pigmentation / skin pigmentation), niacin (skin), riboflavin (skin), vitamin A (skin), iodine (skin), and six "Vitamin C contributes to normal collagen formation for the normal function of …" claims | **GREEN** — the richest mass-feasible set |
| 8 | **Gut / digestion** | Symprove, Yakult, Actimel, Bio-tiful (not verified this session, **UNVERIFIED**) | **None found in GB in effervescent or cube form.** All effervescent probiotic results were Indian or US products | Authorised routes exist but are all dose-prohibitive: chicory inulin, rye fibre, wheat bran fibre, lactulose, lactitol, dried prunes, lactase, live yoghurt cultures, activated charcoal (1 g). "Calcium contributes to the normal function of digestive enzymes" (120 mg) and "Chloride contributes to normal digestion by production of hydrochloric acid in the stomach" are technically available and practically useless | **RED** |
| 9 | **Women's health** | None found | **None found in GB effervescent or cube form.** Menopause and women's VMS in GB is capsules and tablets (Vitabiotics Menopace, Health & Her, Boots and Superdrug own-label) | "Iron contributes to normal formation of red blood cells and haemoglobin"; "Iron contributes to the reduction of tiredness and fatigue"; "Vitamin B6 contributes to the regulation of hormonal activity"; "Vitamin C increases iron absorption"; "Folate contributes to maternal tissue growth during pregnancy" (restricted to pregnant women); Art. 14 folic acid / neural-tube-defect at 400 µg with a mandatory accompanying statement | **AMBER** — menopause, PMS and "hormone balance" are **RED** and medicinal-adjacent (A-046) |
| 10 | **Stress / mood** | TRIP, Goodrays (search only, low confidence) | Natural Vitality **CALM** magnesium drink mix, sold in the UK through third-party retailers and marketed as "The Anti-Stress Drink Mix" (search). **No GB effervescent-cube product found in this territory** | **None.** A sweep of the authorised set for "stress" returns only "**oxidative** stress" — a chemistry claim, not a psychological one. Mood, relaxation, calm, tension and cortisol claims are all in the non-authorised set | **RED** |
| 11 | **Antioxidant / longevity** | Vitamin Well **Antioxidant** | **Not occupied as a named territory in GB dry format** — delivered as an attribute inside other products, never as the proposition | 8 claims: "**[Nutrient] contributes to the protection of cells from oxidative stress**" — copper, manganese, riboflavin, selenium, vitamin C, vitamin E, zinc (+ olive oil polyphenols). All at 15% NRV | **GREEN** for "antioxidant"; **RED** for longevity / anti-ageing |

### 1.2 The key output — where liquid is served and dry is not

| Territory | Liquid served? | Dry served? | Intersection verdict |
|---|---|---|---|
| Gut / digestion | Yes | **No** | Open in dry — **and RED on claims** |
| Women's health | Weakly | **No** | Open in dry — AMBER on claims |
| Stress / mood | Yes | **Barely** (one imported powder) | Open in dry — **RED on claims** |
| Sleep | Weakly | **Barely** (one product) | Open in dry — **RED on claims** |
| Antioxidant | Yes (Vitamin Well) | **Not as a named territory** | Open in dry — GREEN on claims, but no consumer entry point |
| Beauty | Yes | Yes, but **collagen-led and mass-market**, not vitamin-led or premium | **Partially open** — GREEN on claims |
| Immunity | Yes | Yes, heavily | Closed |
| Energy | Yes | Yes, heavily | Closed |
| Focus | Yes | Yes | Closed on occupancy, **open on compliance** (§2.3) |
| Hydration | Yes | Yes, heavily | Closed, and **RED on claims** (§2.4) |
| Recovery | Yes | Yes | Closed |

**OPINION.** Read that table honestly and it says something uncomfortable: **the four territories that are genuinely empty in dry format are empty in near-perfect correlation with being unclaimable in GB.** Gut, stress, sleep and (for its interesting half) women's health are the four biggest dry-format holes, and three of them are RED. That correlation is itself the finding. It is much more likely that GB claims law has shaped the category than that four separate territories were simply overlooked.

---

## 2. The claims-feasibility filter

> **CSO QUALIFICATION, 2026-09-22 (user direction).** Read every RAG rating below as **"what can lawfully be SAID here"**, not as "whether this territory can be entered". An ingredient with no authorised claim may still be included and declared by name and quantity; `research/claims-library.md` §5 sets out exactly that for each active. A **RED** territory is therefore one a brand can enter while saying nothing functional — not one that is closed. **Two exceptions where RED really does mean closed, and they are not claims issues at all:** novel-food status (lion's mane concentrated extracts, paraxanthine, theacrine) and the cordyceps stop-sale both govern whether the ingredient may be **sold**, and silence does not cure them. **And one trap that cuts the other way: a benefit-led variant name is itself a claim (A-074)**, so the freedom to include an unclaimed ingredient is forfeited the moment the product is called "Focus" or "Calm".


This is a filter, not a footnote. A territory is only an opportunity if it can be legally said.

### 2.1 What makes a territory GREEN, cheaply

**FACT.** All vitamin and mineral health claims in the GB register are conditioned on the same gate — the product must be at least a "SOURCE OF" the nutrient, i.e. ≥15% NRV per daily portion. Verified verbatim in the `Conditions of use` column across the register: the standard string is "The claim may be used only for food which is at least a source of [nutrient] as referred to in the claim SOURCE OF [NAME OF VITAMIN/S] AND/OR [NAME OF MINERAL/S] as listed in the Annex to Regulation (EC) No 1924/2006."

**FACT, and this is what makes some territories cube-feasible and others not.** 15% NRV in mass terms: biotin 7.5 µg · vitamin B12 0.375 µg · vitamin D 0.75 µg · selenium 8.25 µg · folate 30 µg · iodine 22.5 µg · copper 0.15 mg · riboflavin 0.21 mg · B6 0.21 mg · pantothenic acid 0.9 mg · zinc 1.5 mg · iron 2.1 mg · niacin 2.4 mg · vitamin C 12 mg — versus **magnesium 56.25 mg**, **calcium 120 mg**, **potassium 300 mg**.

**ESTIMATE.** Sum the first fourteen and the gating mass is under 20 mg before excipients. Sum in magnesium, calcium or potassium and you are into hundreds of milligrams. Per A-066, a 2.0 g cube leaves roughly 0.5–1.0 g for everything. **So the territories whose claims rest on vitamins, zinc, selenium, copper and iodine are format-compatible; the territories whose claims rest on magnesium, calcium and potassium are not.** That single line separates GREEN from AMBER more reliably than commercial attractiveness does.

### 2.2 "Energy" is GREEN; "alertness" is RED — and two major brands are on the wrong side of it

**FACT.** Vitamin Well's own Awake page states that the drink "contains caffeine which contributes to increased alertness and improves concentration" (https://www.vitaminwell.com/product/awake/, read 2026-09-22).

**FACT.** No caffeine claim appears in the GB authorised set. The register's authorised rows contain none; the non-authorised set contains "Caffeinated carbohydrate containing energy drinks — Enhances mental performance, reaction time, alertness, focus and memory." `research/claims-library.md` §5.1 records the reason: EFSA gave positive opinions but the European Parliament vetoed the authorising regulation, so the claims were never adopted.

**FACT (search-grade, `berocca.co.uk` refused direct reads).** Berocca Boost is described in retailer and brand copy as containing "caffeine, plus guarana… caffeine helps to increase your alertness and concentration."

**OPINION.** Two of the largest brands in the two anchor categories are trading on an unauthorised claim. That is not a licence for V-Drop to copy them; it is evidence that the word consumers actually buy on — *alertness* — cannot be bought lawfully, and that compliant competitors are at a communication disadvantage until enforcement arrives.

### 2.3 "Focus" is a single authorised sentence, and everyone in the territory says more than it

**FACT, verbatim from the register:** "**Pantothenic acid contributes to normal mental performance**", conditioned only on SOURCE OF — 0.9 mg. This is the closest authorised GB wording to "focus", and it costs essentially nothing in mass or money.

**FACT.** Tonic Health's Focus + Mind is an effervescent tablet whose actives are lion's mane 1,500 mg, L-tyrosine 250 mg, rhodiola rosea 600 mg, choline bitartrate 261 mg and niacin 16 mg (100% NRV), and whose page sells on "Boost mental focus and clarity", "Stay sharp under pressure", "Enhance memory and learning" and "Sustain mental energy without caffeine" (https://tonichealth.co/products/focus-and-mind-nootropic-drink, read 2026-09-22).

**FACT.** Lion's mane, rhodiola, L-tyrosine and choline carry **no** authorised GB cognitive claim. Choline's three authorised claims are lipid metabolism, homocysteine metabolism and liver function, all conditioned on ≥82.5 mg (`research/claims-library.md` §5.7, §5.3). Niacin's authorised cognitive-adjacent wording is "normal psychological function", not memory or learning.

**OPINION.** The focus territory in GB dry format is occupied, but occupied on wording that the register does not support. The lawful version of a focus proposition is a much quieter product than the one currently winning.

### 2.4 Hydration cannot be claimed by a water enhancer. This is the biggest finding in this document.

**FACT.** The register contains exactly two authorised "water" claims — "Water contributes to the maintenance of normal physical and cognitive functions" and "Water contributes to the maintenance of normal regulation of the body's temperature". Both carry the condition, verbatim: "*The claim may be used only on water complying with Directives 2009/54/EC and/or 98/83/EC*", plus a requirement to tell the consumer that at least 2.0 L of water from all sources is needed. **Those directives are natural mineral water and drinking water. The claim attaches to water itself, not to a flavoured, sweetened enhancer dropped into it.**

**FACT.** The two carbohydrate-electrolyte solution claims — endurance performance, and "enhance the absorption of water during physical exercise" — carry conditions, verbatim, of 80–350 kcal/L from carbohydrate, ≥75% of that energy from high-glycaemic carbohydrate, 460–1,150 mg/L sodium, and osmolality 200–330 mOsm/kg. **A zero-sugar cube cannot meet them and would not want to.**

**FACT.** "Magnesium contributes to electrolyte balance" is the only authorised claim in the entire GB register that comes near the concept, and it needs 56.25 mg of elemental magnesium.

**FACT.** A keyword sweep for "hydration" across the authorised set returns **zero** relevant entries. The word appears only in the non-authorised set, mostly attached to *skin* hydration.

**OPINION, and it should be read twice.** Hydration is the territory this format most obviously belongs to, the one Waterdrop owns, and the one the phrase "water enhancer" implies. **It is also the one territory in the whole map where nothing lawful can be said by this product at all.** Every hydration brand in GB is therefore competing on factual composition statements, imagery and implication — not on claims. A brand whose differentiator is being *more clinical* gains nothing here, because the register gives it nothing to be clinical with.

### 2.5 Recovery is AMBER for arithmetic reasons

**FACT.** Every authorised recovery route is mass- or format-hostile: magnesium muscle function needs 56.25 mg; potassium muscle function needs 300 mg; creatine's two claims are conditioned on a daily intake of 3 g; protein's muscle-mass claims need protein; the carbohydrate muscle-recovery claim needs a carbohydrate load. **Only "Vitamin D contributes to the maintenance of normal muscle function" (0.75 µg) is cheap in mass.** A 2.0 g zero-sugar cube can carry a recovery *claim*, but essentially only that one.

### 2.6 Sleep, stress, gut: attractive and mute

**FACT — sleep.** The register authorises "Melatonin contributes to the reduction of time taken to fall asleep" at 1 mg and "Melatonin contributes to the alleviation of subjective feelings of jet lag" at 0.5 mg. **Melatonin is a prescription-only medicine in the UK regulated by the MHRA and is not permitted in food supplements** (https://en.wikipedia.org/wiki/Melatonin_as_a_medication_and_supplement, https://camdenmedicals.co.uk/supplements/melatonin/, checked 2026-09-22 — search-grade; a food-law consultant should confirm the MHRA instrument). Tryptophan and L-theanine sleep claims are in the non-authorised set. **So GB has two authorised sleep claims and no lawful way for a food to use either.**
Corroboration from the market: Tonic Health's sleep effervescent advertises "**no melatonin**" as a feature (https://tonichealth.co/products/rest-and-recover, read 2026-09-22) — a brand telling you, on pack, that the only claimable sleep ingredient is unavailable.

**FACT — stress.** Zero authorised claims, and the evidence is stronger than first recorded here (CSO verification against the parsed register, 2026-09-22). Of the 267 GB-authorised claims, **eight** mention "stress" and **all eight are "oxidative stress"** — a chemistry claim, not a psychological one. More tellingly, across the full register **30 rows claim a non-oxidative stress or mood benefit and every single one is Non-authorised**, and a sweep for "mood" across the authorised set returns **zero**. The territory is not merely unserved; it has been applied for repeatedly and refused every time. Non-authorised entries include L-theanine ("Stress relief", "help relaxation without drowsiness"), taurine, arginine ("régulateur du cortisol"), rooibos, cocoa, flax, 5-HTP and L-tryptophan. Ashwagandha has on-hold entries only, is under live FSA/COT safety review, and sits squarely in the psychological-function territory the CJEU singled out in *Novel Nutriology* (`research/claims-library.md` §2.9, §4.2, §4.3).

**FACT — gut.** The authorised gut set is bulk laxatives, fibres, enzymes and charcoal, at doses no cube can carry. **Every probiotic claim in the register is non-authorised** — the sweep returned 81 gut-related and 184 immune-related refusals dominated by *Lactobacillus* and *Bifidobacterium* strains.

**OPINION.** These three are the classic trap shape: high consumer salience, visible liquid activity, an obvious dry-format hole, and no lawful sentence to put on the pack. A brand entering them either says nothing useful or says something it cannot defend.

---

## 3. Graveyard check

Scepticism is the default (A-050). Two findings here are load-bearing.

### 3.1 Waterdrop tried the benefit-named range in GB and withdrew it — between January and June 2024

This is the most important evidence in this document, and it is directly checkable.

**FACT.** Archived captures of Waterdrop's UK Microdrink collection page show a **benefit-named** range:
- 2023-03-22 capture: variants **BOOST, FOCUS, RELAX, GLOW, YOUTH, FLAIR, ZEN, LOVE, CLEAN, VIBE, BREEZE, SKY, SNOW** (https://web.archive.org/web/20230322155930id_/https://en.waterdrop.com/collections/microdrinks)
- 2024-01-27 capture: still shows BOOST, FOCUS, RELAX, GLOW, YOUTH, LOVE, ZEN (https://web.archive.org/web/20240127125229id_/https://en.waterdrop.com/collections/microdrinks)

**FACT.** By the 2024-06-16 capture those names are **gone**. The navigation instead describes the ranges functionally — "Microdrink — For daily hydration", "Microlyte — For during & post exercise", "Microenergy — For natural energy boost" — and products are named COLA, LEMON-LIME and so on (https://web.archive.org/web/20240616182051id_/https://en.waterdrop.com/collections/microdrinks). The 2025-05-19 and 2026-06-09 captures are the same shape.

**FACT.** The live GB site today carries no benefit-named Microdrink variant. The collection is headed "**Hydration + Vitamins**" and the three platforms are "Hydration + Vitamins", "Hydration + Energy" and "Hydration + Electrolytes". Products are flavour names: COLA, APPLE, LEMON-LIME, ORANGE, ICE TEA PEACH, BLACKCURRANT, GRAPEFRUIT, PASSION FRUIT and so on (https://en.waterdrop.com/collections/microdrinks, read 2026-09-22).

**OPINION, stated plainly.** The incumbent in exactly the proposed format ran exactly the proposed architecture — a lifestyle-benefit-named cube range — for at least a year in the UK, and replaced it with flavour-first naming under three functional platforms. **That is wreckage in the space, left by the strongest player in it.** It does not prove the architecture cannot work. It does mean the proposition can no longer be described as untried, and the burden of proof has moved: anyone proposing it now must explain what they know that Waterdrop learned and rejected.

**Note the specific casualties.** RELAX, ZEN and GLOW were the stress/calm and beauty variants. Those are two of the territories §1.2 identifies as "open in dry". They are open in dry **because Waterdrop closed them**.

### 3.2 The Vitamin Well architecture already exists in GB dry format — Tonic Health

**FACT.** Tonic Health sells a four-variant, benefit-named **effervescent tablet** range in GB: **Energy + Hydration**, **Immunity + Vitality**, **Focus + Mind**, **Rest + Recover** — alongside gummies, a creatine powder and infant drops (https://tonichealth.co/collections/all and the four product pages, read 2026-09-22). Direct reads confirm effervescent-tablet format and full active panels, including Immunity + Vitality at vitamin C 1,000 mg, vitamin D3 50 µg, vitamin A 1,200 µg, zinc 10 mg, selenium 100 µg plus reishi and cranberry; and Energy + Hydration at a full B-complex plus vitamin C 600 mg and four electrolytes.

**OPINION.** A-067 framed the whitespace as "Waterdrop's format carrying Vitamin Well's functional seriousness". Tonic Health is already close to that description in GB, at higher doses than either anchor brand. The gap is therefore not *format × benefit architecture*; at most it is *format × benefit architecture × design/premium positioning*. That is a much thinner claim, and it is a brand claim rather than a category one.

### 3.3 Other wreckage

**FACT.** COMMON, a UK functional drinks brand founded 2021 in Haywards Heath selling CBD and nootropic-mushroom drinks for relaxation, recovery and cognitive function, **ceased operations in February 2026** (https://www.cbinsights.com/compare/common-3-vs-overhang-drinks, checked 2026-09-22 — search-grade, not a primary filing).

**FACT.** Vitamin Well AB's UK establishment registration (FC041813) was **closed on 20 June 2025**, having opened 1 July 2024 (https://find-and-update.company-information.service.gov.uk/company/FC041813, read 2026-09-22). **However, VITAMIN WELL LIMITED (10821384) is Active**, incorporated 2017, SIC 46341 wholesale of soft drinks, with accounts filed to 31 December 2025 (https://find-and-update.company-information.service.gov.uk/company/10821384). **So this is a corporate restructuring, not a market exit.** Recorded here so that nobody later mistakes the closed branch for a withdrawal.

**FACT.** WATERDROP MICRODRINK LTD (12025511) is **Active**, accounts filed to 31 December 2024 (https://find-and-update.company-information.service.gov.uk/company/12025511, read 2026-09-22). No evidence of a GB retreat.

**Not found.** Despite targeted searching, I could not find a discontinued GB effervescent or cube launch in the gut, stress or women's-health territories. **That is an absence of evidence, not evidence of absence** — small D2C failures leave little public trace. The honest reading is that those territories were probably never attempted in this format in GB, which is consistent with the claims-law explanation in §1.2 rather than with a demand explanation.

---

## 4. Defensibility

Taking the three strongest candidates from §5 and asking Q4 directly: what stops Waterdrop, and what stops Bayer/Berocca, Vitabiotics, Holland & Barrett or a supermarket own-label?

**The starting position, from A-009 and A-045:** the authorised claims are conditioned at 15% NRV, which is a few pence of commodity nutrient. **Every one of the claims discussed in this document is equally available to a supermarket own-label effervescent.** Claims cannot be the moat. That is settled and is not re-argued here.

### 4.1 Against Waterdrop

**What it would cost Waterdrop to close a vitamin-dose gap.** The gating masses in §2.1 are, for the vitamin-led territories, under 20 mg in total. **ESTIMATE:** adding biotin, selenium, copper, iodine and a higher zinc level to an existing cube is a formulation change of tens of milligrams and a label change. It does not require a new plant, a new format or a new supply chain.

**What actually stops it.** On the evidence, **nothing technical.** But §3.1 shows Waterdrop has already moved in the *opposite* direction — away from benefit naming and towards flavour-first hydration. **OPINION:** the realistic defence is not that Waterdrop cannot follow, but that it has made a strategic choice not to be a supplement brand, and re-entering benefit territory would contradict a repositioning it completed in 2024. That is a behavioural moat, not a structural one, and behavioural moats end when a competitor grows large enough to be noticed.

### 4.2 Against Bayer / Berocca

Berocca already owns the GB effervescent-energy code and has extended into Immuno and a focus-adjacent Boost. **OPINION:** it has not extended into beauty, women's health or sleep. Bayer's discipline here is a real observation, and A-050 already noted the same pattern for gendered SKUs. **But Bayer's restraint is not V-Drop's asset** — it is Bayer's decision, revisable annually.

### 4.3 Against Vitabiotics and Holland & Barrett

**FACT.** H&B, Bioglan and Vitl already sell **collagen effervescent tablets** in GB. Vitabiotics owns Perfectil, the dominant GB beauty-VMS franchise, and Menopace in women's health.

**OPINION.** For the beauty territory specifically, the incumbents are already in the format and already own the brand equity. The barrier to them launching a vitamin-led beauty effervescent is a week of NPD. **This is the weakest defensibility position of the three candidates**, which is awkward, because §5 ranks beauty first on claims.

### 4.4 Against supermarket own-label

Boots and Superdrug already list own-label effervescent multivitamins. Own-label follows proven categories, not new ones — so it is a second-wave threat, not a launch-window one. **OPINION:** it caps the long-run position rather than blocking entry.

### 4.5 Verdict

**OPINION, and it is the honest one: none of the three candidate territories is defended by anything in the product.** Not by claims (A-009, A-045), not by formulation (the gating masses are trivial), not by format (Tonic Health and three collagen brands are already in effervescent). The only candidate assets are brand, taste, the physical case-and-refill system, and subscription habit — and of those, only the case is even potentially protectable, and it is out of Phase 1 scope. **The correct conclusion is that this proposition must win on execution speed and brand, and should not be sold to anyone on the basis that it is defensible.**

---

## 5. The dry-format whitespace, ranked

Ranking logic, stated so it can be re-run: **attractiveness = (claims RAG) × (evidence of liquid demand) × (dry-format vacancy) × (mass feasibility in a ~2.0 g cube, per A-066).** A territory that fails the claims test or the mass test cannot be rescued by the other two.

| Rank | Territory | Claims | Liquid demand | Dry vacancy | Mass fit | Net |
|---|---|---|---|---|---|---|
| 1 | **Beauty (skin/hair/nails)** | GREEN (14 claims) | Yes | Partial — collagen-led, not vitamin-led | **Excellent** (µg and low-mg) | **Best available** |
| 2 | **Focus / mental performance, done compliantly** | GREEN but narrow (1 core claim) | Yes | Occupied, but non-compliantly | **Excellent** (0.9 mg) | Interesting, contrarian |
| 3 | **Immunity + tiredness, combined** | GREEN (11 + 9 claims) | Yes | **Crowded** | **Excellent** | Executional, not territorial |
| 4 | Antioxidant / cellular protection | GREEN (8 claims) | Weak | **Vacant as a named territory** | Excellent | Empty for want of demand |
| 5 | Women's health (iron/B6/C route) | AMBER | Weak | **Vacant** | Good (iron 2.1 mg) | Real, but iron is a formulation problem |
| 6 | Recovery | AMBER | Yes | Occupied | **Poor** (Mg/K/creatine) | Arithmetically blocked |
| 7 | Hydration | **RED** | Yes | Crowded | Poor | **The territory the format implies and cannot claim** |
| 8 | Sleep | **RED** | Weak | Near-vacant | Poor (Mg-led) | Wreckage present (Waterdrop RELAX/ZEN) |
| 9 | Stress / mood | **RED** | Yes | Near-vacant | Poor (Mg-led) | Wreckage present |
| 10 | Gut / digestion | **RED** | Yes | **Vacant** | **Impossible** | Legally and physically blocked |

### Is test A-016 supported?

A-016 is not among the rows I was asked to read and I have not re-opened it here; the whitespace question it belongs to is answered above on its own evidence. **What this work does settle for the CSO:** the whitespace at A-067 is narrower than recorded, because (a) Waterdrop has run and abandoned the benefit-named cube architecture in GB (§3.1) and (b) Tonic Health already runs it in GB effervescent tablets (§3.2). **A-050's posture — "whitespace confirmed, demand doubted" — should be upgraded to "whitespace partially disconfirmed, and the remaining whitespace correlates with unclaimability."**

---

## 6. The three opportunity areas worth testing, and the one that is a trap

### Opportunity 1 — Beauty, done as vitamins rather than collagen

This is the only territory where GB law hands you a full page of things you are allowed to say, and where the ingredients that let you say them are light enough to fit in a Waterdrop-sized cube. Twenty-three authorised claims cover skin, hair, nails and collagen formation, and they are unlocked by biotin, zinc, selenium, copper, niacin, riboflavin, vitamin A, iodine and vitamin C — together a few tens of milligrams, against the 800 mg of calcium or 375 mg of magnesium that make other territories impossible. The catch is honest and important: British beauty-supplement buyers have been trained to buy **collagen**, and a meaningful collagen dose is a gram or more, which will never fit in this format. So the test is not "can we make it" but "will a beauty buyer accept a vitamin-led cube instead of a collagen drink". That is a cheap question to ask consumers and it should be asked before anything is formulated.

### Opportunity 2 — Focus, but as the only compliant product in the aisle

There is exactly one authorised GB sentence close to "focus": *pantothenic acid contributes to normal mental performance*. It costs 0.9 mg. Meanwhile every dry-format focus product examined — Tonic Health's Focus + Mind, Waterdrop's Microenergy merchandising, Berocca Boost — sells on wording the register does not support, whether that is lion's mane and memory, rhodiola, or caffeine and alertness. The opportunity is contrarian: be the focus cube that is genuinely clean, and make that the story. It is a real differentiator for a brand that has chosen "clinical" as its position, and it becomes far more valuable if the ASA or Trading Standards ever act on the category. The risk is equally real: you would be deliberately saying less than your competitors, in a territory where consumers buy on the promise you are refusing to make.

### Opportunity 3 — Immunity plus tiredness, as an execution play rather than a land grab

Combining the eleven authorised immune claims with the nine tiredness-and-fatigue claims gives the broadest, cheapest, most mass-feasible benefit story available to a cube, and it is the only place where the product can honestly out-dose Waterdrop within its physical budget. But be clear about what this is: the territory is the most crowded in GB dry format — Berocca Immuno, Phizz Daily Immune+, Tonic Health, and every supermarket's own-label effervescent are already there, and all of them can make the identical claims for pennies. So this is not whitespace. It is the safest ground on which to fight an execution battle about taste, format and design, which is precisely the differentiator the project has already chosen. Treat it as the default base proposition, not as a discovery.

### The trap — sleep, calm and stress

This is the territory that will look most attractive in any brainstorm: it is culturally hot, it is visibly busy in liquid, and it is almost entirely empty in GB dry format. All three of those things are true, and it is still a trap. There is no authorised GB claim for stress, mood, calm or relaxation — the only "stress" in the register is *oxidative* stress, which is a chemistry claim about cells. The two authorised sleep claims both require melatonin, which is a prescription-only medicine in the UK and cannot go in a food. The magnesium route that brands actually use needs 56 mg or more and will not fit the cube. And there is wreckage: Waterdrop's own RELAX and ZEN variants were in the GB range in early 2024 and had gone by that summer, and the one UK brand selling a sleep effervescent advertises "no melatonin" on the pack because there is nothing else it can use. **The space is empty because the law empties it, not because nobody thought of it.**

**A second warning, which is not a territory but a reflex.** Do not assume hydration is safe ground because the product is a water enhancer. It is the one territory in this entire map where a zero-sugar cube can make no authorised claim whatsoever — the two water claims attach to water itself under the drinking-water directives, and the carbohydrate-electrolyte claims require sugar and sodium the product will not carry. Every hydration brand in GB competes on implication. A brand whose whole position is "more clinical" gets nothing from the register here, and should not plan a clinical argument in a territory where the regulator has given it no words.

---

## 7. What I could not verify

1. **Berocca's exact on-pack and on-site claim wording.** `berocca.co.uk` refuses automated reads at its own edge (HTTP 403, explicit anti-bot message). All Berocca statements above are search-summary grade. **Someone should read a physical pack.**
2. **Holland & Barrett, Bioglan and Vitl collagen effervescent panels.** H&B product pages are client-rendered; Ocado and Morrisons returned 403. Beauty dry-format occupancy is therefore established at brand level but not at panel level.
3. **Liquid occupancy in beauty, gut and stress** (Skinade, Gold Collagen, Symprove, Yakult, TRIP, Goodrays) is recorded from general knowledge and search only and is marked UNVERIFIED. It is not load-bearing for any conclusion here, but it should not be quoted as fact.
4. **Melatonin's exact GB legal instrument.** The prescription-only status is well attested but I did not locate the specific MHRA or Human Medicines Regulations citation. A food-law consultant should pin it.
5. **Phizz's current range and panels** — `phizz.com` returned HTTP 522 throughout.
6. **Whether Waterdrop's 2024 renaming was global or GB-specific**, and its stated reason. The archive proves the change; it does not explain it. Worth one more hour of press-release searching.
7. **Whether any GB brand has tried and withdrawn a gut, stress or women's-health effervescent.** Nothing found; small D2C failures leave little trace, so treat this as unknown rather than as "nobody tried".
