"""
Build per-circuit, per-compound tyre degradation CURVES from real data.

Instead of a single linear rate, this outputs the median fuel-corrected
degradation (seconds slower than fresh tyres) at each tyre age.

Reads DryQuickLaps.csv, computes fuel-corrected delta per stint, then
takes the median delta at each TyreLife for each (GP, Compound) pair.

Output: data/processed/DegradationCurves.csv
  Columns: GP, Compound, TyreLife, deg_delta, n_samples

Usage:
    cd f1_strategy
    python scripts/build_deg_curves.py
"""

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"
INPUT_PATH = DATA_DIR / "DryQuickLaps.csv"
OUTPUT_PATH = DATA_DIR / "DegradationCurves.csv"

FUEL_EFFECT_PER_LAP = -0.06  # s/lap (negative = car gets faster)
COMPOUNDS = ["SOFT", "MEDIUM", "HARD"]
MAX_TYRE_LIFE = 45  # cap — beyond this there's too little data


def main():
    df = pd.read_csv(INPUT_PATH)
    df = df[df["Compound"].isin(COMPOUNDS)].copy()
    df = df.dropna(subset=["LapTime", "TyreLife", "LapNumber", "Laps"])

    df["TyreLife"] = df["TyreLife"].astype(int)
    df["LapNumber"] = df["LapNumber"].astype(int)

    # Stint key
    df["stint_key"] = (
        df["Year"].astype(str) + "|"
        + df["GP"] + "|"
        + df["Driver"] + "|"
        + df["Stint"].astype(str)
    )

    # Reference: earliest lap in each stint
    ref = (
        df.sort_values("TyreLife")
        .groupby("stint_key")
        .first()
        .reset_index()[["stint_key", "LapTime", "LapNumber"]]
        .rename(columns={"LapTime": "RefTime", "LapNumber": "RefLapNumber"})
    )
    df = df.merge(ref, on="stint_key", how="inner")

    # Fuel-corrected delta vs stint start
    laps_since_ref = df["LapNumber"] - df["RefLapNumber"]
    fuel_benefit = laps_since_ref * FUEL_EFFECT_PER_LAP
    df["delta"] = (df["LapTime"] - df["RefTime"]) - fuel_benefit

    # Filter outliers
    df = df[(df["delta"] > -3.0) & (df["delta"] < 10.0)]
    df = df[df["TyreLife"] <= MAX_TYRE_LIFE]

    # Only keep stints with >= 5 laps
    stint_counts = df.groupby("stint_key").size()
    good_stints = stint_counts[stint_counts >= 5].index
    df = df[df["stint_key"].isin(good_stints)]

    # Compute median delta at each (GP, Compound, TyreLife)
    rows = []
    for (gp, compound, tl), grp in df.groupby(["GP", "Compound", "TyreLife"]):
        if len(grp) >= 3:  # need enough samples
            rows.append({
                "GP": gp,
                "Compound": compound,
                "TyreLife": int(tl),
                "deg_delta": round(grp["delta"].median(), 4),
                "n_samples": len(grp),
            })

    out = pd.DataFrame(rows)
    out = out.sort_values(["GP", "Compound", "TyreLife"]).reset_index(drop=True)

    # Also compute global fallback curves (across all circuits)
    print("Global median degradation curves (fallback):")
    for comp in COMPOUNDS:
        cdf = df[df["Compound"] == comp]
        global_curve = cdf.groupby("TyreLife")["delta"].median()
        print(f"\n  {comp}:")
        for tl in [1, 5, 10, 15, 20, 25, 30]:
            if tl in global_curve.index:
                print(f"    TyreLife {tl:3d}: +{global_curve[tl]:.3f}s")

    out.to_csv(OUTPUT_PATH, index=False)
    print(f"\nWrote {len(out)} rows to {OUTPUT_PATH}")
    print(f"Covers {out['GP'].nunique()} circuits, {out['Compound'].nunique()} compounds")
    print(f"TyreLife range: {out['TyreLife'].min()} to {out['TyreLife'].max()}")


if __name__ == "__main__":
    main()
