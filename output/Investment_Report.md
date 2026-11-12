# Quality compounders at sensible prices: Europe and North America
## Investment report: research universe, rankings, proposed satellite basket

**Valuation date:** close of 11 November 2026, the latest completed session on every covered exchange. **Report date:** 12 November 2026.
**Horizon:** 5 years primary, 3 years supporting. **Base currency:** GBP, unhedged; local-currency results shown alongside.
**Status:** decision support only. The research team executed no trades, did not access any brokerage account, and used no shorting, leverage or derivatives. Every action below is a *proposal requiring the investor's approval*.

**Companion files**
- Workbook: `output/Equity_Research_Workbook.xlsx`
- QC report: `output/QC_Report.md`
- Method: `docs/methodology.md`
- Code: `src/`
- Monitoring: `monitoring/`
- Independent challenge: `research/challenge/challenge_report.md`

---

## 1. Executive conclusions

1. **Only a handful of companies pass the hurdle.** The hurdle is a credible 5-year base-case return of at least about 9% a year without multiple expansion, positive bear cases, and clean risk gates. Of 97 companies researched (88 non-excluded), **five clear it with a margin we consider meaningful.** We propose a **five-name satellite basket**, which is fewer than the 6–10 suggested. We did not pad it to reach a count.

   | Company | Weight (equal baseline) | Base 5y IRR (local) | Bear | Bull |
   |---|---|---|---|---|
   | Coloplast (COLO) | 20% | 11.1% | 5.0% | 13.2% |
   | Bureau Veritas (BVI) | 20% | 11.0% | 4.4% | 13.3% |
   | Compass Group (CPG) | 20% | 10.2% | 0.9% | 13.1% |
   | STERIS (STE) | 20% | 9.8% | 4.0% | 11.7% |
   | WTW | 20% | 9.1% (at hurdle) | 3.2% | 11.1% |

2. **Basket expectations are modest, not spectacular.**
   - Equal-weight base case: **10.3% a year** in local currency.
   - Probability-weighted (25% bear / 50% base / 25% bull): **9.1%**.
   - Base case if sterling strengthens 10% over five years: **8.2% in GBP**.
   - Against broad-equity expectations of roughly 5–8%, the edge is perhaps **1–3 percentage points a year**. It comes with concentration risk.
   - This is a reasonable satellite, not a replacement for the diversified core.

3. **The opportunity is in de-rated quality, not in recent winners.**
   - Every basket name trades at or below its own 10-year median EV/EBITDA. Coloplast is 14.8x against a 26.0x median; STERIS 16.4x against 18.9x; WTW 13.5x against 15.0x; Bureau Veritas 12.7x against 12.9x.
   - That cheapness exists because these shares lagged badly. The basket's retrospective 5-year GBP return is **+2.1% a year against +12.4% for the S&P 500 TR**.
   - The case rests on operating growth and cash returns. It does not rest on mean reversion of the multiple; we assume none.

4. **Diversification versus the investor's existing holdings is real but partial.**
   - 5-year monthly GBP return correlation with the travel holdings (equal-weight Accor/TUI/Jet2) is 0.36. With an MSCI World proxy it is 0.43, and with the FTSE 100 0.47.
   - Basket volatility is about 15%, against 31% for the travel names. It is *not* lower than the S&P 500 (13%).
   - The basket diversifies **away from travel, UK consumer spending, AI infrastructure and speculative themes**. It **adds USD exposure** (about 60% of reporting currency; about 63% North American revenue where disclosed) and a **healthcare-reimbursement factor** (40%).

5. **The basket has minimal AI exposure.**
   - None of the five depends on AI or data-centre capex.
   - Coloplast and STERIS score lowest on AI substitution risk.
   - Bureau Veritas and WTW have moderate, monitored exposure: digital audit pressure for BVI, commission pressure for WTW.

6. **Excluded names.**
   - **Agreed or pending transactions:** UniFirst (Cintas), Intertek (EQT), Kenvue (completed by Kimberly-Clark), McCormick (Unilever Foods combination), Rotork (ABB) and Baldwin (take-private).
   - **Accounting:** Goosehead (restatement).
   - **Standardised leverage:** GFL and Séché.
   - Thirty-four further names need more evidence before they could be bought (gate B). Among them are Halma (one hyperscaler customer is about 20% of revenue), Verisk (debt-funded AccuLynx deal now court-ordered), Aon (post-USI leverage) and Coca-Cola (unresolved IRS case).

7. **The highest-quality businesses are mostly too expensive.**
   - Cintas, Costco, Fastenal, Grainger, L'Oréal, Waste Connections, Rollins and WM would need prices 10–35% lower to reach a 9% base return.
   - We list explicit buy-below levels in §10.

8. **Historical strategy success cannot be demonstrated without hindsight.**
   - A valid point-in-time backtest (Exercise B) was not possible.
   - A survivorship-biased quantitative diagnostic did beat its own equal-weight universe (13.6% against 11.6% a year net over about 9 years). That is suggestive but not proof.

9. **Doing nothing is a legitimate alternative.**
   - If the investor's index core already captures most of the expected return, the basket's main contribution is reducing travel and speculative-theme concentration.
   - The **cash freed from reducing leveraged or speculative positions** may matter more than the stock selection.
   - We cannot quantify that without the investor's weights and borrowing details.

---

## 2. Scope, universe and method (summary)

**Universe.** 97 listed European and North American companies across six sectors. 84 were researched in detail and 13 at screen depth. Each company has one primary sector.

| Sector | Researched | Notes |
|---|---|---|
| S1 Business services | 17 | |
| S2 Consumer health & medical consumables | 17 | |
| S3 Consumer staples | 17 | |
| S4 Specialist industrials & distribution | 18 | |
| S5 Waste, water & environmental | 15 | Includes an explicitly labelled adjacent subgroup: water equipment and regulated water |
| S6 Insurance brokerage & risk services | 13 | Includes adjacent risk-services names |

There are two **honest shortfalls**:
- **S5:** only about 8 independent, listed, pure environmental-service operators exist in Europe and North America. Tetra Tech and Onterris are consulting and testing businesses.
- **S6:** there are effectively no independent listed European brokers; Howden, Ardonagh, Hub and Acrisure are private. Adjacent names are labelled as such rather than padded in.

No company is Chinese-domiciled.

**Data.**
- **PitchBook** (licensed connector): quarterly TTM income statement and balance sheet back to the 1990s, EV history, profiles, transcripts and Morningstar research.
- **Yahoo Finance public endpoints:** prices, dividends, splits, FX, index and ETF levels, and about four years of statements.
- **Company filings**, gathered by six sector agents plus verification passes on 30 shortlist names.
- **Not available or not used:** consensus estimates were not available. SEC EDGAR was not used because it requires a contact e-mail.

**Method.** Full detail is in `docs/methodology.md`.
- **Lease-consistent valuation:** EV excluding leases over EBITDA after lease costs, with IFRS and US GAAP aligned.
- **Standardised post-lease FCF:** interest paid in financing is deducted, acquisitions are excluded, and share-based compensation is shown separately.
- **Point-in-time multiples:** EV/EBITDA history uses realistic reporting lags.
- **Return attribution:** Shapley (order-independent) decomposition.
- **Risk gates before ranking:** A excluded, B further evidence, C eligible.
- **Pillar scores with fixed weights:** quality 25 / growth 20 / cash 20 / valuation 25 / governance 10, with sensitivity tested.
- **Scenarios:** bear, base and bull, with **no multiple expansion in the base case**.
- **Base-case organic growth:** recency-weighted reported organic growth, then **capped at company guidance** for every shortlist name. The independent challenge showed the uncapped rule over-weighted the 2022–23 inflation years.

---

## 3. Sector quality and value rankings

Full tables are in the appendix and in the `S1..S6_Comparison` sheets. Scores are 0–100 within the ranked universe; differences under about 5 points are not meaningful.

