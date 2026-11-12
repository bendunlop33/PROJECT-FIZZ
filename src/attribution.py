"""Shareholder-return attribution (Shapley, order-independent).

Price_t = (EBITDA_k * M_t - ND_k) / S_k   (reporting currency; k = latest TTM period published by t)
with M_t = (S_k * P_t + ND_k) / EBITDA_k so that the identity holds exactly at both dates.
S_k is the PitchBook-implied economic share count (EV_k - ND_k)/P_k (absorbs minorities/other EV bridge items);
its agreement with reported shares is reported as the reconciliation check.
Factors: E (TTM EBITDA growth), M (EV/EBITDA multiple), N (net debt & EV bridge), S (share count).
Dividends (cash, not reinvested) and FX (reporting -> GBP) are reported separately. The compounded TR from the
returns engine is shown alongside; 'reinvestment & timing residual' = TR - (price + simple dividend yield).
Counterfactual: constant starting multiple (M_t0 held) -> attribution counterfactual, not a forecast.
"""
from __future__ import annotations
import itertools, math
import numpy as np
import pandas as pd
from common import PROC, VALUATION_DATE, universe
from fx import cross, to_gbp
from returns import tr_index, load_prices, period_return
from fundamentals import reporting_lag_days


def shapley(f, x0: dict, x1: dict) -> dict:
    keys = list(x0)
    n = len(keys)
    phi = {k: 0.0 for k in keys}
    for k in keys:
        others = [o for o in keys if o != k]
        for r in range(n):
            for sub in itertools.combinations(others, r):
                w = math.factorial(r) * math.factorial(n - r - 1) / math.factorial(n)
                base = {o: (x1[o] if o in sub else x0[o]) for o in keys}
                with_k = dict(base, **{k: x1[k]})
                phi[k] += w * (f(with_k) - f(base))
    return phi


def price_fn(v):
    return (v["E"] * v["M"] - v["N"]) / v["S"]


def state_at(g: pd.DataFrame, px_rep: pd.Series, t: pd.Timestamp):
    avail = g[g.pub_date <= t]
    if avail.empty:
        return None
    k = avail.iloc[-1]
    p = px_rep.asof(t)
    if pd.isna(p) or k.ebitda <= 0:
        return None
    S = k.implied_shares
    M = (S * p + k.net_debt) / k.ebitda
    return {"E": k.ebitda, "M": M, "N": k.net_debt, "S": S, "P": p, "period": avail.index[-1]}


