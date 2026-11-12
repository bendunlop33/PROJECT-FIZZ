"""Low-turnover monitoring: deterministic DAILY exception checks and a WEEKLY change-only review.

Design rules (brief §25-30):
- Monitoring is more frequent than trading. Nothing here trades, rebalances or contacts a broker.
- Only *changes* raise alerts; every alert key is hashed into state/seen.json so unchanged warnings never repeat.
- Deterministic feeds first (prices, published statements, headline keywords). Material items are queued in
  alerts/deep_review_queue.jsonl for a deeper analyst/AI review (PitchBook transcripts/news via an authorised
  Claude session) - that step is NOT automated here.
- All recommendations require human approval; thresholds come from monitoring/thresholds.csv (approved by the user).

Usage:  python3 monitoring/monitor.py daily   |   python3 monitoring/monitor.py weekly
"""
from __future__ import annotations
import hashlib, json, sys, time, datetime as dt
from pathlib import Path
import requests
import pandas as pd

ROOT = Path(__file__).resolve().parent
UA = "equity-research-client/1.0 (personal research)"
STATE, ALERTS = ROOT / "state", ROOT / "alerts"
KEYWORDS = {"profit warning": "Results/guidance", "guidance": "Results/guidance", "cuts outlook": "Results/guidance",
            "lowers": "Results/guidance", "resign": "Management departure", "steps down": "Management departure",
            "chief executive": "Management departure", "acquire": "M&A", "acquisition": "M&A", "takeover": "M&A",
            "merger": "M&A", "bid": "M&A", "disposal": "M&A", "investigation": "Regulation/litigation",
            "lawsuit": "Regulation/litigation", "probe": "Regulation/litigation", "restatement": "Accounting/governance",
            "material weakness": "Accounting/governance", "auditor": "Accounting/governance", "activist": "Activist",
            "stake": "Activist", "covenant": "Financing", "downgrade": "Financing", "refinanc": "Financing",
            "rights issue": "Financing", "recall": "Regulation/litigation", "cyber": "Operational"}


def _get(url, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        time.sleep(2 ** (i + 1))
    return None


def _seen():
    p = STATE / "seen.json"
    return json.loads(p.read_text()) if p.exists() else {}


def _save_seen(s):
    (STATE / "seen.json").write_text(json.dumps(s, indent=1))


def _key(*parts):
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:16]


def load_watchlist():
    w = pd.read_csv(ROOT / "watchlist.csv")
    t = pd.read_csv(ROOT / "thresholds.csv").set_index("id") if (ROOT / "thresholds.csv").exists() else pd.DataFrame()
    return w, t


def price_checks(row, thr, seen, now):
    out = []
    d = _get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(row.yahoo, safe='')}?range=3mo&interval=1d")
    if not d:
        out.append({"type": "Data", "severity": "info", "what": f"price feed unavailable for {row.yahoo}"}); return out
    res = d["chart"]["result"][0]
    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
    if len(closes) < 6:
        return out
    px = res["meta"].get("regularMarketPrice") or closes[-1]
    if row.yahoo.endswith(".L") and res["meta"].get("currency") == "GBp":
        px_cmp = px  # thresholds stored in quote units
    else:
        px_cmp = px
    one_day = px / closes[-2] - 1
    five_day = px / closes[-6] - 1
    if abs(one_day) >= 0.08 or abs(five_day) >= 0.15:
        out.append({"type": "Price move", "severity": "review",
                    "what": f"{row.id} moved {one_day:+.1%} (1d), {five_day:+.1%} (5d) to {px:.2f}",
                    "inference": "Large moves often coincide with results, guidance or M&A; check news before acting. Price falls alone are not a sell signal.",
                    "key": _key(row.id, "move", now.date())})
    if row.id in thr.index:
        t = thr.loc[row.id]
        for lab, lvl, cond in (("buy-below (9% base IRR)", t.get("buy_below"), px_cmp <= t.get("buy_below", -1)),
                               ("above fair max (7% base IRR)", t.get("fair_max"), px_cmp >= t.get("fair_max", 9e18))):
            if pd.notna(lvl) and cond:
                out.append({"type": "Valuation threshold", "severity": "review",
                            "what": f"{row.id} price {px:.2f} crossed {lab} level {lvl:.2f}",
                            "inference": "Threshold crossings prompt review only; a relative-value switch also needs the change to persist across two weekly reviews (§29).",
                            "key": _key(row.id, lab, round(float(lvl), 2))})
    return out


def results_check(row, seen):
    """Detect a newly published reporting period (Yahoo trailing revenue asOfDate change)."""
    d = _get("https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"
             f"{requests.utils.quote(row.yahoo, safe='')}?type=trailingTotalRevenue,trailingEBITDA,quarterlyNetDebt"
             f"&period1={int(time.time()) - 400 * 86400}&period2={int(time.time())}")
    out = []
    if not d:
        return out
    latest = {}
    for r in d.get("timeseries", {}).get("result", []) or []:
        t = r["meta"]["type"][0]
        v = [x for x in (r.get(t) or []) if x]
        if v:
            latest[t] = (v[-1]["asOfDate"], v[-1]["reportedValue"]["raw"])
    if "trailingTotalRevenue" in latest:
        k = _key(row.id, "period", latest["trailingTotalRevenue"][0])
        if k not in seen:
            out.append({"type": "Results", "severity": "material",
                        "what": f"{row.id}: new reporting period in provider data ({latest['trailingTotalRevenue'][0]})",
                        "inference": "Trigger quarterly refresh: KPIs, FCF, thesis expectations, scenarios (brief §25).",
                        "key": k, "deep_review": True})
    return out


