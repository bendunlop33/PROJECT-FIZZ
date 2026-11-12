# Refresh and reproduction instructions

## Requirements
Python 3.11+ with `pandas`, `numpy`, `requests`, `pyarrow`, `openpyxl`, `matplotlib`, `pytest`; LibreOffice (only to recalculate workbook formulas for previewers). No API keys or secrets are stored in this repository.

## 1. Market data and statements (automated)
```bash
python3 src/run_all.py --refresh     # Yahoo prices/dividends/splits/FX/benchmarks + statements, then full rebuild
```
Retrieval timestamps = file mtimes of `data/raw/yahoo/**` (cache max-age 3 days; raw dumps are git-ignored).
Change the valuation date in `src/common.py` (`VALUATION_DATE`) and in `docs/methodology.md` §1 together.

## 2. PitchBook financials (authorised, interactive)
The PitchBook connector is an interactive MCP tool, not a bulk API. For each company in `config/universe.csv`:
1. `pitchbook_search` (ticker/name) -> PBID (stored in `research/qual/<ID>.json`, field `pitchbook_pbid`).
2. `pitchbook_get_company_financials(PBID)` -> save the returned text as `data/raw/pitchbook/<ID>.json` (`{"result": "..."}`).
Respect licence terms: raw extracts stay out of version control (`.gitignore`). Confirm with PitchBook that storing derived figures (multiples, growth rates) in this private repository is permitted under your subscription.

## 3. Qualitative research
Sector records `research/qual/<ID>.json` follow the schema in `docs/methodology.md` §11. Verified overrides in `research/verification/<ID>.json` take precedence for organic growth and geography. IFRS cash-flow classification: `research/ifrs_cashflow_classification.csv`. Economic share counts for multi-class / Up-C issuers: `config/share_overrides.csv`.

## 4. Validation
```bash
python3 -m pytest -q tests
python3 <xlsx-skill>/scripts/recalc.py output/Equity_Research_Workbook.xlsx 240   # formula check (0 errors expected)
```

## 5. Optional SEC EDGAR
EDGAR's fair-access policy requires a real contact e-mail in the User-Agent. Not configured; if desired set `SEC_CONTACT_EMAIL` and add a fetcher (not used in this version).

## Provider mappings
| Field | Source | Identifier |
|---|---|---|
| Prices, dividends, splits, FX, ETF/index levels | Yahoo chart API | `config/universe.csv: yahoo`, `config/benchmarks.csv` |
| Annual/quarterly/TTM statements | Yahoo fundamentals-timeseries | same |
| Quarterly TTM history, EV, net debt | PitchBook | PBID (qual records) |
| Organic growth, KPIs, governance, gates | Company filings via sector agents | `research/qual`, `research/verification` |
