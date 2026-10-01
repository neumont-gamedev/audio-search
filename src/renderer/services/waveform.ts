/**
 * Waveform peak maths, kept pure and free of React and Web Audio so it can be unit-tested.
 * Listed in tsconfig.node.json for that reason.
 */
import { WAVEFORM_BUCKETS, WAVEFORM_FORMAT_VERSION } from '../../shared/constants';

/**
 * Reduces decoded audio to the cached format: a version byte, then `buckets` values, each
 * the loudest absolute sample (across all channels) in its slice, scaled to 0-255.
 *
 * Max-abs rather than RMS, because what a waveform preview has to show is the transient: a
 * single impact or click must not be averaged away.
 */
export function computePeaks(
  channels: ReadonlyArray<ArrayLike<number>>,
  buckets: number = WAVEFORM_BUCKETS,
): Uint8Array {
  const out = new Uint8Array(buckets + 1);
  out[0] = WAVEFORM_FORMAT_VERSION;

  const length = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  if (length === 0) return out;

  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor((bucket * length) / buckets);
    // A file with fewer samples than buckets still gets one sample per bucket, so a very
    // short click is drawn rather than leaving gaps.
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * length) / buckets));
    let peak = 0;
    for (const channel of channels) {
      const stop = Math.min(end, channel.length);
      for (let i = start; i < stop; i++) {
        const value = Math.abs(channel[i]);
        if (value > peak) peak = value;
      }
    }
    // Clipped or over-range float audio is drawn at full scale, not wrapped.
    out[bucket + 1] = Math.round(Math.min(peak, 1) * 255);
  }
  return out;
}

/**
 * Reads a cached waveform back to amplitudes in 0-1. Anything not in the current format
 * yields null, so an old or damaged cache entry is regenerated rather than mis-drawn.
 */
export function decodePeaks(data: Uint8Array | null | undefined): number[] | null {
  if (!data || data.length !== WAVEFORM_BUCKETS + 1 || data[0] !== WAVEFORM_FORMAT_VERSION) {
    return null;
  }
  return Array.from(data.subarray(1), (value) => value / 255);
}

/**
 * How much to scale peaks up for display. Quiet files are boosted so their shape (attack,
 * tail, separate hits) is readable, but by at most `maxGain`, so a near-silent file does
 * not have its noise floor blown up into something that looks loud.
 */
export function displayGain(peaks: readonly number[], maxGain = 4): number {
  const loudest = peaks.reduce((max, value) => Math.max(max, value), 0);
  if (loudest === 0) return 1;
  return Math.min(1 / loudest, maxGain);
}

/** The loudest peak among the buckets a canvas column of `columns` covers, at `column`. */
export function columnPeak(peaks: readonly number[], column: number, columns: number): number {
  if (peaks.length === 0 || columns <= 0) return 0;
  const start = Math.floor((column * peaks.length) / columns);
  const end = Math.max(start + 1, Math.floor(((column + 1) * peaks.length) / columns));
  let peak = 0;
  for (let i = start; i < Math.min(end, peaks.length); i++) {
    if (peaks[i] > peak) peak = peaks[i];
  }
  return peak;
}
