/**
 * better-sqlite3 is a native module, so the compiled binary must match the ABI of whatever
 * runtime loads it: Electron for the app, plain Node for vitest. Both binaries are cached
 * under native/ at install time; this script swaps the active one into place.
 *
 * Usage: node scripts/select-native.mjs <electron|node>
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];

if (target !== 'electron' && target !== 'node') {
  console.error('usage: node scripts/select-native.mjs <electron|node>');
  process.exit(1);
}

const source = join(root, 'native', `better_sqlite3-${target}.node`);
const destDir = join(root, 'node_modules', 'better-sqlite3', 'build', 'Release');
const dest = join(destDir, 'better_sqlite3.node');
const marker = join(root, 'native', '.active');

if (!existsSync(source)) {
  // Nothing cached for this runtime (e.g. a fresh clone before postinstall). Leave whatever
  // is in place rather than breaking the build.
  console.warn(`[select-native] no cached ${target} binary; leaving current build in place`);
  process.exit(0);
}

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === target) {
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

// Clear the marker first. If the copy fails or is interrupted, the marker must not keep
// claiming an ABI that is no longer in place - otherwise the next run trusts that claim,
// skips the copy, and the wrong binary loads with a baffling error.
rmSync(marker, { force: true });

try {
  copyFileSync(source, dest);
} catch (error) {
  if (error.code === 'EBUSY' || error.code === 'EPERM') {
    // Windows locks a loaded .node file, so a running instance of the app blocks the swap.
    console.error(
      `\n[select-native] Could not switch better-sqlite3 to the ${target} build because the ` +
        `current one is in use.\nClose the running app (or any Electron process from it) and ` +
        `try again.\n`,
    );
    process.exit(1);
  }
  throw error;
}

writeFileSync(marker, target);
console.log(`[select-native] better-sqlite3 binary set to ${target} ABI`);