| Sector | Highest quality | Best value (valuation pillar) | Best combined | Excluded (gate A) |
|---|---|---|---|---|
| S1 Business services | Cintas, Compass, Elis | ABM, ISS, Elis | Bureau Veritas, Compass, Rollins | Intertek, UniFirst |
| S2 Consumer health & consumables | Coloplast, bioMérieux, STERIS | Coloplast, Haleon, Cooper | Coloplast, STERIS, Alcon | Kenvue |
| S3 Consumer staples | Costco, P&G, Coca-Cola | Couche-Tard, Ahold Delhaize, Unilever | L'Oréal, Costco, Coca-Cola | McCormick |
| S4 Industrials & distribution | Spirax, Atlas Copco, Fastenal | Halma, Bunzl, Ferguson | Halma (B), Ferguson, Watsco (B) | Rotork |
| S5 Waste, water & environmental | Waste Connections, WM, Republic | Befesa, Xylem, Tetra Tech | Tetra Tech (B), Befesa, Veralto | GFL, Séché |
| S6 Brokerage & risk services | Verisk, CorVel, Marsh | Crawford, Aon, Verisk | Verisk (B), WTW, Ryan (B) | Baldwin, Goosehead |

**Sector observations**
- **Staples:** the cheapest names (grocers and Couche-Tard) are cheap for structural reasons, such as thin margins, competition and pending M&A. Higher-quality brand owners show price-led rather than volume-led growth since 2022. Danone's Q3-26 like-for-like growth was +4%, made up of +3.6% price and +0.4% volume.
- **Industrials:** the best compounders (Fastenal, Grainger, Diploma, the Swedish serial acquirers) trade at 20–30x EV/EBITDAaL. Verified data shows Indutrade's and Lifco's organic growth was flat to negative in 2023–25, well below their acquisition-led headline growth. Halma, Toromont and Atlas Copco carry material AI/data-centre or semiconductor exposure (gate G5/G3).
- **Waste:** these are high-quality franchises, but growth is price-led with flat to negative collection volumes (WM, Waste Connections), and they are fully valued.
- **Brokers:** organic growth is decelerating with the softening property/casualty cycle. Marsh is at 4–5% (2026 guide "similar to 2025"), Brown & Brown 1.2%, and WTW 4% in Q3.

---

## 4. Cross-sector shortlist (about 20 names)

| Company | Sector | Gate | Base / bear 5y IRR | Decision |
|---|---|---|---|---|
| Coloplast | S2 | C | 11.1% / 5.0% | **Basket** |
| Bureau Veritas | S1 | C | 11.0% / 4.4% | **Basket** |
| Compass Group | S1 | C | 10.2% / 0.9% | **Basket** (lower end of range) |
| STERIS | S2 | C | 9.8% / 4.0% | **Basket** |
| WTW | S6 | C | 9.1% / 3.2% | **Basket**, at hurdle; accumulate only at or below the buy level |
| Alcon | S2 | C | 9.0% / 3.2% | First reserve: buy below CHF 59.6 |
| SGS | S1 | C | 9.9% / 4.1% | Reserve; would duplicate the TIC factor |
| Haleon | S2 | C | 9.4% / 3.0% | Reserve; would be a fourth healthcare name; China is 9.1% of revenue |
| Marsh (MRSH) | S6 | C | 8.5% / 2.1% | Reserve: buy below about USD 203 |
| EssilorLuxottica | S2 | C | 9.4% / 2.9% | Watch; smart-glasses / AI-hardware angle |
| ISS | S1 | C | 14.5% / 4.4% | Value watch; quality 58; Deutsche Telekom dispute settled (May-26) |
| Elis | S1 | C | 9.6% / 0.3% | Watch; low evidence confidence; linen depreciation flatters EV/EBITDA |
| Danone | S3 | C | 8.9% / 2.1% | Watch; price-led growth |
| Verisk | S6 | B | 10.9% / 5.1% | Blocked: AccuLynx (≈3.6x pro forma); AI debate |
| Halma | S4 | B | 10.5% / 4.4% | Blocked: hyperscaler customer about 20% of revenue |
| Aon | S6 | B | 10.3% / 4.2% | Blocked: leverage about 4.5x after USI |
| Rollins | S1 | C | about 9.0% / 3.1% | Watch: AI-search lead-generation pressure; securities-law investigations |
| Cintas | S1 | C | 5.9% / −0.9% | Quality leader, too expensive (about 29x); buy below about USD 197 |
| L'Oréal | S3 | C | 7.8% / 2.1% | Too expensive; buy below about EUR 422 |
| WM | S5 | C | 7.2% / 0.5% | Too expensive after guidance-consistent growth; buy below about USD 221 |

---

## 5. Proposed concentrated basket

### 5.1 Holdings and valuation (11-Nov-2026)

| | Coloplast | Bureau Veritas | Compass | STERIS | WTW |
|---|---|---|---|---|---|
| Price | DKK 493.2 | EUR 30.05 | USD 33.57 | USD 256.27 | USD 334.18 |
| EV/EBITDAaL (post-lease) | 15.1x | 14.1x | 15.4x | 15.7x | 12.9x |
| EV/EBITDA, point-in-time now vs own 10y median | 14.8x vs 26.0x | 12.7x vs 12.9x | n/a* | 16.4x vs 18.9x | 13.5x vs 15.0x |
| Std. post-lease FCF yield | 5.0% (normalised) | 4.8% (disclosed lease cash incl. interest) | 3.1% (after client investments) | 3.8% | 5.6% |
| P/E (reported) | 36x (impairment-depressed) | 26x | 28x | 30x | 20x |
| Net debt / EBITDAaL (pre-lease) | 2.3x | 1.6x | 1.7x | 0.8x | 1.7x |
| Base organic growth used | 6.0% (guidance 5–7%) | 6.25% | 7.0% (guidance) | 6.5% (FY27 guide 6–7%) | 4.5% (Q3-26 4%) |
| 5y IRR bear / base / bull | 5.0 / 11.1 / 13.2% | 4.4 / 11.0 / 13.3% | 0.9 / 10.2 / 13.1% | 4.0 / 9.8 / 11.7% | 3.2 / 9.1 / 11.1% |
| 3y IRR bear / base / bull | 2.2 / 11.7 / 14.1% | 1.3 / 11.5 / 14.4% | −4.0 / 10.6 / 14.5% | 1.4 / 10.2 / 12.4% | 0.5 / 9.6 / 12.0% |
| Base 5y, GBP +10% / GBP −10% | 9.0 / 13.5% | 8.9 / 13.4% | 8.1 / 12.6% | 7.8 / 12.2% | 7.1 / 11.4% |

\*PitchBook's EV history for Compass fails our implied-share test (−32%), so its own-history multiple is excluded. The bear case then defaults to a 20% de-rating, which is why Compass's bear case is weakest.

### 5.2 Weights and limits for approval

**Equal-weight baseline:** 20% each.

**Recommended ranges for approval:**

| Holding | Range |
|---|---|
| Coloplast | 15–25% |
| Bureau Veritas | 15–25% |
| STERIS | 15–22% |
| Compass | 12–20% |
| WTW | 10–17% |

**Proposed limits:**
- **Single name:** at most 25% of the satellite.
- **Narrow subsector (e.g. medical consumables):** at most 40%, which allows two names.
- **Healthcare reimbursement-exposed names combined:** at most 45%. If Alcon is added as a sixth name, trim Coloplast and STERIS to stay within this.
- **US-insurance-cycle names:** at most 20%.
- **USD reporting exposure:** at most 70% of the satellite.

**Satellite size versus the diversified core.** We cannot recommend a size without the investor's weights, cash and borrowing. As a planning reference only, a satellite of about 10–25% of equity assets keeps the five-name idiosyncratic risk secondary to the index core.

