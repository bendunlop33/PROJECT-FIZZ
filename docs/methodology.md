# Methodology, shared schema and definitions (authoritative)

Owner: Lead agent (Research Director). All agents follow this document. Changes require a dated entry in §12.

## 1. Dates and conventions
- **Valuation date:** close of **Wednesday 11 November 2026** (latest completed session on all covered exchanges; 11 Nov is Veterans Day in the US but NYSE/Nasdaq trade normally; TSX, LSE, Euronext, SIX, Xetra, Nasdaq Nordic all open). Run date 12 Nov 2026.
- **Base currency for cross-company returns:** GBP (unhedged). Local-currency results are always shown alongside.
- **FX:** Yahoo Finance daily close crosses (`XXXGBP=X`), same-day as price. London prices quoted in pence (GBp) are divided by 100.
- **Units:** financials in millions of reporting currency unless a column says otherwise. PitchBook series are in USD millions (converted by PitchBook); ratios computed from a single provider/currency are currency-neutral.
- **Fiscal periods:** labelled by period-end date. PitchBook labels (e.g. `TTM 1Q2027`) are fiscal quarters; they are mapped to period-end dates using the company fiscal year-end.

## 2. Data sources and priority
1. Company filings / official results (annual reports, results releases, 10-K/10-Q via SEC EDGAR XBRL).
2. Regulatory announcements (RNS, AMF, SEC 8-K, SIX ad hoc).
3. Official ownership/governance disclosures (proxy, annual report governance sections, TR-1 / 13D/13G).
4. Reputable data providers: **PitchBook** (licensed connection: quarterly TTM income statement & balance sheet, historical EV, profiles, transcripts, Morningstar research); **Yahoo Finance** public chart/fundamentals endpoints (prices, dividends, splits, FX, index levels, ~4 years of annual cash-flow statements).
5. Credible independent reporting (context and contrary evidence only).

Not available/used: PitchBook does not provide cash-flow statements or consensus estimates through this connection; Yahoo consensus (quoteSummary) requires a session crumb and was **not** used. Forward estimates are therefore only included where a company has published guidance or where a named credible source is cited; otherwise "not available".

## 3. Evidence classes (every key datapoint is tagged)
`FACT` (reported), `TARGET` (management guidance/target), `CONSENSUS` (named consensus source), `INFERENCE` (analyst judgement, with method), `ESTIMATE` (calculated proxy, with method). Missing disclosure = `null` + `"not disclosed"`; **never zero**.

