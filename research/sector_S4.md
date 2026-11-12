# Sector 4: Specialist industrials, maintenance and distribution

Agent: S4 · As of 2026-11-12 (valuation close 11-Nov-2026) · Methodology: `docs/methodology.md` v1

This report covers 15 companies in depth (BNZL, DPLM, FAST, GWW, MSM, AIT, WSO, POOL, FERG, TIH, INDT, LIFCO, ADDT, HLMA, SPX) and 3 at screen depth (RS1, ROR, ATCO). The per-company records are in `research/qual/<ID>.json` and the raw PitchBook financials are in `data/raw/pitchbook/<ID>.json`. All 18 PBIDs were found.

It does not rank companies or pick winners. Scores are 1-5, with 3 meaning the peer-group average.

---

## 1. Peer groups

| Peer group | Members | What drives the economics |
|---|---|---|
| **MRO / industrial distribution** | FAST, GWW, MSM, AIT, RS1 | Local density, vending and on-site embedding (FAST, GWW KeepStock, MSM in-plant), technical service (AIT), and SG&A leverage. All are tied to US industrial production. |
| **Building-products / trade distribution** | FERG, WSO, POOL | Branch density, exclusive OEM lines (WSO with Carrier), and RMI (repair, maintenance, improvement) or replacement mix. Exposed to the residential and non-residential construction cycle. |
| **Value-added consumables / specialist components distribution** | BNZL, DPLM | Consumables sold through bolt-on roll-ups. Bunzl is a low-margin, scale-cost model; Diploma is a high-margin, specification-led model. |
| **Serial acquirers (decentralised niche technology)** | INDT, LIFCO, ADDT, HLMA, DPLM (also), BNZL (bolt-ons) | Acquisition multiples, return on acquired capital, organic growth of acquired companies, and a decentralised model. |
| **Aftermarket / installed base** | TIH, SPX, ATCO, ROR | Installed-base service and parts. TIH has an exclusive Caterpillar dealership. SPX, ATCO and ROR earn engineering-led aftermarket revenue. |

---

## 2. Gate flags and key findings

| ID | Gate flags | Why |
|---|---|---|
| **ROR** | **G6 = A** | ABB made a recommended cash offer at 506p, announced 16-Jul-2026. A scheme of arrangement is pending, with completion expected in H1 2027. Excluded and not scored. |
| **HLMA** | **G3 = B, G5 = B** | One hyperscaler customer (Avo Photonics optical switches) is about **20% of group revenue** (FY2026, FACT). It grew 52% in FY26 and is guided to grow about 30% in FY27, so its share is heading toward roughly 23%. Halma is **not** an AI diversifier on its current mix. |
| **TIH** | **G5 = B, G3 = B** | AVL power-generation enclosures were about 13% of Q3-2026 revenue (FACT), and power systems revenue rose 108%. A single large enclosure order doubled the backlog to C$2.9bn for delivery in 2027. ESTIMATE: 13-20% of revenue is linked to data centres. The AVL end-market split is not disclosed. |
| **ATCO** (screen) | **G5 = B (provisional)** | Vacuum Technique orders rose 82% organically in Q3-2026, driven mainly by semiconductor demand. Semiconductor exposure is likely 12-18% of group revenue (INFERENCE) and needs quantifying. |
| **WSO** | **G3 = B** | Dependence on Carrier, which is both the dominant OEM supplier and the joint-venture partner. Watsco also has a dual-class structure under Nahmad family control (noted neutrally under H). |
| All others | C | No leverage, accounting, concentration or investability flags were found at the depth reached. |

No company in the sector is Chinese-domiciled. Ferguson re-domiciled to the US (Delaware) on 1-Aug-2024. It is now NYSE-only, has moved to a calendar fiscal year, and is investable.

---

## 3. AI / data-centre, semiconductor and construction exposure

The principle applied throughout: **an industrial supplier to AI infrastructure is not an AI diversifier.** Values marked FACT are disclosed by the company. Others are ESTIMATE or INFERENCE, with the method given.

