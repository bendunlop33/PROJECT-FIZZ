# Independent challenge and QC report: provisional basket

**Run date:** 12-Nov-2026. **Valuation date:** 11-Nov-2026 close. **Author:** independent challenge/QC agent.
**Scope:** the basket (COLO, CPG, BVI, STE, MMC/MRSH, VRSK, ROL, WM) and reserves (ALC, WTW, BN, SPX), plus the rejected names (HLMA, AON, RYAN, ISS, CTAS, OR).
**Companion file:** `research/challenge/qc_findings.csv` (28 findings: 5 high, 11 medium, 12 low).
**Method:** I recomputed everything deterministically from `snapshot.csv`/`scores.csv` inputs with an independent replica of `src/rank.py::scenario()` (scratch script, not committed). I checked external evidence with PitchBook (profiles, news, transcripts) and web search. No existing files were modified.

---

## Executive summary

1. **The arithmetic is right but the inputs are generous.** Market cap, net debt, EV, EBITDAaL, EV/EBITDAaL, FCF, FCF yield and leverage reproduce exactly for all 12 names, and so do the base, bear and bull IRRs. Every discrepancy is in the inputs or assumptions, not in the formulas.
2. **Base growth rates are systematically above company guidance.** COLO (6.8% vs new 5-7% guidance and a cut 2030 ambition), MMC (6.0% vs "similar to 2025" = 4%), STE (7.5% vs 6-7%) and CPG (8.0% cap vs ~7% guidance) all sit at or above the top of guidance. The 50/50 rule overweights the 2022-24 inflation and hard-market years. No base case relies on multiple expansion: the exit multiple is min(current, 10y median). Growth is where the optimism sits.
3. **Two FCF errors flatter yield:**
   - CPG excludes about $0.5bn a year of client-investment capex (contract fulfilment assets). Its FCF yield is 3.1%, not 4.0%.
   - COLO's FY25/26 FCF includes a one-off working-capital release. A normalised yield is about 5.0%, not 5.5%.
4. **Stale and missed facts:**
   - VRSK's AccuLynx deal is court-ordered and live (Delaware Supreme Court, 23-Oct-2026), not "terminated". Pro-forma leverage would be about 3.6x.
   - CPG scores pre-date its verification file.
   - ROL's 2026 problem is AI and digital lead-generation disruption, yet the record scores ROL 4 on AI-substitution risk. Two securities-law firms opened investigations in July/August 2026.
5. **Challenge-adjusted returns:**

   | Measure | Lead's figure | Challenge-adjusted |
   |---|---|---|
   | Basket mean base 5y IRR (local currency) | 10.8% | **9.6%** |
   | Probability-weighted (25/50/25) | 9.8% | **8.6%** |

   With GBP +10% over five years, the adjusted base falls to roughly 7.5-8%. Published 2026 equity CMAs are about 5-8% nominal. The edge over a global index fund is therefore a modest 1-3pp. It comes with concentration, 75% USD exposure and higher volatility than the S&P 500 proxy.
6. **Verdicts:**
   - **Keep:** COLO, BVI, STE.
   - **Keep but downsize:** CPG, MMC, VRSK.
   - **Drop to watchlist:** ROL, WM. Both are below the 9% hurdle on corrected inputs.
   - **Reserves:** promote ALC in place of WM if a full replacement is wanted. Otherwise hold cash or the index until entry ranges are hit.

---

## A. Calculation and data QC

### A1. Hand recomputation from `snapshot.csv` inputs

Definitions used:
- mcap = price × fx(price→reporting) × shares.
- ND pre-lease = total debt − lease liability − cash & STI.
- EV post-lease = mcap + ND + minorities − LT investments.
- EBITDAaL = EBITDA − lease principal − lease interest (zero for US GAAP).
- FCF = OCF − |capex| − lease principal − interest paid if classified in financing (IFRS).

| id | ccy (rep/quote) | mcap (m) | ND pre-lease | EV post-lease | EBITDAaL | EV/EBITDAaL | FCF std | FCF yld | ND/EBITDAaL | Recompute vs file |
|---|---|---|---|---|---|---|---|---|---|---|
| COLO | DKK/DKK | 111,152 | 19,908 | 130,938 | 8,603 | 15.22x | 6,147 | 5.5% | 2.31x | exact |
| CPG | USD/USD | 57,080 | 6,967 | 63,941 | 4,142 | 15.44x | 2,277 | 4.0% | 1.68x | exact |
| BVI | EUR/EUR | 13,345 | 1,685 | 15,069 | 1,067 | 14.13x | 673 | 5.0% | 1.58x | exact |
| STE | USD/USD | 24,986 | 1,362 | 26,363 | 1,676 | 15.73x | 937 | 3.8% | 0.81x | exact |
| MMC | USD/USD | 98,657 | 18,691 | 117,583 | 7,258 | 16.20x | 4,154 | 4.2% | 2.58x | exact |
| VRSK | USD/USD | 26,417 | 3,900 | 30,317 | 1,685 | 17.99x | 1,100 | 4.2% | 2.31x | exact |
| ROL | USD/USD | 18,510 | 598 | 19,108 | 861 | 22.18x | 672 | 3.6% | 0.69x | exact |
| WM | USD/USD | 95,568 | 23,123 | 117,981 | 7,769 | 15.19x | 3,740 | 3.9% | 2.98x | exact |
| ALC | USD/CHF (fx 1.212) | 34,629 | 2,951 | 37,504 | 2,739 | 13.69x | 1,666 | 4.8% | 1.08x | exact |
| WTW | USD/USD | 30,857 | 4,554 | 35,387 | 2,752 | 12.86x | 1,743 | 5.6% | 1.66x | exact |
| BN | EUR/EUR | 43,702 | 7,474 | 50,318 | 4,191 | 12.01x | 2,209 | 5.1% | 1.78x | exact |
| SPX | GBP/GBp (÷100) | 5,619 | 618 | 6,235 | 400 | 15.58x | 171* | 3.0% | 1.55x | exact* |

\*SPX adds back interest received (8.7, investing) as per the code. My first pass without it gave 162.

My replica of `scenario()` reproduces `irr_base_5y`, `irr_bear_5y` and `irr_bull_5y` to four decimals for all 12 names.

