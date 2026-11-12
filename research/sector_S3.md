# Sector 3 — Consumer Staples & Essential Household Products

Agent: S3 · as of 2026-11-12 (valuation date: 11-Nov-2026 close) · status: qualitative records complete for 14 detailed + 3 screen-depth names.

Files: `research/qual/<ID>.json` (17) and `data/raw/pitchbook/<ID>.json` (17). This note does not rank or pick names.

## 1. Peer groups

| Peer group | Detailed | Screen | Notes |
|---|---|---|---|
| HPC (household & personal care, beauty) | ULVR, RKT, PG, CL, CHD, BEI, OR | HEN3 | OR and BEI are skin-care/beauty-led; HEN3 is about 53% industrial adhesives |
| Food & beverage | NESN, BN, KO, MKC | LISN | KO is an asset-light concentrate business; MKC is dominated by a pending transaction |
| Essential retail | COST, L, AD | ATD | Retailers report comparable sales, not price/volume. About 74% of ATD revenue is fuel |

## 2. Gate flags (details in each JSON `gates.notes`)

| ID | Gate | Status | Reason |
|---|---|---|---|
| MKC | G6 | **A** | Transaction-dominated. It is combining with Unilever Foods (about USD44.8bn), and MKC holders will end up with 35%. Closing is expected by mid-2027 |
| MKC | G1 | B | Pro-forma net leverage is up to 4.0x at closing. PitchBook TTM is already 3.7x |
| ULVR | G6 | B | Foods (about 26% of sales) is leaving through the MKC deal. The ice-cream demerger was in Dec-2025. Pre-2025 history is not like-for-like |
| ATD | G6 | B | The Zabka acquisition (about USD8.6bn, pro-forma about 3.0x) is pending and expected to close by Dec-2026 |
| NESN | G1 | B | Company figure is 2.85x (Dec-25). PitchBook TTM 2Q26 is about 3.96x, depressed by a CHF1.3bn write-down. The waters JV gives a deleveraging path |
| PG | G3 | B | Walmart is about 16% of sales |
| CHD | G3 | B | Walmart is about 23% of sales; the top four customers are about 44% |
| KO | G2 | B | The IRS transfer-pricing appeal is unresolved. USD6bn has been paid and up to about USD14bn more is possible |
| RKT | G2/G4 | B | Mead Johnson NEC litigation is open. FY25 FCF fell 23% (GBP1.7bn) with one-offs; the 3-year standardised FCF/NI needs checking |

There are no Chinese-domiciled names and no pending takeovers *of* a covered company. No name has more than 40% UK consumer exposure: ULVR and RKT are UK-listed but get most of their revenue outside the UK, though UK % is not disclosed. Controlling or dual-class holders, noted neutrally:
- BEI: maxingvest, about 51%
- OR: Bettencourt family about 34% and Nestle about 20% (recalled)
- L: George Weston, about 52% (recalled)
- HEN3: Henkel family pool; HEN3 shares are non-voting preferred
- LISN: two share lines (registered shares and participation certificates)

## 3. Price versus volume

Where reported, headline organic growth is split into price and volume/mix. In 2022-23 inflation inflated "organic growth" across the sector.

