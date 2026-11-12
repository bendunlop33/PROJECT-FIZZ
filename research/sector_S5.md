# Sector 5: Waste, Water and Environmental Services

Agent: S5. As of 2026-11-12. Valuation date: 11-Nov-2026 close.
Qualitative records: `research/qual/<ID>.json`. PitchBook raw files: `data/raw/pitchbook/<ID>.json`. All 15 PBIDs were found.

This file does not rank companies or pick portfolio winners.

## 1. Subgroups and coverage

| Subgroup | Companies (record ID) | Depth | Counts toward core 10? |
|---|---|---|---|
| **Core A: solid waste (collection, transfer, landfill)** | WM, RSG, WCN, GFL, CWST | detailed | yes |
| **Core B: hazardous, industrial and multi-utility environmental services** | CLH, VIE, SCHP | detailed | yes |
| **Core C: environmental testing, consulting and engineering** | MEG (now **Onterris, NYSE: ONT**), TTEK | detailed | yes, but see §3 |
| **Adjacent: water equipment and instrumentation** | XYL, VLTO | detailed | **no (ADJACENT)** |
| **Adjacent: regulated water utilities** | SVT, AWK | detailed | **no (ADJACENT)** |
| **Commodity-sensitive recycler** | BFSA | screen | no |

PBIDs:

| ID | PBID |
|---|---|
| WM | 54200-53 |
| RSG | 41921-38 |
| WCN | 41912-74 |
| GFL | 51326-02 |
| CWST | 12006-37 |
| CLH | 13142-62 |
| VIE | 12326-77 |
| SCHP | 57797-11 |
| MEG/ONT | 63594-19 |
| TTEK | 41098-60 |
| XYL | 54002-71 |
| VLTO | 534934-54 |
| SVT | 11910-43 |
| AWK | 42099-67 |
| BFSA | 58208-41 |

Why the subgroups are kept apart:
- **Service businesses** (Core A and B) own permitted disposal assets and dense routes. They pass inflation through in price.
- **Equipment makers** (XYL, VLTO) depend on the project and capex cycle, plus consumables.
- **Regulated utilities** (SVT, AWK) earn returns set by a regulator on a growing asset base (RCV or rate base). Their free cash flow is structurally negative and their leverage is structurally high.
- **BFSA** earns money that depends mostly on the zinc price.

## 2. Listing and transaction verification (G6 and domicile)

**MEG (lead query) is still listed and was not taken private.** Montrose Environmental Group renamed itself **Onterris, Inc.**
- The rename was announced on 21-Apr-2026. The NYSE ticker changed from MEG to ONT on 4-May-2026, according to the company release.
- Yahoo shows no NYSE data under "MEG" because the symbol is stale. Use **ONT**.
- The board announced a **strategic review** on 5-Aug-2026, advised by Evercore, AEC Advisors and Kirkland & Ellis. The company has talked with strategic and financial parties. The review was still ongoing on 4-Nov-2026 with no timetable.
- Gate result: **G6 = B** (a possible sale, but nothing agreed).
- The record ID stays MEG to match universe.csv.

**GFL:**
- Environmental Services was sold in March 2025. GFL keeps an equity-method stake.
- GFL acquired SECURE Waste Infrastructure in about October 2026.
- A Special Committee reviewed **unsolicited take-private proposals**. Reported bidders were a Blackstone/KKR/ECP group and a Brookfield/IFM group. On **10-Nov-2026** the board unanimously chose to remain public. Some parties still want to buy the financial sponsors' stakes.
- No re-domicile or change of US listing was found. GFL remains a Canadian company listed on NYSE and TSX.
- Gate result: **G6 = B**.

**AWK:**
- An all-stock merger with Essential Utilities is pending. AWK is the acquirer and the surviving company.
- HSR clearance came on 14-Aug-2026. Kentucky, Ohio and Virginia have approved. Pennsylvania and Texas are pending. Closing is expected by the end of Q1 2027.
- Gate result: **G6 = B** (the record is dominated by the transaction until it closes).

