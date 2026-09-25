import type { Database } from 'better-sqlite3';
import { existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Library, ScanProgress, SearchQuery } from '../src/shared/types';
import { countFiles } from '../src/main/database/audioFiles';
import { createInMemoryDatabase } from '../src/main/database/db';
import { addLibrary, getLibrary, removeLibrary } from '../src/main/database/libraries';
import { search } from '../src/main/database/search';
import { normalizePath } from '../src/main/filesystem/pathUtils';
import { Indexer } from '../src/main/indexing/indexer';
import { cleanup, makeTempDir, writeFile, writeWav } from './helpers';

const BASE_QUERY: Omit<SearchQuery, 'text'> = {
  filters: {
    libraryIds: [],
    extensions: [],
    durationBuckets: [],
    durationRange: null,
    channels: [],
    sampleRates: [],
    favoritesOnly: false,
  },
  sortField: 'filename',
  sortDirection: 'asc',
  limit: 500,
  offset: 0,
};

describe('Indexer', () => {
  let db: Database;
  let root: string;
  let library: Library;
  let progress: ScanProgress[];
  let indexer: Indexer;

  beforeEach(() => {
    db = createInMemoryDatabase();
    root = makeTempDir('audio-lib-');
    library = addLibrary(db, root, 'Test Library');
    progress = [];
    indexer = new Indexer(db, (update) => progress.push(update));
  });

  afterEach(() => {
    db.close();
    cleanup(root);
  });

  const lastProgress = () => progress[progress.length - 1];

  it('indexes a folder tree and makes it searchable', async () => {
    writeWav(root, 'Combat/Punches/punch_heavy_01.wav', { frames: 44100 });
    writeWav(root, 'UI/click.wav', { frames: 4410 });
    writeWav(root, 'Ambience/wind.wav', { frames: 441000 });

    await indexer.enqueue(library);

    expect(countFiles(db, library.id)).toBe(3);
    expect(search(db, { ...BASE_QUERY, text: 'punch' }).total).toBe(1);
    expect(search(db, { ...BASE_QUERY, text: 'combat' }).total).toBe(1);
  });

  it('extracts technical metadata from real audio headers', async () => {
    writeWav(root, 'stereo48.wav', { sampleRate: 48000, channels: 2, bitsPerSample: 16, frames: 48000 });

    await indexer.enqueue(library);

    const [file] = search(db, { ...BASE_QUERY, text: '' }).items;
    expect(file.sampleRate).toBe(48000);
    expect(file.channels).toBe(2);
    expect(file.bitDepth).toBe(16);
    expect(file.duration).toBeCloseTo(1, 2);
  });

  it('reports progress through discovery and indexing', async () => {
    for (let i = 0; i < 5; i++) writeWav(root, `sound${i}.wav`, { frames: 4410 });

    await indexer.enqueue(library);

    expect(progress.some((p) => p.phase === 'discovering')).toBe(true);
    expect(lastProgress().phase).toBe('done');
    expect(lastProgress().discovered).toBe(5);
    expect(lastProgress().indexed).toBe(5);
  });

  it('records the scan time on the library', async () => {
    writeWav(root, 'a.wav', { frames: 4410 });
    await indexer.enqueue(library);

    expect(getLibrary(db, library.id)?.lastScanAt).toBeGreaterThan(0);
  });

  describe('rescanning', () => {
    it('skips files that have not changed', async () => {
      writeWav(root, 'a.wav', { frames: 4410 });
      writeWav(root, 'b.wav', { frames: 4410 });
      await indexer.enqueue(library);

      progress = [];
      await indexer.enqueue(getLibrary(db, library.id)!);

      // Nothing changed, so no file should have been parsed a second time.
      expect(lastProgress().skipped).toBe(2);
      expect(lastProgress().indexed).toBe(0);
      expect(countFiles(db, library.id)).toBe(2);
    });

    it('re-reads a file whose contents changed', async () => {
      const file = writeWav(root, 'a.wav', { sampleRate: 44100, frames: 4410 });
      await indexer.enqueue(library);
      expect(search(db, { ...BASE_QUERY, text: '' }).items[0].sampleRate).toBe(44100);

      writeWav(root, 'a.wav', { sampleRate: 48000, frames: 9600 });
      // Make sure the mtime really differs even on a coarse-grained clock.
      const future = new Date(Date.now() + 5000);
      utimesSync(file, future, future);

      progress = [];
      await indexer.enqueue(getLibrary(db, library.id)!);

      expect(lastProgress().indexed).toBe(1);
      expect(search(db, { ...BASE_QUERY, text: '' }).items[0].sampleRate).toBe(48000);
    });

    it('picks up newly added files', async () => {
      writeWav(root, 'a.wav', { frames: 4410 });
      await indexer.enqueue(library);

      writeWav(root, 'New/b.wav', { frames: 4410 });
      progress = [];
      await indexer.enqueue(getLibrary(db, library.id)!);

      expect(countFiles(db, library.id)).toBe(2);
      expect(lastProgress().indexed).toBe(1);
      expect(lastProgress().skipped).toBe(1);
    });

    it('removes deleted files from the index', async () => {
      writeWav(root, 'keep.wav', { frames: 4410 });
      const doomed = writeWav(root, 'delete_me.wav', { frames: 4410 });
      await indexer.enqueue(library);
      expect(countFiles(db, library.id)).toBe(2);

      rmSync(doomed);
      progress = [];
      await indexer.enqueue(getLibrary(db, library.id)!);

      expect(countFiles(db, library.id)).toBe(1);
      expect(lastProgress().removed).toBe(1);
      expect(search(db, { ...BASE_QUERY, text: 'delete' }).total).toBe(0);
    });

    it('treats a moved file as a delete plus an add', async () => {
      writeWav(root, 'Old/sound.wav', { frames: 4410 });
      await indexer.enqueue(library);

      const oldPath = join(root, 'Old/sound.wav');
      writeWav(root, 'New/sound.wav', { frames: 4410 });
      rmSync(oldPath);

      await indexer.enqueue(getLibrary(db, library.id)!);

      const items = search(db, { ...BASE_QUERY, text: '' }).items;
      expect(items).toHaveLength(1);
      expect(items[0].relativePath).toBe('New/sound.wav');
    });
  });

  describe('resilience', () => {
    it('indexes a malformed audio file instead of failing the scan', async () => {
      writeWav(root, 'good.wav', { frames: 4410 });
      writeFile(root, 'corrupt.wav', 'this is definitely not a wav file');

      await indexer.enqueue(library);

      // Both files are indexed; only the metadata of the bad one is missing.
      expect(countFiles(db, library.id)).toBe(2);
      const corrupt = search(db, { ...BASE_QUERY, text: 'corrupt' }).items[0];
      expect(corrupt).toBeDefined();
      expect(corrupt.duration).toBeNull();
      expect(lastProgress().failed).toBeGreaterThanOrEqual(1);
      expect(lastProgress().phase).toBe('done');
    });

    it('reports an error when the library folder is gone', async () => {
      const missing = addLibrary(db, join(root, 'not-here'), 'Missing');
      await indexer.enqueue(missing);

      expect(lastProgress().phase).toBe('error');
      expect(lastProgress().message).toMatch(/unavailable/i);
    });

    it('ignores a second scan request for a library already scanning', async () => {
      for (let i = 0; i < 20; i++) writeWav(root, `s${i}.wav`, { frames: 4410 });

      const first = indexer.enqueue(library);
      const second = indexer.enqueue(library);
      await Promise.all([first, second]);

      expect(countFiles(db, library.id)).toBe(20);
    });

    it('stores paths that are unique within the index', async () => {
      writeWav(root, 'a.wav', { frames: 4410 });
      await indexer.enqueue(library);
      await indexer.enqueue(getLibrary(db, library.id)!);
      await indexer.enqueue(getLibrary(db, library.id)!);

      expect(countFiles(db, library.id)).toBe(1);
    });
  });

  describe('library removal', () => {
    it('drops index rows but never the files on disk', async () => {
      const file = writeWav(root, 'precious.wav', { frames: 4410 });
      await indexer.enqueue(library);
      expect(countFiles(db, library.id)).toBe(1);

      removeLibrary(db, library.id);

      expect(countFiles(db)).toBe(0);
      expect(search(db, { ...BASE_QUERY, text: 'precious' }).total).toBe(0);
      // The whole point: the user's asset is still on disk.
      expect(existsSync(file)).toBe(true);
    });
  });

  it('stores library-relative paths with forward slashes', async () => {
    writeWav(root, 'Deep/Nested/Folder/sound.wav', { frames: 4410 });
    await indexer.enqueue(library);

    const [file] = search(db, { ...BASE_QUERY, text: '' }).items;
    expect(file.relativePath).toBe('Deep/Nested/Folder/sound.wav');
    expect(file.parentFolder).toBe('Folder');
    expect(file.absolutePath).toBe(normalizePath(join(root, 'Deep/Nested/Folder/sound.wav')));
  });
});
