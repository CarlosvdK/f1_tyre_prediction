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

/** Maps driver abbreviation → team name (2024 season). */
export const DRIVER_TEAM_MAP: Record<string, string> = {
  VER: 'Red Bull Racing', PER: 'Red Bull Racing',
  NOR: 'McLaren', PIA: 'McLaren',
  LEC: 'Ferrari', SAI: 'Ferrari',
  HAM: 'Mercedes', RUS: 'Mercedes',
  ALO: 'Aston Martin', STR: 'Aston Martin',
  GAS: 'Alpine', OCO: 'Alpine',
  ALB: 'Williams', SAR: 'Williams',
  TSU: 'RB', RIC: 'RB',
  HUL: 'Haas F1 Team', MAG: 'Haas F1 Team',
  BOT: 'Kick Sauber', ZHO: 'Kick Sauber',
};

interface SeasonTrackDefinition {
  id: string;
  name: string;
  totalLaps: number;
  /** GP name as it appears in DryQuickLaps.csv (training data) */
  gpName: string;
}

const CURRENT_SEASON_TRACKS: SeasonTrackDefinition[] = [
  { id: 'bahrain', name: 'Bahrain GP', totalLaps: 57, gpName: 'Bahrain Grand Prix' },
  { id: 'jeddah', name: 'Saudi Arabian GP', totalLaps: 50, gpName: 'Saudi Arabian Grand Prix' },
  { id: 'melbourne', name: 'Australian GP', totalLaps: 58, gpName: 'Australian Grand Prix' },
  { id: 'suzuka', name: 'Japanese GP', totalLaps: 53, gpName: 'Japanese Grand Prix' },
  { id: 'shanghai', name: 'Chinese GP', totalLaps: 56, gpName: 'Chinese Grand Prix' },
  { id: 'miami', name: 'Miami GP', totalLaps: 57, gpName: 'Miami Grand Prix' },
  { id: 'imola', name: 'Emilia Romagna GP', totalLaps: 63, gpName: 'Emilia Romagna Grand Prix' },
  { id: 'monaco', name: 'Monaco GP', totalLaps: 78, gpName: 'Monaco Grand Prix' },
  { id: 'canada', name: 'Canadian GP', totalLaps: 70, gpName: 'Canadian Grand Prix' },
  { id: 'barcelona', name: 'Spanish GP', totalLaps: 66, gpName: 'Spanish Grand Prix' },
  { id: 'austria', name: 'Austrian GP', totalLaps: 71, gpName: 'Austrian Grand Prix' },
  { id: 'silverstone', name: 'British GP', totalLaps: 52, gpName: 'British Grand Prix' },
  { id: 'hungaroring', name: 'Hungarian GP', totalLaps: 70, gpName: 'Hungarian Grand Prix' },
  { id: 'spa', name: 'Belgian GP', totalLaps: 44, gpName: 'Belgian Grand Prix' },
  { id: 'zandvoort', name: 'Dutch GP', totalLaps: 72, gpName: 'Dutch Grand Prix' },
  { id: 'monza', name: 'Italian GP', totalLaps: 53, gpName: 'Italian Grand Prix' },
  { id: 'baku', name: 'Azerbaijan GP', totalLaps: 51, gpName: 'Azerbaijan Grand Prix' },
  { id: 'singapore', name: 'Singapore GP', totalLaps: 62, gpName: 'Singapore Grand Prix' },
  { id: 'austin', name: 'United States GP', totalLaps: 56, gpName: 'United States Grand Prix' },
  { id: 'mexico', name: 'Mexico City GP', totalLaps: 71, gpName: 'Mexico City Grand Prix' },
  { id: 'brazil', name: 'Sao Paulo GP', totalLaps: 71, gpName: 'São Paulo Grand Prix' },
  { id: 'las-vegas', name: 'Las Vegas GP', totalLaps: 50, gpName: 'Las Vegas Grand Prix' },
  { id: 'qatar', name: 'Qatar GP', totalLaps: 57, gpName: 'Qatar Grand Prix' },
  { id: 'abu-dhabi', name: 'Abu Dhabi GP', totalLaps: 58, gpName: 'Abu Dhabi Grand Prix' },
];