| ID | AI/DC % of revenue | Semis % | Construction exposure | Basis |
|---|---|---|---|---|
| HLMA | **~20 (FACT)**, rising to ~23 (ESTIMATE FY27) | n.d. | Fire safety is partly tied to non-residential construction | One hyperscaler customer at 20% of revenue (FY26 call) |
| TIH | **~13-20 (ESTIMATE)** | n.d. | Large: construction, mining and infrastructure equipment plus product support | AVL was 13% of Q3 revenue; power systems +108% |
| ATCO | n.d. | **~12-18 (INFERENCE)** | Power Technique serves construction and rental | VT orders +82%, mainly semiconductor |
| AIT | n.d. (technology vertical inferred 5-10% including semis) | included in the 5-10% | Aggregates and lumber verticals | Fluid power growing in the high teens on semis and DC |
| FERG | **~3.5 (ESTIMATE from management ranges)** | n.d. (within large projects) | ~50/50 residential/non-residential; **~1/3 new construction**, ~2/3 RMI (FACT) | Large capital projects are a mid-to-high single-digit % of revenue, about half of it data centres |
| DPLM | n.d. (INFERENCE mid-single digit via Windy City Wire / IS Group) | immaterial | Windy City Wire is tied to US non-residential construction | Controls +26% organic |
| INDT | n.d. (INFERENCE 3-7%) | n.d. | Infrastructure & Construction is one of five business areas | Energy backlog driven by AI/DC; US power-generation valves |
| ADDT | n.d. (INFERENCE 2-5%) | n.d. | Road and rail machinery niches | One subsidiary with a major AI data-communication customer |
| FAST | n.d. (INFERENCE 2-5%) | n.d. | Non-residential construction end market (high single digit %, not re-verified) | "Strongest growth in data centres" |
| GWW | n.d. (INFERENCE 2-5%) | n.d. | Contractor end market | DC-exposed retail, commercial services and contractor customers |
| SPX | minimal | **~5-8 (INFERENCE, ETS Semicon)** | limited | ETS Semicon growing double digits |
| RS1 | n.d. | indirect (electronics cycle) | limited | Screen depth |
| WSO | ~0 | 0 | Residential HVAC is replacement-led; new-build is a minority | |
| POOL | 0 | 0 | New pool construction and irrigation are housing-linked | |
| BNZL | <1 (INFERENCE) | 0 | Safety sector includes some infrastructure | |
| LIFCO | ~0 | 0 | Demolition & Tools and construction materials | |
| MSM | <2 (INFERENCE) | n.d. | minor | Metalworking/manufacturing |
| ROR | excluded (G6) | | | |

*n.d.* means not disclosed. It is stored as null in the JSON files, never as zero.

**Takeaway:** AI/DC capex is now the main growth engine for HLMA (direct) and TIH (via AVL), and the incremental driver for ATCO (semis vacuum), AIT, FERG, INDT and DPLM. The cleanest diversifiers from AI capex are WSO, POOL, BNZL, LIFCO and MSM. All five carry other cyclical exposures: housing, deflation, or US manufacturing.

---

## 4. Acquisition economics (serial acquirers and roll-ups)

| ID | Recent spend | Multiple paid | Return on acquired capital | Acquired growth | Organic growth (latest) |
|---|---|---|---|---|---|
| BNZL | GBP132m (FY25, 8 deals); <GBP150m over 20 months; ~GBP300m p.a. average 2020-25 | **~8x** pre-synergy operating profit (company) | 2-year ROIC **13.3%** on recent deals; group ROIC 13.3% | +0.9% (H1 26); Morningstar models just under 3% p.a. | +3.2% (H1 26); +0.4% (FY25) |
| DPLM | GBP310m on 15 deals (LTM to May-26) | **~8x EBIT** | Group ROATCE **22.7%** (target high-teens) | +3% (H1 FY26); FY26 guide +6% | +15% (H1 FY26); +11% (FY25) |
| HLMA | **GBP475m (FY26 record)**, including E2S GBP226m | n.d. | Group ROTIC **16.2%**; acquisitions added +3.9% to profit vs +2.5% to revenue | +2.5% (FY26) | +16.2% (FY26; ~8pp from photonics) |
| INDT | 13 deals YTD 2026, SEK2.1bn acquired annual sales | n.d. | Acquired EBITA margin **~18%** (accretive); group ROCE ~19% | **+8%** (Q3 26) | +5-6% (Q3 26) |
| LIFCO | 7 businesses, ~SEK670m sales (9M 26) | n.d. | EBITA / capital employed excluding goodwill **127%** | ~+5pp (9M 26, by subtraction) | +2.5% (9M 26) |
| ADDT | 4 deals, ~SEK500m sales (H1 FY26/27) | n.d. | P/WC (profit / working capital) 82%; **earn-out revaluation +SEK64m** in Q2 | ~+6pp (Q2, by subtraction) | ~+2% (Q2) |
| FERG | 11 deals, ~$1.5bn acquired sales; $1.7bn in Q3 alone (FloWorks) | n.d. | n.d. | +2.7% (Q3 26) | +7% (Q3 26) |
| WSO | Jackson's (~$230m sales) and Granite (~$500m sales) | n.d. | n.d. | ~+3% (Q3 26, ESTIMATE) | +4% same-store |
| TIH | AVL majority stake plus a purchase commitment for the minority | n.d. | Purchase-commitment expense **C$82.5m YTD** | n.d. | n.d. |

