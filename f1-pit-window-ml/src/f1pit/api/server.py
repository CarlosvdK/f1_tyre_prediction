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
        track_rows[track_id] = {
            "id": track_id,
            "name": name,
            "outline": _generate_track_outline(circuit_id),
            "race_id": race_id,
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
) -> dict[str, float | int]:
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

    compound_mod = {
        "soft": (0.055, -10.0, 0.09),
        "medium": (0.0, 0.0, 0.0),
        "hard": (-0.018, 9.0, -0.05),
        "inter": (0.09, -7.0, 0.06),
        "wet": (0.13, -11.0, 0.08),
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
    d_pace, d_life, d_wear = cp[0] + cd[0], cp[1] + cd[1], cp[2] + cd[2]

    tyre_life_pct = float(np.clip(tyre_life_pct + d_life, 0.0, 100.0))
    wear_base = float(np.clip(wear_base + d_wear, 0.0, 1.0))

    return {
        "sec_per_lap_increase": float(np.clip(sec_per_lap_increase + d_pace, 0.01, 2.2)),
        "pit_window_start": int(max(1, pit_window_start - int(round(d_life / 10.0)))),
        "pit_window_end": int(max(2, pit_window_end - int(round(d_life / 9.0)))),
        "tyre_life_pct": float(tyre_life_pct),
        "wear_FL": float(np.clip(wear_base + 0.08, 0.0, 1.0)),
        "wear_FR": float(np.clip(wear_base + 0.10, 0.0, 1.0)),
        "wear_RL": float(np.clip(wear_base - 0.03, 0.0, 1.0)),
        "wear_RR": float(np.clip(wear_base - 0.01, 0.0, 1.0)),
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
) -> dict[str, float | int]:
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


if __name__ == "__main__":
    _local_dev()