| ID | 2022 org (price / vol) | 2023 org (price / vol) | 2025 org (price / vol) | Latest (period: price / vol) | Read |
|---|---|---|---|---|---|
| NESN | 8.3 (8.2 / 0.0) | 7.2 (7.5 / -0.3) | 3.5 (2.8 / 0.8) | 9M26 3.7 (1.8 / 1.9) | Growth was price-only in 2022-23. RIG is improving (Q3-26: 2.8) |
| ULVR | 9.0 (11.3 / -2.1) | 7.0 (6.6 / 0.4) | 3.5 (2.0 / 1.5) | 9M26 4.9 (~1.1 / 3.8) | **Volume-led recovery** |
| PG | 7 (5 / 2) | 7 (9 / -2) | 2 (1 / 1) FY25 | FY26 1 (1 / 0) | Pricing power, but volume has stalled |
| KO | 16 (11 / 5) | 12 (10 / 2) | n/r | Q3-26 7 (1 / 7 conc.; UCV +5) | Price/mix includes hyperinflation. NA volume flat |
| BN | 7.8 (n/r) | 7.0 (n/r) | 4.5 (~1.8 / 2.7) | Q3-26 4.0 (3.6 / 0.4) | Volume-led in 2025, price-led again in 2026 |
| RKT | 7.5 (n/r) | 3.5 (n/r) | 5.0 (Core 3.7 / 1.5) | Q3-26 Core 3.3 (3.2 / 0.1) | Mostly price |
| CL | 7.5 (n/r) | 8.5 (n/r) | 1.4 (n/r) | Q3-26 3.6 (2.0 / 1.7) | NA volume -3.7% |
| CHD | n/r | 5.2 (n/r) | n/r | Q3-26 5.1 (0.5 / 4.6) | **Genuine volume grower** |
| MKC | n/r | n/r | n/r | Q3-26 1.9 (2.2 / -0.3) | Price-only. Consumer Americas volume -2.5% |
| LISN | 10.9 | 8.4 | n/r | H1-26 4.3 (11.8 / -7.5) | Cocoa pass-through has hit elasticity |
| OR | 10.9 | 7.6 | n/r (reported +1.3) | Q3-26 adj. LFL 7.7 | No formal split; unit growth accelerating in Consumer Products |
| BEI | 8.3 | 10.0 | 2.4 | 9M26 -2.8 | Nivea is declining (-6.2%) |
| COST / L / AD | – | – | – | COST adj. comps +6.6% FY26; L food SSS +1.6% Q2-26; AD US +0.5% / EU +2.1% Q3-26 | Traffic and inflation split not retrieved |

On the latest evidence the genuine volume growers are **CHD**, **ULVR** (9M-26), **COST** (traffic-led comps, inferred), **KO** (unit cases, EM-led) and Nestle's improving RIG. The latest periods were **price-led** at **MKC, LISN, RKT, BN (Q3-26)** and **PG**. Rows marked n/r were not retrieved. Several 2021-2024 figures are recalled from releases (confidence M) and are flagged as such in the JSONs.

## 4. Measurable scale economics (PitchBook TTM, reported basis, USD; ESTIMATE)

| ID | EBIT margin | Net debt/EBITDA (provider) |
|---|---|---|
| KO | 36.3% | 1.3x |
| RKT | 28.3% | 2.0x |
| PG | 23.7% | 1.0x |
| OR | 19.9% | 1.1x |
| ULVR | 17.3% | n/m (provider net debt appears distorted) |
| CHD | 17.2% | 1.3x |
| LISN | 16.4% | 1.1x |
| CL | 14.8% | 1.6x |
| BEI | 13.4% | net cash |
| MKC | 13.0% | 3.7x |
| HEN3 | 12.8% | 0.5x |
| NESN | 11.8% | 4.0x |
| BN | 10.4% | 2.0x |
| L | 7.0% | 2.1x |
| ATD | 5.9% | 1.7x |
| COST | 3.9% | net cash |
| AD | 3.9% | 0.1x |

Scale only shows up in margins where it comes with a moat:
- concentrate model (KO)
- category superiority plus US retail leverage (PG)
- media and R&D scale in beauty (OR)

Nestle, the largest company, earns a lower reported EBIT margin than mid-size HPC names. Size alone earns no rubric points.

## 5. Sector dynamics

- **Retailer power:** Walmart is about 16% of PG and about 23% of CHD sales; CL is about 11% (recalled). Retailers with strong private label (Costco Kirkland, Loblaw PC/No Name at about 30% of sales, Aldi/Lidl in Europe) gain share in trade-down phases. Private-label risk is highest in European dairy (BN), mass skin care (BEI Nivea), laundry (HEN3/ULVR Home Care) and US spices (MKC).
- **Input costs:** a 2026 Middle East/Iran conflict lifted commodity and energy costs, and companies stepped up pricing in Q3-26 (ULVR, BN). Cocoa remains a severe pressure for LISN. Tariffs affected US names; refunds under the IEEPA ruling helped COST and CHD in Q3-26.
- **GLP-1:** the risk is highest for confectionery and snacks (LISN, parts of NESN) and for sugared beverages (KO, mitigated by zero-sugar). It is neutral to positive for protein dairy (BN Oikos) and medical nutrition.
- **EM and China:**
  - ULVR: about 58% EM
  - CL: about half of international sales are EM
  - KO and NESN: EM growth is the volume engine
  - China specifically: OR (North Asia about 24%), BN (Mizone, infant formula) and BEI (La Prairie) are the most exposed
