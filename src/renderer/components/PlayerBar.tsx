import type { MouseEvent } from 'react';
import type { UseAudioPlayer } from '../hooks/useAudioPlayer';
import { useWaveform } from '../hooks/useWaveform';
import { Waveform } from './Waveform';
import { formatClock } from '../services/format';

interface Props {
  player: UseAudioPlayer;
  autoPlay: boolean;
  onToggleAutoPlay: () => void;
}

/**
 * Transport for the current preview. Kept as a persistent bar rather than a separate
 * window so auditioning never costs a click to open or close.
 */
export function PlayerBar({ player, autoPlay, onToggleAutoPlay }: Props) {
  const { filename, playing, position, duration, volume, loop } = player;
  const waveform = useWaveform(player.fileId);
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const scrub = (event: MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    player.seek(ratio * duration);
  };

  return (
    <div className="player">
      {/* Like the mode buttons below, transport buttons never take focus from a click. */}
      <div className="transport" onMouseDown={(event) => event.preventDefault()}>
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

      {/* Mode buttons never take focus: Space and Enter must keep auditioning the focused
          row rather than re-pressing whichever toggle was clicked last. */}
      <div className="modes" onMouseDown={(event) => event.preventDefault()}>
        <button
          aria-pressed={autoPlay}
          onClick={onToggleAutoPlay}
          title={
            autoPlay
              ? 'Auto-play is on: arrow keys play each sound as you reach it'
              : 'Auto-play: play each sound as you move to it with the arrow keys'
          }
        >
          Auto
        </button>
        <button
          aria-pressed={loop}
          onClick={() => player.setLoop(!loop)}
          title={loop ? 'Loop is on: sounds repeat until stopped' : 'Loop: repeat sounds until stopped'}
        >
          Loop
        </button>
      </div>

      <div className="now-playing">
        {filename ? <strong>{filename}</strong> : <span>Nothing playing</span>}
      </div>

      {/* The waveform doubles as the progress bar. Until it is ready (or for a file that
          cannot be decoded) the plain bar stands in, so seeking always works. */}
      <div className="scrub" onMouseDown={scrub} title="Seek">
        {waveform.peaks ? (
          <Waveform peaks={waveform.peaks} progress={progress} />
        ) : (
          <div className="scrub-track">
            <div className="scrub-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
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
