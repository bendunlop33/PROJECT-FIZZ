# PROJECT-FIZZ: European and North American quality-compounder research

This is a reproducible fundamental equity-research pipeline. It covers 97 listed European and North American companies across six sectors: business services; consumer health and medical consumables; consumer staples; specialist industrials and distribution; waste, water and environmental services; and insurance brokerage and risk services. It produces rankings, a cross-sector shortlist, a proposed concentrated satellite basket, and low-turnover monitoring code. The work is **decision support only**: no trades, no brokerage access, no leverage, no derivatives.

**Valuation date:** 11 Nov 2026 close. **Run date:** 12 Nov 2026.

## Deliverables
| | Path |
|---|---|
| Investment report | `output/Investment_Report.md` |
| Excel workbook (live formulas, charts, all tables) | `output/Equity_Research_Workbook.xlsx` |
| Quality-control report | `output/QC_Report.md` |
| Independent challenge review | `research/challenge/challenge_report.md`, `research/challenge/qc_findings.csv` |
| Charts (PNG) | `output/charts/` |
| Methodology, schema, definitions, change log | `docs/methodology.md` |
| Refresh and reproduction guide | `docs/REFRESH.md` |
| Monitoring code and scheduler spec (NOT activated) | `monitoring/` (`monitor.py`, `SCHEDULER_SPEC.md`, `theses/`, `thresholds.csv`, `decision_log.csv`) |

## Repository layout
- `config/`: universe, benchmark definitions and fixed mappings, corporate actions, documented overrides (growth, FCF/EV, gates, scores, share classes), and the basket decision.
- `src/`: ingestion, returns, fundamentals and valuation, attribution, ranking and scenarios, portfolio, backtest, charts and workbook. Rebuild with `python3 src/run_all.py [--refresh]`.
- `research/qual/`: one authoritative evidence record per company, written by the sector agents.
- `research/verification/`: primary-source verification of growth, geography and key claims (supersedes `qual` where present).
- `research/sector_S1..S6.md`: sector notes.
- `research/ifrs_cashflow_classification.csv`: interest and lease classification for IFRS issuers.
- `data/processed/`: derived datasets. Raw provider extracts are git-ignored for licensing reasons.
- `tests/`: validation tests (`python3 -m pytest -q tests`).
