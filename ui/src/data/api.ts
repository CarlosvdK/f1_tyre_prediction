import predictionsData from './mock/predictions.json';
import telemetryMonza from './mock/telemetry_monza.json';
import telemetrySilverstone from './mock/telemetry_silverstone.json';
import tracksData from './mock/tracks.json';
import { getCircuitOutline, resolveCircuitKey } from './circuitCoords';
import { fetchTrack3D } from './openf1';

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
const openF1Cache = new Map<string, TelemetryPoint[]>();
const openF1Unavailable = new Set<string>();

const DEFAULT_DRIVERS = [
  'VER', 'PER', 'NOR', 'PIA', 'LEC', 'SAI', 'HAM', 'RUS', 'ALO', 'STR',
  'GAS', 'OCO', 'ALB', 'TSU', 'RIC', 'HUL', 'MAG', 'BOT', 'ZHO', 'SAR',
];

interface SeasonTrackDefinition {
  id: string;
  name: string;
  totalLaps: number;
}

const CURRENT_SEASON_TRACKS: SeasonTrackDefinition[] = [
  { id: 'bahrain', name: 'Bahrain GP', totalLaps: 57 },
  { id: 'jeddah', name: 'Saudi Arabian GP', totalLaps: 50 },
  { id: 'melbourne', name: 'Australian GP', totalLaps: 58 },
  { id: 'suzuka', name: 'Japanese GP', totalLaps: 53 },
  { id: 'shanghai', name: 'Chinese GP', totalLaps: 56 },
  { id: 'miami', name: 'Miami GP', totalLaps: 57 },
  { id: 'imola', name: 'Emilia Romagna GP', totalLaps: 63 },
  { id: 'monaco', name: 'Monaco GP', totalLaps: 78 },
  { id: 'canada', name: 'Canadian GP', totalLaps: 70 },
  { id: 'barcelona', name: 'Spanish GP', totalLaps: 66 },
  { id: 'austria', name: 'Austrian GP', totalLaps: 71 },
  { id: 'silverstone', name: 'British GP', totalLaps: 52 },
  { id: 'hungaroring', name: 'Hungarian GP', totalLaps: 70 },
  { id: 'spa', name: 'Belgian GP', totalLaps: 44 },
  { id: 'zandvoort', name: 'Dutch GP', totalLaps: 72 },
  { id: 'monza', name: 'Italian GP', totalLaps: 53 },
  { id: 'baku', name: 'Azerbaijan GP', totalLaps: 51 },
  { id: 'singapore', name: 'Singapore GP', totalLaps: 62 },
  { id: 'austin', name: 'United States GP', totalLaps: 56 },
  { id: 'mexico', name: 'Mexico City GP', totalLaps: 71 },
  { id: 'brazil', name: 'Sao Paulo GP', totalLaps: 71 },
  { id: 'las-vegas', name: 'Las Vegas GP', totalLaps: 50 },
  { id: 'qatar', name: 'Qatar GP', totalLaps: 57 },
  { id: 'abu-dhabi', name: 'Abu Dhabi GP', totalLaps: 58 },
];

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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatTimeDelta(seconds: number): string {
  if (Math.abs(seconds) < 60) return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(1)}s`;
  const total = Math.abs(seconds);
  const minutes = Math.floor(total / 60);
  const rem = Math.floor(total % 60);
  return `${seconds >= 0 ? '+' : '-'}${minutes}:${String(rem).padStart(2, '0')}`;
}

function getSeasonTrack(trackId: string): SeasonTrackDefinition | undefined {
  const key = trackId.toLowerCase().trim();
  return CURRENT_SEASON_TRACKS.find((track) => track.id === key);
}

function defaultLapCount(trackId: string): number {
  return getSeasonTrack(trackId)?.totalLaps ?? 58;
}

function toOutline(trackId: string): XYPoint[] {
  const coords = getCircuitOutline(trackId);
  return coords.map(([x, y]) => ({
    x: Number((x * 34).toFixed(3)),
    y: Number((y * 34).toFixed(3)),
  }));
}

function makeSeasonTracks(): Track[] {
  return CURRENT_SEASON_TRACKS.map((track) => ({
    id: track.id,
    name: track.name,
    outline: toOutline(track.id),
  }));
}

function keyToDisplayName(key: string): string {
  const known = getSeasonTrack(key);
  if (known) return known.name;
  return key
    .split('-')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function mergeTracks(primary: Track[], secondary: Track[]): Track[] {
  const byId = new Map<string, Track>();
  [...primary, ...secondary].forEach((track) => {
    if (!track?.id) return;
    const key = resolveCircuitKey(String(track.id), track.name);
    const previous = byId.get(key);
    const preferredName = getSeasonTrack(key)?.name
      ?? previous?.name
      ?? track.name
      ?? keyToDisplayName(key);
    byId.set(key, {
      id: key,
      name: preferredName,
      // Never trust backend-generated pseudo outlines for map geometry.
      outline: toOutline(key),
    });
  });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function makeSyntheticTelemetry(track: string, driver: string, lap: number): TelemetryPoint[] {
  const coords = getCircuitOutline(track);
  if (coords.length === 0) return [];

  const seed = hashString(`${track}|${driver}`);
  const lapFactor = Math.max(0, (lap - 1) / Math.max(defaultLapCount(track), 1));
  const driverBias = ((seed % 31) - 15) / 250;
  const wavePhase = (seed % 360) * (Math.PI / 180);
  const totalPoints = coords.length;

  return coords.map(([px, py]: [number, number], idx: number) => {
    const t = idx / Math.max(totalPoints - 1, 1);
    const wave = Math.sin((t * Math.PI * 6) + wavePhase);

    // Synthetic speed/brake based on curvature approximation
    const prev = coords[(idx - 1 + totalPoints) % totalPoints];
    const next = coords[(idx + 1) % totalPoints];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const prev2 = coords[(idx - 2 + totalPoints) % totalPoints];
    const next2 = coords[(idx + 2) % totalPoints];
    const dx2 = next2[0] - prev2[0];
    const dy2 = next2[1] - prev2[1];
    const cross = Math.abs(dx * dy2 - dy * dx2);
    const curvature = Math.min(1, cross * 40);
    const isBraking = curvature > 0.3;

    const baseSpeed = isBraking ? 100 + (1 - curvature) * 120 : 250 + (1 - curvature) * 80;
    const speed = clamp(baseSpeed * (1 - lapFactor * 0.08) + wave * 8 + driverBias * 14, 70, 340);
    const brake = clamp((isBraking ? 0.6 + curvature * 0.3 : 0.05) + lapFactor * 0.14 + Math.max(0, -wave) * 0.06, 0, 1);
    const throttle = clamp((isBraking ? 0.3 : 0.92) - lapFactor * 0.11 + Math.max(0, wave) * 0.07, 0.05, 1);

    return {
      x: Number((px * 34).toFixed(3)),
      y: Number((py * 34).toFixed(3)),
      speed: Number(speed.toFixed(3)),
      brake: Number(brake.toFixed(3)),
      throttle: Number(throttle.toFixed(3)),
    };
  });
}

function modulateTelemetry(
  base: TelemetryPoint[],
  track: string,
  driver: string,
  lap: number,
): TelemetryPoint[] {
  if (base.length === 0) return base;
  const seed = hashString(`${track}|${driver}`);
  const lapFactor = Math.max(0, (lap - 1) / Math.max(defaultLapCount(track), 1));
  const paceDrop = 1 - (lapFactor * (0.06 + (seed % 4) * 0.006));
  const brakeLift = lapFactor * 0.12;
  const throttleDrop = lapFactor * 0.08;

  return base.map((point, idx) => {
    const localWave = Math.sin((idx / Math.max(base.length, 1)) * Math.PI * 5 + (seed % 17));
    const speed = clamp((point.speed * paceDrop) + localWave * 4, 65, 360);
    const brake = clamp(point.brake + brakeLift + Math.max(0, -localWave) * 0.03, 0, 1);
    const throttle = clamp(point.throttle - throttleDrop + Math.max(0, localWave) * 0.03, 0.04, 1);
    return {
      x: point.x,
      y: point.y,
      speed: Number(speed.toFixed(3)),
      brake: Number(brake.toFixed(3)),
      throttle: Number(throttle.toFixed(3)),
    };
  });
}

async function getOpenF1Telemetry(
  track: string,
  driver: string,
  lap: number,
): Promise<TelemetryPoint[] | null> {
  const key = resolveCircuitKey(track);
  if (openF1Unavailable.has(key)) return null;
  let base = openF1Cache.get(key);
  if (!base) {
    try {
      const rows = await fetchTrack3D(key);
      base = rows.map((point) => ({
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
        speed: Number(point.speed.toFixed(3)),
        brake: point.brake ? 1 : 0,
        throttle: Number((point.throttle / 100).toFixed(3)),
      }));
      if (base.length > 40) {
        openF1Cache.set(key, base);
      } else {
        openF1Unavailable.add(key);
        return null;
      }
    } catch {
      openF1Unavailable.add(key);
      return null;
    }
  }

  return modulateTelemetry(base, track, driver, lap);
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return (await response.json()) as T;
}

function getMockTelemetry(track: string): TelemetryData {
  const telemetry = telemetryByTrack[track.toLowerCase()];
  if (!telemetry) {
    throw new Error(`No telemetry for track ${track}`);
  }
  return telemetry;
}

function getMockPrediction(track: string, driver: string, lap: number): Prediction {
  const driverRows = predictionsByTrack[track]?.[driver];
  if (!driverRows) {
    const seed = hashString(`${track}|${driver}`);
    const totalLaps = defaultLapCount(track);
    const raceProgress = clamp(lap / Math.max(totalLaps, 1), 0, 1);
    const optimalPitBase = Math.round(totalLaps * (0.42 + ((seed % 13) - 6) * 0.008));
    const strategyOptimalPit = clamp(
      Math.max(lap + 2, optimalPitBase),
      6,
      Math.max(8, totalLaps - 5),
    );
    const stint1 = strategyOptimalPit;
    const stint2 = Math.max(1, totalLaps - strategyOptimalPit);
    const compoundRotation: Compound[] = ['soft', 'medium', 'hard'];
    const stint1Compound = compoundRotation[seed % compoundRotation.length];
    const stint2Compound = compoundRotation[(seed + 1) % compoundRotation.length];
    const timeSaved = 8 + (seed % 11) - raceProgress * 4;

    return {
      sec_per_lap_increase: Number((0.09 + raceProgress * 0.2 + ((seed % 9) / 100)).toFixed(3)),
      pit_window_start: Math.max(lap + 1, strategyOptimalPit - 2),
      pit_window_end: Math.min(totalLaps - 1, strategyOptimalPit + 2),
      tyre_life_pct: Number(clamp(96 - raceProgress * 108 - (seed % 8), 3, 100).toFixed(1)),
      wear_FL: Number(clamp(0.24 + raceProgress * 0.62 + ((seed % 5) * 0.01), 0, 1).toFixed(3)),
      wear_FR: Number(clamp(0.27 + raceProgress * 0.64 + ((seed % 6) * 0.01), 0, 1).toFixed(3)),
      wear_RL: Number(clamp(0.2 + raceProgress * 0.55 + ((seed % 4) * 0.01), 0, 1).toFixed(3)),
      wear_RR: Number(clamp(0.22 + raceProgress * 0.57 + ((seed % 3) * 0.01), 0, 1).toFixed(3)),
      strategy_optimal_pit_lap: strategyOptimalPit,
      strategy_time_saved: Number(timeSaved.toFixed(1)),
      strategy_type: '1-stop',
      strategy_time_saved_fmt: formatTimeDelta(timeSaved),
      strategy_stint1_laps: stint1,
      strategy_stint2_laps: stint2,
      strategy_stint1_compound: stint1Compound,
      strategy_stint2_compound: stint2Compound,
    };
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

  const totalLaps = Math.max(
    8,
    (base.strategy_stint1_laps ?? 0) + (base.strategy_stint2_laps ?? 0),
  );
  const pitShift = Math.round(deltaLife / 14);
  const optimalPit = clamp(
    (base.strategy_optimal_pit_lap ?? Math.round(totalLaps * 0.48)) - pitShift,
    4,
    Math.max(6, totalLaps - 3),
  );
  const strategyTimeSaved = (base.strategy_time_saved ?? 12.5) - deltaPace * 18;

  return {
    sec_per_lap_increase: Number((base.sec_per_lap_increase + deltaPace).toFixed(3)),
    pit_window_start: Math.max(1, Math.round(base.pit_window_start - deltaLife / 10)),
    pit_window_end: Math.max(2, Math.round(base.pit_window_end - deltaLife / 9)),
    tyre_life_pct: Number(clamp(base.tyre_life_pct + deltaLife, 0, 100).toFixed(1)),
    wear_FL: Number(clamp(base.wear_FL + deltaWear, 0, 1).toFixed(3)),
    wear_FR: Number(clamp(base.wear_FR + deltaWear, 0, 1).toFixed(3)),
    wear_RL: Number(clamp(base.wear_RL + deltaWear, 0, 1).toFixed(3)),
    wear_RR: Number(clamp(base.wear_RR + deltaWear, 0, 1).toFixed(3)),
    strategy_optimal_pit_lap: optimalPit,
    strategy_time_saved: Number(strategyTimeSaved.toFixed(1)),
    strategy_time_saved_fmt: formatTimeDelta(strategyTimeSaved),
    strategy_stint1_laps: optimalPit,
    strategy_stint2_laps: Math.max(1, totalLaps - optimalPit),
    strategy_stint1_compound: compound,
    strategy_stint2_compound: base.strategy_stint2_compound ?? (compound === 'hard' ? 'medium' : 'hard'),
  };
}

export async function listTracks(): Promise<Track[]> {
  if (USE_BACKEND) {
    try {
      const backendTracks = await fetchJson<Track[]>('/api/tracks');
      return mergeTracks(backendTracks, makeSeasonTracks());
    } catch {
      return mergeTracks(makeSeasonTracks(), tracks);
    }
  }
  return mergeTracks(makeSeasonTracks(), tracks);
}

export async function listDrivers(track: string): Promise<string[]> {
  if (USE_BACKEND) {
    try {
      const backendDrivers = await fetchJson<string[]>(`/api/drivers?track=${encodeURIComponent(track)}`);
      if (backendDrivers.length > 0) return backendDrivers;
    } catch {
      // Fall through to mock/synthetic fallback for tracks outside backend coverage.
    }
  }

  try {
    const fromMock = Object.keys(getMockTelemetry(track));
    if (fromMock.length > 0) return fromMock;
  } catch {
    // No mock data for this track.
  }
  return DEFAULT_DRIVERS;
}

export async function listLaps(track: string, driver: string): Promise<number[]> {
  if (USE_BACKEND) {
    try {
      const backendLaps = await fetchJson<number[]>(
        `/api/laps?track=${encodeURIComponent(track)}&driver=${encodeURIComponent(driver)}`,
      );
      if (backendLaps.length > 0) return backendLaps;
    } catch {
      // Fall through to mock/synthetic fallback for tracks outside backend coverage.
    }
  }

  try {
    const laps = Object.keys(getMockTelemetry(track)?.[driver] ?? {}).map(Number);
    if (laps.length > 0) return laps.sort((a, b) => a - b);
  } catch {
    // No mock data for this track.
  }

  const n = defaultLapCount(track);
  return Array.from({ length: n }, (_, index) => index + 1);
}

export async function getTelemetry(
  track: string,
  driver: string,
  lap: number,
): Promise<TelemetryPoint[]> {
  const openF1 = await getOpenF1Telemetry(track, driver, lap);
  if (openF1 && openF1.length > 0) {
    return openF1;
  }

  return makeSyntheticTelemetry(resolveCircuitKey(track), driver, lap);
}

export interface StrategyOption {
  strategy: string[];
  strategy_str: string;
  pit_laps: number[];
  total_time: number;
  total_time_formatted: string;
  stint_times: number[];
  pit_costs: number[];
  warnings: string[];
}

export interface StrategyResult {
  circuit: string;
  driver: string;
  total_laps: number;
  mode: string;
  best_strategy: StrategyOption | null;
  all_strategies: StrategyOption[];
  n_strategies_evaluated: number;
}

export async function reoptimizeStrategy(params: {
  track: string;
  driver: string;
  totalLaps: number;
  currentLap: number;
  currentCompound: Compound;
  currentTyreLife: number;
  pitsDone: number;
  compoundsUsed: string[];
  safetyCar: boolean;
}): Promise<StrategyResult> {
  if (USE_BACKEND) {
    try {
      const q = new URLSearchParams({
        track: params.track,
        driver: params.driver,
        total_laps: String(params.totalLaps),
        current_lap: String(params.currentLap),
        current_compound: params.currentCompound,
        current_tyre_life: String(params.currentTyreLife),
        pits_done: String(params.pitsDone),
        compounds_used: params.compoundsUsed.join(','),
        safety_car: String(params.safetyCar),
      });
      return await fetchJson<StrategyResult>(`/api/strategy/reoptimize?${q}`);
    } catch {
      // Fall through to mock/synthetic fallback for tracks outside backend coverage.
    }
  }

  // Mock fallback
  const pitLap = params.safetyCar
    ? params.currentLap + 1
    : Math.max(params.currentLap + 5, Math.floor(params.totalLaps * 0.55));
  const nextCompound = params.currentCompound === 'hard' ? 'medium' : 'hard';
  return {
    circuit: params.track,
    driver: params.driver,
    total_laps: params.totalLaps,
    mode: params.safetyCar ? 'safety_car_reopt' : 'mid_race_reopt',
    best_strategy: {
      strategy: [params.currentCompound.toUpperCase(), nextCompound.toUpperCase()],
      strategy_str: `${params.currentCompound.toUpperCase()}-${nextCompound.toUpperCase()}`,
      pit_laps: [pitLap],
      total_time: 5400,
      total_time_formatted: '1:30:00.000',
      stint_times: [2700, 2700],
      pit_costs: [25],
      warnings: [],
    },
    all_strategies: [],
    n_strategies_evaluated: 1,
  };
}

export async function getPredictions(
  track: string,
  driver: string,
  lap: number,
  compound: Compound,
  conditions: TrackCondition,
): Promise<Prediction> {
  if (USE_BACKEND) {
    try {
      return await fetchJson<Prediction>(
        `/api/predictions?track=${encodeURIComponent(track)}&driver=${encodeURIComponent(driver)}&lap=${lap}&compound=${compound}&conditions=${conditions}`,
      );
    } catch {
      // Fall through to mock/synthetic fallback for tracks outside backend coverage.
    }
  }

  const base = getMockPrediction(track, driver, lap);
  return adjustPrediction(base, compound, conditions);
}
