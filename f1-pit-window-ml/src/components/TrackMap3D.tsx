/**
 * TrackMap3D — F1 circuit visualisation using local circuit coordinate data.
 *
 * Uses hand-crafted 40-point waypoints (circuitCoords.ts) that match real
 * circuit layouts. CatmullRom spline interpolates 600+ smooth points between
 * the waypoints, producing an accurate circuit shape for any camera angle.
 *
 * Visual style: matches Tilke architectural diagrams —
 *   - Thick white/silver track tube
 *   - Speed-colour overlay (blue → cyan → white → orange → red)
 *   - Red brake zone disc markers
 *   - Corner name labels floating above key turns
 *   - Dark background, isometric top-down camera
 */

import { OrbitControls, Text } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
    ACESFilmicToneMapping,
    BufferGeometry,
    CatmullRomCurve3,
    Color,
    Float32BufferAttribute,
    TubeGeometry,
    Vector3,
} from 'three';
import { getCircuitPath, type CircuitWaypoint } from '../data/circuitCoords';

/* ── Speed → Colour ──────────────────────────────────────────────────
   F1 broadcast palette:
   Very slow → deep blue   Slow → blue  Med → cyan-green
   Fast → yellow/orange    Very fast → white (>300 km/h)
   ─────────────────────────────────────────────────────────────────── */
function speedColor(speed: number, lo: number, hi: number): Color {
    const t = Math.max(0, Math.min(1, (speed - lo) / Math.max(hi - lo, 1)));
    const c = new Color();
    if (t < 0.25) c.setRGB(0.05 + t * 0.5, 0.20 + t * 1.6, 0.90);
    else if (t < 0.50) c.setRGB(0.18 - (t - 0.25) * 0.4, 0.60 + (t - 0.25) * 1.2, 0.90 - (t - 0.25) * 2.4);
    else if (t < 0.75) c.setRGB(0.08 + (t - 0.50) * 3.6, 0.90 - (t - 0.50) * 1.0, 0.30 - (t - 0.50) * 1.0);
    else c.setRGB(0.98, 0.90 - (t - 0.75) * 1.2, 0.08 + (t - 0.75) * 0.4);
    return c;
}

/* ── Expand 40 waypoints → 600-point smooth path ───────────────────
   Uses CatmullRom for geometry and linearly interpolates speed/brake
   across segments so colours are continuous.
   ─────────────────────────────────────────────────────────────────── */
interface ExpandedPoint {
    pos: Vector3;
    speed: number;
    brake: boolean;
    label?: string;
}

function expandWaypoints(wps: CircuitWaypoint[], totalPts = 600): ExpandedPoint[] {
    if (wps.length < 3) return [];
    const curve = new CatmullRomCurve3(
        wps.map((p) => new Vector3(p.x, p.y, p.z)),
        true, 'catmullrom', 0.4,
    );
    const positions = curve.getPoints(totalPts - 1);
    const n = wps.length;

    return positions.map((pos, i) => {
        const t = i / (totalPts - 1);   // 0–1 around the loop
        const seg = t * (n - 1);            // fractional waypoint index
        const lo = Math.floor(seg) % n;
        const hi = Math.ceil(seg) % n;
        const f = seg - Math.floor(seg);
        const speed = wps[lo].speed + (wps[hi].speed - wps[lo].speed) * f;
        const brake = f < 0.5 ? wps[lo].brake : wps[hi].brake;
        // Only annotate at the closest sample to each waypoint with a label
        const label = f < 0.015 ? wps[lo].label : undefined;
        return { pos, speed, brake, label };
    });
}

/* ── Track Tube ─────────────────────────────────────────────────── */
function TrackTube({ pts }: { pts: ExpandedPoint[] }) {
    const geo = useMemo(() => {
        if (pts.length < 4) return new BufferGeometry();
        const speeds = pts.map((p) => p.speed);
        const lo = Math.min(...speeds);
        const hi = Math.max(...speeds);

        const curve = new CatmullRomCurve3(pts.map((p) => p.pos), true, 'catmullrom', 0.4);
        const segs = pts.length;
        const tube = new TubeGeometry(curve, segs, 0.24, 12, true);

        const posAttr = tube.getAttribute('position');
        const cols = new Float32Array(posAttr.count * 3);
        for (let i = 0; i < posAttr.count; i++) {
            const pct = i / posAttr.count;
            const si = Math.min(Math.floor(pct * pts.length), pts.length - 1);
            const c = speedColor(pts[si].speed, lo, hi);
            cols[i * 3] = c.r;
            cols[i * 3 + 1] = c.g;
            cols[i * 3 + 2] = c.b;
        }
        tube.setAttribute('color', new Float32BufferAttribute(cols, 3));
        return tube;
    }, [pts]);

    return (
        <mesh geometry={geo} castShadow>
            <meshStandardMaterial vertexColors roughness={0.26} metalness={0.04} envMapIntensity={0} />
        </mesh>
    );
}

/* ── Brake zone markers (red flat discs) ────────────────────────── */
function BrakeZones({ pts }: { pts: ExpandedPoint[] }) {
    const zones = useMemo(
        () => pts.filter((p, i) => p.brake && i % 8 === 0),
        [pts],
    );
    return (
        <>
            {zones.map((p, i) => (
                <mesh key={i} position={[p.pos.x, p.pos.y + 0.38, p.pos.z]} rotation={[0, 0, 0]}>
                    <cylinderGeometry args={[0.2, 0.2, 0.07, 10]} />
                    <meshStandardMaterial
                        color="#ff2810"
                        emissive="#cc1c00"
                        emissiveIntensity={1.0}
                        roughness={0.4}
                        envMapIntensity={0}
                    />
                </mesh>
            ))}
        </>
    );
}

