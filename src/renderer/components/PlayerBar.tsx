import type { MouseEvent } from 'react';
import type { UseAudioPlayer } from '../hooks/useAudioPlayer';
import { formatClock } from '../services/format';

interface Props {
  player: UseAudioPlayer;
}

/**
 * Transport for the current preview. Kept as a persistent bar rather than a separate
 * window so auditioning never costs a click to open or close.
 */
export function PlayerBar({ player }: Props) {
  const { filename, playing, position, duration, volume } = player;
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const scrub = (event: MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    player.seek(ratio * duration);
  };

  return (
    <div className="player">
      <div className="transport">
        <button
          onClick={() => (playing ? player.pause() : player.resume())}
          disabled={!filename}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={player.stop} disabled={!filename} title="Stop">
          ■
        </button>
      </div>

      <div className="now-playing">
        {filename ? <strong>{filename}</strong> : <span>Nothing playing</span>}
      </div>

      {/* Reserved for the waveform: the same slot will render peak data once it is
          generated lazily, without changing this layout. */}
      <div className="scrub" onMouseDown={scrub} title="Seek">
        <div className="scrub-track">
          <div className="scrub-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <span className="time">
        {formatClock(position)} / {formatClock(duration)}
      </span>

      <div className="volume">
        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>VOL</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          title={`Volume ${Math.round(volume * 100)}%`}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
