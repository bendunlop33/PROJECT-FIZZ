"""Shared paths, constants and a polite cached HTTP client."""
from __future__ import annotations
import json, time, hashlib, datetime as dt
from pathlib import Path
import urllib.parse
import requests
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CFG, RAW, PROC, OUT = ROOT / "config", ROOT / "data" / "raw", ROOT / "data" / "processed", ROOT / "output"
QUAL = ROOT / "research" / "qual"
VALUATION_DATE = pd.Timestamp("2026-11-11")
RUN_DATE = "2026-11-12"
UA = "equity-research-client/1.0 (personal research; contact via repository owner)"
SESSION = requests.Session()
SESSION.headers["User-Agent"] = UA


def get_json(url: str, cache: Path, max_age_days: float = 0.5, pause: float = 0.35, retries: int = 4) -> dict:
    """GET JSON with on-disk cache, honest UA, polite pacing and exponential backoff."""
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists() and (time.time() - cache.stat().st_mtime) < max_age_days * 86400:
        return json.loads(cache.read_text())
    last = None
    for i in range(retries):
        try:
            r = SESSION.get(url, timeout=40)
            if r.status_code == 200:
                d = r.json()
                cache.write_text(json.dumps(d))
                time.sleep(pause)
                return d
            last = f"HTTP {r.status_code}"
        except Exception as e:  # network error
            last = repr(e)
        time.sleep(2 ** (i + 1))
    if cache.exists():  # stale but usable; caller is told via log
        print(f"WARN stale cache used for {url}: {last}")
        return json.loads(cache.read_text())
    raise RuntimeError(f"fetch failed {url}: {last}")


def universe() -> pd.DataFrame:
    u = pd.read_csv(CFG / "universe.csv", dtype=str).fillna("")
    u["region"] = u["yahoo"].map(listing_region)
    return u


def listing_region(y: str) -> str:
    if y.endswith(".L"):
        return "GB"
    if y.endswith(".TO"):
        return "CA"
    if "." in y and not y.endswith(".B"):
        return "EU"
    return "US"


def q(s: str) -> str:
    return urllib.parse.quote(s, safe="")
