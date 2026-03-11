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
import pandas as pd

from f1pit.config import PATHS, RANDOM_SEED
from f1pit.utils.io import write_json
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)

# ── Expected tyre life per compound (Pirelli estimates) ─────────────────
EXPECTED_TYRE_LIFE = {"SOFT": 18, "MEDIUM": 28, "HARD": 40}
DRY_COMPOUNDS = ["SOFT", "MEDIUM", "HARD"]

# ── Physics-based corrections ──────────────────────────────────────────
# The ML model confounds fuel burn-off with tyre degradation (trained on
# filtered quick-laps where TyreLife correlates with lighter fuel load).
# We correct by: (1) removing the model's flawed TyreLife sensitivity and
# (2) applying known tyre degradation + fuel burn curves from Pirelli data.
#
# Fuel burn-off: ~1.7 kg/lap, ~0.035 s/lap/kg → ~0.06 s/lap faster
FUEL_EFFECT_PER_LAP = -0.06  # seconds (negative = getting faster)
#
# Tyre degradation: base_rate per lap + accelerating component (cliff).
# Total deg at tyre_life T = sum of (base + accel*(t-grace)) for t > grace.
# This produces non-linear, accelerating degradation matching real F1 data.
# Tuned so 2-stop strategies are competitive on high-deg circuits but
# 1-stop is viable on low-deg circuits (matching real-world F1 outcomes).
TYRE_DEG_BASE = {"SOFT": 0.10, "MEDIUM": 0.055, "HARD": 0.030}
TYRE_DEG_ACCEL = {"SOFT": 0.008, "MEDIUM": 0.004, "HARD": 0.002}
TYRE_DEG_GRACE = {"SOFT": 5, "MEDIUM": 8, "HARD": 14}
#
# Compound pace offset vs MEDIUM baseline (per lap, negative = faster):
# Real F1 deltas: SOFT ~0.8-1.0s faster than MEDIUM, HARD ~0.5-0.7s slower
COMPOUND_PACE_OFFSET = {"SOFT": -0.85, "MEDIUM": 0.0, "HARD": 0.55}


