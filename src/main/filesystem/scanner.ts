import { opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isIgnoredDirectory, isIgnoredFile, isSupportedExtension } from '../../shared/constants';
import { createLogger } from '../logger';
import { normalizePath, pathComparisonKey, splitFilename } from './pathUtils';

const log = createLogger('scanner');

export interface DiscoveredFile {
  absolutePath: string;
  filename: string;
  extension: string;
  fileSize: number;
  modifiedAt: number;
}

export interface ScanOptions {
  /** Invoked as files are found so the UI can show progress before the scan completes. */
  onFile?: (file: DiscoveredFile) => void | Promise<void>;
  /** Invoked for directories that could not be read; the scan continues regardless. */
  onError?: (path: string, error: NodeJS.ErrnoException) => void;
  /** Checked between entries so a scan can be cancelled promptly. */
  shouldCancel?: () => boolean;
  /** Guards against symlink loops and absurd hierarchies. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 64;

/**
 * Recursively walks `rootPath` and yields every supported audio file.
 *
 * Errors on individual entries (permission denied, a disconnected drive, a file deleted
 * mid-walk) are reported and skipped rather than aborting: a single unreadable folder must
 * not cost the user the rest of a 100k-file library.
 *
 * Symlinked directories are followed once per real path, tracked by device+inode, so a
 * cyclic link cannot make the walk run forever.
 */
export async function scanDirectory(
  rootPath: string,
  options: ScanOptions = {},
): Promise<DiscoveredFile[]> {
  const root = normalizePath(rootPath);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const found: DiscoveredFile[] = [];
  const visitedDirectories = new Set<string>();

  const reportError = (path: string, error: NodeJS.ErrnoException) => {
    log.warn(`skipping ${path}`, error.code ?? error.message);
    options.onError?.(path, error);
  };

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (options.shouldCancel?.()) return;
    if (depth > maxDepth) {
      log.warn(`max depth reached, not descending further`, directory);
      return;
    }

    const key = pathComparisonKey(directory);
    if (visitedDirectories.has(key)) return;
    visitedDirectories.add(key);

    let dir;
    try {
      dir = await opendir(directory);
    } catch (error) {
      reportError(directory, error as NodeJS.ErrnoException);
      return;
    }

    try {
      for await (const entry of dir) {
        if (options.shouldCancel?.()) return;

        const childPath = normalizePath(join(directory, entry.name));

        if (entry.isDirectory()) {
          if (isIgnoredDirectory(entry.name)) continue;
          await walk(childPath, depth + 1);
          continue;
        }

        // Symlinks report neither isDirectory() nor isFile(); resolve them explicitly.
        if (entry.isSymbolicLink()) {
          try {
            const target = await stat(childPath);
            if (target.isDirectory()) {
              if (!isIgnoredDirectory(entry.name)) await walk(childPath, depth + 1);
              continue;
            }
            if (!target.isFile()) continue;
            collect(childPath, entry.name, target.size, target.mtimeMs);
          } catch (error) {
            // A broken symlink is normal, not worth surfacing to the user.
            log.debug(`unresolvable link ${childPath}`, (error as Error).message);
          }
          continue;
        }

        if (!entry.isFile()) continue;

        const { ext } = splitFilename(entry.name);
        if (!isSupportedExtension(ext) || isIgnoredFile(entry.name)) continue;

        try {
          const info = await stat(childPath);
          collect(childPath, entry.name, info.size, info.mtimeMs);
        } catch (error) {
          reportError(childPath, error as NodeJS.ErrnoException);
        }
      }
    } catch (error) {
      reportError(directory, error as NodeJS.ErrnoException);
    }
  };

  const collect = (absolutePath: string, filename: string, size: number, mtimeMs: number) => {
    const { ext } = splitFilename(filename);
    if (!isSupportedExtension(ext) || isIgnoredFile(filename)) return;

    const file: DiscoveredFile = {
      absolutePath,
      filename,
      extension: ext.toLowerCase(),
      fileSize: size,
      modifiedAt: Math.round(mtimeMs),
    };
    found.push(file);
    void options.onFile?.(file);
  };

  await walk(root, 0);
  return found;
}

/** True when the path exists and is a readable directory. */
export async function isReadableDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}
