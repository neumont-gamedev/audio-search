import type { Database } from 'better-sqlite3';
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type NativeImage } from 'electron';
import { stat } from 'node:fs/promises';
import appIcon from '../../../build/icon.png?asset';
import { AUDIO_PROTOCOL } from '../../shared/constants';
import type {
  AppError,
  AudioFile,
  CopyResult,
  Destination,
  DragResult,
  FacetCounts,
  IpcResponse,
  Library,
  SearchResult,
  Tag,
} from '../../shared/types';
import {
  addLibrary,
  getLibrary,
  listLibraries,
  removeLibrary,
} from '../database/libraries';
import { getFacets, getFileById, search } from '../database/search';
import {
  addDestination,
  addTag,
  listDestinations,
  listTagsForFile,
  removeTag,
  setFavorite,
  touchDestination,
} from '../database/userData';
import { copyAssets } from '../filesystem/fileActions';
import { isSafeAbsolutePath, normalizePath } from '../filesystem/pathUtils';
import { isReadableDirectory } from '../filesystem/scanner';
import type { LibraryWatcher } from '../filesystem/watcher';
import type { Indexer } from '../indexing/indexer';
import { createLogger } from '../logger';
import { EVENTS, IPC } from './channels';
import {
  requireFileIds,
  requireId,
  requireString,
  validateCopyRequest,
  validateSearchQuery,
  ValidationError,
} from './validate';

const log = createLogger('ipc');

export interface HandlerContext {
  db: Database;
  indexer: Indexer;
  watcher: LibraryWatcher;
  getWindow: () => BrowserWindow | null;
}

function toAppError(error: unknown): AppError {
  if (error instanceof ValidationError) {
    return { code: 'INVALID_ARGUMENT', message: error.message };
  }

  const err = error as NodeJS.ErrnoException;
  switch (err?.code) {
    case 'EACCES':
    case 'EPERM':
      return { code: 'PERMISSION_DENIED', message: 'Permission denied.' };
    case 'ENOENT':
      return { code: 'NOT_FOUND', message: 'The path no longer exists.' };
    case 'SQLITE_BUSY':
    case 'SQLITE_CORRUPT':
    case 'SQLITE_ERROR':
      return { code: 'DATABASE_ERROR', message: 'The index database could not be read.' };
    default:
      return { code: 'UNKNOWN', message: 'Something went wrong. See the log for details.' };
  }
}

/**
 * Wraps a handler so the renderer always receives a result envelope instead of a rejected
 * promise, and so every failure is logged with its channel.
 */
function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResponse<T>> => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      log.error(`handler failed: ${channel}`, error);
      return { ok: false, error: toAppError(error) };
    }
  });
}

let cachedDragIcon: NativeImage | null = null;

/** The image under the cursor while dragging: the app icon, small. Built once. */
function dragIcon(): NativeImage {
  cachedDragIcon ??= nativeImage.createFromPath(appIcon).resize({ width: 32, height: 32 });
  return cachedDragIcon;
}

/** Resolves an indexed file by id, or throws a not-found error the renderer can show. */
function requireFile(db: Database, value: unknown): AudioFile {
  const file = getFileById(db, requireId(value, 'fileId'));
  if (!file) {
    const error = new ValidationError('That asset is no longer in the index.');
    throw error;
  }
  return file;
}

