# Sector 6: Insurance brokerage and specialist risk services

Agent: S6. As of 2026-11-12. Valuation date: 11-Nov-2026 close.

Per-company evidence, sources and scores are in `research/qual/<ID>.json`. Raw PitchBook financials are in `data/raw/pitchbook/<ID>.json`. This note does not rank companies or pick portfolio winners.

## 1. Universe and subgroups

| Subgroup | IDs | What they sell | Rate-cycle link |
|---|---|---|---|
| Global brokers / advisers | MMC (now **Marsh, NYSE: MRSH**), AON, WTW | Large-account broking, reinsurance broking, benefits and HR consulting, management consulting (MMC) | Indirect. Commissions and fees scale with premium, partly offset by fee-based work. |
| US brokers and specialty distribution | AJG, BRO, RYAN, BWIN | Middle-market retail broking, wholesale/E&S, MGA/delegated authority | Direct. Wholesale and MGA lines are the most rate-sensitive. |
| US personal-lines agencies | GSHD, TWFG | Franchise and independent-agent personal auto/home | Direct. Personal-lines rate increases drove 2023-24 growth. |
| **ADJACENT: specialist risk services** | CRVL, CRD, VRSK | Claims and managed care (CRVL), loss adjusting/TPA (CRD), insurance data and analytics (VRSK) | Not premium-linked. Volumes depend on claims, weather or insurer budgets. |
| **ADJACENT: European comparator (screen depth)** | MLP | German financial advice, wealth management and some insurance broking | Weak link. Not a pure insurance broker. |

**Brokers versus carriers.** Every company here is a distributor or service provider. None of them takes underwriting risk on its own balance sheet. MGA and delegated-authority businesses (RYAN, BRO Specialty Distribution, BWIN UCTS) underwrite on behalf of carriers but carry no insurance risk. Contingent and supplemental commissions do depend on carrier loss ratios; RYAN, for example, reduced its US Assure earn-out liability because of higher loss ratios.

**Ticker and rebrand (MMC).** Marsh & McLennan Companies rebranded as "Marsh". Its NYSE ticker changed from MMC to **MRSH effective 14-Jan-2026**, per the company's 29-Dec-2025 press release. Legal name and CUSIP are unchanged. Guy Carpenter becomes "Marsh Re" from 2027. The project file id stays `MMC`, and the change is recorded in `MMC.json`.

## 2. Wider universe screened and excluded

| Name | Status | Why it is not in the universe |
|---|---|---|
| Howden, Ardonagh, Hub International, Acrisure, Alliant, Lockton, AssuredPartners (now AJG), USI (being bought by AON), NFP (now AON) | Private or PE-owned | Not investable. The largest independent European broker (Howden, UK) and Ardonagh (UK) are private. |
| Erie Indemnity (ERIE) | Listed (Nasdaq) | Attorney-in-fact for the Erie Insurance Exchange, earning a management fee of up to 25% of premiums written. It is economically close to a broker-style fee stream with no underwriting risk. However, it depends on a single client (the Exchange), giving 100% customer concentration (would fail G3). It is controlled by the Hirt family through Class B shares and is confined to Mid-Atlantic/Midwest personal lines. A reasonable future addition, but it would fail G3 as specified. |
| Kinsale, RLI, W.R. Berkley, Arch, Markel, Lancashire, Beazley, Hiscox | Listed | Insurers/reinsurers: they carry underwriting risk. Excluded by the brief. |
| Sedgwick | Private (Carlyle/Stone Point/CDPQ) | The main claims-TPA competitor to CRD and CRVL; not investable. |
| Majesco | Private (Thoma Bravo) | Insurance core-systems software; not investable. |
| Applied Systems, Vertafore, Guidewire | Mostly private (Guidewire listed) | Guidewire is insurance software and belongs in a software screen, not here. |