**Leverage first.** Given the disclosed leveraged DeGiro exposure, we would prioritise **retiring margin borrowing before funding new satellite positions**. A margin call in a drawdown converts temporary losses into permanent ones, whatever the long-term thesis.

---

## 6. Investment cases and strongest bear cases

The bear cases are taken from the independent challenge review (`research/challenge/challenge_report.md`, with sources) and our own records.

### Coloplast: chronic-care consumables (ostomy, continence, wound and voice care)
**Case**
- Recurring, prescription-like consumables used for life.
- Verified organic growth of 6–8% *every year* from 2018 to 2025.
- 56% of revenue from Europe.
- Very low AI and cyclical exposure.
- The share price fell about 57% over five years as the multiple compressed from about 37x to about 15x (5-year attribution: EBITDA +23%, multiple −69%). Today's price embeds the growth reset; our base case does not need a re-rating.

**Bear case**
- The cut to a 5–7% organic ambition for 2030 may be structural.
- A Medicare skin-substitute payment change forced a DKK 3.0bn Kerecis impairment. CMS competitive bidding threatens US catheter and ostomy pricing.
- The EBIT margin fell from 27.5% to 25.7%.
- Return on capital was diluted by Atos and Kerecis. A new CEO took over in May 2026.
- The Coloplast foundation holds voting control.

**Thesis-breakers**
- FY26/27 organic growth below 5%.
- EBIT margin below 24%.
- US bidding cuts of more than 5%.
- A further Kerecis impairment.

### Bureau Veritas: testing, inspection and certification
**Case**
- Regulatory and mandatory demand across marine, buildings, certification and consumer products.
- Asset-light, with about 4.8% post-lease FCF yield and FCF/net income of about 1.2x over three years.
- Average ROIC of about 20%.
- Trades at 12.7x EV/EBITDA, in line with its own median, and is the top-5 combined score under every weight set (rank 2–5).

**Bear case**
- Organic growth slowed to 5% in H1-26 from 10.2% in 2024.
- Portfolio churn: the oil, petrochemicals and coal disposal, plus five acquisitions in 2026.
- Pressure on certification from digital and AI audit.
- About 40% EM/APAC exposure.
- Wendel holds about 21% of capital and 35% of votes. That figure is verified and corrects the earlier estimate of 14–16%.
- Highest correlation in the basket with the FTSE 100 (0.56) and with Accor (0.40).

**Thesis-breakers**
- Organic growth below 4%.
- Adjusted operating margin below 15.5%.
- Cash conversion below 90% for two years.

### Compass Group: contract food services
**Case**
- About 65% US revenue.
- A long runway as self-operated catering is outsourced, with retention-led growth and 7% organic guidance.
- Scale purchasing gives it a measurable advantage, with the highest scale score in S1.
- FY26 profit guidance was raised.

**Bear case**
- Less defensive than it looks: TTM EBITDA fell 94% and the shares about 50% in 2020.
- Partly overlaps the investor's leisure exposure (correlation with Accor 0.33).
- The pricing tailwind is fading.
- Net new business of 3.8% in H1 FY26 was below the 4–5% target.
- A 7% margin with about 590k employees means wage-inflation pass-through risk.
- FCF is only about a 3.1% yield after client investments.
- It runs an acquisition programme.

**Thesis-breakers**
- Retention below 95% or net new business below 3% for a year.
- FY27 organic growth below 5%.
- Margin down more than 30bp.

**Event:** FY26 results are due **24 Nov 2026** and form the first thesis checkpoint.

### STERIS: sterilisation consumables, equipment service and outsourced sterilisation (AST)
**Case**
- Recurring hospital and bio-pharma demand.
- Verified organic growth of 6–10% in FY2023–26; FY27 guidance is 6–7%.
- Low leverage (0.8x).
- Trades below its own median multiple.

**Bear case**
- An ethylene-oxide litigation tail; peers have faced $363m verdicts and $408m settlements.
- US hospitals under economic stress, and AST guidance was cut.
- 73% US revenue.
- Low ROIC because of Cantel goodwill.
- Renewed M&A.

**Thesis-breakers**
- AST organic growth below 4% for a year.
- An EtO verdict or settlement above about $250m.
- A plant closure.

### WTW: insurance broking, risk and benefits consulting
**Case**
- Verified organic growth of 2–8% in 2019–25, with no negative year.
- Highest FCF yield in the basket (5.6%), with buybacks.
- Cheaper than Marsh and Gallagher.
- It is the basket's only non-healthcare, non-consumer factor.

**Bear case**
- Organic growth slowed to 4% in Q3-26 as property/casualty rates soften.
- Fiduciary income falls with interest rates.
- AI and embedded distribution could pressure commissions.
- The Newfront integration, talent losses, and a lower quality score (58).
- Purchase only at or below the 9%-IRR price (about USD 336).

**Thesis-breakers**
- Organic growth below 3% for two consecutive years.
- Margin decline.
- Gross leverage above 3.5x after a deal.

---

## 7. Valuation versus history and peers

- **Basket average:** EV/EBITDAaL 14.7x, post-lease FCF yield 4.4%, net debt/EBITDAaL 1.6x.
- **Against history:** Coloplast, STERIS and WTW are below their 10-year point-in-time medians; Bureau Veritas is in line. Compass's history is unreliable.
- **Against peers:**
  - Coloplast trades at 15.1x against Convatec at about 18x.
  - Bureau Veritas trades at 14.1x against SGS at 17.6x. Intertek's EQT bid implies a materially higher private-market value for TIC assets.
  - WTW trades at 12.9x against Marsh at 16.2x and Gallagher at 19.7x.
- **Not cheap because a sector is cheap.** Each name's prospective return is tested on its own growth, margins, capital intensity and leverage. We do not compare across subsectors to call anything "cheap".
- **Forward multiples are not shown.** No licensed consensus was available, and next-calendar-year EBITDA is not presented as next-twelve-months.

## 8. Operating versus multiple-driven returns (5-year Shapley attribution)

**Multiple-driven** (multiple change at least 40% of the 5-year price gain):

| Company | 5y price gain | From multiple |
|---|---|---|
| Loblaw | +181% | +88pp |
| Coca-Cola | +72% | +29pp |
| Colgate | +26% | +40pp |
| Church & Dwight | +24% | +17pp |
| Crawford | +38% | +79pp |
| MLP | +37% | +137pp |
| UniFirst | +20% | +31pp (bid premium) |

These returns should not be extrapolated.

**Operating-driven** (EBITDA growth exceeded the price gain; the multiple fell):

| Company | 5y price gain | EBITDA contribution | Multiple contribution |
|---|---|---|---|
| Republic Services | +87% | +104% | −10% |
| Toromont | +75% | +72% | −3% |
| Gallagher | +73% | +128% | −6% |
| Addtech | +61% | +160% | −95% |
| Elis | +52% | +156% | −108% |
| WM | +49% | +84% | −26% |
| Couche-Tard | +44% | +49% | −7% |
| Waste Connections | +42% | +78% | −25% |
| Marsh | +26% | +54% | −24% |

**Basket names:**
- **Coloplast:** EBITDA +23%, multiple −69%.
- **STERIS:** EBITDA growth offset by de-rating from about 36x.
- **Bureau Veritas:** EBITDA +26%, multiple −25%.
- **WTW:** neutral multiple, with share count adding +41% (buybacks; note the implied-share flag).

The constant-starting-multiple counterfactual shows what operating progress alone would have delivered: Coloplast +3.6% a year, Bureau Veritas +5.6% a year, STERIS +20% a year (cash-flow measure). See the `Attribution` sheet. Compass's attribution is flagged as not meaningful: its abnormal 2021 EBITDA base and the PitchBook EV issue make it unusable.

## 9. Rejected near-misses (why not)

