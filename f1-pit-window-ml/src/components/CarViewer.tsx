import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import type { Compound, ThemeMode } from '../data/api';
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
  theme: ThemeMode;
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
  theme: ThemeMode;
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

function tuneVehicleMaterials(root: Object3D, theme: ThemeMode): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!(material instanceof MeshStandardMaterial)) {
        return;
      }

      const id = `${child.name} ${material.name}`.toLowerCase();
      if (tireMaterialPattern.test(id)) {
        material.roughness = MathUtils.clamp(material.roughness * 1.05, 0.48, 0.98);
        material.metalness = MathUtils.clamp(material.metalness * 0.5, 0, 0.12);
      } else {
        material.roughness = MathUtils.clamp(material.roughness * 0.82, 0.06, 0.7);
        material.metalness = MathUtils.clamp(Math.max(material.metalness, 0.18), 0.05, 0.85);
        material.envMapIntensity = theme === 'dark' ? 1.3 : 1.05;
      }

      if ('clearcoat' in material) {
        (material as MeshStandardMaterial & { clearcoat?: number; clearcoatRoughness?: number }).clearcoat = theme === 'dark' ? 0.9 : 0.7;
        (material as MeshStandardMaterial & { clearcoat?: number; clearcoatRoughness?: number }).clearcoatRoughness = theme === 'dark' ? 0.12 : 0.16;
      }
      material.needsUpdate = true;
    });
  });
}

function normalizeObject(root: Object3D, theme: ThemeMode): Object3D {
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
  tuneVehicleMaterials(root, theme);
  return root;
}

function createGroundTexture(theme: ThemeMode): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new CanvasTexture(canvas);
  }

  if (theme === 'dark') {
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size * 0.5, size * 0.45, 40, size * 0.5, size * 0.52, size * 0.65);
    gradient.addColorStop(0, 'rgba(168,20,20,0.8)');
    gradient.addColorStop(0.45, 'rgba(108,12,16,0.5)');
    gradient.addColorStop(1, 'rgba(14,8,12,0.0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = '#bfc4ca';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 20000; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const v = 140 + Math.random() * 45;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.strokeStyle = 'rgba(243,245,249,0.95)';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(size * 0.06, size * 0.62);
    ctx.lineTo(size * 0.94, size * 0.62);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(227,79,64,0.82)';
    ctx.lineWidth = 4;
    ctx.setLineDash([28, 18]);
    ctx.beginPath();
    ctx.moveTo(size * 0.06, size * 0.57);
    ctx.lineTo(size * 0.94, size * 0.57);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(6.8, 6.8);
  tex.needsUpdate = true;
  return tex;
}

function createBackdropTexture(theme: ThemeMode): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new CanvasTexture(canvas);
  }

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  if (theme === 'dark') {
    grad.addColorStop(0, '#1a1d24');
    grad.addColorStop(0.5, '#10131a');
    grad.addColorStop(1, '#08090e');
  } else {
    grad.addColorStop(0, '#edf2f8');
    grad.addColorStop(0.5, '#d8e1eb');
    grad.addColorStop(1, '#c4ced9');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

function SceneExposure({ theme }: { theme: ThemeMode }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = theme === 'dark' ? 1.26 : 1.08;
  }, [gl, theme]);
  return null;
}

