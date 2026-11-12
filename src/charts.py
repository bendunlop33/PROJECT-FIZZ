"""Static charts (PNG) for the workbook and report. Small multiples by peer group, one y-axis per panel,
fixed categorical order (reference palette, validated), benchmarks in neutral grey, legends always present.

1. price_local_<S>.png      split/spin-adjusted local-currency share price rebased to 100 (10y)
2. tr_gbp_<S>.png           GBP total shareholder return, dividends reinvested, vs S&P 500 TR and FTSE 250 (GBP)
3. ev_ebitda_<S>.png        point-in-time EV / LTM EBITDA (provider basis, absolute multiple)
4. per_share_<S>.png        TTM EBITDA per (implied) share, rebased to 100 (10y)  [quarterly, PitchBook]
5. fcf_ps_shortlist.png     standardised FCF per diluted share (annual, ~4y, Yahoo) - shortlist only
"""
from __future__ import annotations
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from common import PROC, OUT, VALUATION_DATE, universe

PAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
GREY, INK, INK2, SURF = "#8a8986", "#0b0b0b", "#52514e", "#fcfcfb"
SECTORS = {"S1": "Business services", "S2": "Consumer health & medical consumables", "S3": "Consumer staples",
           "S4": "Specialist industrials & distribution", "S5": "Waste, water & environmental", "S6": "Insurance brokerage & risk services"}
plt.rcParams.update({"font.size": 8, "axes.edgecolor": "#c9c8c3", "axes.labelcolor": INK2, "xtick.color": INK2,
                     "ytick.color": INK2, "axes.grid": True, "grid.color": "#ebeae6", "grid.linewidth": 0.6,
                     "axes.spines.top": False, "axes.spines.right": False, "figure.facecolor": SURF, "axes.facecolor": SURF,
                     "lines.linewidth": 1.6, "legend.frameon": False, "legend.fontsize": 7})


def _chunks(lst, n=7):
    return [lst[i:i + n] for i in range(0, len(lst), n)]


def _panels(u, s):
    out = []
    for pg, g in u[u.sector == s].groupby("peer_group"):
        for i, ch in enumerate(_chunks(list(g.id))):
            out.append((pg if i == 0 else f"{pg} (cont.)", ch))
    return out


def _grid(n):
    cols = 2 if n > 1 else 1
    rows = math.ceil(n / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(11, 3.4 * rows), squeeze=False)
    for ax in axes.flat[n:]:
        ax.set_visible(False)
    return fig, axes.flat


