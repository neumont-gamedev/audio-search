import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchFilters, SearchQuery } from '../src/shared/types';
import { IndexWriter, type IndexRecord } from '../src/main/database/audioFiles';
import { createInMemoryDatabase } from '../src/main/database/db';
import { addLibrary } from '../src/main/database/libraries';
import { buildMatchExpression, getFacets, search } from '../src/main/database/search';
import { setFavorite } from '../src/main/database/userData';
import { parentFolderName } from '../src/main/filesystem/pathUtils';

const EMPTY_FILTERS: SearchFilters = {
  libraryIds: [],
  extensions: [],
  durationBuckets: [],
  durationRange: null,
  channels: [],
  sampleRates: [],
  favoritesOnly: false,
};

/** Builds a full query from a few interesting fields, with sane defaults for the rest. */
function query(
  text: string,
  overrides: Partial<Omit<SearchQuery, 'filters'>> & { filters?: Partial<SearchFilters> } = {},
): SearchQuery {
  const { filters, ...rest } = overrides;
  return {
    text,
    sortField: 'relevance',
    sortDirection: 'asc',
    limit: 200,
    offset: 0,
    ...rest,
    filters: { ...EMPTY_FILTERS, ...filters },
  };
}

interface SeedFile {
  relativePath: string;
  duration?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  fileSize?: number;
  modifiedAt?: number;
}

function seed(db: Database, libraryId: number, libraryPath: string, files: SeedFile[]): number[] {
  const writer = new IndexWriter(db);
  return files.map((file) => {
    const filename = file.relativePath.split('/').pop() as string;
    const record: IndexRecord = {
      libraryId,
      absolutePath: `${libraryPath}/${file.relativePath}`,
      relativePath: file.relativePath,
      filename,
      extension: filename.slice(filename.lastIndexOf('.')).toLowerCase(),
      parentFolder: parentFolderName(file.relativePath),
      fileSize: file.fileSize ?? 1024,
      duration: file.duration === undefined ? 1 : file.duration,
      sampleRate: file.sampleRate === undefined ? 44100 : file.sampleRate,
      bitDepth: 16,
      channels: file.channels === undefined ? 2 : file.channels,
      bitrate: 1411,
      modifiedAt: file.modifiedAt ?? 1_700_000_000_000,
      metadataOk: true,
    };
    return writer.upsert(record);
  });
}

describe('buildMatchExpression', () => {
  it('ANDs terms so extra words narrow the search', () => {
    expect(buildMatchExpression('impact heavy')).toBe('"impact"* AND "heavy"*');
  });

  it('returns null when there is nothing searchable', () => {
    expect(buildMatchExpression('')).toBeNull();
    expect(buildMatchExpression('   ')).toBeNull();
    expect(buildMatchExpression('- * "')).toBeNull();
  });

  it('neutralises FTS syntax in user input', () => {
    // Quotes are stripped and each term re-quoted, so this cannot become an FTS operator.
    expect(buildMatchExpression('punch" OR "x')).toBe('"punch"* AND "OR"* AND "x"*');
  });
});

