import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fitToDisplays,
  loadWindowState,
  MIN_SIZE,
  parseWindowState,
  saveWindowState,
  type WindowState,
} from '../src/main/windowState';
import { cleanup, makeTempDir } from './helpers';

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

const state = (x: number, y: number, width: number, height: number, maximized = false): WindowState => ({
  bounds: { x, y, width, height },
  maximized,
});

describe('parseWindowState', () => {
  it('accepts a well-formed state and rounds fractional pixels', () => {
    expect(parseWindowState({ bounds: { x: 10.4, y: 20.6, width: 1000, height: 700 }, maximized: true })).toEqual(
      state(10, 21, 1000, 700, true),
    );
  });

  it('treats anything other than literal true as not maximized', () => {
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, maximized: 'yes' })?.maximized).toBe(
      false,
    );
  });

  it.each([
    null,
    'text',
    {},
    { bounds: null },
    { bounds: { x: 0, y: 0, width: 1000 } },
    { bounds: { x: 0, y: 0, width: 'wide', height: 700 } },
    { bounds: { x: 0, y: 0, width: 0, height: 700 } },
    { bounds: { x: Number.NaN, y: 0, width: 1000, height: 700 } },
  ])('rejects malformed input %j', (raw) => {
    expect(parseWindowState(raw)).toBeNull();
  });
});

describe('fitToDisplays', () => {
  it('keeps a position that is fully on screen', () => {
    const saved = state(100, 80, 1200, 800, true);
    expect(fitToDisplays(saved, [PRIMARY])).toEqual(saved);
  });

  it('restores onto a second monitor while it is connected', () => {
    const saved = state(2200, 100, 1400, 900);
    expect(fitToDisplays(saved, [PRIMARY, SECOND])).toEqual(saved);
  });

  it('falls back when the monitor the window was on is unplugged', () => {
    expect(fitToDisplays(state(2200, 100, 1400, 900), [PRIMARY])).toBeNull();
  });

  it('falls back when only a sliver would be visible', () => {
    // 50 px of width on screen is not enough title bar to grab.
    expect(fitToDisplays(state(1870, 100, 1400, 900), [PRIMARY])).toBeNull();
  });

  it('pulls a partly off-screen window fully back inside the monitor', () => {
    expect(fitToDisplays(state(-300, -50, 1200, 800), [PRIMARY])).toEqual(state(0, 0, 1200, 800));
  });

  it('shrinks a window larger than the monitor after a resolution change', () => {
    const small = { x: 0, y: 0, width: 1366, height: 728 };
    expect(fitToDisplays(state(0, 0, 2400, 1300), [small])).toEqual(state(0, 0, 1366, 728));
  });

  it('never shrinks below the minimum size when the monitor has room', () => {
    const fitted = fitToDisplays(state(0, 0, 400, 300), [PRIMARY]);
    expect(fitted?.bounds.width).toBe(MIN_SIZE.width);
    expect(fitted?.bounds.height).toBe(MIN_SIZE.height);
  });

  it('chooses the monitor holding most of a window that spans two', () => {
    const fitted = fitToDisplays(state(1700, 100, 1200, 800), [PRIMARY, SECOND]);
    // 980 px of the width is on SECOND versus 220 on PRIMARY, so it lands on SECOND.
    expect(fitted?.bounds.x).toBe(SECOND.x);
  });
});

describe('loadWindowState / saveWindowState', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('window-state-');
  });

  afterEach(() => {
    cleanup(dir);
  });

  it('round-trips through the file', () => {
    const file = join(dir, 'window-state.json');
    const saved = state(50, 60, 1300, 850, true);
    saveWindowState(file, saved);
    expect(loadWindowState(file)).toEqual(saved);
  });

  it('returns null when no state has been saved yet', () => {
    expect(loadWindowState(join(dir, 'missing.json'))).toBeNull();
  });

  it('returns null for a corrupt file instead of throwing', () => {
    const file = join(dir, 'window-state.json');
    writeFileSync(file, '{"bounds": {"x": 1,');
    expect(loadWindowState(file)).toBeNull();
  });

  it('does not throw when the file cannot be written', () => {
    expect(() => saveWindowState(join(dir, 'no-such-dir', 'state.json'), state(0, 0, 1000, 700))).not.toThrow();
  });
});
