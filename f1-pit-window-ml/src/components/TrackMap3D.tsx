/**
 * TrackMap3D — Real 3D circuit visualization.
 *
 * Renders a Three.js tube along actual OpenF1 x/y/z car position data,
 * coloured per-vertex by speed (blue=slow → green=medium → red=fast).
 * Elevation changes (z-axis) make chicanes, hills and descents visible.
 *
 * Camera: fixed isometric angle looking down at ~40°, no user rotation
 * (matches the Tilke-style top-view shown in the screenshot reference).
 */

import { OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ACESFilmicToneMapping,
    BufferGeometry,
    CatmullRomCurve3,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    Mesh,
    TubeGeometry,
    Vector3,
} from 'three';
import { fetchTrack3D, type OpenF1Point } from '../data/openf1';

/* ── Speed → colour mapping ──────────────────────────────────────
   blue (0 km/h) → cyan → green → yellow → orange → red (350 km/h)
   Mirrors broadcast speed-trace colouring.
   ──────────────────────────────────────────────────────────────── */
function speedToColor(speed: number, minSpeed: number, maxSpeed: number): Color {
    const t = Math.max(0, Math.min(1, (speed - minSpeed) / Math.max(maxSpeed - minSpeed, 1)));
    const color = new Color();
    if (t < 0.25) color.setRGB(0.08, 0.25 + t * 2.0, 0.9);           // blue → cyan
    else if (t < 0.5) color.setRGB(0.08, 0.75 + (t - 0.25) * 0.8, 0.9 - (t - 0.25) * 3.2); // cyan → green
    else if (t < 0.75) color.setRGB((t - 0.5) * 4, 0.95, 0.05);           // green → yellow
    else color.setRGB(1.0, 0.95 - (t - 0.75) * 3.8, 0.05);  // yellow → red
    return color;
}

/* ── Normalise into unit-scale coordinates ───────────────────────
   OpenF1 coordinates are in metres, typically ±500–3000m range.
   We normalise so the longest axis = 18 Three.js units.
   ─────────────────────────────────────────────────────────────── */
function normalisePoints(pts: OpenF1Point[]): { points: OpenF1Point[]; scale: number } {
    if (pts.length === 0) return { points: [], scale: 1 };
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const spread = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = 18 / spread;
    // Exaggerate elevation 5× so you can clearly see hills/banking
    const zScale = 5;
    return {
        points: pts.map((p) => ({
            ...p,
            x: (p.x - cx) * scale,
            y: (p.z - cz) * scale * zScale,  // Z-axis in OpenF1 = elevation → Y in 3D world
            z: (p.y - cy) * scale,            // Y in OpenF1 (horizontal) → Z in 3D world
        })),
        scale,
    };
}