- **Halma:** excellent compounder, but G3/G5. One hyperscaler customer is about 20% of revenue and growing about 30%. That is inconsistent with the AI-capex diversification objective. Revisit if it falls below 15%.
- **Verisk:** strong data moat; base 10.9%. But AccuLynx is court-ordered (pro-forma about 3.6x), Q3 FCF fell 40%, and the AI-commoditisation debate is unresolved. Gate B.
- **Aon:** about 4.5x leverage after USI; revisit after deleveraging. **Ryan Specialty:** leverage and lower quality score; the share count was corrected for its Up-C structure (Class A shares plus LLC units), which doubled its economic market cap.
- **Indutrade and Lifco:** verified flat-to-negative organic growth in 2023–25 against an acquisition-led headline; base IRR 5–6%.
- **Cintas, Costco, Fastenal, Grainger, L'Oréal, Rollins, WM, Waste Connections:** quality is clear; entry valuation is not. Buy-below levels are in the workbook.
- **ISS:** highest base IRR (14.5%), but quality score 58 and a history of contract losses. Small "value watch" only.
- **Séché and Befesa:** apparent FCF yields of 17% and 8% shrank to about 4.6% and about 5% after verification (interest in financing, one-off factoring, a hybrid treated as debt). Séché is now gate A on leverage.

## 10. Buy ranges, review and exit conditions

Each range runs from the price giving a 9% base 5-year IRR (buy-below) to the price giving 7% (fair-maximum), with no multiple expansion. These are ranges, not targets.

| Name | Price (11 Nov) | Buy below (≥9%) | Fair max (7%) | Status |
|---|---|---|---|---|
| Coloplast | DKK 493.2 | DKK 543 | DKK 596 | In buy range |
| Bureau Veritas | EUR 30.05 | EUR 33.0 | EUR 36.1 | In buy range |
| Compass | USD 33.57 | USD 35.5 | USD 38.9 | In buy range |
| STERIS | USD 256.27 | USD 266 | USD 292 | In buy range |
| WTW | USD 334.18 | USD 336 | USD 368 | At threshold; accumulate only at or below |
| Alcon (reserve) | CHF 59.48 | CHF 59.6 | CHF 65.4 | At threshold |
| Marsh (reserve) | USD 207.52 | USD 203 | USD 222 | Just above buy level |

**Review triggers.** The thesis records in `monitoring/theses/` each set 3–5 measurable expectations. A review is triggered by:
- a breach of any thesis-breaker;
- a gate moving to B or A;
- a valuation moving above the fair-maximum price, which prompts a trim review;
- a better after-cost alternative persisting across two weekly reviews.

**What should *not* change the portfolio:**
- a price fall alone;
- a macro headline without an explained link to earnings, financing or valuation;
- small score differences;
- a ranking change that does not persist.

**Exit** on:
- material thesis impairment;
- unacceptable financial risk;
- accounting or governance concerns;
- a materially better after-cost opportunity.

Do not average down automatically. Do not extend a failed thesis because the horizon is long.

## 11. Portfolio fit, exposures and stress tests

**Exposures (equal weight)**
- **Sector:** business services 40% (TIC 20%, catering 20%); healthcare consumables 40%; brokerage 20%.
- **Reporting currency:** USD 60%, DKK 20%, EUR 20%.
- **Listing:** US 40%, EU 40%, UK 20%. Compass is UK-listed but about 65% of its revenue is US.
- **Revenue geography (disclosed, partial coverage):** about 63% North America, about 39% Europe, about 15% UK, minimal China.
- **Shared exposures:**
  - US healthcare reimbursement and hospital spending: Coloplast and STERIS (and Alcon if added).
  - Wage inflation: Compass and Bureau Veritas.
  - The insurance pricing cycle: WTW.
  - USD versus GBP across the basket.

**Stress indicators**

Calibrated rows are computed from provider data. Judgement rows use the 1–3 scale from the scoring rubric.

| Stress | Basket (weighted) | Notes |
|---|---|---|
| Recession: GFC peak-to-trough TTM revenue / EBITDA | −6.8% / −19.4% | 3 of 5 names have data. STERIS's −49% includes impairment-affected reported EBITDA |
| Pandemic shock: TTM EBITDA peak-to-trough | −29% | Driven by Compass (−94%) |
| Market drawdown 2020 / 2022 (GBP TR, daily peak-to-trough) | −31% / −23% | |
| Higher rates: +200bp on half of pre-lease net debt | about 2.8% of FCF | Low leverage limits refinancing risk |
| Stronger sterling: GBP +10% | −9.1% GBP value | Translation only; nearly all revenue is non-GBP |
| Persistent wage inflation | Judgement 1.4 / 3 | Compass and Bureau Veritas pass costs through with a lag |
| Energy-price shock | Low | Mainly STERIS sterilisation plants and Compass food costs |
| AI-capex contraction | Judgement 1.0 / 3 | No basket name depends on AI or data-centre capex |
| Acquisition-market disruption | Low–medium | Acquisitions are 18% of 3-year OCF; Compass and WTW are most acquisitive |

**Standalone versus satellite.** As a standalone portfolio, five names give idiosyncratic risk that is too high: one Kerecis-style impairment or an EtO verdict could cost 5–10% of the portfolio. Volatility of about 15% sits *above* an index fund's. As a satellite alongside a diversified core, these risks are diluted. The basket mainly substitutes for travel, speculative and leveraged exposures.

**What we cannot assess.** We cannot assess whole-portfolio risk or margin-call distance without current weights, cost bases, wrappers and borrowing terms.

## 12. Historical exercises

**Exercise A: retrospective analysis of today's selected companies.** This is *not* a point-in-time investable strategy backtest. It suffers from selection and survivorship bias.

| | 5y CAGR (GBP) | 10y CAGR (GBP) | 5y vol | Max drawdown |
|---|---|---|---|---|
| Basket (equal weight, rebalanced each November) | 2.1% | 8.1% | 14.4% | −24.6% |
| Shortlist (equal weight) | 4.4% | 8.9% | 12.0% | −12.4% |
| Full universe (equal weight) | 4.1% | 10.0% | 12.0% | −11.7% |
| S&P 500 TR (GBP) | 12.4% | 14.4% | 12.9% | −13.7% |
| FTSE 250 TR proxy (GBP) | 5.4% | 6.4% | 15.1% | −25.3% |

Today's selections are historically *poor* performers, because they are selected partly for being de-rated. The point of the strategy is that the starting price has already absorbed the disappointment.

**Exercise B: a point-in-time backtest could not be run validly.** The requirements that are missing are:
- a historical eligible universe including failures and delistings;
- dated qualitative evidence;
- as-first-reported fundamentals.

In its place we ran a **quantitative-only diagnostic** on today's survivors.
- **Rule:** each November, rank by EV/EBITDA discount to own 5-year median plus 3-year TTM EBITDA growth, using reporting lags.
- **Holding:** top third, equal weight.
- **Costs:** 0.30% round trip, 0.5% UK stamp duty, 0.25% FX.

| Result | Value |
|---|---|
| Net CAGR | 13.6% |
| Equal-weight universe | 11.6% |
| Years beating the universe | 6 of 9 |
| Turnover | about 56% a year |
| S&P 500 (GBP) | 14.4% |
| FTSE 250 proxy (GBP) | 5.4% |

Survivorship bias inflates both the strategy and its universe. The result is suggestive that "cheap versus own history plus growing" added value *within* quality survivors. It is **not** evidence of a deployable edge.

## 13. Against doing nothing: index, existing holdings, cash

**Versus a global index fund.**
- Expected index returns are about 5–8% nominal.
- The basket offers about 10% base and about 9% probability-weighted, in local currency, with higher idiosyncratic risk.
- The incremental expected return of about 1–3pp a year is worth having only if the investor accepts the concentration and the five-year horizon.
- **Adding to the index is the default if not.**

