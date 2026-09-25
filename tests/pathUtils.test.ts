import { describe, expect, it } from 'vitest';
import {
  isPathInside,
  isSafeAbsolutePath,
  normalizePath,
  parentFolderName,
  pathsEqual,
  splitFilename,
  toRelativePath,
} from '../src/main/filesystem/pathUtils';

const isWindows = process.platform === 'win32';

describe('normalizePath', () => {
  it('uses forward slashes', () => {
    const input = isWindows ? 'D:\\GameAssets\\Audio\\Combat' : '/assets/audio/combat';
    expect(normalizePath(input)).not.toContain('\\');
  });

  it('removes a trailing separator', () => {
    const input = isWindows ? 'D:\\GameAssets\\Audio\\' : '/assets/audio/';
    expect(normalizePath(input).endsWith('/')).toBe(false);
  });

  it('keeps the trailing slash on a drive or filesystem root', () => {
    const root = isWindows ? 'D:\\' : '/';
    expect(normalizePath(root).endsWith('/')).toBe(true);
  });

  it('collapses redundant segments', () => {
    const input = isWindows ? 'D:\\Audio\\Combat\\..\\UI' : '/audio/combat/../ui';
    expect(normalizePath(input).toLowerCase().endsWith('/ui')).toBe(true);
  });

  it('is idempotent', () => {
    const input = isWindows ? 'D:\\Audio\\SFX' : '/audio/sfx';
    const once = normalizePath(input);
    expect(normalizePath(once)).toBe(once);
  });
});

describe('pathsEqual', () => {
  it('matches identical paths written differently', () => {
    const a = isWindows ? 'D:\\Audio\\SFX' : '/audio/sfx';
    const b = isWindows ? 'D:\\Audio\\Extra\\..\\SFX\\' : '/audio/extra/../sfx/';
    expect(pathsEqual(a, b)).toBe(true);
  });

  it('follows the platform convention for casing', () => {
    const a = isWindows ? 'D:\\Audio\\SFX' : '/audio/sfx';
    const b = isWindows ? 'd:\\audio\\sfx' : '/AUDIO/SFX';
    // Windows and macOS are case-insensitive; Linux is not.
    expect(pathsEqual(a, b)).toBe(isWindows || process.platform === 'darwin');
  });

  it('does not treat different paths as equal', () => {
    const a = isWindows ? 'D:\\Audio\\SFX' : '/audio/sfx';
    const b = isWindows ? 'D:\\Audio\\Music' : '/audio/music';
    expect(pathsEqual(a, b)).toBe(false);
  });
});

describe('isPathInside', () => {
  const parent = isWindows ? 'D:\\Audio' : '/audio';

  it('accepts a nested path', () => {
    expect(isPathInside(isWindows ? 'D:\\Audio\\SFX\\a.wav' : '/audio/sfx/a.wav', parent)).toBe(
      true,
    );
  });

  it('accepts the parent itself', () => {
    expect(isPathInside(parent, parent)).toBe(true);
  });

  it('rejects a sibling with a shared prefix', () => {
    // "/audio-extra" must not count as inside "/audio".
    expect(isPathInside(isWindows ? 'D:\\AudioExtra\\a.wav' : '/audio-extra/a.wav', parent)).toBe(
      false,
    );
  });

  it('rejects an unrelated path', () => {
    expect(isPathInside(isWindows ? 'C:\\Other\\a.wav' : '/other/a.wav', parent)).toBe(false);
  });
});

describe('toRelativePath', () => {
  it('produces a forward-slash relative path', () => {
    const library = isWindows ? 'D:\\Audio' : '/audio';
    const file = isWindows ? 'D:\\Audio\\Combat\\Punch\\hit.wav' : '/audio/Combat/Punch/hit.wav';
    expect(toRelativePath(library, file)).toBe('Combat/Punch/hit.wav');
  });

  it('handles a file at the library root', () => {
    const library = isWindows ? 'D:\\Audio' : '/audio';
    const file = isWindows ? 'D:\\Audio\\hit.wav' : '/audio/hit.wav';
    expect(toRelativePath(library, file)).toBe('hit.wav');
  });
});

describe('parentFolderName', () => {
  it('returns the immediate folder', () => {
    expect(parentFolderName('Combat/Impacts/Body/hit.wav')).toBe('Body');
  });

  it('returns empty for a file at the root', () => {
    expect(parentFolderName('hit.wav')).toBe('');
  });
});

describe('splitFilename', () => {
  it('splits base and extension', () => {
    expect(splitFilename('punch_03.wav')).toEqual({ base: 'punch_03', ext: '.wav' });
  });

  it('splits on the last dot', () => {
    expect(splitFilename('my.sound.v2.ogg')).toEqual({ base: 'my.sound.v2', ext: '.ogg' });
  });

  it('treats a dotfile as having no extension', () => {
    expect(splitFilename('.gitignore')).toEqual({ base: '.gitignore', ext: '' });
  });

  it('handles a name with no dot', () => {
    expect(splitFilename('README')).toEqual({ base: 'README', ext: '' });
  });
});

describe('isSafeAbsolutePath', () => {
  it('accepts a normal absolute path', () => {
    expect(isSafeAbsolutePath(isWindows ? 'D:\\Audio\\a.wav' : '/audio/a.wav')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(isSafeAbsolutePath('Audio/a.wav')).toBe(false);
    expect(isSafeAbsolutePath('../../etc/passwd')).toBe(false);
  });

  it('rejects empty and non-string input', () => {
    expect(isSafeAbsolutePath('')).toBe(false);
    expect(isSafeAbsolutePath(null)).toBe(false);
    expect(isSafeAbsolutePath(42)).toBe(false);
    expect(isSafeAbsolutePath(undefined)).toBe(false);
  });

  it('rejects a path containing a NUL byte', () => {
    expect(isSafeAbsolutePath(isWindows ? 'D:\\a\0b.wav' : '/a\0b.wav')).toBe(false);
  });
});
