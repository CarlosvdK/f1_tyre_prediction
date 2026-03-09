import { ContactShadows, OrbitControls, Html } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { useGLTF } from '@react-three/drei';
import type { Compound, Prediction } from '../data/api';
import {
  useFBXModel,
  useGLTFModel,
  useModelManifest,
  useOBJModel,
  useOBJModelWithMTL,
} from '../three/modelLoader';
import type { TireHoverState } from '../three/raycastHover';
import { useTireRaycastHover } from '../three/raycastHover';
import {
  applyCompoundAndWear,
  findTireMeshes,
  normalizeWearMap,
  type TireMeshEntry,
  type TireWearMap,
} from '../three/tireStyling';
import Tooltip from './Tooltip';

interface CarViewerProps {
  compound: Compound;
  wear: {
    wear_FL?: number;
    wear_FR?: number;
    wear_RL?: number;
    wear_RR?: number;
  };
  prediction?: Prediction | null;
  currentLap?: number;
  onModelMetaChange?: (meta: {
    modelPath?: string;
    modelType?: string;
    tireCount: number;
    error?: string;
  }) => void;
}

interface ModelAssetProps {
  modelPath: string;
  compound: Compound;
  wear: TireWearMap;
  prediction?: Prediction | null;
  currentLap?: number;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}

const tireMaterialPattern = /(tire|tyre|wheel|rim|sidewall|pirelli)/i;

function configureMeshShadows(root: Object3D): void {
  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function tuneVehicleMaterials(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((mat) => {
      if (!(mat instanceof MeshStandardMaterial)) return;
      const id = `${child.name} ${mat.name}`.toLowerCase();
      if (tireMaterialPattern.test(id)) {
        mat.roughness = MathUtils.clamp(mat.roughness * 1.05, 0.5, 0.96);
        mat.metalness = MathUtils.clamp(mat.metalness * 0.5, 0, 0.1);
        mat.envMapIntensity = 0.2;
      } else {
        mat.roughness = MathUtils.clamp(mat.roughness * 0.60, 0.05, 0.45);
        mat.metalness = MathUtils.clamp(Math.max(mat.metalness, 0.35), 0.2, 0.95);
        mat.envMapIntensity = 0.5; // low reflection since no HDRI is present
      }
      if ('clearcoat' in mat) {
        (mat as MeshStandardMaterial & { clearcoat?: number; clearcoatRoughness?: number }).clearcoat = 1.0;
        (mat as MeshStandardMaterial & { clearcoat?: number; clearcoatRoughness?: number }).clearcoatRoughness = 0.06;
      }
      mat.needsUpdate = true;
    });
  });
}

function normalizeObject(root: Object3D): Object3D {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  root.scale.multiplyScalar(3.6 / maxDim);

  const resized = new Box3().setFromObject(root);
  const center = resized.getCenter(new Vector3());
  root.position.sub(center);
  const floorBox = new Box3().setFromObject(root);
  root.position.y -= floorBox.min.y;

  configureMeshShadows(root);
  tuneVehicleMaterials(root);
  return root;
}

/* ── Renderer setup ─────────────────────────────────────────────── */
function RendererSetup() {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.4; // balanced — HDRI adds fill so we don't need to over-expose
    gl.shadowMap.enabled = true;
  }, [gl]);
  return null;
}

/**
 * Overhead key with controlled side fills.
 */
function DynamicGarageLights() {
  return (
    <>
      <spotLight
        position={[0, 7.2, 0]}
        angle={0.4}
        intensity={760}
        penumbra={0.34}
        color="#fff1d6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0001}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        decay={1.45}
        distance={14}
      />

      {/* Side fills to bring out bodywork on both flanks */}
      <pointLight
        position={[3.9, 1.25, 0]}
        intensity={74}
        color="#f8f4ea"
        distance={5.2}
        decay={2.0}
      />
      <pointLight
        position={[-3.9, 1.25, 0]}
        intensity={74}
        color="#f8f4ea"
        distance={5.2}
        decay={2.0}
      />
    </>
  );
}


/* ── Studio GLB environment ─────────────────────────────────────── */
function StudioEnvironment() {
  const { scene } = useGLTF('/models/studio_v1_for_car.glb');
  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.receiveShadow = true;
      child.castShadow = false;
      // Kill all light reflections on studio floor / walls
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m instanceof MeshStandardMaterial) {
          m.roughness = 1.0;
          m.metalness = 0.0;
          m.envMapIntensity = 0.0;
          m.needsUpdate = true;
        }
      });
    });
  }, [scene]);
  return <primitive object={scene} />;
}

