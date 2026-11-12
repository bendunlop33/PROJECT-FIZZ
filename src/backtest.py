"""Historical exercises.

EXERCISE A - "Retrospective analysis of today's selected companies - not a point-in-time investable strategy
backtest." Equal-weight, annually rebalanced (each November) GBP total return of today's shortlist and basket vs
benchmarks. Subject to selection and survivorship bias by construction.

EXERCISE B - A valid point-in-time strategy backtest is NOT possible with the available data (no historical
eligible universe incl. failures/delistings; no point-in-time qualitative evidence; provider history is current
vintage). Instead we run a clearly-labelled QUANTITATIVE-ONLY DIAGNOSTIC on today's universe (survivorship-biased):
each November t, using only PitchBook TTM data published by t (reporting lag), rank by (a) EV/EBITDA discount to own
trailing 5y median and (b) 3y TTM EBITDA growth; hold top third equal-weight for 12 months; costs: 0.30% round-trip
spread/commission on turnover + 0.5% UK stamp duty on UK buys + 0.25% FX on non-GBP buys. Compared with the
equal-weight universe (same survivors), S&P 500 TR (GBP) and FTSE 250 TR proxy (GBP). Rules fixed before running;
no parameter search.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from common import PROC, VALUATION_DATE, universe
from returns import max_drawdown

COST_SPREAD, STAMP_UK, FX_FEE = 0.003, 0.005, 0.0025


def monthly_tr():
    m = pd.read_parquet(PROC / "monthly_series.parquet")
    cols = [c for c in m.columns if c.endswith("|tr_gbp") and not c.startswith("BENCH:")]
    return m[cols].rename(columns=lambda c: c.split("|")[0]), m


def basket_path(ids, start, end, m):
    """Equal weight, rebalanced every November (anniversary of valuation date); names enter when listed."""
    m = m[(m.index >= start) & (m.index <= end)]
    r = m.pct_change()
    val, out, w = 1.0, [], None
    for i, dt in enumerate(m.index):
        if i == 0 or dt.month == 11 and (w is None or True and dt.day >= 1 and m.index[i - 1].month == 10):
            live = [c for c in ids if c in m and pd.notna(m.loc[dt, c])]
            w = pd.Series(1 / len(live), index=live) if live else None
            out.append(val); continue
        if w is None:
            out.append(val); continue
        rr = r.loc[dt, w.index].fillna(0.0)
        val *= 1 + float((w * rr).sum())
        w = w * (1 + rr); w = w / w.sum()
        out.append(val)
    return pd.Series(out, index=m.index)


def summarise(s: pd.Series, label: str):
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    r = s.pct_change().dropna()
    mdd = max_drawdown(s)[0]
    return {"series": label, "start": s.index[0].date(), "end": s.index[-1].date(), "years": round(yrs, 1),
            "cagr": (s.iloc[-1] / s.iloc[0]) ** (1 / yrs) - 1, "cumulative": s.iloc[-1] / s.iloc[0] - 1,
            "vol_ann": r.std() * np.sqrt(12), "max_drawdown": mdd}


def exercise_a(shortlist, basket):
    tr, m = monthly_tr()
    rows, paths = [], {}
    for yrs in (5, 10):
        start = VALUATION_DATE - pd.DateOffset(years=yrs)
        for lab, ids in (("Basket (equal weight)", basket), ("Shortlist (equal weight)", shortlist),
                         ("Full research universe incl. gated (equal weight)", list(tr.columns))):
            p = basket_path(ids, start, VALUATION_DATE, tr)
            rows.append({**summarise(p, lab), "horizon": f"{yrs}y", "n_names": len([i for i in ids if i in tr])})
            paths[f"{lab}|{yrs}y"] = p
        for b, lab in (("BENCH:SP500TR|tr_gbp", "S&P 500 TR (GBP)"), ("BENCH:FTSE250TR|tr_gbp", "FTSE 250 TR proxy (GBP)"),
                       ("BENCH:EUROPE|tr_gbp", "STOXX Europe 600 proxy (GBP)")):
            s = m[b].dropna(); s = s[s.index >= start]
            if s.index[0] <= start + pd.Timedelta(days=40):
                rows.append({**summarise(s, lab), "horizon": f"{yrs}y"})
                paths[f"{lab}|{yrs}y"] = s / s.iloc[0]
    out = pd.DataFrame(rows)
    out["label"] = "Retrospective analysis of today's selected companies - not a point-in-time investable strategy backtest."
    out.to_csv(PROC / "exercise_a.csv", index=False)
    pd.DataFrame(paths).to_csv(PROC / "exercise_a_paths.csv")
    return out


def exercise_b_diagnostic():
    u = universe().set_index("id")
    pit = pd.read_csv(PROC / "pit_multiples.csv", parse_dates=["obs_date", "period_k"])
    tr, m = monthly_tr()
    dates = [pd.Timestamp(f"{y}-11-30") for y in range(2016, 2026)] + [VALUATION_DATE]
    nav_s, nav_u, last_w, log = 1.0, 1.0, pd.Series(dtype=float), []
    path_s, path_u = [], []
    for i, d0 in enumerate(dates[:-1]):
        d1 = dates[i + 1]
        obs = pit[pit.obs_date <= d0].sort_values("obs_date")
        cur = obs.groupby("id").tail(1).set_index("id")
        hist = obs[obs.obs_date >= d0 - pd.DateOffset(years=5)].groupby("id")["ev_ebitda_pit"].median()
        g3 = {}
        for cid, gg in obs.groupby("id"):
            gg = gg.drop_duplicates("period_k").set_index("period_k")["ebitda_ttm"]
            past = gg[gg.index <= gg.index[-1] - pd.DateOffset(years=3) + pd.Timedelta(days=30)]
            if len(past) and past.iloc[-1] > 0 and gg.iloc[-1] > 0:
                g3[cid] = (gg.iloc[-1] / past.iloc[-1]) ** (1 / 3) - 1
        df = pd.DataFrame({"disc": hist / cur["ev_ebitda_pit"], "g3": pd.Series(g3)}).dropna()
        df = df[df.index.isin(tr.columns)]
        df = df[[pd.notna(tr.loc[tr.index.asof(d0), c]) if c in tr else False for c in df.index]] if len(df) else df
        if len(df) < 15:
            continue
        df["score"] = df["disc"].rank(pct=True) + df["g3"].rank(pct=True)
        sel = df.sort_values("score", ascending=False).head(max(5, len(df) // 3)).index
        w = pd.Series(1 / len(sel), index=sel)
        # costs on turnover
        turnover = (w.subtract(last_w, fill_value=0).abs().sum()) / 2 if len(last_w) else 1.0
        buys = w.subtract(last_w, fill_value=0).clip(lower=0)
        cost = turnover * 2 * COST_SPREAD / 2 + sum(v * (STAMP_UK if u.loc[c, "region"] == "GB" else 0) +
                                                     v * (FX_FEE if u.loc[c, "region"] != "GB" else 0) for c, v in buys.items())
        seg = tr[(tr.index > d0) & (tr.index <= d1)]
        base = tr.loc[tr.index.asof(d0)]
        rs = float(np.mean([seg[c].iloc[-1] / base[c] - 1 for c in sel if pd.notna(base[c])]))
        univ = [c for c in df.index]
        ru = float(np.mean([seg[c].iloc[-1] / base[c] - 1 for c in univ if pd.notna(base[c])]))
        nav_s *= (1 + rs - cost); nav_u *= (1 + ru)
        log.append({"rebalance": d0.date(), "n_universe": len(df), "n_selected": len(sel), "selected": " ".join(sel),
                    "gross_ret": rs, "cost": cost, "net_ret": rs - cost, "universe_ew_ret": ru, "turnover": turnover})
        last_w = w
    lg = pd.DataFrame(log)
    if len(lg):
        n = (pd.Timestamp(dates[-1]) - pd.Timestamp(lg.rebalance.iloc[0])).days / 365.25
        summ = {"years": round(n, 2), "strategy_net_cagr": (1 + lg.net_ret).prod() ** (1 / n) - 1,
                "strategy_gross_cagr": (1 + lg.gross_ret).prod() ** (1 / n) - 1,
                "universe_ew_cagr": (1 + lg.universe_ew_ret).prod() ** (1 / n) - 1,
                "hit_rate_vs_universe": float((lg.net_ret > lg.universe_ew_ret).mean()),
                "avg_turnover": lg.turnover.mean(), "avg_cost": lg.cost.mean()}
        for b, lab in (("BENCH:SP500TR|tr_gbp", "sp500_gbp_cagr"), ("BENCH:FTSE250TR|tr_gbp", "ftse250_gbp_cagr")):
            s = m[b].dropna()
            a0, a1 = s.asof(pd.Timestamp(lg.rebalance.iloc[0])), s.asof(VALUATION_DATE)
            summ[lab] = (a1 / a0) ** (1 / n) - 1
        summ["label"] = ("QUANTITATIVE-ONLY DIAGNOSTIC on today's surviving universe - survivorship- and selection-biased; "
                         "NOT a valid point-in-time strategy backtest (Exercise B criteria not met).")
        pd.DataFrame([summ]).to_csv(PROC / "exercise_b_diagnostic_summary.csv", index=False)
    lg.to_csv(PROC / "exercise_b_diagnostic_log.csv", index=False)
    return lg


if __name__ == "__main__":
    import json
    port = json.loads((PROC / "portfolio_summary.json").read_text())
    print(exercise_a(port["shortlist"], port["basket"]).round(3).to_string())
    print(exercise_b_diagnostic().round(3).to_string())
    print(pd.read_csv(PROC / "exercise_b_diagnostic_summary.csv").T)