export function registerHandlers(context: HandlerContext): void {
  const { db, indexer, watcher, getWindow } = context;

  const broadcast = (channel: string, payload?: unknown) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  const libraryAvailability = new Map<string, boolean>();
  const isAvailable = (path: string) => libraryAvailability.get(path) ?? true;

  /** Refreshes the reachable/unreachable state of every library folder. */
  const refreshAvailability = async (libraries: Library[]) => {
    await Promise.all(
      libraries.map(async (library) => {
        libraryAvailability.set(library.path, await isReadableDirectory(library.path));
      }),
    );
  };

  /* ------------------------------------------------------------------ dialogs */

  handle<string | null>(IPC.selectFolder, async (rawTitle) => {
    const window = getWindow();
    const title = typeof rawTitle === 'string' ? rawTitle.slice(0, 120) : 'Select Folder';

    const result = window
      ? await dialog.showOpenDialog(window, { title, properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title, properties: ['openDirectory'] });

    if (result.canceled || result.filePaths.length === 0) return null;
    return normalizePath(result.filePaths[0]);
  });

  /* ---------------------------------------------------------------- libraries */

  handle<Library[]>(IPC.listLibraries, async () => {
    const libraries = listLibraries(db, isAvailable);
    await refreshAvailability(libraries);
    return listLibraries(db, isAvailable);
  });

  handle<Library>(IPC.addLibrary, async (rawPath) => {
    const path = requireString(rawPath, 'path');
    if (!isSafeAbsolutePath(path)) throw new ValidationError('A full folder path is required.');
    if (!(await isReadableDirectory(path))) {
      throw new ValidationError('That folder could not be opened.');
    }

    const library = addLibrary(db, path);
    log.info('library added', { id: library.id, path: library.path });

    broadcast(EVENTS.librariesChanged);
    void indexer.enqueue(library).then(() => {
      watcher.watch(library);
      broadcast(EVENTS.librariesChanged);
      broadcast(EVENTS.indexChanged, library.id);
    });

    return library;
  });

  handle<void>(IPC.removeLibrary, async (rawId) => {
    const id = requireId(rawId, 'libraryId');
    indexer.cancel(id);
    await watcher.unwatch(id);

    // Removes index rows only. The user's audio files are never touched.
    removeLibrary(db, id);
    log.info('library removed from index', { id });

    broadcast(EVENTS.librariesChanged);
    broadcast(EVENTS.indexChanged, id);
  });

  handle<void>(IPC.rescanLibrary, async (rawId) => {
    const library = getLibrary(db, requireId(rawId, 'libraryId'));
    if (!library) throw new ValidationError('That library is no longer in the index.');

    void indexer.enqueue(library).then(() => {
      watcher.watch(library);
      broadcast(EVENTS.librariesChanged);
      broadcast(EVENTS.indexChanged, library.id);
    });
  });

  handle<void>(IPC.cancelScan, (rawId) => {
    indexer.cancel(requireId(rawId, 'libraryId'));
  });

  handle<void>(IPC.openLibraryFolder, async (rawId) => {
    const library = getLibrary(db, requireId(rawId, 'libraryId'));
    if (!library) throw new ValidationError('That library is no longer in the index.');

    const error = await shell.openPath(library.path);
    if (error) throw new ValidationError('That folder could not be opened.');
  });

  /* ------------------------------------------------------------------- search */

  handle<SearchResult>(IPC.search, (rawQuery) => search(db, validateSearchQuery(rawQuery)));
  handle<FacetCounts>(IPC.getFacets, (rawQuery) => getFacets(db, validateSearchQuery(rawQuery)));
  handle<AudioFile>(IPC.getFile, (rawId) => requireFile(db, rawId));

  /* ------------------------------------------------------------- file actions */

  handle<void>(IPC.showInFolder, async (rawId) => {
    const file = requireFile(db, rawId);

    // showItemInFolder does not report failure, so check first to give a real message.
    const exists = await stat(file.absolutePath).then(
      () => true,
      () => false,
    );
    if (!exists) throw new ValidationError('That file is no longer on disk.');

    shell.showItemInFolder(file.absolutePath.replace(/\//g, process.platform === 'win32' ? '\\' : '/'));
  });

  handle<void>(IPC.copyPath, (rawId) => {
    const file = requireFile(db, rawId);
    clipboard.writeText(
      process.platform === 'win32' ? file.absolutePath.replace(/\//g, '\\') : file.absolutePath,
    );
  });

  handle<void>(IPC.copyFileToClipboard, async (rawId) => {
    const file = requireFile(db, rawId);
    const exists = await stat(file.absolutePath).then(
      () => true,
      () => false,
    );
    if (!exists) throw new ValidationError('That file is no longer on disk.');

    // Electron has no cross-platform "copy file object" API. Writing the path as text is
    // the portable behaviour; on Windows we additionally publish the shell file-drop
    // format so Explorer and most editors accept a paste as the real file.
    const nativePath =
      process.platform === 'win32' ? file.absolutePath.replace(/\//g, '\\') : file.absolutePath;

    if (process.platform === 'win32') {
      const dropList = buildWindowsFileDrop(nativePath);
      clipboard.writeBuffer('CF_HDROP', dropList);
    }
    clipboard.writeText(nativePath);
  });

  handle<CopyResult>(IPC.copyToDestination, async (rawRequest) => {
    const request = validateCopyRequest(rawRequest);

    if (!isSafeAbsolutePath(request.destinationPath)) {
      throw new ValidationError('A full destination folder path is required.');
    }

    // Resolving every id up front means a stale id fails as one reported error rather than
    // aborting a batch the user has already committed to.
    const items = [];
    const missing = [];
    for (const fileId of request.fileIds) {
      const file = getFileById(db, fileId);
      if (file) {
        items.push({ fileId, sourcePath: file.absolutePath, filename: file.filename });
      } else {
        missing.push({
          fileId,
          filename: `#${fileId}`,
          message: 'That asset is no longer in the index.',
        });
      }
    }

    const outcome = await copyAssets(items, request.destinationPath, request.strategy);
    outcome.errors.push(...missing);

    // Copying into a folder is what makes it "recent", so a successful copy moves it to
    // the top of the picker.
    if (outcome.copied.length > 0) {
      touchDestination(db, request.destinationPath);
      broadcast(EVENTS.librariesChanged);
    }

    return outcome;
  });

  handle<DragResult>(IPC.startDrag, async (rawIds) => {
    const fileIds = requireFileIds(rawIds);
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new ValidationError('The window is not available.');

    // Paths come from the index, never from the renderer. Files deleted since the search
    // are left out rather than failing the whole drag.
    const indexed = fileIds
      .map((id) => getFileById(db, id)?.absolutePath)
      .filter((path): path is string => path !== undefined);
    const onDisk = (
      await Promise.all(
        indexed.map((path) =>
          stat(path).then(
            (info) => (info.isFile() ? path : null),
            () => null,
          ),
        ),
      )
    ).filter((path): path is string => path !== null);

    if (onDisk.length === 0) {
      throw new ValidationError(
        fileIds.length === 1 ? 'That file is no longer on disk.' : 'None of those files are on disk any more.',
      );
    }

    const native = onDisk.map((path) => (process.platform === 'win32' ? path.replace(/\//g, '\\') : path));
    // Electron offers the drop target copy and link only, never move, so dropping into a
    // folder on the same drive copies the asset rather than taking it out of the library.
    window.webContents.startDrag({ file: native[0], files: native, icon: dragIcon() });

    return { dragged: onDisk.length, missing: fileIds.length - onDisk.length };
  });

  handle<string>(IPC.getPlaybackUrl, (rawId) => {
    // The id is all the renderer needs: the protocol handler resolves it back to a path
    // through the index, so no filesystem path is ever chosen by the renderer.
    const file = requireFile(db, rawId);
    return `${AUDIO_PROTOCOL}://file/${file.id}`;
  });

  /* ------------------------------------------------------------- destinations */

  handle<Destination[]>(IPC.listDestinations, () => listDestinations(db));

  handle<Destination>(IPC.addDestination, async (rawName, rawPath) => {
    const name = requireString(rawName, 'name', 120).trim();
    const path = requireString(rawPath, 'path');

    if (name.length === 0) throw new ValidationError('A destination name is required.');
    if (!isSafeAbsolutePath(path)) throw new ValidationError('A full folder path is required.');
    // A saved destination must point somewhere real, so a typo cannot sit in the list
    // waiting to fail at copy time. Copying itself still creates missing subfolders.
    if (!(await isReadableDirectory(path))) {
      throw new ValidationError('That destination folder could not be opened.');
    }

    const destination = addDestination(db, name, path);
    broadcast(EVENTS.librariesChanged);
    return destination;
  });

  /* ---------------------------------------------------------- favorites, tags */

  handle<void>(IPC.setFavorite, (rawId, rawFavorite) => {
    const file = requireFile(db, rawId);
    setFavorite(db, file.id, rawFavorite === true);
  });

  handle<Tag[]>(IPC.listTags, (rawId) => listTagsForFile(db, requireId(rawId, 'fileId')));

  handle<void>(IPC.addTag, (rawId, rawName) => {
    const file = requireFile(db, rawId);
    addTag(db, file.id, requireString(rawName, 'tag', 60));
  });

  handle<void>(IPC.removeTag, (rawFileId, rawTagId) => {
    removeTag(db, requireId(rawFileId, 'fileId'), requireId(rawTagId, 'tagId'));
  });
}

/**
 * Builds a Windows CF_HDROP clipboard payload for a single file: a DROPFILES header
 * followed by a double-NUL terminated wide-character path list.
 */
function buildWindowsFileDrop(path: string): Buffer {
  const HEADER_SIZE = 20;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(HEADER_SIZE, 0); // pFiles: offset to the file list
  header.writeUInt32LE(0, 4); // pt.x
  header.writeUInt32LE(0, 8); // pt.y
  header.writeUInt32LE(0, 12); // fNC
  header.writeUInt32LE(1, 16); // fWide: paths are UTF-16

  const paths = Buffer.from(`${path}\0\0`, 'ucs2');
  return Buffer.concat([header, paths]);
}

export function unregisterHandlers(): void {
  for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel);
}