- **Portfolio reshaping:** sector-wide simplification is changing comparability:
  - ULVR: Ice Cream demerged and Foods going to MKC
  - RKT: Essential Home sold; Mead Johnson non-core
  - NESN: waters JV, ice cream and VMS held for sale
  - CHD: VMS, Flawless and Spinbrush exited
  - KO: Costa under sale review
- **Leadership churn:**
  - NESN: three CEOs in 13 months
  - ULVR: three CEOs since 2023
  - Orderly successions at PG (Jejurikar, Jan-26), KO (Braun, Mar-26), CHD (Dierker, Mar-25)
- **Activists (in scope):**
  - Trian at Unilever (2022; current status not re-verified)
  - Bluebell and Artisan at Danone (2020-21; CEO/Chair removed)
  - None identified at Nestle, Reckitt or Henkel as of this note. Elliott/PepsiCo is out of scope.

## 6. Runway

- **Highest runway:**
  - COST: about 25 net new warehouses a year plus international expansion
  - CHD: volume-led niche brands; international +7.8%
  - OR: beauty-market growth and premiumisation
  - Derma and medical nutrition sub-segments (BEI Derma +11.7%, Danone Specialized Nutrition)
- **Saturated or mature:**
  - PG and CL in developed markets
  - Grocers (AD, L)
  - BEI Nivea and Nestle Food & Snacks

## 7. Wider universe screened (not detailed)

| Name | Why not detailed |
|---|---|
| Diageo (UK) | Spirits are discretionary and destocking. CEO change in 2025, leverage around the top of its range, UK listing. Weak fit for an essential-staples brief |
| Tesco (UK) | More than 40% UK consumer exposure would trigger G7; the investor wants to reduce UK consumer exposure |
| Kimberly-Clark (US) | Agreed to acquire Kenvue (Nov-2025). Transaction-dominated and highly levered pro forma, so G6 A-type risk. Kenvue is covered in S2 |
| Hershey (US) | Cocoa inflation, GLP-1 sensitivity, heavy US/Walmart concentration. Similar pressures to LISN but with less geographic balance |
| PepsiCo (US) | Elliott activism (out of scope per brief). Snack volumes are falling, with GLP-1 exposure |
| Carlsberg (DK) | Britvic acquisition (2025) adds UK exposure and leverage. Beer is semi-discretionary |
| Dollar General (US) | US-only discount retail recovering from execution problems. Low-income consumer is cyclical |
| Walmart (US) | Very high valuation and US-centric. It is also the top customer of PG and CHD (overlapping exposure) |
| Kraft Heinz | Out of scope per brief (split announced 2025) |

## 8. Contrary evidence

- "Defensive staples" de-rated in 2023-25 because 2022-23 pricing exhausted elasticity. Volumes, not price, now decide winners.
- Several high-quality brands still face private-label share gains: CL in North America, MKC, and Nivea at BEI.
- Big portfolio moves (MKC/ULVR Foods, KMB/Kenvue, ATD/Zabka) raise execution and leverage risk exactly where investors expect stability.
- Retail comps are inflation-inflated, and food inflation is a political target in Canada (L).

## 9. Data gaps and caveats

- **Primary-source access:** unilever.com, reckitt.com and businesswire.com returned 403/404 to the fetch tool. Some figures therefore come from RNS reprints and reputable trade press, cited per datapoint.
- **Lease data:** IFRS lease principal and lease interest paid were **not retrieved** for NESN, ULVR, RKT, BEI, OR, BN, L, AD, LISN, HEN3 and ATD. They are null in the JSONs; use the methodology lease proxy.
- **Annual splits:** 2021-2024 annual price/volume splits are missing for RKT, CL, CHD, MKC, BEI and OR. Some 2021-24 headline organic figures are recalled from prior releases (confidence M, labelled in sources).
- **Geography:** % splits not retrieved for NESN, BEI, BN and KO. UK % is not disclosed for ULVR and RKT.
- **Company FCF:** only NESN, ULVR, RKT and CHD (guidance) have company-defined FCF figures.
- **Timing:** Loblaw's Q3-2026 results were not yet published at the valuation date.
- **Tool note:** PitchBook financials for NESN, RKT, BEI, OR, BN and LISN came back inline rather than as files. They were saved verbatim from the session transcript as `{"result": ...}`.
