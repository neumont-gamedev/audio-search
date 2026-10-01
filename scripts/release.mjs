// Creates a GitHub Release for the current package.json version and uploads the Windows
// installer and portable builds from dist/.
//
//   npm run release              build, then create a DRAFT release (review it, then Publish)
//   npm run release -- --publish build, then publish immediately
//   npm run release:upload       skip the build; upload what is already in dist/
//
// Every check runs before anything is uploaded, so a failed check changes nothing on GitHub.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const publish = process.argv.includes('--publish');
const { version, build } = JSON.parse(readFileSync('package.json', 'utf8'));
const product = build.productName;
const tag = `v${version}`;

const files = [`${product} Setup ${version}.exe`, `${product} ${version} Portable.exe`].map((name) =>
  join('dist', name),
);

/** Runs a command without a shell (paths contain spaces) and returns its result. */
function run(command, args, { quiet = true } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

function fail(message) {
  console.error(`\n[release] ${message}\n`);
  process.exit(1);
}

// 1. GitHub CLI installed and logged in.
if (!run('gh', ['auth', 'status']).ok) {
  fail('The GitHub CLI is not logged in. Run "gh auth login" in a terminal, then try again.');
}

// 2. The release must describe committed, pushed code: the tag is created from GitHub's main.
if (run('git', ['status', '--porcelain']).out) {
  fail('There are uncommitted changes. Commit (or stash) them first, so the release matches the code.');
}
const head = run('git', ['rev-parse', 'HEAD']).out;
const upstream = run('git', ['rev-parse', '@{u}']);
if (!upstream.ok || upstream.out !== head) {
  fail('Your latest commits are not on GitHub yet. Run "git push" first.');
}

// 3. One release per version.
if (run('gh', ['release', 'view', tag]).ok) {
  fail(`A release ${tag} already exists. Bump "version" in package.json for a new release.`);
}

// 4. Both builds present for this exact version.
for (const file of files) {
  if (!existsSync(file)) fail(`Missing ${file}. Run "npm run package" (or use "npm run release").`);
}
const sizes = files.map((file) => `${(statSync(file).size / 1024 / 1024).toFixed(0)} MB`);

const notes = `## Download

Pick one:

- **\`${product} Setup ${version}.exe\`** — installer. Installs for your user account only (no admin rights needed) and adds a Start Menu entry.
- **\`${product} ${version} Portable.exe\`** — portable. Runs directly with nothing installed; handy for USB sticks or lab machines.

Windows only. The builds are not code-signed, so Windows may show **"Windows protected your PC"** the first time: click **More info → Run anyway**.

Your audio never leaves your machine — there is no server and no account.
`;

console.log(`[release] ${publish ? 'Publishing' : 'Creating draft'} ${tag}:`);
files.forEach((file, i) => console.log(`  ${file}  (${sizes[i]})`));
console.log('[release] Uploading — about 160 MB, this can take a few minutes...\n');

const args = ['release', 'create', tag, ...files, '--title', `${product} ${version}`, '--notes', notes, '--generate-notes', '--target', 'main'];
if (!publish) args.push('--draft');

const created = run('gh', args, { quiet: false });
if (!created.ok) fail('GitHub rejected the release (see the message above). Nothing was published.');

console.log(
  publish
    ? `\n[release] Published ${tag}. Share: https://github.com/${repoSlug()}/releases/latest\n`
    : `\n[release] Draft ${tag} created — only you can see it. Review it, then click "Publish release":\n` +
        `  https://github.com/${repoSlug()}/releases\n`,
);

function repoSlug() {
  return run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).out || 'neumont-gamedev/audio-search';
}
