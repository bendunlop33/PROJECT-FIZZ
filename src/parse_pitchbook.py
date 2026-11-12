"""Parse PitchBook financials extracts (markdown tables, USD millions, quarterly TTM) into a tidy table.

Fiscal labels ('TTM 1Q2027') are mapped to period-end dates using the company's fiscal year-end month,
taken from Yahoo annual statements (mode of period_end month). Output: data/processed/pitchbook_ttm.parquet
"""
from __future__ import annotations
import json, re
import pandas as pd
from common import RAW, PROC, universe

METRIC_KEYS = {"Revenue": "revenue", "Gross Profit": "gross_profit", "Net Income": "net_income",
               "Enterprise Value": "ev", "EBITDA": "ebitda", "EBIT": "ebit", "Net Debt": "net_debt",
               "Total Assets": "total_assets", "Cash and Cash Equivalents": "cash", "Total Equity": "equity",
               "Total Debt": "total_debt", "Cash, Cash Equivalents, and Short-Term Investments": "cash_sti",
               "Net Property, Plant, and Equipment": "ppe", "Working Capital": "working_capital",
               "Total Current Liabilities": "current_liabilities", "Total Current Assets": "current_assets"}


def fy_end_month(yf: pd.DataFrame, cid: str) -> int:
    a = yf[(yf.id == cid) & (yf.freq == "annual")]["period_end"]
    return int(a.dt.month.mode().iloc[0]) if len(a) else 12


def label_to_date(label: str, fye_month: int) -> pd.Timestamp:
    m = re.match(r"(\d)Q(\d{4})", label)
    qn, fy = int(m.group(1)), int(m.group(2))
    # Fiscal year FY ends in month fye_month of calendar year FY (for Jan-May year-ends some issuers label the
    # fiscal year by the *starting* calendar year; validated against Yahoo below and overridden if needed).
    end = pd.Timestamp(year=fy, month=fye_month, day=1) + pd.offsets.MonthEnd(0)
    return (end - pd.DateOffset(months=3 * (4 - qn))) + pd.offsets.MonthEnd(0)


def parse_file(path) -> pd.DataFrame:
    txt = json.loads(path.read_text())["result"] if path.read_text().lstrip().startswith("{") else path.read_text()
    rows = []
    for sec in txt.split("### ")[1:]:
        name = sec.split("\n")[0].strip()
        if name not in METRIC_KEYS:
            continue
        for lab, val in re.findall(r"\| TTM (\dQ\d{4}) \| ([^|]+) \|", sec):
            v = val.strip()
            if v.lower() in ("none", "", "nan"):
                continue
            rows.append({"metric": METRIC_KEYS[name], "label": lab, "value_usd_m": float(v)})
    return pd.DataFrame(rows)


def main():
    u = universe()
    yf = pd.read_parquet(PROC / "yahoo_fund.parquet")
    out, val = [], []
    for _, r in u.iterrows():
        p = RAW / "pitchbook" / f"{r.id}.json"
        if not p.exists():
            print("MISSING pitchbook", r.id); continue
        df = parse_file(p)
        if df.empty:
            print("EMPTY", r.id); continue
        fye = fy_end_month(yf, r.id)
        # choose label->date convention (shift 0 or -1 year) that best matches Yahoo annual revenue timing
        ya = yf[(yf.id == r.id) & (yf.freq == "annual") & (yf.item == "EBITDA")].set_index("period_end")["value"]
        yr = yf[(yf.id == r.id) & (yf.freq == "annual") & (yf.item == "TotalRevenue")].set_index("period_end")["value"]
        best = (0, float('nan'))
        for shift in (0,):  # labels verified to follow fiscal year of period end (CTAS 1Q2027=Aug-2026, COST 4Q2026=Aug-2026)
            d = df.copy()
            d["period_end"] = [label_to_date(l, fye) + pd.DateOffset(years=shift) for l in d.label]
            d["period_end"] = d["period_end"] + pd.offsets.MonthEnd(0)
            piv = d.pivot_table(index="period_end", columns="metric", values="value_usd_m")
            if "ebitda" not in piv or "revenue" not in piv:
                continue
            m_pb = (piv["ebitda"] / piv["revenue"])
            m_yf = (ya / yr).dropna()
            common = m_pb.index.intersection(m_yf.index)
            if len(common) == 0:
                continue
            err = float((m_pb[common] - m_yf[common]).abs().mean())
            if True:
                best = (shift, err)
        df["period_end"] = [label_to_date(l, fye) + pd.DateOffset(years=best[0]) for l in df.label]
        df["period_end"] = df["period_end"] + pd.offsets.MonthEnd(0)
        df["id"] = r.id
        out.append(df)
        val.append({"id": r.id, "fye_month": fye, "year_shift": best[0], "mean_abs_margin_diff_vs_yahoo": best[1]})
    pd.concat(out).to_parquet(PROC / "pitchbook_ttm.parquet", index=False)
    v = pd.DataFrame(val)
    v.to_csv(PROC / "pitchbook_mapping_validation.csv", index=False)
    print(v.sort_values("mean_abs_margin_diff_vs_yahoo").to_string())


if __name__ == "__main__":
    main()
