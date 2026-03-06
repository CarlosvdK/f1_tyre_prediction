import { Color, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { Compound } from '../data/api';

const tireKeywords = ['tire', 'tyre', 'wheel', 'pirelli', 'sidewall', 'stripe', 'rim'];
const accentKeywords = ['stripe', 'logo', 'pirelli', 'sidewall', 'marking', 'line'];

export type WheelId = 'FL' | 'FR' | 'RL' | 'RR' | 'UNKNOWN';

export interface TireMeshEntry {
  id: WheelId;
  mesh: Mesh;
  allMaterials: MeshStandardMaterial[];
  accentMaterials: MeshStandardMaterial[];
  baseMaterials: MeshStandardMaterial[];
}

export interface TireWearMap {
  FL: number;
  FR: number;
  RL: number;
  RR: number;
}

const compoundColorHex: Record<Compound, string> = {
  soft: '#d7322f',
  medium: '#f0c533',
  hard: '#f2f2ee',
  inter: '#2f8c3a',
  wet: '#2a4fc7',
};

const fallbackOrder: WheelId[] = ['FL', 'FR', 'RL', 'RR'];

function toMaterialArray(material: unknown): MeshStandardMaterial[] {
  const list = Array.isArray(material) ? material : [material];
  return list.filter(
    (item): item is MeshStandardMaterial =>
      Boolean(item) && item instanceof MeshStandardMaterial,
  );
}

function captureMaterialDefaults(material: MeshStandardMaterial): void {
  if (material.userData.__tire_defaults) {
    return;
  }

  material.userData.__tire_defaults = {
    color: material.color.clone(),
    roughness: material.roughness,
  };
}

function getWheelId(name: string, fallbackIndex: number): WheelId {
  const n = name.toLowerCase();

  const isFront =
    n.includes('front') || n.includes('f_') || n.includes('_f') || n.includes('fwd');
  const isRear = n.includes('rear') || n.includes('r_') || n.includes('_r') || n.includes('back');
  const isLeft = n.includes('left') || n.includes('_l') || n.startsWith('l_') || n.includes(' lf');
  const isRight = n.includes('right') || n.includes('_r') || n.startsWith('r_') || n.includes(' rf');

  if (n.includes('fl') || (isFront && isLeft)) {
    return 'FL';
  }
  if (n.includes('fr') || (isFront && isRight)) {
    return 'FR';
  }
  if (n.includes('rl') || (isRear && isLeft)) {
    return 'RL';
  }
  if (n.includes('rr') || (isRear && isRight)) {
    return 'RR';
  }

  return fallbackOrder[fallbackIndex % fallbackOrder.length] ?? 'UNKNOWN';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function findTireMeshes(root: Object3D): TireMeshEntry[] {
  const found: TireMeshEntry[] = [];
  const used = new Set<string>();

  root.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = toMaterialArray(child.material);
    if (materials.length === 0) {
      return;
    }

    const bundleName = `${child.name} ${materials.map((mat) => mat.name).join(' ')}`.toLowerCase();
    const matchesTire = tireKeywords.some((key) => bundleName.includes(key));
    if (!matchesTire) {
      return;
    }

    const uniqueKey = `${child.uuid}:${bundleName}`;
    if (used.has(uniqueKey)) {
      return;
    }
    used.add(uniqueKey);

    const accentMaterials = materials.filter((mat) => {
      const matName = `${mat.name} ${child.name}`.toLowerCase();
      return accentKeywords.some((key) => matName.includes(key));
    });

    materials.forEach(captureMaterialDefaults);

    found.push({
      id: getWheelId(bundleName, found.length),
      mesh: child,
      allMaterials: materials,
      accentMaterials,
      baseMaterials: materials,
    });
  });

  return found;
}

export function applyCompoundAndWear(
  tires: TireMeshEntry[],
  compound: Compound,
  wearByWheel: Partial<TireWearMap>,
): void {
  const compoundColor = new Color(compoundColorHex[compound]);
  const dustColor = new Color('#6b625a');

  tires.forEach((tire) => {
    const wear =
      tire.id === 'UNKNOWN'
        ? 0.2
        : clamp01(wearByWheel[tire.id as keyof TireWearMap] ?? 0.2);
    const targetMaterials = tire.accentMaterials.length > 0 ? tire.accentMaterials : tire.baseMaterials;

    targetMaterials.forEach((material) => {
      material.color.copy(compoundColor);

      // Desaturate and remap the underlying painted texture so we can cleanly tint it 
      // with our F1 compound color without muddying into orange or brown.
      material.onBeforeCompile = (shader) => {
        const replaceMap = `
#ifdef USE_MAP
  vec4 texelColor = texture2D( map, vMapUv );
  texelColor = mapTexelToLinear( texelColor );
  
  // Calculate relative luminance to isolate painted areas.
  float lum = dot(texelColor.rgb, vec3(0.299, 0.587, 0.114));
  
  // Dark rubber is usually < 0.2 luminance. Painted rings/logos are > 0.3.
  float decalMask = smoothstep(0.15, 0.4, lum);
  
  // The dark rubber stays grayscale.
  vec3 rubberBase = vec3(lum * 0.8);
  
  // The painted compound area is tinted by our material.color (diffuseColor).
  // We boost brightness slightly to make the F1 neon colors pop.
  vec3 paintedCompound = diffuseColor.rgb * (lum * 1.5);
  
  // Mix them using the mask
  vec3 finalColor = mix(rubberBase, paintedCompound, decalMask);
  
  texelColor.rgb = finalColor;
  
  // Reset diffuseColor to white so Three.js doesn't double-multiply.
  diffuseColor = vec4(1.0);
  
  diffuseColor *= texelColor;
#endif
`;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          replaceMap
        );
      };

      material.customProgramCacheKey = () => 'desaturate_painted_tyre';
      material.needsUpdate = true;
    });

    tire.baseMaterials.forEach((material) => {
      const defaults = material.userData.__tire_defaults as
        | { color: Color; roughness: number }
        | undefined;
      if (!defaults) {
        return;
      }

      const hasSeparateAccent = tire.accentMaterials.length > 0;
      const baseColor = hasSeparateAccent ? defaults.color.clone() : compoundColor.clone();
      baseColor.multiplyScalar(1 - wear * 0.18);
      baseColor.lerp(dustColor, wear * 0.22);

      if (!hasSeparateAccent || !tire.accentMaterials.includes(material)) {
        material.color.copy(baseColor);
      }

      material.roughness = lerp(Math.max(defaults.roughness, 0.36), 0.97, wear);
      material.needsUpdate = true;
    });
  });
}

export function normalizeWearMap(values: {
  wear_FL?: number;
  wear_FR?: number;
  wear_RL?: number;
  wear_RR?: number;
}): TireWearMap {
  return {
    FL: clamp01(values.wear_FL ?? 0.2),
    FR: clamp01(values.wear_FR ?? 0.2),
    RL: clamp01(values.wear_RL ?? 0.2),
    RR: clamp01(values.wear_RR ?? 0.2),
  };
}

export function getCompoundColor(compound: Compound): string {
  return compoundColorHex[compound];
}
