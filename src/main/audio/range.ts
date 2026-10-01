/**
 * HTTP byte-range parsing for the audio protocol, kept pure so it can be unit-tested.
 *
 * <audio> needs range responses to seek, and to learn the duration of formats whose header
 * does not state it (MP3, OGG, M4A): without them Chromium treats the response as a live
 * stream with infinite duration, and seeking silently does nothing.
 */

export interface ByteRange {
  start: number;
  /** Inclusive, as in the Content-Range header. */
  end: number;
}

/**
 * Parses a `Range` request header against a file of `size` bytes.
 *
 * Returns the range to serve; `null` when the whole file should be served (no header, or a
 * form this server does not support, such as multiple ranges); or `'unsatisfiable'` for a
 * range lying entirely outside the file, which must be answered with 416.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Multi-range ("bytes=0-1,5-6") and malformed headers fall back to the full file, which
  // is always a valid response to a range request.
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // Suffix form, "bytes=-500": the last 500 bytes.
    const length = Number(rawEnd);
    if (length === 0) return 'unsatisfiable';
    if (size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return 'unsatisfiable';
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return null;
  return { start, end };
}

const MIME_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};

/** Content type by extension; the decoder sniffs anyway, but a correct type avoids guessing. */
export function audioMimeType(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}
