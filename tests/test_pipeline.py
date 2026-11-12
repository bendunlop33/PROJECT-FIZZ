"""Validation tests for the research pipeline. Run: python3 -m pytest -q tests  (after src/run_all.py)."""
import sys, json
from pathlib import Path
import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
P = ROOT / "data" / "processed"


def load(name, **kw):
    f = P / name
    if not f.exists():
        pytest.skip(f"{name} not built")
    return pd.read_csv(f, **kw) if name.endswith(".csv") else pd.read_parquet(f)


def test_shapley_identity():
    from attribution import shapley, price_fn
    x0 = {"E": 100.0, "M": 10.0, "N": 300.0, "S": 50.0}
    x1 = {"E": 130.0, "M": 12.0, "N": 200.0, "S": 45.0}
    phi = shapley(price_fn, x0, x1)
    assert abs(sum(phi.values()) - (price_fn(x1) - price_fn(x0))) < 1e-9
    # order independence: symmetric factors receive equal credit
    phi2 = shapley(lambda v: v["a"] * v["b"], {"a": 1.0, "b": 1.0}, {"a": 2.0, "b": 2.0})
    assert abs(phi2["a"] - phi2["b"]) < 1e-12


def test_attribution_reconciles():
    a = load("attribution.csv")
    assert a["shapley_sum_check"].abs().max() < 1e-6
    assert ((a["check_price_t1"] / a["price_t1_rep"]) - 1).abs().max() < 1e-6


def test_valuation_date_prices():
    s = load("snapshot.csv")
    live = s[s.status_note.fillna("") == ""]
    assert (pd.to_datetime(live["price_date"]) == pd.Timestamp("2026-11-11")).all()


def test_tr_methods_agree_outside_london():
    r = load("returns_summary.csv")
    m = r[~r.price_ccy.isin(["GBp", "GBP"]) & r.qc_tr5_vs_adjclose_pp.notna()]
    assert (m.qc_tr5_vs_adjclose_pp.abs() < 1.0).mean() > 0.9  # own TR = provider adj-close TR (dividend handling check)


def test_missing_not_zero():
    s = load("snapshot.csv")
    for c in ["revenue", "ebitda", "ocf"]:
        assert (s[c] == 0).sum() == 0, f"zero-filled {c}"


def test_pitchbook_mapping_quality():
    v = load("pitchbook_mapping_validation.csv")
    ok = v["mean_abs_margin_diff_vs_yahoo"].dropna()
    assert (ok < 0.02).mean() > 0.9


def test_gate_a_never_ranked():
    s = load("scores.csv")
    assert s.loc[s.gate_status == "A", "score_base"].isna().all()


def test_weights_sum_to_one():
    from rank import WEIGHTS
    for w in WEIGHTS.values():
        assert abs(sum(w.values()) - 1) < 1e-9


def test_no_china_domicile():
    u = pd.read_csv(ROOT / "config" / "universe.csv")
    assert not (u.hq_country == "CN").any()


def test_fx_cross_consistency():
    from fx import cross
    usd_eur = cross("USD", "EUR").dropna()
    eur_usd = cross("EUR", "USD").dropna()
    prod = (usd_eur * eur_usd.reindex(usd_eur.index)).dropna()
    assert (prod.sub(1).abs() < 1e-9).all()


def test_qual_json_valid():
    for f in (ROOT / "research" / "qual").glob("*.json"):
        d = json.loads(f.read_text())
        assert d.get("id") == f.stem
