/**
 * Runs after install: produces the better-sqlite3 binary for both Electron and plain Node
 * and caches each under native/, so scripts/select-native.mjs can swap between them without
 * a rebuild. Tests run on Node, the app runs on Electron, and the two ABIs are incompatible.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'better-sqlite3');
const built = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
const nativeDir = join(root, 'native');

mkdirSync(nativeDir, { recursive: true });

function cache(name, command, cwd) {
  console.log(`[cache-native] preparing better-sqlite3 for ${name}...`);
  execSync(command, { cwd, stdio: 'inherit' });
  if (!existsSync(built)) throw new Error(`build for ${name} produced no binary`);
  copyFileSync(built, join(nativeDir, `better_sqlite3-${name}.node`));
}

cache('node', 'npx --no-install prebuild-install -r node', pkgDir);
cache('electron', 'npx --no-install electron-rebuild -f -w better-sqlite3', root);

// The electron binary is what build/Release now holds; record that so select-native agrees.
rmSync(join(nativeDir, '.active'), { force: true });
console.log('[cache-native] done');
