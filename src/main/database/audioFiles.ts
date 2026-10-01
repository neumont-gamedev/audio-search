import type { Database, Statement } from 'better-sqlite3';
import { pathComparisonKey } from '../filesystem/pathUtils';

/** Everything the indexer knows about a file once metadata extraction has been attempted. */
export interface IndexRecord {
  libraryId: number;
  absolutePath: string;
  relativePath: string;
  filename: string;
  extension: string;
  parentFolder: string;
  fileSize: number;
  duration: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitrate: number | null;
  modifiedAt: number;
  metadataOk: boolean;
}

/** The subset used to decide whether a file needs re-reading during a rescan. */
export interface IndexStamp {
  id: number;
  fileSize: number;
  modifiedAt: number;
}

/**
 * Loads the size/mtime stamp of every indexed file in a library, keyed by comparison path.
 *
 * One bulk read beats a per-file query: at 100k files this is a single sequential scan
 * instead of 100k prepared-statement round trips.
 */
export function loadLibraryStamps(db: Database, libraryId: number): Map<string, IndexStamp> {
  const rows = db
    .prepare('SELECT id, path_key, file_size, modified_at FROM audio_files WHERE library_id = ?')
    .all(libraryId) as Array<{
    id: number;
    path_key: string;
    file_size: number;
    modified_at: number;
  }>;

  const map = new Map<string, IndexStamp>();
  for (const row of rows) {
    map.set(row.path_key, { id: row.id, fileSize: row.file_size, modifiedAt: row.modified_at });
  }
  return map;
}

/** The searchable folder text for a file: every path segment except the filename itself. */
function foldersText(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join(' ');
}

/**
 * Prepared statements reused across a whole scan. Building them once and running them
 * inside batched transactions is what keeps large scans fast.
 */
export class IndexWriter {
  private readonly insertFile: Statement;
  private readonly updateFile: Statement;
  private readonly deleteFts: Statement;
  private readonly insertFts: Statement;
  private readonly deleteFile: Statement;

  constructor(private readonly db: Database) {
    this.insertFile = db.prepare(`
      INSERT INTO audio_files (
        library_id, absolute_path, path_key, relative_path, filename, extension,
        parent_folder, file_size, duration, sample_rate, bit_depth, channels, bitrate,
        modified_at, indexed_at, metadata_ok
      ) VALUES (
        @libraryId, @absolutePath, @pathKey, @relativePath, @filename, @extension,
        @parentFolder, @fileSize, @duration, @sampleRate, @bitDepth, @channels, @bitrate,
        @modifiedAt, @indexedAt, @metadataOk
      )
      ON CONFLICT(path_key) DO UPDATE SET
        library_id = excluded.library_id,
        absolute_path = excluded.absolute_path,
        relative_path = excluded.relative_path,
        filename = excluded.filename,
        extension = excluded.extension,
        parent_folder = excluded.parent_folder,
        file_size = excluded.file_size,
        duration = excluded.duration,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        channels = excluded.channels,
        bitrate = excluded.bitrate,
        modified_at = excluded.modified_at,
        indexed_at = excluded.indexed_at,
        metadata_ok = excluded.metadata_ok,
        -- Upsert only runs for new or changed files, so a cached waveform drawn from the
        -- old contents is dropped and regenerated on next play.
        waveform = NULL
      RETURNING id
    `);

    this.updateFile = db.prepare('UPDATE audio_files SET indexed_at = ? WHERE id = ?');
    this.deleteFts = db.prepare('DELETE FROM audio_files_fts WHERE rowid = ?');
    this.insertFts = db.prepare(
      'INSERT INTO audio_files_fts (rowid, filename, relative_path, folders) VALUES (?, ?, ?, ?)',
    );
    this.deleteFile = db.prepare('DELETE FROM audio_files WHERE id = ?');
  }

  /** Inserts or updates one file and keeps its FTS row in sync. Returns the row id. */
  upsert(record: IndexRecord, now = Date.now()): number {
    const row = this.insertFile.get({
      libraryId: record.libraryId,
      absolutePath: record.absolutePath,
      pathKey: pathComparisonKey(record.absolutePath),
      relativePath: record.relativePath,
      filename: record.filename,
      extension: record.extension.toLowerCase(),
      parentFolder: record.parentFolder,
      fileSize: record.fileSize,
      duration: record.duration,
      sampleRate: record.sampleRate,
      bitDepth: record.bitDepth,
      channels: record.channels,
      bitrate: record.bitrate,
      modifiedAt: record.modifiedAt,
      indexedAt: now,
      metadataOk: record.metadataOk ? 1 : 0,
    }) as { id: number };

    // Re-inserting is the simplest correct way to update an fts5 row.
    this.deleteFts.run(row.id);
    this.insertFts.run(
      row.id,
      record.filename,
      record.relativePath,
      foldersText(record.relativePath),
    );

    return row.id;
  }

  /** Marks an unchanged file as seen during this scan without re-reading its metadata. */
  touch(id: number, now = Date.now()): void {
    this.updateFile.run(now, id);
  }

  remove(id: number): void {
    this.deleteFts.run(id);
    this.deleteFile.run(id);
  }

  /** Runs `work` inside a transaction; batching writes is what makes bulk indexing fast. */
  batch<T>(work: () => T): T {
    return this.db.transaction(work)();
  }
}

export function removeFileByPath(db: Database, absolutePath: string): boolean {
  const row = db
    .prepare('SELECT id FROM audio_files WHERE path_key = ?')
    .get(pathComparisonKey(absolutePath)) as { id: number } | undefined;
  if (!row) return false;

  const writer = new IndexWriter(db);
  writer.remove(row.id);
  return true;
}

export function countFiles(db: Database, libraryId?: number): number {
  const sql =
    libraryId === undefined
      ? 'SELECT COUNT(*) AS n FROM audio_files'
      : 'SELECT COUNT(*) AS n FROM audio_files WHERE library_id = ?';
  const row = (libraryId === undefined
    ? db.prepare(sql).get()
    : db.prepare(sql).get(libraryId)) as { n: number };
  return row.n;
}

/** The cached waveform for a file, or null if none has been generated (or it was cleared). */
export function getWaveform(db: Database, fileId: number): Buffer | null {
  const row = db.prepare('SELECT waveform FROM audio_files WHERE id = ?').get(fileId) as
    | { waveform: Buffer | null }
    | undefined;
  return row?.waveform ?? null;
}

/** Caches a waveform. Returns false if the file has left the index in the meantime. */
export function setWaveform(db: Database, fileId: number, data: Uint8Array): boolean {
  return (
    db.prepare('UPDATE audio_files SET waveform = ? WHERE id = ?').run(Buffer.from(data), fileId)
      .changes > 0
  );
}
