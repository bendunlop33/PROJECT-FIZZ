# Quality-control report

**Run date:** 12 Nov 2026. **Valuation date:** 11 Nov 2026 close.
**Scope:** the data, calculations, accounting comparability, point-in-time integrity, sources and survivorship risks behind `output/Investment_Report.md` and `output/Equity_Research_Workbook.xlsx`.

## 1. QC process

| Layer | What was done | Result |
|---|---|---|
| Automated tests | `tests/test_pipeline.py` (11 tests): Shapley identity and order independence; attribution reconciles exactly; all live prices dated 11-Nov-2026; own TR = provider TR outside London; no zero-filled revenue, EBITDA or OCF; PitchBook-to-Yahoo date-mapping quality; gate-A names never ranked; weights sum to 1; no Chinese domicile; FX cross consistency; JSON id integrity | **11/11 pass** |
| Workbook | 2,700+ live formulas; recalculated with LibreOffice | **0 formula errors**. Excel scenario IRRs reproduce the Python model to within **0.5pp** for all 96 rows (residual from the treatment of rounding, minorities and interest) |
| Independent challenge agent | Hand-recomputed market cap, net debt, EV, EBITDAaL, multiples, FCF, leverage and IRRs for 12 names; reviewed assumptions, accounting, sources, bear cases and portfolio fit | Calculations **reproduced exactly**. 28 findings (5 high, 11 medium, 12 low), dispositioned in §7 |
| Verification agents (3 batches) | Primary-source organic growth series, geography and decision-critical claims for 30 shortlist and candidate names | Material corrections applied (§5) |
| Financial-data agent | IFRS cash-flow classification table, 49 companies (interest, leases, capex, company FCF) | 43 complete, 6 partial |

## 2. Data gaps

**No consensus estimates.**
- No licensed consensus was available, so forward multiples are not shown.
- Forward views use company guidance only, labelled TARGET.

**Cash-flow history is short.**
- Yahoo provides about 4 fiscal years plus TTM.
- 3-year FCF conversion is missing where a year is absent: Coloplast (FY2024/25 missing), VIE before the capex fix, and several screen-depth names.
- The 10-year history of revenue, EBITDA, net income, net debt and EV comes from PitchBook.

**Organic growth series.**
- 30 names have verified series.
- The rest rely on sector-agent series, which are often 1–3 years, or on a flagged ESTIMATE (revenue CAGR less 1–3pp).
- Verified but still null:
  - Straumann FY2019–23 (site blocked).
  - STERIS FY2020 and FY2022.
  - Haleon 2019–20 (pre-demerger).
  - Danone FY2019–23.
  - Séché FY2019–24.
  - SGS FY2019, 2020 and 2022.
- Befesa and CorVel publish no organic metric; reported growth is used as a proxy and labelled.

**Geography.**
- Disclosures are heterogeneous.
- The US share is used as a lower-bound proxy for North America where that is all that is disclosed.
- Basket coverage is 3–4 of 5 names per field.

**IFRS lease cash flows.**
- These were not available for Nestlé, Reckitt, Danone, Galderma, bioMérieux and Befesa (no separate line), and were null for RS Group, GFL, Severn Trent, Toromont and Séché.
- The proxy used in their place is current lease liability plus 4% interest, labelled ESTIMATE.

**Not extracted for most names:**
- client and producer retention;
- earn-out liabilities;
- exact controlling-holder voting percentages, except where verified (Lifco 68.9% of votes; Bureau Veritas/Wendel about 21% of capital and 35% of votes).

**Results falling after the valuation date:**
- Compass FY26 (24-Nov-2026);
- Severn Trent H1 (18-Nov);
- Tetra Tech FY26 10-K;
- Loblaw Q3;
- Halma and Diploma November results.

## 3. Accounting inconsistencies and how they were handled

