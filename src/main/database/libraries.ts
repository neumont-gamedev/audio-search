import type { Database } from 'better-sqlite3';
import { basename } from 'node:path';
import type { Library } from '../../shared/types';
import { normalizePath, pathComparisonKey } from '../filesystem/pathUtils';

interface LibraryRow {
  id: number;
  path: string;
  name: string;
  added_at: number;
  last_scan_at: number | null;
  file_count: number;
}

function toLibrary(row: LibraryRow, available: boolean): Library {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    addedAt: row.added_at,
    lastScanAt: row.last_scan_at,
    fileCount: row.file_count,
    available,
  };
}

const SELECT_WITH_COUNT = `
  SELECT l.id, l.path, l.name, l.added_at, l.last_scan_at,
         (SELECT COUNT(*) FROM audio_files f WHERE f.library_id = l.id) AS file_count
  FROM libraries l
`;

export function listLibraries(db: Database, isAvailable: (path: string) => boolean): Library[] {
  const rows = db.prepare(`${SELECT_WITH_COUNT} ORDER BY l.name COLLATE NOCASE`).all() as LibraryRow[];
  return rows.map((row) => toLibrary(row, isAvailable(row.path)));
}

export function getLibrary(db: Database, id: number): Library | null {
  const row = db.prepare(`${SELECT_WITH_COUNT} WHERE l.id = ?`).get(id) as LibraryRow | undefined;
  return row ? toLibrary(row, true) : null;
}

export function findLibraryByPath(db: Database, path: string): Library | null {
  const row = db
    .prepare(`${SELECT_WITH_COUNT} WHERE l.path_key = ?`)
    .get(pathComparisonKey(path)) as LibraryRow | undefined;
  return row ? toLibrary(row, true) : null;
}

/**
 * Returns an existing library when the path is already indexed, so adding the same folder
 * twice is a no-op rather than a duplicate index.
 */
export function addLibrary(db: Database, rawPath: string, name?: string): Library {
  const path = normalizePath(rawPath);
  const existing = findLibraryByPath(db, path);
  if (existing) return existing;

  const info = db
    .prepare('INSERT INTO libraries (path, path_key, name, added_at) VALUES (?, ?, ?, ?)')
    .run(path, pathComparisonKey(path), name?.trim() || basename(path) || path, Date.now());

  return getLibrary(db, Number(info.lastInsertRowid))!;
}

/** Removes the library and its index rows only. User files are never touched. */
export function removeLibrary(db: Database, id: number): void {
  const remove = db.transaction((libraryId: number) => {
    db.prepare(
      `DELETE FROM audio_files_fts WHERE rowid IN (SELECT id FROM audio_files WHERE library_id = ?)`,
    ).run(libraryId);
    db.prepare('DELETE FROM audio_files WHERE library_id = ?').run(libraryId);
    db.prepare('DELETE FROM libraries WHERE id = ?').run(libraryId);
  });
  remove(id);
}

export function markScanned(db: Database, id: number, when = Date.now()): void {
  db.prepare('UPDATE libraries SET last_scan_at = ? WHERE id = ?').run(when, id);
}
