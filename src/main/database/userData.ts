import type { Database } from 'better-sqlite3';
import type { Destination, Tag } from '../../shared/types';
import { normalizePath } from '../filesystem/pathUtils';

/* ---------------------------------------------------------------- destinations */

/**
 * How many recent destinations are kept. Beyond this the least recently used is dropped,
 * so the list stays short without the user having to curate it.
 */
export const MAX_RECENT_DESTINATIONS = 10;

/**
 * Most recently used first, which is the order the picker shows them in.
 *
 * The `id DESC` tiebreak matters: two folders chosen in the same millisecond should still
 * order newest-first, and this must match `prune` exactly, or the entry shown last would
 * not be the one dropped.
 */
export function listDestinations(db: Database): Destination[] {
  return db
    .prepare(
      `SELECT id, name, path FROM destinations
       ORDER BY last_used_at DESC, id DESC`,
    )
    .all() as Destination[];
}

/**
 * The next ordering stamp: wall-clock time, but always at least one greater than the
 * highest stamp already stored.
 *
 * Plain `Date.now()` is not enough. Two folders chosen inside the same millisecond would
 * tie, so re-using an older one would not actually promote it, and a backwards clock
 * adjustment would scramble the order outright.
 */
function nextUseStamp(db: Database): number {
  const row = db.prepare('SELECT MAX(last_used_at) AS max FROM destinations').get() as {
    max: number | null;
  };
  return Math.max(Date.now(), (row.max ?? 0) + 1);
}

/**
 * Records a folder as the most recently used destination, adding it if it is new, and
 * prunes the oldest entries beyond the cap.
 */
export function addDestination(db: Database, name: string, rawPath: string): Destination {
  const path = normalizePath(rawPath);

  const save = db.transaction((): Destination => {
    const now = nextUseStamp(db);
    const existing = db
      .prepare('SELECT id, name, path FROM destinations WHERE path = ?')
      .get(path) as Destination | undefined;

    let destination: Destination;
    if (existing) {
      db.prepare('UPDATE destinations SET name = ?, last_used_at = ? WHERE id = ?').run(
        name,
        now,
        existing.id,
      );
      destination = { ...existing, name };
    } else {
      const info = db
        .prepare('INSERT INTO destinations (name, path, last_used_at) VALUES (?, ?, ?)')
        .run(name, path, now);
      destination = { id: Number(info.lastInsertRowid), name, path };
    }

    prune(db);
    return destination;
  });

  return save();
}

/** Bumps a destination to the top of the list after a successful copy into it. */
export function touchDestination(db: Database, rawPath: string): void {
  const bump = db.transaction(() => {
    db.prepare('UPDATE destinations SET last_used_at = ? WHERE path = ?').run(
      nextUseStamp(db),
      normalizePath(rawPath),
    );
  });
  bump();
}

function prune(db: Database): void {
  db.prepare(
    `DELETE FROM destinations WHERE id NOT IN (
       SELECT id FROM destinations ORDER BY last_used_at DESC, id DESC LIMIT ?
     )`,
  ).run(MAX_RECENT_DESTINATIONS);
}

/* ------------------------------------------------------------------ favorites */

export function setFavorite(db: Database, fileId: number, favorite: boolean): void {
  if (favorite) {
    db.prepare('INSERT OR IGNORE INTO favorites (file_id, added_at) VALUES (?, ?)').run(
      fileId,
      Date.now(),
    );
  } else {
    db.prepare('DELETE FROM favorites WHERE file_id = ?').run(fileId);
  }
}

/* ----------------------------------------------------------------------- tags */

export function listTagsForFile(db: Database, fileId: number): Tag[] {
  return db
    .prepare(
      `SELECT t.id, t.name FROM tags t
       JOIN file_tags ft ON ft.tag_id = t.id
       WHERE ft.file_id = ?
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(fileId) as Tag[];
}

export function addTag(db: Database, fileId: number, rawName: string): void {
  const name = rawName.trim();
  if (name.length === 0) return;

  const attach = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number };
    db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)').run(
      fileId,
      tag.id,
    );
  });
  attach();
}

export function removeTag(db: Database, fileId: number, tagId: number): void {
  db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?').run(fileId, tagId);
}
