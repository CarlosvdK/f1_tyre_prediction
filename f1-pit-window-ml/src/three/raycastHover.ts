import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mesh, Vector3 } from 'three';
import type { TireMeshEntry, TireWearMap } from './tireStyling';

export interface TireHoverState {
  tireId: string;
  wear: number;
  x: number;
  y: number;
}

const lerpTarget = new Vector3();

function ensureBaseScale(mesh: Mesh): Vector3 {
  if (!mesh.userData.__base_scale) {
    mesh.userData.__base_scale = mesh.scale.clone();
  }
  return mesh.userData.__base_scale as Vector3;
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
      ensureBaseScale(tire.mesh);
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

    tires.forEach((tire) => {
      const baseScale = ensureBaseScale(tire.mesh);
      const multiplier = tire.mesh.uuid === hoveredUuid ? 1.15 : 1;
      lerpTarget.copy(baseScale).multiplyScalar(multiplier);
      tire.mesh.scale.lerp(lerpTarget, 0.18);
    });

    if (!hoveredMesh || !hit) {
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

    const projected = hit.point.clone().project(frameState.camera);
    const x = (projected.x * 0.5 + 0.5) * frameState.size.width;
    const y = (-projected.y * 0.5 + 0.5) * frameState.size.height;

    currentHoverId.current = hoveredUuid;
    setState({
      tireId: tire.id,
      wear: wearByWheel[tire.id as keyof TireWearMap] ?? 0,
      x,
      y,
    });
  });

  return state;
}