def main():
    u = universe()
    pbl = pd.read_csv(PROC / "pb_history_local.csv", parse_dates=["period_end"])
    val = pd.read_csv(PROC / "pitchbook_mapping_validation.csv").set_index("id")
    p, d = load_prices()
    rows = []
    for _, r in u.iterrows():
        g = pbl[pbl.id == r.id].set_index("period_end").sort_index().dropna(subset=["ev", "net_debt", "ebitda"])
        t = tr_index(r.yahoo, p, d)
        if g.empty or t.empty or t.index[-1] < VALUATION_DATE - pd.Timedelta(days=5):
            continue
        rep = g["rep_ccy"].iloc[0]
        pccy = t["price_ccy"].iloc[-1]
        conv = cross(pccy, rep).reindex(t.index).ffill()
        px_rep = t["px_local"] * conv
        g["px_k"] = [px_rep.asof(pe) for pe in g.index]
        g["implied_shares"] = (g["ev"] - g["net_debt"]) / g["px_k"]
        fye = int(val.loc[r.id, "fye_month"]) if r.id in val.index else 12
        g["pub_date"] = [pe + pd.Timedelta(days=reporting_lag_days(pe, fye, r.region)) for pe in g.index]
        divs = d[d.symbol == r.yahoo].set_index("date")["amount"]
        for yrs in (1, 3, 5):
            t0 = VALUATION_DATE - pd.DateOffset(years=yrs)
            if t.index[0] > t0:
                continue
            s0, s1 = state_at(g, px_rep, t0), state_at(g, px_rep, VALUATION_DATE)
            if not s0 or not s1:
                continue
            x0 = {k: s0[k] for k in "EMNS"}; x1 = {k: s1[k] for k in "EMNS"}
            phi = shapley(price_fn, x0, x1)
            P0, P1 = price_fn(x0), price_fn(x1)
            dv = divs[(divs.index > t0) & (divs.index <= VALUATION_DATE)]
            div_rep = float(sum(a * conv.asof(dt) for dt, a in dv.items())) if len(dv) else 0.0
            tr_loc = period_return(t["tr_local"], yrs)
            # TR in reporting currency
            tr_rep = (1 + tr_loc) * (conv.asof(VALUATION_DATE) / conv.asof(t0)) - 1
            tr_gbp = period_return(t["tr_gbp"], yrs)
            cf = (x1["E"] * x0["M"] - x1["N"]) / x1["S"]
            rec = {"id": r.id, "years": yrs, "t0": t0.date(), "rep_ccy": rep, "period_t0": s0["period"].date(),
                   "period_t1": s1["period"].date(), "price_t0_rep": P0, "price_t1_rep": P1,
                   "check_price_t0": s0["P"], "check_price_t1": s1["P"],
                   "price_return": P1 / P0 - 1, "contrib_ebitda": phi["E"] / P0, "contrib_multiple": phi["M"] / P0,
                   "contrib_net_debt_bridge": phi["N"] / P0, "contrib_share_count": phi["S"] / P0,
                   "dividends_simple": div_rep / P0, "tr_rep_compounded": tr_rep,
                   "reinvest_timing_residual": tr_rep - (P1 / P0 - 1 + div_rep / P0),
                   "fx_rep_to_gbp": (1 + tr_gbp) / (1 + tr_rep) - 1 if pd.notna(tr_gbp) else np.nan,
                   "tr_gbp": tr_gbp, "ebitda_growth": x1["E"] / x0["E"] - 1, "multiple_t0": x0["M"],
                   "multiple_t1": x1["M"], "multiple_change": x1["M"] / x0["M"] - 1,
                   "shares_change": x1["S"] / x0["S"] - 1,
                   "net_debt_t0": x0["N"], "net_debt_t1": x1["N"],
                   "cf_const_multiple_price_return": cf / P0 - 1,
                   "cf_const_multiple_cagr": (cf / P0) ** (1 / yrs) - 1 if cf > 0 else np.nan,
                   "actual_price_cagr": (P1 / P0) ** (1 / yrs) - 1 if P1 > 0 else np.nan}
            rec["shapley_sum_check"] = rec["contrib_ebitda"] + rec["contrib_multiple"] + rec["contrib_net_debt_bridge"] + rec["contrib_share_count"] - rec["price_return"]
            # share of price change explained by multiple
            rec["multiple_share_of_price_change"] = rec["contrib_multiple"] / rec["price_return"] if abs(rec["price_return"]) > 0.05 else np.nan
            ca = pd.read_csv(PROC.parent.parent / "config" / "corporate_actions.csv")
            ca_hit = ca[(ca.symbol == r.yahoo) & (pd.to_datetime(ca.date) > t0)]
            flags = []
            ratio = x1["E"] / x0["E"]
            if ratio > 3 or ratio < 1 / 3:
                flags.append("abnormal EBITDA base (impairment/divestiture/loss) - decomposition not economically meaningful")
            if len(ca_hit):
                flags.append("corporate action in window: " + "; ".join(ca_hit.type + " " + ca_hit.date))
            if abs(x1["S"] / x0["S"] - 1) > 0.25:
                flags.append("implied share count moved >25% - check spin-off/issuance/claims")
            rec["flags"] = " | ".join(flags)
            rows.append(rec)
    out = pd.DataFrame(rows)
    out.to_csv(PROC / "attribution.csv", index=False)
    return out


if __name__ == "__main__":
    a = main()
    c = ["id", "years", "price_return", "contrib_ebitda", "contrib_multiple", "contrib_net_debt_bridge", "contrib_share_count", "dividends_simple", "fx_rep_to_gbp", "shapley_sum_check"]
    with pd.option_context("display.width", 220, "display.max_rows", 400):
        print(a[a.years == 5][c].round(3).to_string())
