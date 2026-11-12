"""Fundamentals, FCF standardisation, lease-consistent valuation, historical point-in-time multiples.

Inputs : data/processed/yahoo_fund.parquet (reporting-currency statements, ~4y annual + TTM + latest quarter BS)
         data/processed/pitchbook_ttm.parquet (USD m quarterly TTM history; EV and net debt at period end)
         data/processed/prices.parquet, research/qual/<ID>.json (lease payments if disclosed)
Outputs: data/processed/snapshot.csv           one row per company at the valuation date
         data/processed/annual_history.csv     FY history (reporting currency, millions)
         data/processed/pb_history_local.csv   PitchBook TTM history converted to reporting currency
         data/processed/pit_multiples.csv      quarterly point-in-time EV/EBITDA (provider basis)
All monetary outputs in millions of reporting currency unless the column name says otherwise.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from common import PROC, QUAL, VALUATION_DATE, universe
from fx import cross, rate_on, avg_rate
from returns import tr_index, load_prices

LEASE_INTEREST_PROXY = 0.04
TAX_NOTIONAL = 0.25
M = 1e6


def _q(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def qual(cid):
    return _q(QUAL / f"{cid}.json") or {}


class YF:
    def __init__(self):
        self.df = pd.read_parquet(PROC / "yahoo_fund.parquet")

    def series(self, cid, item, freq="annual"):
        x = self.df[(self.df.id == cid) & (self.df.item == item) & (self.df.freq == freq)]
        return x.sort_values("period_end").set_index("period_end")[["value", "currency"]]

    def latest(self, cid, item, freqs=("trailing", "quarterly", "annual")):
        for f in freqs:
            s = self.series(cid, item, f)
            s = s[s.index <= VALUATION_DATE]
            if len(s):
                return float(s["value"].iloc[-1]), s.index[-1], f, s["currency"].iloc[-1]
        return np.nan, pd.NaT, None, None

    def rep_ccy(self, cid):
        s = self.series(cid, "TotalRevenue", "annual")
        return s["currency"].iloc[-1] if len(s) else None


def lease_from_qual(q, rep_ccy):
    """Latest disclosed lease principal + interest paid (millions) if supplied by sector agent."""
    le = (q or {}).get("lease") or {}
    def last(key):
        v = [x for x in (le.get(key) or []) if isinstance(x, dict) and isinstance(x.get("value"), (int, float))]
        return (float(v[-1]["value"]), v[-1].get("fy")) if v else (np.nan, None)
    p, fy = last("lease_principal_paid")
    i, _ = last("lease_interest_paid")
    for z in ("p", "i"):
        pass
    if pd.notna(p) and p > 1e5:  # supplied in units rather than millions
        p = p / M
    if pd.notna(i) and i > 1e5:
        i = i / M
    return p, i, fy


def snapshot(yf: YF, u: pd.DataFrame, prices, pbl=None) -> pd.DataFrame:
    p, d = prices
    pbl_latest = {}
    if pbl is not None:
        for cid, g in pbl.groupby("id"):
            g = g.dropna(subset=["ebitda"]).sort_values("period_end")
            if len(g):
                pbl_latest[cid] = g.iloc[-1].to_dict()
    sop = PROC.parent.parent / "config" / "share_overrides.csv"
    share_ov = {}
    if sop.exists():
        so = pd.read_csv(sop)
        share_ov = {x.id: x.to_dict() for _, x in so.dropna(subset=["economic_shares_m"]).iterrows()}
    cfp = PROC.parent.parent / "research" / "ifrs_cashflow_classification.csv"
    cfclass = {}
    if cfp.exists():
        try:
            cfd = pd.read_csv(cfp)
            for c in ("lease_principal_paid", "lease_interest_paid", "interest_paid", "interest_received"):
                cfd[c] = pd.to_numeric(cfd[c], errors="coerce")
            cfclass = {r_.id: r_.to_dict() for _, r_ in cfd.drop_duplicates("id", keep="last").iterrows()}
        except Exception as e:
            print("WARN cannot read IFRS classification table", e)
    rows = []
    for _, r in u.iterrows():
        rec = {"id": r.id, "name": r["name"], "sector": r.sector, "subsector": r.subsector, "peer_group": r.peer_group,
               "depth": r.depth, "gaap": r.gaap, "region": r.region}
        rep = yf.rep_ccy(r.id)
        t = tr_index(r.yahoo, p, d)
        if rep is None or t.empty or t.index[-1] < VALUATION_DATE - pd.Timedelta(days=20):
            rec["status_note"] = "no current price or statements"; rows.append(rec); continue
        pccy = t["price_ccy"].iloc[-1]
        px = float(t["px_local"].asof(VALUATION_DATE))
        fx = rate_on(pccy, rep, VALUATION_DATE)
        rec.update({"rep_ccy": rep, "price_ccy": pccy, "price": px, "fx_price_to_rep": fx, "price_date": t.index[-1].date()})
        sh, sh_date, sh_f, _ = yf.latest(r.id, "OrdinarySharesNumber", ("quarterly", "annual"))
        if r.id in share_ov:  # economic share count override (Up-C units / multiple classes), see config/share_overrides.csv
            sh, sh_date = share_ov[r.id]["economic_shares_m"] * M, share_ov[r.id]["as_of"]
            rec["shares_source"] = "override: " + str(share_ov[r.id].get("notes", ""))[:120]
        else:
            rec["shares_source"] = f"Yahoo OrdinarySharesNumber ({sh_f})"
        rec.update({"shares_m": sh / M, "shares_date": sh_date, "mcap": px * fx * sh / M})
        g = lambda item, fr=("trailing", "annual"): yf.latest(r.id, item, fr)
        for item, key in [("TotalRevenue", "revenue"), ("EBITDA", "ebitda"), ("NormalizedEBITDA", "ebitda_norm"),
                          ("EBIT", "ebit"), ("NetIncomeCommonStockholders", "net_income"), ("NormalizedIncome", "net_income_norm"),
                          ("OperatingCashFlow", "ocf"), ("CapitalExpenditure", "capex"), ("StockBasedCompensation", "sbc"),
                          ("PurchaseOfBusiness", "acquisitions"), ("CashDividendsPaid", "dividends_paid"),
                          ("RepurchaseOfCapitalStock", "buybacks"), ("DepreciationAndAmortization", "da"),
                          ("InterestExpense", "interest_expense"), ("ChangeInWorkingCapital", "wc_change"),
                          ("DilutedAverageShares", "diluted_shares"), ("TotalUnusualItems", "unusual_items"),
                          ("GrossProfit", "gross_profit")]:
            v, dt_, f, c = g(item)
            rec[key] = v / M if key != "diluted_shares" else v / M
            if key == "revenue":
                rec["ltm_end"], rec["ltm_basis"] = dt_, f
        for item, key in [("TotalDebt", "total_debt"), ("CapitalLeaseObligations", "lease_liab"),
                          ("CurrentCapitalLeaseObligation", "lease_liab_current"),
                          ("CashCashEquivalentsAndShortTermInvestments", "cash_sti"), ("MinorityInterest", "minorities"),
                          ("LongTermEquityInvestment", "lt_investments"), ("StockholdersEquity", "equity"),
                          ("GoodwillAndOtherIntangibleAssets", "goodwill_intang"), ("TotalAssets", "total_assets"),
                          ("InvestedCapital", "invested_capital")]:
            v, dt_, f, c = yf.latest(r.id, item, ("quarterly", "annual"))
            rec[key] = v / M
            if key == "total_debt":
                rec["bs_date"] = dt_
        # --- provider reconciliation rules (logged in rec["recon_notes"])
        notes = []
        da = rec["da"] if pd.notna(rec["da"]) else yf.latest(r.id, "DepreciationAndAmortization", ("annual",))[0] / M
        if pd.notna(rec["ebitda"]) and pd.notna(rec["ebit"]) and abs(rec["ebitda"] - rec["ebit"]) < 0.01 * abs(rec["ebit"]) \
                and pd.notna(da) and da > 0.02 * rec["revenue"]:
            rec["ebitda"] = rec["ebit"] + da
            notes.append("Yahoo TTM EBITDA equalled EBIT; rebuilt as EBIT + D&A")
        if pd.isna(rec["ebitda"]) and pd.notna(rec["ebit"]) and pd.notna(da):
            rec["ebitda"] = rec["ebit"] + da
            notes.append("EBITDA missing; built as EBIT + D&A")
        pbk = pbl_latest.get(r.id)
        if pbk is not None and pd.notna(pbk.get("ebitda")):
            rec["pb_ebitda_ttm"], rec["pb_period"] = pbk["ebitda"], pbk["period_end"]
            if pd.isna(rec["ebitda"]):
                rec["ebitda"] = pbk["ebitda"]; notes.append("EBITDA from PitchBook TTM (Yahoo missing)")
            dev = rec["ebitda"] / pbk["ebitda"] - 1 if pbk["ebitda"] else np.nan
            rec["ebitda_vs_pitchbook"] = dev
            if pd.notna(dev) and abs(dev) > 0.15:
                notes.append(f"EBITDA differs from PitchBook by {dev:+.0%} (period {pbk['period_end'].date()})")
        unus = rec["unusual_items"] if pd.notna(rec["unusual_items"]) else 0.0
        rec["ebitda_adj"] = rec["ebitda"] - unus  # add back charges Yahoo classifies as unusual
        if pd.isna(rec["capex"]) and pd.notna(pd.to_numeric(cfclass.get(r.id, {}).get("capex"), errors="coerce")):
            rec["capex"] = -abs(float(cfclass[r.id]["capex"])); notes.append("capex from latest annual report (IFRS table), Yahoo missing")
        if pd.isna(rec["capex"]):
            fcf_y = yf.latest(r.id, "FreeCashFlow")[0] / M
            if pd.notna(fcf_y) and pd.notna(rec["ocf"]) and abs(fcf_y - rec["ocf"]) > 0.005 * abs(rec["ocf"]):
                rec["capex"] = fcf_y - rec["ocf"]; notes.append("capex derived as Yahoo FCF - OCF")
            else:
                notes.append("capex unavailable - FCF not computed")
        lease_l = rec["lease_liab"] if pd.notna(rec["lease_liab"]) else 0.0
        if lease_l > rec["total_debt"] * 0.95 and lease_l > 0:
            rec["total_debt"] = rec["total_debt"] + lease_l
            notes.append("Yahoo TotalDebt excluded leases; leases added")
        # --- lease treatment
        lease = 0.0 if pd.isna(rec["lease_liab"]) else rec["lease_liab"]
        rec["debt_ex_lease"] = rec["total_debt"] - lease
        rec["net_debt_pre_lease"] = rec["debt_ex_lease"] - rec["cash_sti"]
        rec["net_debt_incl_lease"] = rec["total_debt"] - rec["cash_sti"]
        mino = abs(rec["minorities"]) if pd.notna(rec["minorities"]) else 0.0
        if r.id in share_ov and "Up-C" in str(share_ov[r.id].get("notes", "")):
            mino = 0.0  # NCI = LLC units already in economic share count; avoid double count
        inv = rec["lt_investments"] if pd.notna(rec["lt_investments"]) else 0.0
        rec["ev_post_lease"] = rec["mcap"] + rec["net_debt_pre_lease"] + mino - inv
        rec["ev_provider_basis"] = rec["mcap"] + rec["net_debt_incl_lease"] + mino - inv
        q = qual(r.id)
        lp, li, lfy = lease_from_qual(q, rep)
        cf = cfclass.get(r.id, {})
        if r.gaap == "IFRS" and pd.notna(cf.get("lease_principal_paid")):
            lp = abs(float(cf["lease_principal_paid"])); lfy = str(cf.get("fy_end"))
            li = abs(float(cf["lease_interest_paid"])) if pd.notna(cf.get("lease_interest_paid")) else np.nan
        if r.gaap == "IFRS":
            cur = rec["lease_liab_current"] if pd.notna(rec["lease_liab_current"]) else np.nan
            proxy_p = cur if pd.notna(cur) else (lease / 4.0 if lease else 0.0)  # ~4y average remaining term
            proxy_i = lease * LEASE_INTEREST_PROXY
            use_disc = pd.notna(lp) and proxy_p > 0 and 0.33 < lp / proxy_p < 3.0
            rec["lease_principal"] = lp if use_disc else proxy_p
            rec["lease_interest"] = li if (use_disc and pd.notna(li)) else proxy_i
            rec["lease_source"] = f"disclosed FY{lfy} (sector agent)" if use_disc else "ESTIMATE: current lease liability + 4% x lease liability"
        else:
            rec["lease_principal"], rec["lease_interest"] = 0.0, 0.0
            rec["lease_source"] = "US GAAP: operating-lease cost already within EBITDA/OCF; finance-lease principal not deducted (immaterial assumption)"
        rec["ebitdaal"] = rec["ebitda"] - rec["lease_principal"] - rec["lease_interest"]
        rec["ebitdaal_adj"] = rec["ebitda_adj"] - rec["lease_principal"] - rec["lease_interest"]
        rec["ebit_post_lease"] = rec["ebit"] - rec["lease_interest"]
        # --- standardised FCF (acquisitions excluded; SBC not added back)
        capex = -abs(rec["capex"]) if pd.notna(rec["capex"]) else np.nan
        rec["fcf_std"] = rec["ocf"] + capex - rec["lease_principal"]
        # IFRS: if interest paid is classified outside operating activities, deduct it (latest FY amount)
        sec_ = str(cf.get("interest_paid_section", "")).lower()
        if r.gaap == "IFRS" and sec_.startswith("financ") and pd.notna(cf.get("interest_paid")):
            rec["fcf_std"] -= abs(float(cf["interest_paid"]))
            rec["interest_adj"] = abs(float(cf["interest_paid"]))
            notes.append(f"interest paid ({abs(float(cf['interest_paid'])):.0f}) classified in financing; deducted")
            if pd.notna(cf.get("interest_received")) and str(cf.get("interest_received_section", "")).lower().startswith(("financ", "invest")):
                rec["fcf_std"] += abs(float(cf["interest_received"]))
        rec["recon_notes"] = "; ".join(notes)
        rec["fcf_std_less_sbc"] = rec["fcf_std"] - (rec["sbc"] if pd.notna(rec["sbc"]) else 0.0)
        rec["capex_pct_rev"] = -capex / rec["revenue"] if rec["revenue"] else np.nan
        rec["ebitda_margin"] = rec["ebitda"] / rec["revenue"]
        rec["ebitdaal_margin"] = rec["ebitdaal"] / rec["revenue"]
        rec["ebit_margin"] = rec["ebit"] / rec["revenue"]
        rec["fcf_conv_ni"] = rec["fcf_std"] / rec["net_income"] if rec["net_income"] and rec["net_income"] > 0 else np.nan
        rec["fcf_conv_ebitdaal"] = rec["fcf_std"] / rec["ebitdaal"] if rec["ebitdaal"] and rec["ebitdaal"] > 0 else np.nan
        # --- valuation
        pos = lambda x: x if (pd.notna(x) and x > 0) else np.nan
        rec["ev_ebitdaal"] = rec["ev_post_lease"] / pos(rec["ebitdaal"])
        rec["ev_ebitda_provider"] = rec["ev_provider_basis"] / pos(rec["ebitda"])
        rec["ev_ebitdaal_adj"] = rec["ev_post_lease"] / pos(rec["ebitdaal_adj"])
        rec["ev_ebit"] = rec["ev_post_lease"] / pos(rec["ebit_post_lease"])
        rec["pe"] = rec["mcap"] / pos(rec["net_income"])
        rec["pe_norm"] = rec["mcap"] / pos(rec["net_income_norm"])
        rec["status_note"] = "delisted/acquired" if t.index[-1] < VALUATION_DATE - pd.Timedelta(days=5) else ""
        rec["fcf_yield"] = rec["fcf_std"] / rec["mcap"]
        rec["fcf_yield_less_sbc"] = rec["fcf_std_less_sbc"] / rec["mcap"]
        rec["ev_sales"] = rec["ev_post_lease"] / rec["revenue"]
        # --- leverage / coverage
        rec["nd_pre_lease_to_ebitdaal"] = rec["net_debt_pre_lease"] / pos(rec["ebitdaal"])
        rec["nd_incl_lease_to_ebitda"] = rec["net_debt_incl_lease"] / pos(rec["ebitda"])
        rec["gross_debt_to_ebitda"] = rec["total_debt"] / pos(rec["ebitda"])
        rec["interest_cover"] = rec["ebit"] / pos(abs(rec["interest_expense"])) if pd.notna(rec["interest_expense"]) else np.nan
        rec["sbc_pct_rev"] = rec["sbc"] / rec["revenue"] if pd.notna(rec["sbc"]) else np.nan
        rows.append(rec)
    return pd.DataFrame(rows)


def annual_history(yf: YF, u) -> pd.DataFrame:
    items = {"TotalRevenue": "revenue", "EBITDA": "ebitda", "EBIT": "ebit", "NetIncomeCommonStockholders": "net_income",
             "NormalizedIncome": "net_income_norm", "OperatingCashFlow": "ocf", "CapitalExpenditure": "capex",
             "StockBasedCompensation": "sbc", "PurchaseOfBusiness": "acquisitions", "CashDividendsPaid": "dividends_paid",
             "RepurchaseOfCapitalStock": "buybacks", "DilutedAverageShares": "diluted_shares",
             "OrdinarySharesNumber": "shares_out", "ChangeInWorkingCapital": "wc_change", "TotalDebt": "total_debt",
             "CapitalLeaseObligations": "lease_liab", "CurrentCapitalLeaseObligation": "lease_liab_current",
             "CashCashEquivalentsAndShortTermInvestments": "cash_sti", "StockholdersEquity": "equity",
             "InterestExpense": "interest_expense", "DepreciationAndAmortization": "da", "TotalUnusualItems": "unusual_items",
             "GoodwillAndOtherIntangibleAssets": "goodwill_intang"}
    df = yf.df[(yf.df.freq == "annual") & (yf.df.item.isin(items))].copy()
    df["item"] = df["item"].map(items)
    h = df.pivot_table(index=["id", "period_end"], columns="item", values="value", aggfunc="last") / M
    h = h.reset_index()
    gaap = u.set_index("id")["gaap"]
    h["gaap"] = h["id"].map(gaap)
    lease = h["lease_liab"].fillna(0)
    cur = h["lease_liab_current"]
    is_ifrs = h["gaap"] == "IFRS"
    h["lease_principal_est"] = np.where(is_ifrs, cur.fillna(lease / 4.0), 0.0)
    h["fcf_std"] = h["ocf"] - h["capex"].abs() - h["lease_principal_est"]
    h["fcf_ps"] = h["fcf_std"] / h["diluted_shares"]
    h["eps"] = h["net_income"] / h["diluted_shares"]
    h["ebitda_ps"] = h["ebitda"] / h["diluted_shares"]
    h["ebitdaal"] = h["ebitda"] - np.where(is_ifrs, h["lease_principal_est"] + lease * LEASE_INTEREST_PROXY, 0.0)
    h["fcf_to_ni"] = h["fcf_std"] / h["net_income"]
    h["fcf_to_ebitdaal"] = h["fcf_std"] / h["ebitdaal"]
    h["ebitda_margin"] = h["ebitda"] / h["revenue"]
    h["wc_pct_ocf"] = h["wc_change"] / h["ocf"]
    h["acq_pct_ocf"] = h["acquisitions"].abs() / h["ocf"]
    h["nd_incl_lease"] = h["total_debt"] - h["cash_sti"]
    cap = h["equity"] + h["nd_incl_lease"]
    h["roic"] = h["ebit"] * (1 - TAX_NOTIONAL) / cap.groupby(h["id"]).transform(lambda s: (s + s.shift(1)) / 2)
    h["roic_ex_goodwill"] = h["ebit"] * (1 - TAX_NOTIONAL) / (cap - h["goodwill_intang"].fillna(0))
    return h.sort_values(["id", "period_end"])


def pb_local(u, yf: YF) -> pd.DataFrame:
    """PitchBook USD TTM history converted to reporting currency: flows at trailing-12m average FX, stocks at spot."""
    pb = pd.read_parquet(PROC / "pitchbook_ttm.parquet")
    flows = {"revenue", "gross_profit", "net_income", "ebitda", "ebit"}
    out = []
    for cid, g in pb.groupby("id"):
        rep = yf.rep_ccy(cid)
        if rep is None:
            continue
        piv = g.pivot_table(index="period_end", columns="metric", values="value_usd_m", aggfunc="last").sort_index()
        piv = piv[piv.index >= "2007-01-01"]
        if rep != "USD":
            c = cross("USD", rep)
            for col in piv.columns:
                if col in flows:
                    piv[col] = [v * float(c[(c.index > pe - pd.DateOffset(years=1)) & (c.index <= pe)].mean()) for pe, v in piv[col].items()]
                else:
                    piv[col] = [v * float(c.asof(pe)) for pe, v in piv[col].items()]
        piv["id"], piv["rep_ccy"] = cid, rep
        out.append(piv.reset_index())
    return pd.concat(out)


def reporting_lag_days(period_end: pd.Timestamp, fye_month: int, region: str) -> int:
    fy_end = period_end.month == fye_month
    if region in ("US", "CA"):
        return 75 if fy_end else 50
    return 80 if fy_end else 65  # European interim/annual typical publication lags


def pit_multiples(u, prices, pbl: pd.DataFrame) -> pd.DataFrame:
    """Quarterly observations: EV_t = implied shares_k x P_t + net debt_k ; multiple = EV_t / EBITDA_k (TTM),
    where k is the latest period published by t (period_end + lag <= t). Provider basis (leases in EV and EBITDA
    after IFRS16/ASC842 adoption in 2019). Implied shares_k = (EV_k - ND_k) / P_k (absorbs minorities/other claims)."""
    p, d = prices
    val = pd.read_csv(PROC / "pitchbook_mapping_validation.csv").set_index("id")
    rows = []
    for _, r in u.iterrows():
        g = pbl[pbl.id == r.id].set_index("period_end").sort_index()
        if g.empty or "ev" not in g or "ebitda" not in g:
            continue
        t = tr_index(r.yahoo, p, d)
        if t.empty:
            continue
        rep = g["rep_ccy"].iloc[0]
        pccy = t["price_ccy"].iloc[-1]
        px_rep = t["px_local"] * cross(pccy, rep).reindex(t.index).ffill()
        g = g.dropna(subset=["ev", "net_debt"])
        g["px_k"] = [px_rep.asof(pe) for pe in g.index]
        g["implied_shares"] = (g["ev"] - g["net_debt"]) / g["px_k"]
        fye = int(val.loc[r.id, "fye_month"]) if r.id in val.index else 12
        g["pub_date"] = [pe + pd.Timedelta(days=reporting_lag_days(pe, fye, r.region)) for pe in g.index]
        obs = pd.date_range("2014-03-31", VALUATION_DATE, freq="QE").append(pd.DatetimeIndex([VALUATION_DATE]))
        for od in obs:
            avail = g[g.pub_date <= od]
            if avail.empty or od < t.index[0]:
                continue
            k = avail.iloc[-1]
            pt = px_rep.asof(od)
            ev_t = k.implied_shares * pt + k.net_debt
            rows.append({"id": r.id, "obs_date": od, "period_k": avail.index[-1], "price_rep": pt,
                         "implied_shares": k.implied_shares, "net_debt": k.net_debt, "ebitda_ttm": k.ebitda,
                         "ebit_ttm": k.get("ebit", np.nan), "revenue_ttm": k.get("revenue", np.nan),
                         "net_income_ttm": k.get("net_income", np.nan), "ev": ev_t,
                         "ev_ebitda_pit": ev_t / k.ebitda if k.ebitda > 0 else np.nan,
                         "ev_ebitda_period_end": k.ev / k.ebitda if k.ebitda > 0 else np.nan,
                         "pe_pit": (k.implied_shares * pt) / k.net_income if k.get("net_income", 0) > 0 else np.nan})
    return pd.DataFrame(rows)


def history_stats(pit: pd.DataFrame, snap: pd.DataFrame) -> pd.DataFrame:
    out = []
    for cid, g in pit.groupby("id"):
        g = g.set_index("obs_date").sort_index()
        cur = g["ev_ebitda_pit"].iloc[-1]
        rec = {"id": cid, "ev_ebitda_pit_now": cur}
        for lab, start in (("10y", VALUATION_DATE - pd.DateOffset(years=10)), ("post2019", pd.Timestamp("2019-12-31")),
                           ("5y", VALUATION_DATE - pd.DateOffset(years=5))):
            s = g.loc[g.index >= start, "ev_ebitda_pit"].dropna()
            if len(s) >= 8:
                rec[f"ev_ebitda_median_{lab}"] = s.median()
                rec[f"ev_ebitda_p25_{lab}"] = s.quantile(0.25)
                rec[f"ev_ebitda_p75_{lab}"] = s.quantile(0.75)
                rec[f"ev_ebitda_pctile_now_{lab}"] = (s < cur).mean()
                rec[f"n_obs_{lab}"] = len(s)
        pe = g.loc[g.index >= VALUATION_DATE - pd.DateOffset(years=10), "pe_pit"].dropna()
        if len(pe) >= 8:
            rec["pe_median_10y"] = pe.median()
        out.append(rec)
    return pd.DataFrame(out)


def growth_metrics(pbl: pd.DataFrame, h: pd.DataFrame) -> pd.DataFrame:
    out = []
    for cid, g in pbl.groupby("id"):
        g = g.set_index("period_end").sort_index()
        rec = {"id": cid}
        last = g.index[-1]
        for yrs in (3, 5, 10):
            base = g[g.index <= last - pd.DateOffset(years=yrs) + pd.Timedelta(days=20)]
            if len(base):
                b = base.iloc[-1]
                for m in ("revenue", "ebitda", "net_income"):
                    if m in g and pd.notna(b.get(m)) and b[m] > 0 and g[m].iloc[-1] > 0:
                        rec[f"{m}_cagr_{yrs}y_rep"] = (g[m].iloc[-1] / b[m]) ** (1 / yrs) - 1
        # FY-end annual series (TTM at fiscal year-end) for consistency metrics
        fy = g[g.index.month == g.index[-1].month] if len(g) else g
        fy = fy[fy.index >= last - pd.DateOffset(years=10, days=20)]
        if "revenue" in fy and len(fy) > 3:
            gr = fy["revenue"].pct_change().dropna()
            rec["rev_growth_neg_years_10y"] = int((gr < 0).sum())
            rec["rev_growth_std_10y"] = float(gr.std())
            mg = (fy["ebitda"] / fy["revenue"]).dropna() if "ebitda" in fy else pd.Series(dtype=float)
            rec["ebitda_margin_std_10y_pp"] = float(mg.std() * 100) if len(mg) > 3 else np.nan
            rec["ebitda_margin_change_5y_pp"] = float((mg.iloc[-1] - mg[mg.index <= last - pd.DateOffset(years=5) + pd.Timedelta(days=20)].iloc[-1]) * 100) if len(mg[mg.index <= last - pd.DateOffset(years=5) + pd.Timedelta(days=20)]) else np.nan
            # incremental EBITDA margin over 5 years
            b5 = fy[fy.index <= last - pd.DateOffset(years=5) + pd.Timedelta(days=20)]
            if len(b5) and "ebitda" in fy:
                dr = fy["revenue"].iloc[-1] - b5["revenue"].iloc[-1]
                rec["incremental_ebitda_margin_5y"] = (fy["ebitda"].iloc[-1] - b5["ebitda"].iloc[-1]) / dr if dr > 0 else np.nan
        hh = h[h.id == cid].sort_values("period_end")
        if len(hh) >= 3:
            last3 = hh.tail(3)
            fsum = last3["fcf_std"].sum(min_count=3)  # NaN unless all three years present (never treat missing as zero)
            rec["fcf_to_ni_3y_cum"] = fsum / last3["net_income"].sum() if last3["net_income"].sum() > 0 else np.nan
            rec["fcf_to_ebitdaal_3y_cum"] = fsum / last3["ebitdaal"].sum(min_count=3) if last3["ebitdaal"].sum() > 0 else np.nan
            rec["acq_spend_3y_pct_ocf"] = last3["acquisitions"].abs().sum(min_count=1) / last3["ocf"].sum() if last3["ocf"].sum() > 0 else np.nan
            rec["wc_contrib_3y_pct_ocf"] = last3["wc_change"].sum(min_count=3) / last3["ocf"].sum() if last3["ocf"].sum() > 0 else np.nan
            f0, f1 = hh["fcf_ps"].iloc[0], hh["fcf_ps"].iloc[-1]
            n = (hh["period_end"].iloc[-1] - hh["period_end"].iloc[0]).days / 365.25
            rec["fcf_ps_cagr_hist"] = (f1 / f0) ** (1 / n) - 1 if f0 > 0 and f1 > 0 and n > 1 else np.nan
            e0, e1 = hh["eps"].iloc[0], hh["eps"].iloc[-1]
            rec["eps_cagr_hist"] = (e1 / e0) ** (1 / n) - 1 if e0 > 0 and e1 > 0 and n > 1 else np.nan
            s0, s1 = hh["diluted_shares"].iloc[0], hh["diluted_shares"].iloc[-1]
            rec["share_count_cagr_hist"] = (s1 / s0) ** (1 / n) - 1 if s0 > 0 and n > 1 else np.nan
            rec["hist_years_span"] = n
            rec["roic_latest"] = hh["roic"].iloc[-1]
            rec["roic_avg"] = hh["roic"].dropna().mean()
            rec["roic_ex_goodwill_latest"] = hh["roic_ex_goodwill"].iloc[-1]
        out.append(rec)
    return pd.DataFrame(out)


def main():
    u = universe()
    yf = YF()
    prices = load_prices()
    pbl = pb_local(u, yf)
    snap = snapshot(yf, u, prices, pbl)
    h = annual_history(yf, u)
    pit = pit_multiples(u, prices, pbl)
    hs = history_stats(pit, snap)
    gm = growth_metrics(pbl, h)
    # implied-share validation vs reported shares (scaled by any later split factors via price adjustment)
    latest_k = pit.sort_values("obs_date").groupby("id").tail(1)[["id", "implied_shares"]]
    snap = snap.merge(latest_k, on="id", how="left").merge(hs, on="id", how="left").merge(gm, on="id", how="left")
    snap["implied_vs_reported_shares"] = snap["implied_shares"] / snap["shares_m"]
    snap.to_csv(PROC / "snapshot.csv", index=False)
    h.to_csv(PROC / "annual_history.csv", index=False)
    pbl.to_csv(PROC / "pb_history_local.csv", index=False)
    pit.to_csv(PROC / "pit_multiples.csv", index=False)
    return snap


if __name__ == "__main__":
    s = main()
    cols = ["id", "rep_ccy", "mcap", "ev_ebitdaal", "ev_ebitda_provider", "pe", "fcf_yield", "nd_pre_lease_to_ebitdaal",
            "ev_ebitda_pit_now", "ev_ebitda_median_10y", "fcf_to_ni_3y_cum", "revenue_cagr_5y_rep", "implied_vs_reported_shares"]
    with pd.option_context("display.width", 250, "display.max_rows", 200):
        print(s[cols].round(2).to_string())