Organic growth of acquired businesses: only Diploma (Peerless is the main organic engine in Controls) and Indutrade (acquired EBITA margin) gave usable evidence. Lifco, Addtech and Halma do not disclose organic growth of acquired cohorts in the sources reviewed. This is a data gap.

**Quality flags:**
- Addtech: a Q2 earn-out write-back lifted reported EBITA. Excluding it, the margin is about 15.8% rather than 16.7%.
- Toromont: AVL purchase-commitment revaluations run through the P&L.
- Indutrade and Lifco: acquired growth now exceeds organic growth.

---

## 5. Measurable scale economics (PitchBook TTM, USD-converted; FACT from `data/raw/pitchbook`)

| ID | Latest TTM | Gross margin | EBITDA margin | PitchBook ND/EBITDA (incl. leases) |
|---|---|---|---|---|
| FAST | 3Q2026 | 44.6% | 22.5% | 0.1x |
| GWW | 3Q2026 | 39.4% | 17.3% | 0.7x |
| MSM | 4Q2026 (FY Aug) | 40.9% | 10.4% | 1.1x |
| AIT | 1Q2027 (FY Jun) | 30.4% | 12.5% | 0.3x |
| RS1 | 2Q2027 (FY Mar) | 43.5% | 10.8% | 1.1x |
| WSO | 3Q2026 | 27.2% | 9.7% | net cash |
| POOL | 3Q2026 | 29.4% | 11.6% | 2.2x |
| FERG | 1Q2026 (old FY) | 30.8% | 9.9% | n.d. in series |
| BNZL | 2Q2026 | n.d. | 8.9% | 1.9x |
| DPLM | 2Q2026 | 47.1% | 19.5% | 1.3x |
| TIH | 3Q2026 | 27.4% | 18.3% | net cash |
| INDT | 3Q2026 | 35.7% | 17.3% | 1.5x |
| LIFCO | 3Q2026 | 44.5% | 25.4% | 1.2x |
| ADDT | 2Q2027 (FY Mar) | 33.8% | 14.0% | 1.8x |
| HLMA | 4Q2026 (FY Mar) | 49.8% | 25.2% | 1.2x |
| SPX | 2Q2026 | n.d. | 23.5% | 1.7x |
| ROR | 2Q2026 | 50.5% | 24.3% | net cash |
| ATCO | 3Q2026 | 42.1% | 26.2% | 0.3x |

Evidence that scale or density produces better economics *within* a peer group:

- **MRO.** FAST (~22% EBITDA, ROIC 32.5%) and GWW (High-Touch Solutions operating margin 17.3%) earn about twice the margin of MSM (~10-11%) on similar gross margins. The difference is SG&A leverage: FAST grew sales 15.5% with headcount up less than 1%. Embedded vending and on-site density, not size alone, separates them.
- **Distribution.** Bunzl is the largest player yet runs an ~8% margin, and its North American scale did not stop customer losses in 2025. This is evidence that scale is *not* sufficient where the moat is cost-based.
- **Serial acquirers.** Margin follows niche selection, not group size. LIFCO and HLMA (~25% EBITDA) outrank the larger INDT and ADDT (14-17%).

---

## 6. Runway (qualitative)

- **Long runway, evidenced by high returns:** DPLM, INDT, HLMA (ex-photonics), FAST (key accounts and FMI), GWW (Endless Assortment), FERG (a $400bn TAM after FloWorks).
- **Moderate:** AIT, WSO, SPX, LIFCO, ADDT, BNZL (acquisition-led; organic ~2% long run).
- **Constrained or turnaround:** MSM (execution), POOL (housing/discretionary trough, new CEO), TIH (fixed Caterpillar territories, so growth comes from AVL).

---

## 7. Wider universe screened (not taken to detailed depth)

