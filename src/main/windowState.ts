import { readFileSync, writeFileSync } from 'node:fs';
import type { Rectangle } from 'electron';
import { createLogger } from './logger';

const log = createLogger('window');

export interface WindowState {
  /** The un-maximized bounds, so restoring a maximized window has somewhere to return to. */
  bounds: Rectangle;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1400, height: 900 } as const;
export const MIN_SIZE = { width: 900, height: 560 } as const;

/**
 * How much of the window must overlap a monitor for the saved position to count as
 * reachable: enough of the title bar to grab and drag.
 */
const MIN_VISIBLE = { width: 120, height: 40 } as const;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Validates untrusted JSON; anything malformed yields null, never a half-built state. */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { bounds, maximized } = raw as Record<string, unknown>;
  if (typeof bounds !== 'object' || bounds === null) return null;
  const { x, y, width, height } = bounds as Record<string, unknown>;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return {
    bounds: {
      x: Math.round(x as number),
      y: Math.round(y as number),
      width: Math.round(width as number),
      height: Math.round(height as number),
    },
    maximized: maximized === true,
  };
}

function overlap(a: Rectangle, b: Rectangle): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

/**
 * Fits saved bounds to the monitors connected now. A window last shown on a monitor that
 * has since been unplugged returns null (so the caller falls back to a centered default)
 * instead of opening somewhere the user cannot see or reach. A window larger than its
 * monitor's work area — after a resolution change, say — is shrunk and pulled inside it.
 */
export function fitToDisplays(state: WindowState, workAreas: Rectangle[]): WindowState | null {
  let best: Rectangle | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const o = overlap(state.bounds, area);
    if (o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height && o.width * o.height > bestArea) {
      best = area;
      bestArea = o.width * o.height;
    }
  }
  if (!best) return null;

  const width = Math.max(Math.min(state.bounds.width, best.width), Math.min(MIN_SIZE.width, best.width));
  const height = Math.max(Math.min(state.bounds.height, best.height), Math.min(MIN_SIZE.height, best.height));
  const x = Math.min(Math.max(state.bounds.x, best.x), best.x + best.width - width);
  const y = Math.min(Math.max(state.bounds.y, best.y), best.y + best.height - height);
  return { bounds: { x, y, width, height }, maximized: state.maximized };
}

/** Missing or corrupt files are normal (first launch, a crash mid-write) and yield null. */
export function loadWindowState(file: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('ignoring unreadable window state', (error as Error).message);
    }
    return null;
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch (error) {
    // Losing the window position is harmless; it must never block closing the app.
    log.warn('could not save window state', (error as Error).message);
  }
}