**Versus keeping existing travel and speculative holdings.**
- Travel stocks had about 31% volatility and are cyclical and consumer-exposed.
- The basket's expected return does not depend on consumer travel demand or AI enthusiasm.
- The case for switching rests more on **risk reduction and leverage reduction** than on a confident return advantage.
- Any switch must clear after-tax costs, including capital gains outside ISA/SIPP wrappers, which we have not assumed.

**Versus cash.** WTW and Alcon sit at their thresholds. Waiting for the buy-below prices is legitimate. Do not stretch to fill the basket.

**Costs and tax (to verify with the broker; assumptions only).**
- **UK stamp duty:** 0.5% on purchases of UK-incorporated Compass.
- **French FTT:** 0.4% on Bureau Veritas purchases.
- **Irish shares:** WTW is Irish-incorporated but held via DTC on NYSE, where stamp duty normally does not apply. Verify this.
- **No stamp duty:** STERIS (Irish-domiciled, NYSE) and Coloplast.
- **FX conversion:** about 0.25–0.5%; spreads are small for these liquid large caps.
- **Dividend withholding:** US 15% with a W-8BEN; Denmark 27% (part reclaimable); France 25% (part reclaimable). Inside a SIPP or ISA, treatment differs.

## 14. Monitoring, action framework and next steps

The monitoring system is in `monitoring/`; its scheduling specification is in `monitoring/SCHEDULER_SPEC.md`. **No schedule has been activated.**

The daily exception monitor was run once to establish a baseline. Its first findings were:
- Alcon's Q3 guidance narrowing; the base case was cut to 5% growth as a result.
- Coloplast's 2030 ambition cut, already reflected in the base case.
- New reporting periods for most holdings, to be refreshed quarterly.

**Proposed next steps, each needing the investor's approval**
1. Confirm satellite size, the limits in §5.2, and whether to use ISA/SIPP wrappers.
2. Decide whether to reduce margin borrowing first.
3. If approved, build positions within buy ranges over 2–3 tranches. **Compass:** wait for the 24-Nov FY26 results.
4. Authorise (or not) activation of the daily and weekly monitoring schedule.

## 15. Answers to the final questions

1. **Which companies are genuinely highest quality?**
   - Cintas, Costco, Waste Connections, WM, Republic, Coloplast, Verisk, Spirax, P&G, L'Oréal and Compass score highest on evidence-backed durability.
   - Most are fully priced.
2. **Where does scale create measurable economic advantages?**
   - Route density and landfill ownership: the waste majors, Cintas.
   - Purchasing scale: Compass, Costco.
   - Network breadth and accreditation: Bureau Veritas and SGS.
   - Proprietary data networks: Verisk.
   - These are evidenced by margin or retention leadership, not size. A scale score of 5 was given to Cintas, Compass, EssilorLuxottica, Straumann, P&G, L'Oréal, Coca-Cola, Costco, Fastenal, Grainger, Atlas Copco, Waste Connections and Verisk.
3. **Which have the best remaining reinvestment runway?**
   - Compass (outsourcing penetration), Straumann (implants and aligners), Coloplast (chronic care), STERIS (outsourced sterilisation) and Halma (safety and environment).
   - No company earned the top runway score of 5. Evidence of high *incremental* returns was rarely strong enough.
4. **Which offer the best value for their growth and quality?**
   - Bureau Veritas, Coloplast, Compass and STERIS.
   - ISS is cheap, at lower quality.
5. **Which convert earnings into durable FCF per share?**
   - With 3-year FCF/net income of at least 1.0x and FCF per share up more than 5% a year: Compass, STERIS, WTW, Marsh, Gallagher, Verisk, SGS, ISS, Rollins and others (see the workbook).
6. **Which historical returns relied on multiple expansion?**
   - Loblaw, Coca-Cola, Colgate, Church & Dwight, Crawford, MLP and UniFirst (bid).
7. **Which are genuinely less exposed to AI downside?**
   - Coloplast, STERIS, Alcon, Straumann, bioMérieux, Cintas, Elis, WM, Republic, Waste Connections and the grocers.
   - Higher risk: Tetra Tech, TWFG, Crawford, MLP, Verisk (debated) and Rollins (customer acquisition).
   - AI-capex dependent: Halma, Toromont, Atlas Copco.
8. **Which combinations complement the existing portfolio?**
   - Healthcare consumables plus TIC plus contract services plus a broker.
   - Low correlation with travel (0.36), no AI-capex dependence, no UK consumer reliance.
   - It does add USD exposure.
9. **Can historical strategy success be demonstrated without hindsight?**
   - No. Only a survivorship-biased diagnostic was possible.
10. **Why buy these rather than retain existing holdings or an index?**
    - Only to diversify away from travel, speculative and leveraged risk at a modest expected-return premium.
    - If that premium does not justify the concentration, prefer the index.
11. **What would justify changing the portfolio, and what would not?**
    - Change it for: thesis-breakers, gate changes, valuation outside the ranges, or persistent better after-cost alternatives.
    - Do not change it for: price moves, macro headlines or rank noise.

*Historical success does not guarantee future returns. Scenario outputs are conditional illustrations, not forecasts.*

---

## Appendix: sector comparison tables (pipeline output)

Columns: quality, growth, cash and value pillar scores (0–100); Q-rank and V-rank within the sector; EV/EBITDAaL; point-in-time EV/EBITDA now versus own 10-year median; post-lease FCF yield; base organic growth; 5-year IRR (bear / base / bull); 5-year GBP TSR; and the 5-year multiple contribution to price change.

### S1 - Business services

| Company | Peer group | Gate | Quality | Growth | Cash | Value | Score | Q-rank | V-rank | EV/EBITDAaL | vs own 10y med (PIT) | FCF yld | g base | 5y IRR bear/base/bull | 5y TSR GBP p.a. | 5y multiple contrib. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bureau Veritas (BVI) | TIC | C | 71 | 74 | 66 | 76 | 72 | 6 | 4 | 14.1x | 12.7x / 12.9x | 4.8% | 6.2% | 4% / 11% / 13% | 3.2% | -25% |
| Compass Group (CPG) | Catering & facilities | C | 83 | 72 | 57 | 62 | 70 | 2 | 5 | 15.4x | n/a / n/a | 3.1% | 7.0% | 1% / 10% / 13% | 12.3% | -1443% |
| Rollins (ROL) | Route-based hygiene/uniform | C | 71 | 70 | 74 | 59 | 67 | 6 | 7 | 22.2x | 22.6x / 32.2x | 3.6% | 5.9% | 3% / 9% / 11% | 3.0% | -41% |
| Cintas (CTAS) | Route-based hygiene/uniform | C | 96 | 85 | 59 | 24 | 67 | 1 | 15 | 28.6x | 29.0x / 23.6x | 2.2% | 8.0% | -1% / 6% / 12% | 17.1% | 19% |
| SGS (SGSN) | TIC | C | 67 | 77 | 63 | 61 | 67 | 7 | 6 | 17.6x | 15.5x / 14.7x | 4.0% | 6.6% | 4% / 10% / 13% | 5.1% | -8% |
| ISS A/S (ISS) | Catering & facilities | C | 58 | 51 | 70 | 88 | 66 | 10 | 2 | 10.6x | 10.8x / 10.8x | 9.2% | 5.8% | 4% / 14% / 18% | 19.2% | n/a |
| ABM Industries (ABM) | Catering & facilities | B | 55 | 54 | 50 | 90 | 63 | 12 | 1 | 10.4x | 11.5x / 12.0x | 9.8% | 6.0% | 3% / 15% / 19% | 4.5% | 0% |
| Elis (ELIS) | Route-based hygiene/uniform | C | 83 | 35 | 38 | 79 | 62 | 2 | 3 | 5.5x | n/a / n/a | 5.6% | 3.8% | 0% / 10% / 12% | 10.7% | -108% |
| Ecolab (ECL) | Route-based hygiene/uniform | C | 79 | 60 | 42 | 28 | 54 | 4 | 14 | 24.3x | 24.3x / 22.2x | 2.1% | 5.9% | 1% / 6% / 10% | 7.1% | -25% |
| Mitie Group (MTO) | Catering & facilities | B | 55 | 43 | 80 | 35 | 53 | 12 | 12 | 13.6x | 10.9x / 8.1x | 5.3% | 5.3% | -7% / 4% / 14% | 28.8% | -131% |
| Aramark (ARMK) | Catering & facilities | B | 62 | 69 | 36 | 43 | 53 | 8 | 10 | 14.3x | 14.7x / 12.8x | 3.1% | 7.0% | -1% / 8% / 15% | 15.7% | -167% |
| Rentokil Initial (RTO) | Route-based hygiene/uniform | B | 62 | 46 | 30 | 57 | 48 | 8 | 8 | 14.5x | 12.9x / 15.0x | 4.4% | 2.6% | -0% / 7% / 10% | -9.4% | -43% |
| Sodexo (SW) | Catering & facilities | B | 54 | 30 | 32 | 47 | 42 | 14 | 9 | 14.0x | n/a / n/a | 4.0% | 2.6% | -9% / 7% / 12% | 5.5% | -401% |
| Eurofins Scientific (ERF) | TIC | B | 54 | 51 | 28 | 32 | 41 | 14 | 13 | 14.3x | 13.4x / 13.9x | 1.7% | 4.1% | -2% / 5% / 8% | -2.6% | -0% |
| Vestis (VSTS) | Route-based hygiene/uniform | B | 40 | 24 | 42 | 35 | 38 | 15 | 11 | 13.1x | 14.5x / 11.0x | 7.2% | 0.0% | -11% / -1% / 9% | n/a | n/a |
| Intertek (ITRK) | TIC | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 14.9x | 13.5x / 14.1x | 4.0% | 4.3% | 2% / 8% / 10% | 5.8% | -10% |
| UniFirst (UNF) | Route-based hygiene/uniform | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 15.3x | 15.0x / 11.2x | 1.6% | 5.7% | -4% / 1% / 9% | 4.5% | 31% |

