"""Build the Excel deliverable: output/Equity_Research_Workbook.xlsx (openpyxl; recalculated via LibreOffice).

Conventions: blue font = hard-coded input from data pipeline (source column/notes say where from); black = formula;
green = cross-sheet link; yellow fill = key assumption the reader may change; light-amber fill = missing / not
disclosed (never zero-filled). Units are stated in every header. Percentages stored as fractions.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from common import PROC, OUT, CFG, QUAL, ROOT, VALUATION_DATE, universe

F = "Arial"
BLUE, GREEN, BLACK = Font(name=F, size=9, color="0000FF"), Font(name=F, size=9, color="008000"), Font(name=F, size=9)
BOLD = Font(name=F, size=9, bold=True)
HDR = Font(name=F, size=9, bold=True, color="FFFFFF")
HFILL = PatternFill("solid", fgColor="1F3A5F")
MISS = PatternFill("solid", fgColor="FCE9C8")
YEL = PatternFill("solid", fgColor="FFFF00")
TITLE = Font(name=F, size=13, bold=True)
NOTE = Font(name=F, size=8, italic=True, color="52514E")
thin = Side(style="thin", color="D9D9D9")

PCT = ["pct", "cagr", "margin", "yield", "irr_", "conv", "growth", "roic", "return", "contrib", "share_", "xs_", "vol", "mdd",
       "dividends_simple", "fx_rep", "tr_", "g_base", "org_", "_pp_", "change", "ratio_", "fcf_to", "drawdown", "hit", "turnover", "cost"]
MULT = ["ev_ebitda", "ev_ebit", "pe", "nd_", "multiple", "to_ebitda", "interest_cover", "ev_sales", "peer_rel"]


def fmt_for(col):
    c = col.lower()
    if c.endswith("_pp") or "_pp_" in c or c.startswith("xs_"):
        return '0.0;(0.0);"-"'
    if any(k in c for k in MULT) and "pctile" not in c:
        return '0.0"x";(0.0"x");"-"'
    if any(k in c for k in PCT) and not c.startswith(("n_", "rank")):
        return '0.0%;(0.0%);"-"'
    return '#,##0.0;(#,##0.0);"-"'


def write_df(ws, df, r0=3, c0=1, number_cols=None, font=BLUE, autofit=True, fmt=None):
    for j, col in enumerate(df.columns):
        cell = ws.cell(row=r0, column=c0 + j, value=str(col))
        cell.font, cell.fill = HDR, HFILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for i, (_, row) in enumerate(df.iterrows()):
        for j, col in enumerate(df.columns):
            v = row[col]
            cell = ws.cell(row=r0 + 1 + i, column=c0 + j)
            if isinstance(v, (float, np.floating)) and (np.isnan(v) or np.isinf(v)):
                cell.value, cell.fill = None, MISS
            elif isinstance(v, (pd.Timestamp,)):
                cell.value = v.date()
            elif isinstance(v, (np.integer,)):
                cell.value = int(v)
            elif isinstance(v, (np.floating,)):
                cell.value = float(v)
            else:
                cell.value = v if not (isinstance(v, str) and v == "nan") else None
            cell.font = font
            if isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool):
                cell.number_format = (fmt or {}).get(col, fmt_for(col))
    if autofit:
        for j, col in enumerate(df.columns):
            w = max(9, min(42, len(str(col)) * 0.9 + 2))
            ws.column_dimensions[get_column_letter(c0 + j)].width = w
    ws.freeze_panes = ws.cell(row=r0 + 1, column=c0 + 1)
    ws.row_dimensions[r0].height = 36
    return r0 + len(df)


def title(ws, t, note=None):
    ws["A1"] = t; ws["A1"].font = TITLE
    if note:
        ws["A2"] = note; ws["A2"].font = NOTE


def sheet(wb, name, t, note=None):
    ws = wb.create_sheet(name[:31]); title(ws, t, note); ws.sheet_view.zoomScale = 90
    return ws


def qual_table():
    rows, src = [], []
    for f in sorted(QUAL.glob("*.json")):
        d = json.loads(f.read_text())
        rec = {"id": d.get("id")}
        for k in ["A", "B", "C", "D", "E", "F", "G", "H", "I1", "I2", "I3", "I4", "J", "K"]:
            s = (d.get("scores") or {}).get(k) or {}
            rec[f"{k}_score"] = s.get("score") if isinstance(s, dict) else None
            rec[f"{k}_conf"] = s.get("confidence") if isinstance(s, dict) else None
            rec[f"{k}_rationale"] = s.get("rationale") if isinstance(s, dict) else None
            ev = s.get("evidence") if isinstance(s, dict) else None
            rec[f"{k}_evidence"] = " | ".join(map(str, ev))[:900] if isinstance(ev, list) else ev
        m = d.get("management") or {}
        o = d.get("ownership") or {}
        rec.update({"ceo": m.get("ceo"), "ceo_since": m.get("ceo_since"), "cfo": m.get("cfo"), "cfo_since": m.get("cfo_since"),
                    "senior_turnover_5y": m.get("senior_turnover_5y"), "guidance_record": m.get("guidance_record"),
                    "controlling_holders": o.get("controlling_holders"), "dual_class": o.get("dual_class"),
                    "activists": "; ".join(f"{a.get('name')} ({a.get('since')}): {a.get('objective')} -> {a.get('company_response')}" for a in (o.get("activists") or []) if isinstance(a, dict)),
                    "board_independence": o.get("board_independence"), "remuneration_notes": o.get("remuneration_notes"),
                    "related_party": o.get("related_party"),
                    "bull_points": " | ".join(map(str, d.get("bull_points") or [])), "bear_points": " | ".join(map(str, d.get("bear_points") or [])),
                    "thesis_breakers": " | ".join(map(str, d.get("thesis_breakers") or [])),
                    "listing_status": (d.get("listing") or {}).get("status"), "domicile": (d.get("listing") or {}).get("domicile"),
                    "isin": (d.get("listing") or {}).get("isin"), "pitchbook_pbid": d.get("pitchbook_pbid"),
                    "ai_dc_revenue_pct": (d.get("ai") or {}).get("ai_dc_capex_revenue_pct"), "ai_notes": (d.get("ai") or {}).get("notes"),
                    "sector_specific": json.dumps(d.get("sector_specific") or {})[:1500]})
        g = d.get("geography") or {}
        for k in ["fy", "basis", "europe_pct", "north_america_pct", "uk_pct", "other_pct", "largest_country", "largest_country_pct", "china_pct", "em_pct", "fx_notes"]:
            rec[f"geo_{k}"] = g.get(k)
        rows.append(rec)
        for s in d.get("sources") or []:
            if isinstance(s, dict):
                src.append({"company": d.get("id"), **{k: s.get(k) for k in ["id", "title", "publisher", "url", "doc_date", "retrieved", "page_ref"]}})
    return pd.DataFrame(rows), pd.DataFrame(src)


def organic_table():
    rows = []
    for f in sorted(QUAL.glob("*.json")):
        d = json.loads(f.read_text())
        for x in d.get("organic_growth") or []:
            if isinstance(x, dict):
                rows.append({"id": d.get("id"), **{k: x.get(k) for k in ["fy", "organic_pct", "price_pct", "volume_mix_pct", "acq_pct", "fx_pct", "reported_pct", "source_id"]}})
    df = pd.DataFrame(rows)
    for c in ["organic_pct", "price_pct", "volume_mix_pct", "acq_pct", "fx_pct", "reported_pct"]:
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce") / 100.0
    return df


def ltm_build(wb, S):
    ws = sheet(wb, "LTM_Build", "LTM build, EV bridge and standardised post-lease FCF (millions, reporting currency)",
               "Blue = provider inputs (Yahoo TTM statements / latest balance sheet; leases per methodology §4). Black = formulas. Amber = missing. Edit inputs to test alternatives.")
    cols = [("id", "id"), ("name", "name"), ("rep_ccy", "Reporting ccy"), ("gaap", "GAAP"), ("price", "Price (quote ccy)"),
            ("price_ccy", "Quote ccy"), ("fx_price_to_rep", "FX quote->reporting"), ("shares_m", "Shares (m, economic)"),
            ("total_debt", "Total debt incl. leases"), ("lease_liab", "Lease liabilities"), ("cash_sti", "Cash & ST investments"),
            ("minorities", "Minorities (abs)"), ("lt_investments", "Associates/LT investments"),
            ("revenue", "Revenue LTM"), ("ebitda", "EBITDA LTM (reported)"), ("unusual_items", "Unusual items (provider)"),
            ("lease_principal", "Lease principal (IFRS)"), ("lease_interest", "Lease interest (IFRS)"),
            ("ocf", "Operating cash flow LTM"), ("capex", "Capex LTM (neg)"), ("interest_adj", "Interest paid in financing (IFRS adj)"),
            ("net_income", "Net income LTM"), ("sbc", "Share-based comp LTM"), ("ebit", "EBIT LTM"),
            ("debt_like_add", "Debt-like items added (verified override)"), ("fcf_override", "Verified FCF override (blank = formula)")]
    hdr = [h for _, h in cols]
    formulas = ["Market cap", "Net debt pre-lease", "EV post-lease", "EBITDA adj (ex unusual)", "EBITDAaL adj",
                "EV/EBITDAaL adj", "Std FCF (post-lease)", "FCF yield", "FCF yield after SBC", "P/E (reported)",
                "Net debt/EBITDAaL adj", "FCF/Net income", "Lease source", "Reconciliation notes"]
    r0 = 4
    for j, h in enumerate(hdr + formulas):
        c = ws.cell(row=r0, column=j + 1, value=h); c.font, c.fill = HDR, HFILL; c.alignment = Alignment(wrap_text=True)
    L = {k: get_column_letter(i + 1) for i, (k, _) in enumerate(cols)}
    n0 = len(cols)
    FL = {name: get_column_letter(n0 + 1 + i) for i, name in enumerate(formulas)}
    rows = S[S.mcap.notna()].sort_values(["sector", "id"])
    for i, (_, r) in enumerate(rows.iterrows()):
        rr = r0 + 1 + i
        for j, (k, _) in enumerate(cols):
            v = r.get(k)
            if k == "interest_adj":
                v = 0.0 if pd.isna(v) else v
            if k == "minorities":
                v = abs(v) if pd.notna(v) else 0.0
                if "Up-C" in str(r.get("shares_source", "")):
                    v = 0.0
            if k in ("lt_investments", "unusual_items", "debt_like_add") and pd.isna(v):
                v = 0.0
            c = ws.cell(row=rr, column=j + 1, value=None if (isinstance(v, float) and np.isnan(v)) else (v.item() if hasattr(v, "item") else v))
            c.font = BLUE
            if c.value is None:
                c.fill = MISS
            elif isinstance(c.value, float):
                c.number_format = "0.0000" if k == "fx_price_to_rep" else '#,##0.0;(#,##0.0);"-"'
        g = lambda k: f"{L[k]}{rr}"
        f = {"Market cap": f"={g('price')}*{g('fx_price_to_rep')}*{g('shares_m')}",
             "Net debt pre-lease": f"={g('total_debt')}-{g('lease_liab')}-{g('cash_sti')}+{g('debt_like_add')}",
             "EV post-lease": f"={FL['Market cap']}{rr}+{FL['Net debt pre-lease']}{rr}+{g('minorities')}-{g('lt_investments')}",
             "EBITDA adj (ex unusual)": f"={g('ebitda')}-{g('unusual_items')}",
             "EBITDAaL adj": f"={FL['EBITDA adj (ex unusual)']}{rr}-{g('lease_principal')}-{g('lease_interest')}",
             "EV/EBITDAaL adj": f"=IF({FL['EBITDAaL adj']}{rr}>0,{FL['EV post-lease']}{rr}/{FL['EBITDAaL adj']}{rr},\"n/m\")",
             "Std FCF (post-lease)": f"=IF(ISNUMBER({g('fcf_override')}),{g('fcf_override')},{g('ocf')}-ABS({g('capex')})-{g('lease_principal')}-{g('interest_adj')})",
             "FCF yield": f"={FL['Std FCF (post-lease)']}{rr}/{FL['Market cap']}{rr}",
             "FCF yield after SBC": f"=({FL['Std FCF (post-lease)']}{rr}-N({g('sbc')}))/{FL['Market cap']}{rr}",
             "P/E (reported)": f"=IF({g('net_income')}>0,{FL['Market cap']}{rr}/{g('net_income')},\"n/m\")",
             "Net debt/EBITDAaL adj": f"=IF({FL['EBITDAaL adj']}{rr}>0,{FL['Net debt pre-lease']}{rr}/{FL['EBITDAaL adj']}{rr},\"n/m\")",
             "FCF/Net income": f"=IF({g('net_income')}>0,{FL['Std FCF (post-lease)']}{rr}/{g('net_income')},\"n/m\")",
             "Lease source": r.get("lease_source"), "Reconciliation notes": r.get("recon_notes") if pd.notna(r.get("recon_notes")) else ""}
        for name, val in f.items():
            c = ws.cell(row=rr, column=n0 + 1 + formulas.index(name), value=val)
            c.font = BLACK
            c.number_format = {"FCF yield": "0.0%", "FCF yield after SBC": "0.0%", "FCF/Net income": "0%"}.get(name, '0.0"x"' if "/" in name or "P/E" in name else '#,##0.0;(#,##0.0);"-"')
    for j in range(len(hdr) + len(formulas)):
        ws.column_dimensions[get_column_letter(j + 1)].width = 13
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions[FL["Reconciliation notes"]].width = 60
    ws.freeze_panes = "C5"
    ws.row_dimensions[r0].height = 48
    return ws, {r.id: r0 + 1 + i for i, (_, r) in enumerate(rows.iterrows())}, L, FL


def scenarios_sheet(wb, S, rowmap, L, FL):
    ws = sheet(wb, "Scenarios", "Prospective return scenarios - 3y and 5y bear/base/bull (reporting currency, no multiple expansion in base)",
               "Formula model mirrors src/rank.py: equity_exit = exit EV/EBITDAaL x EBITDAaL_n - net debt_0 + cumulative FCF; IRR = (equity_exit/(1+dilution)^n / mcap)^(1/n)-1. Yellow = key assumptions (editable). Outputs are scenarios, not predictions.")
    hdr = ["id", "name", "sector", "Organic growth base (g)", "g source", "Entry EV/EBITDAaL", "Own 10y median / now (PIT)",
           "Own 10y p25 / now (PIT)", "EBITDAaL margin", "Dilution p.a. (SBC/mcap)",
           "Base exit multiple", "Bear exit multiple", "Bull exit multiple",
           "Bear 5y IRR", "Base 5y IRR", "Bull 5y IRR", "Bear 3y IRR", "Base 3y IRR", "Bull 3y IRR",
           "Base 5y IRR, GBP +10% (GBP strengthens)", "Base 5y IRR, GBP -10%", "Buy below (9% base IRR), quote ccy", "Fair max (7% base IRR), quote ccy", "Current price"]
    r0 = 4
    for j, h in enumerate(hdr):
        c = ws.cell(row=r0, column=j + 1, value=h); c.font, c.fill = HDR, HFILL; c.alignment = Alignment(wrap_text=True)
    rows = S[S.id.isin(rowmap) & S.irr_base_5y.notna()].sort_values(["sector", "id"])
    lt = "LTM_Build"
    for i, (_, r) in enumerate(rows.iterrows()):
        rr, lr = r0 + 1 + i, rowmap[r.id]
        ref = lambda col: f"{lt}!{col}{lr}"
        vals = [r.id, r["name"], r.sector, r.g_base, r.g_base_source,
                f"=IF({ref(FL['EBITDAaL adj'])}>0,{ref(FL['EV post-lease'])}/{ref(FL['EBITDAaL adj'])},NA())",
                (min(1.0, r.ev_ebitda_median_10y / r.ev_ebitda_pit_now) if pd.notna(r.ev_ebitda_median_10y) and pd.notna(r.ev_ebitda_pit_now) and r.ev_ebitda_pit_now > 0 else 1.0),
                (min(0.85, r.ev_ebitda_p25_10y / r.ev_ebitda_pit_now) if pd.notna(r.ev_ebitda_p25_10y) and pd.notna(r.ev_ebitda_pit_now) and r.ev_ebitda_pit_now > 0 else 0.80),
                f"={ref(FL['EBITDAaL adj'])}/{ref(L['revenue'])}",
                (r.sbc / r.mcap if pd.notna(r.sbc) and r.sbc > 0 else 0.0)]
        for j, v in enumerate(vals):
            c = ws.cell(row=rr, column=j + 1, value=v)
            c.font = GREEN if isinstance(v, str) and v.startswith("=") else BLUE
            if j in (3, 6, 7, 9):
                c.fill = YEL
            c.number_format = {3: "0.0%", 5: '0.0"x"', 6: "0.00", 7: "0.00", 8: "0.0%", 9: "0.00%"}.get(j, "General")
        D, Fm, G, H, I, J = (f"{x}{rr}" for x in "DFGHIJ")
        ws[f"K{rr}"] = f"={Fm}*{G}"; ws[f"L{rr}"] = f"={Fm}*{H}"; ws[f"M{rr}"] = f"={Fm}"
        e0, nd0, mc, fcf0 = ref(FL["EBITDAaL adj"]), ref(FL["Net debt pre-lease"]), ref(FL["Market cap"]), ref(FL["Std FCF (post-lease)"])

        def irr(n, g, dm, mult):
            arr = "{" + ",".join(str(t) for t in range(1, n + 1)) + "}"
            mf = f"IF({I}>0.02,({I}+({dm}))/{I},1)"
            eq = f"({mult}*{e0}*(1+{g})^{n}*{mf}-{nd0}-{ref(L['minorities'])}+{ref(L['lt_investments'])}+SUMPRODUCT({fcf0}*(1+{g})^{arr}*(1+({mf}-1)*{arr}/{n})))"
            return f"=IFERROR(IF({eq}<=0,-1,({eq}/(1+{J})^{n}/{mc})^(1/{n})-1),NA())"
        ws[f"N{rr}"] = irr(5, f"({D}-0.02)", "-0.01", f"L{rr}"); ws[f"O{rr}"] = irr(5, D, "0", f"K{rr}"); ws[f"P{rr}"] = irr(5, f"({D}+0.015)", "0.005", f"M{rr}")
        ws[f"Q{rr}"] = irr(3, f"({D}-0.02)", "-0.01", f"L{rr}"); ws[f"R{rr}"] = irr(3, D, "0", f"K{rr}"); ws[f"S{rr}"] = irr(3, f"({D}+0.015)", "0.005", f"M{rr}")
        gbp = r.rep_ccy == "GBP"
        ws[f"T{rr}"] = f"=O{rr}" if gbp else f"=(1+O{rr})/1.1^(1/5)-1"
        ws[f"U{rr}"] = f"=O{rr}" if gbp else f"=(1+O{rr})/0.9^(1/5)-1"
        ws[f"X{rr}"] = float(r.price); ws[f"X{rr}"].font = BLUE
        ws[f"V{rr}"] = f"=IFERROR(X{rr}*(1+O{rr})^5/1.09^5,NA())"; ws[f"W{rr}"] = f"=IFERROR(X{rr}*(1+O{rr})^5/1.07^5,NA())"
        for col in "KLM":
            ws[f"{col}{rr}"].number_format = '0.0"x"'
        for col in "NOPQRSTU":
            ws[f"{col}{rr}"].number_format = "0.0%"
        for col in "VWX":
            ws[f"{col}{rr}"].number_format = "#,##0.00"
    for j in range(len(hdr)):
        ws.column_dimensions[get_column_letter(j + 1)].width = 12
    ws.column_dimensions["B"].width = 24; ws.column_dimensions["E"].width = 40
    ws.freeze_panes = "C5"; ws.row_dimensions[r0].height = 60
    n = len(rows)
    ws.cell(row=r0 + n + 2, column=1, value="Assumptions: bear = g-2pp, EBITDAaL margin -100bp, exit at min(0.85, own p25/now) x entry; base = g, flat margin, exit at min(1, own 10y median/now) x entry (never above entry); bull = g+1.5pp, +50bp, exit = entry. FCF grows with EBITDAaL and is retained/returned (no reinvestment return assumed). Acquisitions excluded from base. GBP columns apply a cumulative 10% FX move over 5 years.").font = NOTE


def sector_sheets(wb, S):
    cols = ["id", "name", "subsector", "peer_group", "depth", "gate_status", "rep_ccy", "mcap", "revenue", "g_base", "org_series",
            "revenue_cagr_5y_rep", "ebitda_cagr_5y_rep", "ebitdaal_margin", "ebitda_margin_std_10y_pp", "rev_growth_neg_years_10y",
            "fcf_to_ni_3y_cum", "fcf_conv_ebitdaal", "roic_avg", "fcf_ps_cagr_hist", "acq_spend_3y_pct_ocf", "sbc_pct_rev",
            "ev_ebitdaal_adj", "ev_ebitda_provider", "pe", "fcf_yield", "ev_ebitda_pit_now", "ev_ebitda_median_10y",
            "ev_ebitda_pctile_now_10y", "peer_rel_multiple", "nd_pre_lease_to_ebitdaal", "irr_bear_5y", "irr_base_5y", "irr_bull_5y",
            "p_quality", "p_growth", "p_cash", "p_valuation", "p_governance", "operating_momentum", "score_base",
            "quality_rank_in_sector", "value_rank_in_sector", "rank_in_sector", "rank_overall", "evidence_confidence"]
    names = {"S1": "Business services", "S2": "Consumer health & med consumables", "S3": "Consumer staples",
             "S4": "Specialist industrials & distribution", "S5": "Waste, water & environmental", "S6": "Insurance brokerage & risk"}
    for s, nm in names.items():
        d = S[S.sector == s].sort_values(["peer_group", "score_base"], ascending=[True, False])[[c for c in cols if c in S]]
        ws = sheet(wb, f"{s}_Comparison", f"{s} - {nm}: detailed comparison",
                   "Millions of reporting currency; multiples post-lease unless 'provider'. g_base = organic growth used in base scenario (source in Scenarios). Pillar scores 0-100 (within ranked universe). Gate: A excluded / B further evidence / C eligible. Amber = missing.")
        write_df(ws, d, r0=4)
        ws.column_dimensions["B"].width = 24; ws.column_dimensions["K"].width = 34


def main():
    S = pd.read_csv(PROC / "scores.csv")
    u = universe()
    wb = Workbook()
    ws = wb.active; ws.title = "README"
    title(ws, "European & North American quality compounders - research workbook")
    port = json.loads((PROC / "portfolio_summary.json").read_text())
    lines = [f"Valuation date: close of {VALUATION_DATE.date()} (latest completed session on all covered exchanges). Run date 2026-11-12.",
             "Purpose: decision support only. No trades, no brokerage access, no shorting, leverage or derivatives.",
             "Sources: PitchBook (licensed connector: quarterly TTM financials, EV history, profiles, transcripts, Morningstar research); Yahoo Finance public endpoints (prices, dividends, splits, FX, index/ETF levels, ~4y statements); company filings & releases (sector agents, cited per company in Sources). SEC EDGAR not used (requires contact e-mail).",
             "Methodology & definitions: docs/methodology.md. Code: src/ (rebuild: python3 src/run_all.py). QC report: output/QC_Report.md. Investment report: output/Investment_Report.md.",
             "Colour key: blue = provider/agent input; black = formula; green = cross-sheet link; yellow = editable key assumption; amber = missing / not disclosed (never zero-filled).",
             "Units: millions of reporting currency unless stated; percentages as %, multiples as x. GBP returns unhedged.",
             f"Proposed basket (lead judgement, equal-weight baseline): {', '.join(port.get('basket', []))}.",
             "Retrospective returns of today's selections are NOT a point-in-time investable backtest (selection & survivorship bias).",
             "Historical performance does not guarantee future returns. Scenario outputs are not forecasts."]
    for i, l in enumerate(lines):
        ws.cell(row=3 + i, column=1, value=l).font = Font(name=F, size=10)
    ws.column_dimensions["A"].width = 160
    sheets_doc = ["Universe", "S1..S6_Comparison", "Qual_Scores", "Organic_Growth", "Financial_History", "PitchBook_TTM", "LTM_Build",
                  "FCF_Reconciliation", "Valuation", "Hist_Multiples_PIT", "Charts_*", "Attribution", "Returns_Benchmarks", "Calendar_Returns",
                  "Scenarios", "Scores_Ranking", "Weight_Sensitivity", "Shortlist_Basket", "Exposures_Stress", "Correlations", "Exercise_A",
                  "Exercise_B_Diagnostic", "Exclusion_Log", "Sources", "Limitations"]
    ws.cell(row=14, column=1, value="Sheets: " + " | ".join(sheets_doc)).font = BOLD

    # Universe
    gates = pd.read_csv(PROC / "gates.csv")
    qt, src = qual_table()
    uni = u.merge(S[["id", "rep_ccy", "price_ccy", "price", "mcap", "gate_status", "status_note", "shares_source"]], on="id", how="left") \
           .merge(qt[["id", "listing_status", "domicile", "isin", "pitchbook_pbid", "geo_north_america_pct", "geo_europe_pct", "geo_uk_pct",
                      "geo_other_pct", "geo_largest_country", "geo_largest_country_pct", "geo_china_pct", "geo_em_pct"]], on="id", how="left")
    ws = sheet(wb, "Universe", "Universe, classification, listing and geography",
               "One primary sector per company; secondary exposures in notes. Geography = % of revenue (sector-agent research; amber = not disclosed). Region = listing region used for benchmark mapping.")
    write_df(ws, uni, r0=4)
    sector_sheets(wb, S)
    ws = sheet(wb, "Qual_Scores", "Qualitative rubric scores (1-5 anchored), confidence, evidence and rationale",
               "Rubric in docs/methodology.md §5. I1/I2: 5 = least exposed to AI substitution / AI-capex dependence. Confidence H/M/L separate from score; missing disclosure lowers confidence, not score.")
    write_df(ws, qt, r0=4)
    og = organic_table()
    ws = sheet(wb, "Organic_Growth", "Company-reported organic growth with price / volume-mix / acquisition / FX split where disclosed",
               "Fractions (0.052 = 5.2%). Interim periods labelled. Blank = not disclosed. Source ids map to the Sources sheet.")
    write_df(ws, og, r0=4)
    h = pd.read_csv(PROC / "annual_history.csv", parse_dates=["period_end"])
    ws = sheet(wb, "Financial_History", "Annual financial history (Yahoo, ~4 fiscal years; millions reporting currency)",
               "FCF std = OCF - capex - lease principal (IFRS proxy = current lease liability). ROIC = EBIT x 75% / avg(equity + net debt incl. leases). Longer histories (10y+) for revenue/EBITDA/NI/EV/net debt are in PitchBook_TTM.")
    write_df(ws, h, r0=4)
    pbl = pd.read_csv(PROC / "pb_history_local.csv", parse_dates=["period_end"])
    pbl = pbl[pbl.period_end >= "2014-01-01"]
    ws = sheet(wb, "PitchBook_TTM", "PitchBook quarterly TTM history converted to reporting currency (millions)",
               "Flows at trailing-12m average FX, stocks (EV, net debt) at period-end spot. Provider basis (IFRS 16/ASC 842 from 2019). Current-vintage data: later restatements may be embedded (not as-first-reported).")
    write_df(ws, pbl, r0=4)
    ltm_ws, rowmap, L, FL = ltm_build(wb, S)
    cf = pd.read_csv(ROOT / "research" / "ifrs_cashflow_classification.csv") if (ROOT / "research" / "ifrs_cashflow_classification.csv").exists() else pd.DataFrame()
    fr = S[["id", "rep_ccy", "gaap", "ocf", "capex", "lease_principal", "lease_interest", "lease_source", "interest_adj", "fcf_std", "sbc", "fcf_std_less_sbc",
            "acquisitions", "net_income", "fcf_conv_ni", "fcf_to_ni_3y_cum", "fcf_to_ebitdaal_3y_cum", "wc_contrib_3y_pct_ocf", "acq_spend_3y_pct_ocf", "capex_pct_rev", "recon_notes"]]
    if len(cf):
        fr = fr.merge(cf[["id", "interest_paid_section", "interest_paid", "lease_principal_paid", "company_fcf_name", "company_fcf_definition", "company_fcf_value", "fy_end", "source_url"]].drop_duplicates("id", keep="last"), on="id", how="left")
    ws = sheet(wb, "FCF_Reconciliation", "FCF reconciliation: company-defined vs standardised post-lease FCF (millions, reporting currency, LTM unless noted)",
               "Standardised: OCF - capex - lease principal - interest paid if classified in financing (IFRS). Acquisitions shown separately (excluded). SBC shown separately (not added back). Company FCF from latest annual report (financial-data agent).")
    write_df(ws, fr, r0=4)
    val = S[["id", "name", "sector", "peer_group", "rep_ccy", "mcap", "ev_post_lease", "ev_provider_basis", "ebitda", "ebitda_adj", "ebitdaal", "ebitdaal_adj",
             "pb_ebitda_ttm", "ebitda_vs_pitchbook", "ev_ebitdaal_adj", "ev_ebitdaal", "ev_ebitda_provider", "ev_ebit", "pe", "pe_norm", "fcf_yield",
             "fcf_yield_less_sbc", "ev_sales", "ev_ebitda_pit_now", "ev_ebitda_median_10y", "ev_ebitda_p25_10y", "ev_ebitda_p75_10y",
             "ev_ebitda_pctile_now_10y", "ev_ebitda_median_post2019", "pe_median_10y", "peer_rel_multiple", "nd_pre_lease_to_ebitdaal",
             "nd_incl_lease_to_ebitda", "gross_debt_to_ebitda", "interest_cover", "implied_vs_reported_shares"]]
    ws = sheet(wb, "Valuation", "Current valuation vs own history and peers",
               "Post-lease EV/EBITDAaL is the comparable basis (IFRS vs US GAAP aligned); provider EV/EBITDA shown for reconciliation. PIT history = provider basis; compare 'now' vs median on that same basis. Forward multiples: no licensed consensus available - not shown.")
    write_df(ws, val, r0=4)
    pit = pd.read_csv(PROC / "pit_multiples.csv", parse_dates=["obs_date", "period_k"])
    ws = sheet(wb, "Hist_Multiples_PIT", "Point-in-time quarterly EV / LTM EBITDA (provider basis)",
               "At each quarter-end: price that day x PitchBook-implied shares + net debt, over TTM EBITDA of the latest period published by that date (lag: US/CA 50d interim/75d FY; Europe 65d/80d). 'period_end' column = retrospective period-end ratio for comparison.")
    write_df(ws, pit, r0=4)
    # Charts sheets
    for kind, lab in (("price", "Charts_Price"), ("tr", "Charts_TSR_GBP"), ("ev", "Charts_EV_EBITDA"), ("ps", "Charts_Per_Share")):
        ws = sheet(wb, lab, {"price": "Split-adjusted local-currency share prices rebased to 100", "tr": "GBP total shareholder returns (dividends reinvested)",
                             "ev": "Historical EV / LTM EBITDA (absolute)", "ps": "EBITDA per share (TTM) rebased to 100; FCF per share (shortlist)"}[kind])
        row = 3
        for s in ["S1", "S2", "S3", "S4", "S5", "S6"]:
            p = OUT / "charts" / f"{kind}_{s}.png"
            if p.exists():
                img = XLImage(str(p)); img.width, img.height = img.width * 0.55, img.height * 0.55
                ws.add_image(img, f"A{row}"); row += int(img.height / 20) + 2
        if kind == "ps" and (OUT / "charts" / "fcf_ps_shortlist.png").exists():
            img = XLImage(str(OUT / "charts" / "fcf_ps_shortlist.png")); img.width, img.height = img.width * 0.55, img.height * 0.55
            ws.add_image(img, f"A{row}")
    att = pd.read_csv(PROC / "attribution.csv")
    ws = sheet(wb, "Attribution", "Shareholder-return attribution (Shapley, order-independent; reporting currency) + dividends + FX",
               "price_return = contrib_ebitda + contrib_multiple + contrib_net_debt_bridge + contrib_share_count (sum check = 0). Dividends simple (not reinvested); reinvest_timing_residual reconciles to compounded TR. FX = reporting ccy -> GBP. cf_const_multiple = attribution counterfactual holding the starting multiple, not a forecast. Flags mark abnormal bases / corporate actions.")
    write_df(ws, att, r0=4)
    rs = pd.read_csv(PROC / "returns_summary.csv")
    ws = sheet(wb, "Returns_Benchmarks", "TSR vs geographic, sector, S&P 500 TR and FTSE 250 TR benchmarks - local and GBP",
               "Benchmark mapping fixed before calculation (config/benchmark_map.csv). Local = stock quote currency with benchmark converted to it; GBP = both unhedged in GBP. xs_ = annualised excess return in percentage points. ETF proxies used where TR index unavailable (fees/tracking noted in Limitations). qc_tr5_vs_adjclose_pp: London adj-close excludes dividends (provider quirk) - own TR used.")
    write_df(ws, rs, r0=4)
    br = pd.read_csv(PROC / "benchmark_summary.csv")
    write_df(ws, br, r0=len(rs) + 8)
    cal = pd.read_csv(PROC / "calendar_returns.csv").pivot_table(index=["id", "basis"], columns="year", values="return").reset_index()
    cal.columns = [str(c) for c in cal.columns]
    ws = sheet(wb, "Calendar_Returns", "Calendar-year total returns (local and GBP); 2026 = YTD to valuation date")
    write_df(ws, cal, r0=4, fmt={c: "0.0%" for c in cal.columns if c.isdigit()})
    scenarios_sheet(wb, S, rowmap, L, FL)
    sc_cols = ["id", "name", "sector", "peer_group", "gate_status", "p_quality", "p_growth", "p_cash", "p_valuation", "p_governance",
               "operating_momentum", "evidence_confidence", "score_base", "score_equal", "score_quality_heavy", "score_value_heavy",
               "rank_overall", "rank_base", "rank_equal", "rank_quality_heavy", "rank_value_heavy", "rank_range_across_weights", "rank_in_sector",
               "quality_rank_in_sector", "value_rank_in_sector"] + [f"q_{k}" for k in ["A", "B", "C", "D", "E", "F", "G", "H", "I1", "I2", "I3", "I4", "J", "K"]]
    d = S[[c for c in sc_cols if c in S]].sort_values("score_base", ascending=False)
    ws = sheet(wb, "Scores_Ranking", "Pillar scores and combined attractiveness (weights fixed ex ante: Quality 25 / Growth 20 / Cash 20 / Valuation 25 / Governance 10)",
               "Scores organise research; they do not select investments. Differences < 5 points are not meaningful. Gate-A names are not ranked. Sensitivity: rank under equal, quality-heavy and value-heavy weights.")
    write_df(ws, d, r0=4, fmt={c: "0" for c in d.columns if c.startswith(("p_", "score", "operating", "evidence"))} | {c: "0" for c in d.columns if c.startswith("rank") or "rank" in c} | {c: "0" for c in d.columns if c.startswith("q_")})
    sl = pd.read_csv(PROC / "shortlist.csv")
    dec = pd.read_csv(CFG / "basket_decision.csv") if (CFG / "basket_decision.csv").exists() else pd.DataFrame()
    ws = sheet(wb, "Shortlist_Basket", "Cross-sector shortlist and proposed concentrated basket (lead-agent decision with written rationale)",
               "Equal weights are the analytical baseline only; recommended limits are presented for approval in the report. Buy ranges in Scenarios.")
    if len(dec):
        dd = dec.merge(S[["id", "sector", "peer_group", "gate_status", "irr_bear_5y", "irr_base_5y", "irr_bull_5y", "buy_below_price_9pct", "fair_max_price_7pct", "price", "price_ccy", "score_base"]], on="id", how="left")
        write_df(ws, dd, r0=4)
    else:
        write_df(ws, sl, r0=4)
    st = pd.read_csv(PROC / "stress_tests.csv")
    ws = sheet(wb, "Exposures_Stress", "Basket exposures and stress indicators",
               "Calibrated = computed from provider data (GFC/COVID peak-to-trough TTM, 2020/2022 GBP drawdowns, +200bp on half of pre-lease net debt as % of FCF, GBP +10% translation). Judgement = 1 (low) - 3 (high) from rubric J/I2. No invented correlations or losses.")
    r = write_df(ws, st, r0=4)
    exp_rows = []
    for k, v in port["exposures"].items():
        for kk, vv in v.items():
            exp_rows.append({"dimension": k, "bucket": kk, "weight": vv})
    for kk, vv in port["geo_weighted_pct"].items():
        exp_rows.append({"dimension": "revenue geography (% of revenue, weighted over names with data)", "bucket": kk, "weight": vv / 100 if isinstance(vv, (int, float)) and pd.notna(vv) else (np.nan if not isinstance(vv, str) else vv)})
    for kk, vv in port["basket_corr_with_existing"].items():
        exp_rows.append({"dimension": "5y monthly GBP return correlation: basket vs existing", "bucket": kk, "weight": vv})
    write_df(ws, pd.DataFrame(exp_rows), r0=r + 4, fmt={"weight": "0.00"})
    corr = pd.read_csv(PROC / "correlations.csv", index_col=0).reset_index().rename(columns={"index": "id"})
    ws = sheet(wb, "Correlations", "5-year monthly GBP total-return correlations (basket names and disclosed existing holdings / index proxies)")
    write_df(ws, corr, r0=4, fmt={c: "0.00" for c in corr.columns})
    ea = pd.read_csv(PROC / "exercise_a.csv")
    ws = sheet(wb, "Exercise_A", "Retrospective analysis of today's selected companies - not a point-in-time investable strategy backtest.",
               "Equal weight, rebalanced each November, GBP, gross of costs/taxes. Selection & survivorship bias: these companies were chosen today with hindsight of their survival and current quality.")
    write_df(ws, ea, r0=4)
    eb = pd.read_csv(PROC / "exercise_b_diagnostic_log.csv"); ebs = pd.read_csv(PROC / "exercise_b_diagnostic_summary.csv")
    ws = sheet(wb, "Exercise_B_Diagnostic", "Exercise B: a valid point-in-time strategy backtest could NOT be run - quantitative-only diagnostic shown instead",
               "Missing for validity: historical eligible universe incl. failures/delistings; dated qualitative evidence; as-first-reported fundamentals. Diagnostic uses today's survivors (biased upward), PitchBook data with reporting lags, rules fixed ex ante, costs 0.30% round trip + 0.5% UK stamp + 0.25% FX on buys.")
    r = write_df(ws, ebs, r0=4)
    write_df(ws, eb, r0=r + 4)
    ws = sheet(wb, "Exclusion_Log", "Risk gates and exclusion log (A = excluded, B = requires further evidence, C = eligible)",
               "Gates applied before ranking; a high score never offsets an A. Quantitative tests combined with sector-agent evidence (worst wins). Thresholds by subsector: docs/methodology.md §6.")
    write_df(ws, gates, r0=4)
    ws.column_dimensions["K"].width = 120
    ws = sheet(wb, "Sources", "Source register (sector agents; plus provider sources)",
               "Provider sources: PitchBook financials (retrieved 2026-11-12, PBIDs in Universe/Qual_Scores); Yahoo Finance chart & fundamentals-timeseries endpoints (retrieved 2026-11-12). IFRS cash-flow classification: research/ifrs_cashflow_classification.csv.")
    write_df(ws, src, r0=4)
    lim = pd.read_csv(OUT / "limitations.csv") if (OUT / "limitations.csv").exists() else pd.DataFrame({"limitation": ["see QC_Report.md"]})
    ws = sheet(wb, "Limitations", "Data gaps, limitations and QC flags (summary; full detail in output/QC_Report.md)")
    write_df(ws, lim, r0=4)
    ws.column_dimensions["B"].width = 140
    for w in wb.worksheets:
        for row in w.iter_rows(min_row=1, max_row=2):
            for c in row:
                if c.value and c.font != TITLE:
                    pass
    out = OUT / "Equity_Research_Workbook.xlsx"
    wb.save(out)
    print(out)


if __name__ == "__main__":
    main()
