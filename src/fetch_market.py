"""Fetch daily prices, dividends and splits for universe, benchmarks and FX from Yahoo chart API.

Output: data/processed/prices.parquet (long: date, symbol, close, adjclose, currency)
        data/processed/dividends.csv, data/processed/splits.csv, data/processed/fx.parquet
Close prices from the chart API are split-adjusted but NOT dividend-adjusted; we build TR ourselves.
"""
from __future__ import annotations
import datetime as dt
import pandas as pd
from common import RAW, PROC, CFG, universe, get_json, q

START = int(dt.datetime(2014, 1, 1).timestamp())
END = int(dt.datetime(2026, 11, 12, 23, 0).timestamp())
FX = ["USDGBP=X", "EURGBP=X", "CHFGBP=X", "DKKGBP=X", "SEKGBP=X", "CADGBP=X"]


def fetch(sym: str) -> dict:
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{q(sym)}?period1={START}&period2={END}"
           f"&interval=1d&events=div%2Csplits&includeAdjustedClose=true")
    return get_json(url, RAW / "yahoo" / "chart" / f"{sym.replace('^','_')}.json", max_age_days=3)


def parse(sym: str, d: dict):
    r = d["chart"]["result"][0]
    meta, ts = r["meta"], r.get("timestamp", [])
    tz = meta.get("gmtoffset", 0)
    dates = pd.to_datetime([t + tz for t in ts], unit="s").normalize()
    quote = r["indicators"]["quote"][0]
    adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose", [None] * len(ts))
    px = pd.DataFrame({"date": dates, "symbol": sym, "close": quote["close"], "adjclose": adj,
                       "volume": quote.get("volume"), "currency": meta.get("currency")})
    ev = r.get("events", {})
    divs = pd.DataFrame([{"symbol": sym, "date": pd.to_datetime(v["date"] + tz, unit="s").normalize(), "amount": v["amount"]}
                         for v in ev.get("dividends", {}).values()])
    spl = pd.DataFrame([{"symbol": sym, "date": pd.to_datetime(v["date"] + tz, unit="s").normalize(),
                         "ratio": v["numerator"] / v["denominator"]} for v in ev.get("splits", {}).values()])
    # Yahoo often leaves the latest session's daily bar blank for European listings; fill it from the
    # quote metadata when regularMarketTime falls on that date (flagged in column 'filled_from_meta').
    px["filled_from_meta"] = False
    if len(px) and pd.isna(px["close"].iloc[-1]) and meta.get("regularMarketPrice") and meta.get("regularMarketTime"):
        rmt = pd.to_datetime(meta["regularMarketTime"] + tz, unit="s").normalize()
        if rmt == px["date"].iloc[-1]:
            i = px.index[-1]
            px.loc[i, "close"] = meta["regularMarketPrice"]
            px.loc[i, "adjclose"] = meta["regularMarketPrice"] if pd.isna(px.loc[i, "adjclose"]) else px.loc[i, "adjclose"]
            px.loc[i, "filled_from_meta"] = True
    return px.dropna(subset=["close"]).drop_duplicates(["date"], keep="last"), divs, spl, meta


def main():
    u = universe()
    b = pd.read_csv(CFG / "benchmarks.csv")
    syms = list(u["yahoo"]) + sorted(set(b["yahoo"])) + FX
    P, D, S, M = [], [], [], []
    for s in syms:
        try:
            px, dv, sp, meta = parse(s, fetch(s))
        except Exception as e:
            print("FAIL", s, e); continue
        P.append(px); D.append(dv); S.append(sp)
        M.append({"symbol": s, "currency": meta.get("currency"), "exchange": meta.get("fullExchangeName"),
                  "long_name": meta.get("longName"), "first_trade": px["date"].min(), "last": px["date"].max(),
                  "instrument": meta.get("instrumentType")})
        print(s, len(px), px["date"].max().date())
    PROC.mkdir(parents=True, exist_ok=True)
    pd.concat(P).to_parquet(PROC / "prices.parquet", index=False)
    pd.concat([d for d in D if len(d)]).to_csv(PROC / "dividends.csv", index=False)
    pd.concat([s for s in S if len(s)]).to_csv(PROC / "splits.csv", index=False)
    pd.DataFrame(M).to_csv(PROC / "market_meta.csv", index=False)


if __name__ == "__main__":
    main()