### S2 - Consumer health & medical consumables

| Company | Peer group | Gate | Quality | Growth | Cash | Value | Score | Q-rank | V-rank | EV/EBITDAaL | vs own 10y med (PIT) | FCF yld | g base | 5y IRR bear/base/bull | 5y TSR GBP p.a. | 5y multiple contrib. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Coloplast (COLO) | Medical consumables | C | 83 | 75 | 56 | 86 | 73 | 2 | 1 | 15.1x | 14.8x / 26.0x | 5.0% | 6.0% | 5% / 11% / 13% | -13.8% | -69% |
| STERIS (STE) | Medical consumables | C | 79 | 74 | 59 | 70 | 70 | 4 | 5 | 15.7x | 16.4x / 18.9x | 3.8% | 6.5% | 4% / 10% / 12% | 3.1% | -103% |
| Alcon (ALC) | Vision/hearing/dental | C | 75 | 60 | 54 | 75 | 67 | 5 | 3 | 13.7x | 14.6x / 22.4x | 4.8% | 5.0% | 3% / 9% / 11% | -2.1% | -58% |
| Straumann (STMN) | Vision/hearing/dental | C | 79 | 77 | 45 | 53 | 65 | 4 | 10 | 28.9x | 26.2x / 30.5x | 1.8% | 8.0% | 3% / 9% / 11% | -9.6% | -57% |
| Haleon (HLN) | Consumer health brands | C | 67 | 38 | 62 | 82 | 63 | 8 | 2 | 13.7x | 13.5x / 15.8x | 6.2% | 3.7% | 3% / 9% / 12% | n/a | n/a |
| bioMerieux (BIM) | Diagnostics | C | 83 | 53 | 45 | 58 | 60 | 2 | 9 | 14.0x | 13.8x / 15.8x | 5.1% | 3.4% | 2% / 8% / 10% | -2.5% | -3% |
| EssilorLuxottica (EL) | Vision/hearing/dental | C | 71 | 64 | 31 | 67 | 59 | 6 | 7 | 16.3x | 13.9x / 16.4x | 3.4% | 6.0% | 3% / 9% / 11% | 2.0% | -43% |
| Smith & Nephew (SN) | Medtech | B | n/a | 40 | 50 | 70 | 58 | n/a | 6 | 10.2x | 10.2x / 13.5x | 6.1% | 3.2% | 2% / 9% / 11% | 0.3% | -45% |
| Galderma (GALD) | Consumer health brands | C | 62 | 68 | 64 | 33 | 56 | 12 | 13 | 41.7x | 40.8x / 39.9x | 1.8% | 6.0% | 2% / 7% / 10% | n/a | n/a |
| Sonova (SOON) | Vision/hearing/dental | C | 62 | 53 | 57 | 49 | 56 | 12 | 11 | 20.5x | n/a / n/a | 3.2% | 5.4% | 1% / 8% / 10% | -2.3% | -41% |
| Ambu (AMBU) | Medical consumables | C | n/a | 75 | 12 | 64 | 56 | n/a | 8 | 14.7x | 20.8x / 45.7x | 1.8% | 8.0% | 3% / 9% / 11% | -15.0% | -114% |
| Cooper Companies (COO) | Vision/hearing/dental | C | 67 | 43 | 31 | 74 | 53 | 8 | 4 | 15.2x | 15.6x / 21.7x | 5.7% | 3.8% | 3% / 9% / 11% | -9.2% | -52% |
| Demant (DEMANT) | Vision/hearing/dental | B | 62 | 55 | 57 | 14 | 48 | 12 | 15 | 21.3x | 27.1x / 19.4x | 3.0% | 4.5% | -7% / 1% / 10% | 1.7% | -11% |
| Convatec (CTEC) | Medical consumables | B | 67 | 55 | 41 | 20 | 47 | 8 | 14 | 18.9x | 17.8x / 16.8x | 1.8% | 3.5% | -3% / 4% / 8% | 5.4% | 20% |
| Becton Dickinson (BDX) | Medical consumables | C | 62 | 23 | 54 | 37 | 45 | 12 | 12 | 16.2x | 15.5x / 19.9x | 4.6% | -2.0% | -5% / 1% / 4% | 4.6% | -53% |
| Kenvue (KVUE) | Consumer health brands | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 13.4x | n/a / n/a | 6.3% | 0.4% | -2% / 6% / 8% | n/a | n/a |
| Perrigo (PRGO) | Consumer health brands | B | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a / n/a | 7.3% | -1.0% | n/a / n/a / n/a | -13.9% | n/a |

### S3 - Consumer staples & household

