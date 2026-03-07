/**
 * OpenF1 integration: resolve a race session for a track, then fetch one clean
 * lap of 3D position + telemetry for that session.
 */

const BASE = 'https://api.openf1.org/v1';
const TARGET_YEAR = 2024;

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

/** Optional hard bindings (fast path). */
export const TRACK_SESSION_MAP: Record<string, number> = {
    monza: 9590,
    silverstone: 9558,
};

const TRACK_ALIASES: Record<string, string[]> = {
    bahrain: ['bahrain', 'sakhir'],
    jeddah: ['saudi', 'jeddah'],
    melbourne: ['australia', 'melbourne', 'albert park'],
    suzuka: ['japan', 'suzuka'],
    shanghai: ['china', 'shanghai'],
    miami: ['miami'],
    imola: ['imola', 'emilia romagna'],
    monaco: ['monaco'],
    canada: ['canada', 'montreal', 'villeneuve'],
    barcelona: ['spain', 'barcelona', 'catalunya'],
    austria: ['austria', 'red bull ring', 'spielberg'],
    silverstone: ['britain', 'silverstone', 'british'],
    hungaroring: ['hungary', 'hungaroring'],
    spa: ['spa', 'belgium', 'francorchamps'],
    zandvoort: ['netherlands', 'zandvoort', 'dutch'],
    monza: ['monza', 'italy', 'italian'],
    baku: ['azerbaijan', 'baku'],
    singapore: ['singapore'],
    austin: ['united states', 'usa', 'austin', 'cota'],
    mexico: ['mexico'],
    brazil: ['brazil', 'sao paulo', 'interlagos'],
    'las-vegas': ['las vegas', 'vegas'],
    qatar: ['qatar', 'lusail'],
    'abu-dhabi': ['abu dhabi', 'yas marina', 'uae'],
};

let raceSessionsCache: RawSession[] | null = null;

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

interface RawSession {
    session_key: number;
    session_name?: string;
    meeting_name?: string;
    country_name?: string;
    location?: string;
    circuit_short_name?: string;
    year?: number;
}

function resolveAliases(trackId: string): string[] {
    const key = trackId.toLowerCase().trim();
    return TRACK_ALIASES[key] ?? [key.replace(/[-_]/g, ' '), key];
}

async function raceSessions(): Promise<RawSession[]> {
    if (raceSessionsCache) return raceSessionsCache;
    const sessions = await ofGet<RawSession[]>(
        `/sessions?year=${TARGET_YEAR}&session_name=Race`
    );
    raceSessionsCache = sessions ?? [];
    return raceSessionsCache;
}

async function resolveSessionKey(trackId: string): Promise<number> {
    const key = trackId.toLowerCase().trim();
    if (TRACK_SESSION_MAP[key]) return TRACK_SESSION_MAP[key];

    const aliases = resolveAliases(trackId);
    const sessions = await raceSessions();
    if (sessions.length === 0) {
        throw new Error('OpenF1 sessions list is empty');
    }

    let bestKey = 0;
    let bestScore = -1;
    for (const session of sessions) {
        const blob = [
            session.meeting_name ?? '',
            session.country_name ?? '',
            session.location ?? '',
            session.circuit_short_name ?? '',
            session.session_name ?? '',
        ].join(' ').toLowerCase();

        let score = 0;
        for (const alias of aliases) {
            if (alias && blob.includes(alias.toLowerCase())) score += 1;
        }
        if (score > bestScore && session.session_key) {
            bestScore = score;
            bestKey = session.session_key;
        }
    }

    if (bestKey <= 0 || bestScore <= 0) {
        throw new Error(`No OpenF1 race session match for track '${trackId}'`);
    }

    TRACK_SESSION_MAP[key] = bestKey;
    return bestKey;
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
    const sessionKey = await resolveSessionKey(trackId);

    // ── Step 1: find a clean lap ────────────────────────────────────
    const laps = await ofGet<RawLap[]>(
        `/laps?session_key=${sessionKey}`
    );

    // Only keep laps with a real duration and reasonable length
    // (skip lap 1 which has formation lap oddities, skip >120s safety-car laps)
    const valid = laps.filter(
        (l) => l.lap_duration !== null
            && l.lap_number > 2
            && l.lap_duration > 55
            && l.lap_duration < 130
            && Boolean(l.date_start)
            && Number.isFinite(l.driver_number)
    );

    if (valid.length === 0) {
        throw new Error('No clean laps found in session (all laps filtered)');
    }

    // Sort by duration and take the 40th-percentile lap (representative pace)
    valid.sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
    const lap = valid[Math.floor(valid.length * 0.40)];
    const driverNumber = lap.driver_number;

    // ── Step 2 & 3: fetch position + telemetry for that lap only ────
    const lapStart = new Date(lap.date_start);
    const lapEnd = new Date(lapStart.getTime() + (lap.lap_duration ?? 90) * 1000);

    // OpenF1 date filter: date>ISO&date<ISO
    const dGte = encodeURIComponent(lapStart.toISOString());
    const dLte = encodeURIComponent(lapEnd.toISOString());
    const base = `session_key=${sessionKey}&driver_number=${driverNumber}`;

    const [locations, carData] = await Promise.all([
        ofGet<RawLocation[]>(`/location?${base}&date>=${dGte}&date<=${dLte}`),
        ofGet<RawCarData[]>(`/car_data?${base}&date>=${dGte}&date<=${dLte}`),
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