**WM:**
- Stericycle was acquired in November 2024 and now reports as Healthcare Solutions. Q3-26 adjusted EBITDA margin was 22.4%, up from 17.5%, with $30m of integration costs in the quarter.
- CEO Jim Fish retires. John Morris becomes CEO on 4-Jan-2027. This is not a transaction.

**VIE:** Veolia closed the Clean Earth acquisition on 1-Jun-2026 for about $3.0bn EV. It has also signed €570m of disposals.

**Chinese domicile:** none in the sector. BFSA is domiciled in Luxembourg but operates steel-dust plants in China. Its China revenue share is not disclosed in the sources reviewed.

## 3. Is there a core of 10 or more independent listed service companies in EU/NA?

**Not cleanly.** Ten core records are produced, but only **eight** are true waste or environmental *operating* services with permitted assets: WM, RSG, WCN, GFL, CWST, CLH, VIE and SCHP.

The other two are weaker fits:
- **TTEK** is an engineering and consulting firm. Its economics resemble professional services, and it carries real AI-substitution risk.
- **Onterris (MEG)** is a small testing and remediation company. It reports losses and is under strategic review.

Several companies that would once have filled the gap no longer trade independently:

| Company | Fate |
|---|---|
| Stericycle | acquired by WM, 2024 |
| US Ecology | acquired by RSG, 2022 |
| Advanced Disposal | acquired by WM, 2020 |
| Covanta | taken private by EQT, 2021 |
| Heritage-Crystal Clean | taken private, 2023 |
| Biffa | taken private by Energy Capital Partners, 2022 (from prior knowledge) |
| Renewi | acquired, 2025 |
| Suez | broken up between Veolia and a consortium |
| Clean Earth | bought by Veolia, 2026 |
| SECURE Waste Infrastructure | bought by GFL, 2026 |

The investable listed universe is concentrated and still shrinking. **Shortfall: two names against a strict definition.** No padding has been added.

## 4. Wider universe screened and why it was not detailed

| Company | Why not detailed |
|---|---|
| Pennon (UK) | UK regulated water. Morningstar puts it at ~0.97x EV/RCV. It overlaps SVT and carries the same UK political risk, and SVT is the higher-quality UK proxy. |
| United Utilities (UK) | UK regulated. Morningstar gives it **no moat** (returns too low). Its AMP8 re-opener was 86% approved. It would duplicate SVT. |
| Stantec (CA) | Engineering consulting (water is one segment). It is closer to TTEK, belongs with S4/S6 professional services, and is not waste. |
| Biffa / Renewi | No longer listed independently (see §3). |
| Heritage-Crystal Clean | Private. |
| Ecolab (water) | Covered in S1 as a hygiene/water-treatment company, with S5 noted as a secondary exposure. |
| Pentair, Zurn Elkay, Badger Meter, Watts | Water *equipment* (pool, building flow, metering). They are adjacent to XYL/VLTO and cyclical with residential construction. XYL and VLTO already cover equipment and instrumentation. |
| FCC (ES) | Conglomerate, family-controlled. Its environmental unit is not separately listed. |
| Tomra (NO) | Recycling equipment (reverse vending). Equipment, not service. |
| Enviri (new NVRI) | Steel-mill services after selling Clean Earth. Industrial cyclical. |
| Quest Resource, Perma-Fix | Micro-cap, below quality/size relevance. |
| Ambipar (BR) | Emerging-market domicile. Outside the EU/NA mandate. |

## 5. Dynamics (2025-26 evidence)

**Price over volume across solid waste.** In every Q3-26 release, core price ran at 5-6% while volumes were flat to negative.

| Company | Core price | Yield | Volume |
|---|---|---|---|
| WM (collection & disposal) | 5.8% | 3.4% | ~0% |
| RSG | 5.3% (6.3% on related revenue) | 2.9% | -0.6% |
| WCN (solid waste) | 5.5% | 4.3% | -1.2% |
| GFL | 5.7% | — | -0.1% |
| CWST | 5.5% | — | -1.0% (landfill volume +12.8%) |

