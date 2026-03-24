"""
Fit tyre degradation parameters from real F1 lap data.

Uses DryQuickLaps.csv to measure how lap times increase with tyre age
for each compound (SOFT, MEDIUM, HARD), then fits the same model used
by the strategy optimizer:

    deg(T) = 0                                   if T <= grace
    deg(T) = base * (T - grace) + accel * (T - grace)^2   if T > grace

Method:
  1. Group laps by (GP, Year, Driver, Stint) to get clean stint runs.
  2. Normalize lap times within each stint: delta = LapTime - LapTime_at_TyreLife_1
     This removes circuit/driver/car pace differences — we only see degradation.
  3. Also subtract fuel effect (~0.06 s/lap faster as fuel burns off) to isolate
     pure tyre degradation from the fuel-corrected deltas.
  4. Bin by TyreLife and compound, take the median delta at each tyre age.
  5. Fit (base, accel, grace) per compound using least-squares curve fitting.
  6. Print fitted values vs current hardcoded values.

Usage:
    cd f1_strategy
    python scripts/fit_tyre_degradation.py
"""

from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "processed" / "DryQuickLaps.csv"

# Current hardcoded values for comparison
CURRENT = {
    "SOFT":   {"base": 0.100, "accel": 0.008, "grace": 5},
    "MEDIUM": {"base": 0.055, "accel": 0.004, "grace": 8},
    "HARD":   {"base": 0.030, "accel": 0.002, "grace": 14},
}

# Fuel burn-off effect to subtract (cars get faster each lap due to weight loss)
FUEL_EFFECT_PER_LAP = -0.06  # s/lap (negative = faster)


def deg_model(tyre_life: np.ndarray, base: float, accel: float, grace: float) -> np.ndarray:
    """Degradation delta (seconds) at a given tyre life."""
    age = np.maximum(tyre_life - grace, 0.0)
    return base * age + accel * age ** 2


def load_and_prepare() -> pd.DataFrame:
    """Load DryQuickLaps and compute fuel-corrected delta per stint."""
    df = pd.read_csv(DATA_PATH)

    # Keep only dry compounds
    df = df[df["Compound"].isin(["SOFT", "MEDIUM", "HARD"])].copy()
    df = df.dropna(subset=["LapTime", "TyreLife", "LapNumber", "Laps"])

    # Ensure types
    df["TyreLife"] = df["TyreLife"].astype(int)
    df["LapNumber"] = df["LapNumber"].astype(int)
    df["Laps"] = df["Laps"].astype(int)

    # Stint key = unique stint for a driver in a race
    df["stint_key"] = (
        df["Year"].astype(str) + "|" +
        df["GP"] + "|" +
        df["Driver"] + "|" +
        df["Stint"].astype(str)
    )

    # Get the earliest lap in each stint as reference (TyreLife==1 is rare)
    ref = (
        df.sort_values("TyreLife")
        .groupby("stint_key")
        .first()
        .reset_index()[["stint_key", "LapTime", "LapNumber", "TyreLife"]]
        .rename(columns={"LapTime": "RefTime", "LapNumber": "RefLapNumber", "TyreLife": "RefTyreLife"})
    )
    df = df.merge(ref, on="stint_key", how="inner")

    # Raw delta: how much slower than the first lap of the stint
    df["raw_delta"] = df["LapTime"] - df["RefTime"]

    # Fuel correction: between RefLapNumber and current LapNumber,
    # the car got lighter. Each lap burns fuel making the car ~0.06s faster.
    # So the "true" tyre deg is the raw delta PLUS the fuel benefit we need to add back.
    laps_since_ref = df["LapNumber"] - df["RefLapNumber"]
    fuel_benefit = laps_since_ref * FUEL_EFFECT_PER_LAP  # negative (car got faster)
    df["delta"] = df["raw_delta"] - fuel_benefit  # subtract a negative = add back

    # Filter out outlier deltas (safety cars, traffic, etc.)
    df = df[(df["delta"] > -3.0) & (df["delta"] < 8.0)]

    # Only keep stints with at least 5 laps for reliable fitting
    stint_counts = df.groupby("stint_key").size()
    good_stints = stint_counts[stint_counts >= 5].index
    df = df[df["stint_key"].isin(good_stints)]

    return df