/* ── Display-only constants (colors for rendering, not model data) ──── */
export const COMPOUND_COLORS: Record<string, string> = {
  soft: '#e10600',   SOFT: '#e10600',
  medium: '#ffd400', MEDIUM: '#ffd400',
  hard: '#f5f5f7',   HARD: '#f5f5f7',
  inter: '#00a442',  INTER: '#00a442',
  wet: '#0077c8',    WET: '#0077c8',
};
export const COMPOUND_COLORS_DIM: Record<string, string> = {
  soft: 'rgba(225,6,0,0.55)',   SOFT: 'rgba(225,6,0,0.55)',
  medium: 'rgba(255,212,0,0.55)', MEDIUM: 'rgba(255,212,0,0.55)',
  hard: 'rgba(245,245,247,0.55)', HARD: 'rgba(245,245,247,0.55)',
  inter: 'rgba(0,164,66,0.55)', INTER: 'rgba(0,164,66,0.55)',
  wet: 'rgba(0,119,200,0.55)',  WET: 'rgba(0,119,200,0.55)',
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

function getSeasonTrack(trackId: string): SeasonTrackDefinition | undefined {
  const key = trackId.toLowerCase().trim();
  return CURRENT_SEASON_TRACKS.find((track) => track.id === key);
}

export function defaultLapCount(trackId: string): number {
  return getSeasonTrack(trackId)?.totalLaps ?? 58;
}

/** Get the GP name (as used in training data) for a frontend track ID. */
export function trackToGpName(trackId: string): string {
  return getSeasonTrack(trackId)?.gpName ?? trackId;
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
      outline: toOutline(key),
    });
  });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Compute tyre wear factor (0 = fresh, ~1 = end of stint) based on
 *  current lap and pit stop schedule. Resets to 0 after each pit stop. */
function tyreWearFactor(lap: number, totalLaps: number, pitLaps: number[]): number {
  // Find which stint the current lap is in
  const stops = [0, ...pitLaps, totalLaps];
  for (let i = 0; i < stops.length - 1; i++) {
    if (lap <= stops[i + 1]) {
      const stintStart = stops[i];
      const stintEnd = stops[i + 1];
      const stintLen = Math.max(stintEnd - stintStart, 1);
      return Math.max(0, (lap - stintStart - 1) / stintLen);
    }
  }
  return 0.5;
}