**Honest shortfall: European listed brokers.** The universe contains almost no independent listed insurance brokers domiciled in Continental Europe or the UK. The big European platforms (Howden, Ardonagh, PIB, Global Risk Partners, Clear) are private. AON and WTW are Irish-domiciled and London/Dublin-headquartered, but they are US-listed and earn most of their revenue in North America. MLP SE is included only as an adjacent comparator: its insurance broking is a minority of revenue next to wealth, banking and performance fees. We have not padded the list with weak substitutes.

## 3. Organic growth and rate contribution

Figures are company-reported organic growth in %. A blank cell means not reported or not verified in this pass; it is never zero.

| ID | 2022 | 2023 | 2024 | 2025 | 2026 YTD / Q3 | Rate contribution: evidence and inference |
|---|---|---|---|---|---|---|
| MMC (underlying) | | | 7 | 4 | 5 (9M) | Marsh Global Insurance Market Index: primary commercial rates -5% in Q3-26 (property -10%). Reinsurance -1% for 9M on cat-rate declines despite high-90s% retention. INFERENCE: rate now contributes about 0 to -1pt; growth comes from new business. |
| AON | | | 6 | 6 | 6 (Q3) | Company says net market impact (rate and exposure) is "slightly positive", within 0-2pts. So about 4-6pts comes from new business and retention (company commentary). |
| WTW | | | | 5 | 4 (Q3; R&B 5) | INFERENCE: rate contributes about 0-1pt. North America growth comes from construction, surety and transactional lines. |
| AJG (brokerage) | | 8.9 | 7 | 6 | 5 (Q3) | Steady deceleration as renewal premium increases fade. Supplemental revenue +20% in 2025. |
| BRO | | | 10.4 | 2.8 | 1.2 (Q3); Q4-25 -2.8% | Highest rate leverage. Specialty Distribution -0.8% in Q3-26 and -7.8% in Q4-25. INFERENCE: most of the 2023-24 growth was rate- and cat-driven. |
| RYAN | 16.4 | 15.0 | 12.8 | 10.1 | 7.3 (9M); 4.0 (Q3) | Q3 was up against a 15% comparison. Property E&S softening, which management expects to worsen into 2027. INFERENCE: property rate drag of 3-5pts. |
| BWIN | | | | | 6 (Q3, preliminary) | Not analysed further: pending take-private. |
| GSHD | | | | | Core revenue +12.9% (Q3) | Written premium +10.6% versus policies +14.5%, so premium per policy is now flat to down (INFERENCE). Accounts are under restatement. |
| TWFG | | | | 11.6 | 16.6 (Q3); FY guide 15-17 | Company: "volume-led, not rate-driven". Boosted by Florida flows that will not recur; retention 88%. |

Adjacent names are not rate-linked. CRVL reported growth: FY23 11.3%, FY24 10.6%, FY25 12.7%, FY26 7.0%, Q2 FY27 11%. CRD reported growth: 2024 +1.8%, 2025 -2.2%, Q3-26 -0.2%. VRSK organic constant-currency growth: 6.6% in 2025, 7.4% in Q3-26.

