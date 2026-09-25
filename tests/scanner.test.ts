import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanDirectory } from '../src/main/filesystem/scanner';
import { cleanup, makeTempDir, writeFile } from './helpers';

describe('scanDirectory', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    cleanup(root);
  });

  it('finds supported audio files at any depth', async () => {
    writeFile(root, 'punch.wav');
    writeFile(root, 'Combat/Impacts/Body/impact_heavy_03.wav');
    writeFile(root, 'AssetPacks/Pack01/Deep/Nested/beep.mp3');
    writeFile(root, 'UI/click.ogg');
    writeFile(root, 'Ambience/wind.flac');
    writeFile(root, 'Voice/line.m4a');

    const files = await scanDirectory(root);
    const names = files.map((file) => file.filename).sort();

    expect(names).toEqual([
      'beep.mp3',
      'click.ogg',
      'impact_heavy_03.wav',
      'line.m4a',
      'punch.wav',
      'wind.flac',
    ]);
  });

  it('ignores unsupported file types', async () => {
    writeFile(root, 'keep.wav');
    writeFile(root, 'readme.txt');
    writeFile(root, 'cover.png');
    writeFile(root, 'project.uasset');

    const files = await scanDirectory(root);
    expect(files.map((file) => file.filename)).toEqual(['keep.wav']);
  });

  it('matches extensions case-insensitively', async () => {
    writeFile(root, 'Loud.WAV');
    writeFile(root, 'Quiet.Mp3');

    const files = await scanDirectory(root);
    expect(files).toHaveLength(2);
    // The stored extension is normalized even though the filename keeps its casing.
    expect(files.map((file) => file.extension).sort()).toEqual(['.mp3', '.wav']);
    expect(files.map((file) => file.filename).sort()).toEqual(['Loud.WAV', 'Quiet.Mp3']);
  });

  it('skips directories that never hold user assets', async () => {
    writeFile(root, 'node_modules/pkg/sound.wav');
    writeFile(root, '.git/objects/thing.wav');
    writeFile(root, 'real/sound.wav');

    const files = await scanDirectory(root);
    expect(files).toHaveLength(1);
    expect(files[0].absolutePath).toContain('real');
  });

  it('records size and modification time', async () => {
    const content = 'abcdefghij';
    writeFile(root, 'sized.wav', content);

    const files = await scanDirectory(root);
    expect(files[0].fileSize).toBe(content.length);
    expect(files[0].modifiedAt).toBeGreaterThan(0);
  });

  it('normalizes paths to forward slashes', async () => {
    writeFile(root, 'Combat/Punches/hit.wav');

    const files = await scanDirectory(root);
    expect(files[0].absolutePath).not.toContain('\\');
    expect(files[0].absolutePath.endsWith('Combat/Punches/hit.wav')).toBe(true);
  });

  it('reports unreadable entries without aborting the scan', async () => {
    writeFile(root, 'good.wav');

    const errors: string[] = [];
    // Point the walk at a directory that does not exist to force an error path.
    const files = await scanDirectory(join(root, 'missing'), {
      onError: (path) => errors.push(path),
    });

    expect(files).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('stops promptly when cancelled', async () => {
    for (let i = 0; i < 50; i++) writeFile(root, `folder${i}/sound${i}.wav`);

    let seen = 0;
    const files = await scanDirectory(root, {
      onFile: () => {
        seen++;
      },
      shouldCancel: () => seen >= 5,
    });

    expect(files.length).toBeLessThan(50);
  });

  it('reports progress for each file as it is found', async () => {
    writeFile(root, 'a.wav');
    writeFile(root, 'b/c.wav');

    const reported: string[] = [];
    await scanDirectory(root, { onFile: (file) => void reported.push(file.filename) });

    expect(reported.sort()).toEqual(['a.wav', 'c.wav']);
  });

  it('handles an empty directory tree', async () => {
    mkdirSync(join(root, 'empty/deeper'), { recursive: true });
    expect(await scanDirectory(root)).toEqual([]);
  });

  it('does not descend past the depth limit', async () => {
    const deep = join(root, Array.from({ length: 12 }, (_, i) => `d${i}`).join('/'));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'buried.wav'), 'x');

    expect(await scanDirectory(root, { maxDepth: 3 })).toEqual([]);
    expect(await scanDirectory(root, { maxDepth: 20 })).toHaveLength(1);
  });
});