| Company | Listing | Why not detailed |
|---|---|---|
| Rexel | Euronext Paris | Electrical distribution with high exposure to construction and to cable/copper price pass-through. Lower margins (~6-7% adjusted EBITA) and organic growth tied to the European construction cycle. FERG already covers the construction-distribution sleeve. |
| IMI | LSE | Fluid/motion control. Overlaps with SPX/ROR. Project content in Process Automation and an organic record that varies through the cycle. A reasonable future candidate. |
| Weir | LSE | Mining aftermarket (~65%+ aftermarket). Single end market (mining/commodities). Overlaps with TIH's mining exposure. |
| Wurth Group | Unlisted | Not investable (family-owned). It is a reference peer for FAST/Bunzl-style MRO. |
| Beijer Ref | Nasdaq Stockholm | HVAC-R distribution with higher leverage after acquisitions and an EQT-linked shareholder structure. WSO covers the same theme. |
| Core & Main | NYSE | US waterworks distribution, PE-sponsor legacy. Overlaps with FERG Waterworks and is construction/municipal driven. |
| SiteOne Landscape | NYSE | Landscaping distribution. Housing-linked, low margins, acquisition-led. Overlaps with POOL irrigation. |
| Graco | NYSE | High-quality fluid-handling manufacturer (~25%+ operating margin), mainly US-listed manufacturing. A candidate for an industrial-technology sleeve rather than distribution. Construction (contractor) exposure is meaningful. |
| Nordson | Nasdaq | Precision dispensing with significant electronics/semiconductor and medical exposure. Semis/AI-linked advanced-technology segment, so it fails the diversification intent. |
| Bergman & Beving / Lagercrantz / Beijer Alma | Nasdaq Stockholm | Smaller Swedish serial acquirers. Liquidity and scale are below the universe threshold, and they overlap with INDT/ADDT/LIFCO. |

---

## 8. Contrary evidence (against sector-wide quality assumptions)

1. **The "serial acquirer = compounder" claim is weakening at the organic level.** Lifco is growing 1-3% organically in 2026, Addtech ~2%, and Indutrade's acquired growth (8%) exceeds its organic growth (5%). Earn-out write-backs (ADDT) and purchase-commitment charges (TIH) show acquisition accounting moving reported profit.
2. **Scale is not a moat when it rests on cost alone.** Bunzl's 2025 profit warning (shares fell 25%) came from self-inflicted centralisation and PE-backed roll-ups in North America (Morningstar).
3. **Peak-cycle optics in 2026.** FAST (+15.5%), GWW (+13-14.5% guidance) and AIT ES (+14%) are partly lifted by data-centre and project spend, by price, and by lapping the 2025 US government shutdown (GWW). Management at GWW and DPLM ("margins towards the top end") flag normalisation.
4. **Hidden AI concentration.** Halma has a hyperscaler customer at 20% of revenue. Toromont's backlog doubled on a single AVL enclosure order. These exposures are not visible from "safety/environmental" or "Caterpillar dealer" labels.
5. **Governance/control.** WSO (dual class, founder CEO since 1972), LIFCO (Carl Bennet control), ADDT and ATCO (A/B shares) limit minority influence. These are noted neutrally but are real.

---

## 9. Data gaps (to close before final scoring)

- **IFRS lease cash flows** (principal and interest paid) were not extracted for BNZL, DPLM, HLMA, SPX, INDT, LIFCO, ADDT, TIH, RS1 and ROR. Primary RNS/PDF fetches returned 403 to automated clients (Bunzl, LSE RNS), so the methodology §4 lease proxy will apply.
- **Multi-year organic growth series (2021-2025)** is missing for BNZL, HLMA, SPX, INDT, LIFCO and ADDT. US companies have only reported growth (from PitchBook), not company-defined organic growth. FERG, AIT, MSM and GWW publish organic/daily figures that were not extracted year by year.
- **Geographic splits** are approximate or missing for BNZL, INDT (ESTIMATE), HLMA, SPX, LIFCO, ADDT, POOL, TIH and RS1.
- **AI/DC quantification**: HLMA is disclosed. TIH (AVL end markets), ATCO (semis share of Vacuum Technique), AIT (technology vertical), DPLM (Windy City Wire/IS Group) and INDT/ADDT are not.
- **Unverified details:** some CFO names and tenures (DPLM, LIFCO, SPX, RS1, WSO), exact controlling-holder vote percentages (WSO, LIFCO, ADDT, ATCO, INDT Lundberg stake), and ISINs (taken from prior knowledge, not re-verified this run).
- **Company FCF:** only partial periods were captured (H1/9M/quarter). Standardised FCF must be computed centrally from Yahoo cash-flow data.
- **Halma H1 FY27 (Nov-2026) and Diploma FY26 (Nov-2026) results** fall around the valuation date and were not captured.
- **Ferguson fiscal-year change:** the PitchBook series ends at TTM 1Q2026 under the old July fiscal labels. The period mapping needs care in the financial model.