- Growth therefore rests on continued price acceptance by municipalities and commercial customers.
- Morningstar (Jan-2026) notes "volume headwinds persist" and that valuations remain elevated.

**Pass-through.** Fuel and energy surcharges recovered a late-Q3 diesel spike:
- WM's energy surcharges added $112m in the quarter.
- RSG's fuel recovery added 1.8%.
- WCN said it absorbed the diesel spike, at a cost of about 30bp of margin.

Recycled commodities are rising:
- WM single-stream: about $82/t, up from about $68/t.
- RSG: $142/t, up $16.

RIN prices are falling: WM's fell to $2.32 from $2.56. That hurts the RNG investment case.

**Hazardous waste and PFAS.**
- CLH incinerator utilisation was 87%, and ES margins have expanded for 18 consecutive quarters.
- Veolia doubled its US hazardous-waste business through Clean Earth.
- SCHP is expanding in Chile and Italy.
- PFAS is the main secular driver: incineration, remediation, testing (Onterris) and drinking-water treatment (utilities, VLTO, XYL).

**Water equipment.** The two equipment names are diverging:
- XYL cut 2026 guidance to flat organic growth. Even so, orders rose about 10% and backlog reached a record $5.5bn. Data-centre orders in Applied Water rose by more than 200% from a small base.
- VLTO core growth was 5.1%, and free cash flow exceeds 105% of net income.

**Regulated water.**
- SVT/AMP8: the price review is about £15bn, with roughly 9.9% RCV growth.
- UK political risk has risen. Morningstar (Aug-2026) cites PM Andy Burnham calling for "more public control" and lower bills.
- AWK targets 7-9% EPS growth, with its merger pending.

## 6. Measurable scale economics (route density and landfill)

| Metric | WM | RSG | WCN | GFL | CWST | Source |
|---|---|---|---|---|---|---|
| Active landfills | 257 | ~207 | 113 | n/d | n/d | PitchBook/Morningstar profiles |
| Weighted remaining landfill life | ~40 yrs | ~56 yrs | ~31 yrs | n/d | n/d | Morningstar (Mar-2026), as summarised |
| Adj. EBITDA margin (Q3-26) | 31.0% | 31.8% | **34.0%** | 31.5% | 23.9% | company releases |
| Capex % revenue (2026E, ESTIMATE) | ~10.4% | ~11.4% | ~12.4% | ~11.3% | n/c (9M replacement capex $127m) | guidance |
| FCF / adj. EBITDA (2026E, ESTIMATE) | ~46% | ~46% | ~43% | ~41% | ~43% | guidance |
| Provider ND / EBITDA (TTM) | 2.98x | 2.70x | 3.11x | ~7.0x (company 3.8x) | 3.75x | PitchBook |

What the table shows:
- Margins follow *local* density and disposal ownership rather than total size. WCN is the smallest of the big three yet has the highest margin, because of its exclusive and secondary markets. CWST is subscale, at about 24%.
- **High EBITDA margins do not mean high cash returns.** Capex absorbs 10-12% of revenue. Only about 41-46% of adjusted EBITDA turns into company-defined FCF.
- Maintenance capex is not separately disclosed in the releases reviewed. The exceptions are WM ("support the business" about $2.5bn, roughly 9.5% of revenue) and CWST (replacement capex $126.8m for 9M).

## 7. Runway

**Solid waste.** Growth is GDP-like in volume plus 2-3% real price, with continuing tuck-in consolidation:
- RSG spent about $1.1bn in 9M-26.
- WCN acquired about $130m of revenue.
- CWST spent $440m.
- GFL's acquisitions added 18.7 points of growth.

Acquisition dependence is high for GFL and CWST. It is moderate for WCN and RSG.

**Hazardous waste and PFAS.** There is a multi-year regulatory runway. Regulatory rollback is the main risk.

**Water.** Utilities can grow their asset base at 8-10% a year, but returns are regulated and capped. Equipment and instrumentation benefit from water scarcity, PFAS rules and digital metering, but the cycle is lumpy.

## 8. Contrary evidence and risks

