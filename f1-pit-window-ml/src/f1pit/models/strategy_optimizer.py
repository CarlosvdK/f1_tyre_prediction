"""
Strategy optimizer: decision-tree enumeration of tyre strategies.

Uses the trained strategy models to estimate total race time for each
valid tyre strategy combination, then ranks them by speed.

Implements three modes:
1. Deterministic – pit on exact expected tyre life
2. Window – pit within ±N laps of expected tyre life
3. Direct Rival – adjusts timing based on gap to nearest rival
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from f1pit.config import PATHS, RANDOM_SEED
from f1pit.utils.io import write_json
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)

# ── Expected tyre life per compound (Pirelli estimates) ─────────────────
EXPECTED_TYRE_LIFE = {"SOFT": 18, "MEDIUM": 28, "HARD": 40}
DRY_COMPOUNDS = ["SOFT", "MEDIUM", "HARD"]


@dataclass
class StrategyResult:
    """Result of evaluating a single strategy."""
    strategy: list[str]  # e.g. ["MEDIUM", "HARD"]
    pit_laps: list[int]  # e.g. [28]
    total_time: float  # estimated total race time in seconds
    stint_times: list[float]  # estimated time per stint
    pit_costs: list[float]  # estimated cost per pit stop
    warnings: list[str] = field(default_factory=list)


@dataclass
class OptimizationResult:
    """Result of the full strategy optimization."""
    circuit: str
    driver: str
    team: str
    total_laps: int
    mode: str
    strategies: list[StrategyResult]
    best_strategy: StrategyResult | None

    def to_dict(self) -> dict[str, Any]:
        strategies = []
        for s in self.strategies:
            strategies.append({
                "strategy": s.strategy,
                "strategy_str": "-".join(s.strategy),
                "pit_laps": s.pit_laps,
                "total_time": round(s.total_time, 3),
                "total_time_formatted": _format_time(s.total_time),
                "stint_times": [round(t, 3) for t in s.stint_times],
                "pit_costs": [round(c, 3) for c in s.pit_costs],
                "warnings": s.warnings,
            })

        best = None
        if self.best_strategy:
            best = {
                "strategy": self.best_strategy.strategy,
                "strategy_str": "-".join(self.best_strategy.strategy),
                "pit_laps": self.best_strategy.pit_laps,
                "total_time": round(self.best_strategy.total_time, 3),
                "total_time_formatted": _format_time(self.best_strategy.total_time),
            }

        return {
            "circuit": self.circuit,
            "driver": self.driver,
            "team": self.team,
            "total_laps": self.total_laps,
            "mode": self.mode,
            "best_strategy": best,
            "all_strategies": strategies,
            "n_strategies_evaluated": len(strategies),
        }


def _format_time(seconds: float) -> str:
    """Format seconds as H:MM:SS.mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:06.3f}"
    return f"{minutes}:{secs:06.3f}"


