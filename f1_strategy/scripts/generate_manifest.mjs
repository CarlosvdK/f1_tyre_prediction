import fs from 'node:fs';
import path from 'node:path';

const modelRoot = 'public/models/redbull-rb19-oracle-wwwvecarzcom';
const sourceDir = path.resolve(modelRoot, 'source');
const textureDirWeb = '/models/redbull-rb19-oracle-wwwvecarzcom/texture/';
const manifestPath = path.resolve('public/models/model_manifest.json');

const priority = ['.glb', '.gltf', '.fbx', '.obj'];

function fileExt(fileName) {
  return path.extname(fileName).toLowerCase();
}

function pickModelFile(files) {
  for (const ext of priority) {
    const match = files.find((file) => fileExt(file) === ext);
    if (match) {
      return match;
    }
  }
  return null;
}

function pickMtlFile(files, modelFile) {
  const base = path.basename(modelFile, path.extname(modelFile)).toLowerCase();
  const exact = files.find(
    (file) => fileExt(file) === '.mtl' && path.basename(file, '.mtl').toLowerCase() === base,
  );
  if (exact) {
    return exact;
  }
  return files.find((file) => fileExt(file) === '.mtl') ?? null;
}

if (!fs.existsSync(sourceDir)) {
  fs.mkdirSync(sourceDir, { recursive: true });
}

const files = fs.readdirSync(sourceDir).filter((file) =>
  fs.statSync(path.join(sourceDir, file)).isFile(),
);

const modelFile = pickModelFile(files);

if (!modelFile) {
  const placeholderManifest = {
    modelPath: '',
    modelType: 'glb',
    texturePath: textureDirWeb,
    placeholder: true,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(placeholderManifest, null, 2)}\n`, 'utf8');

  console.warn(
    `No supported model found in ${sourceDir}. Wrote placeholder manifest so UI can still run.`,
  );
  console.log(JSON.stringify(placeholderManifest, null, 2));
  process.exit(0);
}

const extension = fileExt(modelFile);
const modelType = extension.slice(1);

const manifest = {
  modelPath: `/models/redbull-rb19-oracle-wwwvecarzcom/source/${modelFile}`,
  modelType,
  texturePath: textureDirWeb,
};

if (modelType === 'obj') {
  const mtlFile = pickMtlFile(files, modelFile);
  if (mtlFile) {
    manifest.mtlPath = `/models/redbull-rb19-oracle-wwwvecarzcom/source/${mtlFile}`;
  }
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Manifest written to ${manifestPath}`);
console.log(JSON.stringify(manifest, null, 2));
