/** Display formatting helpers. Pure functions, kept out of the components. */

/** `0:01.24` style, which reads better than seconds for short sound effects. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--';

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  const whole = Math.floor(remainder);
  const hundredths = Math.floor((remainder - whole) * 100);

  return `${minutes}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** `0:04` style for the transport clock, where hundredths would just flicker. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds - minutes * 60)).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSampleRate(hz: number | null): string {
  if (hz === null) return '--';
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}k`;
}

export function formatChannels(channels: number | null): string {
  if (channels === null) return '--';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels}ch`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

/** Turns `Combat/Punches/Heavy/x.wav` into `Combat / Punches / Heavy`. */
export function formatFolder(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.length === 0 ? '.' : parts.join(' / ');
}
