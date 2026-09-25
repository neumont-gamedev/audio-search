import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyAsset, copyAssets, findAvailableName } from '../src/main/filesystem/fileActions';
import { cleanup, makeTempDir, writeFile } from './helpers';

describe('findAvailableName', () => {
  it('keeps the original name when nothing collides', async () => {
    const taken = new Set<string>();
    const name = await findAvailableName('/dest', 'explosion.wav', async (p) => taken.has(p));
    expect(name).toBe('explosion.wav');
  });

  it('follows the name_2, name_3 pattern', async () => {
    const taken = new Set([join('/dest', 'explosion.wav'), join('/dest', 'explosion_2.wav')]);
    const name = await findAvailableName('/dest', 'explosion.wav', async (p) => taken.has(p));
    expect(name).toBe('explosion_3.wav');
  });

  it('keeps the extension when renaming a dotted filename', async () => {
    const taken = new Set([join('/dest', 'my.sound.v1.wav')]);
    const name = await findAvailableName('/dest', 'my.sound.v1.wav', async (p) => taken.has(p));
    expect(name).toBe('my.sound.v1_2.wav');
  });

  it('handles a filename with no extension', async () => {
    const taken = new Set([join('/dest', 'README')]);
    const name = await findAvailableName('/dest', 'README', async (p) => taken.has(p));
    expect(name).toBe('README_2');
  });
});

