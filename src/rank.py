"""Risk gates, prospective-return scenarios, pillar scores, rankings and weight sensitivity.

Outputs: data/processed/scores.csv, scenarios.csv, gates.csv (exclusion log), sensitivity.csv
Methodology: docs/methodology.md §6, §8, §9. Weights are fixed ex ante and never optimised on returns.
"""
from __future__ import annotations
import json, re
import numpy as np
import pandas as pd
from common import PROC, QUAL, universe

WEIGHTS = {"base": {"quality": .25, "growth": .20, "cash": .20, "valuation": .25, "governance": .10},
           "equal": {"quality": .2, "growth": .2, "cash": .2, "valuation": .2, "governance": .2},
           "quality_heavy": {"quality": .35, "growth": .20, "cash": .20, "valuation": .15, "governance": .10},
           "value_heavy": {"quality": .20, "growth": .15, "cash": .20, "valuation": .35, "governance": .10}}
CONF = {"H": 1.0, "M": 0.6, "L": 0.3}
G1_LIMIT = {"S5:Solid waste": 4.0, "S5:Environmental services": 4.0, "S6": 4.0}
ORDER = {"C": 0, "B": 1, "A": 2}


def load_qual():
    out = {}
    for f in QUAL.glob("*.json"):
        try:
            d = json.loads(f.read_text())
            out[d.get("id", f.stem)] = d
        except Exception as e:
            print("WARN bad json", f, e)
    return out


def sc(q, k):
    v = ((q.get("scores") or {}).get(k) or {})
    s = v.get("score") if isinstance(v, dict) else None
    return float(s) if isinstance(s, (int, float)) else np.nan


def conf(q, k):
    v = ((q.get("scores") or {}).get(k) or {})
    return CONF.get(str(v.get("confidence", "")).strip()[:1].upper(), np.nan) if isinstance(v, dict) else np.nan


VER = QUAL.parent / "verification"


def verified(cid):
    f = VER / f"{cid}.json"
    try:
        return json.loads(f.read_text()) if f.exists() else None
    except Exception:
        return None


def organic(q):
    full, interim = [], []
    v = verified(q.get("id", ""))
    src_list = q.get("organic_growth", []) or []
    if v and any(isinstance(x, dict) and isinstance(x.get("organic_pct"), (int, float)) for x in v.get("organic_growth") or []):
        src_list = list(v["organic_growth"])
        li = v.get("latest_interim") or {}
        if isinstance(li.get("organic_pct"), (int, float)):
            src_list.append({"fy": f"{li.get('period', '')} interim", "organic_pct": li["organic_pct"]})
    for x in src_list:
        if not isinstance(x, dict) or not isinstance(x.get("organic_pct"), (int, float)):
            continue
        lab = str(x.get("fy", ""))
        m = re.search(r"(20\d\d)", lab)
        yr = int(m.group(1)) if m else None
        is_interim = bool(re.search(r"Q\d|H1|H2|9M|guid|YTD|6M", lab, re.I))
        (interim if is_interim else full).append((yr, x["organic_pct"] / 100.0))
    full = sorted([f for f in full if f[0]], key=lambda z: z[0])
    recent = [v for y, v in full if y and y >= 2022]
    return {"org_full_years": len(full), "org_median_2022on": float(np.median(recent)) if len(recent) >= 2 else np.nan,
            "org_latest_full": full[-1][1] if full else np.nan, "org_latest_interim": interim[-1][1] if interim else np.nan,
            "org_series": "; ".join(f"{y}:{v*100:.1f}%" for y, v in full),
            "org_verified": bool(v and v.get("organic_growth"))}