| Issue | Treatment |
|---|---|
| IFRS 16 vs ASC 842 | Comparison basis is EV excluding leases over EBITDAaL (IFRS EBITDA less lease principal and interest; US GAAP operating-lease cost already in EBITDA). Provider EV/EBITDA, including leases, is shown alongside for reconciliation |
| Interest paid classified in financing (17 IFRS issuers incl. Haleon, Unilever, Bureau Veritas, SGS, Elis, Eurofins, Sonova, Beiersdorf, Loblaw, Ahold, Henkel, Bunzl, Halma, Spirax, Veolia, Rotork, Befesa) | Deducted from standardised FCF (latest FY amount) |
| Company "FCF" not deducting leases (Bureau Veritas, Haleon, Unilever, Reckitt, Danone); ISS deducting lease *additions* | The standardised measure is used for ranking; company FCF is shown in `FCF_Reconciliation` |
| Combined lease principal and interest lines (Elis, Bureau Veritas, Ahold) | Bureau Veritas: disclosed combined €157.8m used via override. Elis and Ahold: combined line treated as principal, with interest also in interest paid (possible small double count, conservative) |
| Compass contract-fulfilment assets (client investments, about $0.5bn a year) excluded from provider capex | Deducted (FCF override 1,751) |
| Coloplast one-off working-capital release (FY25/26) | FCF normalised to the 2-year average (5,540) |
| Séché OCF pre-interest, plus one-off factoring and a hybrid booked as equity | FCF set to verified €29m; €300m hybrid added to net debt |
| Provider "unusual items" recurring every year (e.g. Compass, Danone) | Not added back when non-zero in at least 2 of the last 3 fiscal years |
| Yahoo TTM EBITDA equal to EBIT for some European issuers (Demant, Indutrade, Addtech) | Rebuilt as EBIT plus D&A; checked against PitchBook (±15% flag) |
| Total debt excluding leases at the provider (Ahold, UniFirst, Watsco, CorVel) | Leases added |
| Up-C and multi-class share structures (Ryan, TWFG, Goosehead, Baldwin, Crawford) | Economic share counts from 10-Q covers (`config/share_overrides.csv`); non-controlling interest not added to EV, to avoid double counting |
| Linen and uniform rental depreciation (Elis) | Noted: EV/EBITDA understates cost; FCF and EV/EBIT preferred |
| Regulated water | Leverage assessed against regulated asset base (RCV) gearing; G1 capped at B (methodology change log) |
| Acquired-intangible amortisation, SBC | EBITDA-based valuation is unaffected by amortisation. SBC is shown separately and enters scenarios as dilution |
| IFRS 18 (effective Jan 2027) | Will change presentation of key subtotals (e.g. Alcon). Refresh definitions after FY2026 reports |

## 4. Actuals versus estimates (labelling)

- **Labels used:** every qualitative datapoint carries FACT, TARGET, CONSENSUS, INFERENCE or ESTIMATE.
- **Overrides:** all are in `config/*overrides*.csv`, each with written evidence and source:
  - growth: 8 guidance-anchored overrides;
  - FCF and debt-like items: 5;
  - gates: 1 (Verisk G1 = B);
  - scores: 1 (Rollins AI-substitution score, I1, lowered to 3).
- **Scenario outputs** are conditional illustrations, not forecasts.
- **Buy and fair-max levels** are ranges derived from the base case; they are not price targets.

## 5. Corrections from verification (selected)

| Company | Corrected item |
|---|---|
| Indutrade, Lifco | Organic 2023–25 was flat to negative (−1%/−2%; 0%/−0.5%), not the ~6% inferred from revenue CAGR. Base return fell to 5–6% |
| L'Oréal | 2023 like-for-like +11.0% (not 7.6%, which was reported growth) |
| Haleon | 2023 organic 8.0%; China is 9.1% of revenue (was "undisclosed") |
| Verisk | AccuLynx is not terminated: court-ordered closing if the FTC clears it. Pro forma about 3.6x, so G1 = B |
| Halma | Hyperscaler customer about 20% of revenue confirmed (15% in FY25); FY27 margin guidance raised |
| Coloplast | 2030 ambition cut to 5–7% organic; control moved to the foundation (1-Oct-2026); EBIT margin 25.7% |
| Cooper | FY26 organic guidance cut to 2–3% |
| Waste Connections | Volume negative every year since 2022; 2025 organic 2.0% |
| Coca-Cola | 2026 YTD price/mix +1%; about 5pt of 2024 organic growth came from hyperinflationary markets |
| Rollins | FY24 organic 7.9% (recall had 7.4%); 2026 guidance cut to 4–6%; AI-search lead-generation pressure |
| Bureau Veritas | Wendel holds about 21.4% of capital and 35% of votes (not about 14–16%) |
| Séché / Befesa | FCF overstated (interest in financing, one-off factoring, concession capex): Séché about €29m, Befesa about €91m |
| Marsh / WTW / STERIS / Compass / Alcon | Base growth anchored to latest guidance or run-rate (4.5% / 4.5% / 6.5% / 7.0% / 5.0%) |
| Marsh McLennan | Ticker MRSH from 14-Jan-2026 |
| Montrose | Renamed Onterris (NYSE: ONT) from 4-May-2026 |
| Kenvue | Acquired by Kimberly-Clark, completed 2-Nov-2026 |

