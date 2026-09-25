import type { Database } from 'better-sqlite3';
import { CHANNEL_FILTERS, DURATION_BUCKETS } from '../../shared/constants';
import type {
  AudioFile,
  FacetCounts,
  SearchFilters,
  SearchQuery,
  SearchResult,
  SortDirection,
  SortField,
} from '../../shared/types';

interface FileRow {
  id: number;
  library_id: number;
  library_name: string;
  absolute_path: string;
  relative_path: string;
  filename: string;
  extension: string;
  parent_folder: string;
  file_size: number;
  duration: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  bitrate: number | null;
  modified_at: number;
  indexed_at: number;
  favorite: number;
}

export function rowToAudioFile(row: FileRow): AudioFile {
  return {
    id: row.id,
    libraryId: row.library_id,
    libraryName: row.library_name,
    absolutePath: row.absolute_path,
    relativePath: row.relative_path,
    filename: row.filename,
    extension: row.extension,
    parentFolder: row.parent_folder,
    fileSize: row.file_size,
    duration: row.duration,
    sampleRate: row.sample_rate,
    bitDepth: row.bit_depth,
    channels: row.channels,
    bitrate: row.bitrate,
    modifiedAt: row.modified_at,
    indexedAt: row.indexed_at,
    favorite: row.favorite !== 0,
  };
}

const SELECT_COLUMNS = `
  f.id, f.library_id, l.name AS library_name, f.absolute_path, f.relative_path,
  f.filename, f.extension, f.parent_folder, f.file_size, f.duration, f.sample_rate,
  f.bit_depth, f.channels, f.bitrate, f.modified_at, f.indexed_at,
  CASE WHEN fav.file_id IS NULL THEN 0 ELSE 1 END AS favorite
`;

const BASE_FROM = `
  FROM audio_files f
  JOIN libraries l ON l.id = f.library_id
  LEFT JOIN favorites fav ON fav.file_id = f.id
`;

/**
 * Turns free text into an FTS5 MATCH expression.
 *
 * Every term is quoted (so punctuation in a filename can never be read as FTS syntax) and
 * given a prefix wildcard, then AND-ed together, because additional words should narrow the
 * result set. Returns null when there is nothing searchable.
 */