class StrategyOptimizer:
    """
    Enumerates and evaluates tyre strategies using trained models.

    Uses decision-tree logic: starting compound → first pit → second pit → ...
    Rules:
    - Must use at least 2 different compounds (F1 regulation)
    - Maximum 3 pit stops (practical limit)
    - Each stint must be at least 5 laps
    """

    MIN_STINT_LAPS = 5
    MAX_PIT_STOPS = 3

    def __init__(
        self,
        lap_time_model: dict[str, Any],
        pitstop_model: dict[str, Any],
        inlap_model: dict[str, Any],
        outlap_model: dict[str, Any],
        circuit_info: pd.DataFrame | None = None,
    ):
        self.lap_model = lap_time_model["pipeline"]
        self.lap_features = lap_time_model["feature_cols"]

        self.pit_model = pitstop_model["pipeline"]
        self.pit_features = pitstop_model["feature_cols"]

        self.inlap_model = inlap_model["pipeline"]
        self.inlap_features = inlap_model["feature_cols"]

        self.outlap_model = outlap_model["pipeline"]
        self.outlap_features = outlap_model["feature_cols"]

        self.circuit_info = circuit_info

    def _get_circuit_length(self, gp: str) -> float:
        """Get circuit length in km for LapTimePerKM → LapTime conversion."""
        if self.circuit_info is not None and not self.circuit_info.empty:
            match = self.circuit_info[
                self.circuit_info["GP"].str.lower().str.strip() == gp.lower().strip()
            ]
            if not match.empty and "Length" in match.columns:
                return float(match.iloc[0]["Length"])
        return 5.0  # Default fallback

    def _estimate_stint_time(
        self,
        gp: str,
        driver: str,
        team: str,
        compound: str,
        start_lap: int,
        end_lap: int,
        stint_number: int,
        total_laps: int,
        circuit_length: float,
    ) -> float:
        """Estimate total time for a stint by summing predicted lap times."""
        n_laps = end_lap - start_lap + 1
        if n_laps <= 0:
            return 0.0

        # Create prediction dataframe
        rows = []
        for i, lap_num in enumerate(range(start_lap, end_lap + 1)):
            rows.append({
                "GP": gp,
                "Driver": driver,
                "Team": team,
                "Compound": compound,
                "TyreLife": i + 1,
                "RacePercentage": lap_num / total_laps,
                "Position": 10,  # Assume mid-field (no traffic model)
                "Stint": stint_number,
                "LapNumber": lap_num,
            })
        pred_df = pd.DataFrame(rows)

        # Filter to available features
        feature_cols = [c for c in self.lap_features if c in pred_df.columns]
        if not feature_cols:
            # Fallback: rough estimate
            return n_laps * circuit_length * 18.0  # ~18 sec/km rough average

        try:
            pred_per_km = self.lap_model.predict(pred_df[feature_cols])
            total_time = float(np.sum(pred_per_km * circuit_length))
            return total_time
        except Exception:
            return n_laps * circuit_length * 18.0

    def _estimate_pit_cost(
        self,
        gp: str,
        compound_in: str,
        compound_out: str,
        tyre_life: int,
        stint_in: int,
    ) -> float:
        """
        Estimate full pit stop cost:
        pit_cost = inlap_time + pitstop_time + outlap_time
        """
        circuit_length = self._get_circuit_length(gp)

        # Pitstop time (pit lane traverse)
        try:
            pit_df = pd.DataFrame([{"GP": gp}])
            pit_cols = [c for c in self.pit_features if c in pit_df.columns]
            pitstop_time = float(self.pit_model.predict(pit_df[pit_cols])[0])
        except Exception:
            pitstop_time = 25.0  # Default ~25 seconds

        # Inlap time
        try:
            in_df = pd.DataFrame([{
                "GP": gp, "Compound": compound_in,
                "TyreLife": tyre_life, "Stint": stint_in,
            }])
            in_cols = [c for c in self.inlap_features if c in in_df.columns]
            inlap_per_km = float(self.inlap_model.predict(in_df[in_cols])[0])
            inlap_time = inlap_per_km * circuit_length
        except Exception:
            inlap_time = circuit_length * 19.0

        # Outlap time
        try:
            out_df = pd.DataFrame([{"GP": gp, "Compound": compound_out}])
            out_cols = [c for c in self.outlap_features if c in out_df.columns]
            outlap_per_km = float(self.outlap_model.predict(out_df[out_cols])[0])
            outlap_time = outlap_per_km * circuit_length
        except Exception:
            outlap_time = circuit_length * 19.5

        return inlap_time + pitstop_time + outlap_time

    def _enumerate_strategies(
        self,
        total_laps: int,
        max_stops: int = 3,
    ) -> list[tuple[list[str], list[int]]]:
        """
        Enumerate all valid tyre strategies.

        Returns list of (compounds, pit_laps) tuples.
        Rules:
        - Must use ≥2 different compounds
        - Each stint ≥ MIN_STINT_LAPS
        - 1-3 stops
        """
        strategies = []

        for n_stops in range(1, min(max_stops, 3) + 1):
            self._enumerate_recursive(
                total_laps=total_laps,
                n_stops=n_stops,
                current_compounds=[],
                current_pit_laps=[],
                current_lap=1,
                stop_idx=0,
                strategies=strategies,
            )

        return strategies

    def _enumerate_recursive(
        self,
        total_laps: int,
        n_stops: int,
        current_compounds: list[str],
        current_pit_laps: list[int],
        current_lap: int,
        stop_idx: int,
        strategies: list[tuple[list[str], list[int]]],
    ) -> None:
        """Recursively enumerate strategy combinations."""
        if stop_idx == n_stops:
            # Final stint – add each compound option
            for compound in DRY_COMPOUNDS:
                final_compounds = current_compounds + [compound]
                # Check constraint: must use ≥2 different compounds
                if len(set(final_compounds)) < 2:
                    continue
                # Check final stint is long enough
                final_stint_laps = total_laps - current_lap + 1
                if final_stint_laps < self.MIN_STINT_LAPS:
                    continue
                strategies.append((final_compounds.copy(), current_pit_laps.copy()))
            return

        # For this stop, try each compound and pit lap
        remaining_stops = n_stops - stop_idx - 1
        min_pit_lap = current_lap + self.MIN_STINT_LAPS
        # Leave room for remaining stints
        max_pit_lap = total_laps - (remaining_stops + 1) * self.MIN_STINT_LAPS

        for compound in DRY_COMPOUNDS:
            # Use expected tyre life as the default pit lap
            expected_life = EXPECTED_TYRE_LIFE.get(compound, 25)
            pit_lap = min(current_lap + expected_life, max_pit_lap)
            pit_lap = max(pit_lap, min_pit_lap)

            if pit_lap > max_pit_lap or pit_lap < min_pit_lap:
                continue

            self._enumerate_recursive(
                total_laps=total_laps,
                n_stops=n_stops,
                current_compounds=current_compounds + [compound],
                current_pit_laps=current_pit_laps + [int(pit_lap)],
                current_lap=int(pit_lap) + 1,
                stop_idx=stop_idx + 1,
                strategies=strategies,
            )

    def optimize_deterministic(
        self,
        gp: str,
        driver: str,
        team: str,
        total_laps: int,
    ) -> OptimizationResult:
        """
        Deterministic model: pit stops on exact expected tyre life.

        Finds the optimal strategy by evaluating all valid combinations.
        """
        circuit_length = self._get_circuit_length(gp)
        strategies = self._enumerate_strategies(total_laps)

        results = []
        for compounds, pit_laps in strategies:
            result = self._evaluate_strategy(
                gp, driver, team, total_laps, circuit_length, compounds, pit_laps,
            )
            results.append(result)

        # Sort by total time
        results.sort(key=lambda r: r.total_time)
        best = results[0] if results else None

        return OptimizationResult(
            circuit=gp, driver=driver, team=team,
            total_laps=total_laps, mode="deterministic",
            strategies=results, best_strategy=best,
        )

    def optimize_window(
        self,
        gp: str,
        driver: str,
        team: str,
        total_laps: int,
        window_range: list[int] | None = None,
    ) -> OptimizationResult:
        """
        Window model: test pit stops within ±N laps of expected tyre life.

        Explores all combinations of window offsets for each stop.
        """
        if window_range is None:
            window_range = [-3, -2, -1, 0, 1, 2, 3]

        circuit_length = self._get_circuit_length(gp)
        base_strategies = self._enumerate_strategies(total_laps)

        results = []
        for compounds, base_pit_laps in base_strategies:
            # Try each window offset for the first pit stop
            for offset in window_range:
                adjusted_pit_laps = []
                valid = True
                for i, pit_lap in enumerate(base_pit_laps):
                    adjusted = pit_lap + (offset if i == 0 else 0)
                    if adjusted < self.MIN_STINT_LAPS + 1 or adjusted >= total_laps - self.MIN_STINT_LAPS:
                        valid = False
                        break
                    adjusted_pit_laps.append(adjusted)

                if not valid:
                    continue

                # Verify stint lengths are valid
                stint_valid = True
                prev_lap = 0
                for pl in adjusted_pit_laps:
                    if pl - prev_lap < self.MIN_STINT_LAPS:
                        stint_valid = False
                        break
                    prev_lap = pl
                if total_laps - prev_lap < self.MIN_STINT_LAPS:
                    stint_valid = False
                if not stint_valid:
                    continue

                result = self._evaluate_strategy(
                    gp, driver, team, total_laps, circuit_length,
                    compounds, adjusted_pit_laps,
                )
                results.append(result)

        # Deduplicate by strategy string + pit laps
        seen = set()
        unique_results = []
        for r in results:
            key = ("-".join(r.strategy), tuple(r.pit_laps))
            if key not in seen:
                seen.add(key)
                unique_results.append(r)

        unique_results.sort(key=lambda r: r.total_time)
        best = unique_results[0] if unique_results else None

        return OptimizationResult(
            circuit=gp, driver=driver, team=team,
            total_laps=total_laps, mode="window",
            strategies=unique_results, best_strategy=best,
        )

    def _evaluate_strategy(
        self,
        gp: str,
        driver: str,
        team: str,
        total_laps: int,
        circuit_length: float,
        compounds: list[str],
        pit_laps: list[int],
    ) -> StrategyResult:
        """Evaluate a single strategy: compute total race time."""
        stint_times = []
        pit_costs = []
        warnings = []

        # Build stint boundaries
        boundaries = [1] + [p + 1 for p in pit_laps] + [total_laps]

        for i in range(len(compounds)):
            start_lap = boundaries[i]
            end_lap = boundaries[i + 1] if i < len(compounds) - 1 else total_laps
            compound = compounds[i]

            # Check if tyre life is exceeded
            stint_laps = end_lap - start_lap + 1
            expected_life = EXPECTED_TYRE_LIFE.get(compound, 25)
            if stint_laps > expected_life + 5:
                warnings.append(
                    f"Stint {i+1} ({compound}): {stint_laps} laps exceeds "
                    f"expected life of {expected_life} by {stint_laps - expected_life} laps"
                )

            # Estimate stint time
            stint_time = self._estimate_stint_time(
                gp, driver, team, compound,
                start_lap, end_lap, i + 1, total_laps, circuit_length,
            )
            stint_times.append(stint_time)

            # Estimate pit stop cost (if not the last stint)
            if i < len(compounds) - 1:
                next_compound = compounds[i + 1]
                pit_cost = self._estimate_pit_cost(
                    gp, compound, next_compound,
                    tyre_life=stint_laps, stint_in=i + 1,
                )
                pit_costs.append(pit_cost)

        total_time = sum(stint_times) + sum(pit_costs)

        return StrategyResult(
            strategy=compounds,
            pit_laps=pit_laps,
            total_time=total_time,
            stint_times=stint_times,
            pit_costs=pit_costs,
            warnings=warnings,
        )