def quant_gates(r, q):
    """Return dict gate -> (status, reason) from quantitative tests; combined with agent gates (worst wins)."""
    g = {}
    lev = r["net_debt_pre_lease"] / r["ebitdaal_adj"] if pd.notna(r.get("ebitdaal_adj")) and r["ebitdaal_adj"] > 0 else r.get("nd_pre_lease_to_ebitdaal")
    key = f"{r.sector}:{r.peer_group}"
    if r.peer_group == "Adjacent: regulated water":
        g["G1"] = ("B", "regulated utility: assess gearing vs RCV, EBITDA leverage informational")
    elif r.id == "MLP":
        g["G1"] = ("B", "bank deposits in debt; leverage not comparable")
    elif pd.notna(lev):
        lim = G1_LIMIT.get(key, G1_LIMIT.get(r.sector, 3.5))
        if lev > 5.0:
            g["G1"] = ("A", f"net debt/EBITDAaL {lev:.1f}x > 5.0x")
        elif lev > lim:
            g["G1"] = ("B", f"net debt/EBITDAaL {lev:.1f}x > {lim}x subsector limit")
        ic = r.get("interest_cover")
        if pd.notna(ic) and ic < 4 and g.get("G1", ("C",))[0] == "C":
            g["G1"] = ("B", f"interest cover {ic:.1f}x < 4x")
    f = r.get("fcf_to_ni_3y_cum")
    if r.peer_group != "Adjacent: regulated water" and pd.notna(f):
        if f < 0.4:
            g["G4"] = ("A" if f < 0.2 else "B", f"3y FCF/NI {f:.0%} < 40% (A if <20%; review for temporary cause)")
        elif f < 0.6:
            g["G4"] = ("B", f"3y FCF/NI {f:.0%} < 60%")
    if r.get("status_note") == "delisted/acquired":
        g["G6"] = ("A", "delisted / acquired")
    ai = (q.get("ai") or {}).get("ai_dc_capex_revenue_pct")
    if isinstance(ai, (int, float)):
        if ai > 30: g["G5"] = ("A", f"AI/DC revenue {ai}% > 30%")
        elif ai > 15: g["G5"] = ("B", f"AI/DC revenue {ai}% > 15%")
    return g


def combine_gates(r, q):
    agent = q.get("gates") or {}
    qg = quant_gates(r, q)
    out, reasons = {}, []
    for k in ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]:
        a = str(agent.get(k, "C")).strip()[:1].upper() or "C"
        a = a if a in ORDER else "C"
        qs, qr = qg.get(k, ("C", ""))
        # Regulated water: methodology caps G1 at B (agent used EBITDA leverage)
        if k == "G1" and r.peer_group == "Adjacent: regulated water" and a == "A":
            a = "B"; reasons.append("G1 agent A capped to B for regulated water per methodology change log")
        st = a if ORDER[a] >= ORDER[qs] else qs
        out[k] = st
        if qs != "C":
            reasons.append(f"{k}={qs} (quant): {qr}")
    if agent.get("notes"):
        reasons.append("agent: " + str(agent["notes"])[:600])
    status = max(out.values(), key=lambda z: ORDER[z])
    return out, status, " | ".join(reasons)


def scenario(r, g_org, years, case):
    """Annualised total return (reporting currency) under a case. Returns (irr, equity_exit, assumptions)."""
    ev0, e0, nd0, mcap = r["ev_post_lease"], r["ebitdaal_adj"], r["net_debt_pre_lease"], r["mcap"]
    fcf0 = r["fcf_std"]
    if not all(pd.notna(x) for x in (ev0, e0, nd0, mcap, fcf0)) or e0 <= 0 or mcap <= 0:
        return np.nan, np.nan, {}
    m0 = ev0 / e0
    now_pit, med, p25 = r.get("ev_ebitda_pit_now"), r.get("ev_ebitda_median_10y"), r.get("ev_ebitda_p25_10y")
    rel_med = min(1.0, med / now_pit) if pd.notna(med) and pd.notna(now_pit) and now_pit > 0 else 1.0
    rel_p25 = min(0.85, p25 / now_pit) if pd.notna(p25) and pd.notna(now_pit) and now_pit > 0 else 0.80
    margin = r["ebitdaal_adj"] / r["revenue"] if r["revenue"] else np.nan
    if case == "base":
        g, dm, mult = g_org, 0.0, m0 * rel_med
    elif case == "bear":
        g, dm, mult = g_org - 0.02, -0.01, m0 * rel_p25
    else:
        g, dm, mult = g_org + 0.015, 0.005, m0
    marg_factor = (margin + dm) / margin if pd.notna(margin) and margin > 0.02 else 1.0
    e_n = e0 * (1 + g) ** years * marg_factor
    cum_fcf = sum(fcf0 * ((1 + g) ** t) * (1 + (marg_factor - 1) * t / years) for t in range(1, years + 1))
    dil = (r["sbc"] / mcap) if pd.notna(r.get("sbc")) and r["sbc"] > 0 else 0.0
    mino = abs(r["minorities"]) if pd.notna(r.get("minorities")) and "Up-C" not in str(r.get("shares_source", "")) else 0.0
    inv = r["lt_investments"] if pd.notna(r.get("lt_investments")) else 0.0
    equity_exit = mult * e_n - nd0 - mino + inv + cum_fcf  # same EV->equity bridge as entry (minorities out, associates in)
    share_factor = (1 + dil) ** years
    if equity_exit <= 0:
        return -1.0, equity_exit, {}
    irr = (equity_exit / share_factor / mcap) ** (1 / years) - 1
    return irr, equity_exit / share_factor, {"g": g, "exit_multiple": mult, "entry_multiple": m0, "margin_delta": dm, "dilution_pa": dil}