export function buildMatchExpression(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((term) => term.replace(/"/g, '').trim())
    // Terms of pure punctuation tokenize to nothing and would make FTS5 raise a syntax
    // error, so require at least one letter or digit.
    .filter((term) => /[\p{L}\p{N}]/u.test(term));

  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(' AND ');
}

interface WhereClause {
  sql: string;
  params: unknown[];
}

/** Builds the filter predicates, optionally skipping one dimension for facet counting. */
function buildFilterClauses(
  filters: SearchFilters,
  skip?: 'extensions' | 'libraryIds',
): WhereClause[] {
  const clauses: WhereClause[] = [];

  if (skip !== 'libraryIds' && filters.libraryIds.length > 0) {
    clauses.push({
      sql: `f.library_id IN (${filters.libraryIds.map(() => '?').join(', ')})`,
      params: filters.libraryIds,
    });
  }

  if (skip !== 'extensions' && filters.extensions.length > 0) {
    clauses.push({
      sql: `f.extension IN (${filters.extensions.map(() => '?').join(', ')})`,
      params: filters.extensions.map((ext) => ext.toLowerCase()),
    });
  }

  if (filters.durationBuckets.length > 0) {
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const id of filters.durationBuckets) {
      const bucket = DURATION_BUCKETS[id];
      if (!bucket) continue;
      if (bucket.max === null) {
        parts.push('(f.duration IS NOT NULL AND f.duration >= ?)');
        params.push(bucket.min);
      } else {
        parts.push('(f.duration IS NOT NULL AND f.duration >= ? AND f.duration < ?)');
        params.push(bucket.min, bucket.max);
      }
    }
    if (parts.length > 0) clauses.push({ sql: `(${parts.join(' OR ')})`, params });
  }

  if (filters.durationRange) {
    const { min, max } = filters.durationRange;
    if (min !== null) clauses.push({ sql: 'f.duration >= ?', params: [min] });
    if (max !== null) clauses.push({ sql: 'f.duration <= ?', params: [max] });
  }

  if (filters.channels.length > 0) {
    const parts: string[] = [];
    for (const id of filters.channels) {
      const filter = CHANNEL_FILTERS[id];
      if (!filter) continue;
      if (filter.channels === null) {
        parts.push('(f.channels IS NOT NULL AND f.channels NOT IN (1, 2))');
      } else {
        parts.push(`f.channels = ${filter.channels}`);
      }
    }
    if (parts.length > 0) clauses.push({ sql: `(${parts.join(' OR ')})`, params: [] });
  }

  if (filters.sampleRates.length > 0) {
    clauses.push({
      sql: `f.sample_rate IN (${filters.sampleRates.map(() => '?').join(', ')})`,
      params: filters.sampleRates,
    });
  }

  if (filters.favoritesOnly) {
    clauses.push({ sql: 'fav.file_id IS NOT NULL', params: [] });
  }

  return clauses;
}

const SORT_COLUMNS: Record<Exclude<SortField, 'relevance'>, string> = {
  filename: 'f.filename COLLATE NOCASE',
  duration: 'f.duration',
  fileSize: 'f.file_size',
  modifiedAt: 'f.modified_at',
};

function buildOrderBy(field: SortField, direction: SortDirection, hasMatch: boolean): string {
  const dir = direction === 'desc' ? 'DESC' : 'ASC';

  if (field === 'relevance') {
    // bm25 returns increasingly negative scores for better matches, so ascending is
    // "best first". Filename is weighted highest, then the relative path, then folders.
    // Without a text query there is nothing to rank, so fall back to filename order.
    return hasMatch
      ? 'ORDER BY bm25(audio_files_fts, 10.0, 3.0, 2.0) ASC, f.filename COLLATE NOCASE ASC'
      : 'ORDER BY f.filename COLLATE NOCASE ASC';
  }

  // Files with unknown duration/rate sort last in either direction rather than pretending
  // to be zero. The id tiebreaker keeps pagination stable across requests.
  const column = SORT_COLUMNS[field];
  return `ORDER BY (${column}) IS NULL ASC, ${column} ${dir}, f.id ASC`;
}

export function search(db: Database, query: SearchQuery): SearchResult {
  const started = Date.now();
  const match = buildMatchExpression(query.text);

  const joins = match ? 'JOIN audio_files_fts fts ON fts.rowid = f.id' : '';
  const where: string[] = [];
  const params: unknown[] = [];

  if (match) {
    where.push('audio_files_fts MATCH ?');
    params.push(match);
  }
  for (const clause of buildFilterClauses(query.filters)) {
    where.push(clause.sql);
    params.push(...clause.params);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS n ${BASE_FROM} ${joins} ${whereSql}`)
    .get(...params) as { n: number };

  const limit = Math.max(1, Math.min(query.limit || 200, 1000));
  const offset = Math.max(0, query.offset || 0);

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} ${BASE_FROM} ${joins} ${whereSql} ` +
        `${buildOrderBy(query.sortField, query.sortDirection, Boolean(match))} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as FileRow[];

  return {
    items: rows.map(rowToAudioFile),
    total: total.n,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Counts per extension and per library for the current query. Each dimension is counted with
 * its own filter removed, so the sidebar can show what selecting a different value would
 * yield instead of always showing the already-narrowed number.
 */
export function getFacets(db: Database, query: SearchQuery): FacetCounts {
  const match = buildMatchExpression(query.text);
  const joins = match ? 'JOIN audio_files_fts fts ON fts.rowid = f.id' : '';

  const countBy = (column: string, skip: 'extensions' | 'libraryIds') => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (match) {
      where.push('audio_files_fts MATCH ?');
      params.push(match);
    }
    for (const clause of buildFilterClauses(query.filters, skip)) {
      where.push(clause.sql);
      params.push(...clause.params);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return db
      .prepare(
        `SELECT ${column} AS key, COUNT(*) AS n ${BASE_FROM} ${joins} ${whereSql} GROUP BY ${column}`,
      )
      .all(...params) as Array<{ key: string | number; n: number }>;
  };

  const extensions: Record<string, number> = {};
  for (const row of countBy('f.extension', 'extensions')) {
    extensions[String(row.key)] = row.n;
  }

  const libraries: Record<number, number> = {};
  for (const row of countBy('f.library_id', 'libraryIds')) {
    libraries[Number(row.key)] = row.n;
  }

  return { extensions, libraries };
}

export function getFileById(db: Database, id: number): AudioFile | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} ${BASE_FROM} WHERE f.id = ?`)
    .get(id) as FileRow | undefined;
  return row ? rowToAudioFile(row) : null;
}