function makeSyntheticTelemetry(track: string, driver: string, lap: number, pitLaps: number[] = []): TelemetryPoint[] {
  const coords = getCircuitOutline(track);
  if (coords.length === 0) return [];

  const seed = hashString(`${track}|${driver}`);
  const totalLaps = defaultLapCount(track);
  // Use tyre wear within the current stint, not overall race progress.
  // This means after a pit stop the car brakes later and accelerates harder.
  const lapFactor = tyreWearFactor(lap, totalLaps, pitLaps);
  const driverBias = ((seed % 31) - 15) / 250;
  const wavePhase = (seed % 360) * (Math.PI / 180);
  const totalPoints = coords.length;

  return coords.map(([px, py]: [number, number], idx: number) => {
    const t = idx / Math.max(totalPoints - 1, 1);
    const wave = Math.sin((t * Math.PI * 6) + wavePhase);

    const prev = coords[(idx - 1 + totalPoints) % totalPoints];
    const next = coords[(idx + 1) % totalPoints];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const prev2 = coords[(idx - 2 + totalPoints) % totalPoints];
    const next2 = coords[(idx + 2) % totalPoints];
    const dx2 = next2[0] - prev2[0];
    const dy2 = next2[1] - prev2[1];
    const cross = Math.abs(dx * dy2 - dy * dx2);
    const segLen = Math.max(Math.hypot(dx, dy), 1e-6);
    const curvature = Math.min(1, (cross / (segLen * segLen)) * 2);
    const isBraking = curvature > 0.4;

    const baseSpeed = isBraking ? 100 + (1 - curvature) * 120 : 250 + (1 - curvature) * 80;
    const speed = clamp(baseSpeed * (1 - lapFactor * 0.08) + wave * 8 + driverBias * 14, 70, 340);
    // Only add brake where curvature indicates a corner — don't add brake on straights
    const brake = isBraking ? clamp(0.6 + curvature * 0.3 + lapFactor * 0.14, 0, 1) : 0;
    const throttle = isBraking ? 0 : clamp(0.92 - lapFactor * 0.11, 0, 1);

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
  pitLaps: number[] = [],
): TelemetryPoint[] {
  if (base.length === 0) return base;
  const seed = hashString(`${track}|${driver}`);
  const lapFactor = tyreWearFactor(lap, defaultLapCount(track), pitLaps);
  const paceDrop = 1 - (lapFactor * (0.06 + (seed % 4) * 0.006));
  const brakeLift = lapFactor * 0.12;
  const throttleDrop = lapFactor * 0.08;

  return base.map((point, idx) => {
    const localWave = Math.sin((idx / Math.max(base.length, 1)) * Math.PI * 5 + (seed % 17));
    const speed = clamp((point.speed * paceDrop) + localWave * 4, 65, 360);
    // Only add brake where the base data already has braking (before corners).
    // Don't add brake noise to non-braking points — that creates fake brake zones.
    const isBraking = point.brake > 0.3;
    const brake = isBraking ? clamp(point.brake + brakeLift, 0, 1) : 0;
    const throttle = isBraking ? 0 : clamp(point.throttle - throttleDrop, 0, 1);
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
  pitLaps: number[] = [],
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

  return modulateTelemetry(base, track, driver, lap, pitLaps);
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

    return {
      sec_per_lap_increase: Number((0.09 + raceProgress * 0.2 + ((seed % 9) / 100)).toFixed(3)),
      pit_window_start: Math.max(lap + 1, Math.floor(totalLaps / 2) - 2),
      pit_window_end: Math.min(totalLaps - 1, Math.floor(totalLaps / 2) + 2),
      tyre_life_pct: Number(clamp(96 - raceProgress * 108 - (seed % 8), 3, 100).toFixed(1)),
      wear_FL: Number(clamp(0.24 + raceProgress * 0.62 + ((seed % 5) * 0.01), 0, 1).toFixed(3)),
      wear_FR: Number(clamp(0.27 + raceProgress * 0.64 + ((seed % 6) * 0.01), 0, 1).toFixed(3)),
      wear_RL: Number(clamp(0.2 + raceProgress * 0.55 + ((seed % 4) * 0.01), 0, 1).toFixed(3)),
      wear_RR: Number(clamp(0.22 + raceProgress * 0.57 + ((seed % 3) * 0.01), 0, 1).toFixed(3)),
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
      // Fall through
    }
  }

  try {
    const fromMock = Object.keys(getMockTelemetry(track));
    if (fromMock.length > 0) return fromMock;
  } catch {
    // No mock data
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
      // Fall through
    }
  }

  try {
    const laps = Object.keys(getMockTelemetry(track)?.[driver] ?? {}).map(Number);
    if (laps.length > 0) return laps.sort((a, b) => a - b);
  } catch {
    // No mock data
  }

  const n = defaultLapCount(track);
  return Array.from({ length: n }, (_, index) => index + 1);
}

export async function getTelemetry(
  track: string,
  driver: string,
  lap: number,
  pitLaps: number[] = [],
): Promise<TelemetryPoint[]> {
  const openF1 = await getOpenF1Telemetry(track, driver, lap, pitLaps);
  if (openF1 && openF1.length > 0) {
    return openF1;
  }

  return makeSyntheticTelemetry(resolveCircuitKey(track), driver, lap, pitLaps);
}

/* ── Strategy types (match backend StrategyOptimizer response) ──── */

export interface LapTimePrediction {
  lap: number;
  time: number;
  compound: string;
  stint: number;
  tyre_life: number;
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
  lap_times?: LapTimePrediction[];
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

/** Fetch the full strategy optimization from the backend ML models.
 *  Returns null if the backend is unavailable. */
export async function getOptimalStrategy(
  trackId: string,
  totalLaps: number,
  driver = 'VER',
  team = 'Red Bull Racing',
  mode: 'deterministic' | 'window' = 'window',
): Promise<StrategyResult | null> {
  if (!USE_BACKEND) return null;
  const gp = trackToGpName(trackId);
  try {
    const q = new URLSearchParams({
      track: gp,
      driver,
      team,
      total_laps: String(totalLaps),
      mode,
    });
    return await fetchJson<StrategyResult>(`/api/strategy/optimal?${q}`);
  } catch {
    return null;
  }
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
}): Promise<StrategyResult | null> {
  if (!USE_BACKEND) return null;
  const gp = trackToGpName(params.track);
  try {
    const q = new URLSearchParams({
      track: gp,
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
    return null;
  }
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
      // Fall through to mock
    }
  }

  return getMockPrediction(track, driver, lap);
}
