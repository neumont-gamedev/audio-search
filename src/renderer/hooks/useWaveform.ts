import { useEffect, useState } from 'react';
import { api, unwrap } from '../services/api';
import { computePeaks, decodePeaks } from '../services/waveform';

export interface WaveformState {
  /** Amplitudes in 0-1, one per bucket; null while loading or when there is none. */
  peaks: number[] | null;
  loading: boolean;
}

/**
 * How long a sound must stay current before an uncached waveform is generated. Auditioning
 * with Auto on can pass through many rows a second; decoding each one would waste work on
 * sounds the user has already moved past. Cached waveforms are shown without waiting.
 */
const GENERATE_DELAY_MS = 200;

/** Decoding sample rate. High enough that resampling cannot smooth away a transient. */
const DECODE_SAMPLE_RATE = 44_100;

/** Files that could not be decoded this session, so they are not retried on every play. */
const undecodable = new Set<number>();

let decoder: OfflineAudioContext | null = null;

/**
 * An offline context decodes without opening an audio output device, and one shared
 * instance is enough: decodeAudioData does not depend on the context's own length.
 */
function getDecoder(): OfflineAudioContext {
  decoder ??= new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  return decoder;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generate(fileId: number): Promise<Uint8Array> {
  const bytes = await unwrap(api.readAudioData(fileId));
  // decodeAudioData takes ownership of (detaches) its buffer, so hand it an exact copy of
  // just this file's bytes.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const audio = await getDecoder().decodeAudioData(buffer);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return computePeaks(channels);
}

/**
 * The waveform for the current sound: read from the index cache, or generated on demand by
 * decoding the file with the browser's own decoders and cached for next time. Never runs
 * at startup, only for a sound the user has actually played.
 */
export function useWaveform(fileId: number | null): WaveformState {
  const [state, setState] = useState<WaveformState & { fileId: number | null }>({
    fileId: null,
    peaks: null,
    loading: false,
  });

  useEffect(() => {
    if (fileId === null || undecodable.has(fileId)) {
      setState({ fileId, peaks: null, loading: false });
      return;
    }

    let cancelled = false;
    setState({ fileId, peaks: null, loading: true });

    void (async () => {
      try {
        let data = await unwrap(api.getWaveform(fileId));
        let peaks = decodePeaks(data);

        if (!peaks) {
          await sleep(GENERATE_DELAY_MS);
          if (cancelled) return;
          data = await generate(fileId);
          if (cancelled) return;
          peaks = decodePeaks(data);
          // Fire and forget: if caching fails, the waveform is simply generated again.
          void api.saveWaveform(fileId, data);
        }

        if (!cancelled) setState({ fileId, peaks, loading: false });
      } catch {
        // Unsupported codec, a file too large, or one deleted since the search. The player
        // keeps its plain progress bar; playback itself is unaffected.
        undecodable.add(fileId);
        if (!cancelled) setState({ fileId, peaks: null, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // A stale result for the previous sound is never shown for the new one.
  return state.fileId === fileId ? { peaks: state.peaks, loading: state.loading } : { peaks: null, loading: true };
}