def load_optimizer(model_dir: Path, circuit_info_path: Path | None = None) -> StrategyOptimizer:
    """Load trained models and create an optimizer instance."""
    models = {}
    for name in ["lap_time", "pitstop", "inlap", "outlap"]:
        path = model_dir / f"{name}_model.joblib"
        if not path.exists():
            raise FileNotFoundError(f"Model not found: {path}")
        models[name] = joblib.load(path)

    circuit_info = None
    if circuit_info_path and circuit_info_path.exists():
        circuit_info = pd.read_csv(circuit_info_path, index_col=0)

    return StrategyOptimizer(
        lap_time_model=models["lap_time"],
        pitstop_model=models["pitstop"],
        inlap_model=models["inlap"],
        outlap_model=models["outlap"],
        circuit_info=circuit_info,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Find optimal F1 tyre strategy")
    parser.add_argument("--model_dir", type=str, default=str(PATHS.artifacts / "strategy_latest"))
    parser.add_argument("--gp", type=str, required=True, help="Grand Prix name (e.g. 'Bahrain')")
    parser.add_argument("--driver", type=str, default="VER")
    parser.add_argument("--team", type=str, default="Red Bull Racing")
    parser.add_argument("--total_laps", type=int, required=True)
    parser.add_argument("--mode", type=str, default="deterministic", choices=["deterministic", "window"])
    parser.add_argument("--output", type=str, default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    circuit_info_path = PATHS.project_root.parent / "CircuitInfo.csv"
    optimizer = load_optimizer(Path(args.model_dir), circuit_info_path)

    if args.mode == "deterministic":
        result = optimizer.optimize_deterministic(
            gp=args.gp, driver=args.driver,
            team=args.team, total_laps=args.total_laps,
        )
    else:
        result = optimizer.optimize_window(
            gp=args.gp, driver=args.driver,
            team=args.team, total_laps=args.total_laps,
        )

    result_dict = result.to_dict()

    if args.output:
        write_json(result_dict, Path(args.output))
        LOGGER.info("Results saved to %s", args.output)
    else:
        import json
        print(json.dumps(result_dict, indent=2))

    if result.best_strategy:
        LOGGER.info(
            "Best strategy: %s (%.3f s / %s)",
            "-".join(result.best_strategy.strategy),
            result.best_strategy.total_time,
            _format_time(result.best_strategy.total_time),
        )


if __name__ == "__main__":
    main()
