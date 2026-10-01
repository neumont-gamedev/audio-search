import type { Database } from 'better-sqlite3';
import chokidar, { type FSWatcher } from 'chokidar';
import { stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { isIgnoredPath, isSupportedExtension } from '../../shared/constants';
import type { Library } from '../../shared/types';
import { readAudioMetadata } from '../audio/metadata';
import { IndexWriter, removeFileByPath } from '../database/audioFiles';
import { toIndexRecord } from '../indexing/indexer';
import { createLogger } from '../logger';
import { normalizePath, splitFilename } from './pathUtils';

const log = createLogger('watcher');

/** Filesystem events are coalesced over this window before the index is updated. */
const DEBOUNCE_MS = 750;

/**
 * Keeps libraries roughly in sync with the filesystem after the initial scan.
 *
 * Watching is best-effort by design: network drives, rapid bulk operations and platform
 * quirks all cause missed events, so "Rescan Library" remains the authoritative fallback.
 */
export class LibraryWatcher {
  private readonly watchers = new Map<number, FSWatcher>();
  private readonly pending = new Map<string, { libraryId: number; kind: 'upsert' | 'remove' }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly onIndexChanged: (libraryId: number) => void,
  ) {}

  watch(library: Library): void {
    if (this.watchers.has(library.id)) return;

    const watcher = chokidar.watch(library.path, {
      ignoreInitial: true,
      // The initial scan already covered existing files; only react to changes from here.
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      depth: 64,
      ignored: (path: string) => isIgnoredPath(relative(library.path, path)),
    });

    watcher
      .on('add', (path) => this.schedule(library.id, path, 'upsert'))
      .on('change', (path) => this.schedule(library.id, path, 'upsert'))
      .on('unlink', (path) => this.schedule(library.id, path, 'remove'))
      .on('error', (error) => log.warn(`watch error for ${library.name}`, error));

    this.watchers.set(library.id, watcher);
    log.info(`watching ${library.name}`, library.path);
  }

  async unwatch(libraryId: number): Promise<void> {
    const watcher = this.watchers.get(libraryId);
    if (!watcher) return;
    this.watchers.delete(libraryId);
    await watcher.close().catch((error) => log.warn('error closing watcher', error));
  }

  async closeAll(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    await Promise.all([...this.watchers.values()].map((w) => w.close().catch(() => undefined)));
    this.watchers.clear();
  }

  private schedule(libraryId: number, rawPath: string, kind: 'upsert' | 'remove'): void {
    const path = normalizePath(rawPath);
    const { ext } = splitFilename(path);
    if (!isSupportedExtension(ext)) return;

    this.pending.set(path, { libraryId, kind });

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.pending.size === 0) return;

    const batch = [...this.pending.entries()];
    this.pending.clear();

    const touchedLibraries = new Set<number>();
    const writer = new IndexWriter(this.db);

    for (const [path, { libraryId, kind }] of batch) {
      try {
        if (kind === 'remove') {
          if (removeFileByPath(this.db, path)) touchedLibraries.add(libraryId);
          continue;
        }

        const library = this.db
          .prepare('SELECT id, path FROM libraries WHERE id = ?')
          .get(libraryId) as { id: number; path: string } | undefined;
        if (!library) continue;

        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) continue;

        const metadata = await readAudioMetadata(path);
        const record = toIndexRecord(library, {
          absolutePath: path,
          filename: path.split('/').pop() as string,
          extension: ext(path),
          fileSize: info.size,
          modifiedAt: Math.round(info.mtimeMs),
        }, metadata);

        writer.batch(() => writer.upsert(record));
        touchedLibraries.add(libraryId);
      } catch (error) {
        log.warn(`could not apply change for ${path}`, error);
      }
    }

    for (const libraryId of touchedLibraries) this.onIndexChanged(libraryId);
  }
}

function ext(path: string): string {
  return splitFilename(path).ext.toLowerCase();
}
