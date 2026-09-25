import BetterSqlite3, { type Database } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../logger';
import { LATEST_VERSION, MIGRATIONS } from './migrations';

const log = createLogger('database');

let db: Database | null = null;

/** Opens (creating if needed) the index database and brings the schema up to date. */
export function openDatabase(filePath: string): Database {
  if (db) return db;

  mkdirSync(dirname(filePath), { recursive: true });
  const connection = new BetterSqlite3(filePath);

  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('foreign_keys = ON');
  // Keeps large scans from thrashing; the index is the only consumer of this file.
  connection.pragma('cache_size = -32000');

  try {
    migrate(connection);
  } catch (error) {
    // Without this the failed connection stays open and keeps the file locked, which on
    // Windows blocks any later attempt to move or replace the index.
    connection.close();
    throw error;
  }

  db = connection;
  log.info('database ready', { path: filePath, version: LATEST_VERSION });
  return connection;
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database has not been opened yet');
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (error) {
    log.warn('error while closing database', error);
  } finally {
    db = null;
  }
}

function migrate(connection: Database): void {
  const current = connection.pragma('user_version', { simple: true }) as number;

  if (current > LATEST_VERSION) {
    throw new Error(
      `Index database was created by a newer version of the application (schema ${current}).`,
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) return;

  for (const migration of pending) {
    log.info(`applying migration ${migration.version}: ${migration.name}`);
    const run = connection.transaction(() => {
      migration.up(connection);
      connection.pragma(`user_version = ${migration.version}`);
    });
    run();
  }
}

/** Test helper: opens an isolated in-memory database with the full schema applied. */
export function createInMemoryDatabase(): Database {
  const connection = new BetterSqlite3(':memory:');
  connection.pragma('foreign_keys = ON');
  migrate(connection);
  return connection;
}

/** Test helper: lets tests inject their own connection as the module-level database. */
export function setDatabaseForTesting(connection: Database | null): void {
  db = connection;
}