**Takeaway.** The 2025-26 soft market separates brokers whose growth was rate-driven (BRO and RYAN's property-heavy lines) from those whose growth comes from new business (AON, MMC Risk, AJG). This is a central contrary-evidence point against extrapolating 2022-24 organic growth rates.

## 4. Acquisition economics and leverage

| ID | Major deal | Price / multiple | Funding | Gross debt / EBITDA | Gate G1 |
|---|---|---|---|---|---|
| AON | USI (pending; close expected Q4-26); NFP (2024, ~$13bn) | $17.0bn ($16.7bn net), **~14.5x synergised** TTM adj EBITDA (company). Pre-synergy multiple not disclosed. | All new debt; buybacks paused | Company: 2.9x end-2025, **~4.5x at close**, target 2.8-3.0x within 24 months. PitchBook TTM: 4.3x. S&P outlook negative. | **B** |
| AJG | AssuredPartners (closed 18-Aug-2025) | ~$13.8bn; multiple not disclosed in sources used | ~$9.8bn equity + $5bn notes | ~3.2x (PitchBook) | C |
| BRO | Accession (closed 1-Aug-2025) | ~$9.83bn; ~16x adj EBITDAC implied (ESTIMATE from reported revenue and margin) | ~$4bn equity + ~$4bn debt | ~3.2x | C |
| MMC | McGriff (2024; ~$7.75bn widely reported, not re-verified); Wilshire (agreed 10-Nov-2026, terms undisclosed) | n/d | Cash and debt | ~2.8x (company debt) / 3.1x (PitchBook) | C |
| RYAN | Tuck-ins: $637m in 9M-25; none in 9M-26 | n/d | Debt | **4.7x PitchBook (GAAP basis)**; ~3.6x on company adj EBITDAC (ESTIMATE) | **B** |
| BWIN | CAC Group (Jan-2026); company now being taken private | Take-out at ~20x TTM adj EBITDA | n/a | ~6.4x (ESTIMATE) | A |
| WTW | Newfront, Cushon; Willis Re joint venture with Bain | n/d | Cash | ~2.6x | C |

**Contingent consideration.** RYAN: $34.2m expense and $37.4m paid in 9M-26; the US Assure liability was cut by $12.9m because of higher loss ratios. BRO: earn-out payable remeasurement +$27m in Q3-26 and -$7m in 9M-26, plus an $83m escrow mark-to-market benefit. Balance-sheet earn-out liabilities were not extracted for any company; this is a data gap.

**Fiduciary interest income, the main rate sensitivity.** MMC: $100m in Q3-26 (-$9m y/y), with Q4 guided to ~$94m. RYAN: $14.9m per quarter. AJG: brokerage interest, premium finance and other income was $732m in 2025, inflated by pre-funding cash raised for AssuredPartners. BRO: investment income $25m in Q3-26 versus $56m. AJG holds $7.1bn of fiduciary cash and BRO $2.4bn. Fiduciary income drops almost entirely to EBITDA, so 100bp lower short rates would cut roughly $70m of AJG pre-tax income (ESTIMATE: fiduciary cash × 1%).

## 5. Scale economics we can measure

- **Margins.** Brokerage adjusted EBITDAC: AJG 35.3% (Q3-26), BRO 34.6% (down 200bp), RYAN 30.9-32.1%, BWIN 22%. Global brokers: MMC adjusted operating margin 28.1% (9M); WTW 25.2% (FY25) heading toward a 30% target. VRSK adjusted EBITDA margin 56%. Scale shows up in carrier contingent and supplemental income (AJG supplementals +20%) and in placement facilities (Marsh Nimbus/Stratus).
- **Retention and new business.** MMC reinsurance retention is in the "high 90s". TWFG retention is 88%, down from 93%. No other broker disclosed retention in the sources used.
- **Counter-evidence.** BWIN's scale-by-roll-up has not produced GAAP profits. BRO's margin fell even as it gained scale.

## 6. Runway

- The US middle market is still fragmented. AJG did 33 deals in 2025 and 19 so far in 2026, and AON is buying USI. Tuck-in multiples are still high: the take-private prices BWIN at ~20x and AON is paying ~14.5x synergised.
- E&S and delegated authority have been taking structural share (RYAN 15%+ organic in 2022-23), but this is cyclically paused.
- Health payment integrity is a new runway for CRVL (CERiS: a Top-10 health plan win and BCBS access).
- Personal lines (GSHD, TWFG) have growth runway but are the most exposed to direct-to-consumer and AI distribution.

## 7. AI (I1) assessment

Scored seriously:
- **Most exposed:** personal-lines agencies (GSHD, TWFG, BWIN Mainstreet), with I1 = 2. Desk loss adjusting (CRD), I1 = 2. Consumer financial advice (MLP), I1 = 2.
- **Moderate:** large-account and specialty broking (MMC, AON, WTW, AJG, BRO, RYAN), I1 = 3. Complex placement and advice resist automation, but benefits administration, small commercial and binding-authority flows are exposed.
- **VRSK, I1 = 3:** its ISO statutory data moat is hard to replicate. The claims-estimating and analytics layers face AI-native competition, and transactional growth was only 3.2% in Q3-26.
- **Upside is not taken at face value:** MMC's WorkBench (London placement time cut from weeks to hours) and Thrive savings ($600m) show AI as a cost lever for incumbents. I4 is held at 3 because large clients will push to share those savings.
- **G5 (AI-capex dependence):** C for every company. MMC's digital-infrastructure placements are a growth driver but are judged well under 5% of revenue (INFERENCE).

## 8. Gate summary

| ID | G1 | G2 | G3 | G4 | G5 | G6 | G7 | Key note |
|---|---|---|---|---|---|---|---|---|
| MMC | C | C | C | C | C | C | C | Greensill litigation settled ($144m, Q3-26) |
| AON | **B** | C | C | C | C | C | C | ~4.5x at USI close; dated path to 2.8-3.0x within 24 months |
| WTW | C | C | C | C | C | C | C | |
| AJG | C | C | C | C | C | C | C | |
| BRO | C | C | C | C | C | C | C | |
| RYAN | **B** | C | C | C | C | C | C | 4.7x PitchBook vs ~3.6x company-adjusted; basis needs reconciling |
| BWIN | **A** | C | C | B | C | **A** | C | $32.50 cash take-private (signed 14-Sep-2026, close expected Q1-2027) |
| GSHD | C | **A** | C | B | C | C | C | 8-K Item 4.02 non-reliance on FY2023-25 accounts; material weakness expected; late Q3 10-Q (non-cash restatement) |
| TWFG | C | C | C | C | C | C | C | Short listed history |
| CRVL | C | C | C | C | C | C | C | |
| CRD | C | C | C | B | C | C | C | Cash flow falling while debt rises |
| VRSK | C | C | C | C | C | C | C | Q3-26 FCF -40%: check 3-year conversion |
| MLP | B | C | C | B | C | C | C | Bank deposits distort leverage and FCF |

There is no Chinese domicile and no UK-consumer or travel exposure (G7) anywhere in the sector.

## 9. Contrary evidence and data gaps

**Contrary evidence**
- The soft market is broadening: property -10%, total commercial -5%, reinsurance soft through the 1-Jan-2027 renewal (MMC).
- RYAN's 2026 organic guidance has already been cut from high single digits to mid single digits.
- BRO's organic growth turned negative in two of the last four quarters.
- Large debt-funded deals at 14-16x (AON/USI, BRO/Accession) are being struck close to the cyclical peak.
- Brokers' falling fiduciary income adds a second headwind on top of rates.

**Data gaps**
1. Five-year organic history before 2023 is unverified for most companies (null rather than estimated); RYAN is complete for 2022-25.
2. Geographic splits from 10-K segment notes were not extracted for MMC, AON, WTW, AJG or BRO. The qualitative splits come from PitchBook/Morningstar profiles.
3. Contingent-consideration liability balances, client retention % and producer retention % are largely undisclosed in the sources used.
4. Company FCF is only available for AON ($3.2bn), WTW ($1.55bn) and VRSK (Q3). Standardised FCF is left to the lead agent's Yahoo cash-flow pipeline.
5. Controlling-holder voting percentages are not extracted: RYAN (Pat Ryan held 127.4m shares at end-2023), GSHD (Jones family), TWFG (Bunch), CRD (Crawford family), MLP (Lautenschläger).
6. Tenure dates marked "not re-verified" in the JSON files: AON CFO, WTW CFO, AJG CFO, BRO CFO, CRVL CEO and CFO, MLP, BWIN, VRSK.
7. ISINs are blank for BWIN, TWFG and CRD-B. The MMC ISIN is derived from its unchanged CUSIP.
8. **PitchBook EBITDA basis.** GAAP-basis EBITDA understates broker cash earnings where there is equity compensation, Up-C structures or earn-outs (RYAN, BWIN). Leverage gates on that basis are conservative, and the alternative company-adjusted basis is shown alongside.