### A2. Share counts and prices

- **Share counts vs implied/PitchBook:** all within ±3% (BVI is at −2.8%, borderline) except **CPG**. For CPG, PitchBook EV is $40.3bn against a bottom-up $63.9bn, giving implied 1,154m shares vs 1,700m reported (ratio 0.679). The ±3% tolerance in methodology §10 is not enforced. CPG's point-in-time multiple history and attribution are therefore unreliable.
- **CPG share count:** Yahoo shows 1,697m → 1,700m while Compass has been buying back. This may include treasury shares; check against RNS "total voting rights". Low impact (under 2%).
- **VRSK share count:** the 138.4m → 128.3m drop is consistent with the Feb-2026 debt-funded repurchase in PitchBook (deal 322942-60T, $1bn bonds) and a $200m ASR.
- **Prices:** all 11-Nov closes sit inside the 52-week range and match news flow:
  - ROL: −34% over one year, low $29.69. Q2 miss: −9.3% to $39.44 on 23-Jul-2026 ([GlobeNewswire](https://www.globenewswire.com/news-release/2026/07/25/3333176/34548/en/Securities-Fraud-Investigation-Into-Rollins-Inc-ROL-Announced-Shareholders-Who-Lost-Money-Urged-To-Contact-Glancy-Prongay-Wolke-Rotter-LLP-a-Leading-Securities-Fraud-Law-Firm.html)).
  - COLO: guidance cut and Kerecis impairment on 23-Apr-2026 ([GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3280301/0/en/Coloplast-A-S-Coloplast-revises-financial-guidance-for-FY-2025-26-to-reflect-reduced-growth-outlook-for-Kerecis.html)).
  - VRSK: AI and AccuLynx overhang.
  - CPG: $33.57 ≈ £25.15 at 0.749, plausible.

### A3. Currency and unit consistency

- **GBp vs GBP:** SPX is divided by 100 correctly (fx 0.01).
- **CPG:** the USD line is handled correctly at the valuation date (no ÷100, rep = quote = USD). However, `config/price_currency_overrides.csv` ends the GBP segment on 31-Dec-2025, while the switch was effective **1-Apr-2026** (RNS 18-Mar-2026, [PR Newswire](https://www.prnewswire.com/news-releases/change-in-trading-currency-of-compass-groups-ordinary-shares-302716442.html); also confirmed in `research/verification/CPG.json` V10).
  - Yahoo's Jan-Mar 2026 USD series is synthetic. It shows a +7.6% one-day jump on 1-Apr-2026.
  - Proactive reported 2,050p on 5-Feb-2026; the Yahoo-implied figure is about 2,179p.
  - Returns, correlations and attribution for CPG need rebuilding. The valuation snapshot is unaffected.
- **ALC:** USD reporting with a CHF quote at fx 1.212 USD/CHF, which is plausible. Minor look-ahead possible: the Q3-26 call is dated 11-Nov-2026, so check whether results came out after the SIX close.
- **COLO:** A and B shares are valued at the B price (same economic rights). Acceptable.

### A4. Double counting and exclusions

- **Minorities:** added to EV, but the scenario's exit-equity formula never subtracts them (or adds back investments). The time-0 identity is off by minorities − investments: WM −710, BN −858, MMC +235. Immaterial (<1% of equity), but it should be fixed.
- **Leases:** no double count.
  - IFRS: EBITDAaL deducts principal and interest, and FCF deducts principal. Lease interest is inside OCF for CPG and COLO.
  - **Exception, BVI:** lease interest is paid in financing inside a combined line (157.8) and is never deducted. The proxy principal (121.7) understates cash lease cost by about €36m. Corrected FCF is 636.6 (yield 4.8%).
  - WM: Yahoo gives no lease line, so finance leases stay inside "pre-lease" debt. This is inconsistent with the other names but conservative.
- **Interest:** IFRS financing-classified interest is deducted (BVI 40.7, SPX 45.3, HLMA 32.6). CPG and COLO classify interest in operating. Correct.
- **Acquisitions:** excluded from FCF in every case (`PurchaseOfBusiness` is kept separate). Base growth is organic only, and M&A cash is implicitly retained at zero return, which is conservative. Acquisitive names: MMC 74% of OCF over 3 years on M&A, WM 50%, ROL 46%, CPG 27%. Their reported EBITDA growth is not used in the base. **No base case relies on acquisitions.**
- **CPG capex definition (material):** Yahoo capex covers PP&E and intangibles only (892 FY25). Compass's own capex of 1,384 includes **contract fulfilment assets (492)**, which are recurring client investments amortised within D&A, so EBITDA already excludes their cost.
  - Standardised FCF of 2,277 TTM compares with company FCF of 1,865 for FY25.
  - Corrected TTM FCF is about $1.75bn (yield 3.1%). Base IRR falls about 0.7pp at unchanged growth.
- **COLO FY25/26 cash flow:** OCF jumped from 6,645 to 8,006. Working capital swung from about −0.9bn a year to +0.36bn, and interest paid fell. Normalised FCF (2-year average) is about 5.5bn, a yield of about 5.0%.
- **Adjusted EBITDA:** `ebitda_adj` adds back Yahoo "unusual items" that recur (CPG 347/687/430/484; BN 719). This flatters EV/EBITDAaL_adj in the valuation pillar: CPG 13.8x vs 15.4x reported, BN 10.2x vs 12.0x.
  - **Structural point:** base IRR is unaffected because exit EV = m0 × EBITDA_n = EV0 × (1+g)^n. The base IRR is effectively *EV compounding at g plus FCF yield*, so its only real drivers are g, FCF yield and leverage.

### A5. Scenario assumptions: are they defensible?

Mechanics:
- Base exit multiple = entry × min(1, 10y median / current). For 10 of 12 names that means the current multiple, i.e. no expansion. **WM** is de-rated to its median (14.4x vs 15.1x).
- Bear = −2pp growth, −100bp margin, exit at min(0.85, p25/now) × entry.
- Bull = +1.5pp growth, +50bp margin, current multiple.
- Because base and bull both use the current multiple for most names, the scenario spread is driven entirely by growth.

| id | g_base (file) | Evidence | Defensible base g | File base IRR | Adj. base IRR* | Adj. bear | Adj. prob-wtd |
|---|---|---|---|---|---|---|---|
| COLO | 6.8% | FY26/27 guide 5-7%, 2030 ambition cut to 5-7% (from 7-8%), Q4 5% ([SA, 3-Nov-2026](https://seekingalpha.com/news/4664036-coloplast-as-reports-revised-financialambition-towards-2030-and-fy-202627guidance)) | 6.0% | 12.4% | 11.1% | 5.0% | 10.1% |
| CPG | 8.0% (cap) | FY26 guide ~7%; MT mid-to-high single digit; 9M 7.2%; NNB 3.8% in H1 (below 4-5% range) | 7.0% | 12.0% | 10.2% | 2.4% | 8.9% |
| BVI | 7.5% | H1-26 5.0%, Q3/9M 6.2%; 2023-24 values recall-sourced | 6.25% | 12.6% | 11.1% | 4.5% | 10.0% |
| STE | 7.5% | FY27 guide 6-7% cc; AST cut to 6-7% | 6.5% | 10.8% | 9.8% | 4.0% | 8.9% |
| MMC | 6.0% | 2026 guide "similar to 2025" (4%); 9M 5%; Reinsurance −6% | 4.5% | 10.2% | 8.5% | 2.1% | 7.4% |
| VRSK | 6.7% | Investor Day 6-8% OCC; Q3 7.4%; transactional 3% | 6.5% | 10.9% | 10.6% | 4.8% | 9.6% |
| ROL | 5.8% | Q3 4.4%, residential 2.3%; 2026 guide reportedly 4-6%; LT target 7-8% | 5.0% | 8.9% | 8.1% | 2.3% | 7.2% |
| WM | 5.5% (ESTIMATE) | No organic series; internal growth 5.9% includes $112m of fuel/mandated pass-through; volume ~flat | 4.5% | 8.6% | 7.5% | 0.8% | 6.6% |
| ALC | 6.0% | 2026 sales ~6%; 2027 equipment headwind (lapping UNITY) | 5.5% | 10.0% | 9.5% | 3.7% | 8.5% |
| WTW | 5.0% | Q3 organic 4%; rates softening | 4.5% | 9.6% | 9.1% | 3.2% | 8.1% |
| BN | 4.4% | 2026 LFL guide 3-5%; Q3 +4% (price 3.6%, volume 0.4%) | 4.0% | 8.9% | 8.4% | 1.8% | 7.3% |
| SPX | 4.8% | Guidance reiterated 11-Nov-2026 | 4.5% | 7.7% | 7.5% | 1.1% | 6.4% |

\*Adjusted also for corrected FCF: CPG (less CFA), COLO (2-year average), BVI (actual lease cash).

**Basket mean, local currency:** file base 10.8% → adjusted **9.6%**; probability-weighted **8.6%**. Two further drags are not modelled:
- dividend withholding tax for a UK holder (US 15% with W-8BEN; DK/FR partly reclaimable), roughly −0.2-0.3pp a year;
- the GBP +10% scenario: −1.9pp for non-GBP names, and 87.5% of the basket is non-GBP.

**Conclusions on A5:**
- No base case quietly assumes multiple expansion.
- No base case relies on acquisitions.
- Several rely on **growth above guidance**, which the inflation years of 2022-24 inflated.
- MMC, ROL and WM fall below the project's own 9% buy hurdle once growth is set at guidance.
- WM was already below the hurdle in the file (8.6%) and was not in the mechanical proposal. Its inclusion is a discretionary override by the lead.

### A6. Attribution flags (`attribution.csv`, 5y)

- **CPG:** flagged "abnormal EBITDA base". The 5y window starts in the COVID trough (multiple_t0 184x), and the PitchBook EV level is wrong (A2). The decomposition is not usable.
- **WTW:** flagged "implied share count moved >25%". This is genuine: the share count fell from about 129m to 93m after buybacks following the failed Aon deal. Benign.
- **Unflagged but notable:** five-year price returns for COLO (−57%), STE, ROL, VRSK and ALC were driven by **multiple compression** of −41% to −69% (e.g. COLO 36.8x → 14.8x, STE 36.1x → 16.4x, VRSK 27.9x → 18.5x), while EBITDA grew.
  - The basket is in effect a bet that the de-rating of "quality defensives" has ended.
  - That is a factor call, not a stock-specific edge. Where the de-rating has a fundamental cause (COLO's growth reset, ROL's lead-gen disruption, VRSK's AI fears), the current multiple may not be a floor.
- **Stress-test bug:** `stress_tests.csv` shows a 0.0 drawdown in 2020 for COLO and ROL (month-end minimum vs 31-Jan-2020, not peak to trough). Actual peak-to-trough was COLO −21%, ROL −22.5%, CPG −50%.

---

## B. Accounting comparability (IFRS vs US GAAP)

| Item | IFRS names (COLO, CPG, BVI, BN, SPX) | US GAAP names (STE, MMC, VRSK, ROL, WM, ALC, WTW) | Handling in project | Fair? |
|---|---|---|---|---|
| Leases | IFRS 16: all lease cost leaves EBITDA (depreciation + interest); principal sits in financing | ASC 842: operating-lease cost sits inside EBITDA and OCF; finance leases are like IFRS | IFRS EBITDAaL deducts a proxy (current lease liability + 4% interest) or disclosed payments; FCF deducts principal | Broadly fair. The proxy is crude but the right size. BVI misses lease interest (~€16m). WM's finance leases are treated differently. |
| Interest paid | Classification choice (operating/financing) | Always operating | Financing-classified interest is deducted (classification table) | Fair. Good work. |
| Contract and client costs | IFRS 15 contract fulfilment assets capitalised (CPG, $492m/yr) | n/a in basket | Not deducted from FCF | **Not fair:** it flatters CPG FCF by about 20%. |
| Development costs | IAS 38 capitalisation (SPX, HLMA, some COLO) | Expensed | Capitalised dev is in capex, so FCF is fine; EBITDA is slightly higher | Minor; it affects the multiple, not FCF. |
| Adjusted vs reported EBITDA | Company "underlying" measures (CPG) | "Adjusted EBITDA" (MMC, VRSK, WM); acquisition costs excluded | Pipeline uses reported EBITDA plus Yahoo unusual items | Mixed. Recurring "one-offs" are added back for CPG and BN. Ranking only. |
| Amortisation of acquired intangibles | Below EBITDA | Below EBITDA; US firms exclude it from adjusted EPS | Ranking is on EBITDA/FCF, so neutral. P/E is not comparable: COLO's P/E of 36x includes a DKK3.0bn Kerecis impairment, ALC's 52x includes impairments | Fair for EV/EBITDA and FCF. Do not compare P/E. |
| SBC | Small; COLO/BVI missing (treated as 0) | Material: MMC $418m (1.5% of revenue), WTW $228m, VRSK $60m | FCF is not net of SBC; dilution = SBC/mcap in the scenario | Fair in principle. Missing European SBC is a small bias in their favour. |
| Fiduciary funds (brokers) | n/a | MMC/WTW fiduciary cash excluded; fiduciary interest income (~$400m/yr at MMC) sits in revenue/EBITDA | Correctly excluded from cash | Fair, but the rate sensitivity of EBITDA is not stress-tested. |
| Impairments | COLO DKK3.0bn Kerecis (Q2 FY26) inside Yahoo D&A | ALC low NI | EBITDA unaffected | Fair. Do not read COLO's 3y FCF/NI (missing anyway) or ROIC literally. |

**Verdict:** the cross-company comparison on EV/EBITDAaL and standardised FCF is broadly fair after the CPG CFA fix. The project's own lease and interest work is better than a typical screen. The remaining biases (CPG capex, adjusted-EBITDA add-backs, missing European SBC) all favour the IFRS names slightly.

---

## C. Bear cases (strongest credible), with invalidation evidence

Sources are cited inline; "record" means the project's own `research/qual` or `research/verification` file.

### COLO: Coloplast (keep, core)
1. **Growth reset is structural, not a blip.** Management cut its 2030 organic ambition to 5-7% (from 7-8%) and guided FY26/27 to 5-7% ([SA, 3-Nov-2026](https://seekingalpha.com/news/4664036-coloplast-as-reports-revised-financialambition-towards-2030-and-fy-202627guidance)). Q4 was 5%, and Ostomy was 5% (7% excluding China channel destocking; record).
2. **US reimbursement:** a Medicare outpatient skin-substitute payment change disrupted Kerecis, leading to a DKK3.0bn goodwill impairment and book value down from DKK9bn to DKK6bn ([GlobeNewswire, 23-Apr-2026](https://www.globenewswire.com/news-release/2026/04/23/3280301/0/en/Coloplast-A-S-Coloplast-revises-financial-guidance-for-FY-2025-26-to-reflect-reduced-growth-outlook-for-Kerecis.html)). CMS expanded DMEPOS competitive bidding for 2026 ([HME Business](https://hme-business.com/hme-business-executive-outlook-part-i-navigating-disruption-opportunity-in-2026/)), which is a direct risk to US intermittent catheter and ostomy pricing.
3. **Margin reset:** EBIT before special items fell from 27.5% to 25.7% (record, AR 2025/26).
4. **Capital allocation record:** Atos (~DKK16bn) and Kerecis have diluted returns: ROIC after tax before special items is about 15-16% (FY25/26 guidance), and the company's own target is only to exceed 20% by FY2029/30. Pre-Atos levels were materially higher (not re-verified here). Leverage is 2.3x, targeted below 2.0x only "towards FY2029/30". A new CEO (Gavin Wood, from 1-May-2026) adds execution risk.
5. **Governance:** voting control now sits with Coloplast Fonden (record, corrected), so outside shareholders have no say over capital allocation.

**Invalidates thesis:** FY26/27 organic below 5%; EBIT margin below 24%; US competitive-bidding cuts above 5% on catheters/ostomy; further Kerecis impairment.

### CPG: Compass Group (keep, downsize)
1. **Not as defensive as presented.** COVID: organic −18.8% in FY20 (verification), TTM EBITDA −94%, 2020 share drawdown −50%. 5y GBP correlation with **Accor is 0.33**, the highest of the basket alongside BVI. Sports & Leisure and B&I volumes are cyclical, so it partly duplicates the investor's travel and leisure risk.
2. **Growth normalising from inflation pricing:** pricing contribution fell from about 7% (FY23) to 4% (FY24), 3% (FY25) and 2.7% (H1 FY26). Net new business was 3.8% in H1 FY26, below the 4-5% target (verification). Pre-pandemic NNB was about 3%.
3. **Thin margin (7.2%) and labour intensity:** about 590k employees. Minimum-wage and benefit inflation (US state minimum wages, UK NLW and employer NIC) must be passed through on cost-plus and fixed-price contracts with a lag. The record scores **I4 = 2**, so productivity gains are partly passed back to clients.
4. **FCF is lower than the screen shows:** about a 3.1% yield after client investments (A4). M&A adds roughly 2% a year (Vermaat and others; $1.8bn TTM acquisitions), which raises integration risk.
5. **AI and GLP-1:** GLP-1 adoption could lower per-capita food spend in B&I and healthcare, and hybrid work keeps office populations below 2019 levels. Both are speculative but asymmetric.

**Invalidates thesis:** retention below 95% or NNB below 3% for a full year; FY27 organic below 5%; underlying margin down more than 30bp.

### BVI: Bureau Veritas (keep)
1. **Organic growth slowing toward mid-single digits:** H1-26 5.0% (Q2 5.5%) ([Wendel H1 / BV release](https://www.globenewswire.com/news-release/2026/07/29/3334968/0/en/BUREAU-VERITAS-Delivering-on-our-commitments-with-higher-sequential-organic-growth-in-Q2-and-continuous-margin-improvements.html)), versus 10.2% in 2024. Business Assurance grew only 3.2% in Q3 (record).
2. **Portfolio churn and execution:** sale of Oil & Petrochemicals/Coal (~€450m, ~7% of revenue) to Triton ([GlobeNewswire, 30-Jun-2026](https://www.globenewswire.com/news-release/2026/06/30/3319386/0/en/BUREAU-VERITAS-In-line-with-the-LEAP-28-portfolio-rotation-strategy-Bureau-Veritas-signs-an-agreement-to-sell-its-Oil-Petrochemicals-and-Coal-Testing-and-Inspection-business.html)), five acquisitions in 2026, and an exit from Government Services with a provision. The "double-digit total revenue CAGR" target relies on M&A.
3. **AI and digital audit pressure** on certification and document-based inspection (I1 = 3 in the record). More than 40% of revenue is from EM/APAC (recall-sourced), with China at roughly 8-10%.
4. **Wendel overhang:** prepaid forward and exchangeable sales are already done, and a residual stake (est. 14-16%) remains. Oddo argues there is no near-term pressure ([MarketScreener, 24-Mar-2026](https://www.marketscreener.com/news/oddo-bhf-reiterates-outperform-rating-on-bureau-veritas-ce7e5ed2d980f321)).
5. **Portfolio-fit caveat:** correlation is 0.56 with the FTSE100 and 0.40 with Accor, the highest in the basket.

**Invalidates thesis:** FY27 organic below 4%; adjusted operating margin below 15.5%; cash conversion below 90% for two years; acquisitions diluting ROCE.

### STE: STERIS (keep)
1. **EtO tort tail:** the plaintiff bar is actively building EtO dockets naming STERIS, anchored by the $363m Kamuda verdict and the $408m Sterigenics settlement ([MTAA, Jul-2026](https://masstortadagency.com/eto-lawsuit-update/)). The EPA's proposed repeal of the 2024 NESHAP ([SGS, 18-Mar-2026](https://env.sgs.com/2026/03/18/eto-update-epa-proposes-reconsideration-for-the-2024-commercial-sterilizer-rule/)) lowers compliance capex but does not stop tort claims.
2. **US hospital economics:** management cites North American customers under "economic stress", deferred elective procedures, and price more than offset by inflation in Q2 FY27 ([transcript, 5-Nov-2026](https://www.fool.com/earnings/call-transcripts/2026/11/05/steris-ste-q2-2027-earnings-call-transcript/)). AST guidance was cut to 6-7%.
3. **US is 73% of revenue** (verification); Medicaid/ACA funding changes are a hospital capex headwind.
4. **Low ROIC (7.9% average)** because of goodwill from Cantel. A new restructuring programme and the Xodus acquisition signal a return to M&A.
5. **Valuation is not cheap on an absolute basis:** 15.7x EV/EBITDA and a 3.8% FCF yield.

**Invalidates thesis:** AST organic below 4% for a year; a material EtO verdict or settlement above about $250m; a plant closure.

### MMC: Marsh McLennan, trading as MRSH (downsize)
1. **Soft market:** global property rates −10%, reinsurance revenue −6% in Q3 (record, verification). Management guided 2026 underlying growth "similar to 2025" (4%). The base case's 6% assumes the cycle away.
2. **Falling rates cut fiduciary income** (about $400m a year, almost pure profit; Q4 guide about $94m vs $100m in Q3).
3. **Leverage and M&A dependency:** 74% of 3-year OCF went on M&A (McGriff, Wilshire). Net debt/EBITDA is 2.6x and gross 3.1x. Investors have penalised the stock for "acquisition-related leverage" ([Agrail, 30-Sep-2026](https://agrail.com/news/story/4877859/what-you-need-to-know-ahead-of-marsh-mclennan-s-earnings-release)).
4. **Oliver Wyman** (consulting, discretionary) is the current growth driver at +14%. That is the most cyclical and most AI-exposed segment.
5. **Factor overlap:** 5y correlation of 0.68 with VRSK and 0.62 with WM. MMC adds the least diversification in the basket.

**Invalidates thesis:** underlying growth below 3% for two consecutive years; adjusted margin down year on year; gross debt/EBITDA above 3.5x after a large deal.

### VRSK: Verisk (keep, downsize)
1. **AccuLynx is not dead.** The Delaware Chancery (10-Aug-2026) and Supreme Court (23-Oct-2026) ordered Verisk to pursue FTC clearance and close if cleared ([Law360](https://www.law360.com/mergersacquisitions/articles/2541766)). That means a $2.35bn debt-funded purchase of a roofing-contractor SaaS business that management itself tried to abandon. Pro-forma net debt/EBITDA is about 3.6x. The record still says "terminated".
2. **AI commoditisation narrative:** the share price roughly halved over 12 months to May-2026 ([Fool, 30-May-2026](https://www.fool.com/investing/2026/05/30/will-verisks-valuable-data-moat-hold-or-will-ai-co/)). Management says AI products have "extended sales cycles".
3. **Cash flow weakening:** Q3-26 FCF −40% (record). Contractor customers (about 10% of revenue) are under stress, with bankruptcies ([Q3 call, 5-Nov-2026](https://www.fool.com/earnings/call-transcripts/2026/11/05/verisk-vrsk-q3-2026-earnings-call-transcript/)). Transactional revenue grew only 3%, hurt by low weather activity.
4. **83% US and 100% P&C insurance:** concentrated on one customer industry, with insurer consolidation and in-house AI analytics as risks.
5. **Buybacks:** the debt-funded repurchase of Feb-2026 ($1bn bonds; PitchBook deal 322942-60T) cut the share count by about 8% in 2026, at prices of roughly $190-220 against $206 today. The timing is neutral at best, and the deal added leverage just before the AccuLynx obligation was reinstated.

**Invalidates thesis:** subscription growth below 6%; OCC below 5% for a year; adjusted EBITDA margin below 54%; AccuLynx closing with leverage above 3.5x and no dated path down.

### ROL: Rollins (drop to watchlist)
1. **Customer acquisition is being disrupted.** The CEO says fewer customers are searching digital channels for pest control, and the "customer acquisition landscape is changing structurally" (AI search). Q3 organic was 4.4% and residential 2.3%; operating margin fell 140bp to 20.5% ([transcript, 22-Oct-2026](https://www.fool.com/earnings/call-transcripts/2026/10/22/rollins-rol-q3-2026-earnings-call-transcript/); [Quiver](https://www.quiverquant.com/news/Rollins+Falls+After+Third-Quarter+Profit+and+Margin+Declines)). This contradicts the record's I1 = 4.
2. **Two consecutive misses and a downgrade:** RBC cut to Sector Perform with a $40 target ([FMP, 23-Jul-2026](https://site.financialmodelingprep.com/market-news/rollins-rol-downgraded-rbc-capital-q2-2026-earnings-miss)). Securities-law firms announced investigations in July/August 2026 ([GlobeNewswire](https://www.globenewswire.com/news-release/2026/08/04/3338919/0/en/ROLLINS-STOCKHOLDER-ALERT-Bragar-Eagel-Squire-P-C-is-Investigating-Rollins-Inc-on-Behalf-of-Rollins-Stockholders-and-Encourages-Investors-to-Contact-the-Firm.html)).
3. **Insurance and claims costs** doubled to 3.4% of revenue. Staffing and capacity constraints limit termite backlog conversion.
4. **Still 22x EV/EBITDA** after a 40% fall, with base IRR below 9% even on file assumptions. The family/insider sale of $1bn at $57.50 on 12-Nov-2025 (PitchBook deal 312987-79T) is in hindsight a poor signal for outside holders.
5. **US residential consumer exposure.**

**Invalidates the bear case (i.e. re-entry trigger):** two quarters of organic growth of 6% or more with residential above 4%, and price below about $33 (where base IRR clears 9% at g = 5%).

### WM (drop / swap)
1. **Below hurdle:** base IRR 8.6% (file) and about 7.5% at internal growth excluding pass-through fuel and mandated fees. Rank 35 overall, and **not in the mechanical proposal**.
2. **Growth is price-only:** core price 5.8%, yield 3.4%, volume about flat. Political or customer pushback is likely if inflation falls.
3. **Stericycle (Healthcare Solutions)** was bought at a premium multiple; integration of billing and systems is ongoing. FCF/NI is 0.88 over 3 years. Leverage is 3.0x (highest in the basket on a pre-lease basis).
4. **CEO transition** (Fish to Morris, January 2027) and exposure to RIN and recycled-commodity prices on sustainability capex.
5. **Clustered factor exposure:** correlation 0.62 with MMC and 0.58 with VRSK. It is a US bond-proxy defensive, adding duration (rate) risk rather than diversification.

**Invalidates the bear case:** organic volume above 1% with core price above 4%, and price below about $215.

### Reserves

**ALC (Alcon), promote as WM replacement (medium confidence):**
1. 2027 equipment headwind as UNITY laps; weak implantables ([Q3 call, 11-Nov-2026](https://www.fool.com/earnings/call-transcripts/2026/11/11/alcon-inc-alc-q3-2026-earnings-call-transcript/); [Carmignac Q2-26](https://www.carmignac.com/en/articles/carmignac-portfolio-grande-europe-letter-from-the-fund-manager-q2-2026-3963-13517)).
2. US tariffs of 10-12.5% on imports.
3. Low reported ROIC (3.9%) because of Novartis-era intangibles.
4. Overlaps COLO/STE on healthcare reimbursement and procedure volumes.

**Invalidates:** organic below 4%; core margin not expanding in 2027.

**WTW, keep as reserve, do not add:**
1. Q3 organic 4%, softening rates, delayed large-client implementations ([Q3 call, 29-Oct-2026](https://www.fool.com/earnings/call-transcripts/2026/10/29/willis-towers-watson-wtw-q3-2026-earnings-call-transcript/)).
2. Same insurance-cycle factor as MMC/VRSK.
3. Newfront acquisition and integration.
4. History of a failed merger (Aon) and talent losses.

**Invalidates:** organic below 3%.

**BN (Danone), reserve, low priority:**
1. Growth is price-led (Q3 LFL +4% = price 3.6%, volume 0.4%) ([FoodNavigator, 28-Oct-2026](https://www.foodnavigator.com/Article/2026/10/28/strong-q3-driven-by-nutrition-trends/)).
2. China infant formula "normalising"; EMEA baby-formula recall.
3. Adjusted EBITDA add-backs of €719m flatter the multiple.
4. M&A (Huel); net debt €9.0bn.

**Invalidates:** LFL below 3%.

**SPX (Spirax), drop from reserves:**
1. Adjusted base 7.5%, below hurdle.
2. Cyclical industrial production and semiconductor exposure (Electric Thermal Solutions).
3. China sensitivity.
4. The shares de-rated from 35x to 15x for a reason (three years of organic misses).

Guidance was reiterated on 11-Nov-2026 ([AJ Bell](https://www.ajbell.co.uk/news/articles/spirax-posts-sales-and-profit-growth-reiterates-full-year-guidance)).

---

## D. Portfolio challenge

### D1. Expected value vs the alternatives

**(i) Global index fund.** Published 2026 CMAs put 10-year US large-cap at 5.2-7.6% and developed ex-US at 6.7-7.8% (BNY [2026 CMA](https://www.bny.com/content/dam/imemea/pdfs/durable-by-design-capital-market-assumptions-2026-executive-summary.pdf), [PGIM](https://www.pgim.com/us/en/individual/insights/market-portfolio/outlooks/2026-capital-market-assumptions), Northern Trust via [BusinessWire](https://www.businesswire.com/news/home/20260115666544/en)).
- The basket's adjusted base is 9.6% and its probability-weighted figure 8.6% (local).
- On these figures the gross edge is about 1-3pp a year.
- That edge comes with about 10x stock-specific risk, higher volatility than the index proxy (14.2% vs 12.9%), and model error of ±2pp on each name's growth input.
- **Conclusion:** the edge is positive but thin, and not robust to one or two thesis failures. COLO alone, at 1/8 weight with a bear IRR of 5%, swings the basket by about 0.8pp.

**(ii) Keeping existing holdings.** The basket clearly diversifies away from the travel names:
- 5y GBP correlation is 0.14-0.22 with Accor, TUI and Jet2.
- Travel volatility is 30.9% vs the basket's 14.2%.

But the investor already holds global/UK index funds, which carry the same US large-cap quality exposure (correlation 0.44 with the S&P 500 proxy; MMC, VRSK and WM are S&P 500 members). Two caveats:
- The "GLOBAL" existing-holding proxy is the **S&P 500 TR, not a global index**, so overlap is mis-measured.
- Given disclosed **leveraged DeGiro exposure**, the most valuable risk reduction is probably deleveraging and cutting speculative/travel weight. A defensive basket bought on top of existing leverage does not reduce leverage risk.

**(iii) Cash until entry ranges are hit.** On file numbers, ROL ($38.47 vs $38.32 buy-below) and WM ($240 vs $236) are at or above their 9%-hurdle prices. On corrected numbers, MMC (buy-below about $195 vs $207.5) joins them.
- Staging entries makes sense: buy COLO, BVI, STE and VRSK now, and set limit levels for the others.
- UK cash rates (about 3.5-4% assumed; not verified here) are a credible alternative for the 2-3 names below hurdle.

### D2. Diversification or a concentrated factor bet?

It is a concentrated bet on a few shared factors:
- **USD/US:** 75% USD reporting, 62.5% US-domiciled, about 68% North American revenue (geography coverage only 4/8 names). GBP +10% costs about 1.9pp a year on 87.5% of the basket.
- **De-rated quality defensives:** 5 of 8 names (COLO, STE, VRSK, ROL, plus ALC in reserve) owe their low multiples to five years of de-rating. That is one style factor, which has been crowded out by AI-related themes (Carmignac Q2-26 letter).
- **Insurance pricing cycle:** MMC + VRSK = 25% (37.5% with WTW). Both are hurt by a soft P&C market and low catastrophe activity, and their correlation is 0.68.
- **US healthcare reimbursement and hospital budgets:** COLO + STE = 25% (37.5% with ALC). CMS competitive bidding and hospital capex are shared drivers.
- **Labour cost and wage inflation:** CPG, BVI, ROL and WM are labour-heavy route or site services, about 50%. Pass-through works with a lag and squeezes margins if wage growth outruns CPI.
- **Rates/duration:** WM, MMC (fiduciary income) and the defensive multiples generally behave like long-duration bonds.
- **Interest-rate and liquidity link to leveraged exposure:** in a margin-call scenario these liquid large caps would be sold too. They do not hedge leverage.

### D3. Drop, swap or downsize; rejected names

- **Drop ROL and WM** (below hurdle on corrected inputs; WM was a discretionary add).
- **Replace WM with ALC** only if eight names are required. Otherwise run seven names, or put the residual in a global index fund. Adding ALC raises healthcare to 37.5%, so cap COLO+STE+ALC at about 30% combined.
- **Downsize MMC and VRSK** to about half weight each (together about 12.5%) to cap insurance-cycle exposure. Do not add WTW as well.
- **Downsize CPG** (cyclical, overlaps travel and leisure, FCF overstated).
- **Rejected names:**
  - **ISS:** highest file base IRR (14.5%), FCF yield 9.2%, EV/EBITDAaL 10.7x, EUR/DKK exposure (diversifies USD). Not obviously worse than CPG on value, but lower quality (low margin, cost-plus, history of key-account losses, DT arbitration contingent). Worth a proper verification pass as a value counterweight to CPG. Do not add without one.
  - **AON:** cheaper than MMC (12.5x vs 19.2x 10y median; base 10.3%), but pending USI with leverage about 4.5x (G1 = B). Not a better choice than a downsized MMC.
  - **HLMA:** correctly rejected for this mandate. One hyperscaler customer is 20% of revenue and AI/data-centre revenue is about 20% (G3/G5 = B; verification confirmed). That conflicts with the investor's speculative/thematic overlap.
  - **RYAN:** leverage 4.3x pre-lease (G1 = B), Up-C governance, organic decelerating to 4%. Correctly rejected.
  - **CTAS** (base 5.9%) and **OR** (7.8%): quality is excellent, but valuation leaves no margin of safety. Correctly rejected.
  - **SPX:** see C. Correctly not in the basket.

---

## E. Source integrity sample (15 claims)

| # | Name | Claim in records | Source in record | Check | Result |
|---|---|---|---|---|---|
| 1 | COLO | DKK3.0bn Kerecis impairment; Medicare change | S1 (Inderes/company) | [GlobeNewswire 23-Apr-2026](https://www.globenewswire.com/news-release/2026/04/23/3280301/0/en/Coloplast-A-S-Coloplast-revises-financial-guidance-for-FY-2025-26-to-reflect-reduced-growth-outlook-for-Kerecis.html) | Confirmed |
| 2 | COLO | CEO change adds execution risk | qual bear point | Gavin Wood CEO from 1-May-2026 ([Simply Wall St via PitchBook](https://simplywall.st/news/dk/infrastructure)) | Confirmed |
| 3 | COLO | Louis-Hansen family controls votes ("recalled") | recall | Verification corrected: 51.4% of votes at 30-Sep-2026, gifted to Coloplast Fonden 1-Oct-2026 | Recall was outdated; now corrected |
| 4 | COLO | 2030 ambition / FY26/27 guidance | qual mentions "ambition revised" | 5-7% organic, LT cut from 7-8% ([SA 3-Nov-2026](https://seekingalpha.com/news/4664036-coloplast-as-reports-revised-financialambition-towards-2030-and-fy-202627guidance)) | Confirmed, but **not reflected in g_base** |
| 5 | CPG | LSE quote moved to USD effective 1-Apr-2026 | S3 RNS | [PR Newswire 18-Mar-2026](https://www.prnewswire.com/news-releases/change-in-trading-currency-of-compass-groups-ordinary-shares-302716442.html) | Confirmed. The pipeline override uses 2-Jan-2026, which is inconsistent. |
| 6 | CPG | FY26 guidance ~7% organic; retention 96% | S1/S2 | [Proactive 5-Feb-2026](https://www.proactiveinvestors.co.uk/companies/news/1086869/compass-group-falls-as-guidance-left-unchanged-1086869.html); verification V9 | Confirmed (guidance raised to >11% UOP growth in May) |
| 7 | CPG | ISIN, CEO/CFO start dates, Vermaat acquisition ("recall") | recall | Not checked; not decision-critical | Low risk |
| 8 | BVI | FY2024 organic 10.2% (recall S6) | recall | [BV release 25-Feb-2025](https://group.bureauveritas.com/newsroom/bureau-veritas-leap-28-strategy-delivers-outstanding-results-2024-confident-2025-outlook) | Confirmed, but **decision-critical and recall-sourced** (feeds g_base). FY2023 8.5% not verified. |
| 9 | BVI | Geography (Europe ~33%, EM 45-50%, China 8-10%) "INFERENCE (recall)" | recall | Not verified. PitchBook/news give no split. | **Decision-relevant** to D (diversification) and still unverified |
| 10 | STE | FY27 adj. EPS guidance $11.35-11.55 | S1 SEC | [Q2 FY27 call 5-Nov-2026](https://www.fool.com/earnings/call-transcripts/2026/11/05/steris-ste-q2-2027-earnings-call-transcript/) | Confirmed |
| 11 | MMC | Q3-26 Risk +5% / Reinsurance −6% / Consulting +14% | S2 transcript | Verification and [Q3 call 15-Oct-2026](https://www.fool.com/earnings/call-transcripts/2026/10/15/marsh-mclennan-mrsh-q3-2026-earnings-call-transcript/) | Confirmed |
| 12 | VRSK | "AccuLynx terminated" | S2/S3 | [Law360 23-Oct-2026](https://www.law360.com/mergersacquisitions/articles/2541766): Supreme Court upheld specific performance | **Contradicted:** the deal is pending |
| 13 | VRSK | Q3-26 FCF −40.5% | S2 | Yahoo Q3 OCF 267 vs 403.5 prior year (−34%), consistent | Confirmed |
| 14 | ROL | Q3-26 organic 4.4%, margin 20.5% (−140bp) | S1 (Finviz/Zacks) | [Quiver 21-Oct-2026](https://www.quiverquant.com/news/Rollins+Falls+After+Third-Quarter+Profit+and+Margin+Declines) | Confirmed |
| 15 | ROL | 2024 organic 7.4%; family secondary with concurrent buyback ("recall" S5) | recall | FY24 organic was **7.9%** ([Rollins FY24 release](https://finanzen.net/nachricht/aktien/rollins-inc-reports-fourth-quarter-and-full-year-2024-financial-results-14234057)); secondary confirmed (PitchBook: 17.39m shares at $57.50, 12-Nov-2025); concurrent buyback not confirmed | **Partly wrong.** Organic figure incorrect; recall-sourced and feeds g_base. |
| (16) | WM | CEO succession Fish to Morris | S2 | [SA 26-Aug-2026](https://seekingalpha.com/news/4636977-wm-names-john-morris-ceo-as-jim-fish-to-retire?feed_item_type=news) | Confirmed |

### Decision-critical recall-sourced items (flag)

| Item | Why it matters |
|---|---|
| BVI organic 2023-24 | Feeds g_base 7.5% |
| BVI geography | Drives the diversification argument |
| ROL organic 2023-24 | Feeds g_base. One value was wrong; small effect. |
| ROL ownership/independence | Feeds governance score H |
| COLO acquisition prices | Feed the capital-allocation score G |

There are no verification files for **BVI, ROL or WM**: three of eight basket names rest on sector-agent records alone. CPG's verification file exists but was written after `scores.csv` was produced.

---

## Final verdict table

| Name | Verdict | Key reason | Confidence |
|---|---|---|---|
| COLO | **Keep** (core weight, not overweight) | Cheapest vs own history (14.8x vs 26x median); adjusted base 11.1%. But growth reset to 5-7% and US reimbursement risk. | Medium |
| CPG | **Downsize** (about half weight) | FCF overstated (CFA capex); g 8% above ~7% guidance; adjusted base 10.2%; cyclical, correlates with the travel book. | Medium |
| BVI | **Keep** | Adjusted base 11.1%; EUR exposure offsets USD; portfolio rotation is credible. Needs a verification file (recall-sourced inputs). | Medium |
| STE | **Keep** | Adjusted base 9.8%, low leverage, US hospital economics resilient. EtO tort tail is the key risk. | Medium |
| MMC (MRSH) | **Downsize** | Base g 6% vs ~4% guidance; adjusted base 8.5%, below hurdle; soft market; highly correlated with VRSK/WM. | Medium-high |
| VRSK | **Keep, downsize** (cap with MMC at about 12.5% combined) | Adjusted base 10.6%, strong moat, but court-ordered AccuLynx (about 3.6x pro-forma leverage) and AI narrative. | Medium |
| ROL | **Drop to watchlist** (re-entry below about $33 or with organic of 6% or more) | Structural lead-gen/AI-search disruption, two misses, securities-law investigations, still 22x; adjusted base 8.1%. | Medium-high |
| WM | **Drop / swap** | Below hurdle on file (8.6%) and adjusted (7.5%) numbers; discretionary override of the mechanical list; US defensive cluster. | High |
| ALC (reserve) | **Swap in for WM** (optional; cap healthcare at about 30%) | Adjusted base 9.5%, 13.7x vs 22x median, CHF quote; 2027 equipment headwind. | Low-medium |
| WTW (reserve) | **Keep as reserve; do not add** | Cheap (12.2x, 5.6% FCF yield), but adds to insurance-cycle concentration; organic 4%. | Medium |
| BN (reserve) | **Keep as low-priority reserve** | Adjusted base 8.4%, below hurdle; price-led growth; flattered by adjusted-EBITDA add-backs. | Medium |
| SPX (reserve) | **Drop from reserves** | Adjusted base 7.5%, cyclical industrial/semis exposure. | Medium |
| ISS (rejected) | **Re-examine** (verification before any add) | Highest file IRR (14.5%), 9.2% FCF yield, non-USD. Quality and contract-concentration concerns. | Low |

**Process actions before finalising:**
1. Re-run `rank.py` after all verification files exist (CPG is stale).
2. Fix the CPG CFA capex, COLO FCF normalisation, BVI lease cash, CPG currency-override date and stress-test drawdown method.
3. Anchor g_base to the lower of the rule and the guidance midpoint.
4. Propagate the VRSK AccuLynx status into the qual record, gates and leverage.
5. Replace the "GLOBAL" S&P 500 proxy with an ACWI/World series.
6. Create verification files for BVI, ROL and WM.