/* ── Corner name labels ─────────────────────────────────────────── */
function CornerLabels({ pts }: { pts: ExpandedPoint[] }) {
    const labelled = useMemo(
        () => pts.filter((p) => Boolean(p.label)),
        [pts],
    );
    return (
        <>
            {labelled.map((p, i) => (
                <Text
                    key={i}
                    position={[p.pos.x, p.pos.y + 0.72, p.pos.z]}
                    fontSize={0.22}
                    color="rgba(245,245,247,0.65)"
                    anchorX="center"
                    anchorY="bottom"
                    // face the camera (billboarding)
                    renderOrder={1}
                >
                    {p.label}
                </Text>
            ))}
        </>
    );
}

/* ── Start/Finish ─────────────────────────────────────────────── */
function SFMarker({ pos }: { pos: Vector3 }) {
    return (
        <group position={[pos.x, pos.y + 0.5, pos.z]}>
            <mesh>
                <boxGeometry args={[0.06, 1.0, 1.0]} />
                <meshStandardMaterial color="#ffffff" roughness={0.5} envMapIntensity={0} />
            </mesh>
            <Text position={[0, 0.72, 0]} fontSize={0.3} color="#ffffff" anchorX="center" anchorY="bottom">
                S/F
            </Text>
        </group>
    );
}

/* ── Scene setup ─────────────────────────────────────────────────── */
function SceneSetup() {
    const { gl, scene: s } = useThree();
    useEffect(() => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        s.background = new Color('#0d0d1c');
    }, [gl, s]);
    return null;
}

/* ── Ground plane ─────────────────────────────────────────────── */
function Ground() {
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]} receiveShadow>
            <planeGeometry args={[60, 60]} />
            <meshStandardMaterial color="#111120" roughness={1} metalness={0} envMapIntensity={0} />
        </mesh>
    );
}

/* ── Speed legend ─────────────────────────────────────────────── */
const LEGEND_STOPS = [
    { label: 'Slow', color: '#1855e8' },
    { label: 'Med', color: '#00cfa0' },
    { label: 'Fast', color: '#ff9910' },
    { label: '>300', color: '#ffffff' },
    { label: 'Brake', color: '#ff2810' },
];

function Legend({ trackId, corners }: { trackId: string; corners: number }) {
    const name = trackId.charAt(0).toUpperCase() + trackId.slice(1);
    return (
        <>
            {/* Top-left track info */}
            <div style={{
                position: 'absolute', top: 16, left: 16,
                fontFamily: 'var(--ff-display)', pointerEvents: 'none', zIndex: 5,
            }}>
                <div style={{
                    fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: 'rgba(245,245,247,0.92)'
                }}>
                    {name}
                </div>
                <div style={{
                    fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase',
                    color: 'rgba(245,245,247,0.38)', marginTop: 4, lineHeight: 2
                }}>
                    {corners} annotated corners · Drag to pan · Scroll to zoom
                </div>
            </div>

            {/* Bottom-right legend */}
            <div style={{
                position: 'absolute', bottom: 16, right: 16,
                display: 'flex', flexDirection: 'column', gap: 7,
                alignItems: 'flex-end',
                fontFamily: 'var(--ff-display)',
                fontSize: '0.52rem', fontWeight: 700,
                letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(245,245,247,0.5)',
                pointerEvents: 'none', zIndex: 5,
            }}>
                {LEGEND_STOPS.map((s) => (
                    <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            width: 9, height: 9, borderRadius: '50%',
                            background: s.color, boxShadow: `0 0 8px ${s.color}88`, flexShrink: 0,
                        }} />
                        {s.label}
                    </span>
                ))}
            </div>
        </>
    );
}

/* ── Main export ─────────────────────────────────────────────────── */
export default function TrackMap3D({ trackId }: { trackId: string }) {
    const [pts, setPts] = useState<ExpandedPoint[]>([]);

    useEffect(() => {
        if (!trackId) return;
        const wps = getCircuitPath(trackId);
        const expanded = expandWaypoints(wps, 600);
        setPts(expanded);
    }, [trackId]);

    const sfPos = pts.length > 0 ? pts[0].pos : null;
    const namedCorners = useMemo(
        () => pts.filter((p) => p.label).length,
        [pts],
    );

    if (pts.length === 0) return null;

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <Canvas
                shadows="soft"
                camera={{ position: [8, 14, 10], fov: 38, near: 0.1, far: 200 }}
                gl={{ antialias: true }}
                style={{ width: '100%', height: '100%' }}
            >
                <SceneSetup />
                <ambientLight intensity={0.85} color="#b8c8e8" />
                <directionalLight
                    position={[12, 18, 10]}
                    intensity={2.2}
                    color="#fff6e8"
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <directionalLight position={[-10, 10, -8]} intensity={0.6} color="#8899cc" />

                <Ground />
                <TrackTube pts={pts} />
                <BrakeZones pts={pts} />
                <CornerLabels pts={pts} />
                {sfPos && <SFMarker pos={sfPos} />}

                {/* Isometric fixed view — pan + zoom only */}
                <OrbitControls
                    makeDefault
                    enableRotate={false}
                    enablePan
                    enableZoom
                    minDistance={5}
                    maxDistance={55}
                    panSpeed={0.55}
                    zoomSpeed={0.7}
                />
            </Canvas>

            <Legend trackId={trackId} corners={namedCorners} />
        </div>
    );
}
