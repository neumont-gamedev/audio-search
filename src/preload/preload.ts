import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENTS, IPC } from '../main/ipc/channels';
import type {
  AudioFile,
  AudioLibraryApi,
  CopyRequest,
  CopyResult,
  Destination,
  FacetCounts,
  IpcResponse,
  Library,
  ScanProgress,
  SearchQuery,
  SearchResult,
  Tag,
} from '../shared/types';

/**
 * The renderer gets exactly these functions and nothing else: no `fs`, no `path`, no
 * generic `invoke`. Each one forwards to a named channel that the main process validates.
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResponse<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResponse<T>>;
}

/** Subscribes to a push event and returns an unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: AudioLibraryApi = {
  selectFolder: (title) => invoke<string | null>(IPC.selectFolder, title),

  listLibraries: () => invoke<Library[]>(IPC.listLibraries),
  addLibrary: (path) => invoke<Library>(IPC.addLibrary, path),
  removeLibrary: (libraryId) => invoke<void>(IPC.removeLibrary, libraryId),
  rescanLibrary: (libraryId) => invoke<void>(IPC.rescanLibrary, libraryId),
  cancelScan: (libraryId) => invoke<void>(IPC.cancelScan, libraryId),
  openLibraryFolder: (libraryId) => invoke<void>(IPC.openLibraryFolder, libraryId),

  search: (query: SearchQuery) => invoke<SearchResult>(IPC.search, query),
  getFacets: (query: SearchQuery) => invoke<FacetCounts>(IPC.getFacets, query),
  getFile: (fileId) => invoke<AudioFile>(IPC.getFile, fileId),

  showInFolder: (fileId) => invoke<void>(IPC.showInFolder, fileId),
  copyPath: (fileId) => invoke<void>(IPC.copyPath, fileId),
  copyFileToClipboard: (fileId) => invoke<void>(IPC.copyFileToClipboard, fileId),
  copyToDestination: (request: CopyRequest) => invoke<CopyResult>(IPC.copyToDestination, request),

  listDestinations: () => invoke<Destination[]>(IPC.listDestinations),
  addDestination: (name, path) => invoke<Destination>(IPC.addDestination, name, path),

  setFavorite: (fileId, favorite) => invoke<void>(IPC.setFavorite, fileId, favorite),
  listTags: (fileId) => invoke<Tag[]>(IPC.listTags, fileId),
  addTag: (fileId, name) => invoke<void>(IPC.addTag, fileId, name),
  removeTag: (fileId, tagId) => invoke<void>(IPC.removeTag, fileId, tagId),

  getPlaybackUrl: (fileId) => invoke<string>(IPC.getPlaybackUrl, fileId),

  onScanProgress: (listener) => subscribe<ScanProgress>(EVENTS.scanProgress, listener),
  onLibrariesChanged: (listener) => subscribe<void>(EVENTS.librariesChanged, () => listener()),
  onIndexChanged: (listener) => subscribe<number>(EVENTS.indexChanged, listener),
};

contextBridge.exposeInMainWorld('audioLibrary', api);
