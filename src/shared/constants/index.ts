/** Supported audio formats. Adding a format here is enough for the scanner to pick it up. */
export const SUPPORTED_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export function isSupportedExtension(ext: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Directories that never contain user audio assets worth indexing, lower-cased. Matching is
 * case-insensitive because Windows names vary (`$RECYCLE.BIN` vs `$Recycle.Bin`).
 * `__MACOSX` is added by zips made on a Mac and holds only AppleDouble metadata files.
 */
const IGNORED_DIRECTORIES = new Set(
  ['.git', '.svn', '.hg', 'node_modules', '$RECYCLE.BIN', 'System Volume Information', '__MACOSX'].map(
    (name) => name.toLowerCase(),
  ),
);

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name.toLowerCase());
}

/**
 * macOS AppleDouble companions (`._impact.wav`) carry Finder metadata, not audio, despite the
 * extension. They appear inside `__MACOSX` and wherever a Mac has copied files onto a
 * non-Apple filesystem such as a USB stick.
 */
export function isIgnoredFile(name: string): boolean {
  return name.startsWith('._');
}

/**
 * The single ignore rule shared by the scanner and the watcher: true if any segment of the
 * path is an ignored directory, or the final segment is an ignored file.
 */
export function isIgnoredPath(path: string): boolean {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.some(isIgnoredDirectory) || isIgnoredFile(segments[segments.length - 1]);
}

export const DURATION_BUCKETS = {
  under1: { label: '< 1 second', min: 0, max: 1 },
  oneToThree: { label: '1-3 seconds', min: 1, max: 3 },
  threeToTen: { label: '3-10 seconds', min: 3, max: 10 },
  overTen: { label: '> 10 seconds', min: 10, max: null },
} as const;

export type DurationBucketId = keyof typeof DURATION_BUCKETS;

export const CHANNEL_FILTERS = {
  mono: { label: 'Mono', channels: 1 },
  stereo: { label: 'Stereo', channels: 2 },
  other: { label: 'Other', channels: null },
} as const;

export type ChannelFilterId = keyof typeof CHANNEL_FILTERS;

/** Sample rates offered as quick filters, in Hz. */
export const COMMON_SAMPLE_RATES = [22050, 44100, 48000, 88200, 96000, 192000] as const;

/** Custom protocol used to stream indexed audio into the renderer without exposing fs. */
export const AUDIO_PROTOCOL = 'audio-asset';

export const SEARCH_PAGE_SIZE = 200;

/**
 * Cached waveform format: one version byte, then this many peak buckets, each the largest
 * absolute sample in its slice of the file, scaled to 0-255. About 1 KB per file.
 * Bump the version if the encoding changes; stale cache entries are then regenerated.
 */
export const WAVEFORM_BUCKETS = 1000;
export const WAVEFORM_FORMAT_VERSION = 1;

/**
 * Files larger than this get no waveform: moving and decoding them would cost more than a
 * preview is worth. The player falls back to a plain progress bar.
 */
export const MAX_WAVEFORM_SOURCE_BYTES = 100 * 1024 * 1024;