| Company | Peer group | Gate | Quality | Growth | Cash | Value | Score | Q-rank | V-rank | EV/EBITDAaL | vs own 10y med (PIT) | FCF yld | g base | 5y IRR bear/base/bull | 5y TSR GBP p.a. | 5y multiple contrib. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L'Oreal (OR) | HPC | C | 83 | 70 | 61 | 42 | 65 | 4 | 10 | 22.6x | 21.7x / 21.4x | 3.0% | 6.0% | 3% / 8% / 11% | 2.7% | -34% |
| Costco Wholesale (COST) | Essential retail | C | 92 | 83 | 62 | 6 | 62 | 1 | 16 | 31.1x | 34.1x / 22.5x | 1.9% | 6.6% | -8% / 0% / 11% | 17.6% | 28% |
| Coca-Cola (KO) | Food & beverage | B | 83 | 64 | 45 | 48 | 61 | 4 | 9 | 20.9x | 23.8x / 21.1x | 3.4% | 8.0% | 5% / 9% / 13% | 14.9% | 29% |
| Alimentation Couche-Tard (ATD) | Essential retail | B | 62 | 51 | 32 | 87 | 60 | 14 | 1 | 9.1x | 9.3x / 10.5x | 6.0% | 6.0% | 4% / 12% / 15% | 8.7% | -7% |
| Danone (BN) | Food & beverage | C | 62 | 42 | 55 | 71 | 59 | 14 | 3 | 12.0x | 12.5x / 12.7x | 5.1% | 4.5% | 2% / 9% / 12% | 6.3% | -20% |
| Colgate-Palmolive (CL) | HPC | C | 67 | 47 | 89 | 31 | 58 | 10 | 14 | 17.5x | 22.7x / 17.6x | 4.9% | 4.6% | 0% / 4% / 11% | 7.3% | 40% |
| Lindt & Spruengli (LISN) | Food & beverage | C | 62 | 65 | 33 | 66 | 58 | 14 | 6 | 17.4x | 16.5x / 22.9x | 3.2% | 6.2% | 3% / 9% / 11% | -2.3% | -68% |
| Ahold Delhaize (AD) | Essential retail | C | 71 | 22 | 44 | 85 | 57 | 6 | 2 | 5.9x | 4.5x / 4.8x | 8.0% | 3.2% | 2% / 10% / 13% | 7.1% | -40% |
| Church & Dwight (CHD) | HPC | B | 62 | 65 | 71 | 33 | 57 | 14 | 13 | 21.1x | 21.7x / 19.3x | 4.0% | 4.6% | 1% / 6% / 10% | 5.8% | 17% |
| Unilever (ULVR) | HPC | B | 67 | 40 | 44 | 68 | 55 | 10 | 4 | 13.7x | n/a / n/a | 4.8% | 4.5% | 2% / 9% / 11% | 6.9% | 5% |
| Procter & Gamble (PG) | HPC | B | 83 | 30 | 48 | 39 | 54 | 4 | 12 | 16.8x | 17.4x / 17.4x | 3.9% | 2.5% | 0% / 6% / 8% | 5.5% | -6% |
| Nestle (NESN) | Food & beverage | B | 71 | 32 | 62 | 51 | 52 | 6 | 7 | 18.5x | 19.4x / 17.7x | 5.5% | 4.0% | 2% / 7% / 12% | -1.9% | -13% |
| Reckitt (RKT) | HPC | B | 67 | 44 | 33 | 66 | 52 | 10 | 5 | 9.5x | 9.3x / 15.8x | 3.7% | 4.6% | 2% / 8% / 10% | 1.8% | -2912% |
| Henkel (HEN3) | HPC | C | 62 | 30 | 62 | 48 | 50 | 14 | 8 | 11.2x | 10.5x / 10.7x | 5.3% | -0.2% | -1% / 5% / 7% | 5.1% | 6% |
| Loblaw (L) | Essential retail | C | 83 | 42 | 37 | 18 | 48 | 4 | 15 | 15.1x | 13.4x / 9.7x | 4.0% | 2.9% | -5% / 1% / 9% | 21.4% | 88% |
| Beiersdorf (BEI) | HPC | B | 67 | 25 | 29 | 40 | 42 | 10 | 11 | 9.6x | 9.8x / 16.9x | 3.0% | 1.1% | -1% / 4% / 5% | -1.9% | -49% |
| McCormick (MKC) | Food & beverage | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 13.4x | 13.9x / 21.7x | 7.3% | 3.6% | 3% / 10% / 13% | -8.2% | -48% |

### S4 - Specialist industrials & distribution

| Company | Peer group | Gate | Quality | Growth | Cash | Value | Score | Q-rank | V-rank | EV/EBITDAaL | vs own 10y med (PIT) | FCF yld | g base | 5y IRR bear/base/bull | 5y TSR GBP p.a. | 5y multiple contrib. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Halma (HLMA) | Safety & specialist components | B | 75 | 81 | 55 | 65 | 70 | 6 | 1 | 22.3x | 21.6x / 23.2x | 2.7% | 8.0% | 4% / 11% / 13% | 3.6% | -55% |
| Ferguson Enterprises (FERG) | Distribution | C | 67 | 66 | 64 | 63 | 65 | 12 | 3 | 17.6x | n/a / n/a | 3.6% | 6.0% | 1% / 9% / 12% | 13.4% | 17% |
| Watsco (WSO) | Distribution | B | 71 | 41 | 84 | 55 | 61 | 9 | 6 | 19.2x | 17.7x / 18.4x | 5.1% | 3.7% | 1% / 8% / 10% | 4.2% | -21% |
| Diploma (DPLM) | Distribution | C | 71 | 80 | 72 | 14 | 59 | 9 | 15 | 27.8x | 31.7x / 22.5x | 2.6% | 8.0% | -1% / 4% / 12% | 19.8% | -53% |
| Lifco (LIFCO) | Aftermarket/serial acquirers | C | 79 | 41 | 63 | 46 | 59 | 4 | 7 | 19.4x | 19.0x / 21.5x | 3.6% | 3.1% | 1% / 7% / 9% | 0.3% | -69% |
| Spirax Group (SPX) | Safety & specialist components | C | 88 | 46 | 38 | 55 | 58 | 1 | 5 | 17.1x | 15.3x / 18.8x | 3.0% | 4.8% | 1% / 8% / 10% | -13.2% | -61% |
| Atlas Copco (ATCO) | Safety & specialist components | B | 83 | 62 | 52 | 30 | 58 | 2 | 10 | 21.6x | 20.8x / 17.8x | 2.6% | 6.0% | 1% / 5% / 10% | 6.0% | -23% |
| Applied Industrial Technologies (AIT) | Distribution | C | 62 | 67 | 67 | 33 | 57 | 14 | 9 | 17.5x | 18.3x / 14.5x | 3.8% | 6.0% | -1% / 5% / 12% | 24.8% | 9% |
| Pool Corp (POOL) | Distribution | C | 75 | 26 | 76 | 55 | 57 | 6 | 4 | 13.9x | 14.8x / 20.3x | 5.7% | 0.3% | -2% / 5% / 8% | -15.8% | -55% |
| Fastenal (FAST) | Distribution | C | 83 | 74 | 54 | 4 | 55 | 2 | 17 | 31.0x | 32.6x / 20.6x | 1.8% | 6.0% | -7% / -1% / 10% | 16.2% | 32% |
| Addtech (ADDT) | Aftermarket/serial acquirers | C | 58 | 70 | 69 | 23 | 55 | 15 | 13 | 26.2x | 30.1x / 25.1x | 2.7% | 6.0% | -3% / 5% / 11% | 8.5% | -95% |
| Bunzl (BNZL) | Distribution | C | 62 | 35 | 57 | 63 | 54 | 14 | 2 | 10.6x | 10.9x / 12.6x | 7.2% | 0.4% | -1% / 7% / 10% | 3.4% | -21% |
| Indutrade (INDT) | Aftermarket/serial acquirers | C | 71 | 47 | 64 | 28 | 54 | 9 | 11 | 20.4x | 18.5x / 19.3x | 3.3% | 0.2% | -3% / 3% / 6% | -0.3% | -90% |
| W.W. Grainger (GWW) | Distribution | C | 71 | 74 | 44 | 10 | 50 | 9 | 16 | 21.5x | 24.1x / 15.5x | 2.5% | 6.0% | -6% / -0% / 10% | 26.4% | 61% |
| Toromont Industries (TIH) | Aftermarket/serial acquirers | B | 71 | 54 | 35 | 25 | 48 | 9 | 12 | 13.1x | 15.4x / 12.4x | 2.0% | 6.0% | -1% / 4% / 10% | 10.7% | -3% |
| RS Group (RS1) | Distribution | C | 50 | 26 | 37 | 40 | 39 | 16 | 8 | 13.0x | 13.1x / 12.5x | 5.1% | 0.0% | -4% / 4% / 7% | -5.1% | -62% |
| MSC Industrial Direct (MSM) | Distribution | C | 46 | 36 | 37 | 18 | 35 | 17 | 14 | 17.2x | 17.1x / 11.4x | 3.3% | 3.3% | -6% / -1% / 9% | 11.6% | 13% |
| Rotork (ROR) | Safety & specialist components | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 21.3x | 20.8x / 16.9x | 2.5% | 4.0% | -2% / 2% / 8% | 8.5% | -1% |

