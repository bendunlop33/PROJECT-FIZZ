# Sector 1: Business services (TIC, pest & hygiene, uniform/textile rental, facilities management, catering)

Agent: S1 · As of 2026-11-12 (valuation close 11-Nov-2026) · Methodology: `docs/methodology.md` v1

This report covers 14 companies in depth (CTAS, ROL, RTO, ELIS, UNF, ECL, CPG, SW, ARMK, ISS, BVI, SGSN, ITRK, ERF) and 3 at screen depth (ABM, MTO, VSTS). The per-company records are in `research/qual/<ID>.json` and the raw PitchBook financials are in `data/raw/pitchbook/<ID>.json`. All 17 PBIDs were found. CTAS financials were already on file (PBID 41168-44). The other 16 were fetched in this run.

It does not rank companies or pick winners. Scores are 1-5, with 3 meaning the peer-group average. Facts sourced from recall rather than a document fetched in this run are labelled "recall" in the JSON and given confidence L or M.

---

## 1. Peer groups

| Peer group | Members | What drives the economics |
|---|---|---|
| **Route-based uniform / textile rental** | CTAS, UNF, VSTS (screen), ELIS | Route density (stops per route-hour), plant utilisation, garment and linen pool capital, wearer adds and SME penetration. Elis is the European analogue, with no NA overlap. |
| **Route-based pest & hygiene** | ROL, RTO, (ECL hygiene sub-segment) | Branch and technician density, how much of the base is recurring contract versus one-off, residential lead generation, and termite claims. |
| **Consumable hygiene & water** | ECL | Value pricing on dosed chemistry, field-service switching costs, and the water/life-sciences mix. Rising AI/DC exposure through the CoolIT acquisition. Secondary exposure: water (S5). |
| **Contract catering / IFM** | CPG, SW, ARMK, ISS, ABM (screen), MTO (screen) | Retention, net new business, mobilisation costs, wage pass-through, procurement scale, and the contract mix between cost-plus and P&L. |
| **Testing, inspection, certification (TIC)** | BVI, SGSN, ITRK, ERF | Accreditation, lab and inspector network density, regulation-driven demand, and mix (B&I, commodities, consumer, life sciences). Business Assurance (certification) is the part most exposed to AI. |

No single subsector dominates the sample: 4 route rental, 3 pest/hygiene (including ECL), 6 catering/FM, 4 TIC.

---

## 2. Gate flags and key findings

