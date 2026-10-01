import BetterSqlite3, { type Database } from 'better-sqlite3';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countFiles,
  getWaveform,
  IndexWriter,
  loadLibraryStamps,
  removeFileByPath,
  setWaveform,
} from '../src/main/database/audioFiles';
import { closeDatabase, createInMemoryDatabase, openDatabase } from '../src/main/database/db';
import { addLibrary, findLibraryByPath, listLibraries, removeLibrary } from '../src/main/database/libraries';
import { LATEST_VERSION } from '../src/main/database/migrations';
import { getFileById, search } from '../src/main/database/search';
import {
  addDestination,
  addTag,
  listDestinations,
  listTagsForFile,
  MAX_RECENT_DESTINATIONS,
  removeTag,
  setFavorite,
  touchDestination,
} from '../src/main/database/userData';
import { cleanup, makeTempDir } from './helpers';

function record(libraryId: number, relativePath: string, overrides: Record<string, unknown> = {}) {
  const filename = relativePath.split('/').pop() as string;
  return {
    libraryId,
    absolutePath: `D:/Audio/${relativePath}`,
    relativePath,
    filename,
    extension: filename.slice(filename.lastIndexOf('.')),
    parentFolder: '',
    fileSize: 100,
    duration: 1,
    sampleRate: 44100,
    bitDepth: 16,
    channels: 2,
    bitrate: 1411,
    modifiedAt: 1000,
    metadataOk: true,
    ...overrides,
  };
}

