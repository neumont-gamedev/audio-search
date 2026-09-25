import { parseFile } from 'music-metadata';
import { createLogger } from '../logger';

const log = createLogger('metadata');

export interface AudioMetadata {
  duration: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitrate: number | null;
  /** False when the file could not be parsed; the file is still indexed by name and path. */
  ok: boolean;
}

export const UNKNOWN_METADATA: AudioMetadata = {
  duration: null,
  sampleRate: null,
  bitDepth: null,
  channels: null,
  bitrate: null,
  ok: false,
};

function finiteOrNull(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Reads technical metadata from an audio file.
 *
 * Never throws: a corrupt file, an unsupported codec variant, or a file that vanished
 * between discovery and parsing yields `UNKNOWN_METADATA` and a log line, so one bad asset
 * cannot abort a scan of thousands.
 *
 * `duration: false` keeps this to a header read. For CBR formats that is exact; for VBR MP3
 * without a Xing header the duration is an estimate, which is accurate enough for filtering
 * and vastly cheaper than decoding every file in a library.
 */
export async function readAudioMetadata(absolutePath: string): Promise<AudioMetadata> {
  try {
    const parsed = await parseFile(absolutePath, { duration: false, skipCovers: true });
    const format = parsed.format;

    const result: AudioMetadata = {
      duration: finiteOrNull(format.duration),
      sampleRate: finiteOrNull(format.sampleRate),
      bitDepth: finiteOrNull(format.bitsPerSample),
      channels: finiteOrNull(format.numberOfChannels),
      bitrate: finiteOrNull(format.bitrate) === null ? null : Math.round(format.bitrate as number),
      ok: true,
    };

    // A file whose contents do not match any known container resolves with an empty
    // format rather than throwing, so treat "learned nothing at all" as a read failure.
    // The file is still indexed by name and path; only its metadata is unknown.
    if (
      result.duration === null &&
      result.sampleRate === null &&
      result.channels === null &&
      !format.container
    ) {
      log.warn(`no readable audio format: ${absolutePath}`);
      return { ...UNKNOWN_METADATA };
    }

    return result;
  } catch (error) {
    log.warn(`could not read metadata: ${absolutePath}`, (error as Error).message);
    return { ...UNKNOWN_METADATA };
  }
}

/**
 * Runs `worker` over `items` with a bounded number of concurrent operations.
 *
 * Metadata extraction is I/O bound, so some concurrency helps a lot, but an unbounded
 * Promise.all over 100k files would exhaust file handles.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldCancel?: () => boolean,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      if (shouldCancel?.()) return;
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
