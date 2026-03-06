import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mesh, MeshStandardMaterial } from 'three';
import type { TireMeshEntry, TireWearMap } from './tireStyling';

export interface TireHoverState {
  tireId: string;
  wear: number;
  tempProxyC: number;
}

function setMaterialHighlight(material: MeshStandardMaterial, highlighted: boolean): void {
  if (!material.userData.__hover_defaults) {
    material.userData.__hover_defaults = {
      emissive: material.emissive.clone(),
      emissiveIntensity: material.emissiveIntensity,
    };
  }

  const defaults = material.userData.__hover_defaults as {
    emissive: MeshStandardMaterial['emissive'];
    emissiveIntensity: number;
  };

  if (highlighted) {
    material.emissive.setRGB(0.24, 0.25, 0.28);
    material.emissiveIntensity = Math.max(defaults.emissiveIntensity, 0.16);
  } else {
    material.emissive.copy(defaults.emissive);
    material.emissiveIntensity = defaults.emissiveIntensity;
  }
  material.needsUpdate = true;
}

export function useTireRaycastHover(
  tires: TireMeshEntry[],
  wearByWheel: TireWearMap,
): TireHoverState | null {
  const [state, setState] = useState<TireHoverState | null>(null);
  const currentHoverId = useRef<string | null>(null);

  const tireMeshes = useMemo(() => tires.map((tire) => tire.mesh), [tires]);
  const tireByUuid = useMemo(() => {
    const map = new Map<string, TireMeshEntry>();
    tires.forEach((tire) => map.set(tire.mesh.uuid, tire));
    return map;
  }, [tires]);

  useEffect(() => {
    tires.forEach((tire) => {
      tire.allMaterials.forEach((material) => setMaterialHighlight(material, false));
    });
  }, [tires]);

  useFrame((frameState) => {
    if (tireMeshes.length === 0) {
      return;
    }

    frameState.raycaster.setFromCamera(frameState.pointer, frameState.camera);
    const intersections = frameState.raycaster.intersectObjects(tireMeshes, false);
    const hit = intersections[0];
    const hoveredMesh = hit?.object instanceof Mesh ? hit.object : null;
    const hoveredUuid = hoveredMesh?.uuid ?? null;

    if (hoveredUuid !== currentHoverId.current) {
      tires.forEach((tire) => {
        const highlighted = tire.mesh.uuid === hoveredUuid;
        tire.allMaterials.forEach((material) => setMaterialHighlight(material, highlighted));
      });
    }

    if (!hoveredMesh) {
      if (currentHoverId.current !== null) {
        currentHoverId.current = null;
        setState(null);
      }
      return;
    }

    const tire = tireByUuid.get(hoveredMesh.uuid);
    if (!tire) {
      return;
    }

    currentHoverId.current = hoveredUuid;
    const wear = wearByWheel[tire.id as keyof TireWearMap] ?? 0;
    const tempProxyC = Math.round(84 + wear * 76);
    setState((prev) => {
      if (prev?.tireId === tire.id && Math.abs(prev.wear - wear) < 0.002) {
        return prev;
      }
      return {
        tireId: tire.id,
        wear,
        tempProxyC,
      };
    });
  });

  return state;
}
