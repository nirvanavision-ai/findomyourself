/*
 * Rebuilds assets/vendor/ from npm packages (dev only; the site itself has no build step):
 *
 *   npm install && npm run vendor
 *
 * three.js: scans js/gl/*.js for the names they import from './three.js' and bundles only
 * those (tree-shaken, minified). Lenis: minified as an ES module.
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const glDir = join(root, 'js/gl');
const out = join(root, 'assets/vendor');
const THREE_VERSION = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version;
const LENIS_VERSION = JSON.parse(readFileSync(join(root, 'node_modules/lenis/package.json'), 'utf8')).version;
const ADDONS = {
  RoundedBoxGeometry: 'geometries/RoundedBoxGeometry.js',
  RoomEnvironment: 'environments/RoomEnvironment.js',
  EffectComposer: 'postprocessing/EffectComposer.js',
  RenderPass: 'postprocessing/RenderPass.js',
  UnrealBloomPass: 'postprocessing/UnrealBloomPass.js',
  ShaderPass: 'postprocessing/ShaderPass.js',
  OutputPass: 'postprocessing/OutputPass.js',
  mergeGeometries: 'utils/BufferGeometryUtils.js',
};

const names = new Set();
for (const file of readdirSync(glDir).filter((f) => f.endsWith('.js') && f !== 'three.js')) {
  const src = readFileSync(join(glDir, file), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/three\.js['"]/g)) {
    m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => names.add(n));
  }
}
const core = [...names].filter((n) => !ADDONS[n]).sort();
const addons = [...names].filter((n) => ADDONS[n]).sort();
const entry = [
  `export { ${core.join(', ')} } from 'three';`,
  ...addons.map((n) => `export { ${n} } from 'three/addons/${ADDONS[n]}';`),
].join('\n');

const tmp = join(root, 'node_modules/.vendor-entry.js');
writeFileSync(tmp, entry);
mkdirSync(out, { recursive: true });
const major = THREE_VERSION.split('.')[1];
const threeOut = join(out, `three-r${major}.min.js`);
await build({ entryPoints: [tmp], bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: threeOut, legalComments: 'inline', logLevel: 'warning' });
rmSync(tmp);
await build({ entryPoints: [join(root, 'node_modules/lenis/dist/lenis.mjs')], bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: join(out, `lenis-${LENIS_VERSION}.min.js`), legalComments: 'inline', logLevel: 'warning' });

const size = (f) => (readFileSync(f).length / 1024).toFixed(0) + ' KB';
console.log(`three ${THREE_VERSION}: ${core.length} core + ${addons.length} addon exports → ${size(threeOut)}`);
console.log(`lenis ${LENIS_VERSION} → ${size(join(out, `lenis-${LENIS_VERSION}.min.js`))}`);
