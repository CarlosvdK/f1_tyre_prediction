import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Box3, Mesh, Object3D, Vector3 } from 'three';
import type { Compound, ThemeMode } from '../data/api';
import {
  useFBXModel,
  useGLTFModel,
  useModelManifest,
  useOBJModel,
  useOBJModelWithMTL,
} from '../three/modelLoader';
import { useTireRaycastHover } from '../three/raycastHover';
import {
  applyCompoundAndWear,
  findTireMeshes,
  normalizeWearMap,
  type TireWearMap,
} from '../three/tireStyling';
import type { TireHoverState } from '../three/raycastHover';
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
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
}

function configureMeshShadows(root: Object3D): void {
  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function normalizeObject(root: Object3D): Object3D {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 4.6 / maxDim;

  root.scale.multiplyScalar(scale);

  const resized = new Box3().setFromObject(root);
  const center = resized.getCenter(new Vector3());
  root.position.sub(center);

  const floorBox = new Box3().setFromObject(root);
  root.position.y -= floorBox.min.y;

  configureMeshShadows(root);
  return root;
}

function ModelInstance({
  object,
  compound,
  wear,
  onTireCountChange,
  onHoverChange,
}: {
  object: Object3D;
  compound: Compound;
  wear: TireWearMap;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
}) {
  const normalized = useMemo(() => normalizeObject(object), [object]);
  const tires = useMemo(() => findTireMeshes(normalized), [normalized]);
  const hoverState = useTireRaycastHover(tires, wear);

  useEffect(() => {
    onTireCountChange(tires.length);
  }, [onTireCountChange, tires.length]);

  useEffect(() => {
    applyCompoundAndWear(tires, compound, wear);
  }, [tires, compound, wear]);

  useEffect(() => {
    onHoverChange(hoverState);
  }, [hoverState, onHoverChange]);

  return <primitive object={normalized} />;
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

function SceneLights({ theme }: { theme: ThemeMode }) {
  const isDark = theme === 'dark';

  return (
    <>
      <ambientLight intensity={isDark ? 0.14 : 0.52} color={isDark ? '#8ea3cf' : '#ffffff'} />
      <hemisphereLight
        intensity={isDark ? 0.08 : 0.35}
        groundColor={isDark ? '#0c0d10' : '#7b8b98'}
        color={isDark ? '#7787a8' : '#e4edff'}
      />

      {!isDark && (
        <directionalLight
          position={[6, 9, 4]}
          intensity={1.15}
          color="#fff7eb"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.00012}
          shadow-radius={7}
        />
      )}

      {isDark && (
        <>
          <spotLight
            position={[0, 8, 0.5]}
            angle={0.56}
            intensity={2.6}
            penumbra={0.28}
            color="#f1f2ff"
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.0004}
          />
          <directionalLight
            position={[-6, 3, -4]}
            intensity={0.9}
            color="#94a8ff"
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
        </>
      )}
    </>
  );
}

function Floor({ theme }: { theme: ThemeMode }) {
  const isDark = theme === 'dark';

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
      <planeGeometry args={[42, 42]} />
      <meshStandardMaterial
        color={isDark ? '#101316' : '#cfd7dd'}
        roughness={isDark ? 0.92 : 0.58}
        metalness={isDark ? 0.05 : 0.15}
      />
    </mesh>
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
}: {
  modelPath: string;
  modelType: string;
  mtlPath?: string;
  texturePath?: string;
  compound: Compound;
  wear: TireWearMap;
  onTireCountChange: (count: number) => void;
  onHoverChange: (state: TireHoverState | null) => void;
}) {
  const props = {
    modelPath,
    compound,
    wear,
    onTireCountChange,
    onHoverChange,
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

  const wearMap = useMemo(() => normalizeWearMap(wear), [wear]);

  useEffect(() => {
    onModelMetaChange?.({
      modelPath: manifest?.modelPath,
      modelType: manifest?.modelType,
      tireCount,
      error: error ?? undefined,
    });
  }, [manifest, tireCount, error, onModelMetaChange]);

  return (
    <section className={`panel car-viewer ${theme === 'dark' ? 'viewer-dark' : 'viewer-light'}`}>
      {loading && <div className="viewer-message">Loading model manifest...</div>}
      {error && !loading && <div className="viewer-message error">{error}</div>}

      <Canvas shadows camera={{ position: [5.2, 2.8, 6.2], fov: 42 }}>
        <color attach="background" args={[theme === 'dark' ? '#07090d' : '#dfe7ef']} />
        <SceneLights theme={theme} />
        <Floor theme={theme} />

        <Suspense fallback={null}>
          {manifest && (
            <ResolvedModel
              modelPath={manifest.modelPath}
              modelType={manifest.modelType ?? 'glb'}
              mtlPath={manifest.mtlPath}
              texturePath={manifest.texturePath}
              compound={compound}
              wear={wearMap}
              onTireCountChange={setTireCount}
              onHoverChange={setHover}
            />
          )}
        </Suspense>

        <OrbitControls
          makeDefault
          enablePan
          enableZoom
          minDistance={2.5}
          maxDistance={14}
          maxPolarAngle={Math.PI / 2.05}
          target={[0, 0.8, 0]}
        />
      </Canvas>

      <Tooltip
        visible={Boolean(hover)}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        label={
          hover
            ? `${hover.tireId}: wear ${(hover.wear * 100).toFixed(1)}%`
            : ''
        }
      />
    </section>
  );
}
