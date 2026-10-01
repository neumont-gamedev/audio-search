import type { Database } from 'better-sqlite3';
import { app, BrowserWindow, Menu, screen } from 'electron';
import { join } from 'node:path';
import appIcon from '../../build/icon.png?asset';
import type { Library, ScanProgress } from '../shared/types';
import { registerAudioProtocolHandler, registerAudioProtocolScheme } from './audio/protocol';
import { closeDatabase, openDatabase } from './database/db';
import { listLibraries } from './database/libraries';
import { LibraryWatcher } from './filesystem/watcher';
import { Indexer } from './indexing/indexer';
import { EVENTS } from './ipc/channels';
import { registerHandlers, unregisterHandlers } from './ipc/handlers';
import { createLogger, initLogger } from './logger';
import {
  DEFAULT_SIZE,
  fitToDisplays,
  loadWindowState,
  MIN_SIZE,
  saveWindowState,
} from './windowState';

const log = createLogger('main');

let mainWindow: BrowserWindow | null = null;
let indexer: Indexer | null = null;
let watcher: LibraryWatcher | null = null;

// Must happen before the app is ready, so the audio scheme has the right privileges.
registerAudioProtocolScheme();

// A second instance would fight the first over the SQLite index, so hand focus back instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void start();
}

async function start(): Promise<void> {
  await app.whenReady();

  initLogger(app.getPath('userData'));
  log.info('application starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
  });

  const db = openDatabase(join(app.getPath('userData'), 'index.db'));
  registerAudioProtocolHandler(db);

  const broadcast = (channel: string, payload?: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  indexer = new Indexer(db, (progress: ScanProgress) => broadcast(EVENTS.scanProgress, progress));
  watcher = new LibraryWatcher(db, (libraryId) => broadcast(EVENTS.indexChanged, libraryId));

  registerHandlers({
    db,
    indexer,
    watcher,
    getWindow: () => mainWindow,
  });

  // Electron's default menu (File/Edit/View/Window/Help) is generic: it links to
  // electronjs.org and exposes Reload and DevTools to every user. Nothing in it is needed —
  // clipboard keys in text fields are handled natively on Windows — so remove it entirely.
  Menu.setApplicationMenu(null);

  createWindow();
  startWatchingExistingLibraries(db);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  const stateFile = join(app.getPath('userData'), 'window-state.json');
  const saved = loadWindowState(stateFile);
  // Null when nothing is saved or the saved spot is off every connected monitor; the window
  // then opens centered at the default size.
  const restored = saved && fitToDisplays(saved, screen.getAllDisplays().map((d) => d.workArea));

  mainWindow = new BrowserWindow({
    ...(restored ? restored.bounds : DEFAULT_SIZE),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: '#14161a',
    show: false,
    title: 'Audio Asset Browser',
    // Packaged builds would inherit the .exe icon anyway; `npm run dev` runs electron.exe,
    // so without this the window shows Electron's icon.
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload needs `require` for the contextBridge module only
      webviewTag: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    log.info('main window ready');
    if (restored?.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });

  // Saved on close only: positions mid-drag are noise, and a crash simply means the next
  // launch uses the previous good state.
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    saveWindowState(stateFile, {
      bounds: mainWindow.getNormalBounds(),
      maximized: mainWindow.isMaximized(),
    });
  });

  // Renderer problems are invisible unless DevTools happens to be open, so surface
  // warnings and errors in the same log as everything else.
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return; // 0 = verbose, 1 = info
    const where = sourceId ? ` (${sourceId}:${line})` : '';
    if (level === 2) log.warn(`renderer: ${message}${where}`);
    else log.error(`renderer: ${message}${where}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('renderer process gone', details);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    log.error('renderer failed to load', { code, description });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // With the menu gone, its Reload and DevTools shortcuts went too. Restore them for
  // development only; a packaged build never offers either.
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const contents = mainWindow?.webContents;
      if (!contents) return;
      if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
        contents.toggleDevTools();
        event.preventDefault();
      } else if (input.control && !input.shift && key === 'r') {
        contents.reload();
        event.preventDefault();
      }
    });
  }

  // The app never needs to open external content; refuse rather than trust a URL.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log.warn('blocked attempt to open a new window', url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = process.env.ELECTRON_RENDERER_URL
      ? url.startsWith(process.env.ELECTRON_RENDERER_URL)
      : false;
    if (!isDevServer) {
      event.preventDefault();
      log.warn('blocked navigation', url);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Libraries indexed in a previous session are watched again at startup, but deliberately
 * not rescanned: reopening the app must be fast, and the user has an explicit Rescan action.
 */
function startWatchingExistingLibraries(db: Database): void {
  try {
    const libraries: Library[] = listLibraries(db, () => true);
    for (const library of libraries) watcher?.watch(library);
    log.info(`restored ${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'}`);
  } catch (error) {
    log.error('could not restore libraries', error);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  log.info('application shutting down');
  indexer?.cancelAll();
  unregisterHandlers();
  void watcher?.closeAll();
  closeDatabase();
});

// Defence in depth: nothing in this app should ever request a permission or open a URL.
app.on('web-contents-created', (_event, contents) => {
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
});

process.on('uncaughtException', (error) => {
  log.error('uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason);
});
