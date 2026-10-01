import { describe, expect, it } from 'vitest';
import { audioMimeType, parseByteRange } from '../src/main/audio/range';

describe('parseByteRange', () => {
  const SIZE = 1000;

  it('serves the whole file when there is no Range header', () => {
    expect(parseByteRange(null, SIZE)).toBeNull();
    expect(parseByteRange('', SIZE)).toBeNull();
  });

  it('parses an explicit range, end inclusive', () => {
    expect(parseByteRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 });
    expect(parseByteRange('bytes=200-200', SIZE)).toEqual({ start: 200, end: 200 });
  });

  it('parses an open-ended range, as <audio> sends when it first loads or seeks', () => {
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=750-', SIZE)).toEqual({ start: 750, end: 999 });
  });

  it('clamps an end beyond the file to the last byte', () => {
    expect(parseByteRange('bytes=900-5000', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('parses a suffix range: the last N bytes', () => {
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('reports a range starting past the end as unsatisfiable', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=5000-6000', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('falls back to the whole file for forms it does not support', () => {
    expect(parseByteRange('bytes=0-1,5-6', SIZE)).toBeNull();
    expect(parseByteRange('items=0-10', SIZE)).toBeNull();
    expect(parseByteRange('bytes=abc', SIZE)).toBeNull();
    expect(parseByteRange('bytes=-', SIZE)).toBeNull();
    expect(parseByteRange('bytes=500-100', SIZE)).toBeNull();
  });
});

describe('audioMimeType', () => {
  it('maps every supported format, case-insensitively', () => {
    expect(audioMimeType('.wav')).toBe('audio/wav');
    expect(audioMimeType('.MP3')).toBe('audio/mpeg');
    expect(audioMimeType('.ogg')).toBe('audio/ogg');
    expect(audioMimeType('.flac')).toBe('audio/flac');
    expect(audioMimeType('.m4a')).toBe('audio/mp4');
  });

  it('falls back to a generic type for anything else', () => {
    expect(audioMimeType('.exe')).toBe('application/octet-stream');
  });
});
