"""
Variant Views portfolio tracker.

Buy-and-hold from the inception date, total return (dividend-adjusted
prices from Yahoo Finance), everything converted to US dollars.
Run daily by GitHub Actions; results are written to the data/ folder.
"""
import json
import math
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

# ---- Settings you might change -------------------------------------------
INCEPTION = "2026-11-02"  # first day of the record (base = that day's close)

BENCHMARKS = ["SPY", "QQQ"]

# Old symbol -> new symbol after a rename (e.g. SPAC merger)
RENAMES = {"CCXI": "AGLT"}
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
HOLDINGS = ROOT / "portfolio" / "holdings.csv"
DATA = ROOT / "data"

SUFFIX_CCY = {
    ".T": "JPY", ".SW": "CHF", ".L": "GBP", ".DE": "EUR", ".PA": "EUR",
    ".AS": "EUR", ".KQ": "KRW", ".KS": "KRW", ".HK": "HKD", ".SS": "CNY",
    ".SZ": "CNY", ".CO": "DKK",
}


def currency(symbol):
    for suffix, ccy in SUFFIX_CCY.items():
        if symbol.endswith(suffix):
            return ccy
    return "USD"


def download(symbols, start):
    df = yf.download(symbols, start=start, auto_adjust=True,
                     progress=False, threads=True)
    close = df["Close"]
    if isinstance(close, pd.Series):
        close = close.to_frame(symbols[0])
    idx = pd.to_datetime(close.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    close.index = idx.normalize()
    return close.groupby(level=0).last()


def fx_to_usd(ccy, start):
    """Series giving the USD value of one unit of `ccy`."""
    s = download([f"{ccy}USD=X"], start).iloc[:, 0].dropna()
    if s.empty:
        s = 1 / download([f"{ccy}=X"], start).iloc[:, 0].dropna()
    return s


def pct(x):
    """Index level (1.0 = start) -> percentage return, JSON-safe."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return round(float((x - 1) * 100), 2)


def main():
    today = pd.Timestamp(date.today())
    inception = pd.Timestamp(INCEPTION)
    if today < inception:
        print("Before inception date; nothing to do.")
        return

    h = pd.read_csv(HOLDINGS)
    h["weight"] = h["weight"].astype(float)
    total = h["weight"].sum()
    if abs(total - 100) > 0.01:
        raise SystemExit(f"Weights add up to {total}, not 100.")

    symbols = list(h["symbol"])
    weights = h.set_index("symbol")["weight"] / 100
    thesis_of = h.set_index("symbol")["thesis"]
    benches = list(BENCHMARKS)
    renamed = [RENAMES[s] for s in symbols if s in RENAMES]

    start = (inception - timedelta(days=10)).strftime("%Y-%m-%d")
    prices = download(symbols + renamed + benches, start)

    # Join old and new price histories after a rename
    for old, new in RENAMES.items():
        if old in prices and new in prices:
            new_s = prices[new].dropna()
            if not new_s.empty:
                first = new_s.index[0]
                prices[old] = prices[old].where(prices.index < first, prices[new])

    # Convert non-USD prices to USD
    for ccy in {currency(s) for s in symbols} - {"USD"}:
        fx = fx_to_usd(ccy, start).reindex(prices.index).ffill().bfill()
        for s in symbols:
            if currency(s) == ccy:
                prices[s] = prices[s] * fx

    # Only keep days on which the US market has closed. Without this, a run in the
    # early morning UK time (while Asian markets are trading) adds a half-finished
    # day where most prices are just copied from the day before, so daily changes
    # show as 0%.
    prices = prices.sort_index()
    us_days = prices.index[prices["SPY"].notna()]
    if pd.Timestamp.now(tz="UTC").hour < 21:      # US close is 20:00 or 21:00 UTC
        us_days = us_days[us_days < today]

    # Carry forward last price on each market's holidays
    prices = prices.ffill()
    prices = prices[prices.index.isin(us_days) & (prices.index <= today)]

    before = prices[prices.index <= inception]
    if before.empty:
        raise SystemExit("No prices on or before the inception date yet.")
    base = before.iloc[-1]
    hist = prices[prices.index >= inception]
    if hist.empty:
        hist = before.iloc[[-1]]

    missing = [s for s in symbols if pd.isna(base.get(s))]
    for s in missing:
        print(f"WARNING: no price data for {s}; held flat at cost.")

    rel = hist[symbols].div(base[symbols])
    for s in missing:
        rel[s] = 1.0
    rel = rel.fillna(1.0)

    pos_values = rel.mul(weights, axis=1)          # buy-and-hold value of each position
    portfolio = pos_values.sum(axis=1)
    thesis_values = pos_values.T.groupby(thesis_of).sum().T
    thesis_weights = weights.groupby(thesis_of).sum()
    bench_rel = hist[benches].div(base[benches])

    # Daily history, every series indexed to 100 at inception
    out = pd.DataFrame(index=hist.index)
    out["Portfolio"] = portfolio * 100
    for b in benches:
        out[b] = bench_rel[b] * 100
    for t in thesis_weights.index:
        out[f"Thesis: {t}"] = thesis_values[t] / thesis_weights[t] * 100

    DATA.mkdir(exist_ok=True)
    out.round(4).to_csv(DATA / "performance.csv", index_label="date",
                        date_format="%Y-%m-%d")

    # Latest snapshot for the website
    last = hist.index[-1]
    theses = []
    for t in thesis_weights.index:
        tv = thesis_values.loc[last, t]
        tw = thesis_weights[t]
        theses.append({
            "thesis": t,
            "target_weight": round(float(tw * 100), 2),
            "current_weight": round(float(tv / portfolio.loc[last] * 100), 2),
            "return_pct": pct(tv / tw),
            "contribution_pp": round(float((tv - tw) * 100), 2),
        })

    positions = []
    for _, row in h.iterrows():
        s = row["symbol"]
        positions.append({
            "symbol": s,
            "name": row["name"],
            "thesis": row["thesis"],
            "target_weight": float(row["weight"]),
            "current_weight": round(float(pos_values.loc[last, s] / portfolio.loc[last] * 100), 2),
            "return_pct": pct(rel.loc[last, s]),
            "contribution_pp": round(float((pos_values.loc[last, s] - weights[s]) * 100), 2),
            "data_missing": s in missing,
        })

    summary = {
        "inception": INCEPTION,
        "as_of": last.strftime("%Y-%m-%d"),
        "portfolio_return_pct": pct(portfolio.loc[last]),
        "benchmarks": {b: pct(bench_rel.loc[last, b]) for b in BENCHMARKS},
        "theses": theses,
        "positions": positions,
        "missing_data": missing,
    }
    with open(DATA / "latest.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"Updated through {summary['as_of']}: portfolio "
          f"{summary['portfolio_return_pct']}% since {INCEPTION}")


if __name__ == "__main__":
    main()
