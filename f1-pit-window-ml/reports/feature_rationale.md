# Feature Rationale and Exclusions

## Objective Alignment
The target approximates actionable pit-window timing decisions. Features are restricted to information plausibly available by the current lap.

## Included Features
1. Stint Context Proxies
- `laps_since_last_pit`, `last_pit_lap`, `stint_number`
- Why: public proxy for tyre age and expected degradation trajectory.

2. Pace/Degradation Proxies
- `lap_time_seconds`
- `rolling_mean_lap_time_last_3`, `rolling_mean_lap_time_last_5`
- `rolling_std_lap_time_last_5`
- `lap_time_delta_prev_lap`, `lap_time_delta_from_rolling_mean_last_3`
- `lap_time_delta_from_personal_best_in_stint` (past laps only)
- `rolling_mean_slope_last_3` (pseudo-telemetry trend)
- Why: degradation appears as pace drop-off and rising volatility.

3. Race Context
- `lap_number`, `lap_number_norm`
- `laps_remaining`, `laps_remaining_norm`
- `year`, `circuit_id`, `country`
- `constructor_id` (categorical), `grid` (numeric)
- optional Ergast metadata (`ergast_country`, `ergast_lat`, `ergast_long`)
- Why: circuits and eras influence tyre wear and strategy baselines.

4. Competition Proxy
- `track_position` when present
- `lap_time_rank_in_lap` fallback
- `lap_field_size`, `lap_time_rank_pct`
- Why: traffic and undercut/overcut incentives alter pit timing decisions.

## Excluded Features (Leakage / Non-causal at Decision Time)
- `positionOrder`, points, final result fields.
- Future-derived aggregates (whole-stint summaries using future laps).
- Direct next pit stop indicators (except label construction internals).

## Construct Validity and Confounding
Pit decisions mix tyre wear, race incidents, weather, and strategic game theory. This model predicts timing patterns, not tyre physics directly.
