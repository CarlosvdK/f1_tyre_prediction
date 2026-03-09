from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from f1pit.config import PATHS
from f1pit.features.engineer import FeatureBuildConfig, build_supervised_table


@dataclass(frozen=True)
class DashboardState:
    latest_year: int
    lap_df_all: pd.DataFrame
    latest_lap_df: pd.DataFrame
    race_by_track: dict[str, int]
    track_rows: dict[str, dict[str, Any]]
    driver_code_to_id: dict[str, int]
    driver_id_to_code: dict[int, str]
    latest_driver_codes: list[str]
    laps_by_track_driver: dict[tuple[str, int], list[int]]
    pred_rows: pd.DataFrame


def _normalize(values: np.ndarray) -> np.ndarray:
    v = np.asarray(values, dtype=float)
    if len(v) == 0:
        return v
    lo, hi = float(np.nanmin(v)), float(np.nanmax(v))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi - lo < 1e-9:
        return np.zeros_like(v)
    return (v - lo) / (hi - lo)


def _curvature(points: np.ndarray) -> np.ndarray:
    n = len(points)
    out = np.zeros(n, dtype=float)
    if n < 3:
        return out
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        v1 = p1 - p0
        v2 = p2 - p1
        denom = (np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-8
        cross = abs((v1[0] * v2[1]) - (v1[1] * v2[0]))
        out[i] = cross / denom
    return _normalize(out)


def _generate_track_outline(circuit_id: int, num_points: int = 260) -> list[dict[str, float]]:
    rng = np.random.default_rng(1000 + int(circuit_id))
    theta = np.linspace(0, 2 * np.pi, num_points, endpoint=False)
    phase = rng.uniform(0, 2 * np.pi, size=4)
    radial = (
        1.0
        + 0.27 * np.sin(2.0 * theta + phase[0])
        + 0.14 * np.sin(3.0 * theta + phase[1])
        + 0.10 * np.cos(5.0 * theta + phase[2])
        + 0.06 * np.sin(7.0 * theta + phase[3])
    )

    scale_x = 96 + (int(circuit_id) % 5) * 7
    scale_y = 84 + ((int(circuit_id) + 2) % 5) * 8
    x = radial * np.cos(theta) * scale_x
    y = radial * np.sin(theta) * scale_y
    pts = np.column_stack([x, y])

    # Circular moving average to avoid sharp artificial spikes.
    kernel = 7
    smooth = np.zeros_like(pts)
    for i in range(len(pts)):
        acc = np.zeros(2, dtype=float)
        for k in range(kernel):
            idx = (i + k - kernel // 2) % len(pts)
            acc += pts[idx]
        smooth[i] = acc / kernel

    return [{"x": float(p[0]), "y": float(p[1])} for p in smooth]


def _resolve_driver_id(state: DashboardState, driver: str) -> int:
    d = driver.strip()
    if d in state.driver_code_to_id:
        return state.driver_code_to_id[d]
    if d.isdigit():
        did = int(d)
        if did in state.driver_id_to_code:
            return did
    raise HTTPException(status_code=404, detail=f"Unknown driver '{driver}'")


def _build_state() -> DashboardState:
    lap_path = PATHS.data_processed / "lap_level.parquet"
    model_path = PATHS.artifacts / "latest" / "model.joblib"
    drivers_path = PATHS.data_raw / "kaggle_f1" / "drivers.csv"
    races_path = PATHS.data_raw / "kaggle_f1" / "races.csv"
    circuits_path = PATHS.data_raw / "kaggle_f1" / "circuits.csv"

    if not lap_path.exists():
        raise RuntimeError(f"Processed data not found: {lap_path}")
    if not model_path.exists():
        raise RuntimeError(f"Trained model artifact not found: {model_path}")

    lap_df = pd.read_parquet(lap_path).copy()
    artifact = joblib.load(model_path)
    pipeline = artifact["pipeline"]
    feature_cols = list(artifact["feature_cols"])
    k_pit = int(artifact.get("k_pit", 3))

    feat_df = build_supervised_table(lap_df, FeatureBuildConfig(k_pit=k_pit, task="classification"))
    X = feat_df.reindex(columns=feature_cols)
    feat_df["pit_prob"] = pipeline.predict_proba(X)[:, 1]

    latest_year = int(lap_df["year"].dropna().astype(int).max())
    races = pd.read_csv(races_path)
    circuits = pd.read_csv(circuits_path)
    drivers = pd.read_csv(drivers_path)

    races_latest = races[races["year"].astype(int) == latest_year].copy()
    races_latest["round"] = races_latest["round"].astype(int)
    races_latest = races_latest.sort_values("round")

    race_by_track: dict[str, int] = {}
    track_rows: dict[str, dict[str, Any]] = {}

    for _, race in races_latest.iterrows():
        track_id = str(int(race["circuitId"]))
        race_by_track[track_id] = int(race["raceId"])

    for track_id, race_id in race_by_track.items():
        circuit_id = int(track_id)
        c_row = circuits[circuits["circuitId"].astype(int) == circuit_id].head(1)
        if c_row.empty:
            name = f"Circuit {track_id}"
        else:
            c = c_row.iloc[0]
            name = f"{c['name']} ({c['country']})"
        c_laps = lap_df[lap_df["circuit_id"].astype(int) == circuit_id]
        if not c_laps.empty:
            base_lap = float(c_laps["lap_time_seconds"].median())
            total_laps = int(c_laps["race_total_laps"].max()) if "race_total_laps" in c_laps else 55
        else:
            base_lap = 90.0
            total_laps = 55
            
        c_feats = feat_df[feat_df["circuit_id"].astype(int) == circuit_id]
        if not c_feats.empty and "lap_time_delta_prev_lap" in c_feats:
            stint_laps = c_feats[c_feats["laps_since_last_pit"] > 1]
            if not stint_laps.empty:
                mean_deg = float(stint_laps["lap_time_delta_prev_lap"].mean())
            else:
                mean_deg = 0.115
        else:
            mean_deg = 0.115

        track_rows[track_id] = {
            "id": track_id,
            "name": name,
            "outline": _generate_track_outline(circuit_id),
            "race_id": race_id,
            "base_lap": base_lap,
            "mean_deg": mean_deg,
            "total_laps": total_laps,
        }

    # Latest-year track-specific race rows only (for selector / KPI scope).
    chosen_race_ids = set(race_by_track.values())
    latest_rows = lap_df[(lap_df["year"].astype(int) == latest_year) & (lap_df["race_id"].isin(chosen_race_ids))].copy()

    # Driver code mapping (fallback to numeric id if code missing).
    drivers["driverId"] = drivers["driverId"].astype(int)
    drivers["code"] = drivers["code"].fillna("").astype(str)
    driver_id_to_code: dict[int, str] = {}
    driver_code_to_id: dict[str, int] = {}
    for _, row in drivers.iterrows():
        did = int(row["driverId"])
        code = row["code"].strip() or str(did)
        driver_id_to_code[did] = code
        driver_code_to_id[code] = did

    latest_driver_ids = sorted(set(int(v) for v in latest_rows["driver_id"].dropna().astype(int).tolist()))
    latest_driver_codes = [driver_id_to_code.get(did, str(did)) for did in latest_driver_ids]

    # Laps available per track/driver for UI selectors.
    laps_by_track_driver: dict[tuple[str, int], list[int]] = {}
    for track_id, race_id in race_by_track.items():
        race_rows = latest_rows[latest_rows["race_id"] == race_id]
        for driver_id, g in race_rows.groupby("driver_id"):
            laps = sorted(set(int(v) for v in g["lap_number"].dropna().astype(int).tolist()))
            laps_by_track_driver[(track_id, int(driver_id))] = laps

    pred_latest = feat_df[(feat_df["year"].astype(int) == latest_year) & (feat_df["race_id"].isin(chosen_race_ids))].copy()
    return DashboardState(
        latest_year=latest_year,
        lap_df_all=lap_df,
        latest_lap_df=latest_rows,
        race_by_track=race_by_track,
        track_rows=track_rows,
        driver_code_to_id=driver_code_to_id,
        driver_id_to_code=driver_id_to_code,
        latest_driver_codes=latest_driver_codes,
        laps_by_track_driver=laps_by_track_driver,
        pred_rows=pred_latest,
    )


@lru_cache(maxsize=1)
def get_state() -> DashboardState:
    return _build_state()


def _telemetry_profile(
    state: DashboardState,
    track: str,
    driver_id: int,
    lap: int,
) -> list[dict[str, float]]:
    if track not in state.track_rows:
        raise HTTPException(status_code=404, detail=f"Unknown track '{track}'")

    circuit_id = int(track)
    # Use a couple of races for denser, more stable telemetry characteristics.
    all_races = state.lap_df_all["race_id"].dropna().astype(int).unique().tolist()
    track_hist = state.lap_df_all[state.lap_df_all["circuit_id"].astype(int) == circuit_id].copy()
    if track_hist.empty:
        hist_races = sorted(all_races)[-3:]
    else:
        order_cols = ["race_id", "year", "round"]
        race_order = track_hist[order_cols].dropna().copy()
        race_order["race_id"] = race_order["race_id"].astype(int)
        race_order["year"] = race_order["year"].astype(int)
        race_order["round"] = race_order["round"].astype(int)
        race_order = race_order.drop_duplicates("race_id").sort_values(["year", "round", "race_id"])
        hist_races = race_order["race_id"].tail(3).astype(int).tolist()
        if not hist_races:
            hist_races = sorted(all_races)[-3:]

    hist = state.lap_df_all[state.lap_df_all["race_id"].isin(hist_races)].copy()
    hist_driver = hist[hist["driver_id"].astype(int) == int(driver_id)].copy()
    if hist_driver.empty:
        hist_driver = hist

    lap_band = hist_driver[(hist_driver["lap_number"].astype(int) >= max(1, lap - 2)) & (hist_driver["lap_number"].astype(int) <= lap + 2)]
    if lap_band.empty:
        lap_band = hist_driver

    lap_time = float(lap_band["lap_time_seconds"].median()) if "lap_time_seconds" in lap_band else 90.0
    rank_pct = float(lap_band["lap_time_rank_pct"].median()) if "lap_time_rank_pct" in lap_band else 0.5
    pit_rate = float(lap_band["pit_lap_flag"].mean()) if "pit_lap_flag" in lap_band else 0.02
    lap_degradation = float(np.clip((lap - 1) / 55.0, 0.0, 0.95))

    outline = state.track_rows[track]["outline"]
    pts = np.array([[p["x"], p["y"]] for p in outline], dtype=float)
    curve = _curvature(pts)
    theta = np.linspace(0, 2 * np.pi, len(pts), endpoint=False)
    base_speed = float(np.clip(420.0 - (lap_time * 2.05), 150.0, 325.0))

    telemetry: list[dict[str, float]] = []
    for idx, (x, y) in enumerate(pts):
        k = curve[idx]
        wave = np.sin(theta[idx] * 3.0 + lap * 0.45 + driver_id * 0.03) * 4.2
        speed = np.clip(base_speed * (1.0 - 0.64 * k) - lap_degradation * 18.0 + wave, 70.0, 345.0)
        brake = np.clip((k * 1.55) + (lap_degradation * 0.24) + (rank_pct * 0.16), 0.0, 1.0)
        throttle = np.clip(1.0 - (k * 1.1) - (lap_degradation * 0.3) - (pit_rate * 0.18), 0.06, 1.0)
        telemetry.append(
            {
                "x": float(x),
                "y": float(y),
                "speed": float(speed),
                "brake": float(brake),
                "throttle": float(throttle),
            }
        )
    return telemetry


def _prediction_payload(
    state: DashboardState,
    track: str,
    driver_id: int,
    lap: int,
    compound: str,
    conditions: str,
) -> dict[str, float | int | str]:
    if track not in state.track_rows:
        raise HTTPException(status_code=404, detail=f"Unknown track '{track}'")

    race_id = state.race_by_track[track]
    rows = state.pred_rows[
        (state.pred_rows["race_id"].astype(int) == int(race_id))
        & (state.pred_rows["driver_id"].astype(int) == int(driver_id))
    ].copy()
    if rows.empty:
        rows = state.pred_rows[(state.pred_rows["race_id"].astype(int) == int(race_id))].copy()
    if rows.empty:
        rows = state.pred_rows[(state.pred_rows["circuit_id"].astype(int) == int(track))].copy()
    if rows.empty:
        raise HTTPException(status_code=404, detail="No prediction rows for selected track")

    rows["lap_gap"] = (rows["lap_number"].astype(int) - int(lap)).abs()
    row = rows.sort_values("lap_gap").iloc[0]

    def safe_float(key: str, default: float) -> float:
        val = pd.to_numeric(row.get(key, default), errors="coerce")
        if pd.isna(val):
            return float(default)
        return float(val)

    pit_prob = float(np.clip(safe_float("pit_prob", 0.3), 0.0, 1.0))
    lap_delta = safe_float("lap_time_delta_prev_lap", 0.08)
    slope = safe_float("rolling_mean_slope_last_3", 0.06)
    laps_since = safe_float("laps_since_last_pit", float(max(1, lap)))

    sec_per_lap_increase = float(np.clip(abs(lap_delta) * 0.7 + max(0.0, slope) * 0.9 + pit_prob * 0.16, 0.02, 1.8))
    pit_window_start = int(max(lap + 1, lap + round((1.0 - pit_prob) * 5)))
    pit_window_end = int(max(pit_window_start + 2, pit_window_start + 4))
    tyre_life_pct = float(np.clip(100.0 - (laps_since * 5.3) - (pit_prob * 38.0), 3.0, 100.0))
    wear_base = float(np.clip(1.0 - (tyre_life_pct / 100.0), 0.04, 0.98))

    track_info = state.track_rows[track]
    base_lap_time = track_info.get("base_lap", 90.0)
    mean_deg_from_data = track_info.get("mean_deg", 0.115)
    total_laps = track_info.get("total_laps", 55)

    compound_mod = {
        # pace, life, wear, deg_base
        "soft": (-0.40, -10.0, 0.09, 0.200),
        "medium": (0.0, 0.0, 0.0, 0.115),
        "hard": (0.35, 9.0, -0.05, 0.065),
        "inter": (-0.10, -7.0, 0.06, 0.160),
        "wet": (-0.05, -11.0, 0.08, 0.110),
    }
    condition_deg_mult = {
        "dry": 1.0,
        "hot": 1.3,
        "cool": 0.8,
        "damp": 0.9,
        "wet": 0.7,
    }
    condition_mod = {
        "dry": (0.0, 0.0, 0.0),
        "hot": (0.03, -8.0, 0.07),
        "cool": (-0.02, 6.0, -0.04),
        "damp": (0.06, -4.0, 0.03),
        "wet": (0.12, -12.0, 0.09),
    }
    
    cp = compound_mod.get(compound, compound_mod["medium"])
    cd = condition_mod.get(conditions, condition_mod["dry"])
    d_pace, d_life, d_wear, deg_base = cp[0] + cd[0], cp[1] + cd[1], cp[2] + cd[2], cp[3]
    
    # Scale model degradation by the compound ratio
    cd_deg = condition_deg_mult.get(conditions, 1.0)
    deg = mean_deg_from_data * (deg_base / 0.115) * cd_deg
    base_time = base_lap_time + d_pace

    # Compute Optimal Strategy Data over valid 2-compound combination
    best_pit = total_laps // 2
    best_time = float("inf")
    pit_penalty = 24.5
    
    dry_comps = ["soft", "medium", "hard"]
    if compound in dry_comps:
        valid_next = [c for c in dry_comps if c != compound]
    else:
        valid_next = [compound] # wet/inter rules
        
    best_next_comp = "medium"

    for next_comp in valid_next:
        cp_n = compound_mod.get(next_comp, compound_mod["medium"])
        d_pace_n, _, _, deg_base_n = cp_n[0] + cd[0], cp_n[1] + cd[1], cp_n[2] + cd[2], cp_n[3]
        s2_base = base_lap_time + d_pace_n
        s2_deg  = mean_deg_from_data * (deg_base_n / 0.115) * cd_deg
        
        for p in range(5, total_laps - 4):
            t1 = sum(base_time + deg * l for l in range(1, p + 1))
            t2 = sum(s2_base + s2_deg * l for l in range(1, total_laps - p + 1))
            total = t1 + pit_penalty + t2
            if total < best_time:
                best_time = total
                best_pit = p
                best_next_comp = next_comp

    no_stop_time = sum(base_time + deg * l for l in range(1, total_laps + 1))
    
    time_saved = no_stop_time - best_time
    do_stop = time_saved > 5.0
    strategy_type = "1-stop" if do_stop else "no-stop"
    effective_pit = max(best_pit, lap + 2)
    strat_window_start = max(lap + 1, effective_pit - 2)
    strat_window_end = min(total_laps - 3, effective_pit + 2)

    def fmt_time(sec: float) -> str:
        sign = "+" if sec >= 0 else "-"
        s = abs(sec)
        if s < 60:
            return f"{sign}{s:.1f}s"
        m = int(s // 60)
        r = int(s % 60)
        return f"{sign}{m}:{r:02d}"

    tyre_life_pct = float(np.clip(tyre_life_pct + d_life, 0.0, 100.0))
    wear_base = float(np.clip(wear_base + d_wear, 0.0, 1.0))

    return {
        "sec_per_lap_increase": float(np.clip(sec_per_lap_increase + d_pace, 0.01, 2.2)),
        "pit_window_start": strat_window_start,
        "pit_window_end": strat_window_end,
        "tyre_life_pct": float(tyre_life_pct),
        "wear_FL": float(np.clip(wear_base + 0.08, 0.0, 1.0)),
        "wear_FR": float(np.clip(wear_base + 0.10, 0.0, 1.0)),
        "wear_RL": float(np.clip(wear_base - 0.03, 0.0, 1.0)),
        "wear_RR": float(np.clip(wear_base - 0.01, 0.0, 1.0)),
        "strategy_optimal_pit_lap": effective_pit,
        "strategy_time_saved": float(time_saved),
        "strategy_type": strategy_type,
        "strategy_time_saved_fmt": fmt_time(time_saved),
        "strategy_stint1_laps": effective_pit,
        "strategy_stint2_laps": total_laps - effective_pit,
        "strategy_stint1_compound": compound,
        "strategy_stint2_compound": best_next_comp,
    }


app = FastAPI(title="F1 Tyre Dashboard API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    state = get_state()
    return {"ok": True, "latest_year": state.latest_year}


@app.get("/api/tracks")
def list_tracks() -> list[dict[str, Any]]:
    state = get_state()
    rows = []
    for track_id, row in state.track_rows.items():
        rows.append({"id": track_id, "name": row["name"], "outline": row["outline"]})
    return rows


@app.get("/api/drivers")
def list_drivers(track: str = Query(...)) -> list[str]:
    state = get_state()
    if track not in state.race_by_track:
        raise HTTPException(status_code=404, detail=f"Unknown track '{track}'")
    return state.latest_driver_codes


@app.get("/api/laps")
def list_laps(track: str = Query(...), driver: str = Query(...)) -> list[int]:
    state = get_state()
    if track not in state.race_by_track:
        raise HTTPException(status_code=404, detail=f"Unknown track '{track}'")
    driver_id = _resolve_driver_id(state, driver)
    laps = state.laps_by_track_driver.get((track, int(driver_id)))
    if not laps:
        track_rows = state.latest_lap_df[state.latest_lap_df["circuit_id"].astype(int) == int(track)]
        laps = sorted(set(int(v) for v in track_rows["lap_number"].dropna().astype(int).tolist()))
    if not laps:
        raise HTTPException(status_code=404, detail="No laps for selected track")
    return laps


@app.get("/api/telemetry")
def get_telemetry(track: str = Query(...), driver: str = Query(...), lap: int = Query(...)) -> list[dict[str, float]]:
    state = get_state()
    driver_id = _resolve_driver_id(state, driver)
    return _telemetry_profile(state, track=track, driver_id=driver_id, lap=int(lap))


@app.get("/api/predictions")
def get_predictions(
    track: str = Query(...),
    driver: str = Query(...),
    lap: int = Query(...),
    compound: str = Query("medium"),
    conditions: str = Query("dry"),
) -> dict[str, float | int | str]:
    state = get_state()
    driver_id = _resolve_driver_id(state, driver)
    return _prediction_payload(
        state,
        track=track,
        driver_id=driver_id,
        lap=int(lap),
        compound=compound,
        conditions=conditions,
    )



def _local_dev() -> None:
    import uvicorn

    uvicorn.run(
        "f1pit.api.server:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
    )


# ── Strategy endpoints (use new strategy models) ─────────────────────────

@lru_cache(maxsize=1)
def _get_strategy_optimizer():
    """Lazily load the strategy optimizer with trained models."""
    from f1pit.models.strategy_optimizer import load_optimizer
    model_dir = PATHS.artifacts / "strategy_latest"
    circuit_info_path = PATHS.data_circuit_info
    if not model_dir.exists():
        return None
    try:
        return load_optimizer(model_dir, circuit_info_path)
    except Exception:
        return None


@lru_cache(maxsize=1)
def _get_safety_car_model():
    """Lazily load the safety car model."""
    sc_path = PATHS.artifacts / "strategy_latest" / "safety_car_model.joblib"
    if not sc_path.exists():
        return None
    try:
        return joblib.load(sc_path)
    except Exception:
        return None


@app.get("/api/strategy/optimal")
def get_optimal_strategy(
    track: str = Query(..., description="Grand Prix name (e.g. 'Bahrain')"),
    driver: str = Query("VER"),
    team: str = Query("Red Bull Racing"),
    total_laps: int = Query(57),
    mode: str = Query("deterministic", description="deterministic or window"),
) -> dict:
    optimizer = _get_strategy_optimizer()
    if optimizer is None:
        raise HTTPException(
            status_code=503,
            detail="Strategy models not trained yet. Run: make strategy-train",
        )

    if mode == "window":
        result = optimizer.optimize_window(
            gp=track, driver=driver, team=team, total_laps=total_laps,
        )
    else:
        result = optimizer.optimize_deterministic(
            gp=track, driver=driver, team=team, total_laps=total_laps,
        )

    return result.to_dict()


@app.get("/api/strategy/compare")
def compare_strategies(
    track: str = Query(...),
    driver: str = Query("VER"),
    team: str = Query("Red Bull Racing"),
    total_laps: int = Query(57),
) -> dict:
    """Compare deterministic and window strategies side-by-side."""
    optimizer = _get_strategy_optimizer()
    if optimizer is None:
        raise HTTPException(
            status_code=503,
            detail="Strategy models not trained yet. Run: make strategy-train",
        )

    det = optimizer.optimize_deterministic(
        gp=track, driver=driver, team=team, total_laps=total_laps,
    )
    win = optimizer.optimize_window(
        gp=track, driver=driver, team=team, total_laps=total_laps,
    )

    return {
        "deterministic": det.to_dict(),
        "window": win.to_dict(),
    }


@app.get("/api/strategy/reoptimize")
def reoptimize_strategy(
    track: str = Query(..., description="Grand Prix name (e.g. 'Bahrain')"),
    driver: str = Query("VER"),
    team: str = Query("Red Bull Racing"),
    total_laps: int = Query(57),
    current_lap: int = Query(..., description="Current lap number"),
    current_compound: str = Query("medium"),
    current_tyre_life: int = Query(1),
    pits_done: int = Query(0),
    compounds_used: str = Query("", description="Comma-separated compounds used so far"),
    safety_car: bool = Query(False, description="Is safety car currently active?"),
) -> dict:
    """Re-optimize strategy from current race position (e.g. after a safety car)."""
    optimizer = _get_strategy_optimizer()
    if optimizer is None:
        raise HTTPException(
            status_code=503,
            detail="Strategy models not trained yet. Run: make strategy-train",
        )

    used = [c.strip().upper() for c in compounds_used.split(",") if c.strip()] or [current_compound.upper()]

    result = optimizer.reoptimize_mid_race(
        gp=track,
        driver=driver,
        team=team,
        total_laps=total_laps,
        current_lap=current_lap,
        current_compound=current_compound,
        current_tyre_life=current_tyre_life,
        pits_done=pits_done,
        compounds_used=used,
        safety_car=safety_car,
    )

    return result.to_dict()


@app.get("/api/safety-car/probability")
def safety_car_probability(
    track: str = Query(..., description="Grand Prix name"),
    total_laps: int = Query(57),
) -> list[dict]:
    """Return safety car probability for each lap of a race."""
    sc_artifact = _get_safety_car_model()
    if sc_artifact is None:
        raise HTTPException(
            status_code=503,
            detail="Safety car model not trained yet. Run: make strategy-train",
        )

    pipeline = sc_artifact["pipeline"]
    feature_cols = sc_artifact["feature_cols"]

    rows = []
    for lap in range(1, total_laps + 1):
        row = {"LapNumber": lap, "GP": track}
        rows.append(row)

    pred_df = pd.DataFrame(rows)
    usable_cols = [c for c in feature_cols if c in pred_df.columns]

    try:
        probs = pipeline.predict_proba(pred_df[usable_cols])[:, 1]
    except Exception:
        probs = np.full(total_laps, 0.05)

    return [
        {"lap": int(lap + 1), "probability": round(float(p), 4)}
        for lap, p in enumerate(probs)
    ]


if __name__ == "__main__":
    _local_dev()

