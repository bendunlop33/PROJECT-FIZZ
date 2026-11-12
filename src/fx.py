"""FX helpers: daily rates to GBP from Yahoo crosses; GBp handled as GBP/100."""
from __future__ import annotations
import pandas as pd
from common import PROC

_PAIRS = {"USD": "USDGBP=X", "EUR": "EURGBP=X", "CHF": "CHFGBP=X", "DKK": "DKKGBP=X", "SEK": "SEKGBP=X", "CAD": "CADGBP=X"}
_cache = {}


def to_gbp(ccy: str) -> pd.Series:
    """Daily series: 1 unit of ccy in GBP (business days, ffilled)."""
    if ccy in _cache:
        return _cache[ccy]
    if ccy == "GBP":
        s = None
    elif ccy == "GBp":
        s = to_gbp("GBP") / 100.0
        _cache[ccy] = s
        return s
    p = pd.read_parquet(PROC / "prices.parquet")
    idx = pd.bdate_range("2013-12-01", "2026-11-12")
    if ccy == "GBP":
        s = pd.Series(1.0, index=idx)
    else:
        x = p[p.symbol == _PAIRS[ccy]].set_index("date")["close"]
        x = x[~x.index.duplicated()]
        s = x.reindex(idx.union(x.index)).ffill().reindex(idx)
    _cache[ccy] = s
    return s


def cross(frm: str, to: str) -> pd.Series:
    """Daily series: 1 unit of `frm` expressed in `to`."""
    return to_gbp(frm) / to_gbp(to)


def rate_on(frm: str, to: str, date) -> float:
    s = cross(frm, to)
    return float(s.asof(pd.Timestamp(date)))


def avg_rate(frm: str, to: str, start, end) -> float:
    s = cross(frm, to)
    return float(s[(s.index > pd.Timestamp(start)) & (s.index <= pd.Timestamp(end))].mean())