describe('migrations', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('audio-db-');
  });

  afterEach(() => {
    closeDatabase();
    cleanup(dir);
  });

  it('creates the schema at the latest version', () => {
    const db = openDatabase(join(dir, 'index.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
  });

  it('survives closing and reopening without rebuilding', () => {
    const path = join(dir, 'index.db');

    const db = openDatabase(path);
    const library = addLibrary(db, 'D:/Audio', 'Main');
    new IndexWriter(db).upsert(record(library.id, 'Combat/punch.wav'));
    closeDatabase();

    // Reopening is exactly what happens when the user restarts the application.
    const reopened = openDatabase(path);
    expect(reopened.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    expect(countFiles(reopened)).toBe(1);
    expect(listLibraries(reopened, () => true)).toHaveLength(1);
  });

  it('is safe to run twice', () => {
    const path = join(dir, 'index.db');
    openDatabase(path);
    closeDatabase();
    expect(() => openDatabase(path)).not.toThrow();
  });

  it('upgrades a database from an earlier version in place', () => {
    const path = join(dir, 'old.db');

    // A schema as it stood at version 2, before destinations tracked recency.
    const old = new BetterSqlite3(path);
    old.exec(`
      CREATE TABLE destinations (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE
      );
    `);
    old.prepare('INSERT INTO destinations (name, path) VALUES (?, ?)').run('Old Game', 'D:/Old');
    old.pragma('user_version = 2');
    old.close();

    const upgraded = openDatabase(path);

    expect(upgraded.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    // The saved destination survives, and is treated as recently used rather than ancient
    // so it is not the first thing pruned.
    const saved = listDestinations(upgraded);
    expect(saved).toHaveLength(1);
    expect(saved[0].path).toBe('D:/Old');
    expect(
      (upgraded.prepare('SELECT last_used_at AS t FROM destinations').get() as { t: number }).t,
    ).toBeGreaterThan(0);
  });

  it('refuses a database from a newer version of the application', () => {
    const path = join(dir, 'future.db');
    const raw = new BetterSqlite3(path);
    raw.pragma(`user_version = ${LATEST_VERSION + 5}`);
    raw.close();

    expect(() => openDatabase(path)).toThrow(/newer version/i);
  });
});

describe('libraries', () => {
  let db: Database;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(() => db.close());

  it('stores the fields the UI needs', () => {
    const library = addLibrary(db, 'D:/GameAssets/Audio');
    expect(library.id).toBeGreaterThan(0);
    expect(library.path).toBe('D:/GameAssets/Audio');
    expect(library.name).toBe('Audio');
    expect(library.addedAt).toBeGreaterThan(0);
    expect(library.lastScanAt).toBeNull();
    expect(library.fileCount).toBe(0);
  });

  it('does not add the same folder twice', () => {
    const first = addLibrary(db, 'D:/Audio');
    const second = addLibrary(db, 'D:/Audio/');
    expect(second.id).toBe(first.id);
    expect(listLibraries(db, () => true)).toHaveLength(1);
  });

  it('finds a library by path regardless of separator style', () => {
    const library = addLibrary(db, 'D:/Audio');
    expect(findLibraryByPath(db, 'D:/Audio')?.id).toBe(library.id);
  });

  it('counts the files in each library', () => {
    const library = addLibrary(db, 'D:/Audio');
    const writer = new IndexWriter(db);
    writer.upsert(record(library.id, 'a.wav'));
    writer.upsert(record(library.id, 'b.wav'));

    expect(listLibraries(db, () => true)[0].fileCount).toBe(2);
  });

  it('removing a library takes its index rows with it', () => {
    const keep = addLibrary(db, 'D:/Keep');
    const drop = addLibrary(db, 'D:/Drop');
    const writer = new IndexWriter(db);
    writer.upsert(record(keep.id, 'keep.wav'));
    writer.upsert(record(drop.id, 'drop.wav'));

    removeLibrary(db, drop.id);

    expect(countFiles(db)).toBe(1);
    // The FTS index must not keep stale rows behind.
    expect(search(db, baseQuery('drop')).total).toBe(0);
    expect(search(db, baseQuery('keep')).total).toBe(1);
  });
});

describe('IndexWriter', () => {
  let db: Database;
  let libraryId: number;

  beforeEach(() => {
    db = createInMemoryDatabase();
    libraryId = addLibrary(db, 'D:/Audio').id;
  });

  afterEach(() => db.close());

  describe('waveform cache', () => {
    const peaks = Uint8Array.from([1, 10, 200, 255]);

    it('stores and returns a waveform, and has none before one is generated', () => {
      const id = new IndexWriter(db).upsert(record(libraryId, 'a.wav'));
      expect(getWaveform(db, id)).toBeNull();
      expect(setWaveform(db, id, peaks)).toBe(true);
      expect([...(getWaveform(db, id) ?? [])]).toEqual([...peaks]);
    });

    it('clears the waveform when the file is re-indexed because it changed', () => {
      const writer = new IndexWriter(db);
      const id = writer.upsert(record(libraryId, 'a.wav'));
      setWaveform(db, id, peaks);
      writer.upsert(record(libraryId, 'a.wav', { fileSize: 999, modifiedAt: 2000 }));
      expect(getWaveform(db, id)).toBeNull();
    });

    it('keeps the waveform for an unchanged file on a rescan', () => {
      const writer = new IndexWriter(db);
      const id = writer.upsert(record(libraryId, 'a.wav'));
      setWaveform(db, id, peaks);
      // Unchanged files are only touched, never upserted (see the indexer).
      writer.touch(id);
      expect(getWaveform(db, id)).not.toBeNull();
    });

    it('reports a file that left the index instead of failing', () => {
      const writer = new IndexWriter(db);
      const id = writer.upsert(record(libraryId, 'a.wav'));
      writer.remove(id);
      expect(setWaveform(db, id, peaks)).toBe(false);
      expect(getWaveform(db, id)).toBeNull();
    });
  });

  it('keeps one row per path when the same file is indexed again', () => {
    const writer = new IndexWriter(db);
    const first = writer.upsert(record(libraryId, 'a.wav'));
    const second = writer.upsert(record(libraryId, 'a.wav', { fileSize: 999 }));

    expect(second).toBe(first);
    expect(countFiles(db)).toBe(1);
    expect(getFileById(db, first)?.fileSize).toBe(999);
  });

  it('does not leave duplicate FTS entries after an update', () => {
    const writer = new IndexWriter(db);
    writer.upsert(record(libraryId, 'Combat/punch.wav'));
    writer.upsert(record(libraryId, 'Combat/punch.wav'));

    expect(search(db, baseQuery('punch')).total).toBe(1);
  });

  it('updates the FTS text when a file is re-indexed under a new name', () => {
    const writer = new IndexWriter(db);
    const id = writer.upsert(record(libraryId, 'old_name.wav'));
    writer.upsert(
      record(libraryId, 'new_name.wav', { absolutePath: 'D:/Audio/old_name.wav' }),
    );

    expect(search(db, baseQuery('old')).total).toBe(0);
    expect(search(db, baseQuery('new')).total).toBe(1);
    expect(getFileById(db, id)?.filename).toBe('new_name.wav');
  });

  it('removes a file from both tables', () => {
    const writer = new IndexWriter(db);
    const id = writer.upsert(record(libraryId, 'gone.wav'));

    writer.remove(id);

    expect(countFiles(db)).toBe(0);
    expect(search(db, baseQuery('gone')).total).toBe(0);
  });

  it('removes a file by path', () => {
    new IndexWriter(db).upsert(record(libraryId, 'bye.wav'));

    expect(removeFileByPath(db, 'D:/Audio/bye.wav')).toBe(true);
    expect(removeFileByPath(db, 'D:/Audio/never.wav')).toBe(false);
    expect(countFiles(db)).toBe(0);
  });

  it('loads stamps for change detection', () => {
    const writer = new IndexWriter(db);
    writer.upsert(record(libraryId, 'a.wav', { fileSize: 50, modifiedAt: 1234 }));

    const stamps = loadLibraryStamps(db, libraryId);
    const stamp = stamps.get('d:/audio/a.wav');
    expect(stamp?.fileSize).toBe(50);
    expect(stamp?.modifiedAt).toBe(1234);
  });

  it('applies a batch atomically', () => {
    const writer = new IndexWriter(db);

    expect(() =>
      writer.batch(() => {
        writer.upsert(record(libraryId, 'ok.wav'));
        throw new Error('something went wrong mid-batch');
      }),
    ).toThrow();

    // The failed batch must leave no partial rows behind.
    expect(countFiles(db)).toBe(0);
  });
});

describe('favorites, tags and destinations', () => {
  let db: Database;
  let fileId: number;

  beforeEach(() => {
    db = createInMemoryDatabase();
    const libraryId = addLibrary(db, 'D:/Audio').id;
    fileId = new IndexWriter(db).upsert(record(libraryId, 'punch03.wav'));
  });

  afterEach(() => db.close());

  it('marks and unmarks favorites', () => {
    setFavorite(db, fileId, true);
    expect(getFileById(db, fileId)?.favorite).toBe(true);

    setFavorite(db, fileId, false);
    expect(getFileById(db, fileId)?.favorite).toBe(false);
  });

  it('tolerates favoriting twice', () => {
    setFavorite(db, fileId, true);
    expect(() => setFavorite(db, fileId, true)).not.toThrow();
  });

  it('attaches and removes tags', () => {
    addTag(db, fileId, 'punch');
    addTag(db, fileId, 'combat');
    addTag(db, fileId, 'punch'); // duplicate, should be ignored

    const tags = listTagsForFile(db, fileId);
    expect(tags.map((tag) => tag.name).sort()).toEqual(['combat', 'punch']);

    removeTag(db, fileId, tags[0].id);
    expect(listTagsForFile(db, fileId)).toHaveLength(1);
  });

  it('ignores an empty tag', () => {
    addTag(db, fileId, '   ');
    expect(listTagsForFile(db, fileId)).toHaveLength(0);
  });

  it('drops favorites and tags when the file leaves the index', () => {
    setFavorite(db, fileId, true);
    addTag(db, fileId, 'punch');

    new IndexWriter(db).remove(fileId);

    expect(db.prepare('SELECT COUNT(*) AS n FROM favorites').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM file_tags').get()).toEqual({ n: 0 });
  });

  it('remembers a destination folder', () => {
    addDestination(db, 'Audio', 'D:/Projects/SpaceGame/Content/Audio');
    const saved = listDestinations(db);
    expect(saved).toHaveLength(1);
    expect(saved[0].path).toBe('D:/Projects/SpaceGame/Content/Audio');
  });

  it('does not duplicate a folder that is chosen again', () => {
    addDestination(db, 'Audio', 'D:/Projects/SpaceGame/Content/Audio');
    addDestination(db, 'Audio', 'D:/Projects/SpaceGame/Content/Audio/');
    expect(listDestinations(db)).toHaveLength(1);
  });

  it('lists the most recently used destination first', () => {
    const first = addDestination(db, 'A', 'D:/One');
    addDestination(db, 'B', 'D:/Two');
    expect(listDestinations(db)[0].path).toBe('D:/Two');

    // Copying into the older folder promotes it back to the top.
    touchDestination(db, 'D:/One');
    const ordered = listDestinations(db);
    expect(ordered[0].id).toBe(first.id);
  });

  it('treats a touch of an unknown path as a no-op', () => {
    addDestination(db, 'A', 'D:/One');
    expect(() => touchDestination(db, 'D:/Nowhere')).not.toThrow();
    expect(listDestinations(db)).toHaveLength(1);
  });

  it('caps the recent list and drops the least recently used', () => {
    for (let i = 0; i < MAX_RECENT_DESTINATIONS + 5; i++) {
      addDestination(db, `Dest ${i}`, `D:/Projects/P${i}/Audio`);
    }

    const saved = listDestinations(db);
    expect(saved).toHaveLength(MAX_RECENT_DESTINATIONS);
    // The newest survive; the earliest folders have been pruned away.
    expect(saved.some((d) => d.path === 'D:/Projects/P14/Audio')).toBe(true);
    expect(saved.some((d) => d.path === 'D:/Projects/P0/Audio')).toBe(false);
  });

  it('keeps a folder alive when it is used again', () => {
    addDestination(db, 'Keeper', 'D:/Keeper');
    for (let i = 0; i < MAX_RECENT_DESTINATIONS - 1; i++) {
      addDestination(db, `Dest ${i}`, `D:/Filler${i}`);
      // Re-using the keeper keeps it the most recent, so it is never the one pruned.
      touchDestination(db, 'D:/Keeper');
    }
    addDestination(db, 'Newest', 'D:/Newest');

    expect(listDestinations(db).some((d) => d.path === 'D:/Keeper')).toBe(true);
  });
});

function baseQuery(text: string) {
  return {
    text,
    filters: {
      libraryIds: [],
      extensions: [],
      durationBuckets: [],
      durationRange: null,
      channels: [],
      sampleRates: [],
      favoritesOnly: false,
    },
    sortField: 'filename' as const,
    sortDirection: 'asc' as const,
    limit: 100,
    offset: 0,
  };
}