function PitLaneSet({
  theme,
  groundTexture,
  backdropTexture,
}: {
  theme: ThemeMode;
  groundTexture: CanvasTexture;
  backdropTexture: CanvasTexture;
}) {
  const dark = theme === 'dark';

  return (
    <>
      <ambientLight intensity={dark ? 0.28 : 0.6} color={dark ? '#909fc4' : '#fff8ef'} />
      <spotLight
        position={dark ? [5.8, 6.3, 4.8] : [7.2, 7.1, 2.9]}
        angle={0.48}
        intensity={dark ? 3.3 : 1.7}
        penumbra={0.36}
        color={dark ? '#f4f6ff' : '#ffe9d4'}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00022}
      />
      <directionalLight position={dark ? [-5.8, 3.1, -4.8] : [-5.5, 4.4, -3.5]} intensity={dark ? 1.18 : 0.56} color={dark ? '#8ca9e5' : '#dde7ff'} />
      <directionalLight position={dark ? [0, 4.9, -7] : [3.4, 4.2, -6.5]} intensity={dark ? 0.82 : 0.44} color={dark ? '#ff6565' : '#aec4e4'} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[54, 40]} />
        <meshStandardMaterial
          map={groundTexture}
          color={dark ? '#171018' : '#d4dbe4'}
          roughness={dark ? 0.2 : 0.74}
          metalness={dark ? 0.2 : 0.05}
          envMapIntensity={dark ? 1.0 : 0.6}
        />
      </mesh>

      <mesh position={[0, 6.8, -13.2]}>
        <planeGeometry args={[60, 25]} />
        <meshStandardMaterial map={backdropTexture} roughness={1} metalness={0} />
      </mesh>

      {dark && (
        <>
          <mesh position={[0, 5.15, 0]}>
            <boxGeometry args={[8.2, 0.07, 0.55]} />
            <meshStandardMaterial color="#cfe0ff" emissive="#7ea5ff" emissiveIntensity={1.45} />
          </mesh>
          <mesh position={[9.8, 3.3, -9.3]}>
            <boxGeometry args={[2.8, 2.6, 1]} />
            <meshStandardMaterial color="#151b28" roughness={0.65} metalness={0.14} />
          </mesh>
          <mesh position={[-9.8, 3.3, -9.3]}>
            <boxGeometry args={[2.8, 2.6, 1]} />
            <meshStandardMaterial color="#151b28" roughness={0.65} metalness={0.14} />
          </mesh>
          <mesh position={[9.1, 3.75, -10.05]}>
            <planeGeometry args={[2.8, 1]} />
            <meshStandardMaterial color="#1a2435" emissive="#2f7dff" emissiveIntensity={1.0} />
          </mesh>
          <mesh position={[-9.1, 3.75, -10.05]}>
            <planeGeometry args={[2.8, 1]} />
            <meshStandardMaterial color="#1a2435" emissive="#2f7dff" emissiveIntensity={1.0} />
          </mesh>
        </>
      )}
    </>
  );
}

function ModelInstance({
  object,
  compound,
  wear,
  theme,
  onTireCountChange,
  onHoverChange,
  onReady,
}: {
  object: Object3D;
  compound: Compound;
  wear: TireWearMap;
  theme: ThemeMode;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const holderRef = useRef<Group>(null);
  const normalized = useMemo(() => normalizeObject(object, theme), [object, theme]);
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

  useFrame(({ clock }) => {
    if (!holderRef.current) {
      return;
    }
    const t = clock.getElapsedTime();
    holderRef.current.position.y = Math.sin(t * 0.8) * 0.012;
    holderRef.current.rotation.y = Math.sin(t * 0.37) * 0.012;
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
        <meshStandardMaterial name={`sidewall_${id}`} color="#1f2125" roughness={0.55} metalness={0.03} />
      </mesh>
      <mesh name={`hub_${id}`} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.29, 24]} />
        <meshStandardMaterial color="#767b86" roughness={0.42} metalness={0.46} />
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
    if (!groupRef.current) {
      return;
    }
    configureMeshShadows(groupRef.current);
    const found = findTireMeshes(groupRef.current);
    setTires(found);
    onTireCountChange(found.length);
    onReady();
  }, [onReady, onTireCountChange]);

  useEffect(() => {
    applyCompoundAndWear(tires, compound, wear);
  }, [tires, compound, wear]);

  useEffect(() => {
    onHoverChange(hoverState);
  }, [hoverState, onHoverChange]);

  return (
    <group ref={groupRef} position={[0, 0.38, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4.9, 0.36, 1.9]} />
        <meshStandardMaterial color="#16253d" roughness={0.28} metalness={0.42} />
      </mesh>
      <mesh position={[0.52, 0.4, 0]} castShadow>
        <boxGeometry args={[2.5, 0.56, 1.24]} />
        <meshStandardMaterial color="#223955" roughness={0.24} metalness={0.36} />
      </mesh>
      <mesh position={[-2.26, 0.24, 0]} castShadow>
        <boxGeometry args={[0.94, 0.2, 2.23]} />
        <meshStandardMaterial color="#0f1824" roughness={0.42} metalness={0.2} />
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
  theme,
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
  theme: ThemeMode;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
  onReady: () => void;
}) {
  const props = {
    modelPath,
    compound,
    wear,
    theme,
    onTireCountChange,
    onHoverChange,
    onReady,
  };

  if (modelType === 'glb' || modelType === 'gltf') {
    return <GLTFAsset {...props} />;
  }
  if (modelType === 'fbx') {
    return <FBXAsset {...props} />;
  }
  if (modelType === 'obj' && mtlPath) {
    return <OBJWithMTLAsset {...props} mtlPath={mtlPath} texturePath={texturePath} />;
  }
  if (modelType === 'obj') {
    return <OBJAsset {...props} texturePath={texturePath} />;
  }
  return null;
}

