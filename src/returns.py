"""Total-shareholder-return engine: daily TR indices (local & GBP), benchmark comparisons and risk statistics.

TR construction: r_t = (P_t + D_t) / P_{t-1} - 1 using split/spin-adjusted closes and ex-date cash dividends
(gross, no withholding tax). Spin-offs are reinvested in the parent via Yahoo's back-adjustment (see
config/corporate_actions.csv). Benchmarks: official TR index level or ETF adjusted close (distributions reinvested).
GBP series: local TR index x (quote currency -> GBP) on the same date (unhedged).
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from common import PROC, CFG, VALUATION_DATE, universe
from fx import to_gbp

HORIZONS = {"1y": 1, "3y": 3, "5y": 5, "10y": 10}


def _currency_segments(sym: str, dates: pd.DatetimeIndex, default: str) -> pd.Series:
    ov = pd.read_csv(CFG / "price_currency_overrides.csv", parse_dates=["start", "end"])
    c = pd.Series(default, index=dates)
    for _, o in ov[ov.symbol == sym].iterrows():
        c[(c.index >= o.start) & (c.index <= o.end)] = o.currency
    return c


def load_prices():
    p = pd.read_parquet(PROC / "prices.parquet")
    d = pd.read_csv(PROC / "dividends.csv", parse_dates=["date"])
    return p, d


def tr_index(sym: str, p=None, d=None, use_adjclose=False) -> pd.DataFrame:
    """Return DataFrame[date] with columns: close, ccy, tr_local (rebased 100 at first date), tr_gbp, px_local_idx.

    Local means quote currency. If the quote currency changes (override), the local index is chained in the
    *latest* currency so it stays continuous (conversion at the switch date)."""
    if p is None:
        p, d = load_prices()
    x = p[p.symbol == sym].set_index("date").sort_index()
    x = x[~x.index.duplicated(keep="last")]
    if x.empty:
        return pd.DataFrame()
    ccy = _currency_segments(sym, x.index, x["currency"].iloc[-1])
    last_ccy = ccy.iloc[-1]
    px = x["adjclose"] if use_adjclose else x["close"]
    dv = d[d.symbol == sym].groupby("date")["amount"].sum().reindex(x.index).fillna(0.0) if not use_adjclose else 0.0
    # convert everything into the latest quote currency on each date so returns across a currency switch are real
    conv = pd.Series(1.0, index=x.index)
    for c in ccy.unique():
        if c != last_ccy:
            m = ccy == c
            conv[m] = (to_gbp(c) / to_gbp(last_ccy)).reindex(x.index).ffill()[m]
    px_c = px * conv
    dv_c = dv * conv if not use_adjclose else 0.0
    r = ((px_c + dv_c) / px_c.shift(1) - 1).fillna(0.0)
    pr = (px_c / px_c.shift(1) - 1).fillna(0.0)
    out = pd.DataFrame({"close": px, "ccy": ccy, "px_local": px_c, "div_local": dv_c if not use_adjclose else 0.0})
    out["tr_local"] = 100 * (1 + r).cumprod()
    out["price_local_idx"] = 100 * (1 + pr).cumprod()
    g = to_gbp(last_ccy).reindex(x.index).ffill()
    out["tr_gbp"] = out["tr_local"] * g / g.iloc[0]
    out["price_ccy"] = last_ccy
    return out


def monthly(s: pd.Series) -> pd.Series:
    s = s[s.index <= VALUATION_DATE]
    m = s.resample("ME").last()
    m.iloc[-1] = s.iloc[-1]  # partial month ends at valuation date
    m.index = list(m.index[:-1]) + [VALUATION_DATE]
    return m


def period_return(s: pd.Series, years: float, end=VALUATION_DATE):
    s = s[s.index <= end].dropna()
    start = end - pd.DateOffset(years=years)
    if s.index[0] > start + pd.Timedelta(days=7):
        return np.nan
    return float(s.iloc[-1] / s.asof(start) - 1)


def cagr(total, years):
    return np.nan if pd.isna(total) else (1 + total) ** (1 / years) - 1


def max_drawdown(s: pd.Series, years=None):
    if years:
        s = s[s.index >= VALUATION_DATE - pd.DateOffset(years=years)]
    s = s.dropna()
    peak = s.cummax()
    dd = s / peak - 1
    trough = dd.idxmin()
    mdd = float(dd.min())
    pk = s[:trough].idxmax()
    rec = s[trough:][s[trough:] >= s[pk]]
    rec_days = (rec.index[0] - trough).days if len(rec) else np.nan
    return mdd, pk, trough, rec_days


def stats(s: pd.Series, bench: pd.Series | None = None, years=5) -> dict:
    """Annualised stats over `years` using monthly returns; excess/tracking/IR vs bench if given (same currency)."""
    m = monthly(s)
    m = m[m.index >= VALUATION_DATE - pd.DateOffset(years=years) - pd.Timedelta(days=5)]
    r = m.pct_change().dropna()
    out = {"vol_ann": float(r.std() * np.sqrt(12)) if len(r) > 6 else np.nan}
    if bench is not None and len(bench.dropna()):
        b = monthly(bench).reindex(m.index).pct_change().dropna()
        a = r.reindex(b.index).dropna()
        b = b.reindex(a.index)
        if len(a) > 12:
            te = float((a - b).std() * np.sqrt(12))
            ex = cagr(period_return(s, years), years) - cagr(period_return(bench, years), years)
            out.update({"excess_cagr_pp": ex * 100 if pd.notna(ex) else np.nan, "tracking_error": te,
                        "info_ratio": ex / te if te and pd.notna(ex) else np.nan})
    return out


def calendar_returns(s: pd.Series) -> pd.Series:
    y = s.resample("YE").last()
    first = s.iloc[0]
    rets = y.pct_change()
    if s.index[0] <= pd.Timestamp(f"{s.index[0].year}-01-10"):
        rets.iloc[0] = y.iloc[0] / first - 1
    rets.index = rets.index.year
    ytd_key = VALUATION_DATE.year
    rets.loc[ytd_key] = s.asof(VALUATION_DATE) / y.asof(pd.Timestamp(f"{ytd_key-1}-12-31")) - 1
    return rets


def rolling_cagr(s: pd.Series, years: int) -> pd.Series:
    m = monthly(s)
    return (m / m.shift(12 * years)) ** (1 / years) - 1


def benchmark_series():
    b = pd.read_csv(CFG / "benchmarks.csv")
    p, d = load_prices()
    out = {}
    for _, r in b.iterrows():
        t = tr_index(r.yahoo, p, d, use_adjclose=bool(r.use_adjclose))
        if len(t):
            out[r.key] = t
    return out


def benchmark_for(row, bmap: pd.DataFrame):
    m = bmap[(bmap.sector == row.sector) & (bmap.region == row.region)]
    exact = m[m.peer_group == row.peer_group]
    m = exact if len(exact) else m[m.peer_group == "*"]
    if not len(m):
        raise KeyError(f"no benchmark mapping for {row.id}")
    return m.iloc[0].geo_benchmark, m.iloc[0].sector_benchmark


def build():
    u = universe()
    bmap = pd.read_csv(CFG / "benchmark_map.csv", comment="#")
    p, d = load_prices()
    bs = benchmark_series()
    rows, cal, series = [], [], {}
    for _, r in u.iterrows():
        t = tr_index(r.yahoo, p, d)
        if t.empty or t.index[-1] < VALUATION_DATE - pd.Timedelta(days=20):
            rows.append({"id": r.id, "note": "no current price series (delisted/acquired)"}); continue
        adj = tr_index(r.yahoo, p, d, use_adjclose=True)
        series[r.id] = t
        geo, sec = benchmark_for(r, bmap)
        ccy = t["price_ccy"].iloc[-1]
        rec = {"id": r.id, "price_ccy": ccy, "price": float(t["close"].asof(VALUATION_DATE)),
               "first_date": t.index[0].date(), "geo_bench": geo, "sector_bench": sec}
        for k, yv in HORIZONS.items():
            for base, col in (("local", "tr_local"), ("gbp", "tr_gbp")):
                tot = period_return(t[col], yv)
                rec[f"tr_{base}_{k}"] = tot
                rec[f"cagr_{base}_{k}"] = cagr(tot, yv)
            rec[f"price_local_{k}"] = period_return(t["price_local_idx"], yv)
        rec["qc_tr5_vs_adjclose_pp"] = (rec["tr_local_5y"] - period_return(adj["tr_local"], 5)) * 100 if len(adj) else np.nan
        # benchmark comparisons: local (benchmark converted to stock quote ccy) and GBP
        for lab, key in (("geo", geo), ("sector", sec), ("sp500", "SP500TR"), ("ftse250", "FTSE250TR")):
            b = bs[key]
            bccy = b["price_ccy"].iloc[-1]
            b_local = b["tr_local"] * (to_gbp(bccy) / to_gbp(ccy)).reindex(b.index).ffill()
            for yv in (1, 3, 5, 10):
                bl, bg = period_return(b_local, yv), period_return(b["tr_gbp"], yv)
                rec[f"{lab}_cagr_local_{yv}y"] = cagr(bl, yv)
                rec[f"{lab}_cagr_gbp_{yv}y"] = cagr(bg, yv)
                rec[f"xs_{lab}_local_{yv}y_pp"] = (rec[f"cagr_local_{yv}y"] - cagr(bl, yv)) * 100 if pd.notna(bl) else np.nan
                rec[f"xs_{lab}_gbp_{yv}y_pp"] = (rec[f"cagr_gbp_{yv}y"] - cagr(bg, yv)) * 100 if pd.notna(bg) else np.nan
            st = stats(t["tr_gbp"], b["tr_gbp"], 5)
            rec[f"te_{lab}_gbp_5y"] = st.get("tracking_error"); rec[f"ir_{lab}_gbp_5y"] = st.get("info_ratio")
        for yrs in (5, 10):
            st = stats(t["tr_gbp"], None, yrs)
            rec[f"vol_gbp_{yrs}y"] = st["vol_ann"]
            mdd, pk, tr_, rec_d = max_drawdown(t["tr_gbp"], yrs)
            rec[f"mdd_gbp_{yrs}y"] = mdd; rec[f"mdd_peak_{yrs}y"] = pk.date(); rec[f"mdd_trough_{yrs}y"] = tr_.date()
            rec[f"mdd_recovery_days_{yrs}y"] = rec_d
        st = stats(t["tr_local"], None, 5); rec["vol_local_5y"] = st["vol_ann"]
        for yrs in (3, 5):
            rc = rolling_cagr(t["tr_gbp"], yrs).dropna()
            rec[f"roll{yrs}y_gbp_min"] = rc.min() if len(rc) else np.nan
            rec[f"roll{yrs}y_gbp_median"] = rc.median() if len(rc) else np.nan
            rec[f"roll{yrs}y_gbp_max"] = rc.max() if len(rc) else np.nan
        rows.append(rec)
        for base in ("local", "gbp"):
            cr = calendar_returns(t[f"tr_{base}"])
            cal.append(pd.DataFrame({"id": r.id, "basis": base, "year": cr.index, "return": cr.values}))
    res = pd.DataFrame(rows)
    res.to_csv(PROC / "returns_summary.csv", index=False)
    pd.concat(cal).to_csv(PROC / "calendar_returns.csv", index=False)
    # benchmark summaries
    brow = []
    for k, b in bs.items():
        rr = {"key": k, "ccy": b["price_ccy"].iloc[-1], "first": b.index[0].date()}
        for yv in (1, 3, 5, 10):
            rr[f"cagr_local_{yv}y"] = cagr(period_return(b["tr_local"], yv), yv)
            rr[f"cagr_gbp_{yv}y"] = cagr(period_return(b["tr_gbp"], yv), yv)
        rr["vol_gbp_5y"] = stats(b["tr_gbp"], None, 5)["vol_ann"]
        rr["mdd_gbp_5y"] = max_drawdown(b["tr_gbp"], 5)[0]
        brow.append(rr)
    pd.DataFrame(brow).to_csv(PROC / "benchmark_summary.csv", index=False)
    # monthly series for charts / basket analysis
    mon = {f"{k}|tr_gbp": monthly(v["tr_gbp"]) for k, v in series.items()}
    mon.update({f"{k}|tr_local": monthly(v["tr_local"]) for k, v in series.items()})
    mon.update({f"{k}|price_local": monthly(v["price_local_idx"]) for k, v in series.items()})
    mon.update({f"BENCH:{k}|tr_gbp": monthly(v["tr_gbp"]) for k, v in bs.items()})
    mon.update({f"BENCH:{k}|tr_local": monthly(v["tr_local"]) for k, v in bs.items()})
    pd.DataFrame(mon).to_parquet(PROC / "monthly_series.parquet")
    return res


if __name__ == "__main__":
    r = build()
    cols = ["id", "price_ccy", "cagr_local_5y", "cagr_gbp_5y", "xs_geo_gbp_5y_pp", "xs_sp500_gbp_5y_pp", "vol_gbp_5y", "mdd_gbp_5y", "qc_tr5_vs_adjclose_pp"]
    with pd.option_context("display.width", 200, "display.max_rows", 200):
        print(r[cols].round(3).to_string())