describe('copyAsset', () => {
  let source: string;
  let destination: string;

  beforeEach(() => {
    source = makeTempDir('audio-src-');
    destination = makeTempDir('audio-dest-');
  });

  afterEach(() => {
    cleanup(source);
    cleanup(destination);
  });

  it('copies a file into the destination folder', async () => {
    const file = writeFile(source, 'Combat/punch03.wav', 'PUNCH');

    const result = await copyAsset({ sourcePath: file, destinationDirectory: destination });

    expect(result.status).toBe('copied');
    expect(readFileSync(join(destination, 'punch03.wav'), 'utf8')).toBe('PUNCH');
  });

  it('leaves the source untouched', async () => {
    const file = writeFile(source, 'punch.wav', 'ORIGINAL');
    await copyAsset({ sourcePath: file, destinationDirectory: destination });

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('ORIGINAL');
  });

  it('creates the destination folder when it does not exist', async () => {
    const file = writeFile(source, 'punch.wav', 'X');
    const nested = join(destination, 'Content', 'Audio', 'SFX');

    const result = await copyAsset({ sourcePath: file, destinationDirectory: nested });

    expect(result.status).toBe('copied');
    expect(existsSync(join(nested, 'punch.wav'))).toBe(true);
  });

  it('reports a conflict instead of overwriting', async () => {
    const file = writeFile(source, 'punch.wav', 'NEW');
    writeFile(destination, 'punch.wav', 'EXISTING');

    const result = await copyAsset({ sourcePath: file, destinationDirectory: destination });

    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') expect(result.suggestedName).toBe('punch_2.wav');
    // Crucially, the existing file is still intact.
    expect(readFileSync(join(destination, 'punch.wav'), 'utf8')).toBe('EXISTING');
  });

  it('leaves everything alone when the user cancels', async () => {
    const file = writeFile(source, 'punch.wav', 'NEW');
    writeFile(destination, 'punch.wav', 'EXISTING');

    const result = await copyAsset({
      sourcePath: file,
      destinationDirectory: destination,
      strategy: 'cancel',
    });

    expect(result.status).toBe('cancelled');
    expect(readFileSync(join(destination, 'punch.wav'), 'utf8')).toBe('EXISTING');
  });

  it('overwrites only when explicitly asked', async () => {
    const file = writeFile(source, 'punch.wav', 'NEW');
    writeFile(destination, 'punch.wav', 'EXISTING');

    const result = await copyAsset({
      sourcePath: file,
      destinationDirectory: destination,
      strategy: 'overwrite',
    });

    expect(result.status).toBe('copied');
    expect(readFileSync(join(destination, 'punch.wav'), 'utf8')).toBe('NEW');
  });

  it('keeps both files when asked to rename', async () => {
    const file = writeFile(source, 'punch.wav', 'NEW');
    writeFile(destination, 'punch.wav', 'EXISTING');

    const result = await copyAsset({
      sourcePath: file,
      destinationDirectory: destination,
      strategy: 'rename',
    });

    expect(result.status).toBe('copied');
    if (result.status === 'copied') expect(result.destinationFile).toContain('punch_2.wav');
    expect(readFileSync(join(destination, 'punch.wav'), 'utf8')).toBe('EXISTING');
    expect(readFileSync(join(destination, 'punch_2.wav'), 'utf8')).toBe('NEW');
  });

  it('increments past several existing copies', async () => {
    const file = writeFile(source, 'explosion.wav', 'NEW');
    writeFile(destination, 'explosion.wav', 'A');
    writeFile(destination, 'explosion_2.wav', 'B');

    const result = await copyAsset({
      sourcePath: file,
      destinationDirectory: destination,
      strategy: 'rename',
    });

    if (result.status === 'copied') expect(result.destinationFile).toContain('explosion_3.wav');
    expect(readFileSync(join(destination, 'explosion_3.wav'), 'utf8')).toBe('NEW');
  });

  it('reports an understandable error when the source is gone', async () => {
    const result = await copyAsset({
      sourcePath: join(source, 'never-existed.wav'),
      destinationDirectory: destination,
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/no longer exists/i);
  });
});

describe('copyAssets (batch)', () => {
  let source: string;
  let destination: string;

  beforeEach(() => {
    source = makeTempDir('audio-src-');
    destination = makeTempDir('audio-dest-');
  });

  afterEach(() => {
    cleanup(source);
    cleanup(destination);
  });

  const item = (relativePath: string, content: string, fileId: number) => ({
    fileId,
    sourcePath: writeFile(source, relativePath, content),
    filename: relativePath.split('/').pop() as string,
  });

  it('copies every file in the batch', async () => {
    const items = [
      item('Combat/punch.wav', 'A', 1),
      item('UI/click.wav', 'B', 2),
      item('Ambience/wind.wav', 'C', 3),
    ];

    const outcome = await copyAssets(items, destination);

    expect(outcome.copied).toHaveLength(3);
    expect(outcome.conflicts).toHaveLength(0);
    expect(outcome.errors).toHaveLength(0);
    expect(readFileSync(join(destination, 'punch.wav'), 'utf8')).toBe('A');
    expect(readFileSync(join(destination, 'wind.wav'), 'utf8')).toBe('C');
  });

  it('flattens the source folder structure into one destination', async () => {
    const items = [item('Deep/Nested/Folder/sound.wav', 'X', 1)];
    await copyAssets(items, destination);
    expect(existsSync(join(destination, 'sound.wav'))).toBe(true);
  });

  it('reports collisions per file and copies the rest', async () => {
    writeFile(destination, 'punch.wav', 'EXISTING');
    const items = [item('punch.wav', 'NEW', 1), item('click.wav', 'NEW', 2)];

    const outcome = await copyAssets(items, destination);

    expect(outcome.copied.map((c) => c.fileId)).toEqual([2]);
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0].fileId).toBe(1);
    expect(outcome.conflicts[0].suggestedName).toBe('punch_2.wav');
    // The collision was left untouched, not overwritten.
    expect(readFileSync(join(destination, 'punch.wav'), 'utf8')).toBe('EXISTING');
  });

  it('applies one strategy across the whole batch', async () => {
    writeFile(destination, 'a.wav', 'OLD-A');
    writeFile(destination, 'b.wav', 'OLD-B');
    const items = [item('a.wav', 'NEW-A', 1), item('b.wav', 'NEW-B', 2)];

    const outcome = await copyAssets(items, destination, 'rename');

    expect(outcome.copied).toHaveLength(2);
    expect(readFileSync(join(destination, 'a.wav'), 'utf8')).toBe('OLD-A');
    expect(readFileSync(join(destination, 'a_2.wav'), 'utf8')).toBe('NEW-A');
    expect(readFileSync(join(destination, 'b_2.wav'), 'utf8')).toBe('NEW-B');
  });

  it('overwrites the whole batch only when told to', async () => {
    writeFile(destination, 'a.wav', 'OLD');
    const outcome = await copyAssets([item('a.wav', 'NEW', 1)], destination, 'overwrite');

    expect(outcome.copied).toHaveLength(1);
    expect(readFileSync(join(destination, 'a.wav'), 'utf8')).toBe('NEW');
  });

  it('counts skipped files when the batch is cancelled', async () => {
    writeFile(destination, 'a.wav', 'OLD');
    const outcome = await copyAssets([item('a.wav', 'NEW', 1)], destination, 'cancel');

    expect(outcome.cancelled).toBe(1);
    expect(outcome.copied).toHaveLength(0);
    expect(readFileSync(join(destination, 'a.wav'), 'utf8')).toBe('OLD');
  });

  it('keeps going when one file fails', async () => {
    const items = [
      item('good1.wav', 'A', 1),
      { fileId: 2, sourcePath: join(source, 'vanished.wav'), filename: 'vanished.wav' },
      item('good2.wav', 'C', 3),
    ];

    const outcome = await copyAssets(items, destination);

    // The missing file is reported, and both healthy files still arrive.
    expect(outcome.copied.map((c) => c.fileId).sort()).toEqual([1, 3]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].fileId).toBe(2);
  });

  it('renames within the batch when two sources share a filename', async () => {
    const items = [
      { ...item('PackA/hit.wav', 'FROM-A', 1) },
      { ...item('PackB/hit.wav', 'FROM-B', 2) },
    ];

    const first = await copyAssets(items, destination);
    // The second copy collides with the first one written moments earlier.
    expect(first.copied).toHaveLength(1);
    expect(first.conflicts).toHaveLength(1);

    const second = await copyAssets(
      items.filter((i) => i.fileId === first.conflicts[0].fileId),
      destination,
      'rename',
    );

    expect(second.copied).toHaveLength(1);
    expect(readFileSync(join(destination, 'hit.wav'), 'utf8')).toBe('FROM-A');
    expect(readFileSync(join(destination, 'hit_2.wav'), 'utf8')).toBe('FROM-B');
  });

  it('handles an empty batch', async () => {
    const outcome = await copyAssets([], destination);
    expect(outcome.copied).toHaveLength(0);
    expect(outcome.errors).toHaveLength(0);
  });
});
