"""
Build a per-circuit, per-compound tyre degradation rate table from real data.

Reads DryQuickLaps.csv, computes the fuel-corrected degradation rate (s/lap)
for each (GP, Compound) combination, and writes the result to
data/processed/DegradationRates.csv for use by the strategy optimizer.

Usage:
    cd f1_strategy
    python scripts/build_deg_table.py
"""

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"
INPUT_PATH = DATA_DIR / "DryQuickLaps.csv"
OUTPUT_PATH = DATA_DIR / "DegradationRates.csv"

FUEL_EFFECT_PER_LAP = 0.06  # s/lap (positive = car gets faster per lap)
COMPOUNDS = ["SOFT", "MEDIUM", "HARD"]


def compute_stint_deg_rate(group: pd.DataFrame) -> float | None:
    """Compute fuel-corrected degradation rate for a single stint."""
    group = group.sort_values("TyreLife")
    if len(group) < 4:
        return None

    # Compare first 2 laps vs last 2 laps of the stint
    first = group.iloc[:2]["LapTime"].mean()
    last = group.iloc[-2:]["LapTime"].mean()
    tl_range = group["TyreLife"].max() - group["TyreLife"].min()
    if tl_range < 3:
        return None

    # Fuel correction: the car got lighter (faster) over these laps,
    # so the raw delta understates true tyre degradation
    lap_range = group["LapNumber"].max() - group["LapNumber"].min()
    fuel_correction = (lap_range * FUEL_EFFECT_PER_LAP) / tl_range

    raw_rate = (last - first) / tl_range
    return raw_rate + fuel_correction


def main():
    df = pd.read_csv(INPUT_PATH)
    df = df[df["Compound"].isin(COMPOUNDS)].copy()
    df = df.dropna(subset=["LapTime", "TyreLife", "LapNumber"])
    df = df[df["TyreLife"] >= 3]  # skip outlaps/start laps

    df["stint_key"] = (
        df["Year"].astype(str) + "|"
        + df["GP"] + "|"
        + df["Driver"] + "|"
        + df["Stint"].astype(str)
    )

    rows = []
    for (gp, compound), grp in df.groupby(["GP", "Compound"]):
        rates = []
        for _, stint_grp in grp.groupby("stint_key"):
            rate = compute_stint_deg_rate(stint_grp)
            if rate is not None:
                rates.append(rate)

        if len(rates) >= 3:
            series = pd.Series(rates)
            rows.append({
                "GP": gp,
                "Compound": compound,
                "deg_rate": round(series.median(), 4),
                "deg_rate_25": round(series.quantile(0.25), 4),
                "deg_rate_75": round(series.quantile(0.75), 4),
                "n_stints": len(rates),
            })

    out = pd.DataFrame(rows)
    out = out.sort_values(["GP", "Compound"]).reset_index(drop=True)

    # Also compute global fallback medians per compound
    print("Global median degradation rates (fallback):")
    for comp in COMPOUNDS:
        cdf = out[out["Compound"] == comp]
        print(f"  {comp:8s} {cdf['deg_rate'].median():.4f} s/lap  ({len(cdf)} circuits)")

    out.to_csv(OUTPUT_PATH, index=False)
    print(f"\nWrote {len(out)} rows to {OUTPUT_PATH}")
    print(f"Covers {out['GP'].nunique()} circuits")


if __name__ == "__main__":
    main()
