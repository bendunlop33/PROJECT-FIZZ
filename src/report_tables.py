"""Generate markdown tables used by the investment report (output/report_tables.md) so every number in the
report is traceable to pipeline output."""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from common import PROC, OUT, CFG

SECT = {"S1": "Business services", "S2": "Consumer health & medical consumables", "S3": "Consumer staples & household",
        "S4": "Specialist industrials & distribution", "S5": "Waste, water & environmental services", "S6": "Insurance brokerage & specialist risk services"}


def p(x, d=1):
    return "n/a" if pd.isna(x) else f"{x*100:.{d}f}%"


def m(x):
    return "n/a" if pd.isna(x) else f"{x:.1f}x"


def n0(x):
    return "n/a" if pd.isna(x) else f"{x:.0f}"


def md(df):
    cols = list(df.columns)
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in df.iterrows():
        out.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(out)


def main():
    S = pd.read_csv(PROC / "scores.csv")
    att = pd.read_csv(PROC / "attribution.csv")
    a5 = att[att.years == 5].set_index("id")
    rs = pd.read_csv(PROC / "returns_summary.csv").set_index("id")
    L = []
    for s, nm in SECT.items():
        d = S[S.sector == s].copy()
        d["rk"] = d["score_base"].rank(ascending=False)
        d = d.sort_values(["rk", "id"])
        rows = []
        for _, r in d.iterrows():
            rows.append({"Company": f"{r['name']} ({r.id})", "Peer group": r.peer_group, "Gate": r.gate_status,
                         "Quality": n0(r.p_quality), "Growth": n0(r.p_growth), "Cash": n0(r.p_cash), "Value": n0(r.p_valuation),
                         "Score": n0(r.score_base), "Q-rank": n0(r.quality_rank_in_sector), "V-rank": n0(r.value_rank_in_sector),
                         "EV/EBITDAaL": m(r.ev_ebitdaal_adj), "vs own 10y med (PIT)": m(r.ev_ebitda_pit_now) + " / " + m(r.ev_ebitda_median_10y),
                         "FCF yld": p(r.fcf_yield), "g base": p(r.g_base), "5y IRR bear/base/bull": f"{p(r.irr_bear_5y,0)} / {p(r.irr_base_5y,0)} / {p(r.irr_bull_5y,0)}",
                         "5y TSR GBP p.a.": p(rs.loc[r.id, "cagr_gbp_5y"]) if r.id in rs.index and "cagr_gbp_5y" in rs else "n/a",
                         "5y multiple contrib.": p(a5.loc[r.id, "contrib_multiple"], 0) if r.id in a5.index else "n/a"})
        L.append(f"### {s} - {nm}\n\n" + md(pd.DataFrame(rows)) + "\n")
    (OUT / "report_tables.md").write_text("\n".join(L))
    print("written", OUT / "report_tables.md")


if __name__ == "__main__":
    main()