/* ── Per-vertex coloured tube ─────────────────────────────────── */
function TrackTube({ points }: { points: OpenF1Point[] }) {
    const meshRef = useRef<Mesh>(null);

    const { geometry } = useMemo(() => {
        if (points.length < 4) return { geometry: new BufferGeometry() };

        const speeds = points.map((p) => p.speed);
        const minSpeed = Math.min(...speeds);
        const maxSpeed = Math.max(...speeds);

        // Build CatmullRom curve through all position points
        const curve = new CatmullRomCurve3(
            points.map((p) => new Vector3(p.x, p.y, p.z)),
            true,  // closed loop
            'catmullrom',
            0.5,
        );

        const tubeSegments = Math.min(points.length * 3, 2000);
        const tube = new TubeGeometry(curve, tubeSegments, 0.18, 10, true);

        // Map speed colour to each vertex
        const positionAttr = tube.getAttribute('position');
        const vertexCount = positionAttr.count;
        const colors = new Float32Array(vertexCount * 3);

        for (let i = 0; i < vertexCount; i++) {
            // Map vertex index back to original speed point
            const pct = i / vertexCount;
            const srcIdx = Math.min(Math.floor(pct * points.length), points.length - 1);
            const c = speedToColor(points[srcIdx].speed, minSpeed, maxSpeed);
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        tube.setAttribute('color', new Float32BufferAttribute(colors, 3));
        return { geometry: tube };
    }, [points]);

    return (
        <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial
                vertexColors
                roughness={0.35}
                metalness={0.15}
                envMapIntensity={0.5}
            />
        </mesh>
    );
}

/* ── Braking zones ─────────────────────────────────────────────── */
function BrakingZones({ points }: { points: OpenF1Point[] }) {
    const brakePoints = useMemo(
        () => points.filter((p, i) => p.brake && i % 3 === 0),
        [points],
    );

    return (
        <>
            {brakePoints.map((p, i) => (
                <mesh key={i} position={[p.x, p.y + 0.22, p.z]} castShadow>
                    <sphereGeometry args={[0.22, 8, 6]} />
                    <meshStandardMaterial
                        color="#ff4022"
                        emissive="#ff2000"
                        emissiveIntensity={0.5}
                        roughness={0.4}
                    />
                </mesh>
            ))}
        </>
    );
}

/* ── Start / finish marker ─────────────────────────────────────── */
function StartFinishMarker({ pos }: { pos: Vector3 }) {
    return (
        <group position={[pos.x, pos.y + 0.34, pos.z]}>
            <mesh>
                <boxGeometry args={[0.08, 0.7, 1.2]} />
                <meshStandardMaterial color="#ffffff" roughness={0.5} />
            </mesh>
            <Text
                position={[0, 0.6, 0]}
                fontSize={0.5}
                color="#ffffff"
                anchorX="center"
                anchorY="bottom"
                font="https://fonts.gstatic.com/s/barlowcondensed/v12/HTxwL3I-JCGChYJ8VI-L6OO_au7B461yzA.woff2"
            >
                S/F
            </Text>
        </group>
    );
}

/* ── DRS zone highlight ────────────────────────────────────────── */
function DRSZone({ points }: { points: OpenF1Point[] }) {
    // Approximate DRS: long straight sections with high speed + throttle
    const drsPoints = useMemo(() => {
        return points.filter(
            (p, i) => p.speed > 250 && p.throttle > 85 && i % 6 === 0
        );
    }, [points]);

    if (drsPoints.length === 0) return null;

    return (
        <>
            {drsPoints.map((p, i) => (
                <mesh key={i} position={[p.x, p.y + 0.12, p.z]}>
                    <sphereGeometry args={[0.13, 6, 5]} />
                    <meshStandardMaterial
                        color="#40c8ff"
                        emissive="#0088ff"
                        emissiveIntensity={0.4}
                        transparent
                        opacity={0.7}
                    />
                </mesh>
            ))}
        </>
    );
}

/* ── Scene renderer ────────────────────────────────────────────── */
function RendererSetup() {
    const { gl } = useThree();
    useEffect(() => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
    }, [gl]);
    return null;
}

/* ── Scene lights ───────────────────────────────────────────────── */
function SceneLights() {
    const ref = useRef<DirectionalLight>(null);
    return (
        <>
            <ambientLight intensity={0.8} color="#d8e0f0" />
            <directionalLight
                ref={ref}
                position={[12, 18, 10]}
                intensity={2.2}
                color="#fff8ee"
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
            />
            <directionalLight position={[-10, 8, -8]} intensity={0.7} color="#88aadd" />
            {/* Under-bounce */}
            <hemisphereLight args={[new Color('#d0dbee'), new Color('#181620'), 0.35]} />
        </>
    );
}

/* ── Ground plane ───────────────────────────────────────────────── */
function Ground() {
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]} receiveShadow>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#1c1c28" roughness={0.9} metalness={0.05} />
        </mesh>
    );
}

/* ── Live position dot ──────────────────────────────────────────── */
function LiveDot({ points, speed }: { points: OpenF1Point[]; speed: number }) {
    const meshRef = useRef<Mesh>(null);
    const idx = useRef(0);

    useFrame(() => {
        if (!meshRef.current || points.length === 0) return;
        idx.current = (idx.current + Math.floor(speed / 12)) % points.length;
        const p = points[idx.current];
        if (p) {
            meshRef.current.position.set(p.x, p.y + 0.3, p.z);
        }
    });

    if (points.length === 0) return null;
    const first = points[0];
    return (
        <mesh ref={meshRef} position={[first.x, first.y + 0.3, first.z]}>
            <sphereGeometry args={[0.32, 14, 12]} />
            <meshStandardMaterial
                color="#e10600"
                emissive="#e10600"
                emissiveIntensity={0.9}
                roughness={0.3}
                metalness={0.2}
            />
        </mesh>
    );
}

