import type { Database } from 'better-sqlite3';
import type { Library, ScanProgress } from '../../shared/types';
import { mapWithConcurrency, readAudioMetadata, UNKNOWN_METADATA } from '../audio/metadata';
import { IndexWriter, loadLibraryStamps, type IndexRecord } from '../database/audioFiles';
import { markScanned } from '../database/libraries';
import { parentFolderName, toRelativePath } from '../filesystem/pathUtils';
import { isReadableDirectory, scanDirectory, type DiscoveredFile } from '../filesystem/scanner';
import { createLogger } from '../logger';

const log = createLogger('indexer');

/** Files parsed per transaction. Large enough to amortise commits, small enough to stream progress. */
const BATCH_SIZE = 256;
/** Concurrent metadata reads. I/O bound, so a handful of readers beats one. */
const METADATA_CONCURRENCY = 8;
/** Progress events are throttled to keep IPC quiet during big scans. */
const PROGRESS_INTERVAL_MS = 120;

export type ProgressReporter = (progress: ScanProgress) => void;

interface ScanState {
  cancelled: boolean;
}

/**
 * Runs library scans one at a time and tracks which are in flight, so the UI can cancel a
 * scan and so a rescan cannot be started twice for the same library.
 */
export class Indexer {
  private readonly active = new Map<number, ScanState>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly report: ProgressReporter,
  ) {}

  isScanning(libraryId: number): boolean {
    return this.active.has(libraryId);
  }

  cancel(libraryId: number): void {
    const state = this.active.get(libraryId);
    if (state) {
      state.cancelled = true;
      log.info(`cancellation requested for library ${libraryId}`);
    }
  }

  cancelAll(): void {
    for (const state of this.active.values()) state.cancelled = true;
  }

  /**
   * Queues a scan. Scans are serialised so two libraries cannot fight over disk and the
   * write transaction. Resolves when this library's scan has finished.
   */
  enqueue(library: Library): Promise<void> {
    if (this.isScanning(library.id)) {
      log.info(`scan already running for ${library.name}, ignoring duplicate request`);
      return Promise.resolve();
    }

    const state: ScanState = { cancelled: false };
    this.active.set(library.id, state);

    const run = this.queue.then(async () => {
      try {
        await this.scanLibrary(library, state);
      } catch (error) {
        log.error(`scan failed for ${library.name}`, error);
        this.report({
          ...emptyProgress(library),
          phase: 'error',
          message: (error as Error).message,
        });
      } finally {
        this.active.delete(library.id);
      }
    });

    // The queue must survive a failing scan, so swallow rejections on the chain itself.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async scanLibrary(library: Library, state: ScanState): Promise<void> {
    const started = Date.now();
    log.info(`scan started: ${library.name}`, library.path);

    const progress: ScanProgress = emptyProgress(library);
    let lastReport = 0;

    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
      lastReport = now;
      this.report({ ...progress });
    };

    if (!(await isReadableDirectory(library.path))) {
      log.warn(`library folder unavailable: ${library.path}`);
      this.report({
        ...progress,
        phase: 'error',
        message: 'The library folder is unavailable. Is the drive connected?',
      });
      return;
    }

    // Phase 1: discover. Reading the whole tree first lets us prune deleted files reliably
    // and gives the user a real total to show progress against.
    progress.phase = 'discovering';
    emit(true);

    const discovered = await scanDirectory(library.path, {
      shouldCancel: () => state.cancelled,
      onFile: () => {
        progress.discovered++;
        emit();
      },
      onError: () => {
        progress.failed++;
      },
    });

    if (state.cancelled) return this.finishCancelled(progress);

    // Phase 2: index. Unchanged files (same size and mtime) keep their existing metadata.
    progress.phase = 'indexing';
    emit(true);

    const stamps = loadLibraryStamps(this.db, library.id);
    const writer = new IndexWriter(this.db);
    const seen = new Set<number>();
    const now = Date.now();

    for (let start = 0; start < discovered.length; start += BATCH_SIZE) {
      if (state.cancelled) return this.finishCancelled(progress);

      const batch = discovered.slice(start, start + BATCH_SIZE);
      const toParse: DiscoveredFile[] = [];
      const unchanged: number[] = [];

      for (const file of batch) {
        const existing = stamps.get(comparisonKeyOf(file.absolutePath));
        const isUnchanged =
          existing !== undefined &&
          existing.fileSize === file.fileSize &&
          existing.modifiedAt === file.modifiedAt;

        if (isUnchanged) {
          seen.add(existing.id);
          unchanged.push(existing.id);
          progress.skipped++;
        } else {
          toParse.push(file);
        }
      }

      const parsed = await mapWithConcurrency(
        toParse,
        METADATA_CONCURRENCY,
        async (file) => ({ file, metadata: await readAudioMetadata(file.absolutePath) }),
        () => state.cancelled,
      );

      if (state.cancelled) return this.finishCancelled(progress);

      // One transaction per batch: thousands of individual commits would dominate runtime.
      writer.batch(() => {
        for (const entry of parsed) {
          // mapWithConcurrency leaves holes when cancelled part-way through a batch.
          if (!entry) continue;
          const { file, metadata } = entry;
          const id = writer.upsert(toIndexRecord(library, file, metadata), now);
          seen.add(id);
          progress.indexed++;
          if (!metadata.ok) progress.failed++;
        }
        for (const id of unchanged) {
          writer.touch(id, now);
        }
      });

      emit();
    }

    if (state.cancelled) return this.finishCancelled(progress);

    // Phase 3: prune. Anything indexed for this library that the walk did not see is gone
    // from disk, so it must leave the index too.
    progress.phase = 'pruning';
    emit(true);

    writer.batch(() => {
      for (const stamp of stamps.values()) {
        if (!seen.has(stamp.id)) {
          writer.remove(stamp.id);
          progress.removed++;
        }
      }
    });

    markScanned(this.db, library.id, Date.now());

    progress.phase = 'done';
    emit(true);

    log.info(
      `scan finished: ${library.name}`,
      `${progress.discovered} discovered, ${progress.indexed} indexed, ${progress.skipped} unchanged, ` +
        `${progress.removed} removed, ${progress.failed} problems, ${Date.now() - started}ms`,
    );
  }

  private finishCancelled(progress: ScanProgress): void {
    log.info(`scan cancelled: ${progress.libraryName}`);
    this.report({ ...progress, phase: 'cancelled' });
  }
}

function comparisonKeyOf(absolutePath: string): string {
  // Mirrors pathComparisonKey for already-normalized paths coming out of the scanner.
  return process.platform === 'win32' || process.platform === 'darwin'
    ? absolutePath.toLowerCase()
    : absolutePath;
}

function emptyProgress(library: Library): ScanProgress {
  return {
    libraryId: library.id,
    libraryName: library.name,
    phase: 'discovering',
    discovered: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    removed: 0,
  };
}

export function toIndexRecord(
  library: Pick<Library, 'id' | 'path'>,
  file: DiscoveredFile,
  metadata = UNKNOWN_METADATA,
): IndexRecord {
  const relativePath = toRelativePath(library.path, file.absolutePath);
  return {
    libraryId: library.id,
    absolutePath: file.absolutePath,
    relativePath,
    filename: file.filename,
    extension: file.extension,
    parentFolder: parentFolderName(relativePath),
    fileSize: file.fileSize,
    duration: metadata.duration,
    sampleRate: metadata.sampleRate,
    bitDepth: metadata.bitDepth,
    channels: metadata.channels,
    bitrate: metadata.bitrate,
    modifiedAt: file.modifiedAt,
    metadataOk: metadata.ok,
  };
}
