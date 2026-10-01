import { describe, expect, it } from 'vitest';
import { columnPeak, computePeaks, decodePeaks, displayGain } from '../src/renderer/services/waveform';
import { WAVEFORM_BUCKETS, WAVEFORM_FORMAT_VERSION } from '../src/shared/constants';

const peaksOf = (data: Uint8Array) => Array.from(data.subarray(1));

describe('computePeaks', () => {
  it('writes the version byte and one value per bucket', () => {
    const data = computePeaks([new Float32Array(5000)]);
    expect(data.length).toBe(WAVEFORM_BUCKETS + 1);
    expect(data[0]).toBe(WAVEFORM_FORMAT_VERSION);
  });

  it('keeps silence at zero', () => {
    expect(peaksOf(computePeaks([new Float32Array(4000)], 4))).toEqual([0, 0, 0, 0]);
  });

  it('records the loudest absolute sample in each slice, so negative peaks count', () => {
    const samples = new Float32Array(8);
    samples.set([0.1, -0.5, 0, 0, 0.25, 0.2, -1, 0]);
    expect(peaksOf(computePeaks([samples], 4))).toEqual([128, 0, 64, 255]);
  });

  it('keeps a single-sample transient instead of averaging it away', () => {
    const samples = new Float32Array(10_000);
    samples[7_321] = 0.9;
    const peaks = peaksOf(computePeaks([samples], 10));
    // Float32 stores 0.9 as 0.89999997, hence fround.
    expect(peaks[7]).toBe(Math.round(Math.fround(0.9) * 255));
    expect(peaks.filter((p) => p > 0)).toHaveLength(1);
  });

  it('takes the loudest channel, so a hit on one side of a stereo file shows', () => {
    const left = new Float32Array(4).fill(0.1);
    const right = new Float32Array(4);
    right[3] = 0.8;
    expect(peaksOf(computePeaks([left, right], 2))).toEqual([26, 204]);
  });

  it('draws clipped or over-range audio at full scale', () => {
    expect(peaksOf(computePeaks([Float32Array.from([1.7, -2.4])], 2))).toEqual([255, 255]);
  });

  it('gives a file shorter than the bucket count one sample per bucket, without gaps', () => {
    const peaks = peaksOf(computePeaks([Float32Array.from([0.5, 1])], 4));
    expect(peaks).toEqual([128, 128, 255, 255]);
  });

  it('handles a file with no samples at all', () => {
    expect(peaksOf(computePeaks([], 3))).toEqual([0, 0, 0]);
    expect(peaksOf(computePeaks([new Float32Array(0)], 3))).toEqual([0, 0, 0]);
  });
});

describe('decodePeaks', () => {
  it('round-trips computed peaks to amplitudes in 0-1', () => {
    const samples = new Float32Array(WAVEFORM_BUCKETS);
    samples[0] = 1;
    const peaks = decodePeaks(computePeaks([samples]));
    expect(peaks).toHaveLength(WAVEFORM_BUCKETS);
    expect(peaks?.[0]).toBe(1);
    expect(peaks?.[1]).toBe(0);
  });

  it('rejects missing, truncated or other-version data so it is regenerated', () => {
    const good = computePeaks([new Float32Array(10)]);
    expect(decodePeaks(null)).toBeNull();
    expect(decodePeaks(good.subarray(0, 50))).toBeNull();
    const otherVersion = Uint8Array.from(good);
    otherVersion[0] = WAVEFORM_FORMAT_VERSION + 1;
    expect(decodePeaks(otherVersion)).toBeNull();
  });
});

describe('displayGain', () => {
  it('scales a quiet file up so its loudest peak reaches full height', () => {
    expect(displayGain([0.1, 0.5, 0.25])).toBe(2);
  });

  it('caps the boost so near-silence is not drawn as loud', () => {
    expect(displayGain([0.01, 0.02])).toBe(4);
  });

  it('leaves full-scale and silent files alone', () => {
    expect(displayGain([0.3, 1])).toBe(1);
    expect(displayGain([0, 0])).toBe(1);
  });
});

describe('columnPeak', () => {
  it('takes the loudest bucket a column covers when there are more buckets than columns', () => {
    expect(columnPeak([0.1, 0.9, 0.2, 0.3], 0, 2)).toBe(0.9);
    expect(columnPeak([0.1, 0.9, 0.2, 0.3], 1, 2)).toBe(0.3);
  });

  it('repeats buckets across columns when the canvas is wider than the data', () => {
    expect([0, 1, 2, 3].map((c) => columnPeak([0.2, 0.8], c, 4))).toEqual([0.2, 0.2, 0.8, 0.8]);
  });

  it('returns zero for empty input', () => {
    expect(columnPeak([], 0, 10)).toBe(0);
    expect(columnPeak([0.5], 0, 0)).toBe(0);
  });
});