export default function CarViewer({ compound, wear, theme, onModelMetaChange }: CarViewerProps) {
  const { manifest, loading, error } = useModelManifest();
  const [tireCount, setTireCount] = useState(0);
  const [hover, setHover] = useState<TireHoverState | null>(null);
  const [modelReady, setModelReady] = useState(false);

  const wearMap = useMemo(() => normalizeWearMap(wear), [wear]);
  const groundTexture = useMemo(() => createGroundTexture(theme), [theme]);
  const backdropTexture = useMemo(() => createBackdropTexture(theme), [theme]);
  const usePlaceholder = !loading && (!!error || !manifest || manifest.placeholder || !manifest.modelPath);

  useEffect(() => {
    setModelReady(false);
  }, [manifest?.modelPath]);

  useEffect(() => {
    onModelMetaChange?.({
      modelPath: manifest?.modelPath || undefined,
      modelType: manifest?.placeholder ? 'placeholder' : manifest?.modelType,
      tireCount,
      error: error ?? undefined,
    });
  }, [manifest, tireCount, error, onModelMetaChange]);

  return (
    <section className={`panel car-viewer ${theme === 'dark' ? 'viewer-dark' : 'viewer-light'}`}>
      {(loading || !modelReady) && (
        <div className="viewer-loading">
          <div className="loading-title">{loading ? 'Loading model manifest' : 'Building studio frame'}</div>
          <div className="loading-bars">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      {!loading && usePlaceholder && <div className="viewer-message">Using placeholder car model</div>}
      {error && !loading && <div className="viewer-message error">{error}</div>}

      <Canvas shadows camera={{ position: [6.5, 1.35, 4.65], fov: 34 }}>
        <color attach="background" args={[theme === 'dark' ? '#040509' : '#e5ebf2']} />
        <SceneExposure theme={theme} />
        <PitLaneSet theme={theme} groundTexture={groundTexture} backdropTexture={backdropTexture} />
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={theme === 'dark' ? 0.52 : 0.3}
          scale={11}
          blur={2.1}
          far={7}
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
              theme={theme}
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

        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.42}
          autoRotate
          autoRotateSpeed={0.48}
          minDistance={7.25}
          maxDistance={7.25}
          minPolarAngle={0.9}
          maxPolarAngle={1.36}
          minAzimuthAngle={-0.78}
          maxAzimuthAngle={0.95}
          target={[0, 0.84, 0]}
        />
      </Canvas>

      <Tooltip
        visible={Boolean(hover)}
        tireId={hover?.tireId}
        wearPct={(hover?.wear ?? 0) * 100}
        tempProxyC={hover?.tempProxyC}
      />
    </section>
  );
}
