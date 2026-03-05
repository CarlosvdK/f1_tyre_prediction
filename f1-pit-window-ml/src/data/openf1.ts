/**
 * OpenF1 API integration — fetches real car position + telemetry data.
 * Docs: https://openf1.org/
 *
 * Key endpoints used:
 *  - /v1/location   → x, y, z (metres) car coordinates — the real track shape
 *  - /v1/car_data   → speed, throttle, brake per timestamp
 *  - /v1/laps       → lap timestamps to isolate a single clean lap
 */

const BASE = 'https://api.openf1.org/v1';

export interface OpenF1Point {
    x: number;
    y: number;
    z: number;           // elevation in metres
    speed: number;
    throttle: number;    // 0–100
    brake: boolean;
    date: string;
}

export interface OpenF1Session {
    session_key: number;
    circuit_short_name: string;
    location: string;
    country_name: string;
    session_name: string;
    year: number;
}

/** Map our track IDs to OpenF1 session keys (2024 Race sessions) */
export const TRACK_SESSION_MAP: Record<string, number> = {
    monza: 9590,  // 2024 Italian GP
    silverstone: 9558,  // 2024 British GP
    // Extend when more tracks are added
};

/**
 * Returns an OpenF1 session key for a given track id.
 * Falls back to Monza if unknown.
 */
function resolveSessionKey(trackId: string): number {
    return TRACK_SESSION_MAP[trackId.toLowerCase()] ?? 9590;
}

async function openf1Get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`OpenF1 ${path}: ${res.status}`);
    return res.json() as Promise<T>;
}

interface RawLocation {
    date: string;
    driver_number: number;
    session_key: number;
    x: number;
    y: number;
    z: number;
}

interface RawCarData {
    date: string;
    driver_number: number;
    session_key: number;
    speed: number;
    throttle: number;
    brake: number;
    n_gear: number;
    drs: number;
}

interface RawLap {
    driver_number: number;
    lap_number: number;
    date_start: string;
    lap_duration: number | null;
    session_key: number;
}

/**
 * Pick the default "hero" driver for a session.
 * Uses driver_number=1 (Verstappen) for 2024 sessions,
 * or falls back to the first driver number present in the data.
 */
const TRACK_DRIVER_MAP: Record<number, number> = {
    9590: 1,   // Monza 2024  → Verstappen
    9558: 44,  // Silverstone → Hamilton
};

/**
 * Fetch one complete clean lap of 3D track data from OpenF1.
 *
 * Strategy:
 *  1. Get all laps for the driver and find the fastest complete lap
 *  2. Filter location points to that lap's time window
 *  3. Join car_data for speed/throttle/brake
 */
export async function fetchTrack3D(trackId: string): Promise<OpenF1Point[]> {
    const sessionKey = resolveSessionKey(trackId);
    const driverNumber = TRACK_DRIVER_MAP[sessionKey] ?? 1;

    // 1. Get laps to find a complete lap window
    const laps = await openf1Get<RawLap[]>(
        `/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}`
    );

    // Pick the lap that has a valid duration and is representative
    // (skip first lap — usually messy, pick a mid-race lap)
    const validLaps = laps.filter(
        (l) => l.lap_duration !== null && l.lap_number > 2 && l.lap_duration < 180
    );
    if (validLaps.length === 0) throw new Error('No valid laps found');

    // Use the median lap duration lap for stability
    validLaps.sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
    const targetLap = validLaps[Math.floor(validLaps.length * 0.45)];
    const lapStart = new Date(targetLap.date_start).getTime();
    const lapEnd = lapStart + (targetLap.lap_duration ?? 90) * 1000;

    // 2. Fetch location data for the whole session
    // OpenF1 gives ~3.7Hz so each second ≈ 4 points → full lap ≈ 300–400 points
    const [locations, carData] = await Promise.all([
        openf1Get<RawLocation[]>(
            `/v1/location?session_key=${sessionKey}&driver_number=${driverNumber}`
        ),
        openf1Get<RawCarData[]>(
            `/v1/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`
        ),
    ]);

    // 3. Filter to the target lap window
    const lapLocations = locations.filter((loc) => {
        const t = new Date(loc.date).getTime();
        return t >= lapStart && t <= lapEnd;
    });

    if (lapLocations.length < 20) {
        throw new Error(`Too few points for lap (got ${lapLocations.length})`);
    }

    // 4. Build a timestamp-sorted car data map for fast lookup
    const carMap = new Map<number, RawCarData>();
    carData.forEach((cd) => {
        const t = Math.round(new Date(cd.date).getTime() / 250) * 250; // bucket to 250ms
        carMap.set(t, cd);
    });

    // 5. Merge location + telemetry
    const merged: OpenF1Point[] = lapLocations.map((loc) => {
        const t = Math.round(new Date(loc.date).getTime() / 250) * 250;
        // Find nearest car data point (within ±500ms)
        const cd =
            carMap.get(t) ??
            carMap.get(t - 250) ??
            carMap.get(t + 250) ??
            carMap.get(t - 500) ??
            carMap.get(t + 500);
        return {
            x: loc.x,
            y: loc.y,
            z: loc.z,
            speed: cd?.speed ?? 100,
            throttle: cd?.throttle ?? 50,
            brake: (cd?.brake ?? 0) > 20,
            date: loc.date,
        };
    });

    return merged;
}
