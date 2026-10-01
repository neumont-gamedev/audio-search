import { describe, expect, it } from 'vitest';
import { isIgnoredDirectory, isIgnoredFile, isIgnoredPath } from '../src/shared/constants';

// isIgnoredPath is the rule the file watcher applies; the scanner uses the two parts directly.
describe('ignore rules', () => {
  it('ignores tool and system directories regardless of case', () => {
    expect(isIgnoredDirectory('__MACOSX')).toBe(true);
    expect(isIgnoredDirectory('$Recycle.Bin')).toBe(true);
    expect(isIgnoredDirectory('Node_Modules')).toBe(true);
    expect(isIgnoredDirectory('Impacts')).toBe(false);
    expect(isIgnoredDirectory('MACOSX')).toBe(false);
  });

  it('ignores only AppleDouble ._ files', () => {
    expect(isIgnoredFile('._impact.wav')).toBe(true);
    expect(isIgnoredFile('impact.wav')).toBe(false);
    expect(isIgnoredFile('_impact.wav')).toBe(false);
    expect(isIgnoredFile('.hidden.wav')).toBe(false);
  });

  it('ignores a path inside an ignored directory, with either separator', () => {
    expect(isIgnoredPath('__MACOSX/Impacts/impact.wav')).toBe(true);
    expect(isIgnoredPath('__MACOSX\\Impacts\\impact.wav')).toBe(true);
    expect(isIgnoredPath('__MACOSX')).toBe(true);
    expect(isIgnoredPath('Packs/.git/objects/a.wav')).toBe(true);
  });

  it('ignores an AppleDouble file anywhere, but only as the final segment', () => {
    expect(isIgnoredPath('Impacts/._impact.wav')).toBe(true);
    expect(isIgnoredPath('Impacts/impact.wav')).toBe(false);
    expect(isIgnoredPath('')).toBe(false);
  });
});
