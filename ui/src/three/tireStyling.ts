import { Color, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { Compound } from '../data/api';

const tireKeywords = ['tire', 'tyre', 'slick', 'sidewall', 'pirelli'];
const fallbackTireKeywords = ['wheel'];
const accentKeywords = ['stripe', 'logo', 'pirelli', 'sidewall', 'marking', 'line'];
const tireExclusionKeywords = [
  'rim',
  'hub',
  'flask',
  'fix_roue',
  'brake',
  'disc',
  'caliper',
  'susp',
  'arm',
  'intake',
  'sticker',
  'logo',
  'tube',
  'camera',
  'hud',
  'display',
  'steer',
];

export type WheelId = 'FL' | 'FR' | 'RL' | 'RR' | 'UNKNOWN';

export interface TireMeshEntry {
  id: WheelId;
  mesh: Mesh;
  layerIndex: number;
  layerCount: number;
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

function ensureUniqueMaterials(mesh: Mesh): MeshStandardMaterial[] {
  const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const next = original.map((material) => {
    if (!(material instanceof MeshStandardMaterial)) {
      return material;
    }
    if (material.userData.__tire_unique_clone) {
      return material;
    }

    const clone = material.clone();
    clone.name = material.name;
    clone.userData = {
      ...material.userData,
      __tire_unique_clone: true,
    };
    return clone;
  });

  mesh.material = Array.isArray(mesh.material) ? next : next[0];
  return toMaterialArray(mesh.material);
}

function captureMaterialDefaults(material: MeshStandardMaterial): void {
  if (material.userData.__tire_defaults) {
    return;
  }

  material.userData.__tire_defaults = {
    color: material.color.clone(),
    roughness: material.roughness,
    metalness: material.metalness,
    envMapIntensity: material.envMapIntensity,
  };
}

function getNameChain(object: Object3D): string[] {
  const names: string[] = [];
  let current: Object3D | null = object;

  while (current) {
    if (current.name) {
      names.push(current.name);
    }
    current = current.parent;
  }

  return names;
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

function getLayerIndex(name: string): number {
  const subMatch = name.match(/sub(\d+)/i);
  if (subMatch) {
    return Number(subMatch[1]);
  }

  const numberedTyre = name.match(/tyre_[a-z]+(\d+)/i);
  if (numberedTyre) {
    return Number(numberedTyre[1]) - 1;
  }

  return 0;
}

export function findTireMeshes(root: Object3D): TireMeshEntry[] {
  const found: TireMeshEntry[] = [];
  const used = new Set<string>();

  root.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const nameChain = getNameChain(child).map((name) => name.toLowerCase());
    const chainBundle = nameChain.join(' ');
    const localBundle = nameChain.slice(0, 4).join(' ');
    const materials = ensureUniqueMaterials(child);
    if (materials.length === 0) {
      return;
    }

    const bundleName = `${chainBundle} ${materials.map((mat) => mat.name).join(' ')}`.toLowerCase();
    const matchesCoreTire = tireKeywords.some((key) => localBundle.includes(key));
    const matchesWheelPosition = /(front|rear|left|right|fl|fr|rl|rr|lf|rf|lr)/.test(localBundle);
    const matchesFallback =
      fallbackTireKeywords.some((key) => localBundle.includes(key)) && matchesWheelPosition;
    const excluded = tireExclusionKeywords.some((key) => localBundle.includes(key));
    const matchesTire = (matchesCoreTire || matchesFallback) && !excluded;
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
      layerIndex: getLayerIndex(localBundle),
      layerCount: 1,
      allMaterials: materials,
      accentMaterials,
      baseMaterials: materials,
    });
  });

  const grouped = new Map<WheelId, TireMeshEntry[]>();
  found.forEach((entry) => {
    const bucket = grouped.get(entry.id) ?? [];
    bucket.push(entry);
    grouped.set(entry.id, bucket);
  });

  grouped.forEach((entries) => {
    entries
      .sort((left, right) => left.layerIndex - right.layerIndex)
      .forEach((entry, index, all) => {
        entry.layerIndex = index;
        entry.layerCount = all.length;
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
  const scrubColor = new Color('#413934');
  const heatColor = new Color('#8d5f43');

  tires.forEach((tire) => {
    const wear =
      tire.id === 'UNKNOWN'
        ? 0.2
        : clamp01(wearByWheel[tire.id as keyof TireWearMap] ?? 0.2);
    const layerOffset = tire.layerCount > 1
      ? tire.layerIndex / Math.max(tire.layerCount - 1, 1)
      : 0;
    const layerWear = clamp01(wear * lerp(0.86, 1.12, layerOffset));
    const wornAccent = compoundColor.clone().lerp(dustColor, clamp01(wear * 0.88));

    tire.accentMaterials.forEach((material) => {
      const defaults = material.userData.__tire_defaults as
        | { color: Color; roughness: number; metalness: number; envMapIntensity: number }
        | undefined;

      material.color.copy(wornAccent);
      material.roughness = lerp(Math.max(defaults?.roughness ?? 0.52, 0.52), 0.95, wear);
      material.metalness = lerp(defaults?.metalness ?? 0.03, 0.02, wear);
      material.envMapIntensity = lerp(defaults?.envMapIntensity ?? 0.12, 0.04, wear);

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
        | { color: Color; roughness: number; metalness: number; envMapIntensity: number }
        | undefined;
      if (!defaults) {
        return;
      }

      const hasSeparateAccent = tire.accentMaterials.length > 0;
      const baseColor = defaults.color.clone();
      const layerDust = dustColor.clone().lerp(scrubColor, layerOffset * 0.75);
      baseColor.multiplyScalar(1 - layerWear * 0.18);
      baseColor.lerp(layerDust, layerWear * 0.34);
      baseColor.lerp(heatColor, Math.max(0, layerWear - 0.58) * (0.12 + layerOffset * 0.14));

      if (!hasSeparateAccent || !tire.accentMaterials.includes(material)) {
        material.color.copy(baseColor);
      }

      material.roughness = lerp(Math.max(defaults.roughness, 0.36), 0.97, layerWear);
      material.metalness = lerp(defaults.metalness, 0.01, layerWear);
      material.envMapIntensity = lerp(defaults.envMapIntensity, 0.05, layerWear);
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
