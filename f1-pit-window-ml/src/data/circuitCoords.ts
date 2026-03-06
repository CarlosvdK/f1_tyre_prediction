/**
 * F1 Circuit coordinate paths.
 *
 * Hand-crafted waypoints (40-50 per circuit) matching real circuit layouts.
 * CatmullRom spline interpolation produces smooth, recognisable shapes.
 * Scale: approx 1 unit ≈ 70m of track length.
 * Coordinates: x = lateral, y = elevation, z = longitudinal.
 *
 * TRACK ID RESOLUTION ORDER:
 * 1. Exact match on name ("monza", "silverstone")
 * 2. Kaggle numeric circuit_id as string ("15", "10")
 *
 * Add new circuits by adding an entry to CIRCUIT_PATHS, then aliasing
 * its numeric ID in CIRCUIT_ID_MAP below.
 */

export interface CircuitWaypoint {
    x: number;
    y: number;       // elevation (exaggerated in renderer)
    z: number;
    speed: number;   // representative km/h
    brake: boolean;
    label?: string;
}

export type CircuitKey = string;

/* ── Kaggle circuit ID → named key ─────────────────────────────── */
const CIRCUIT_ID_MAP: Record<string, CircuitKey> = {
    '1': 'melbourne',
    '2': 'sepang',
    '3': 'bahrain',
    '4': 'barcelona',
    '5': 'istanbul',
    '6': 'monaco',
    '7': 'canada',
    '8': 'nurburgring',
    '9': 'magny-cours',
    '10': 'silverstone',
    '11': 'hockenheim',
    '12': 'hungaroring',
    '13': 'austria',
    '14': 'spa',
    '15': 'monza',
    '16': 'singapore',
    '17': 'shanghai',
    '18': 'brazil',
    '22': 'suzuka',
    '24': 'abu-dhabi',
    '32': 'mexico',
    '34': 'austin',
    '69': 'austin',
    '70': 'austria',
    '71': 'jeddah',
    '77': 'jeddah',
    '78': 'melbourne',
    '80': 'miami',
    '81': 'las-vegas',
};

