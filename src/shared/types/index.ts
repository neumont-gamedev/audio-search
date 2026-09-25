import type { ChannelFilterId, DurationBucketId } from '../constants';

export interface Library {
  id: number;
  path: string;
  name: string;
  addedAt: number;
  lastScanAt: number | null;
  fileCount: number;
  /** False when the folder could not be reached during the last access attempt. */
  available: boolean;
}

export interface AudioFile {
  id: number;
  libraryId: number;
  libraryName: string;
  absolutePath: string;
  relativePath: string;
  filename: string;
  extension: string;
  parentFolder: string;
  fileSize: number;
  duration: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitrate: number | null;
  modifiedAt: number;
  indexedAt: number;
  favorite: boolean;
}

export type SortField = 'filename' | 'duration' | 'fileSize' | 'modifiedAt' | 'relevance';
export type SortDirection = 'asc' | 'desc';

export interface SearchFilters {
  libraryIds: number[];
  extensions: string[];
  durationBuckets: DurationBucketId[];
  /** Custom duration range in seconds; either bound may be null. */
  durationRange: { min: number | null; max: number | null } | null;
  channels: ChannelFilterId[];
  sampleRates: number[];
  favoritesOnly: boolean;
}

export interface SearchQuery {
  text: string;
  filters: SearchFilters;
  sortField: SortField;
  sortDirection: SortDirection;
  limit: number;
  offset: number;
}

export interface SearchResult {
  items: AudioFile[];
  total: number;
  /** Milliseconds the query took in the main process, for the status bar. */
  elapsedMs: number;
}

export interface FacetCounts {
  extensions: Record<string, number>;
  libraries: Record<number, number>;
}

export interface ScanProgress {
  libraryId: number;
  libraryName: string;
  phase: 'discovering' | 'indexing' | 'pruning' | 'done' | 'error' | 'cancelled';
  discovered: number;
  indexed: number;
  skipped: number;
  failed: number;
  removed: number;
  message?: string;
}

export interface Destination {
  id: number;
  name: string;
  path: string;
}

export type DuplicateStrategy = 'cancel' | 'overwrite' | 'rename';

export interface CopyRequest {
  /** One or many assets; a single-file copy is just a batch of one. */
  fileIds: number[];
  destinationPath: string;
  /** Omitted on the first attempt; the renderer re-sends with a choice on conflict. */
  strategy?: DuplicateStrategy;
}

export interface CopyConflict {
  fileId: number;
  filename: string;
  destinationFile: string;
  suggestedName: string;
}

export interface CopyResult {
  copied: Array<{ fileId: number; destinationFile: string }>;
  /** Files that already exist at the destination and were left untouched. */
  conflicts: CopyConflict[];
  errors: Array<{ fileId: number; filename: string; message: string }>;
  cancelled: number;
}

export interface AppError {
  code:
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'PERMISSION_DENIED'
    | 'PATH_UNAVAILABLE'
    | 'DATABASE_ERROR'
    | 'IO_ERROR'
    | 'UNKNOWN';
  message: string;
}

/** Every IPC call resolves to this envelope so the renderer never sees a raw throw. */
export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: AppError };

export interface Tag {
  id: number;
  name: string;
}

/** The complete surface exposed on `window.audioLibrary`. */
export interface AudioLibraryApi {
  selectFolder(title?: string): Promise<IpcResponse<string | null>>;

  listLibraries(): Promise<IpcResponse<Library[]>>;
  addLibrary(path: string): Promise<IpcResponse<Library>>;
  removeLibrary(libraryId: number): Promise<IpcResponse<void>>;
  rescanLibrary(libraryId: number): Promise<IpcResponse<void>>;
  cancelScan(libraryId: number): Promise<IpcResponse<void>>;
  openLibraryFolder(libraryId: number): Promise<IpcResponse<void>>;

  search(query: SearchQuery): Promise<IpcResponse<SearchResult>>;
  getFacets(query: SearchQuery): Promise<IpcResponse<FacetCounts>>;
  getFile(fileId: number): Promise<IpcResponse<AudioFile>>;

  showInFolder(fileId: number): Promise<IpcResponse<void>>;
  copyPath(fileId: number): Promise<IpcResponse<void>>;
  copyFileToClipboard(fileId: number): Promise<IpcResponse<void>>;
  /** Copies one or many assets; conflicts come back unresolved for the user to decide. */
  copyToDestination(request: CopyRequest): Promise<IpcResponse<CopyResult>>;

  /** Recently used copy destinations, most recent first. */
  listDestinations(): Promise<IpcResponse<Destination[]>>;
  /** Remembers a folder as a recent destination; the list is capped and self-pruning. */
  addDestination(name: string, path: string): Promise<IpcResponse<Destination>>;

  setFavorite(fileId: number, favorite: boolean): Promise<IpcResponse<void>>;
  listTags(fileId: number): Promise<IpcResponse<Tag[]>>;
  addTag(fileId: number, name: string): Promise<IpcResponse<void>>;
  removeTag(fileId: number, tagId: number): Promise<IpcResponse<void>>;

  /** Resolves the playable custom-protocol URL for an indexed asset. */
  getPlaybackUrl(fileId: number): Promise<IpcResponse<string>>;

  onScanProgress(listener: (progress: ScanProgress) => void): () => void;
  onLibrariesChanged(listener: () => void): () => void;
  onIndexChanged(listener: (libraryId: number) => void): () => void;
}