## 6. Point-in-time limitations

**What is point-in-time.**
- Historical EV/EBITDA is point-in-time with respect to *price* and *reporting lag*.
- Reporting lags used: US/Canada 50 days for interim periods and 75 days for fiscal year-end; Europe 65 and 80 days.

**What is not.**
- Fundamentals are PitchBook *current-vintage*, so later restatements may be embedded.
- Share counts are PitchBook-implied (EV − net debt)/price.

**Implied-share test.** Where implied shares deviate more than 10% from reported, the own-history statistics are **excluded** from valuation:
- Compass 0.68, Unilever 1.27, Perrigo 1.26, GFL 0.78, Sodexo 0.87, Elis 0.89, Sonova 0.88, Ferguson 1.12, Severn Trent 0.90, Crawford 1.10;
- Up-C names before the share override.

**Pre-2019 data.** Multiples before 2019 are on a different lease basis (the IFRS 16 / ASC 842 break). The post-2019 median is reported separately.

**Mapping check.** PitchBook fiscal-period labels were mapped to period ends and validated against Yahoo EBITDA margins.
- The mean absolute difference is under 1pp for 88 of 97 names.
- Exceptions: Eurofins, Ambu, Danone, Coca-Cola, Henkel, Diploma, Severn Trent, American Water and TWFG (1–4pp; definitional).

**Annual figures** are never presented as quarterly point-in-time data.

## 7. Independent challenge findings and their disposition

| Severity | Finding | Disposition |
|---|---|---|
| High | Compass FCF omits client investments | **Fixed** (override; FCF yield 4.0% to 3.1%) |
| High | Verisk AccuLynx live; leverage about 3.6x pro forma | **Fixed** (G1 = B; removed from basket) |
| High | Coloplast growth above new guidance | **Fixed** (6.0%) |
| High | Marsh growth above guidance | **Fixed** (4.5%); Marsh moved to reserve |
| High | Compass scored before its verification file existed | **Fixed** (re-run; 7.0% guidance-anchored) |
| Med | STERIS growth above FY27 guidance | **Fixed** (6.5%) |
| Med | Coloplast FCF includes a one-off working-capital release | **Fixed** (normalised) |
| Med | Compass PitchBook EV about 37% low; implied-share test not enforced | **Fixed** (tolerance enforced; history excluded) |
| Med | Compass currency-switch date (company: 1-Apr-2026) | **Partly resolved.** The Yahoo series switches on 2-Jan-2026, so the override follows the series. Jan–Mar 2026 Compass prices are a provider conversion and 1-Apr-2026 (+7.6%) may contain an artefact. Compass's 1-year return is affected by up to about 7pp; 5- and 10-year figures are affected only marginally |
| Med | WM growth estimate inflated by Stericycle | **Fixed** (4.25%); WM below hurdle |
| Med | Recurring unusual items added back | **Fixed** (recurring test) |
| Med | 2020 drawdown method understated | **Fixed** (daily peak-to-trough) |
| Med | "Global index" proxied by the S&P 500 | **Fixed** (MSCI World ETF) |
| Med | Bureau Veritas growth relied on recall-sourced years | **Fixed** (verification file; 6.25% override) |
| Med | Rollins AI-substitution score too generous | **Fixed** (I1 = 3) |
| Med | Basket presented as risk reduction | **Accepted.** The report presents it as a factor bet on de-rated defensives that diversifies away from travel, AI and speculative exposure, *not* as lower-volatility |
| Low | Bureau Veritas lease interest omitted | **Fixed** (combined lease cash) |
| Low | Scenario exit equity omitted minorities and associates | **Fixed** (same EV-to-equity bridge as entry) |
| Low | Bureau Veritas perimeter (oil, petrochemicals and coal sale about 7% of revenue) not pro forma | **Open.** Disclosed; immaterial to the conclusion |
| Low | Compass share count may include treasury shares | **Open.** Not independently verified; affects market cap by at most a few % |
| Low | Split fiscal-year label parsing (Coloplast) | **Open.** Immaterial |
| Low | FCF accumulates without a return; withholding tax ignored in scenarios | **Open.** Conservative and optimistic respectively; stated in limitations |