| ID | Gate flags | Why |
|---|---|---|
| **ITRK** | **G6 = A** | EQT has made a recommended cash offer of 6,000p per share (firm offer June 2026, via a scheme of arrangement, about £9.2-9.5bn equity and £10.6bn EV). Completion is expected in Q4-2026 or Q1-2027, subject to regulatory approvals. The shares traded at 5,920p on 28-Oct. **Excluded and not scored.** PitchBook's own profile already describes Intertek as "set to be taken over by EQT". |
| **UNF** | **G6 = A** | The Cintas merger was agreed on 11-Mar-2026 ($155 cash plus 0.7720 CTAS shares per UNF share, about $310/sh, EV about $5.5bn). The Croatti family, with about two-thirds of the votes, signed a voting support agreement, and shareholders approved the deal on 11-Jun-2026. Both companies certified compliance with the FTC Second Request on 2-Oct-2026, and they agreed not to close before 11-Dec-2026 without an FTC closing letter. Press reports (27-Oct) say FTC staff have concerns. **Not closed at the valuation date. Excluded and not scored.** If the FTC blocks the deal, UNF should be re-scored as a standalone company with roughly a 5% EBIT margin. |
| **CTAS** | C (monitor) | Cintas is the acquirer. The UNF deal is about 7% of CTAS EV, so CTAS is not dominated by the transaction. A blocked deal removes a synergy upside of about $375m. A cleared deal adds integration risk and about 14m new shares. |
| **ARMK** | **G1 = B** | Provider net debt/EBITDA is 4.4x (US GAAP, TTM Jun-26). The company's covenant basis is 3.25x, with a dated target below 3.0x. EBIT/interest is about 2.5x (INFERENCE). |
| **ABM** (screen) | **G1 = B (provisional)** | Provider net debt/EBITDA is 4.0x. The company's adjusted basis is lower. |
| **VSTS** (screen) | **G1 = B, G4 = B** | Provider ND/EBITDA is 5.8x, which would be A. It is kept at B because there is a dated deleveraging plan: about 4.1x on guided adjusted EBITDA of $295-325m, a $75m cost programme and a receivables facility. TTM net income is negative. An Elis inquiry produced no deal, and reports of PE interest are unconfirmed. Not G6. |
| **ERF** | **G2 = B** | Laboratory sites are leased from entities owned by the founder and another executive. Muddy Waters published a short report in June 2024. Eurofins rebutted it and commissioned an EY Paris forensic review (Oct-2024). The Martin family has voting control. No regulator investigation or restatement was identified, so this is an open question rather than "material abuse". |
| **MTO** (screen) | **G3 = B (provisional)** | UK central government (MoD, Home Office, other departments) is likely more than 15% of revenue as a single customer group (INFERENCE, not quantified). |
| **SW** | C (borderline) | Provider ND/EBITDA is 3.47x including leases, after FY26 EBITDA fell. FY25 FCF/NI was about 64%, which included an exceptional tax outflow. The lead should confirm G1 and G4 on the standardised basis. Pluxee was spun off in Feb-2024 (historic). |
| **ECL** | C (monitor G1/G5) | Provider ND/EBITDA is 3.3x after the $4.75bn CoolIT purchase, close to the 3.5x threshold. AI/DC exposure is an ESTIMATE of 5-8% and rising (see §3). |
| All others | C | No leverage, accounting, concentration or investability flags were found at the depth reached. |

No company in the sector is Chinese-domiciled. Eurofins is domiciled in Luxembourg and listed in Paris.

**Listing and currency notes**
- **Compass (CPG):** the brief said the shares have been USD-quoted since Jan-2026. **Verified: the LSE trading currency changed from GBp to USD with effect from 1-Apr-2026.** It was flagged in the Q1 statement of 5-Feb-2026 and confirmed by RNS on 18-Mar-2026. The LSE restated historic prices at a fixed 1 GBp = 0.0132080 USD, while Bloomberg used daily FX. **The pipeline must not divide post-April prices by 100**, and dividends are still paid in GBP by default.
- **Rentokil** has reported in USD since FY2024.
- **Sodexo:** pre-FY2024 history includes Pluxee.
- **Aramark:** pre-FY2024 history includes Vestis.

**Rentokil activist:** Trian (Peltz) reportedly gained a board seat in September 2025. This comes from a single secondary source, and the stake size was not found.

---

## 3. AI / data-centre exposure

