/** Supported audio formats. Adding a format here is enough for the scanner to pick it up. */
export const SUPPORTED_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export function isSupportedExtension(ext: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/** Directories that never contain user audio assets worth indexing. */
export const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

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
