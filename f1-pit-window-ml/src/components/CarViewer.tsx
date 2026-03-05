import { ContactShadows } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  Vector3,
} from 'three';
import type { Compound } from '../data/api';
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
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!(material instanceof MeshStandardMaterial)) return;
      const id = `${child.name} ${material.name}`.toLowerCase();
      if (tireMaterialPattern.test(id)) {
        material.roughness = MathUtils.clamp(material.roughness * 1.05, 0.48, 0.98);
        material.metalness = MathUtils.clamp(material.metalness * 0.5, 0, 0.12);
      } else {
        material.roughness = MathUtils.clamp(material.roughness * 0.78, 0.04, 0.65);
        material.metalness = MathUtils.clamp(Math.max(material.metalness, 0.22), 0.08, 0.9);
        material.envMapIntensity = 1.45;
      }
      if ('clearcoat' in material) {
        (material as MeshStandardMaterial & { clearcoat?: number; clearcoatRoughness?: number }).clearcoat = 1.0;
        (material as MeshStandardMaterial & { clearcoat?: number; clearcoatRoughness?: number }).clearcoatRoughness = 0.1;
      }
      material.needsUpdate = true;
    });
  });
}

function normalizeObject(root: Object3D): Object3D {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 5.45 / maxDim;
  root.scale.multiplyScalar(scale);

  const resized = new Box3().setFromObject(root);
  const center = resized.getCenter(new Vector3());
  root.position.sub(center);

  const floorBox = new Box3().setFromObject(root);
  root.position.y -= floorBox.min.y;

  configureMeshShadows(root);
  tuneVehicleMaterials(root);
  return root;
}

/** Dark carbon/asphalt ground with a subtle red glow under the car */
function createGroundTexture(): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Deep carbon base
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, size, size);

  // Red under-glow radial
  const glow = ctx.createRadialGradient(size * 0.5, size * 0.48, 20, size * 0.5, size * 0.54, size * 0.58);
  glow.addColorStop(0, 'rgba(200,8,0,0.72)');
  glow.addColorStop(0.38, 'rgba(130,6,0,0.42)');
  glow.addColorStop(1, 'rgba(10,4,8,0.0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Subtle noise grain for asphalt texture
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 10 + Math.random() * 18;
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(5.2, 5.2);
  tex.needsUpdate = true;
  return tex;
}

/** Gradient backdrop like the reference photo */
function createBackdropTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#1a1520');
  grad.addColorStop(0.45, '#0e0c14');
  grad.addColorStop(1, '#06050a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle side vignettes
  const sideGlow = ctx.createRadialGradient(size * 0.5, size * 0.7, size * 0.05, size * 0.5, size * 0.7, size * 0.7);
  sideGlow.addColorStop(0, 'rgba(120,12,6,0.22)');
  sideGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sideGlow;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

function SceneExposure() {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.32;
  }, [gl]);
  return null;
}

/** F1 studio lighting matching the dark action-shot photo */
function StudioLighting({
  groundTexture,
  backdropTexture,
}: {
  groundTexture: CanvasTexture;
  backdropTexture: CanvasTexture;
}) {
  return (
    <>
      {/* Ambient — very dim, cold */}
      <ambientLight intensity={0.18} color="#8090b8" />

      {/* Key light — top-right, warm white */}
      <spotLight
        position={[6.2, 7.5, 5.0]}
        angle={0.42}
        intensity={3.8}
        penumbra={0.38}
        color="#f6f2ff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00018}
      />

      {/* Rim light — left back, cool blue */}
      <directionalLight position={[-7.2, 4.0, -5.5]} intensity={1.4} color="#6ea4e8" />

      {/* Back fill — soft red glow from below rear */}
      <directionalLight position={[0, 1.2, -9]} intensity={0.68} color="#ff4030" />

      {/* Under fill — bounce from ground */}
      <pointLight position={[0, 0.3, 0]} intensity={0.42} color="#b03018" distance={8} />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[54, 40]} />
        <meshStandardMaterial
          map={groundTexture}
          color="#0c0a10"
          roughness={0.18}
          metalness={0.22}
          envMapIntensity={0.9}
        />
      </mesh>

      {/* Backdrop */}
      <mesh position={[0, 7.0, -14.0]}>
        <planeGeometry args={[60, 26]} />
        <meshStandardMaterial map={backdropTexture} roughness={1} metalness={0} />
      </mesh>
    </>
  );
}