/* ── Speed legend overlay ───────────────────────────────────────── */
function SpeedLegend() {
    const stops = [
        { label: 'Slow', color: '#1440e6' },
        { label: 'Med', color: '#18e840' },
        { label: 'Fast', color: '#e84018' },
    ];
    return (
        <div style={{
            position: 'absolute', bottom: 14, right: 14,
            display: 'flex', gap: 12, alignItems: 'center',
            fontFamily: 'var(--ff-display)', fontSize: '0.55rem',
            fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'rgba(245,245,247,0.55)', zIndex: 5, pointerEvents: 'none',
        }}>
            {stops.map((s) => (
                <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: s.color, display: 'inline-block', boxShadow: `0 0 6px ${s.color}`,
                    }} />
                    {s.label}
                </span>
            ))}
            <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4022', display: 'inline-block' }} />
                Braking
            </span>
            <span style={{ marginLeft: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#40c8ff', display: 'inline-block' }} />
                DRS
            </span>
        </div>
    );
}

/* ── Main export ────────────────────────────────────────────────── */
interface TrackMap3DProps {
    trackId: string;
}

export default function TrackMap3D({ trackId }: TrackMap3DProps) {
    const [points, setPoints] = useState<OpenF1Point[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!trackId) return;
        setLoading(true);
        setError('');
        setPoints([]);
        fetchTrack3D(trackId)
            .then((data) => {
                const { points: norm } = normalisePoints(data);
                setPoints(norm);
            })
            .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load track data'))
            .finally(() => setLoading(false));
    }, [trackId]);

    const startPos = useMemo(
        () => (points.length > 0 ? new Vector3(points[0].x, points[0].y, points[0].z) : null),
        [points],
    );

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            {loading && (
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 12, zIndex: 10,
                    fontFamily: 'var(--ff-display)', color: 'rgba(245,245,247,0.45)',
                }}>
                    <div style={{ fontSize: '0.6rem', letterSpacing: '0.28em', textTransform: 'uppercase', fontWeight: 700 }}>
                        Fetching OpenF1 track data…
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                        {[0, 1, 2].map((i) => (
                            <span key={i} style={{
                                display: 'block', width: 26, height: 2,
                                background: 'rgba(255,255,255,0.5)',
                                animation: `bar 900ms ease-in-out ${i * 150}ms infinite`,
                            }} />
                        ))}
                    </div>
                </div>
            )}

            {error && !loading && (
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: 24, zIndex: 10,
                    fontFamily: 'var(--ff-display)', color: 'rgba(245,245,247,0.5)',
                    textAlign: 'center',
                }}>
                    <div style={{ fontSize: '0.62rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                        OpenF1 data unavailable
                    </div>
                    <div style={{ fontSize: '0.55rem', color: 'rgba(245,245,247,0.3)', maxWidth: 320 }}>
                        {error}
                    </div>
                </div>
            )}

            {points.length > 0 && !loading && (
                <>
                    <Canvas
                        shadows="soft"
                        camera={{
                            // Fixed isometric-ish angle like the Tilke reference:
                            // slightly elevated, looking down at ~38° in from the side
                            position: [14, 18, 16],
                            fov: 38,
                            near: 0.1,
                            far: 200,
                        }}
                        gl={{ antialias: true }}
                        style={{ width: '100%', height: '100%' }}
                    >
                        <RendererSetup />
                        <SceneLights />
                        <Ground />

                        <TrackTube points={points} />
                        <BrakingZones points={points} />
                        <DRSZone points={points} />
                        {startPos && <StartFinishMarker pos={startPos} />}
                        <LiveDot points={points} speed={2} />

                        {/*
              Allow gentle pan + zoom for exploration,
              but no rotation — fixed top-down angle.
            */}
                        <OrbitControls
                            makeDefault
                            enableRotate={false}
                            enablePan
                            enableZoom
                            minDistance={8}
                            maxDistance={55}
                            panSpeed={0.6}
                            zoomSpeed={0.8}
                        />
                    </Canvas>
                    <SpeedLegend />
                </>
            )}
        </div>
    );
}
