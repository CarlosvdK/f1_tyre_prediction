/**
 * OpenF1 API integration — fetches EXACTLY one clean lap of position data.
 *
 * ROOT CAUSE OF PREVIOUS FAILURE:
 * We were fetching ALL location points for the entire race session
 * (53 laps × ~300 pts/lap = ~16,000 records per endpoint → timeout/OOM).
 *
 * FIX: Use OpenF1's date range filtering to request only the time window
 * of a single clean lap:
 *   /v1/location?session_key=...&driver_number=...&date>=ISO&date<=ISO
 * This returns ~250-400 points — exactly what we need.
 */

const BASE = 'https://api.openf1.org/v1';

export interface OpenF1Point {
    x: number;        // metres, OpenF1 horizontal
    y: number;        // metres, OpenF1 horizontal (perpendicular)
    z: number;        // metres, elevation
    speed: number;    // km/h
    throttle: number; // 0–100
    brake: boolean;
    drs: boolean;
    date: string;
}

/** Map track IDs → OpenF1 2024 Race session keys */
export const TRACK_SESSION_MAP: Record<string, number> = {
    monza: 9590,  // 2024 Italian GP
    silverstone: 9558,  // 2024 British GP
};

/** Preferred driver number per session (for clean representative laps) */
const SESSION_DRIVER: Record<number, number> = {
    9590: 1,   // Monza → Verstappen
    9558: 44,  // Silverstone → Hamilton
};

async function ofGet<T>(path: string): Promise<T> {
    const url = `${BASE}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenF1 ${res.status}: ${path.split('?')[0]}`);
    const data = await res.json();
    return data as T;
}

interface RawLap {
    driver_number: number;
    lap_number: number;
    date_start: string;
    lap_duration: number | null;
    session_key: number;
}

interface RawLocation {
    date: string;
    x: number;
    y: number;
    z: number;
}

interface RawCarData {
    date: string;
    speed: number;
    throttle: number;
    brake: number;
    drs: number;
}

/**
 * Fetch one clean median lap of 3D position + telemetry data.
 *
 * Steps:
 *  1. GET /v1/laps → pick a clean median lap (not first, not outlier)
 *  2. GET /v1/location with date range for that lap only (~300 pts)
 *  3. GET /v1/car_data with same date range (~300 pts)
 *  4. Merge by nearest timestamp
 */
export async function fetchTrack3D(trackId: string): Promise<OpenF1Point[]> {
    const sessionKey = TRACK_SESSION_MAP[trackId.toLowerCase()] ?? 9590;
    const driverNumber = SESSION_DRIVER[sessionKey] ?? 1;

    // ── Step 1: find a clean lap ────────────────────────────────────
    const laps = await ofGet<RawLap[]>(
        `/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}`
    );

    // Only keep laps with a real duration and reasonable length
    // (skip lap 1 which has formation lap oddities, skip >120s safety-car laps)
    const valid = laps.filter(
        (l) => l.lap_duration !== null
            && l.lap_number > 2
            && l.lap_duration > 55
            && l.lap_duration < 130
    );

    if (valid.length === 0) {
        throw new Error('No clean laps found in session (all laps filtered)');
    }

    // Sort by duration and take the 40th-percentile lap (representative pace)
    valid.sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
    const lap = valid[Math.floor(valid.length * 0.40)];

    // ── Step 2 & 3: fetch position + telemetry for that lap only ────
    const lapStart = new Date(lap.date_start);
    const lapEnd = new Date(lapStart.getTime() + (lap.lap_duration ?? 90) * 1000);

    // OpenF1 date filter: date>ISO&date<ISO
    const dGte = encodeURIComponent(lapStart.toISOString());
    const dLte = encodeURIComponent(lapEnd.toISOString());
    const base = `session_key=${sessionKey}&driver_number=${driverNumber}`;

    const [locations, carData] = await Promise.all([
        ofGet<RawLocation[]>(`/v1/location?${base}&date>=${dGte}&date<=${dLte}`),
        ofGet<RawCarData[]>(`/v1/car_data?${base}&date>=${dGte}&date<=${dLte}`),
    ]);

    if (locations.length < 30) {
        throw new Error(
            `Too few position points (${locations.length}) for lap ${lap.lap_number} `
            + `— OpenF1 may not have data for this session`
        );
    }

    // ── Step 4: merge by nearest timestamp ─────────────────────────
    // Build car-data index bucketed to 250ms
    const carIndex = new Map<number, RawCarData>();
    carData.forEach((cd) => {
        const bucket = Math.round(new Date(cd.date).getTime() / 250) * 250;
        carIndex.set(bucket, cd);
    });

    const merged: OpenF1Point[] = locations.map((loc) => {
        const t = Math.round(new Date(loc.date).getTime() / 250) * 250;
        const cd = carIndex.get(t)
            ?? carIndex.get(t - 250)
            ?? carIndex.get(t + 250)
            ?? carIndex.get(t - 500)
            ?? carIndex.get(t + 500);
        return {
            x: loc.x,
            y: loc.y,
            z: loc.z,
            speed: cd?.speed ?? 120,
            throttle: cd?.throttle ?? 50,
            brake: (cd?.brake ?? 0) > 20,
            drs: (cd?.drs ?? 0) > 9,   // DRS active: value 10 or 12
            date: loc.date,
        };
    });

    return merged;
}
