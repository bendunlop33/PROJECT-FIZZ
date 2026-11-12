# Monitoring scheduler specification (NOT ACTIVATED)

Status: **specification only.** No cron job, cloud scheduled task or background process has been created. Activating
any schedule requires (1) separate written authorisation from the investor and (2) a tested runtime with network
access to the data sources below. Nothing in this system places trades, contacts a broker or rebalances.

| Job | Command | Proposed schedule (Europe/London) | Purpose | Output (only when something changed) |
|---|---|---|---|---|
| Daily exceptions | `python3 monitoring/monitor.py daily` | Mon-Fri 21:40 (after US close) | Price/threshold crossings, newly published periods, keyword-filtered headlines for holdings, shortlist and direct competitors (`monitoring/watchlist.csv`) | `monitoring/alerts/daily_YYYYMMDD.md`; material items appended to `alerts/deep_review_queue.jsonl` |
| Deep review (human-in-loop) | Claude Code session with PitchBook connector reads `deep_review_queue.jsonl` | Same evening, only if the queue is non-empty | Read primary RNS/8-K/transcript; compare with thesis record; draft alert in brief §30 format | Draft alert in `monitoring/alerts/`, entry in `decision_log.csv` (status: proposed) |
| Weekly change review | `python3 src/run_all.py --refresh && python3 monitoring/monitor.py weekly` | Saturday 09:10 | Refresh valuations/ranks; rank-change persistence test (2 consecutive weeks); gate changes; exposure drift | `monitoring/alerts/weekly_YYYY-Www.md` |
| Quarterly / post-results | Manual: refresh PitchBook extracts + sector re-research of affected names | Within 5 business days of results | Refresh KPIs, FCF, scores, scenarios, thesis expectations; hold/add/trim/exit only where justified | Updated `research/qual/<ID>.json`, `monitoring/theses/<ID>.json` |
| Semi-annual re-screen | Re-run sector agents on wider universe | May and November | Universe changes, new listings, delistings | Updated `config/universe.csv`, exclusion log |

## Agent roles (when activated)
- **Company-event agents:** one per sector; watch assigned holdings + direct competitors (watchlist `competitor_of`).
- **Sector/macro agent:** links regulation, demand, cost, financing news to earnings/financing/valuation explicitly; a macro headline changes nothing without that link.
- **Valuation/portfolio agent:** updates expected returns, weights, concentrations, alternatives (index / keep existing holding / cash).
- **Independent challenge agent:** reviews every proposed change for overreaction and contrary evidence.
- **Lead portfolio agent:** de-duplicates, maintains `decision_log.csv`, submits recommendations. **All trades require human approval.**

## Alert format (brief §30)
1. What changed and when  2. Facts vs inference  3. Thesis/scenario implications  4. Price vs earnings contribution to the
valuation change  5. Concentration implications  6. Hold/add/trim/exit recommendation  7. Costs/tax considerations
8. Evidence that would reverse the recommendation. Unchanged warnings are never repeated (`state/seen.json`).

## Data dependencies and limits
- Yahoo public endpoints (prices, statements, headlines) - unofficial, may change or rate-limit; failures are logged as `Data` alerts, never silently ignored.
- PitchBook: interactive connector only (no bulk API assumed); deeper reviews run inside an authorised session.
- SEC EDGAR: optional; requires a genuine contact e-mail in `SEC_CONTACT_EMAIL` per SEC fair-access policy (not configured).

## Tested
`monitor.py daily` was executed once interactively on 2026-11-12 to verify it runs (see `monitoring/audit_log.csv`); this is not activation.
