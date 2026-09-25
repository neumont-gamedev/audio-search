import { access, copyFile, constants, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DuplicateStrategy } from '../../shared/types';
import { createLogger } from '../logger';
import { normalizePath, splitFilename } from './pathUtils';

const log = createLogger('file-actions');

/**
 * The outcome of copying one file. The batch API reports per-file results in terms of the
 * shared `CopyResult`; this narrower union stays internal to the single-file primitive.
 */
export type SingleCopyResult =
  | { status: 'copied'; destinationFile: string }
  | { status: 'conflict'; destinationFile: string; suggestedName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Produces a non-colliding filename in `directory`, following the `name_2.wav`,
 * `name_3.wav` pattern.
 *
 * `exists` is injectable so the naming rule can be tested without touching a filesystem.
 */
export async function findAvailableName(
  directory: string,
  filename: string,
  exists: (path: string) => Promise<boolean> = pathExists,
): Promise<string> {
  if (!(await exists(join(directory, filename)))) return filename;

  const { base, ext } = splitFilename(filename);
  // Bounded so a pathological directory cannot spin forever.
  for (let suffix = 2; suffix < 10_000; suffix++) {
    const candidate = `${base}_${suffix}${ext}`;
    if (!(await exists(join(directory, candidate)))) return candidate;
  }

  throw new Error(`Could not find an available filename for ${filename} in ${directory}`);
}

export interface CopyAssetOptions {
  sourcePath: string;
  destinationDirectory: string;
  /** Omitted on the first attempt: a conflict is reported back for the user to resolve. */
  strategy?: DuplicateStrategy;
}

/**
 * Copies one asset into a destination directory.
 *
 * The source is only ever read. A destination file is never silently overwritten: without
 * an explicit strategy a conflict is returned so the renderer can ask the user.
 */
export async function copyAsset(options: CopyAssetOptions): Promise<SingleCopyResult> {
  const source = normalizePath(options.sourcePath);
  const directory = normalizePath(options.destinationDirectory);

  try {
    const sourceInfo = await stat(source).catch(() => null);
    if (!sourceInfo?.isFile()) {
      return { status: 'error', message: 'The source file no longer exists.' };
    }

    const { base } = splitFilename(source.split('/').pop() ?? '');
    if (base.length === 0) {
      return { status: 'error', message: 'The source file has an unusable name.' };
    }

    const filename = source.split('/').pop() as string;

    await mkdir(directory, { recursive: true });

    const target = join(directory, filename);
    const collides = await pathExists(target);

    if (collides && !options.strategy) {
      return {
        status: 'conflict',
        destinationFile: normalizePath(target),
        suggestedName: await findAvailableName(directory, filename),
      };
    }

    if (collides && options.strategy === 'cancel') {
      return { status: 'cancelled' };
    }

    let finalPath = target;
    if (collides && options.strategy === 'rename') {
      finalPath = join(directory, await findAvailableName(directory, filename));
    }

    // COPYFILE_EXCL on the rename path guards against another process winning the race
    // between the existence check and the copy.
    const mode = collides && options.strategy === 'overwrite' ? 0 : constants.COPYFILE_EXCL;
    await copyFile(source, finalPath, mode);

    log.info('copied asset', { source, destination: finalPath });
    return { status: 'copied', destinationFile: normalizePath(finalPath) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    log.error('copy failed', { source, directory, code: err.code, message: err.message });
    return { status: 'error', message: describeCopyError(err) };
  }
}

export interface BatchCopyItem {
  fileId: number;
  sourcePath: string;
  filename: string;
}

export interface BatchCopyOutcome {
  copied: Array<{ fileId: number; destinationFile: string }>;
  conflicts: Array<{
    fileId: number;
    filename: string;
    destinationFile: string;
    suggestedName: string;
  }>;
  errors: Array<{ fileId: number; filename: string; message: string }>;
  cancelled: number;
}

/**
 * Copies many assets into one destination folder.
 *
 * Files are processed in order and one failure never stops the rest: everything that can be
 * copied is, and whatever could not is reported per file. Without a strategy, colliding
 * files are collected as conflicts rather than written, so the renderer can ask once and
 * then re-send just those ids with the user's choice.
 */
export async function copyAssets(
  items: BatchCopyItem[],
  destinationDirectory: string,
  strategy?: DuplicateStrategy,
): Promise<BatchCopyOutcome> {
  const outcome: BatchCopyOutcome = { copied: [], conflicts: [], errors: [], cancelled: 0 };

  for (const item of items) {
    const result = await copyAsset({
      sourcePath: item.sourcePath,
      destinationDirectory,
      strategy,
    });

    switch (result.status) {
      case 'copied':
        outcome.copied.push({ fileId: item.fileId, destinationFile: result.destinationFile });
        break;
      case 'conflict':
        outcome.conflicts.push({
          fileId: item.fileId,
          filename: item.filename,
          destinationFile: result.destinationFile,
          suggestedName: result.suggestedName,
        });
        break;
      case 'cancelled':
        outcome.cancelled++;
        break;
      case 'error':
        outcome.errors.push({
          fileId: item.fileId,
          filename: item.filename,
          message: result.message,
        });
        break;
    }
  }

  log.info('batch copy finished', {
    requested: items.length,
    copied: outcome.copied.length,
    conflicts: outcome.conflicts.length,
    errors: outcome.errors.length,
  });

  return outcome;
}

function describeCopyError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied writing to the destination folder.';
    case 'ENOSPC':
      return 'The destination drive is full.';
    case 'ENOENT':
      return 'The destination folder is unavailable.';
    case 'EEXIST':
      return 'A file with that name appeared in the destination before the copy finished.';
    case 'EBUSY':
      return 'The destination file is in use by another program.';
    default:
      return 'The file could not be copied.';
  }
}