function ModelInstance({
  object,
  compound,
  wear,
  onTireCountChange,
  onHoverChange,
  onReady,
}: {
  object: Object3D;
  compound: Compound;
  wear: TireWearMap;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const holderRef = useRef<Group>(null);
  const normalized = useMemo(() => normalizeObject(object), [object]);
  const tires = useMemo(() => findTireMeshes(normalized), [normalized]);
  const hoverState = useTireRaycastHover(tires, wear);

  useEffect(() => {
    onTireCountChange(tires.length);
    onReady();
  }, [onTireCountChange, onReady, tires.length]);

  useEffect(() => {
    applyCompoundAndWear(tires, compound, wear);
  }, [tires, compound, wear]);

  useEffect(() => {
    onHoverChange(hoverState);
  }, [hoverState, onHoverChange]);

  // Subtle breathing animation (very slight — action shot stays mostly static)
  useFrame(({ clock }) => {
    if (!holderRef.current) return;
    const t = clock.getElapsedTime();
    holderRef.current.position.y = Math.sin(t * 0.65) * 0.008;
  });

  return (
    <group ref={holderRef}>
      <primitive object={normalized} />
    </group>
  );
}

function GLTFAsset(props: ModelAssetProps) {
  const object = useGLTFModel(props.modelPath);
  return <ModelInstance object={object} {...props} />;
}

function FBXAsset(props: ModelAssetProps) {
  const object = useFBXModel(props.modelPath);
  return <ModelInstance object={object} {...props} />;
}

function OBJAsset(props: ModelAssetProps & { texturePath?: string }) {
  const object = useOBJModel(props.modelPath, props.texturePath);
  return <ModelInstance object={object} {...props} />;
}

function OBJWithMTLAsset(props: ModelAssetProps & { mtlPath: string; texturePath?: string }) {
  const object = useOBJModelWithMTL(props.modelPath, props.mtlPath, props.texturePath);
  return <ModelInstance object={object} {...props} />;
}

function PlaceholderWheel({
  id,
  position,
}: {
  id: 'FL' | 'FR' | 'RL' | 'RR';
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      <mesh name={`tire_${id.toLowerCase()}`} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.28, 32]} />
        <meshStandardMaterial name={`sidewall_${id}`} color="#1a1a22" roughness={0.55} metalness={0.03} />
      </mesh>
      <mesh name={`hub_${id}`} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.29, 24]} />
        <meshStandardMaterial color="#5a5f6a" roughness={0.42} metalness={0.46} />
      </mesh>
    </group>
  );
}

function PlaceholderModel({
  compound,
  wear,
  onTireCountChange,
  onHoverChange,
  onReady,
}: {
  compound: Compound;
  wear: TireWearMap;
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
    setTires(found);
    onTireCountChange(found.length);
    onReady();
  }, [onReady, onTireCountChange]);

  useEffect(() => { applyCompoundAndWear(tires, compound, wear); }, [tires, compound, wear]);
  useEffect(() => { onHoverChange(hoverState); }, [hoverState, onHoverChange]);

  return (
    <group ref={groupRef} position={[0, 0.38, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4.9, 0.36, 1.9]} />
        <meshStandardMaterial color="#10192a" roughness={0.28} metalness={0.52} />
      </mesh>
      <mesh position={[0.52, 0.4, 0]} castShadow>
        <boxGeometry args={[2.5, 0.56, 1.24]} />
        <meshStandardMaterial color="#1a2e44" roughness={0.24} metalness={0.46} />
      </mesh>
      <mesh position={[-2.26, 0.24, 0]} castShadow>
        <boxGeometry args={[0.94, 0.2, 2.23]} />
        <meshStandardMaterial color="#0c1420" roughness={0.42} metalness={0.28} />
      </mesh>
      <PlaceholderWheel id="FL" position={[1.22, -0.12, 1.07]} />
      <PlaceholderWheel id="FR" position={[1.22, -0.12, -1.07]} />
      <PlaceholderWheel id="RL" position={[-1.52, -0.12, 1.07]} />
      <PlaceholderWheel id="RR" position={[-1.52, -0.12, -1.07]} />
    </group>
  );
}