| ID | AI/DC % of revenue | Basis |
|---|---|---|
| ECL | **~5-8 (ESTIMATE), rising** | CoolIT has about $550m NTM sales, around 3% of the group, bought at about 29x NTM EBITDA. Global High-Tech (DC cooling and microelectronics water) grew 63% organically in Q3-26. **The CoolIT purchase is a deliberate move toward AI-capex demand.** It is below the G5 15% threshold, but it reduces Ecolab's value as a diversifier. |
| MTO (screen) | ~3-8 (ESTIMATE) | Facilities Transformation includes data-centre and grid projects (not quantified). |
| BVI, SGSN | ~2-5 (ESTIMATE) | DC commissioning and inspection within B&I, and connectivity testing. |
| ABM (screen) | <5 (ESTIMATE) | Mission-critical facility services. |
| All others | <2 (INFERENCE) | Catering clients that are tech companies (for example Sodexo's Meta contract) are headcount-linked, not capex-linked. |

**AI-substitution contrary evidence.** Rollins attributed its Q3-26 residential slowdown (+2.3% organic) partly to customers discovering providers through AI-driven search. Rentokil NA residential leads were -1% in September 2026. The service itself cannot be substituted, but **the customer-acquisition funnel is exposed to AI intermediaries**, which supports I1 = 4 rather than 5 for pest control. In TIC, desk-based certification is the line most exposed to automation and price compression: Business Assurance grew +3.2% at BVI and +4.2% at SGS, against 5-8% for testing and inspection.

---

## 4. Dynamics and measurable scale economics

**Route density (uniforms).** On the same service model, TTM provider EBIT margin is 23.4% at Cintas, 5.3% at UniFirst and 3.2% at Vestis (PitchBook, FACT). That is the clearest measurable scale economy in the sector. Some of the gap reflects mix (first aid and fire) and Vestis's restructuring. The FTC's reported concern over the combined Cintas-UniFirst share corroborates that local density matters. Elis earns a 35.4% adjusted EBITDA margin in Europe, which is consistent with the same economics. EBITDA and EBIT are not comparable here because of IFRS 16 and linen depreciation.

**Pest control.** Rollins earns about 18% EBIT (provider) while growing 4-7% organically. Rentokil earns about 9% (IFRS, including Terminix integration costs), with NA pest organic only +1.1% (FY25) to +2.4% (Q3-26). Scale alone, with Rentokil as the global #1, has not produced superior economics. Local density and execution have.

**Catering.** Retention and net new business separate the winners:

| Company | Retention | Organic growth |
|---|---|---|
| Compass | 96% | about 7-9%, NNB 4-5% |
| Aramark | 96.3% | 9-10% in FY26 |
| Sodexo | 94.4% | 2.0% in FY26 |

Procurement scale (Foodbuy, Entegra, GPOs) is common to all three, so it does not explain the gap. Execution and focus on the US market do. Margins are thin (Compass underlying margin 7.2%, Sodexo about 3.4%). That makes **wage pass-through and mobilisation costs** the key swing factors. Pass-through worked in 2022-25: Compass priced about +3% with margin up. Sodexo FY26 underlying operating profit fell 29%, which shows how strong the operating leverage is when growth stalls.

**TIC.** Organic growth is in the mid-single digits:

| Company | Organic growth | Margin | Cash conversion |
|---|---|---|---|
| BVI | 6.5% (FY25) | 16.3% adjusted operating margin | 107% |
| SGS | 5.6% (FY25) | 16.0% AOI margin, +70bp | not stated here |
| Eurofins | 4.1% (FY25) | high capex intensity | lower |

All three are using more M&A (SGS +6.9pts of scope in Q3-26; Eurofins buying Element life sciences). Accreditation and network density are real barriers, but returns are diluted by M&A and, for Eurofins, by lab build-out.

---

## 5. Runway

- **Uniforms:** a large SME market that has not yet adopted uniform programmes, plus first aid and fire cross-sell (Cintas First Aid +14.2% organic).
- **Pest control:** a fragmented US market for tuck-ins (Rollins M&A adds about 4pts a year) and commercial growth.
- **Catering:** first-time outsourcing in US healthcare and education and in European B&I. The 2030 targets imply mid-to-high single-digit organic growth for the leaders.
- **TIC:** regulatory expansion (PFAS, energy transition, cybersecurity and AI assurance).
- **Hygiene/water:** water scarcity and circularity.

The runway is weakest in mature European FM (ISS 4-8%) and in turnaround cases (SW, VSTS, RTO NA).

---

## 6. Contrary evidence and risks to the sector view

1. **Slowing organic growth after inflation.** Elis organic slowed from 3.8% to about 3.3% (9M-26). Rollins went from 7-8% down to 4.4%. Rentokil is around 3%. Pricing tailwinds from 2022-24 are fading.
2. **AI-search disruption to customer acquisition** in residential services (Rollins, Rentokil).
3. **Execution and turnover risk is common.** Rentokil changed CEO, CFO, NA CEO and chair in 2025-26. Sodexo has had three CEOs in five years. Vestis has also had CEO turnover.
4. **Antitrust limits consolidation** (Cintas/UniFirst at the FTC). Larger deals carry M&A premia: Ecolab paid about 29x EBITDA for CoolIT.
5. **US concentration.** CTAS, ROL, ARMK, ABM and VSTS all score E = 1, and Compass is about 68% North America. Diversification has to come from ELIS, ISS, BVI, SGSN, ERF and SW.
6. **Valuation.** The quality names (CTAS at about 26x provider EV/EBITDA, ROL about 18x, ECL about 21x) price in continued compounding. Valuation is assessed by the lead.

---

## 7. Wider universe screened (excluded from detailed work)

This screen is from recall. No new searches were possible after the web-search budget ran out (see §8).

| Company | Status / reason |
|---|---|
| ALS Ltd | Australian-listed TIC/lab testing. Excluded by geography (outside Europe/NA). |
| Applus Services | Taken private by Apollo/TDR in 2024 (recall). Not investable. |
| Element Materials, TÜV SÜD/Rheinland, DEKRA, Kiwa | Private or non-listed. Eurofins acquired Element's life-sciences unit in 2026. |
| Anticimex (pest) | Private (EQT). Terminix was acquired by Rentokil (2022). |
| Lindström, Alsco (textile rental) | Private. |
| Diversey | Taken private by Solenis (2023, recall). |
| Healthcare Services Group (HCSG) | US healthcare housekeeping and dietary. Small, low-margin and customer-concentrated (nursing homes). Not included. |
| Elior (France catering) | Leveraged turnaround with a Derichebourg stake. Below the quality bar. Not included. |
| Serco (UK) | Government outsourcing with very high single-customer exposure (UK/US/Australian governments). G3-type concentration. Not included. |
| Bunzl | Covered in S4 (distribution). |
| Montrose / Onterris, Clean Harbors | Covered elsewhere (S5 / environmental). |

**Honest statement on the sample.** The sample is the universe file's S1 list. It is skewed toward large, liquid European and US names, and private leaders (Anticimex, Element, TÜV/DEKRA) cannot be held. The two route-rental names with the best economics outside Cintas are Elis (Europe) and, if the deal fails, UniFirst. Catering is represented by all three global majors. TIC loses Intertek to EQT, which leaves BVI and SGS as the only listed global diversified TIC options, plus Eurofins in lab testing. Bureau Veritas and SGS each have about 40-50% of revenue in emerging markets (INFERENCE). That makes them a different kind of geographic risk from the US-concentrated route businesses.

---

## 8. Data gaps (for the lead)

1. **Revenue geography splits** for ECL, SW, ARMK, ISS, BVI, SGSN and ROL were not extracted. The JSON gives INFERENCE ranges from recall with confidence L.
2. **IFRS lease principal and interest paid** were not extracted for any IFRS filer (RTO, ELIS, CPG, SW, ISS, BVI, SGSN, ERF, MTO). The lead's proxy (§4) is needed.
3. **Older organic history** (2021-2023) is missing or comes from recall for CTAS, ROL, RTO, ELIS, ECL, CPG, SW, ARMK, BVI, SGSN and ERF. Only ISS has a verified five-year series (2.0 / 8.4 / 9.7 / 6.3 / 4.3).
4. **Management tenure and CFO names** are partly from recall. They were not verified through PitchBook team members, to save tool calls.
5. **Shareholdings** are not verified:
   - Wendel's remaining stake in BVI (ESTIMATE about 14-16%)
   - Bellon SA's stake in Sodexo (about 42% of capital and 55-60% of votes, recall)
   - the Martin family's stake in Eurofins
   - GBL's stake in SGS
   - Trian's stake in Rentokil
6. **Results due after the valuation date:** Compass FY26 (24-Nov-2026), Aramark FY26 (16-Nov-2026), the SGS investor day (about Dec-2026), and the Vestis FY26 results.
7. **Unverified secondary claims:**
   - Rentokil's extra $47m termite provision and the retirement of its NA margin target (Panabee)
   - Rollins' 2026 organic guidance cut to 4-6%
   - BVI's softer guidance wording (MarketScreener/Jefferies)
   - Vestis CEO naming: Barber according to the call, but an 8-K names "Adam K. Bowen"
8. **Search budget.** The shared web-search limit for the session was reached during the TIC research. The remaining items above were not searched.