### S5 - Waste, water & environmental services

| Company | Peer group | Gate | Quality | Growth | Cash | Value | Score | Q-rank | V-rank | EV/EBITDAaL | vs own 10y med (PIT) | FCF yld | g base | 5y IRR bear/base/bull | 5y TSR GBP p.a. | 5y multiple contrib. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tetra Tech (TTEK) | Environmental services | B | 46 | 64 | 66 | 78 | 64 | 12 | 3 | 14.7x | 15.7x / 19.4x | 5.7% | 6.0% | 4% / 11% / 13% | 1.8% | -98% |
| Befesa (BFSA) | Environmental services | C | 58 | 49 | 53 | 88 | 62 | 10 | 1 | 9.3x | 9.0x / 10.0x | 5.8% | 6.0% | 5% / 12% / 15% | -6.9% | -73% |
| Veralto (VLTO) | Adjacent: water equipment/instrumentation | C | 75 | 67 | 61 | 36 | 60 | 6 | 9 | 21.6x | 21.8x / 20.2x | 3.8% | 4.9% | 2% / 7% / 10% | n/a | n/a |
| Xylem (XYL) | Adjacent: water equipment/instrumentation | C | 58 | 65 | 37 | 82 | 60 | 10 | 2 | 12.5x | 13.2x / 20.2x | 4.2% | 6.0% | 4% / 10% / 12% | -4.8% | -89% |
| Republic Services (RSG) | Solid waste | C | 88 | 60 | 37 | 43 | 59 | 2 | 8 | 17.1x | 17.7x / 15.5x | 3.4% | 6.0% | -0% / 7% / 12% | 14.8% | -10% |
| WM (Waste Management) (WM) | Solid waste | C | 88 | 46 | 32 | 50 | 56 | 2 | 5 | 15.2x | 16.0x / 15.2x | 3.9% | 4.2% | 1% / 7% / 10% | 10.1% | -26% |
| Waste Connections (WCN) | Solid waste | C | 92 | 50 | 36 | 34 | 54 | 1 | 10 | 18.4x | 19.4x / 19.6x | 2.4% | 3.5% | -0% / 6% / 8% | 8.1% | -25% |
| Onterris (formerly Montrose Environmental) (MEG) | Environmental services | B | 38 | 55 | 65 | 66 | 53 | 13 | 4 | 17.0x | 17.3x / 55.6x | 8.3% | 5.0% | 0% / 8% / 11% | -21.1% | -539% |
| Casella Waste Systems (CWST) | Solid waste | B | 58 | 71 | 29 | 46 | 50 | 10 | 6 | 19.4x | 18.9x / 22.9x | 1.3% | 6.0% | 1% / 8% / 10% | 2.7% | -66% |
| Clean Harbors (CLH) | Environmental services | C | 71 | 65 | 34 | 25 | 50 | 8 | 12 | 13.0x | 14.8x / 11.4x | 3.2% | 6.0% | -2% / 4% / 11% | 22.5% | 51% |
| Severn Trent (SVT) | Adjacent: regulated water | B | 79 | 67 | 7 | 28 | 47 | 5 | 11 | 13.1x | n/a / n/a | -7.0% | 6.0% | -12% / 4% / 7% | 7.6% | -21% |
| American Water Works (AWK) | Adjacent: regulated water | B | 83 | 64 | 7 | 21 | 45 | 4 | 13 | 15.1x | 15.1x / 15.5x | -4.5% | 5.5% | -6% / 4% / 6% | -0.4% | -48% |
| Veolia Environnement (VIE) | Environmental services | B | 71 | 29 | 21 | 45 | 45 | 8 | 7 | 6.7x | 6.6x / 6.1x | 3.8% | 2.8% | -2% / 6% / 11% | 7.0% | -93% |
| GFL Environmental (GFL) | Solid waste | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 23.6x | n/a / n/a | 0.5% | 5.5% | -3% / 7% / 10% | 2.5% | -107% |
| Seche Environnement (SCHP) | Environmental services | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 9.4x | 6.6x / 7.3x | 4.6% | 0.7% | -14% / 6% / 11% | 4.7% | -16% |

### S6 - Insurance brokerage & specialist risk services

| Company | Peer group | Gate | Quality | Growth | Cash | Value | Score | Q-rank | V-rank | EV/EBITDAaL | vs own 10y med (PIT) | FCF yld | g base | 5y IRR bear/base/bull | 5y TSR GBP p.a. | 5y multiple contrib. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Verisk Analytics (VRSK) | Specialist risk services | B | 83 | 61 | 73 | 80 | 74 | 1 | 3 | 17.6x | 18.5x / 23.2x | 4.2% | 6.7% | 5% / 11% / 13% | 0.1% | -46% |
| Ryan Specialty (RYAN) | US brokers & specialty | B | 46 | 85 | 68 | 74 | 65 | 9 | 5 | 17.5x | n/a / n/a | 4.2% | 8.0% | 5% / 13% / 15% | 5.0% | n/a |
| CorVel (CRVL) | Specialist risk services | C | 71 | 70 | 68 | 45 | 63 | 2 | 8 | 20.5x | 22.1x / 21.7x | 3.0% | 6.0% | -1% / 8% / 10% | 5.2% | -62% |
| Willis Towers Watson (WTW) | Global brokers | C | 58 | 42 | 86 | 72 | 63 | 6 | 6 | 12.9x | 13.5x / 15.0x | 5.6% | 4.5% | 3% / 9% / 11% | 9.3% | -2% |
| Aon (AON) | Global brokers | B | 67 | 58 | 43 | 82 | 62 | 4 | 2 | 12.5x | 12.8x / 19.2x | 4.6% | 6.0% | 4% / 10% / 12% | 3.2% | -72% |
| Marsh McLennan (Marsh) (MMC) | Global brokers | C | 67 | 53 | 55 | 56 | 60 | 4 | 7 | 16.2x | 16.9x / 17.5x | 4.2% | 4.5% | 2% / 8% / 11% | 6.5% | -24% |
| Arthur J. Gallagher (AJG) | Global brokers | C | 67 | 74 | 57 | 41 | 60 | 4 | 9 | 20.0x | 21.3x / 18.7x | 4.0% | 6.0% | 2% / 8% / 12% | 12.9% | -6% |
| Brown & Brown (BRO) | US brokers & specialty | C | 50 | 42 | 49 | 76 | 55 | 7 | 4 | 12.0x | 12.7x / 16.6x | 6.4% | 2.9% | 2% / 9% / 11% | 3.2% | -71% |
| Crawford & Company (CRD) | Specialist risk services | B | 33 | 20 | 56 | 83 | 48 | 11 | 1 | 6.0x | n/a / n/a | 8.8% | 2.4% | 1% / 10% / 13% | 10.1% | 79% |
| TWFG (TWFG) | US brokers & specialty | C | 46 | 79 | 33 | 36 | 47 | 9 | 10 | 16.2x | n/a / n/a | -0.6% | 8.0% | -0% / 7% / 9% | n/a | n/a |
| MLP SE (MLP) | Specialist risk services | B | 46 | 53 | 16 | 16 | 35 | 9 | 11 | 36.8x | 33.6x / 27.6x | 0.2% | 5.5% | -52% / 5% / 21% | 11.1% | 137% |
| The Baldwin Group (BWIN) | US brokers & specialty | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 158.1x | n/a / n/a | 1.1% | 6.0% | -19% / 8% / 15% | -4.1% | 40% |
| Goosehead Insurance (GSHD) | US brokers & specialty | A | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 18.2x | n/a / n/a | 3.7% | 6.0% | 1% / 9% / 11% | -19.0% | -276% |