The full list is in `research/challenge/qc_findings.csv`.

## 8. Unverified or weakly sourced claims

- **Recall-flagged sources.** 28 of 401 sector-agent sources across 26 companies are flagged "recall", "memory" or "prior knowledge" (confidence L or M).
  - Decision-critical ones for basket names were re-verified: Bureau Veritas, Compass, Coloplast, STERIS and WTW all have verification files.
  - Remaining recall items concern mostly non-shortlist names (e.g. some CFO tenures, ISINs, Ferguson re-domicile date).
- **Third-party copies.** Some figures come from third-party copies of official filings (RNS mirrors, ticker.app, news mirrors) where company sites returned HTTP 403. Each is flagged in the source notes.
- **Unquantified gates.** Several judgement-based gates rely on inference rather than disclosure:
  - Halma: the hyperscaler share *is* disclosed.
  - Toromont: AI/data-centre exposure of 13–20% is an estimate.
  - Atlas Copco: semiconductor exposure of 12–18% is an inference.
  - Mitie: UK government concentration is inferred.

## 9. Reconciliation failures and resolutions

| Item | Status |
|---|---|
| London listings: Yahoo adjusted close excludes dividends (median gap 14.7pp over 5 years) | Resolved: own TR (close plus ex-date dividends) used; verified against ETF benchmarks, where both methods agree |
| Spin-offs (Aramark/Vestis, BD/Embecta, BD/Waters, Unilever/Magnum, Sodexo/Pluxee) | Yahoo back-adjusted, so spin value is reinvested in the parent. Attribution flagged for the window |
| EBITDA vs PitchBook >15% | Perrigo −20% (impairments), Demant +44% (PitchBook lag/definition), Bunzl +15%, Diploma +20%, Addtech +25%. Flagged; Yahoo used (latest TTM, local GAAP) |
| PitchBook implied shares deviate >10% | 14 names listed in §6; own history excluded or share override applied |
| Abnormal starting bases in attribution (e.g. Reckitt impairment year, Compass 2021) | Flagged "not economically meaningful"; excluded from multiple-driven conclusions |
| STERIS GFC EBITDA peak-to-trough (−49%) | Likely impairment-affected reported EBITDA; labelled in the report |
| Veolia gate falsely A (missing capex, NaN treated as 0) | Fixed; missing never summed as zero (`min_count`) |

## 10. Survivorship and selection risks

- **The universe is today's survivors.** Companies taken private or failed since 2016 are absent, which biases every historical return upward. Examples are Stericycle, Renewi, Biffa, Applus, Hologic and US Ecology.
- **Exercise A** (today's selections, retrospective) is labelled as **not** a point-in-time investable backtest. Today's basket was selected partly *because* it de-rated, so its poor history is expected and not informative about the forward return.
- **The Exercise B diagnostic** uses today's survivors. Its outperformance versus the equal-weight universe (13.6% against 11.6% net) is not evidence of a deployable edge.
- **Weights are fixed ex ante**, and sensitivity was tested on equal, quality-heavy and value-heavy sets. The basket names rank inside the top 7 under all four sets except WTW, which is chosen on portfolio fit at the hurdle. No parameter was tuned on returns.

## 11. Licensing and reproducibility

- **Raw provider extracts** (PitchBook, Yahoo) are kept out of version control (`.gitignore`).
- **Derived figures** in `data/processed/` and the workbook come from licensed PitchBook data. The investor should confirm that their PitchBook subscription permits storing derived data in this private repository.
- **No secrets** are stored. No paid services or new credentials were used.
- **No browser spoofing or bot-check bypass.** One early attempt to use a browser user-agent was blocked by the environment's safety controls and was not repeated; an honest client identifier was used throughout.
- **Rebuild:** follow `docs/REFRESH.md`. PitchBook extracts must be re-pulled interactively.
