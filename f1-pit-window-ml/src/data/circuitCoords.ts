/**
 * Hardcoded F1 circuit coordinate paths.
 *
 * These are hand-crafted waypoints matched to real circuit layouts
 * (Monza and Silverstone). The coordinates use a local normalised
 * system so `CatmullRomCurve3` produces a smooth, recognisable shape.
 *
 * Points go in clockwise order as seen from above (matching F1 broadcast views).
 * Scale: approx 1 unit ≈ 70–80 m of track length.
 *
 * Speed and brake annotations are per-segment and derived from real
 * typical F1 sector profiles for each circuit.
 */

export interface CircuitWaypoint {
    x: number;
    y: number;       // elevation — 0 for flat sections, +/- for banking / uphill / downhill
    z: number;
    speed: number;   // representative km/h at this point (for colour coding)
    brake: boolean;  // true = significant braking zone leading to this point
    label?: string;  // optional corner name
}

export type CircuitKey = 'monza' | 'silverstone';

export const CIRCUIT_PATHS: Record<CircuitKey, CircuitWaypoint[]> = {
    // ────────────────────────────────────────────────────────────────────
    // MONZA — Autodromo Nazionale di Monza
    // Notable: Long straights, 3 chicanes, Parabolica.
    // Circuit direction: clockwise.
    // ────────────────────────────────────────────────────────────────────
    monza: [
        // Start/Finish straight
        { x: 0.0, y: 0.0, z: 0.0, speed: 328, brake: false, label: 'Start/Finish' },
        { x: 1.8, y: 0.0, z: -0.3, speed: 335, brake: false },
        { x: 3.6, y: 0.0, z: -0.6, speed: 338, brake: false },
        // Variante del Rettifilo (T1 chicane, heavy braking)
        { x: 5.0, y: 0.0, z: -0.8, speed: 78, brake: true, label: 'T1 Chicane' },
        { x: 5.6, y: 0.0, z: 0.2, speed: 90, brake: false },
        { x: 5.2, y: 0.0, z: 0.8, speed: 140, brake: false },
        // Curva Grande — long, sweeping fast right
        { x: 4.5, y: 0.0, z: 1.5, speed: 240, brake: false, label: 'Curva Grande' },
        { x: 3.2, y: 0.0, z: 2.8, speed: 260, brake: false },
        { x: 1.8, y: 0.0, z: 3.7, speed: 265, brake: false },
        { x: 0.4, y: 0.0, z: 4.0, speed: 268, brake: false },
        // Variante della Roggia (T4 chicane, hard braking)
        { x: -0.6, y: 0.0, z: 4.1, speed: 82, brake: true, label: 'Roggia Chicane' },
        { x: -1.0, y: 0.0, z: 3.8, speed: 95, brake: false },
        { x: -0.8, y: 0.0, z: 3.3, speed: 145, brake: false },
        // Lesmo 1 (right) — medium-fast
        { x: -0.2, y: 0.0, z: 2.5, speed: 210, brake: true, label: 'Lesmo 1' },
        { x: 0.6, y: 0.0, z: 2.0, speed: 225, brake: false },
        // Lesmo 2 (right) — slightly slower
        { x: 0.9, y: 0.0, z: 1.5, speed: 198, brake: true, label: 'Lesmo 2' },
        { x: 0.6, y: 0.0, z: 0.8, speed: 205, brake: false },
        // Serraglio / Variante Ascari (chicane at end of back straight)
        { x: -0.4, y: 0.0, z: 0.2, speed: 290, brake: false },
        { x: -1.8, y: 0.0, z: -0.2, speed: 300, brake: false },
        { x: -3.0, y: 0.0, z: -0.4, speed: 305, brake: false },
        { x: -4.0, y: 0.0, z: -0.3, speed: 85, brake: true, label: 'Ascari Chicane' },
        { x: -4.6, y: 0.0, z: 0.4, speed: 100, brake: false },
        { x: -4.2, y: 0.0, z: 1.0, speed: 165, brake: false },
        // Curva Parabolica — long hairpin, very slow entry, very fast exit
        { x: -3.0, y: 0.0, z: 2.0, speed: 310, brake: false },
        { x: -1.8, y: 0.0, z: 3.0, speed: 315, brake: false },
        // Back down the main straight toward Parabolica entry — now on pit straight side
        { x: -3.5, y: 0.0, z: 4.5, speed: 320, brake: false, label: 'Parabolica entry' },
        { x: -4.8, y: 0.0, z: 5.2, speed: 78, brake: true },
        { x: -5.8, y: 0.0, z: 4.8, speed: 88, brake: false },
        { x: -6.0, y: 0.0, z: 3.4, speed: 140, brake: false },
        { x: -5.5, y: 0.0, z: 2.0, speed: 220, brake: false },
        { x: -4.5, y: 0.0, z: 0.6, speed: 280, brake: false },
        { x: -3.0, y: 0.0, z: -0.8, speed: 320, brake: false },
        { x: -1.5, y: 0.0, z: -1.2, speed: 335, brake: false },
        // Close the loop
        { x: 0.0, y: 0.0, z: 0.0, speed: 328, brake: false },
    ],

    // ────────────────────────────────────────────────────────────────────
    // SILVERSTONE — Silverstone Circuit, UK
    // Notable: High-speed sweeping corners, Maggotts/Becketts complex.
    // Circuit direction: clockwise.
    // ────────────────────────────────────────────────────────────────────
    silverstone: [
        // Start/Finish (Hamilton Straight)
        { x: 0.0, y: 0.0, z: 0.0, speed: 298, brake: false, label: 'Start/Finish' },
        { x: 1.4, y: 0.0, z: -0.2, speed: 300, brake: false },
        // Abbey (fast right, slight braking)
        { x: 2.8, y: 0.0, z: -0.15, speed: 278, brake: true, label: 'Abbey' },
        { x: 3.6, y: 0.0, z: 0.35, speed: 260, brake: false },
        // Farm (fast left-right)
        { x: 4.2, y: 0.0, z: 0.9, speed: 248, brake: true, label: 'Farm' },
        { x: 4.0, y: 0.0, z: 1.6, speed: 242, brake: false },
        // Village (hairpin)
        { x: 3.4, y: 0.0, z: 2.2, speed: 142, brake: true, label: 'Village' },
        { x: 2.6, y: 0.0, z: 2.5, speed: 148, brake: false },
        // The Loop (tight hairpin)
        { x: 2.0, y: 0.0, z: 3.0, speed: 108, brake: true, label: 'The Loop' },
        { x: 1.2, y: 0.0, z: 2.8, speed: 118, brake: false },
        { x: 0.6, y: 0.0, z: 2.4, speed: 155, brake: false },
        // Aintree
        { x: 0.0, y: 0.0, z: 1.8, speed: 192, brake: true, label: 'Aintree' },
        { x: -0.6, y: 0.0, z: 1.2, speed: 210, brake: false },
        // Wellington
        { x: -1.4, y: 0.0, z: 0.8, speed: 225, brake: false, label: 'Wellington' },
        // Brooklands (sweeping left)
        { x: -2.4, y: 0.0, z: 1.0, speed: 195, brake: true, label: 'Brooklands' },
        { x: -3.0, y: 0.0, z: 1.8, speed: 188, brake: false },
        // Luffield (sharp hairpin)
        { x: -3.4, y: 0.0, z: 2.6, speed: 112, brake: true, label: 'Luffield' },
        { x: -3.0, y: 0.0, z: 3.2, speed: 125, brake: false },
        { x: -2.2, y: 0.0, z: 3.4, speed: 168, brake: false },
        // Woodcote (fast right sweeper onto straight)
        { x: -1.2, y: 0.0, z: 3.2, speed: 232, brake: true, label: 'Woodcote' },
        { x: -0.4, y: 0.0, z: 2.8, speed: 255, brake: false },
        // Copse (ultra-fast right, 250+ km/h)
        { x: 0.8, y: 0.0, z: 2.2, speed: 278, brake: false, label: 'Copse' },
        { x: 1.8, y: 0.0, z: 1.4, speed: 282, brake: false },
        // Maggotts–Becketts–Chapel complex (fast sweeping S)
        { x: 2.4, y: 0.04, z: 0.6, speed: 265, brake: true, label: 'Maggotts' },
        { x: 2.8, y: 0.08, z: -0.2, speed: 252, brake: false, label: 'Becketts' },
        { x: 2.4, y: 0.08, z: -0.8, speed: 248, brake: false, label: 'Chapel' },
        // Hangar Straight — fastest section (up to 310 km/h)
        { x: 1.6, y: 0.04, z: -1.4, speed: 295, brake: false, label: 'Hangar Straight' },
        { x: 0.8, y: 0.0, z: -1.8, speed: 308, brake: false },
        // Stowe (medium-slow right)
        { x: -0.2, y: 0.0, z: -2.0, speed: 178, brake: true, label: 'Stowe' },
        { x: -1.0, y: 0.0, z: -1.8, speed: 192, brake: false },
        // Club (right-hander before start straight)
        { x: -1.6, y: 0.0, z: -1.2, speed: 232, brake: true, label: 'Club' },
        { x: -1.4, y: 0.0, z: -0.5, speed: 255, brake: false },
        { x: -0.8, y: 0.0, z: -0.1, speed: 275, brake: false },
        // Close the loop
        { x: 0.0, y: 0.0, z: 0.0, speed: 298, brake: false },
    ],
};

/** Convenience: get circuit path for a given trackId, falling back to monza */
export function getCircuitPath(trackId: string): CircuitWaypoint[] {
    const key = trackId.toLowerCase() as CircuitKey;
    return CIRCUIT_PATHS[key] ?? CIRCUIT_PATHS.monza;
}
