import type { Database } from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

/**
 * Ordered schema migrations. Never edit a shipped migration - append a new one instead.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE libraries (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          path         TEXT    NOT NULL,
          path_key     TEXT    NOT NULL UNIQUE,
          name         TEXT    NOT NULL,
          added_at     INTEGER NOT NULL,
          last_scan_at INTEGER
        );

        CREATE TABLE audio_files (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          library_id    INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
          absolute_path TEXT    NOT NULL,
          path_key      TEXT    NOT NULL UNIQUE,
          relative_path TEXT    NOT NULL,
          filename      TEXT    NOT NULL,
          extension     TEXT    NOT NULL,
          parent_folder TEXT    NOT NULL DEFAULT '',
          file_size     INTEGER NOT NULL,
          duration      REAL,
          sample_rate   INTEGER,
          bit_depth     INTEGER,
          channels      INTEGER,
          bitrate       INTEGER,
          modified_at   INTEGER NOT NULL,
          indexed_at    INTEGER NOT NULL,
          metadata_ok   INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX idx_audio_files_library   ON audio_files(library_id);
        CREATE INDEX idx_audio_files_extension ON audio_files(extension);
        CREATE INDEX idx_audio_files_duration  ON audio_files(duration);
        CREATE INDEX idx_audio_files_channels  ON audio_files(channels);
        CREATE INDEX idx_audio_files_srate     ON audio_files(sample_rate);
        CREATE INDEX idx_audio_files_filename  ON audio_files(filename COLLATE NOCASE);
        CREATE INDEX idx_audio_files_modified  ON audio_files(modified_at);
        CREATE INDEX idx_audio_files_size      ON audio_files(file_size);

        CREATE TABLE destinations (
          id   INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE
        );

        CREATE TABLE favorites (
          file_id  INTEGER PRIMARY KEY REFERENCES audio_files(id) ON DELETE CASCADE,
          added_at INTEGER NOT NULL
        );

        CREATE TABLE tags (
          id   INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE
        );

        CREATE TABLE file_tags (
          file_id INTEGER NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
          tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (file_id, tag_id)
        );

        CREATE INDEX idx_file_tags_tag ON file_tags(tag_id);
      `);

      // FTS index over the searchable text, keyed by audio_files.id via rowid.
      //
      // Deliberately a regular (not contentless) fts5 table: contentless tables cannot be
      // updated or deleted with ordinary SQL, and this index changes constantly as libraries
      // are rescanned. The duplicated text costs a few tens of MB at 100k files, which is a
      // fair trade for correct incremental maintenance.
      //
      // `tokenchars '_-'` keeps `impact_heavy_03` searchable as a whole, while the separate
      // trigram-free prefix index makes `punch` match `punch_heavy`.
      db.exec(`
        CREATE VIRTUAL TABLE audio_files_fts USING fts5(
          filename,
          relative_path,
          folders,
          tokenize='unicode61 remove_diacritics 2',
          prefix='2 3 4'
        );
      `);
    },
  },
  {
    version: 2,
    name: 'semantic search placeholders',
    up: (db) => {
      // Reserved for a future local/offline enrichment pass. Kept nullable and unused so
      // the core application stays fully functional without any AI service.
      db.exec(`
        ALTER TABLE audio_files ADD COLUMN ai_description TEXT;
        ALTER TABLE audio_files ADD COLUMN ai_tags TEXT;
        ALTER TABLE audio_files ADD COLUMN embedding BLOB;
        ALTER TABLE audio_files ADD COLUMN waveform BLOB;
      `);
    },
  },
  {
    version: 3,
    name: 'destinations become a most-recently-used list',
    up: (db) => {
      // Destinations are no longer curated through a management dialog: they are simply
      // the folders the user has copied to, ordered by how recently they were used.
      db.exec(`ALTER TABLE destinations ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0;`);
      // Existing rows have no history, so seed them as used now rather than at epoch,
      // which would make them all look stale and get pruned first.
      db.prepare('UPDATE destinations SET last_used_at = ?').run(Date.now());
      db.exec('CREATE INDEX idx_destinations_used ON destinations(last_used_at DESC);');
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