def news_check(row, seen):
    d = _get(f"https://query1.finance.yahoo.com/v1/finance/search?q={requests.utils.quote(row.news_query)}&quotesCount=0&newsCount=10")
    out = []
    for n in (d or {}).get("news", []) or []:
        title = n.get("title", "")
        cats = sorted({c for kw, c in KEYWORDS.items() if kw in title.lower()})
        if not cats:
            continue
        k = _key(row.id, "news", n.get("uuid") or title)
        out.append({"type": "/".join(cats), "severity": "material" if set(cats) & {"Accounting/governance", "M&A", "Results/guidance", "Management departure", "Activist", "Financing"} else "review",
                    "what": f"{row.id}: headline '{title}' ({n.get('publisher')}, {dt.datetime.utcfromtimestamp(n.get('providerPublishTime', 0)).date()})",
                    "inference": "Headline keyword match only - verify against the primary RNS/8-K before any judgement.",
                    "link": n.get("link"), "key": k, "deep_review": "material" in cats})
    return out


def daily():
    STATE.mkdir(exist_ok=True); ALERTS.mkdir(exist_ok=True)
    now = dt.datetime.utcnow()
    w, thr = load_watchlist()
    seen = _seen()
    new = []
    for _, row in w.iterrows():
        for a in price_checks(row, thr, seen, now) + results_check(row, seen) + news_check(row, seen):
            k = a.get("key") or _key(a["what"])
            if k in seen:
                continue
            seen[k] = now.isoformat()
            a.update({"id": row.id, "detected_utc": now.isoformat(timespec="seconds")})
            new.append(a)
            if a.get("deep_review"):
                with open(ALERTS / "deep_review_queue.jsonl", "a") as f:
                    f.write(json.dumps(a) + "\n")
    _save_seen(seen)
    if new:  # change-only output: nothing is written on quiet days
        p = ALERTS / f"daily_{now:%Y%m%d}.md"
        lines = [f"# Daily exceptions {now:%Y-%m-%d} (UTC)", "", "Facts are provider data/headlines; 'inference' lines are analyst inference. No action is taken automatically.", ""]
        for a in sorted(new, key=lambda z: ("material", "review", "info").index(z.get("severity", "info"))):
            lines += [f"- **[{a['severity']}] {a['type']}** - {a['what']}", f"  - Inference: {a.get('inference', '')}"]
            if a.get("link"):
                lines.append(f"  - Link: {a['link']}")
        p.write_text("\n".join(lines) + "\n")
        print(p)
    else:
        print("no new exceptions")
    with open(ROOT / "audit_log.csv", "a") as f:
        f.write(f"{now.isoformat(timespec='seconds')},daily,{len(new)}\n")
    return new


def weekly():
    """Change-only weekly review: valuation vs thresholds and rank persistence (needs a refreshed pipeline run)."""
    now = dt.datetime.utcnow()
    scores = ROOT.parent / "data" / "processed" / "scores.csv"
    hist = STATE / "weekly_ranks.csv"
    s = pd.read_csv(scores)[["id", "rank_overall", "irr_base_5y", "gate_status"]]
    s["week"] = now.strftime("%G-W%V")
    prev = pd.read_csv(hist) if hist.exists() else pd.DataFrame(columns=s.columns)
    allh = pd.concat([prev[prev.week != s.week.iloc[0]], s])
    allh.to_csv(hist, index=False)
    weeks = sorted(allh.week.unique())[-3:]
    lines = [f"# Weekly change review {now:%G-W%V}", "", "Only changes are listed. No automatic rebalancing.", ""]
    if len(weeks) >= 3:
        piv = allh[allh.week.isin(weeks)].pivot_table(index="id", columns="week", values="rank_overall")
        moved = piv[(piv[weeks[1]] - piv[weeks[0]]).abs().ge(10) & (piv[weeks[2]] - piv[weeks[0]]).abs().ge(10)]
        for cid, r in moved.iterrows():
            lines.append(f"- {cid}: rank change persisted two weeks ({r[weeks[0]]:.0f} -> {r[weeks[1]]:.0f} -> {r[weeks[2]]:.0f}); eligible for written switch review (§29).")
        gate_prev = allh[allh.week == weeks[-2]].set_index("id")["gate_status"]
        for cid, gs in s.set_index("id")["gate_status"].items():
            if cid in gate_prev and gate_prev[cid] != gs:
                lines.append(f"- {cid}: risk-gate status changed {gate_prev[cid]} -> {gs} (immediate review).")
    else:
        lines.append("- Insufficient weekly history (needs 3 weekly snapshots for persistence test).")
    p = ALERTS / f"weekly_{now:%G-W%V}.md"
    p.write_text("\n".join(lines) + "\n")
    print(p)


if __name__ == "__main__":
    {"daily": daily, "weekly": weekly}[sys.argv[1] if len(sys.argv) > 1 else "daily"]()
