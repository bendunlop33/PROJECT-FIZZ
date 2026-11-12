"""Rebuild everything from cached/refreshed data. Usage: python3 src/run_all.py [--refresh]
--refresh re-downloads Yahoo data (cache max-age otherwise applies). PitchBook extracts must be refreshed through an
authorised PitchBook session (see docs/REFRESH.md); they are read from data/raw/pitchbook/<ID>.json.
"""
import sys, subprocess, time
from pathlib import Path
SRC = Path(__file__).resolve().parent
STEPS = ["fetch_market.py", "fetch_fundamentals.py", "parse_pitchbook.py", "returns.py", "fundamentals.py",
         "attribution.py", "rank.py", "portfolio.py", "backtest.py", "charts.py", "workbook.py"]
if __name__ == "__main__":
    for s in STEPS:
        if not (SRC / s).exists():
            print("skip (missing)", s); continue
        if "--refresh" not in sys.argv and s.startswith("fetch_") and (SRC.parent / "data/processed/prices.parquet").exists():
            print("skip fetch (use --refresh)", s); continue
        t = time.time(); print(">>", s, flush=True)
        r = subprocess.run([sys.executable, s], cwd=SRC, capture_output=True, text=True)
        if r.returncode:
            print(r.stdout[-2000:], r.stderr[-4000:]); sys.exit(f"step failed: {s}")
        print(f"   ok {time.time()-t:.0f}s")
