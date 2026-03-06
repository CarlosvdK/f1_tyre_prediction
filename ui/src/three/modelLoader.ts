import { useGLTF } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import type { Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type ModelType = 'glb' | 'gltf' | 'fbx' | 'obj';

export interface ModelManifest {
  modelPath: string;
  modelType?: ModelType;
  mtlPath?: string;
  texturePath?: string;
  placeholder?: boolean;
}

export interface ModelManifestState {
  manifest: ModelManifest | null;
  loading: boolean;
  error: string | null;
}

function detectModelType(modelPath: string): ModelType {
  if (!modelPath) {
    throw new Error('Model path is empty');
  }

  const lower = modelPath.toLowerCase();
  if (lower.endsWith('.glb')) {
    return 'glb';
  }
  if (lower.endsWith('.gltf')) {
    return 'gltf';
  }
  if (lower.endsWith('.fbx')) {
    return 'fbx';
  }
  if (lower.endsWith('.obj')) {
    return 'obj';
  }

  throw new Error(`Unsupported model extension in ${modelPath}`);
}

function cloneModel<T extends Object3D>(object: T): T {
  return clone(object) as T;
}

export function useModelManifest(): ModelManifestState {
  const [state, setState] = useState<ModelManifestState>({
    manifest: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    async function loadManifest() {
      try {
        const response = await fetch('/models/model_manifest.json');
        if (!response.ok) {
          throw new Error('model_manifest.json not found. Run npm run prepare:model');
        }

        const raw = (await response.json()) as ModelManifest;
        const modelType = raw.modelType ?? detectModelType(raw.modelPath);
        const manifest: ModelManifest = {
          ...raw,
          modelType,
        };

        if (
          !manifest.placeholder &&
          manifest.modelPath &&
          (modelType === 'glb' || modelType === 'gltf')
        ) {
          useGLTF.preload(manifest.modelPath);
        }

        if (mounted) {
          setState({ manifest, loading: false, error: null });
        }
      } catch (error) {
        if (mounted) {
          setState({
            manifest: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load model manifest',
          });
        }
      }
    }

    void loadManifest();

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

export function useGLTFModel(modelPath: string): Object3D {
  const gltf = useGLTF(modelPath);
  return useMemo(() => cloneModel(gltf.scene), [gltf.scene]);
}

export function useFBXModel(modelPath: string): Object3D {
  const model = useLoader(FBXLoader, modelPath);
  return useMemo(() => cloneModel(model), [model]);
}

export function useOBJModel(modelPath: string, texturePath?: string): Object3D {
  const model = useLoader(OBJLoader, modelPath, (loader) => {
    if (texturePath) {
      loader.setResourcePath(texturePath);
    }
  });

  return useMemo(() => cloneModel(model), [model]);
}

export function useOBJModelWithMTL(
  modelPath: string,
  mtlPath: string,
  texturePath?: string,
): Object3D {
  const materials = useLoader(MTLLoader, mtlPath, (loader) => {
    if (texturePath) {
      loader.setResourcePath(texturePath);
    }
  });

  const model = useLoader(OBJLoader, modelPath, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
    if (texturePath) {
      loader.setResourcePath(texturePath);
    }
  });

  return useMemo(() => cloneModel(model), [model]);
}
