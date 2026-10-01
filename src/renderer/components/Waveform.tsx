import { useEffect, useMemo, useRef, useState } from 'react';
import { columnPeak, displayGain } from '../services/waveform';

interface Props {
  peaks: number[];
  /** Playback position as a fraction of the duration, 0-1. */
  progress: number;
}

/**
 * Draws a sound's peaks into the player bar's scrub slot. The part already played is drawn
 * in the accent colour, the rest dimmed, so it doubles as the progress bar. Seeking is
 * handled by the parent slot, exactly as for the plain bar this replaces.
 */
export function Waveform({ peaks, progress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gain = useMemo(() => displayGain(peaks), [peaks]);

  // Track the slot's size so the canvas stays sharp when the window is resized.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || size.width === 0 || size.height === 0) return;

    // Draw in device pixels, so a column is one physical pixel on a scaled display.
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(size.width * ratio);
    const height = Math.round(size.height * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const styles = getComputedStyle(canvas);
    const played = styles.getPropertyValue('--accent').trim() || '#4d9fff';
    const unplayed = styles.getPropertyValue('--text-faint').trim() || '#666';

    context.clearRect(0, 0, width, height);
    const middle = height / 2;
    const playedColumns = Math.round(Math.min(Math.max(progress, 0), 1) * width);

    for (let x = 0; x < width; x++) {
      const amplitude = Math.min(columnPeak(peaks, x, width) * gain, 1);
      // Never thinner than one pixel, so silence still reads as a line, not a gap.
      const half = Math.max(amplitude * middle, ratio / 2);
      context.fillStyle = x < playedColumns ? played : unplayed;
      context.fillRect(x, middle - half, 1, half * 2);
    }
  }, [peaks, gain, progress, size]);

  return <canvas ref={canvasRef} className="waveform" />;
}
