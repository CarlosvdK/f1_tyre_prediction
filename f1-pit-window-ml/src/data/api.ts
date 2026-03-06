import predictionsData from './mock/predictions.json';
import telemetryMonza from './mock/telemetry_monza.json';
import telemetrySilverstone from './mock/telemetry_silverstone.json';
import tracksData from './mock/tracks.json';

export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
export type TrackCondition = 'dry' | 'hot' | 'cool' | 'damp' | 'wet';
export type FeatureKey =
  | 'braking_earlier_delta'
  | 'lower_corner_speed_delta'
  | 'throttle_delay_delta'
  | 'degradation_intensity_proxy';

export interface XYPoint {
  x: number;
  y: number;
}

export interface TelemetryPoint extends XYPoint {
  speed: number;
  brake: number;
  throttle: number;
}

export interface Track {
  id: string;
  name: string;
  outline: XYPoint[];
}

export interface Prediction {
  sec_per_lap_increase: number;
  pit_window_start: number;
  pit_window_end: number;
  tyre_life_pct: number;
  wear_FL: number;
  wear_FR: number;
  wear_RL: number;
  wear_RR: number;
  strategy_optimal_pit_lap?: number;
  strategy_time_saved?: number;
  strategy_type?: string;
  strategy_time_saved_fmt?: string;
  strategy_stint1_laps?: number;
  strategy_stint2_laps?: number;
  strategy_stint1_compound?: Compound;
  strategy_stint2_compound?: Compound;
}

interface TelemetryData {
  [driver: string]: {
    [lap: string]: TelemetryPoint[];
  };
}

interface PredictionsData {
  [track: string]: {
    [driver: string]: {
      [lap: string]: Prediction;
    };
  };
}

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND !== 'false';

const telemetryByTrack: Record<string, TelemetryData> = {
  monza: telemetryMonza as TelemetryData,
  silverstone: telemetrySilverstone as TelemetryData,
};

const predictionsByTrack = predictionsData as PredictionsData;
const tracks = tracksData as Track[];

const compoundModifiers: Record<Compound, { pace: number; life: number; wear: number }> = {
  soft: { pace: 0.05, life: -10, wear: 0.08 },
  medium: { pace: 0, life: 0, wear: 0 },
  hard: { pace: -0.015, life: 8, wear: -0.05 },
  inter: { pace: 0.09, life: -6, wear: 0.06 },
  wet: { pace: 0.13, life: -8, wear: 0.07 },
};

const conditionModifiers: Record<TrackCondition, { pace: number; life: number; wear: number }> = {
  dry: { pace: 0, life: 0, wear: 0 },
  hot: { pace: 0.03, life: -8, wear: 0.07 },
  cool: { pace: -0.02, life: 6, wear: -0.04 },
  damp: { pace: 0.06, life: -4, wear: 0.03 },
  wet: { pace: 0.12, life: -12, wear: 0.09 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return (await response.json()) as T;
}

function getMockTelemetry(track: string): TelemetryData {
  const telemetry = telemetryByTrack[track];
  if (!telemetry) {
    throw new Error(`No telemetry for track ${track}`);
  }
  return telemetry;
}

function getMockPrediction(track: string, driver: string, lap: number): Prediction {
  const driverRows = predictionsByTrack[track]?.[driver];
  if (!driverRows) {
    throw new Error(`No predictions for ${track}/${driver}`);
  }

  const lapKey = String(lap);
  if (driverRows[lapKey]) {
    return driverRows[lapKey];
  }

  const closestLap = Object.keys(driverRows)
    .map(Number)
    .sort((a, b) => Math.abs(a - lap) - Math.abs(b - lap))[0];

  return driverRows[String(closestLap)];
}

function adjustPrediction(
  base: Prediction,
  compound: Compound,
  conditions: TrackCondition,
): Prediction {
  const c = compoundModifiers[compound];
  const t = conditionModifiers[conditions];
  const deltaPace = c.pace + t.pace;
  const deltaLife = c.life + t.life;
  const deltaWear = c.wear + t.wear;

  return {
    sec_per_lap_increase: Number((base.sec_per_lap_increase + deltaPace).toFixed(3)),
    pit_window_start: Math.max(1, Math.round(base.pit_window_start - deltaLife / 10)),
    pit_window_end: Math.max(2, Math.round(base.pit_window_end - deltaLife / 9)),
    tyre_life_pct: Number(clamp(base.tyre_life_pct + deltaLife, 0, 100).toFixed(1)),
    wear_FL: Number(clamp(base.wear_FL + deltaWear, 0, 1).toFixed(3)),
    wear_FR: Number(clamp(base.wear_FR + deltaWear, 0, 1).toFixed(3)),
    wear_RL: Number(clamp(base.wear_RL + deltaWear, 0, 1).toFixed(3)),
    wear_RR: Number(clamp(base.wear_RR + deltaWear, 0, 1).toFixed(3)),
    strategy_optimal_pit_lap: 25,
    strategy_time_saved_fmt: "-12.5s",
    strategy_stint1_laps: 25,
    strategy_stint2_laps: 28,
    strategy_stint1_compound: compound,
    strategy_stint2_compound: compound === 'hard' ? 'medium' : 'hard',
  };
}

export async function listTracks(): Promise<Track[]> {
  if (USE_BACKEND) {
    return fetchJson<Track[]>('/api/tracks');
  }
  return tracks;
}

export async function listDrivers(track: string): Promise<string[]> {
  if (USE_BACKEND) {
    return fetchJson<string[]>(`/api/drivers?track=${encodeURIComponent(track)}`);
  }

  return Object.keys(getMockTelemetry(track));
}

export async function listLaps(track: string, driver: string): Promise<number[]> {
  if (USE_BACKEND) {
    return fetchJson<number[]>(
      `/api/laps?track=${encodeURIComponent(track)}&driver=${encodeURIComponent(driver)}`,
    );
  }

  const laps = Object.keys(getMockTelemetry(track)?.[driver] ?? {}).map(Number);
  return laps.sort((a, b) => a - b);
}

export async function getTelemetry(
  track: string,
  driver: string,
  lap: number,
): Promise<TelemetryPoint[]> {
  if (USE_BACKEND) {
    return fetchJson<TelemetryPoint[]>(
      `/api/telemetry?track=${encodeURIComponent(track)}&driver=${encodeURIComponent(driver)}&lap=${lap}`,
    );
  }

  const driverTelemetry = getMockTelemetry(track)[driver];
  const lapData = driverTelemetry?.[String(lap)];
  if (lapData) {
    return lapData;
  }

  const closestLap = Object.keys(driverTelemetry)
    .map(Number)
    .sort((a, b) => Math.abs(a - lap) - Math.abs(b - lap))[0];

  return driverTelemetry[String(closestLap)] ?? [];
}

export async function getPredictions(
  track: string,
  driver: string,
  lap: number,
  compound: Compound,
  conditions: TrackCondition,
): Promise<Prediction> {
  if (USE_BACKEND) {
    return fetchJson<Prediction>(
      `/api/predictions?track=${encodeURIComponent(track)}&driver=${encodeURIComponent(driver)}&lap=${lap}&compound=${compound}&conditions=${conditions}`,
    );
  }

  const base = getMockPrediction(track, driver, lap);
  return adjustPrediction(base, compound, conditions);
}
