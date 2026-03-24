"""
Calibrate DEG_SCALE by comparing predicted optimal pit laps to real pit laps.

For each candidate DEG_SCALE value (0.5 → 6.0), we:
  1. Build degradation curves from DegradationCurves.csv, scaled by that value.
  2. Run the strategy optimizer on every (GP, Year, Driver) in Stints.csv.
  3. Compare the predicted optimal first-pit-lap to the actual first-pit-lap.
  4. Compute mean absolute error (MAE) across all races.

The DEG_SCALE with lowest MAE is the best fit to real-world behaviour.

Usage:
    cd f1_strategy
    python scripts/calibrate_deg_scale.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

# Allow imports from f1_strategy/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from f1pit.config import PATHS
from f1pit.models.strategy_optimizer import (
    COMPOUND_PACE_OFFSET,
    DRY_COMPOUNDS,
    EXPECTED_TYRE_LIFE,
    StrategyOptimizer,
    _build_pit_cost_lookup,
)


def get_actual_pit_laps(stints_df: pd.DataFrame) -> pd.DataFrame:
    """Reconstruct actual first pit lap from stint data.

    For each (Driver, GP, Year) with exactly 2 stints (1-stop race),
    the first pit lap = length of stint 1.
    """
    # Only 1-stop races (2 stints) for clean comparison.
    # Multi-stop is noisier (SC, crashes, strategy gambles).
    race_stints = (
        stints_df.groupby(["Driver", "GP", "Year"])
        .filter(lambda g: len(g) == 2)
        .copy()
    )

    # Get stint 1 length = actual pit lap
    stint1 = race_stints[race_stints["Stint"] == 1].copy()
    stint1 = stint1.rename(columns={"StintLength": "actual_pit_lap"})
    stint1 = stint1[["Driver", "GP", "Year", "actual_pit_lap", "Compound"]]
    stint1 = stint1.rename(columns={"Compound": "stint1_compound"})

    # Merge stint 2 compound
    stint2 = race_stints[race_stints["Stint"] == 2][["Driver", "GP", "Year", "Compound"]]
    stint2 = stint2.rename(columns={"Compound": "stint2_compound"})

    merged = stint1.merge(stint2, on=["Driver", "GP", "Year"])
    return merged


def build_optimizer_with_scale(
    deg_scale: float,
    lap_time_model: dict,
    circuit_info: pd.DataFrame | None,
    pit_cost_lookup: dict[str, float],
    deg_rates: pd.DataFrame,
) -> StrategyOptimizer:
    """Build an optimizer with a specific DEG_SCALE value.

    We monkey-patch the deg curves by rebuilding them with the given scale.
    """
    opt = StrategyOptimizer(
        lap_time_model=lap_time_model,
        circuit_info=circuit_info,
        pit_cost_lookup=pit_cost_lookup,
        race_sets=3,
        deg_rates=None,  # we'll build curves manually
    )

    # Rebuild curves with the given DEG_SCALE (same logic as __init__)
    from f1pit.features.strategy_features import _normalize_gp

    # Global fallback curves (75th percentile)
    global_raw: dict[tuple[str, int], float] = {}
    for (comp, tl), grp in deg_rates.groupby(["Compound", "TyreLife"]):
        global_raw[(comp.upper().strip(), int(tl))] = float(
            grp["deg_delta"].quantile(0.75)
        )
    for comp in DRY_COMPOUNDS:
        tls = sorted(tl for (c, tl) in global_raw if c == comp)
        vals = [max(0.0, global_raw[(comp, tl)] * deg_scale) for tl in tls]
        for i in range(1, len(vals)):
            vals[i] = max(vals[i], vals[i - 1])
        for tl, v in zip(tls, vals):
            opt._deg_curve_global[(comp, tl)] = v

    # Per-circuit curves
    for (gp_name, comp), grp in deg_rates.groupby(["GP", "Compound"]):
        curve = grp.sort_values("TyreLife").copy()
        curve["smooth"] = (
            curve["deg_delta"].rolling(5, min_periods=1, center=True).median()
        )
        curve["smooth"] = (curve["smooth"] * deg_scale).clip(lower=0.0)
        vals = curve["smooth"].values.copy()
        for i in range(1, len(vals)):
            vals[i] = max(vals[i], vals[i - 1])

        compound = comp.upper().strip()
        for idx, tl in enumerate(curve["TyreLife"].astype(int)):
            g = opt._deg_curve_global.get((compound, int(tl)), 0.0)
            vals[idx] = max(vals[idx], g)
        for i in range(1, len(vals)):
            vals[i] = max(vals[i], vals[i - 1])

        raw_key = gp_name.lower().strip()
        norm_key = _normalize_gp(gp_name)
        for tl, delta in zip(curve["TyreLife"].astype(int), vals):
            opt._deg_curve[(raw_key, compound, tl)] = float(delta)
            if norm_key != raw_key:
                opt._deg_curve[(norm_key, compound, tl)] = float(delta)

    return opt


def predict_pit_lap(
    opt: StrategyOptimizer,
    gp: str,
    driver: str,
    team: str,
    total_laps: int,
) -> int | None:
    """Run optimizer and return predicted first pit lap for best 1-stop strategy."""
    try:
        result = opt.optimize_deterministic(gp, driver, team, total_laps)
    except Exception:
        return None

    if not result.best_strategy or len(result.best_strategy.pit_laps) == 0:
        return None

    return result.best_strategy.pit_laps[0]


def main() -> None:
    print("=" * 60)
    print("DEG_SCALE Calibration")
    print("=" * 60)

    # ── Load data ──
    stints = pd.read_csv(PATHS.data_processed / "Stints.csv")
    nlaps = pd.read_csv(PATHS.data_processed / "Nlaps.csv")
    deg_rates = pd.read_csv(PATHS.data_processed / "DegradationCurves.csv")

    circuit_info_path = PATHS.data_circuit_info
    circuit_info = pd.read_csv(circuit_info_path, index_col=0) if circuit_info_path.exists() else None

    pit_cost_lookup = _build_pit_cost_lookup(PATHS.data_processed)

    model_dir = PATHS.artifacts / "strategy_latest"
    lap_time_model = joblib.load(model_dir / "lap_time_model.joblib")

    # ── Build actual pit laps from Stints.csv ──
    actuals = get_actual_pit_laps(stints)

    # Merge with Nlaps to get total_laps
    actuals = actuals.merge(nlaps, on=["GP", "Year"], how="inner")

    # We need a team column — get it from DryQuickLaps
    laps_df = pd.read_csv(PATHS.data_processed / "DryQuickLaps.csv", usecols=["Driver", "Team", "GP", "Year"])
    driver_teams = laps_df.drop_duplicates(subset=["Driver", "GP", "Year"])
    actuals = actuals.merge(driver_teams, on=["Driver", "GP", "Year"], how="left")
    actuals = actuals.dropna(subset=["Team"])

    # Filter to reasonable pit laps (not too early/late — avoid SC-influenced races)
    actuals = actuals[
        (actuals["actual_pit_lap"] >= 8)
        & (actuals["actual_pit_lap"] <= actuals["Laps"] - 8)
    ]

    n_races = len(actuals)
    print(f"\nCalibrating against {n_races} 1-stop race entries")
    print(f"({actuals['GP'].nunique()} circuits, {actuals['Year'].nunique()} seasons)\n")

    # ── Subsample for speed: take median pit lap per (GP, Year) ──
    # Instead of running optimizer per-driver (same team prediction anyway),
    # group by race and take the median actual pit lap + a representative driver.
    race_groups = (
        actuals.groupby(["GP", "Year"])
        .agg(
            actual_pit_lap=("actual_pit_lap", "median"),
            Driver=("Driver", "first"),
            Team=("Team", "first"),
            Laps=("Laps", "first"),
        )
        .reset_index()
    )
    race_groups["actual_pit_lap"] = race_groups["actual_pit_lap"].round().astype(int)
    n_races_grouped = len(race_groups)
    print(f"Grouped to {n_races_grouped} unique races for evaluation\n")

    # ── Grid search over DEG_SCALE ──
    # Coarse pass first, then refine around the best
    candidates = np.arange(1.0, 5.1, 0.5)
    results = []

    # Pre-compute base pace once (same for all scales)
    print("Evaluating candidates...\n")
    for ci, deg_scale in enumerate(candidates):
        opt = build_optimizer_with_scale(
            deg_scale, lap_time_model, circuit_info, pit_cost_lookup, deg_rates,
        )
        # Clear cache between scales
        if hasattr(opt, '_base_pace_cache'):
            del opt._base_pace_cache

        errors = []
        for _, row in race_groups.iterrows():
            pred = predict_pit_lap(opt, row["GP"], row["Driver"], row["Team"], int(row["Laps"]))
            if pred is not None:
                errors.append(pred - row["actual_pit_lap"])

        if not errors:
            continue

        mae = np.mean(np.abs(errors))
        bias = np.mean(errors)  # positive = pitting too late
        rmse = np.sqrt(np.mean(np.array(errors) ** 2))
        results.append({
            "deg_scale": deg_scale,
            "mae": mae,
            "bias": bias,
            "rmse": rmse,
            "n_valid": len(errors),
        })
        direction = "late" if bias > 0 else "early"
        print(f"  [{ci+1}/{len(candidates)}] DEG_SCALE={deg_scale:4.2f}  |  MAE={mae:5.2f} laps  |  bias={bias:+5.2f} ({direction})  |  RMSE={rmse:5.2f}  |  n={len(errors)}")

    # ── Refine around the best ──
    if results:
        coarse_best = min(results, key=lambda r: r["mae"])["deg_scale"]
        refine_lo = max(0.5, coarse_best - 0.5)
        refine_hi = coarse_best + 0.5
        refine_candidates = np.arange(refine_lo, refine_hi + 0.01, 0.1)
        # Skip values already tested
        refine_candidates = [c for c in refine_candidates if not any(abs(c - r["deg_scale"]) < 0.05 for r in results)]

        if refine_candidates:
            print(f"\nRefining around {coarse_best:.1f} ({refine_lo:.1f} → {refine_hi:.1f})...\n")
            for ci, deg_scale in enumerate(refine_candidates):
                opt = build_optimizer_with_scale(
                    deg_scale, lap_time_model, circuit_info, pit_cost_lookup, deg_rates,
                )
                if hasattr(opt, '_base_pace_cache'):
                    del opt._base_pace_cache

                errors = []
                for _, row in race_groups.iterrows():
                    pred = predict_pit_lap(opt, row["GP"], row["Driver"], row["Team"], int(row["Laps"]))
                    if pred is not None:
                        errors.append(pred - row["actual_pit_lap"])

                if not errors:
                    continue

                mae = np.mean(np.abs(errors))
                bias = np.mean(errors)
                rmse = np.sqrt(np.mean(np.array(errors) ** 2))
                results.append({
                    "deg_scale": round(deg_scale, 2),
                    "mae": mae,
                    "bias": bias,
                    "rmse": rmse,
                    "n_valid": len(errors),
                })
                direction = "late" if bias > 0 else "early"
                print(f"  [refine {ci+1}/{len(refine_candidates)}] DEG_SCALE={deg_scale:4.2f}  |  MAE={mae:5.2f} laps  |  bias={bias:+5.2f} ({direction})  |  RMSE={rmse:5.2f}")

    # ── Find best ──
    if not results:
        print("\nNo valid results — check data paths.")
        return

    results_df = pd.DataFrame(results)
    best = results_df.loc[results_df["mae"].idxmin()]

    print("\n" + "=" * 60)
    print(f"OPTIMAL DEG_SCALE = {best['deg_scale']:.2f}")
    print(f"  MAE  = {best['mae']:.2f} laps (avg pit lap error)")
    print(f"  Bias = {best['bias']:+.2f} laps")
    print(f"  RMSE = {best['rmse']:.2f} laps")
    print(f"  Based on {int(best['n_valid'])} races")
    print("=" * 60)

    current_scale = 2.5
    current = results_df[results_df["deg_scale"] == current_scale]
    if not current.empty:
        c = current.iloc[0]
        print(f"\nCurrent DEG_SCALE=2.50: MAE={c['mae']:.2f}, bias={c['bias']:+.2f}")

    # Save full results
    out_path = PATHS.data_processed / "deg_scale_calibration.csv"
    results_df.to_csv(out_path, index=False)
    print(f"\nFull results saved to {out_path}")


if __name__ == "__main__":
    main()