def fit_compound(df: pd.DataFrame, compound: str) -> dict:
    """Fit degradation model for a single compound."""
    cdf = df[df["Compound"] == compound].copy()

    # Bin by TyreLife: median delta at each tyre age
    binned = cdf.groupby("TyreLife")["delta"].agg(["median", "count"]).reset_index()
    binned = binned[binned["count"] >= 5]  # need enough data points
    binned = binned[binned["TyreLife"] <= 50]  # cap at 50 laps

    x = binned["TyreLife"].values.astype(float)
    y = binned["median"].values.astype(float)

    # Fit with bounds: base > 0, accel > 0, grace >= 1
    try:
        popt, _ = curve_fit(
            deg_model, x, y,
            p0=[0.05, 0.003, 5.0],
            bounds=([0.0, 0.0, 1.0], [0.5, 0.05, 20.0]),
            maxfev=10000,
        )
        base, accel, grace = popt
    except RuntimeError:
        print(f"  WARNING: curve_fit failed for {compound}, using fallback")
        base, accel, grace = 0.05, 0.003, 5.0

    return {
        "base": round(float(base), 4),
        "accel": round(float(accel), 5),
        "grace": round(float(grace), 1),
        "n_laps": int(cdf.shape[0]),
        "n_stints": cdf["stint_key"].nunique(),
        "x": x,
        "y": y,
    }


def main():
    print("Loading DryQuickLaps.csv...")
    df = load_and_prepare()
    print(f"  {len(df):,} laps across {df['stint_key'].nunique():,} stints")
    print(f"  Years: {sorted(df['Year'].unique())}")
    print(f"  Compounds: {sorted(df['Compound'].unique())}")
    print()

    results = {}
    for compound in ["SOFT", "MEDIUM", "HARD"]:
        result = fit_compound(df, compound)
        results[compound] = result

        cur = CURRENT[compound]
        print(f"{'=' * 60}")
        print(f"  {compound}")
        print(f"{'=' * 60}")
        print(f"  Data: {result['n_laps']:,} laps, {result['n_stints']} stints")
        print()
        print(f"  {'Parameter':<12} {'Current':>10} {'Fitted':>10} {'Change':>10}")
        print(f"  {'-' * 42}")
        print(f"  {'base_deg':<12} {cur['base']:>10.4f} {result['base']:>10.4f} {result['base'] - cur['base']:>+10.4f}")
        print(f"  {'accel':<12} {cur['accel']:>10.5f} {result['accel']:>10.5f} {result['accel'] - cur['accel']:>+10.5f}")
        print(f"  {'grace':<12} {cur['grace']:>10.1f} {result['grace']:>10.1f} {result['grace'] - cur['grace']:>+10.1f}")
        print()

        # Show the degradation curve at key tyre ages
        print(f"  Predicted deg (s) at tyre age:")
        print(f"  {'TyreLife':<10} {'Current':>10} {'Fitted':>10} {'Actual':>10}")
        print(f"  {'-' * 42}")
        for tl in [5, 10, 15, 20, 25, 30, 35, 40]:
            tl_arr = np.array([float(tl)])
            cur_deg = deg_model(tl_arr, cur["base"], cur["accel"], float(cur["grace"]))[0]
            fit_deg = deg_model(tl_arr, result["base"], result["accel"], result["grace"])[0]
            # Find actual median if we have data at this tyre life
            actual = "—"
            idx = np.where(result["x"] == tl)[0]
            if len(idx) > 0:
                actual = f"{result['y'][idx[0]]:>10.3f}"
            print(f"  {tl:<10} {cur_deg:>10.3f} {fit_deg:>10.3f} {actual:>10}")
        print()

    # Print the final values ready to paste into strategy_optimizer.py
    print("=" * 60)
    print("  PASTE INTO strategy_optimizer.py:")
    print("=" * 60)
    print(f'TYRE_DEG_BASE  = {{"SOFT": {results["SOFT"]["base"]}, "MEDIUM": {results["MEDIUM"]["base"]}, "HARD": {results["HARD"]["base"]}}}')
    print(f'TYRE_DEG_ACCEL = {{"SOFT": {results["SOFT"]["accel"]}, "MEDIUM": {results["MEDIUM"]["accel"]}, "HARD": {results["HARD"]["accel"]}}}')
    print(f'TYRE_DEG_GRACE = {{"SOFT": {results["SOFT"]["grace"]}, "MEDIUM": {results["MEDIUM"]["grace"]}, "HARD": {results["HARD"]["grace"]}}}')


if __name__ == "__main__":
    main()