describe('search', () => {
  let db: Database;
  let libraryId: number;
  const libraryPath = 'D:/GameAssets/Audio';

  beforeEach(() => {
    db = createInMemoryDatabase();
    libraryId = addLibrary(db, libraryPath, 'Main').id;

    seed(db, libraryId, libraryPath, [
      { relativePath: 'Medieval Combat/Impacts/Body/impact_heavy_03.wav', duration: 1.24 },
      { relativePath: 'Combat/Punches/Heavy/Heavy_Punch_03.wav', duration: 0.8 },
      { relativePath: 'Combat/Punches/body_punch_03.wav', duration: 0.5 },
      { relativePath: 'UI/click.ogg', duration: 0.2, channels: 1, sampleRate: 48000 },
      { relativePath: 'Ambience/creepy_wind_loop.flac', duration: 45, channels: 6 },
      { relativePath: 'SciFi/computer_beep.mp3', duration: 2.5, sampleRate: 48000 },
    ]);
  });

  afterEach(() => db.close());

  it('matches on the filename', () => {
    const result = search(db, query('punch'));
    expect(result.items.map((item) => item.filename).sort()).toEqual([
      'Heavy_Punch_03.wav',
      'body_punch_03.wav',
    ]);
  });

  it('matches on folder names anywhere in the path', () => {
    expect(search(db, query('medieval')).items).toHaveLength(1);
    expect(search(db, query('ambience')).items).toHaveLength(1);
    expect(search(db, query('scifi')).items).toHaveLength(1);
  });

  it('matches a term embedded in an underscored filename', () => {
    // The tokenizer splits impact_heavy_03 into separate words.
    expect(search(db, query('heavy')).items.length).toBeGreaterThanOrEqual(2);
  });

  it('is case-insensitive', () => {
    const lower = search(db, query('punch')).total;
    expect(search(db, query('PUNCH')).total).toBe(lower);
    expect(search(db, query('PuNcH')).total).toBe(lower);
  });

  it('narrows as terms are added', () => {
    const one = search(db, query('impact')).total;
    const two = search(db, query('impact heavy')).total;
    const three = search(db, query('impact heavy body')).total;

    expect(two).toBeLessThanOrEqual(one);
    expect(three).toBeLessThanOrEqual(two);
    expect(three).toBe(1);
  });

  it('matches on a prefix, so results appear while typing', () => {
    expect(search(db, query('pun')).total).toBeGreaterThan(0);
    expect(search(db, query('comp')).total).toBe(1);
  });

  it('returns everything when the query is empty', () => {
    expect(search(db, query('')).total).toBe(6);
  });

  it('finds nothing for a term that does not occur', () => {
    expect(search(db, query('xylophone')).total).toBe(0);
  });

  describe('filters', () => {
    it('filters by duration bucket', () => {
      // under1 covers click.ogg (0.2s), body_punch_03 (0.5s) and Heavy_Punch_03 (0.8s).
      expect(search(db, query('', { filters: { durationBuckets: ['under1'] } })).total).toBe(3);
      expect(search(db, query('', { filters: { durationBuckets: ['oneToThree'] } })).total).toBe(2);
      expect(search(db, query('', { filters: { durationBuckets: ['overTen'] } })).total).toBe(1);
    });

    it('treats multiple duration buckets as alternatives', () => {
      const result = search(db, query('', { filters: { durationBuckets: ['under1', 'overTen'] } }));
      expect(result.total).toBe(4);
    });

    it('filters by file type', () => {
      const result = search(db, query('', { filters: { extensions: ['.wav'] } }));
      expect(result.total).toBe(3);
    });

    it('filters by channel count', () => {
      expect(search(db, query('', { filters: { channels: ['mono'] } })).total).toBe(1);
      expect(search(db, query('', { filters: { channels: ['stereo'] } })).total).toBe(4);
      // 6 channels is neither mono nor stereo.
      expect(search(db, query('', { filters: { channels: ['other'] } })).total).toBe(1);
    });

    it('filters by sample rate', () => {
      expect(
        search(db, query('', { filters: { sampleRates: [48000] } })).total,
      ).toBe(2);
    });

    it('filters by a custom duration range', () => {
      const result = search(
        db,
        query('', { filters: { durationRange: { min: 0.4, max: 1.3 } } }),
      );
      expect(result.items.map((item) => item.duration).sort()).toEqual([0.5, 0.8, 1.24]);
    });

    it('filters by library', () => {
      const other = addLibrary(db, 'E:/Purchased', 'Purchased');
      seed(db, other.id, 'E:/Purchased', [{ relativePath: 'Pack/extra_punch.wav' }]);

      expect(search(db, query('punch')).total).toBe(3);
      expect(
        search(db, query('punch', { filters: { libraryIds: [other.id] } })).total,
      ).toBe(1);
    });

    it('filters to favorites only', () => {
      const [firstId] = seed(db, libraryId, libraryPath, [{ relativePath: 'Fav/great_punch.wav' }]);
      setFavorite(db, firstId, true);

      const result = search(db, query('', { filters: { favoritesOnly: true } }));
      expect(result.total).toBe(1);
      expect(result.items[0].favorite).toBe(true);
    });

    it('combines a text query with filters', () => {
      const result = search(
        db,
        query('punch', { filters: { durationRange: { min: null, max: 0.6 } } }),
      );
      expect(result.items.map((item) => item.filename)).toEqual(['body_punch_03.wav']);
    });
  });

  describe('sorting and paging', () => {
    it('sorts by filename in both directions', () => {
      const ascending = search(db, query('', { sortField: 'filename', sortDirection: 'asc' }));
      const descending = search(db, query('', { sortField: 'filename', sortDirection: 'desc' }));
      expect(descending.items.map((i) => i.filename)).toEqual(
        [...ascending.items.map((i) => i.filename)].reverse(),
      );
    });

    it('sorts by duration', () => {
      const result = search(db, query('', { sortField: 'duration', sortDirection: 'asc' }));
      const durations = result.items.map((item) => item.duration);
      expect(durations).toEqual([...durations].sort((a, b) => (a ?? 0) - (b ?? 0)));
    });

    it('sorts files with unknown duration last', () => {
      seed(db, libraryId, libraryPath, [{ relativePath: 'Broken/unknown.wav', duration: null }]);

      const ascending = search(db, query('', { sortField: 'duration', sortDirection: 'asc' }));
      const descending = search(db, query('', { sortField: 'duration', sortDirection: 'desc' }));

      expect(ascending.items[ascending.items.length - 1].duration).toBeNull();
      expect(descending.items[descending.items.length - 1].duration).toBeNull();
    });

    it('pages without dropping or repeating rows', () => {
      const all = search(db, query('', { sortField: 'filename', limit: 100 }));
      const firstPage = search(db, query('', { sortField: 'filename', limit: 2, offset: 0 }));
      const secondPage = search(db, query('', { sortField: 'filename', limit: 2, offset: 2 }));

      expect(firstPage.total).toBe(all.total);
      expect(firstPage.items).toHaveLength(2);
      expect([...firstPage.items, ...secondPage.items].map((i) => i.id)).toEqual(
        all.items.slice(0, 4).map((i) => i.id),
      );
    });
  });

  describe('facets', () => {
    it('counts extensions for the current query', () => {
      const facets = getFacets(db, query(''));
      expect(facets.extensions['.wav']).toBe(3);
      expect(facets.extensions['.ogg']).toBe(1);
    });

    it('ignores a dimension when counting that same dimension', () => {
      // Selecting WAV should not make the MP3 count vanish, or the user could never
      // switch to it.
      const facets = getFacets(db, query('', { filters: { extensions: ['.wav'] } }));
      expect(facets.extensions['.mp3']).toBe(1);
    });

    it('counts per library', () => {
      const facets = getFacets(db, query(''));
      expect(facets.libraries[libraryId]).toBe(6);
    });
  });
});