function ResolvedModel({
  modelPath,
  modelType,
  mtlPath,
  texturePath,
  compound,
  wear,
  onTireCountChange,
  onHoverChange,
  onReady,
}: {
  modelPath: string;
  modelType: string;
  mtlPath?: string;
  texturePath?: string;
  compound: Compound;
  wear: TireWearMap;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const props = { modelPath, compound, wear, onTireCountChange, onHoverChange, onReady };

  if (modelType === 'glb' || modelType === 'gltf') return <GLTFAsset {...props} />;
  if (modelType === 'fbx') return <FBXAsset {...props} />;
  if (modelType === 'obj' && mtlPath) return <OBJWithMTLAsset {...props} mtlPath={mtlPath} texturePath={texturePath} />;
  if (modelType === 'obj') return <OBJAsset {...props} texturePath={texturePath} />;
  return null;
}

/**
 * Camera position to match the reference screenshot:
 * Front-left 3/4 angle, low (just above track level), car fills frame.
 *
 * position = [-5.8, 1.18, 4.6]  → left-front, low
 * target   = [0, 0.82, 0]       → car centre of mass
 * fov      = 36                  → tight crop matching the photo
 *
 * NO OrbitControls — camera is fully locked for the action-shot look.
 */
export default function CarViewer({ compound, wear, onModelMetaChange }: CarViewerProps) {
  const { manifest, loading, error } = useModelManifest();
  const [tireCount, setTireCount] = useState(0);
  const [hover, setHover] = useState<TireHoverState | null>(null);
  const [modelReady, setModelReady] = useState(false);

  const wearMap = useMemo(() => normalizeWearMap(wear), [wear]);
  const groundTexture = useMemo(() => createGroundTexture(), []);
  const backdropTexture = useMemo(() => createBackdropTexture(), []);
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
    <div className="hero-canvas-wrap">
      {(loading || !modelReady) && (
        <div className="viewer-loading">
          <div className="loading-title">
            {loading ? 'Loading model' : 'Initialising 3D scene'}
          </div>
          <div className="loading-bars">
            <span /><span /><span />
          </div>
        </div>
      )}
      {!loading && usePlaceholder && (
        <div className="viewer-message">Placeholder model — no GLB detected</div>
      )}
      {error && !loading && (
        <div className="viewer-message error">{error}</div>
      )}

      {/*
        Camera locked to action-shot angle:
        - position: left-front, low (matches the screenshot composition)
        - fov 36: tight frame, fills the car without distortion
        - No OrbitControls — fully static
      */}
      <Canvas
        shadows
        camera={{ position: [-5.8, 1.18, 4.6], fov: 36, near: 0.1, far: 120 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#050508']} />
        <SceneExposure />
        <StudioLighting groundTexture={groundTexture} backdropTexture={backdropTexture} />
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.7}
          scale={12}
          blur={2.4}
          far={8}
          color="#3d0000"
        />

        <Suspense fallback={null}>
          {!usePlaceholder && manifest && (
            <ResolvedModel
              modelPath={manifest.modelPath}
              modelType={manifest.modelType ?? 'glb'}
              mtlPath={manifest.mtlPath}
              texturePath={manifest.texturePath}
              compound={compound}
              wear={wearMap}
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
      </Canvas>

      <Tooltip
        visible={Boolean(hover)}
        tireId={hover?.tireId}
        wearPct={(hover?.wear ?? 0) * 100}
        tempProxyC={hover?.tempProxyC}
      />
    </div>
  );
}