export const CIRCUIT_PATHS: Record<CircuitKey, CircuitWaypoint[]> = {

    // ─────────────────────────────────────────────────────────────────
    // MONZA — Autodromo Nazionale, Italy
    // Clockwise. Famous for: long straights, 3 chicanes, Parabolica.
    // ─────────────────────────────────────────────────────────────────
    monza: [
        { x: 0.0, y: 0, z: 0.0, speed: 328, brake: false, label: 'S/F Straight' },
        { x: 1.8, y: 0, z: -0.3, speed: 335, brake: false },
        { x: 3.6, y: 0, z: -0.6, speed: 338, brake: false },
        { x: 5.0, y: 0, z: -0.8, speed: 78, brake: true, label: 'T1 Chicane' },
        { x: 5.6, y: 0, z: 0.2, speed: 90, brake: false },
        { x: 5.2, y: 0, z: 0.8, speed: 140, brake: false },
        { x: 4.5, y: 0, z: 1.5, speed: 240, brake: false, label: 'Curva Grande' },
        { x: 3.2, y: 0, z: 2.8, speed: 260, brake: false },
        { x: 1.8, y: 0, z: 3.7, speed: 265, brake: false },
        { x: 0.4, y: 0, z: 4.0, speed: 268, brake: false },
        { x: -0.6, y: 0, z: 4.1, speed: 82, brake: true, label: 'Roggia Chicane' },
        { x: -1.0, y: 0, z: 3.8, speed: 95, brake: false },
        { x: -0.8, y: 0, z: 3.3, speed: 145, brake: false },
        { x: -0.2, y: 0, z: 2.5, speed: 210, brake: true, label: 'Lesmo 1' },
        { x: 0.6, y: 0, z: 2.0, speed: 225, brake: false },
        { x: 0.9, y: 0, z: 1.5, speed: 198, brake: true, label: 'Lesmo 2' },
        { x: 0.6, y: 0, z: 0.8, speed: 205, brake: false },
        { x: -0.4, y: 0, z: 0.2, speed: 290, brake: false },
        { x: -1.8, y: 0, z: -0.2, speed: 300, brake: false },
        { x: -3.0, y: 0, z: -0.4, speed: 305, brake: false },
        { x: -4.0, y: 0, z: -0.3, speed: 85, brake: true, label: 'Ascari Chicane' },
        { x: -4.6, y: 0, z: 0.4, speed: 100, brake: false },
        { x: -4.2, y: 0, z: 1.0, speed: 165, brake: false },
        { x: -3.5, y: 0, z: 2.0, speed: 290, brake: false },
        { x: -4.8, y: 0, z: 4.5, speed: 80, brake: true, label: 'Parabolica' },
        { x: -5.8, y: 0, z: 4.6, speed: 90, brake: false },
        { x: -6.0, y: 0, z: 3.2, speed: 155, brake: false },
        { x: -5.4, y: 0, z: 1.8, speed: 230, brake: false },
        { x: -4.2, y: 0, z: 0.4, speed: 300, brake: false },
        { x: -2.8, y: 0, z: -0.6, speed: 325, brake: false },
        { x: -1.4, y: 0, z: -1.0, speed: 335, brake: false },
        { x: 0.0, y: 0, z: 0.0, speed: 328, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // SILVERSTONE — UK
    // Clockwise. Famous for: Maggotts-Becketts, Copse, Hangar Straight.
    // ─────────────────────────────────────────────────────────────────
    silverstone: [
        { x: 0.0, y: 0.00, z: 0.0, speed: 298, brake: false, label: 'S/F' },
        { x: 1.4, y: 0.00, z: -0.2, speed: 300, brake: false },
        { x: 2.8, y: 0.00, z: -0.1, speed: 278, brake: true, label: 'Abbey' },
        { x: 3.6, y: 0.00, z: 0.4, speed: 260, brake: false },
        { x: 4.2, y: 0.00, z: 0.9, speed: 248, brake: true, label: 'Farm' },
        { x: 4.0, y: 0.00, z: 1.6, speed: 242, brake: false },
        { x: 3.4, y: 0.00, z: 2.2, speed: 142, brake: true, label: 'Village' },
        { x: 2.6, y: 0.00, z: 2.5, speed: 148, brake: false },
        { x: 2.0, y: 0.00, z: 3.0, speed: 108, brake: true, label: 'The Loop' },
        { x: 1.2, y: 0.00, z: 2.8, speed: 118, brake: false },
        { x: 0.6, y: 0.00, z: 2.4, speed: 155, brake: false },
        { x: 0.0, y: 0.00, z: 1.8, speed: 192, brake: true, label: 'Aintree' },
        { x: -0.6, y: 0.00, z: 1.2, speed: 210, brake: false },
        { x: -1.4, y: 0.00, z: 0.8, speed: 225, brake: false, label: 'Wellington' },
        { x: -2.4, y: 0.00, z: 1.0, speed: 195, brake: true, label: 'Brooklands' },
        { x: -3.0, y: 0.00, z: 1.8, speed: 188, brake: false },
        { x: -3.4, y: 0.00, z: 2.6, speed: 112, brake: true, label: 'Luffield' },
        { x: -3.0, y: 0.00, z: 3.2, speed: 125, brake: false },
        { x: -2.2, y: 0.00, z: 3.4, speed: 168, brake: false },
        { x: -1.2, y: 0.00, z: 3.2, speed: 232, brake: true, label: 'Woodcote' },
        { x: -0.4, y: 0.00, z: 2.8, speed: 255, brake: false },
        { x: 0.8, y: 0.00, z: 2.2, speed: 278, brake: false, label: 'Copse' },
        { x: 1.8, y: 0.00, z: 1.4, speed: 282, brake: false },
        { x: 2.4, y: 0.04, z: 0.6, speed: 265, brake: true, label: 'Maggotts' },
        { x: 2.8, y: 0.08, z: -0.2, speed: 252, brake: false, label: 'Becketts' },
        { x: 2.4, y: 0.08, z: -0.8, speed: 248, brake: false, label: 'Chapel' },
        { x: 1.6, y: 0.04, z: -1.4, speed: 295, brake: false, label: 'Hangar' },
        { x: 0.8, y: 0.00, z: -1.8, speed: 308, brake: false },
        { x: -0.2, y: 0.00, z: -2.0, speed: 178, brake: true, label: 'Stowe' },
        { x: -1.0, y: 0.00, z: -1.8, speed: 192, brake: false },
        { x: -1.6, y: 0.00, z: -1.2, speed: 232, brake: true, label: 'Club' },
        { x: -1.4, y: 0.00, z: -0.5, speed: 255, brake: false },
        { x: -0.8, y: 0.00, z: -0.1, speed: 275, brake: false },
        { x: 0.0, y: 0.00, z: 0.0, speed: 298, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // MONACO — Circuit de Monaco
    // Clockwise. Tightest on the calendar, constant acceleration zones.
    // ─────────────────────────────────────────────────────────────────
    monaco: [
        { x: 0.0, y: 0.00, z: 0.0, speed: 290, brake: false, label: 'S/F' },
        { x: 0.8, y: 0.00, z: -0.1, speed: 295, brake: false },
        { x: 1.6, y: 0.00, z: -0.2, speed: 298, brake: false },
        { x: 2.4, y: 0.08, z: -0.1, speed: 152, brake: true, label: 'Sainte Dévote' },
        { x: 2.6, y: 0.14, z: 0.5, speed: 148, brake: false },
        { x: 2.4, y: 0.20, z: 1.2, speed: 155, brake: false },
        { x: 2.0, y: 0.26, z: 1.8, speed: 162, brake: false, label: 'Massenet' },
        { x: 1.5, y: 0.30, z: 2.2, speed: 170, brake: false },
        { x: 1.0, y: 0.32, z: 2.5, speed: 195, brake: false, label: 'Casino' },
        { x: 0.4, y: 0.30, z: 2.8, speed: 100, brake: true, label: 'Mirabeau' },
        { x: -0.2, y: 0.28, z: 2.5, speed: 92, brake: false },
        { x: -0.6, y: 0.24, z: 2.0, speed: 88, brake: true, label: 'Grand Hôtel' },
        { x: -0.8, y: 0.20, z: 1.4, speed: 90, brake: false },
        { x: -1.0, y: 0.14, z: 0.8, speed: 135, brake: false, label: 'Portier' },
        { x: -1.2, y: 0.06, z: 0.2, speed: 165, brake: false },
        { x: -1.6, y: 0.00, z: -0.5, speed: 215, brake: false, label: 'Tunnel' },
        { x: -2.2, y: 0.00, z: -0.8, speed: 260, brake: false },
        { x: -2.8, y: 0.00, z: -0.6, speed: 275, brake: false },
        { x: -3.2, y: 0.00, z: -0.2, speed: 78, brake: true, label: 'Nouvelle Chicane' },
        { x: -3.0, y: 0.00, z: 0.4, speed: 88, brake: false },
        { x: -2.6, y: 0.00, z: 0.8, speed: 140, brake: false, label: 'Tabac' },
        { x: -2.0, y: 0.00, z: 0.6, speed: 165, brake: false, label: 'Piscine' },
        { x: -1.6, y: 0.00, z: 0.2, speed: 72, brake: true, label: 'La Rascasse' },
        { x: -1.2, y: 0.00, z: -0.2, speed: 78, brake: false, label: 'Anthony Noghes' },
        { x: -0.6, y: 0.00, z: -0.3, speed: 200, brake: false },
        { x: 0.0, y: 0.00, z: 0.0, speed: 290, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // SPA-FRANCORCHAMPS — Belgium
    // Clockwise. Raidillon/Eau Rouge, Pouhon, Bus Stop chicane.
    // ─────────────────────────────────────────────────────────────────
    spa: [
        { x: 0.0, y: 0.00, z: 0.0, speed: 305, brake: false, label: 'S/F' },
        { x: 1.0, y: 0.00, z: -0.2, speed: 308, brake: false },
        { x: 2.0, y: 0.00, z: -0.4, speed: 95, brake: true, label: 'La Source' },
        { x: 2.2, y: 0.00, z: 0.2, speed: 108, brake: false },
        { x: 2.0, y: 0.06, z: 0.8, speed: 185, brake: false },
        { x: 1.6, y: 0.12, z: 1.4, speed: 240, brake: false, label: 'Eau Rouge' },
        { x: 1.2, y: 0.18, z: 2.0, speed: 270, brake: false },
        { x: 0.8, y: 0.22, z: 2.6, speed: 285, brake: false, label: 'Raidillon' },
        { x: 0.2, y: 0.24, z: 3.2, speed: 298, brake: false },
        { x: -0.6, y: 0.22, z: 3.8, speed: 302, brake: false, label: 'Kemmel' },
        { x: -1.4, y: 0.18, z: 4.2, speed: 308, brake: false },
        { x: -2.2, y: 0.12, z: 4.6, speed: 312, brake: false },
        { x: -3.0, y: 0.06, z: 4.8, speed: 105, brake: true, label: 'Les Combes' },
        { x: -3.6, y: 0.00, z: 4.2, speed: 120, brake: false },
        { x: -3.8, y: 0.00, z: 3.5, speed: 175, brake: false, label: 'Malmedy' },
        { x: -3.6, y: 0.00, z: 2.8, speed: 165, brake: false },
        { x: -3.2, y: 0.00, z: 2.0, speed: 195, brake: false, label: 'Rivage' },
        { x: -2.8, y: 0.00, z: 1.2, speed: 215, brake: false },
        { x: -2.0, y: 0.00, z: 0.8, speed: 258, brake: false, label: 'Pouhon' },
        { x: -1.2, y: 0.00, z: 0.4, speed: 272, brake: false },
        { x: -0.4, y: 0.00, z: 0.0, speed: 278, brake: false, label: 'Stavelot' },
        { x: 0.4, y: 0.00, z: -0.3, speed: 118, brake: true, label: 'Bus Stop' },
        { x: 0.8, y: 0.00, z: 0.2, speed: 130, brake: false },
        { x: 0.4, y: 0.00, z: 0.8, speed: 210, brake: false },
        { x: 0.0, y: 0.00, z: 0.0, speed: 305, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // SUZUKA — Japan
    // Clockwise (figure-of-8). Famous for: S-curves, Spoon, 130R.
    // ─────────────────────────────────────────────────────────────────
    suzuka: [
        { x: 0.0, y: 0.00, z: 0.0, speed: 295, brake: false, label: 'S/F' },
        { x: 1.2, y: 0.00, z: -0.1, speed: 298, brake: false },
        { x: 2.0, y: 0.00, z: -0.1, speed: 160, brake: true, label: 'T1' },
        { x: 2.6, y: 0.00, z: 0.4, speed: 150, brake: false },
        { x: 2.8, y: 0.00, z: 1.0, speed: 148, brake: false },
        { x: 2.4, y: 0.04, z: 1.6, speed: 210, brake: false, label: 'S-Curves' },
        { x: 1.8, y: 0.06, z: 2.2, speed: 225, brake: false },
        { x: 1.2, y: 0.06, z: 2.7, speed: 232, brake: false },
        { x: 0.6, y: 0.04, z: 3.2, speed: 240, brake: false },
        { x: 0.0, y: 0.02, z: 3.6, speed: 168, brake: true, label: 'Dunlop' },
        { x: -0.4, y: 0.00, z: 3.2, speed: 172, brake: false },
        { x: -0.6, y: 0.00, z: 2.5, speed: 205, brake: false },
        { x: -0.2, y: 0.00, z: 1.8, speed: 215, brake: false, label: 'Degner' },
        { x: 0.4, y: 0.00, z: 1.2, speed: 98, brake: true, label: 'Hairpin' },
        { x: 0.8, y: 0.00, z: 0.6, speed: 115, brake: false },
        { x: 0.4, y: 0.00, z: 0.0, speed: 195, brake: false },
        { x: -0.2, y: 0.00, z: -0.6, speed: 252, brake: false, label: 'Spoon' },
        { x: -0.8, y: 0.00, z: -1.2, speed: 258, brake: false },
        { x: -1.4, y: 0.00, z: -1.6, speed: 262, brake: false },
        { x: -2.0, y: 0.00, z: -1.8, speed: 285, brake: false, label: '130R' },
        { x: -2.6, y: 0.00, z: -1.4, speed: 290, brake: false },
        { x: -2.8, y: 0.00, z: -0.8, speed: 108, brake: true, label: 'Casio' },
        { x: -2.4, y: 0.00, z: -0.2, speed: 125, brake: false },
        { x: -1.6, y: 0.00, z: 0.2, speed: 218, brake: false },
        { x: -0.8, y: 0.00, z: 0.2, speed: 268, brake: false },
        { x: 0.0, y: 0.00, z: 0.0, speed: 295, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // BAHRAIN — Bahrain International Circuit
    // Anti-clockwise. Long straights, heavy braking zones.
    // ─────────────────────────────────────────────────────────────────
    bahrain: [
        { x: 0.0, y: 0, z: 0.0, speed: 295, brake: false, label: 'S/F' },
        { x: -0.8, y: 0, z: -0.2, speed: 298, brake: false },
        { x: -1.6, y: 0, z: -0.3, speed: 105, brake: true, label: 'T1' },
        { x: -2.2, y: 0, z: 0.2, speed: 120, brake: false },
        { x: -2.4, y: 0, z: 0.8, speed: 108, brake: true, label: 'T4' },
        { x: -2.2, y: 0, z: 1.4, speed: 118, brake: false },
        { x: -1.8, y: 0, z: 1.8, speed: 178, brake: false, label: 'T5' },
        { x: -1.2, y: 0, z: 2.0, speed: 210, brake: false },
        { x: -0.6, y: 0, z: 2.0, speed: 185, brake: true, label: 'T8' },
        { x: -0.2, y: 0, z: 1.6, speed: 195, brake: false },
        { x: -0.4, y: 0, z: 1.0, speed: 175, brake: true, label: 'T9' },
        { x: -0.8, y: 0, z: 0.4, speed: 185, brake: false },
        { x: -1.2, y: 0, z: 0.0, speed: 258, brake: false },
        { x: -1.8, y: 0, z: -0.6, speed: 278, brake: false },
        { x: -2.2, y: 0, z: -1.4, speed: 88, brake: true, label: 'T11' },
        { x: -2.0, y: 0, z: -2.0, speed: 102, brake: false },
        { x: -1.6, y: 0, z: -2.4, speed: 148, brake: false },
        { x: -1.0, y: 0, z: -2.6, speed: 208, brake: false },
        { x: -0.4, y: 0, z: -2.8, speed: 248, brake: false },
        { x: 0.4, y: 0, z: -2.8, speed: 270, brake: false, label: 'T15 Straight' },
        { x: 1.2, y: 0, z: -2.6, speed: 278, brake: false },
        { x: 1.8, y: 0, z: -2.2, speed: 115, brake: true, label: 'T16' },
        { x: 2.0, y: 0, z: -1.6, speed: 128, brake: false },
        { x: 1.8, y: 0, z: -1.0, speed: 195, brake: false, label: 'T17' },
        { x: 1.2, y: 0, z: -0.4, speed: 248, brake: false },
        { x: 0.6, y: 0, z: 0.0, speed: 278, brake: false },
        { x: 0.0, y: 0, z: 0.0, speed: 295, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // ABU DHABI — Yas Marina Circuit
    // Anti-clockwise. Hotel section, Marina straight.
    // ─────────────────────────────────────────────────────────────────
    'abu-dhabi': [
        { x: 0.0, y: 0, z: 0.0, speed: 290, brake: false, label: 'S/F' },
        { x: -1.0, y: 0, z: -0.2, speed: 295, brake: false },
        { x: -2.0, y: 0, z: -0.3, speed: 108, brake: true, label: 'T1' },
        { x: -2.6, y: 0, z: 0.2, speed: 122, brake: false },
        { x: -2.8, y: 0, z: 0.9, speed: 138, brake: false },
        { x: -2.6, y: 0, z: 1.5, speed: 175, brake: false, label: 'T5' },
        { x: -2.0, y: 0, z: 1.8, speed: 195, brake: false },
        { x: -1.4, y: 0, z: 2.0, speed: 215, brake: false, label: 'T8' },
        { x: -0.8, y: 0, z: 2.0, speed: 148, brake: true, label: 'T9' },
        { x: -0.4, y: 0, z: 1.6, speed: 158, brake: false },
        { x: -0.6, y: 0, z: 1.0, speed: 165, brake: false },
        { x: -1.0, y: 0, z: 0.4, speed: 195, brake: false },
        { x: -1.6, y: 0, z: 0.0, speed: 245, brake: false },
        { x: -2.2, y: 0, z: -0.6, speed: 275, brake: false },
        { x: -2.8, y: 0, z: -1.4, speed: 92, brake: true, label: 'T11-Hotel' },
        { x: -2.6, y: 0, z: -2.2, speed: 110, brake: false },
        { x: -2.0, y: 0, z: -2.6, speed: 158, brake: false },
        { x: -1.2, y: 0, z: -2.8, speed: 210, brake: false },
        { x: -0.4, y: 0, z: -2.8, speed: 255, brake: false, label: 'Marina Straight' },
        { x: 0.6, y: 0, z: -2.6, speed: 272, brake: false },
        { x: 1.4, y: 0, z: -2.2, speed: 115, brake: true, label: 'T18' },
        { x: 1.8, y: 0, z: -1.6, speed: 132, brake: false },
        { x: 1.6, y: 0, z: -1.0, speed: 188, brake: false },
        { x: 1.0, y: 0, z: -0.4, speed: 248, brake: false },
        { x: 0.4, y: 0, z: 0.0, speed: 270, brake: false },
        { x: 0.0, y: 0, z: 0.0, speed: 290, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // AUSTRALIA — Albert Park, Melbourne
    // Anti-clockwise. Street circuit, fast final sector.
    // ─────────────────────────────────────────────────────────────────
    melbourne: [
        { x: 0.0, y: 0, z: 0.0, speed: 285, brake: false, label: 'S/F' },
        { x: -0.8, y: 0, z: -0.1, speed: 288, brake: false },
        { x: -1.5, y: 0, z: 0.0, speed: 118, brake: true, label: 'T1' },
        { x: -2.0, y: 0, z: 0.5, speed: 128, brake: false },
        { x: -2.2, y: 0, z: 1.2, speed: 145, brake: true, label: 'T3' },
        { x: -2.0, y: 0, z: 1.8, speed: 155, brake: false },
        { x: -1.6, y: 0, z: 2.3, speed: 215, brake: false, label: 'T6' },
        { x: -1.0, y: 0, z: 2.6, speed: 238, brake: false },
        { x: -0.2, y: 0, z: 2.8, speed: 245, brake: false },
        { x: 0.6, y: 0, z: 2.8, speed: 95, brake: true, label: 'T9' },
        { x: 1.0, y: 0, z: 2.4, speed: 108, brake: false },
        { x: 1.0, y: 0, z: 1.8, speed: 175, brake: false },
        { x: 0.8, y: 0, z: 1.2, speed: 205, brake: true, label: 'T11' },
        { x: 0.4, y: 0, z: 0.7, speed: 218, brake: false },
        { x: 0.0, y: 0, z: 0.4, speed: 252, brake: false },
        { x: -0.4, y: 0, z: 0.0, speed: 262, brake: false, label: 'T13 Straight' },
        { x: -0.8, y: 0, z: -0.6, speed: 272, brake: false },
        { x: -0.4, y: 0, z: -1.0, speed: 112, brake: true, label: 'T15' },
        { x: 0.2, y: 0, z: -1.2, speed: 125, brake: false },
        { x: 0.8, y: 0, z: -1.0, speed: 192, brake: false },
        { x: 1.2, y: 0, z: -0.6, speed: 258, brake: false },
        { x: 1.0, y: 0, z: -0.2, speed: 268, brake: false },
        { x: 0.6, y: 0, z: 0.0, speed: 275, brake: false },
        { x: 0.0, y: 0, z: 0.0, speed: 285, brake: false },
    ],

    // ─────────────────────────────────────────────────────────────────
    // CANADA — Circuit Gilles Villeneuve, Montreal
    // Clockwise. Heavy braking, Wall of Champions, Casino hairpin.
    // ─────────────────────────────────────────────────────────────────
    canada: [
        { x: 0.0, y: 0, z: 0.0, speed: 295, brake: false, label: 'S/F' },
        { x: 1.2, y: 0, z: -0.1, speed: 302, brake: false },
        { x: 2.0, y: 0, z: 0.2, speed: 148, brake: true, label: 'T1-T2' },
        { x: 2.2, y: 0, z: 0.8, speed: 162, brake: false },
        { x: 1.8, y: 0, z: 1.4, speed: 215, brake: false },
        { x: 1.2, y: 0, z: 1.8, speed: 248, brake: false, label: 'Casino Straight' },
        { x: 0.4, y: 0, z: 2.0, speed: 265, brake: false },
        { x: -0.4, y: 0, z: 1.8, speed: 265, brake: false },
        { x: -1.0, y: 0, z: 1.2, speed: 78, brake: true, label: 'Casino Hairpin' },
        { x: -1.2, y: 0, z: 0.6, speed: 92, brake: false },
        { x: -1.0, y: 0, z: 0.0, speed: 175, brake: false },
        { x: -0.6, y: 0, z: -0.6, speed: 258, brake: false },
        { x: 0.2, y: 0, z: -1.0, speed: 275, brake: false, label: 'Island Hairpin' },
        { x: 1.0, y: 0, z: -1.2, speed: 88, brake: true, label: "Wall of Champions" },
        { x: 1.4, y: 0, z: -0.8, speed: 105, brake: false },
        { x: 1.2, y: 0, z: -0.4, speed: 215, brake: false },
        { x: 0.6, y: 0, z: -0.2, speed: 260, brake: false },
        { x: 0.0, y: 0, z: 0.0, speed: 295, brake: false },
    ],

};

// ── Fallback circuits (use generated labels) ──────────────────────
// For any circuit not hand-crafted, fall back to a procedurally generated shape
// so the map always shows SOMETHING unique per circuit.
function generateCircuitPath(seed: number): CircuitWaypoint[] {
    const pts: CircuitWaypoint[] = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2;
        const r = 1.0
            + 0.30 * Math.sin(2 * t + seed * 0.7)
            + 0.15 * Math.sin(3 * t + seed * 1.1)
            + 0.08 * Math.cos(5 * t + seed * 0.4);
        const scaleX = 3.5 + (seed % 5) * 0.4;
        const scaleZ = 3.0 + ((seed + 2) % 5) * 0.4;
        const isBrake = Math.sin(4 * t + seed) > 0.7 && i % 4 === 0;
        const speed = isBrake ? 90 + (seed % 30) : 220 + (seed % 80);
        pts.push({
            x: r * Math.cos(t) * scaleX,
            y: 0.06 * Math.sin(3 * t),
            z: r * Math.sin(t) * scaleZ,
            speed, brake: isBrake,
        });
    }
    return pts;
}

/** Look up circuit path by track ID (name or numeric Kaggle circuit_id) */
export function getCircuitPath(trackId: string): CircuitWaypoint[] {
    const key = trackId.toLowerCase().trim();

    // 1. Direct name match
    if (key in CIRCUIT_PATHS) return CIRCUIT_PATHS[key];

    // 2. Numeric ID → named key
    const named = CIRCUIT_ID_MAP[key];
    if (named && named in CIRCUIT_PATHS) return CIRCUIT_PATHS[named];

    // 3. Procedurally generate a unique shape from the numeric seed
    const seed = parseInt(key, 10) || key.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return generateCircuitPath(seed % 97);
}