def pct(s, higher_better=True):
    r = s.rank(pct=True)
    return (r if higher_better else 1 - r + 1 / max(len(s.dropna()), 1)) * 100


def _ov(name):
    f = PROC.parent.parent / "config" / name
    return pd.read_csv(f) if f.exists() else pd.DataFrame()


def main():
    u = universe()
    snap = pd.read_csv(PROC / "snapshot.csv")
    Q = load_qual()
    G_OV = _ov("growth_overrides.csv").set_index("id") if len(_ov("growth_overrides.csv")) else pd.DataFrame()
    GATE_OV = _ov("gate_overrides.csv")
    SC_OV = _ov("score_overrides.csv")
    for _, o in SC_OV.iterrows():  # documented lead/QC score revisions applied to the authoritative record copy in memory
        q = Q.setdefault(o.id, {}); q.setdefault("scores", {})[o.dimension] = {"score": float(o.score), "confidence": o.confidence, "rationale": "OVERRIDE: " + o.rationale}
    # point-in-time history unusable where PitchBook-implied shares deviate >10% from reported (methodology §10)
    bad = snap["implied_vs_reported_shares"].sub(1).abs() > 0.10
    for c in [c for c in snap.columns if c.startswith("ev_ebitda_") and ("median" in c or "p25" in c or "p75" in c or "pctile" in c or c.endswith("pit_now"))] + ["pe_median_10y"]:
        snap.loc[bad, c] = np.nan
    snap["pit_history_excluded"] = bad
    rows, gates_log, scen = [], [], []
    for _, r in snap.iterrows():
        q = Q.get(r.id, {})
        rec = {"id": r.id}
        for k in ["A", "B", "C", "D", "E", "F", "G", "H", "I1", "I2", "I3", "I4", "J", "K"]:
            rec[f"q_{k}"] = sc(q, k)
            rec[f"c_{k}"] = conf(q, k)
        rec.update(organic(q))
        g5 = r.get("revenue_cagr_5y_rep")
        acq_heavy = pd.notna(r.get("acq_spend_3y_pct_ocf")) and r["acq_spend_3y_pct_ocf"] > 0.3
        if pd.notna(rec["org_median_2022on"]):
            lf = rec["org_latest_full"] if pd.notna(rec["org_latest_full"]) else rec["org_median_2022on"]
            g_base = 0.5 * rec["org_median_2022on"] + 0.5 * lf
            g_src = "50/50 median reported organic 2022+ and latest full year (FACT" + (", verified)" if rec["org_verified"] else ")")
            if pd.notna(rec["org_latest_interim"]) and rec["org_latest_interim"] < g_base - 0.02:
                g_base = (g_base + rec["org_latest_interim"]) / 2; g_src += "; blended down with weaker latest interim"
        elif pd.notna(rec["org_latest_full"]):
            g_base, g_src = rec["org_latest_full"], "latest full-year organic only (FACT; single year)"
        elif pd.notna(g5):
            g_base = min(g5 - (0.03 if acq_heavy else 0.01), 0.06)
            g_src = "ESTIMATE (no disclosed organic): 5y reported revenue CAGR less " + ("3pp (acquisitive)" if acq_heavy else "1pp (M&A/FX/price noise)") + ", capped 6%"
        else:
            g_base, g_src = np.nan, "n/a"
        if pd.notna(g_base):
            cap = 0.09 if (pd.notna(rec["q_D"]) and rec["q_D"] >= 5) else 0.08
            if g_base > cap:
                g_src += f"; capped {cap:.0%} (long-run sustainability)"
            g_base = float(np.clip(g_base, -0.02, cap))
            if pd.notna(rec["q_D"]) and rec["q_D"] <= 2:
                g_base = min(g_base, 0.04); g_src += "; capped 4% (weak runway score)"
        if len(G_OV) and r.id in G_OV.index:
            g_base = float(G_OV.loc[r.id, "g_base_override"]); g_src = "GUIDANCE-ANCHORED OVERRIDE: " + str(G_OV.loc[r.id, "rationale"])
        rec["g_base"], rec["g_base_source"] = g_base, g_src
        gs, status, reason = combine_gates(r, q)
        for _, o in GATE_OV[GATE_OV.id == r.id].iterrows() if len(GATE_OV) else []:
            if ORDER[o.status] > ORDER[gs[o.gate]]:
                gs[o.gate] = o.status; reason += f" | {o.gate}={o.status} (lead override after challenge): {o.rationale}"
        status = max(gs.values(), key=lambda z: ORDER[z])
        rec.update({f"gate_{k}": v for k, v in gs.items()}); rec["gate_status"] = status
        gates_log.append({"id": r.id, "name": r["name"], "sector": r.sector, "status": status, **gs, "evidence_and_rationale": reason})
        for yrs in (3, 5):
            for case in ("bear", "base", "bull"):
                irr, eq, a = scenario(r, g_base, yrs, case) if pd.notna(g_base) else (np.nan, np.nan, {})
                rec[f"irr_{case}_{yrs}y"] = irr
                scen.append({"id": r.id, "years": yrs, "case": case, "irr_local": irr, **a,
                             "equity_value_exit": eq})
        # entry price range: price giving 9% and 7% base-case 5y IRR (reporting ccy -> quote ccy via current price)
        irr5 = rec["irr_base_5y"]
        if pd.notna(irr5) and irr5 > -1:
            v_exit = (1 + irr5) ** 5 * r["price"]
            rec["buy_below_price_9pct"] = v_exit / 1.09 ** 5
            rec["fair_max_price_7pct"] = v_exit / 1.07 ** 5
            pass  # price & price_ccy already in snapshot
        # GBP FX scenarios (reporting ccy vs GBP): flat, GBP +10% over horizon, GBP -10%
        if pd.notna(irr5):
            rec["irr_base_5y_gbp_flat"] = irr5
            rec["irr_base_5y_gbp_strong_gbp"] = (1 + irr5) / (1.10 ** (1 / 5)) - 1 if r.get("rep_ccy") != "GBP" else irr5
            rec["irr_base_5y_gbp_weak_gbp"] = (1 + irr5) / (0.90 ** (1 / 5)) - 1 if r.get("rep_ccy") != "GBP" else irr5
        # evidence confidence
        cs = [rec[f"c_{k}"] for k in ["A", "B", "C", "D", "F", "G", "H", "J", "K"] if pd.notna(rec[f"c_{k}"])]
        penalty = 0.1 * len(str(r.get("recon_notes", "") or "").split(";")) if pd.notna(r.get("recon_notes")) and r.get("recon_notes") else 0
        rec["evidence_confidence"] = max(0, (np.mean(cs) if cs else 0.3) - penalty - (0.15 if rec["org_full_years"] < 2 else 0)) * 100
        rows.append(rec)
    S = snap.merge(pd.DataFrame(rows), on="id")
    pd.DataFrame(gates_log).to_csv(PROC / "gates.csv", index=False)
    pd.DataFrame(scen).to_csv(PROC / "scenarios.csv", index=False)
    rankable = S[(S.gate_status != "A") & S.irr_base_5y.notna()].copy()
    # ---- pillars (0-100); qualitative 1-5 -> 0-100
    qmap = lambda cols, d: d[cols].mean(axis=1, skipna=True).sub(1).div(4).mul(100).where(d[cols].notna().sum(axis=1) >= 3)
    rankable["p_quality"] = qmap(["q_A", "q_B", "q_C", "q_J", "q_K", "q_I1"], rankable)
    rankable["p_governance"] = qmap(["q_F", "q_G", "q_H"], rankable)
    rk = rankable
    org_pct = pct(rk["g_base"])
    cons = pct(-rk["rev_growth_std_10y"].fillna(rk["rev_growth_std_10y"].median()))
    negy = pct(-rk["rev_growth_neg_years_10y"].fillna(rk["rev_growth_neg_years_10y"].median()))
    runway = rk["q_D"].sub(1).div(4).mul(100)
    rk["p_growth"] = 0.4 * org_pct + 0.1 * cons + 0.1 * negy + 0.4 * runway.fillna(50)
    rk["p_cash"] = pd.concat([pct(rk["fcf_to_ni_3y_cum"].clip(upper=1.5)), pct(rk["fcf_conv_ebitdaal"].clip(upper=1.2)),
                              pct(rk["roic_avg"].clip(upper=0.6)), pct(rk["fcf_ps_cagr_hist"].clip(-0.3, 0.4))], axis=1).mean(axis=1)
    disc_hist = (rk["ev_ebitda_median_10y"] / rk["ev_ebitda_pit_now"])
    peer_med = rk.groupby(["sector", "peer_group"])["ev_ebitdaal_adj"].transform("median")
    rk["peer_rel_multiple"] = rk["ev_ebitdaal_adj"] / peer_med
    rk["p_valuation"] = (0.5 * pct(rk["irr_base_5y"]) + 0.2 * pct(rk["fcf_yield"]) +
                         0.15 * pct(disc_hist).fillna(50) + 0.15 * pct(-rk["peer_rel_multiple"]).fillna(50))
    rk["operating_momentum"] = pd.concat([pct(rk["org_latest_interim"].fillna(rk["org_latest_full"])),
                                          pct(rk["ebitda_cagr_3y_rep"])], axis=1).mean(axis=1)
    for name, w in WEIGHTS.items():
        rk[f"score_{name}"] = sum(rk[f"p_{k}"].fillna(rk[f"p_{k}"].median()) * v for k, v in w.items())
    rk["rank_overall"] = rk["score_base"].rank(ascending=False)
    rk["rank_in_sector"] = rk.groupby("sector")["score_base"].rank(ascending=False)
    rk["quality_rank_in_sector"] = rk.groupby("sector")["p_quality"].rank(ascending=False)
    rk["value_rank_in_sector"] = rk.groupby("sector")["p_valuation"].rank(ascending=False)
    for name in WEIGHTS:
        rk[f"rank_{name}"] = rk[f"score_{name}"].rank(ascending=False)
    rk["rank_range_across_weights"] = rk[[f"rank_{n}" for n in WEIGHTS]].max(axis=1) - rk[[f"rank_{n}" for n in WEIGHTS]].min(axis=1)
    S = S.merge(rk[["id"] + [c for c in rk.columns if c.startswith(("p_", "score_", "rank_")) or c in ("operating_momentum", "peer_rel_multiple", "quality_rank_in_sector", "value_rank_in_sector")]], on="id", how="left")
    S.to_csv(PROC / "scores.csv", index=False)
    return S


if __name__ == "__main__":
    S = main()
    c = ["id", "sector", "gate_status", "g_base", "irr_bear_5y", "irr_base_5y", "irr_bull_5y", "p_quality", "p_growth", "p_cash", "p_valuation", "p_governance", "score_base", "rank_overall", "rank_range_across_weights"]
    with pd.option_context("display.width", 250, "display.max_rows", 200):
        print(S.sort_values("score_base", ascending=False)[c].round(2).to_string())