@dataclass
class StrategyResult:
    """Result of evaluating a single strategy."""
    strategy: list[str]  # e.g. ["MEDIUM", "HARD"]
    pit_laps: list[int]  # e.g. [28]
    total_time: float  # estimated total race time in seconds
    stint_times: list[float]  # estimated time per stint
    pit_costs: list[float]  # estimated cost per pit stop
    warnings: list[str] = field(default_factory=list)
    lap_times: list[dict] = field(default_factory=list)  # per-lap predicted times


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
                "stint_times": [round(t, 3) for t in self.best_strategy.stint_times],
                "pit_costs": [round(c, 3) for c in self.best_strategy.pit_costs],
                "lap_times": self.best_strategy.lap_times,
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
        pit_cost_lookup: dict[str, float] | None = None,
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

        # Per-circuit net pit cost from real data (median PitstopT from Pitstops.csv).
        # Falls back to overall median (23.5s) if circuit not found.
        self.pit_cost_lookup = pit_cost_lookup or {}
        self._pit_cost_fallback = 23.5

    def _get_circuit_row(self, gp: str) -> pd.Series | None:
        """Get circuit info row for a GP."""
        if self.circuit_info is None or self.circuit_info.empty:
            return None
        key = gp.lower().strip()
        match = self.circuit_info[
            self.circuit_info["GP"].str.lower().str.strip() == key
        ]
        if match.empty:
            from f1pit.features.strategy_features import _normalize_gp
            normalized = _normalize_gp(gp)
            match = self.circuit_info[
                self.circuit_info["GP"].str.lower().str.strip() == normalized
            ]
        return match.iloc[0] if not match.empty else None

    def _get_circuit_length(self, gp: str) -> float:
        """Get circuit length in km."""
        row = self._get_circuit_row(gp)
        if row is not None and "Length" in row.index:
            return float(row["Length"])
        return 5.0

    def _get_deg_factor(self, gp: str) -> float:
        """Get circuit-specific degradation multiplier (0.4–1.4).

        Based on TyreStress (1-5) and Abrasion (1-5) from CircuitInfo.
        Low-stress circuits like Monaco get ~0.4x, high like Bahrain get ~1.3x.
        """
        if not hasattr(self, '_deg_factor_cache'):
            self._deg_factor_cache = {}
        if gp in self._deg_factor_cache:
            return self._deg_factor_cache[gp]

        row = self._get_circuit_row(gp)
        if row is not None:
            stress = float(row.get("TyreStress", 3))
            abrasion = float(row.get("Abrasion", 3))
            # Weighted blend: stress matters more than abrasion
            raw = 0.6 * stress + 0.4 * abrasion  # range: 1.0 – 5.0
            # Map to 0.4 – 1.4 multiplier (midpoint 3.0 → 1.0)
            factor = 0.15 + raw * 0.25
        else:
            factor = 1.0

        self._deg_factor_cache[gp] = factor
        return factor

    def _predict_lap_times(
        self,
        gp: str,
        driver: str,
        team: str,
        total_laps: int,
        compounds: list[str],
        pit_laps: list[int],
    ) -> list[dict]:
        """Get per-lap predicted times using ML base pace + physics."""
        circuit_length = self._get_circuit_length(gp)

        if not hasattr(self, '_base_pace_cache'):
            self._base_pace_cache = {}
        cache_key = (gp, driver, team, total_laps)
        if cache_key not in self._base_pace_cache:
            self._base_pace_cache[cache_key] = self._get_base_pace(
                gp, driver, team, total_laps, circuit_length,
            )
        base_pace = self._base_pace_cache[cache_key]
        deg_factor = self._get_deg_factor(gp)

        result: list[dict] = []
        for i, compound in enumerate(compounds):
            if i == 0:
                start_lap = 1
            else:
                start_lap = pit_laps[i - 1] + 1
            end_lap = pit_laps[i] if i < len(compounds) - 1 else total_laps

            for j, lap_num in enumerate(range(start_lap, end_lap + 1)):
                t = self._physics_lap_time(
                    base_pace, compound, j + 1, lap_num, total_laps, deg_factor,
                )
                result.append({
                    "lap": lap_num,
                    "time": round(t, 3),
                    "compound": compound,
                    "stint": i + 1,
                    "tyre_life": j + 1,
                })

        return result

    def _get_base_pace(
        self,
        gp: str,
        driver: str,
        team: str,
        total_laps: int,
        circuit_length: float,
    ) -> float:
        """Get base lap time from ML model (fresh tyres, mid-race fuel)."""
        # Use mid-race conditions with fresh tyres as the baseline
        row = {
            "GP": gp, "Driver": driver, "Team": team,
            "Compound": "MEDIUM",  # Always use MEDIUM as baseline
            "TyreLife": 5,  # Fresh-ish tyres (avoid outlier at TyreLife=1)
            "RacePercentage": 0.5,  # Mid-race
            "Position": 10, "Stint": 1, "LapNumber": total_laps // 2,
        }
        pred_df = pd.DataFrame([row])
        feature_cols = [c for c in self.lap_features if c in pred_df.columns]
        if not feature_cols:
            return circuit_length * 18.0
        try:
            return float(self.lap_model.predict(pred_df[feature_cols])[0]) * circuit_length
        except Exception:
            return circuit_length * 18.0

    def _physics_lap_time(
        self,
        base_pace: float,
        compound: str,
        tyre_life: int,
        lap_number: int,
        total_laps: int,
        deg_factor: float = 1.0,
    ) -> float:
        """
        Compute a single lap time using ML base pace + physics corrections.

        Corrections applied:
        1. Compound pace offset (SOFT faster, HARD slower)
        2. Fuel burn-off (cars get lighter = faster over race)
        3. Tyre degradation (tyres lose grip = slower, after grace period)
        """
        # Start from ML base pace
        t = base_pace

        # 1. Compound offset
        t += COMPOUND_PACE_OFFSET.get(compound, 0.0)

        # 2. Fuel effect: mid-race is the baseline (RacePercentage=0.5),
        #    so adjust relative to that
        race_pct = lap_number / total_laps
        fuel_delta = (race_pct - 0.5) * total_laps * FUEL_EFFECT_PER_LAP
        t += fuel_delta

        # 3. Tyre degradation (non-linear: base + accelerating component)
        grace = TYRE_DEG_GRACE.get(compound, 10)
        base_deg = TYRE_DEG_BASE.get(compound, 0.06) * deg_factor
        accel = TYRE_DEG_ACCEL.get(compound, 0.005) * deg_factor
        if tyre_life > grace:
            age = tyre_life - grace
            t += base_deg * age + accel * age * age

        return t

    def _estimate_stint_time(
        self,
        gp: str,
        driver: str,
        team: str,
        compound: str,
        start_lap: int,
        end_lap: int,
        _stint_number: int,
        total_laps: int,
        circuit_length: float,
    ) -> float:
        """Estimate total time for a stint using ML base pace + physics.

        Uses closed-form summation for speed (no per-lap Python loop).
        """
        n_laps = end_lap - start_lap + 1
        if n_laps <= 0:
            return 0.0

        # Cache base pace per call to avoid repeated ML predictions
        if not hasattr(self, '_base_pace_cache'):
            self._base_pace_cache = {}

        cache_key = (gp, driver, team, total_laps)
        if cache_key not in self._base_pace_cache:
            self._base_pace_cache[cache_key] = self._get_base_pace(
                gp, driver, team, total_laps, circuit_length,
            )
        base_pace = self._base_pace_cache[cache_key]

        # 1. Base pace + compound offset
        compound_offset = COMPOUND_PACE_OFFSET.get(compound, 0.0)
        total_time = n_laps * (base_pace + compound_offset)

        # 2. Fuel effect: sum of (lap/total - 0.5) * total * fuel_rate
        #    = fuel_rate * sum(lap - total/2) for lap in [start..end]
        #    = fuel_rate * (n*mean_lap - n*total/2)
        mean_lap = (start_lap + end_lap) / 2.0
        total_time += FUEL_EFFECT_PER_LAP * n_laps * (mean_lap - total_laps / 2.0)

        # 3. Tyre degradation: sum of (base*k + accel*k^2) for k = max(0, tl-grace)
        #    Scaled by circuit-specific degradation factor
        deg_factor = self._get_deg_factor(gp)
        grace = TYRE_DEG_GRACE.get(compound, 10)
        base_deg = TYRE_DEG_BASE.get(compound, 0.06) * deg_factor
        accel_deg = TYRE_DEG_ACCEL.get(compound, 0.005) * deg_factor
        if n_laps > grace:
            n_deg = n_laps - grace
            sum_k = n_deg * (n_deg + 1) // 2
            sum_k2 = n_deg * (n_deg + 1) * (2 * n_deg + 1) / 6.0
            total_time += base_deg * sum_k + accel_deg * sum_k2

        return total_time

    def _estimate_pit_cost(self, gp: str, **_kwargs: Any) -> float:
        """
        Estimate net pit stop time loss (time lost vs staying on track).

        Uses real per-circuit median pit stop times from Pitstops.csv (2019-2024,
        ~4000 entries). Falls back to ML model prediction, then overall median.
        In F1 the net pit cost is typically 20-25s depending on circuit.
        """
        if not hasattr(self, '_pit_cost_cache'):
            self._pit_cost_cache: dict[str, float] = {}
        if gp in self._pit_cost_cache:
            return self._pit_cost_cache[gp]

        # 1. Try real data lookup (per-circuit median PitstopT)
        key = gp.lower().strip()
        cost = None
        for lookup_gp, lookup_cost in self.pit_cost_lookup.items():
            if lookup_gp.lower().strip() == key:
                cost = lookup_cost
                break

        # 2. Fuzzy match on partial GP name
        if cost is None:
            for lookup_gp, lookup_cost in self.pit_cost_lookup.items():
                if key in lookup_gp.lower() or lookup_gp.lower() in key:
                    cost = lookup_cost
                    break

        # 3. Fall back to ML pitstop model
        if cost is None:
            try:
                pit_df = pd.DataFrame([{"GP": gp}])
                pit_cols = [c for c in self.pit_features if c in pit_df.columns]
                cost = float(self.pit_model.predict(pit_df[pit_cols])[0])
            except Exception:
                cost = self._pit_cost_fallback

        self._pit_cost_cache[gp] = cost
        return cost

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

        For 1-stop: sweeps every pit lap for each compound pair.
        For 2-stop: uses even-split timing ± window for each compound triple.
        For 3-stop: uses even-split timing ± window for each compound quad.
        """
        strategies: list[tuple[list[str], list[int]]] = []
        min_s = self.MIN_STINT_LAPS

        # ── 1-STOP: sweep all pit laps for each compound pair ──
        for c1 in DRY_COMPOUNDS:
            for c2 in DRY_COMPOUNDS:
                if c1 == c2:
                    continue
                for pit in range(min_s, total_laps - min_s + 1):
                    strategies.append(([c1, c2], [pit]))

        if max_stops < 2:
            return strategies

        # ── 2-STOP: for each compound triple, sweep pit laps ──
        # Use even split as center, explore ±offset with step
        even2 = total_laps // 3
        step2 = 4
        offset2 = 8
        for c1 in DRY_COMPOUNDS:
            for c2 in DRY_COMPOUNDS:
                for c3 in DRY_COMPOUNDS:
                    if len({c1, c2, c3}) < 2:
                        continue
                    # Compute sensible pit windows for each compound
                    life1 = min(EXPECTED_TYRE_LIFE.get(c1, 25), even2 + offset2)
                    life2 = min(EXPECTED_TYRE_LIFE.get(c2, 25), even2 + offset2)
                    p1_lo = max(min_s, even2 - offset2)
                    p1_hi = min(total_laps - 2 * min_s, min_s + life1, even2 + offset2)
                    for p1 in range(p1_lo, p1_hi + 1, step2):
                        p2_center = p1 + even2
                        p2_lo = max(p1 + min_s, p2_center - offset2)
                        p2_hi = min(total_laps - min_s, p1 + life2 + min_s, p2_center + offset2)
                        for p2 in range(p2_lo, p2_hi + 1, step2):
                            if total_laps - p2 < min_s:
                                continue
                            strategies.append(([c1, c2, c3], [p1, p2]))

        if max_stops < 3:
            return strategies

        # ── 3-STOP: coarser grid around even split ──
        even3 = total_laps // 4
        step3 = 7
        offset3 = 5
        for c1 in DRY_COMPOUNDS:
            for c2 in DRY_COMPOUNDS:
                for c3 in DRY_COMPOUNDS:
                    for c4 in DRY_COMPOUNDS:
                        if len({c1, c2, c3, c4}) < 2:
                            continue
                        for p1 in range(max(min_s, even3 - offset3),
                                        min(total_laps - 3 * min_s, even3 + offset3) + 1, step3):
                            for p2 in range(max(p1 + min_s, 2 * even3 - offset3),
                                            min(total_laps - 2 * min_s, 2 * even3 + offset3) + 1, step3):
                                for p3 in range(max(p2 + min_s, 3 * even3 - offset3),
                                                min(total_laps - min_s, 3 * even3 + offset3) + 1, step3):
                                    strategies.append(([c1, c2, c3, c4], [p1, p2, p3]))

        return strategies

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

        # Populate per-lap predictions for the best strategy
        if best:
            best.lap_times = self._predict_lap_times(
                gp, driver, team, total_laps, best.strategy, best.pit_laps,
            )

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

        # Populate per-lap predictions for the best strategy
        if best:
            best.lap_times = self._predict_lap_times(
                gp, driver, team, total_laps, best.strategy, best.pit_laps,
            )

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

        # Build stint boundaries: pit on lap P means stint ends on P,
        # next stint starts on P+1.  Total laps must sum to total_laps.
        for i in range(len(compounds)):
            if i == 0:
                start_lap = 1
            else:
                start_lap = pit_laps[i - 1] + 1

            if i < len(compounds) - 1:
                end_lap = pit_laps[i]
            else:
                end_lap = total_laps
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
                pit_cost = self._estimate_pit_cost(gp)
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


    def reoptimize_mid_race(
        self,
        gp: str,
        driver: str,
        team: str,
        total_laps: int,
        current_lap: int,
        current_compound: str,
        current_tyre_life: int,
        pits_done: int = 0,
        compounds_used: list[str] | None = None,
        safety_car: bool = False,
    ) -> OptimizationResult:
        """
        Re-optimize strategy from the current race position.

        When a safety car comes out, pit cost drops (slower pit-in lap is
        masked by the SC delta, and the field bunches up erasing any gap
        lost). We model this as a reduced pit penalty.

        Args:
            current_lap: lap number we are currently on
            current_compound: tyre compound currently fitted
            current_tyre_life: laps done on current set
            pits_done: number of pit stops already completed
            compounds_used: list of compounds used so far (including current)
            safety_car: whether a safety car is currently active
        """
        if compounds_used is None:
            compounds_used = [current_compound.upper()]
        compounds_used = [c.upper() for c in compounds_used]
        current_compound = current_compound.upper()

        circuit_length = self._get_circuit_length(gp)
        remaining_laps = total_laps - current_lap + 1

        # Under SC, pit cost is ~10-12s cheaper (no inlap/outlap time loss)
        sc_pit_discount = 12.0 if safety_car else 0.0

        results: list[StrategyResult] = []

        # Option A: no more stops (only if 2-compound rule already satisfied)
        used_set = set(compounds_used)
        if len(used_set) >= 2:
            time_remaining = self._estimate_stint_time(
                gp, driver, team, current_compound,
                current_lap, total_laps, pits_done + 1, total_laps, circuit_length,
            )
            warnings = []
            remaining_on_tyre = remaining_laps + current_tyre_life
            expected_life = EXPECTED_TYRE_LIFE.get(current_compound, 25)
            if remaining_on_tyre > expected_life + 5:
                warnings.append(
                    f"Extending {current_compound} to {remaining_on_tyre} laps "
                    f"(expected life: {expected_life})"
                )
            results.append(StrategyResult(
                strategy=list(compounds_used),
                pit_laps=[],
                total_time=time_remaining,
                stint_times=[time_remaining],
                pit_costs=[],
                warnings=warnings,
            ))

        # Option B: 1 more stop with each possible compound
        for next_compound in DRY_COMPOUNDS:
            future_used = set(compounds_used) | {next_compound}
            if len(future_used) < 2:
                continue

            # Try pit laps from current_lap+2 up to total_laps - MIN_STINT_LAPS
            best_for_compound: StrategyResult | None = None
            for pit_lap in range(current_lap + 2, total_laps - self.MIN_STINT_LAPS + 1):
                # Current stint: current_lap to pit_lap
                t1 = self._estimate_stint_time(
                    gp, driver, team, current_compound,
                    current_lap, pit_lap, pits_done + 1, total_laps, circuit_length,
                )
                # Pit cost
                pit_cost = self._estimate_pit_cost(
                    gp, current_compound, next_compound,
                    tyre_life=current_tyre_life + (pit_lap - current_lap),
                    stint_in=pits_done + 1,
                ) - sc_pit_discount
                pit_cost = max(pit_cost, 15.0)  # floor
                # Next stint
                t2 = self._estimate_stint_time(
                    gp, driver, team, next_compound,
                    pit_lap + 1, total_laps, pits_done + 2, total_laps, circuit_length,
                )
                total = t1 + pit_cost + t2
                if best_for_compound is None or total < best_for_compound.total_time:
                    best_for_compound = StrategyResult(
                        strategy=list(compounds_used) + [next_compound],
                        pit_laps=[pit_lap],
                        total_time=total,
                        stint_times=[t1, t2],
                        pit_costs=[pit_cost],
                        warnings=[],
                    )
            if best_for_compound is not None:
                results.append(best_for_compound)

        # Option C: 2 more stops (if enough laps remain)
        if remaining_laps > self.MIN_STINT_LAPS * 3:
            for c2 in DRY_COMPOUNDS:
                for c3 in DRY_COMPOUNDS:
                    future_used = set(compounds_used) | {c2, c3}
                    if len(future_used) < 2:
                        continue
                    # Use expected tyre life to place stops
                    life1 = min(EXPECTED_TYRE_LIFE.get(current_compound, 25) - current_tyre_life,
                                remaining_laps - 2 * self.MIN_STINT_LAPS)
                    life1 = max(life1, self.MIN_STINT_LAPS)
                    pit1 = current_lap + life1
                    life2 = min(EXPECTED_TYRE_LIFE.get(c2, 25),
                                total_laps - pit1 - self.MIN_STINT_LAPS)
                    life2 = max(life2, self.MIN_STINT_LAPS)
                    pit2 = pit1 + life2
                    if pit2 >= total_laps - self.MIN_STINT_LAPS + 1:
                        continue

                    t1 = self._estimate_stint_time(
                        gp, driver, team, current_compound,
                        current_lap, int(pit1), pits_done + 1, total_laps, circuit_length,
                    )
                    pc1 = self._estimate_pit_cost(
                        gp, current_compound, c2,
                        tyre_life=current_tyre_life + life1, stint_in=pits_done + 1,
                    ) - sc_pit_discount
                    pc1 = max(pc1, 15.0)
                    t2 = self._estimate_stint_time(
                        gp, driver, team, c2,
                        int(pit1) + 1, int(pit2), pits_done + 2, total_laps, circuit_length,
                    )
                    pc2 = self._estimate_pit_cost(
                        gp, c2, c3, tyre_life=life2, stint_in=pits_done + 2,
                    )
                    t3 = self._estimate_stint_time(
                        gp, driver, team, c3,
                        int(pit2) + 1, total_laps, pits_done + 3, total_laps, circuit_length,
                    )
                    total = t1 + pc1 + t2 + pc2 + t3
                    results.append(StrategyResult(
                        strategy=list(compounds_used) + [c2, c3],
                        pit_laps=[int(pit1), int(pit2)],
                        total_time=total,
                        stint_times=[t1, t2, t3],
                        pit_costs=[pc1, pc2],
                        warnings=[],
                    ))

        results.sort(key=lambda r: r.total_time)
        best = results[0] if results else None

        # Populate per-lap predictions for the best strategy
        if best:
            best.lap_times = self._predict_lap_times(
                gp, driver, team, total_laps, best.strategy, best.pit_laps,
            )

        return OptimizationResult(
            circuit=gp, driver=driver, team=team,
            total_laps=total_laps,
            mode="safety_car_reopt" if safety_car else "mid_race_reopt",
            strategies=results, best_strategy=best,
        )


def _build_pit_cost_lookup(data_processed: Path) -> dict[str, float]:
    """Build per-circuit net pit cost from real Pitstops.csv data.

    Uses median PitstopT per GP (filtered to <60s to exclude red flags).
    Returns {GP_name: median_pit_cost_seconds}.
    """
    pitstops_path = data_processed / "Pitstops.csv"
    if not pitstops_path.exists():
        LOGGER.warning("Pitstops.csv not found at %s, using fallback pit costs", pitstops_path)
        return {}
    try:
        df = pd.read_csv(pitstops_path)
        clean = df[df["PitstopT"] < 60]  # exclude red flags / extreme outliers
        return clean.groupby("GP")["PitstopT"].median().to_dict()
    except Exception as e:
        LOGGER.warning("Failed to load Pitstops.csv: %s", e)
        return {}


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

    # Build per-circuit pit cost from real data
    data_processed = PATHS.data_processed
    pit_cost_lookup = _build_pit_cost_lookup(data_processed)

    return StrategyOptimizer(
        lap_time_model=models["lap_time"],
        pitstop_model=models["pitstop"],
        inlap_model=models["inlap"],
        outlap_model=models["outlap"],
        circuit_info=circuit_info,
        pit_cost_lookup=pit_cost_lookup,
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

    circuit_info_path = PATHS.data_circuit_info
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