## 4. Financial definitions
| Item | Definition |
|---|---|
| Organic growth | Company-reported organic/like-for-like/underlying revenue growth (excl. M&A and FX). Where not reported: `null`. Never substitute reported growth. |
| EBITDA (provider) | PitchBook TTM EBITDA (as reported basis; IFRS 16 for IFRS filers, ASC 842 for US GAAP). |
| EBITDAaL (post-lease) | IFRS filers: EBITDA − lease cash cost proxy. US GAAP filers: EBITDA as reported (operating-lease cost already in EBITDA) − finance-lease principal where disclosed. |
| Lease cash cost proxy (IFRS) | Current lease liability (≈ principal due next 12m) + total lease liability × 4% (interest proxy). Labelled `ESTIMATE`. Replaced by disclosed lease payments when sector agents supply them. |
| Net debt (pre-lease) | Total financial debt excl. lease liabilities − cash & short-term investments. |
| EV (post-lease basis) | Market cap + net debt (pre-lease) + minorities − associates/investments (where available). Used with EBITDAaL. |
| EV (provider basis) | PitchBook EV (includes lease liabilities); used with provider EBITDA for the reconciliation column. |
| Standardised FCF | OCF − capex − lease principal (IFRS: financing-classified lease repayments; proxy above if not disclosed) − (interest paid if classified in financing). Taxes and interest always deducted once. Acquisitions **excluded** from FCF and shown separately. SBC shown separately (not added back). |
| FCF conversion | Standardised FCF / net income (reported), and / EBITDAaL; 3-year cumulative. |
| ROIC | EBIT × (1 − 25% notional tax) / average (equity + net debt incl. leases). Includes goodwill (owner's view). ROIC ex-goodwill reported where available. |
| Leverage | Net debt (pre-lease) / EBITDAaL; and net debt incl. leases / provider EBITDA. Brokers: also gross debt / EBITDA. |
| Shares | Period-end ordinary shares outstanding (ex-treasury) for market cap. Diluted average shares only for per-share earnings. |

## 5. Qualitative rubric (1–5 anchored; 3 = average for the peer group)
Each dimension gets: `score` (1–5 or null), `confidence` (H/M/L), `evidence` (≤3 bullet facts with source ids), `rationale` (one sentence). Missing disclosure lowers **confidence**, not **score**.

| Code | Dimension | 1 | 3 | 5 |
|---|---|---|---|---|
| A | Revenue durability | Discretionary, project/transactional, concentrated | Mixed recurring | >80% recurring/contracted or consumable, >90% retention, no customer >5% |
| B | Competitive advantage | Commodity, easy entry | Some differentiation | Demonstrable switching costs/permits/accreditation/density with evidence (pricing power, retention) |
| C | Scale & market position (economic, not size) | Subscale, no measurable benefit | Scale but unclear economics | Scale shown to produce better margin/retention/win rates vs peers in the relevant (local/niche/global) market |
| D | Growth & reinvestment runway | Saturated, low-return reinvestment | Moderate | Large under-penetrated runway with evidenced high incremental returns |
| E | Geographic diversification | One country >70% or high EM/China risk | Two-region mix | Balanced developed-market spread, no country >40% |
| F | Management quality & stability | Repeated misses, disorderly turnover | Mixed | Delivered guidance, orderly succession, relevant experience |
| G | Capital allocation | Value-destroying M&A, poorly timed buybacks, dilution | Average | Disciplined M&A with evidenced returns, sensible leverage, buybacks below intrinsic value |
| H | Ownership & governance | Weak minority protection, related-party issues | Standard | Strong independence, aligned pay, protective structure (controlling holders noted neutrally) |
| I1 | AI substitution/disintermediation risk | High risk | Moderate | Very low (physical, regulated, on-site service) — **5 = least exposed** |
| I2 | AI/data-centre capex dependence | >25% revenue tied | 5–10% | <2% — **5 = least dependent** |
| I3 | AI productivity opportunity | None | Some | Large cost base addressable |
| I4 | Ability to retain AI savings | Cost-plus/pass-through | Mixed | Fixed-price/value pricing, strong position |
| J | Operational resilience | Unhedged cost exposure, no pass-through | Partial | Contractual pass-through, low cyclicality |
| K | Accounting quality | Large recurring "exceptionals", cash/profit gap | Some adjustments | Clean, cash ≈ profit, consistent disclosure |

## 6. Risk gates (applied before ranking) — status `A` Excluded / `B` Further evidence / `C` Eligible
| Gate | Rule (by subsector) |
|---|---|
| G1 Leverage | Net debt (pre-lease)/EBITDAaL > 3.5x for services/distribution/staples/healthcare; > 4.0x for waste (asset-backed, permits); > 4.5x for regulated water (adjacent); brokers > 4.0x gross debt/EBITDA (post-M&A) → B; > 5.0x (any) → A unless a credible, dated deleveraging path → B. Interest cover (EBIT/interest) < 4x → B. |
| G2 Accounting/governance | Unresolved restatement, auditor qualification, regulator investigation into accounts, material related-party abuse → A; open questions → B. |
| G3 Concentration | Single product/patent >25% of revenue with exclusivity loss within 5 years → A; 15–25% → B. Single customer >15% → B. |
| G4 Cash quality | 3-year cumulative standardised FCF / net income < 60% without a documented temporary cause → B; < 40% → A. |
| G5 AI-capex dependence | >15% revenue tied to AI/data-centre capex → B; >30% → A (inconsistent with diversification objective). |
| G6 Investability | Pending agreed takeover / transaction-dominated / delisting / Chinese domicile → A. |
| G7 Diversification fit | >40% revenue in UK consumer/travel or overlapping speculative themes → B (portfolio-fit flag, not quality). |
A high score never offsets an `A` gate. All gate decisions go in `exclusion_log`.

## 7. Patent-cliff materiality test (Sector 2)
Materiality = revenue share of products losing exclusivity (patent or regulatory) within 5 years of valuation date. ≥25% → `A`; 15–25% → `B`; 5–15% → disclose; <5% immaterial. If product profit is unavailable, revenue share is used and the limitation is stated.

## 8. Scoring weights (fixed before ranking; sensitivity shown, never optimised on returns)
| Pillar | Weight | Inputs |
|---|---|---|
| Quality & durability incl. defensible scale | 25% | A, B, C, J, K, I1 |
| Organic growth/consistency & runway | 20% | 5y organic CAGR, organic volatility, negative years, D |
| Cash conversion & capital efficiency | 20% | 3y FCF/NI, FCF/EBITDAaL, ROIC, FCF/share growth |
| Valuation / prospective return | 25% | Base-case 5y IRR (no multiple expansion), FCF yield, EV/EBITDAaL vs own history and peers |
| Governance & capital allocation | 10% | F, G, H |
Metrics are converted to within-universe percentiles (0–100) then to pillar scores; qualitative scores map 1–5 → 0–100. Alternative weight sets (equal; quality-heavy 35/20/20/15/10; value-heavy 20/15/20/35/10) are reported. Differences < 5 points are not treated as meaningful.

## 9. Prospective returns
Annualised 5y (primary) and 3y (supporting) total return = ((1+g_EBITDA)^n × exit multiple/entry multiple × EV bridge + cumulative FCF to equity) per share. Base: organic growth = 5y median of reported organic (capped by runway judgement), margins flat-to-trend, **exit multiple = current multiple or own 10y median, whichever is lower** (no expansion), FCF used for net debt reduction/buybacks at current price, net share count change = trailing 3y trend. Bear: organic −2pp, margin −100bp, exit multiple = 25th percentile own history (de-rating). Bull: organic +1.5pp, margin +50bp, exit = current multiple. Acquisition growth excluded from base (shown separately as optional upside at stated return on capital). GBP scenarios: local return ± FX scenario (flat; GBP +10%; GBP −10%).

## 10. Return attribution
Price_t = (EBITDA_t × M_t − ND_t − Other_t) / S_t. Changes over 1/3/5y decomposed into EBITDA growth, multiple change, net debt & bridge change, share-count change via **Shapley (order-independent) decomposition** of log-returns across factors; dividends added separately; FX (GBP) separate. Residual vs observed price shown. Shares implied from PitchBook equity value where filings unavailable; implied shares validated against reported shares (tolerance ±3%). Constant-starting-multiple counterfactual reported.

## 11. Qualitative record schema (`research/qual/<ID>.json`)
```json
{
 "id": "CTAS", "name": "", "as_of": "2026-11-12", "agent": "S1",
 "listing": {"status":"listed|pending_takeover|delisted", "exchange":"", "ticker":"", "isin":"", "hq":"", "domicile":"", "corporate_actions":[{"date":"","event":"","source":""}]},
 "pitchbook_pbid": "",
 "geography": {"fy":"", "basis":"revenue|profit", "europe_pct":null, "north_america_pct":null, "uk_pct":null, "other_pct":null, "largest_country":"", "largest_country_pct":null, "china_pct":null, "em_pct":null, "fx_notes":"", "source_ids":[]},
 "organic_growth": [{"fy":"2021","organic_pct":null,"price_pct":null,"volume_mix_pct":null,"acq_pct":null,"fx_pct":null,"reported_pct":null,"source_id":""}],
 "kpis": [{"name":"","value":"","period":"","class":"FACT","source_id":""}],
 "company_fcf": [{"fy":"","definition":"","value":null,"currency":"","source_id":""}],
 "lease": {"lease_principal_paid":[{"fy":"","value":null}], "lease_interest_paid":[{"fy":"","value":null}], "source_id":""},
 "acquisitions": [{"fy":"","cash_spent":null,"currency":"","earnouts":"","notes":"","source_id":""}],
 "management": {"ceo":"","ceo_since":"","cfo":"","cfo_since":"","senior_turnover_5y":"","succession_notes":"","guidance_record":""},
 "ownership": {"controlling_holders":"","dual_class":false,"activists":[{"name":"","since":"","objective":"","company_response":""}],"board_independence":"","remuneration_notes":"","related_party":""},
 "guidance": [{"date":"","item":"","value":"","class":"TARGET","source_id":""}],
 "scores": {"A":{"score":null,"confidence":"","evidence":[],"rationale":""}, "B":{}, "C":{}, "D":{}, "E":{}, "F":{}, "G":{}, "H":{}, "I1":{}, "I2":{}, "I3":{}, "I4":{}, "J":{}, "K":{}},
 "ai": {"ai_dc_capex_revenue_pct":null, "semis_revenue_pct":null, "notes":""},
 "sector_specific": {},
 "gates": {"G1":"C","G2":"C","G3":"C","G4":"C","G5":"C","G6":"C","G7":"C","notes":""},
 "bull_points": [], "bear_points": [], "thesis_breakers": [],
 "sources": [{"id":"S1","title":"","publisher":"","url":"","doc_date":"","retrieved":"2026-11-12","page_ref":""}]
}
```
`sector_specific` keys: S2 `patent_exposure_pct`, `top_product_pct`, `litigation`, `reimbursement`; S3 `price_pct`, `volume_pct`, `private_label_risk`, `top_customer_pct`; S4 `ai_dc_pct`, `semis_pct`, `construction_pct`, `acquisition_growth_pct`; S5 `landfills`, `maintenance_capex_pct_rev`, `env_liabilities`, `commodity_sensitivity`; S6 `organic_ex_rate_note`, `retention_pct`, `contingent_consideration`, `producer_retention`.

## 12. Change log
- 2026-11-12: v1 issued by Lead agent.
- 2026-11-12: Regulated water (adjacent subgroup) G1 assessed on net debt / regulated capital value (gearing) against the regulator's notional gearing, not on EBITDA leverage; EBITDA leverage is shown for information. Outcome capped at `B` unless gearing exceeds 70% of RCV.
- 2026-11-12: Provider reconciliation rules added (EBITDA rebuilt as EBIT + D&A where Yahoo TTM EBITDA = EBIT; PitchBook cross-check flag at ±15%; leases added where provider total debt excludes them; capex derived from FCF − OCF when missing; IFRS interest paid classified in financing deducted from standardised FCF using the cash-flow classification table). Valuation ranking uses EBITDA ex provider-identified unusual items (`ebitda_adj`), reported shown alongside.
- 2026-11-12: Montrose Environmental renamed Onterris (NYSE: ONT, 4-May-2026); Marsh McLennan trades as MRSH from 14-Jan-2026.
- 2026-11-12: Base-case organic growth = 50% × median reported organic (FY2022 onward) + 50% × latest full year (recency weighting after the 2022-23 inflation years), blended down with the latest interim if that is >2pp weaker; capped at 8% (9% only where runway score D = 5) and 4% where D <= 2. Verified series (research/verification) supersede sector-agent series.