/* ── Car model ──────────────────────────────────────────────────── */
function ModelInstance({
  object, compound, wear, prediction, currentLap, onTireCountChange, onHoverChange, onReady,
}: {
  object: Object3D; compound: Compound; wear: TireWearMap;
  prediction?: Prediction | null; currentLap?: number;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const holderRef = useRef<Group>(null);
  const normalized = useMemo(() => normalizeObject(object), [object]);
  const tires = useMemo(() => findTireMeshes(normalized), [normalized]);
  const hoverState = useTireRaycastHover(tires, wear);

  // Filter down to EXACTLY 4 main wheels by taking the first mesh matched per WheelId (FL, FR, RL, RR)
  const uniqueTires = useMemo(() => {
    const map = new Map<string, TireMeshEntry>();
    for (const t of tires) {
      if (t.id !== 'UNKNOWN' && !map.has(t.id)) {
        map.set(t.id, t);
      }
    }
    return Array.from(map.values());
  }, [tires]);

  useEffect(() => { onTireCountChange(uniqueTires.length); onReady(); }, [onTireCountChange, onReady, uniqueTires.length]);
  useEffect(() => { applyCompoundAndWear(tires, compound, wear); }, [tires, compound, wear]);
  useEffect(() => { onHoverChange(hoverState); }, [hoverState, onHoverChange]);

  useFrame(({ clock }) => {
    if (!holderRef.current) return;
    holderRef.current.position.y = Math.sin(clock.getElapsedTime() * 0.55) * 0.005;
  });

  return (
    <group ref={holderRef}>
      <primitive object={normalized} />
      {uniqueTires.map((t) => {
        const w = wear[t.id as keyof TireWearMap] ?? 0.2;
        const lifePct = Math.max(0, Math.round((1 - w) * 100));

        // Calculate dynamic color from green (100) to red (0)
        const r = lifePct < 50 ? 255 : Math.round(255 - (lifePct - 50) * 5.1);
        const g = lifePct > 50 ? 255 : Math.round(lifePct * 5.1);
        const color = `rgb(${r}, ${g}, 0)`;

        t.mesh.updateMatrixWorld();
        const bbox = new Box3().setFromObject(t.mesh);
        const center = new Vector3();
        bbox.getCenter(center);

        // Measure bounding box to see which axis is narrowest (that's the axle)
        const size = bbox.getSize(new Vector3());

        normalized.worldToLocal(center);

        let tx = center.x;
        let tz = center.z;
        let lineX = center.x;
        let lineZ = center.z;
        let cylinderRot: [number, number, number] = [0, 0, 0];

        const isLeft = t.id.includes('L');
        const stemLength = 0.6;
        const tempProxyC = Math.round(84 + w * 76);

        // If X axis is the thinnest, the axle points along X (Left/Right)
        if (size.x < size.z) {
          const dir = center.x > 0 ? 1 : -1;
          tx = center.x + (stemLength * dir);
          lineX = center.x + ((stemLength / 2) * dir);
          cylinderRot = [0, 0, Math.PI / 2];
        } else {
          // Z axis is the axle
          const dir = center.z > 0 ? 1 : -1;
          tz = center.z + (stemLength * dir);
          lineZ = center.z + ((stemLength / 2) * dir);
          cylinderRot = [Math.PI / 2, 0, 0];
        }

        const isHovered = hoverState?.tireId === t.id;
        const opacity = isHovered ? 1 : 0.82;

        return (
          <group key={`ui-${t.id}`}>
            {/* Physical 3D Leader Line stemming exactly from the axle */}
            <mesh position={[lineX, center.y, lineZ]} rotation={cylinderRot}>
              <cylinderGeometry args={[0.008, 0.008, stemLength, 8]} />
              <meshBasicMaterial color={color} transparent opacity={opacity} />
            </mesh>

            {/* The Text Label itself. occlude automatically hides it behind the car */}
            <Html
              position={[tx, center.y, tz]}
              center
              occlude="blending"
              style={{
                pointerEvents: 'none',
                transition: 'opacity 0.2s ease-in-out',
                opacity: opacity
              }}
            >
              <div className={`tyre-life-container ${isLeft ? 'left-side' : 'right-side'} ${isHovered ? 'hovered' : ''}`}>
                <div className="tyre-life-head">
                  <span className="tyre-life-id">{t.id}</span>
                  <span className="tyre-life-temp">{tempProxyC}°C</span>
                </div>
                <div className="tyre-life-label" style={{ color }}>
                  {lifePct}% LIFE
                </div>
                <div className="tyre-life-meter">
                  <span style={{ width: `${lifePct}%`, background: color }} />
                </div>
              </div>
            </Html>
          </group>
        );
      })}
      {prediction && (
        <Html
          position={[0, 1.22, 0]}
          center
          occlude="blending"
          style={{ pointerEvents: 'none' }}
        >
          <div className="car-strategy-chip">
            <div className="car-strategy-title">Live Strategy Readout</div>
            <div className="car-strategy-grid">
              <span>Pit Window</span>
              <strong>L{prediction.pit_window_start}–L{prediction.pit_window_end}</strong>
              <span>Target Stop</span>
              <strong>L{prediction.strategy_optimal_pit_lap ?? '—'}</strong>
              <span>Pace Loss</span>
              <strong>{prediction.sec_per_lap_increase.toFixed(3)} s/lap</strong>
              <span>Laps To Pit</span>
              <strong>
                {prediction.strategy_optimal_pit_lap && currentLap
                  ? Math.max(0, prediction.strategy_optimal_pit_lap - currentLap)
                  : '—'}
              </strong>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function GLTFAsset(props: ModelAssetProps) {
  return <ModelInstance object={useGLTFModel(props.modelPath)} {...props} />;
}
function FBXAsset(props: ModelAssetProps) {
  return <ModelInstance object={useFBXModel(props.modelPath)} {...props} />;
}
function OBJAsset(props: ModelAssetProps & { texturePath?: string }) {
  return <ModelInstance object={useOBJModel(props.modelPath, props.texturePath)} {...props} />;
}
function OBJWithMTLAsset(props: ModelAssetProps & { mtlPath: string; texturePath?: string }) {
  return <ModelInstance object={useOBJModelWithMTL(props.modelPath, props.mtlPath, props.texturePath)} {...props} />;
}

function PlaceholderWheel({ id, position }: { id: 'FL' | 'FR' | 'RL' | 'RR'; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh name={`tire_${id.toLowerCase()}`} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.28, 32]} />
        <meshStandardMaterial name={`sidewall_${id}`} color="#161214" roughness={0.56} metalness={0.04} />
      </mesh>
      <mesh name={`hub_${id}`} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.29, 24]} />
        <meshStandardMaterial color="#484e5a" roughness={0.42} metalness={0.5} />
      </mesh>
    </group>
  );
}

function PlaceholderModel({
  compound, wear, onTireCountChange, onHoverChange, onReady,
}: {
  compound: Compound; wear: TireWearMap;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const groupRef = useRef<Group>(null);
  const [tires, setTires] = useState<TireMeshEntry[]>([]);
  const hoverState = useTireRaycastHover(tires, wear);

  useEffect(() => {
    if (!groupRef.current) return;
    configureMeshShadows(groupRef.current);
    const found = findTireMeshes(groupRef.current);
    setTires(found); onTireCountChange(found.length); onReady();
  }, [onReady, onTireCountChange]);

  useEffect(() => { applyCompoundAndWear(tires, compound, wear); }, [tires, compound, wear]);
  useEffect(() => { onHoverChange(hoverState); }, [hoverState, onHoverChange]);

  return (
    <group ref={groupRef} position={[0, 0.38, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4.9, 0.36, 1.9]} />
        <meshStandardMaterial color="#1a1f2e" roughness={0.28} metalness={0.52} />
      </mesh>
      <mesh position={[0.52, 0.4, 0]} castShadow>
        <boxGeometry args={[2.5, 0.56, 1.24]} />
        <meshStandardMaterial color="#1a2e44" roughness={0.24} metalness={0.46} />
      </mesh>
      <PlaceholderWheel id="FL" position={[1.22, -0.12, 1.07]} />
      <PlaceholderWheel id="FR" position={[1.22, -0.12, -1.07]} />
      <PlaceholderWheel id="RL" position={[-1.52, -0.12, 1.07]} />
      <PlaceholderWheel id="RR" position={[-1.52, -0.12, -1.07]} />
    </group>
  );
}

function ResolvedModel({
  modelPath, modelType, mtlPath, texturePath, compound, wear, prediction, currentLap,
  onTireCountChange, onHoverChange, onReady,
}: {
  modelPath: string; modelType: string; mtlPath?: string; texturePath?: string;
  compound: Compound; wear: TireWearMap; prediction?: Prediction | null; currentLap?: number;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const p = { modelPath, compound, wear, prediction, currentLap, onTireCountChange, onHoverChange, onReady };
  if (modelType === 'glb' || modelType === 'gltf') return <GLTFAsset {...p} />;
  if (modelType === 'fbx') return <FBXAsset {...p} />;
  if (modelType === 'obj' && mtlPath) return <OBJWithMTLAsset {...p} mtlPath={mtlPath} texturePath={texturePath} />;
  if (modelType === 'obj') return <OBJAsset {...p} texturePath={texturePath} />;
  return null;
}

/**
 * Camera: zoomed out to [0, 1.8, 5.0] fov 42 — more of the car visible.
 * Orbit locked to radius 5.0 (inside studio walls).
 * Azimuth clamped to ±140° — stops just before the rear wall blocks the view.
 * Polar: from 11° (eye-level) to 83° (never upside-down).
 */
export default function CarViewer({ compound, wear, prediction, currentLap, onModelMetaChange }: CarViewerProps) {
  const { manifest, loading, error } = useModelManifest();
  const [tireCount, setTireCount] = useState(0);
  const [hover, setHover] = useState<TireHoverState | null>(null);
  const [modelReady, setModelReady] = useState(false);

  const wearMap = useMemo(() => normalizeWearMap(wear), [wear]);
  const usePlaceholder = !loading && (!!error || !manifest || manifest.placeholder || !manifest.modelPath);

  useEffect(() => { setModelReady(false); }, [manifest?.modelPath]);

  const handleModelMeta = useCallback(() => {
    onModelMetaChange?.({
      modelPath: manifest?.modelPath || undefined,
      modelType: manifest?.placeholder ? 'placeholder' : manifest?.modelType,
      tireCount,
      error: error ?? undefined,
    });
  }, [manifest, tireCount, error, onModelMetaChange]);

  useEffect(() => { handleModelMeta(); }, [handleModelMeta]);

  return (
    <div className="scene-canvas">
      {(loading || !modelReady) && (
        <div className="viewer-loading">
          <div className="loading-title">{loading ? 'Loading scene' : 'Building studio'}</div>
          <div className="loading-bars"><span /><span /><span /></div>
        </div>
      )}
      {!loading && usePlaceholder && <div className="viewer-msg">Placeholder model</div>}
      {error && !loading && <div className="viewer-msg error">{error}</div>}

      <Canvas
        shadows="soft"
        camera={{ position: [0, 0.35, 2.4], fov: 62, near: 0.05, far: 200 }}
        gl={{ antialias: true }}
      >
        <RendererSetup />
        <DynamicGarageLights />
        {/* Fog fades the back wall to near-black — tunnel depth illusion */}
        <fog attach="fog" args={['#07080f', 7, 18]} />


        <Suspense fallback={null}>
          {/* Studio background geometry */}
          <StudioEnvironment />

          {/* Contact shadow catcher — projects a soft shadow under the car */}
          <ContactShadows
            position={[0, 0.01, 0]}
            opacity={0.65}
            scale={14}
            blur={2.8}
            far={8}
            frames={30}
            color="#050306"
          />

          {/* Car */}
          {!usePlaceholder && manifest && (
            <ResolvedModel
              modelPath={manifest.modelPath}
              modelType={manifest.modelType ?? 'glb'}
              mtlPath={manifest.mtlPath}
              texturePath={manifest.texturePath}
              compound={compound}
              wear={wearMap}
              prediction={prediction}
              currentLap={currentLap}
              onTireCountChange={setTireCount}
              onHoverChange={setHover}
              onReady={() => setModelReady(true)}
            />
          )}
          {usePlaceholder && (
            <PlaceholderModel
              compound={compound}
              wear={wearMap}
              onTireCountChange={setTireCount}
              onHoverChange={setHover}
              onReady={() => setModelReady(true)}
            />
          )}
        </Suspense>

        {/*
          Orbit locked to radius 4.0 — camera stays well clear of studio walls.
          Full horizontal rotation. Polar: 12° min (eye level) to 84° max.
        */}
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.07}
          rotateSpeed={0.48}
          minDistance={2.4}
          maxDistance={2.4}
          minPolarAngle={1.42}
          maxPolarAngle={1.42}
          minAzimuthAngle={-1.57}
          maxAzimuthAngle={0.90}
          target={[0, 0.28, 0]}
        />
      </Canvas>

      <Tooltip
        visible={Boolean(hover)}
        tireId={hover?.tireId}
        wearPct={(hover?.wear ?? 0) * 100}
        tempProxyC={hover?.tempProxyC}
        compound={compound}
        prediction={prediction}
        currentLap={currentLap}
      />
    </div>
  );
}
