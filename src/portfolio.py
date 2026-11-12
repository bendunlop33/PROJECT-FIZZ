"""Shortlist, basket, exposures, correlations and stress tests.

Shortlist rule (mechanical pre-screen; final selection is a written lead-agent judgement in config/basket_decision.csv):
  gate status C or B, p_quality >= 55, base-case 5y IRR (no multiple expansion) >= 6%, evidence confidence >= 35,
  top ~18 by base score with <= 4 per sector.
Basket rule (proposal): gate C only, base 5y IRR >= 8% (hurdle vs ~7% assumed long-run equity index return),
  bear 5y IRR >= 0%, <= 2 per peer group, <= 3 per sector, equal weight baseline. Fewer names if fewer qualify.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from common import PROC, CFG, QUAL, VALUATION_DATE, universe
from returns import tr_index, load_prices

HURDLE_BASKET, HURDLE_SHORT = 0.08, 0.06


def qual(cid):
    p = QUAL / f"{cid}.json"
    return json.loads(p.read_text()) if p.exists() else {}


def shortlist_candidates(S):
    c = S[(S.gate_status.isin(["B", "C"])) & (S.p_quality >= 55) & (S.irr_base_5y >= HURDLE_SHORT) & (S.evidence_confidence >= 35)]
    c = c.sort_values("score_base", ascending=False)
    out, per = [], {}
    for _, r in c.iterrows():
        if per.get(r.sector, 0) >= 4:
            continue
        out.append(r.id); per[r.sector] = per.get(r.sector, 0) + 1
        if len(out) >= 18:
            break
    return out


def basket_proposal(S, short):
    c = S[S.id.isin(short) & (S.gate_status == "C") & (S.irr_base_5y >= HURDLE_BASKET) & (S.irr_bear_5y >= 0)]
    c = c.sort_values("score_base", ascending=False)
    out, pg, sec = [], {}, {}
    for _, r in c.iterrows():
        if pg.get(r.peer_group, 0) >= 2 or sec.get(r.sector, 0) >= 3:
            continue
        out.append(r.id); pg[r.peer_group] = pg.get(r.peer_group, 0) + 1; sec[r.sector] = sec.get(r.sector, 0) + 1
        if len(out) >= 10:
            break
    return out


def geo(cid):
    g = (qual(cid).get("geography") or {})
    vf = QUAL.parent / "verification" / f"{cid}.json"
    if vf.exists():
        vg = (json.loads(vf.read_text()).get("geography") or {})
        upd = {k: vg.get(k) for k in ("north_america_pct", "europe_pct", "uk_pct", "china_pct", "largest_country", "largest_country_pct") if vg.get(k) not in (None, "")}
        if isinstance(vg.get("em_other_pct"), (int, float)):
            upd.update({"other_pct": vg["em_other_pct"], "em_pct": vg["em_other_pct"]})
        g = {**g, **upd}
    f = lambda k: g.get(k) if isinstance(g.get(k), (int, float)) else np.nan
    na = f("north_america_pct")
    if pd.isna(na) and "United States" in str(g.get("largest_country", "")) and isinstance(g.get("largest_country_pct"), (int, float)):
        na = g["largest_country_pct"]  # US share used as lower-bound proxy for North America (labelled in report)
    return {"na": na, "eu": f("europe_pct"), "uk": f("uk_pct"), "other": f("other_pct"),
            "china": f("china_pct"), "em": f("em_pct"), "largest_country": g.get("largest_country"),
            "largest_country_pct": f("largest_country_pct")}


def monthly_returns(ids, u):
    p, d = load_prices()
    pe = pd.read_parquet(PROC / "prices_existing.parquet")
    de = pd.read_csv(PROC / "dividends_existing.csv", parse_dates=["date"])
    p2, d2 = pd.concat([p, pe]), pd.concat([d, de])
    ser = {}
    ymap = u.set_index("id")["yahoo"].to_dict()
    eh = pd.read_csv(CFG / "existing_holdings.csv")
    for cid in ids:
        t = tr_index(ymap[cid], p2, d2)
        ser[cid] = t["tr_gbp"]
    for _, e in eh.iterrows():
        t = tr_index(e.yahoo, p2, d2, use_adjclose=e.yahoo in ("CUKX.L", "^SP500TR", "SWDA.L"))
        ser["EXISTING:" + e.key] = t["tr_gbp"]
    m = pd.DataFrame({k: v.resample("ME").last() for k, v in ser.items()})
    m = m[m.index >= VALUATION_DATE - pd.DateOffset(years=5)]
    return m.pct_change().dropna(how="all")


def stress(S, ids, w):
    """Per-name and weighted stress indicators. 'calibrated' = computed from data; 'judgement' = scored 1-3 (3 = most exposed)."""
    rows = []
    pbl = pd.read_csv(PROC / "pb_history_local.csv", parse_dates=["period_end"])
    mret = pd.read_parquet(PROC / "monthly_series.parquet")
    for cid in ids:
        r = S.set_index("id").loc[cid]
        q = qual(cid)
        g = pbl[pbl.id == cid].set_index("period_end").sort_index()
        # GFC: peak-to-trough TTM revenue and EBITDA 2008-06..2010-12 (calibrated, provider data)
        gfc = g[(g.index >= "2008-06-30") & (g.index <= "2010-12-31")]
        p2t = lambda x: float((x / x.cummax() - 1).min()) if len(x.dropna()) > 2 and (x > 0).all() else np.nan
        rev_gfc = p2t(gfc["revenue"]) if "revenue" in gfc else np.nan
        ebitda_gfc = p2t(gfc["ebitda"]) if "ebitda" in gfc else np.nan
        cov = g[(g.index >= "2019-12-31") & (g.index <= "2021-06-30")]
        ebitda_covid = p2t(cov["ebitda"]) if "ebitda" in cov else np.nan
        ymap = universe().set_index("id")["yahoo"].to_dict()
        daily = tr_index(ymap[cid], *load_prices())["tr_gbp"]
        def pk2tr(x, a, b):
            w_ = x[(x.index >= a) & (x.index <= b)]
            return float((w_ / w_.cummax() - 1).min()) if len(w_) > 20 and x.index[0] <= pd.Timestamp(a) else np.nan
        dd2020 = pk2tr(daily, "2020-01-01", "2020-12-31")
        dd2022 = pk2tr(daily, "2022-01-01", "2022-12-31")
        nd = r.net_debt_pre_lease if pd.notna(r.net_debt_pre_lease) else 0
        rate_hit = max(nd, 0) * 0.5 * 0.02 / r.fcf_std if pd.notna(r.fcf_std) and r.fcf_std > 0 else np.nan
        non_gbp = 0.0 if r.rep_ccy == "GBP" else 1.0
        gq = geo(cid)
        if r.rep_ccy == "GBP" and pd.notna(gq["uk"]):
            non_gbp = 1 - gq["uk"] / 100
        sc = lambda k: ((q.get("scores") or {}).get(k) or {}).get("score")
        j = sc("J"); i2 = sc("I2")
        acq = r.acq_spend_3y_pct_ocf
        rows.append({"id": cid, "weight": w.get(cid, np.nan),
                     "gfc_ttm_revenue_peak_trough": rev_gfc, "gfc_ttm_ebitda_peak_trough": ebitda_gfc,
                     "covid_ttm_ebitda_peak_trough": ebitda_covid, "tr_gbp_drawdown_2020": dd2020, "tr_gbp_drawdown_2022": dd2022,
                     "rates_+200bp_half_refinanced_pct_fcf": rate_hit,
                     "gbp_+10pct_translation_hit": -0.10 * non_gbp / 1.10,
                     "wage_energy_passthrough_judgement": {5: 1, 4: 1, 3: 2, 2: 3, 1: 3}.get(j, np.nan) if isinstance(j, (int, float)) else np.nan,
                     "ai_capex_contraction_judgement": {5: 1, 4: 1, 3: 2, 2: 3, 1: 3}.get(i2, np.nan) if isinstance(i2, (int, float)) else np.nan,
                     "acq_market_disruption_exposure": "high" if pd.notna(acq) and acq > 0.5 else ("medium" if pd.notna(acq) and acq > 0.2 else "low"),
                     "acq_spend_3y_pct_ocf": acq})
    df = pd.DataFrame(rows)
    num = df.select_dtypes("number").drop(columns=["weight"])
    wa = pd.Series({c: (num[c] * df["weight"]).sum() / df.loc[num[c].notna(), "weight"].sum() if num[c].notna().any() else np.nan for c in num.columns})
    wa["coverage_note"] = "weighted over names with data; " + ", ".join(f"{c}:{int(num[c].notna().sum())}/{len(df)}" for c in num.columns)
    return df, wa


def main():
    u = universe()
    S = pd.read_csv(PROC / "scores.csv")
    short = shortlist_candidates(S)
    prop = basket_proposal(S, short)
    dec_p = CFG / "basket_decision.csv"
    if dec_p.exists():
        dec = pd.read_csv(dec_p)
        basket = list(dec[dec.decision == "basket"].id)
        short = list(dict.fromkeys(list(dec[dec.decision.isin(["basket", "shortlist"])].id)))
    else:
        basket = prop
    pd.DataFrame({"id": short, "in_mechanical_basket_proposal": [i in prop for i in short]}).to_csv(PROC / "shortlist.csv", index=False)
    w = {i: 1 / len(basket) for i in basket} if basket else {}
    # exposures
    B = S[S.id.isin(basket)].copy()
    B["weight"] = B.id.map(w)
    ex = {}
    for col in ("sector", "peer_group", "rep_ccy", "price_ccy", "region"):
        ex[col] = B.groupby(col)["weight"].sum().sort_values(ascending=False)
    gq = pd.DataFrame({i: geo(i) for i in basket}).T
    gnum = gq[["na", "eu", "uk", "other", "china", "em"]].apply(pd.to_numeric, errors="coerce")
    ws_ = pd.Series(w)
    geo_w = pd.Series({c: (gnum[c] * ws_).sum() / ws_[gnum[c].notna()].sum() if gnum[c].notna().any() else np.nan for c in gnum.columns})
    geo_w["coverage"] = ", ".join(f"{c}:{int(gnum[c].notna().sum())}/{len(gnum)}" for c in gnum.columns)
    ai = B.set_index("id")[["q_I1", "q_I2", "q_I3", "q_I4"]]
    st, st_w = stress(S, basket, w)
    # correlations: basket names vs each other and vs disclosed existing holdings (monthly GBP TR, 5y)
    mr = monthly_returns(basket, u)
    corr = mr.corr()
    bsk = mr[basket].mean(axis=1)
    rel = {k: bsk.corr(mr[k]) for k in mr.columns if k.startswith("EXISTING:")}
    travel = mr[[c for c in mr.columns if c in ("EXISTING:ACCOR", "EXISTING:TUI", "EXISTING:JET2")]].mean(axis=1)
    rel["EXISTING:TRAVEL_EW"] = bsk.corr(travel)
    out = {"basket": basket, "shortlist": short, "mechanical_proposal": prop, "weights": w,
           "exposures": {k: v.round(4).to_dict() for k, v in ex.items()}, "geo_weighted_pct": {k: (round(v, 1) if isinstance(v, float) else v) for k, v in geo_w.items()},
           "stress_weighted": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in st_w.items()}, "basket_corr_with_existing": {k: round(v, 3) for k, v in rel.items()},
           "avg_pairwise_corr_basket": float(corr.loc[basket, basket].where(~np.eye(len(basket), dtype=bool)).stack().mean()) if len(basket) > 1 else np.nan,
           "basket_vol_5y_gbp": float(bsk.std() * np.sqrt(12)), "travel_vol_5y_gbp": float(travel.std() * np.sqrt(12))}
    (PROC / "portfolio_summary.json").write_text(json.dumps(out, indent=1, default=str))
    st.to_csv(PROC / "stress_tests.csv", index=False)
    corr.to_csv(PROC / "correlations.csv")
    gq.to_csv(PROC / "basket_geography.csv")
    ai.to_csv(PROC / "basket_ai.csv")
    return out


if __name__ == "__main__":
    o = main()
    print(json.dumps({k: o[k] for k in ("mechanical_proposal", "shortlist", "basket_corr_with_existing", "avg_pairwise_corr_basket", "basket_vol_5y_gbp", "travel_vol_5y_gbp", "stress_weighted")}, indent=1, default=str))