- **Negative volumes for several years.** This suggests economic softness, or diversion through extended producer responsibility (EPR) and recycling mandates. GFL cited EPR transition contracts and service exits. If inflation falls, price-led growth may compress.
- **Environmental liabilities are real and lumpy:**
  - WCN: the Chiquita Canyon landfill event (from prior knowledge; verify in the 10-K).
  - CWST: the Granite State greenfield landfill project was abandoned, with a $13.6m write-off. This shows how hard it is to get new permits, but also means CWST will not get that extra disposal capacity it was counting on.
  - WM: an $18m accelerated landfill-closure impairment.
  - Industry-wide, PFAS leachate treatment costs are not yet quantified.
- **Commodity sensitivity is understated by margin metrics.** CLH's SKSS segment EBITDA rose 209% in Q3-26 on a base-oil price spike, so 2026 includes peak-ish earnings and a ~$120m emergency-response event. WM's RNG economics depend on RIN prices. BFSA depends on zinc.
- **Accounting gaps.** GFL's provider (reported IFRS) EBITDA is about half its adjusted EBITDA, and it reports net losses. CWST and Onterris also rely on heavy adjustments.
- **Utilities.** Leverage rules under a mechanical G1 (net debt/EBITDA above 5x: SVT ~7.5x, AWK ~5.4x) give **G1 = A**. The lead should decide whether to apply an RCV-gearing basis instead; this is flagged in the JSON notes. SVT also gets **G7 = B** for UK consumer bills and political exposure.

## 9. Gate summary (A/B only)

| ID | Gates at B or A |
|---|---|
| GFL | G1 B (interest cover; leverage 3.8x company), G4 B (net income negative/volatile), G6 B (take-private rejected; sponsor stake sales) |
| CWST | G1 B (interest cover), G4 B (net loss guided) |
| SCHP | G1 B (provider 3.5x incl. leases, low interest cover), G4 B (thin net income) |
| MEG/ONT | G1 B, G4 B, G6 B (strategic review) |
| TTEK | G3 B (US federal agencies concentration; post-USAID share not verified) |
| SVT (adjacent) | **G1 A (mechanical)**, G7 B |
| AWK (adjacent) | **G1 A (mechanical)**, G6 B (merger pending) |

All other gates are C. No company exceeds G5: AI/data-centre exposure is below 5% everywhere, with XYL the highest at an inferred 2-5%.

## 10. Data gaps (honest list)

1. **Five-year organic growth with the price/volume split (2021-2025) was not collected for any company.** Only Q3-26 or 9M-26 figures are sourced, plus WCN 2024 from Morningstar. These cells are `null`. This needs a 10-K pass before the organic-CAGR pillar can be computed.
2. **IFRS lease principal and interest paid** (VIE, SCHP, GFL, SVT, BFSA) were not collected. The lead's proxy should be used.
3. **Revenue geography percentages** are mostly INFERENCE (US-centric companies, XYL, VLTO, TTEK). Veolia gives only France (19%) and US (11%). BFSA's China share is not disclosed.
4. **Landfill counts and airspace** are missing for GFL and CWST. Closure, post-closure and environmental liability amounts were not read from the 10-Ks.
5. **Some management details come from prior knowledge and are marked "not verified":** CFO names, tenure dates, RSG's major holder, CWST's dual-class structure and related-party leases.
6. **TTEK's FY2026 10-K and Q4 results** (fiscal year ended Sep-2026) were not yet published at the valuation date. **SVT H1 FY27** results are due 18-Nov-2026.
7. **Xylem's Q3 figures** come from secondary summaries (Quartr / 24/7 Wall St) rather than the primary 8-K.
8. **GFL's currency label for adjusted FCF** (USD vs CAD) should be checked against the 6-K.
9. **WM C&D volume.** The release text gives -0.4%, but the internal-growth table gives +$53m (+0.8%). The difference is probably a definitional one (recycling and other volumes); check before use.

Primary sources are listed in each JSON `sources` block. They are mainly SEC 8-K/6-K Q3-2026 releases, company releases, and Morningstar via PitchBook.