def _finish(fig, title, sub, path):
    import textwrap
    h = fig.get_figheight()
    top = 1 - 0.95 / h
    fig.text(0.01, 1 - 0.25 / h, title, ha="left", va="top", fontsize=11, color=INK, fontweight="bold")
    fig.text(0.01, 1 - 0.52 / h, "\n".join(textwrap.wrap(sub, 190)), ha="left", va="top", fontsize=7.2, color=INK2)
    fig.tight_layout(rect=(0, 0, 1, top))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def chart_series(kind, s, u, mon, pit, pbl):
    panels = _panels(u, s)
    if not panels:
        return
    fig, axes = _grid(len(panels))
    start = VALUATION_DATE - pd.DateOffset(years=10)
    for ax, (pg, ids) in zip(axes, panels):
        for i, cid in enumerate(ids):
            if kind in ("price", "tr"):
                col = f"{cid}|{'price_local' if kind == 'price' else 'tr_gbp'}"
                if col not in mon:
                    continue
                x = mon[col].dropna(); x = x[x.index >= start]
                if len(x) < 6:
                    continue
                ax.plot(x.index, x / x.iloc[0] * 100, color=PAL[i], label=cid)
            elif kind == "ev":
                x = pit[pit.id == cid].set_index("obs_date")["ev_ebitda_pit"].dropna()
                x = x[(x.index >= start) & (x > 0) & (x < 80)]
                if len(x):
                    ax.plot(x.index, x, color=PAL[i], label=cid)
            elif kind == "ps":
                g = pbl[pbl.id == cid].set_index("period_end").sort_index()
                px = pit[pit.id == cid].drop_duplicates("period_k").set_index("period_k")["implied_shares"]
                if g.empty or px.empty:
                    continue
                eps = (g["ebitda"] / px.reindex(g.index)).dropna()
                eps = eps[(eps.index >= start) & (eps > 0)]
                if len(eps) > 3:
                    ax.plot(eps.index, eps / eps.iloc[0] * 100, color=PAL[i], label=cid)
        if kind == "tr":
            for j, (b, ls) in enumerate((("BENCH:SP500TR|tr_gbp", "--"), ("BENCH:FTSE250TR|tr_gbp", ":"))):
                if b in mon:
                    x = mon[b].dropna(); x = x[x.index >= start]
                    ax.plot(x.index, x / x.iloc[0] * 100, color=GREY, ls=ls, lw=1.2,
                            label="S&P 500 TR" if j == 0 else "FTSE 250 TR proxy")
        ax.set_title(pg, loc="left", fontsize=8.5, color=INK)
        if kind == "ev":
            lo, hi = ax.get_ylim()
            if hi > 45:
                ax.set_ylim(0, 45)
                ax.text(0.99, 0.97, "axis capped at 45x (depressed-EBITDA spikes truncated)", transform=ax.transAxes, ha="right", va="top", fontsize=6.5, color=INK2)
        if kind in ("price", "tr", "ps"):
            ax.set_yscale("log")
            ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:.0f}"))
            ax.yaxis.set_minor_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:.0f}" if str(int(v))[0] in "25" else ""))
            ax.axhline(100, color="#c9c8c3", lw=0.8)
        ax.legend(loc="upper left", ncol=3)
    titles = {"price": ("Share price, local currency, rebased to 100 (log scale)",
                        "Split- and spin-off-adjusted closes (Yahoo). Excludes dividends. Start = 10y before 11-Nov-2026 or first listing."),
              "tr": ("Total shareholder return in GBP, dividends reinvested (log scale)",
                     "Gross dividends reinvested on ex-date; unhedged GBP. Grey: S&P 500 TR (GBP) and FTSE 250 TR (ETF proxy). Not a backtest."),
              "ev": ("EV / LTM EBITDA, point-in-time (absolute multiple)",
                     "Quarterly observations: price at date x PitchBook-implied shares + net debt and TTM EBITDA of latest period published by that date (reporting lag applied). Provider basis: leases inside EV & EBITDA from 2019 (IFRS 16 / ASC 842 break). Reported EBITDA: impairment years spike."),
              "ps": ("EBITDA per share (TTM, implied economic shares), rebased to 100 (log scale)",
                     "PitchBook TTM EBITDA (reporting currency) / implied share count at each period end. Quarterly where reported; semi-annual for H1/FY reporters.")}
    t, sub = titles[kind]
    _finish(fig, f"{SECTORS[s]} - {t}", sub, OUT / "charts" / f"{kind}_{s}.png")


def fcf_ps_chart(ids, path):
    h = pd.read_csv(PROC / "annual_history.csv", parse_dates=["period_end"])
    n = len(ids)
    cols = 4
    rows = math.ceil(n / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(11, 2.3 * rows), squeeze=False)
    for ax in axes.flat[n:]:
        ax.set_visible(False)
    for ax, cid in zip(axes.flat, ids):
        g = h[h.id == cid].sort_values("period_end")
        ax.bar(g.period_end.dt.year.astype(str), g["fcf_ps"], color=PAL[0], width=0.6)
        ax.bar(g.period_end.dt.year.astype(str), g["ebitda_ps"] * 0, color=PAL[0])
        ax.set_title(f"{cid} - FCF/share", loc="left", fontsize=8, color=INK)
        ax.axhline(0, color="#c9c8c3", lw=0.8)
    _finish(fig, "Standardised post-lease FCF per diluted share, by fiscal year (reporting currency)",
            "OCF - capex - lease principal (IFRS proxy where undisclosed). Acquisitions excluded; SBC not added back. Source: Yahoo annual statements (~4 years).", path)


def main(shortlist=None):
    (OUT / "charts").mkdir(parents=True, exist_ok=True)
    u = universe()
    mon = pd.read_parquet(PROC / "monthly_series.parquet")
    pit = pd.read_csv(PROC / "pit_multiples.csv", parse_dates=["obs_date", "period_k"])
    pbl = pd.read_csv(PROC / "pb_history_local.csv", parse_dates=["period_end"])
    for s in SECTORS:
        for k in ("price", "tr", "ev", "ps"):
            chart_series(k, s, u, mon, pit, pbl)
    if shortlist:
        fcf_ps_chart(shortlist, OUT / "charts" / "fcf_ps_shortlist.png")


if __name__ == "__main__":
    main()
