import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Creates an isolated temporary directory for a test.
 *
 * Every filesystem test works inside one of these. Nothing in this suite ever touches a
 * real asset library.
 */
export function makeTempDir(prefix = 'audio-browser-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Writes a file (creating parent folders), with optional byte content. */
export function writeFile(root: string, relativePath: string, content = 'x'): string {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/**
 * A minimal but genuinely valid 8-bit mono WAV, so metadata extraction is exercised
 * against a real header rather than a stub.
 */
export function writeWav(
  root: string,
  relativePath: string,
  options: { sampleRate?: number; channels?: number; bitsPerSample?: number; frames?: number } = {},
): string {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 8;
  const frames = options.frames ?? sampleRate; // one second by default

  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM subchunk size
  buffer.writeUInt16LE(1, 20); // audio format: PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buffer);
  return full;
}
