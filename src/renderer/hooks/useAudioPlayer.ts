import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioFile } from '../../shared/types';
import { api, errorMessage, unwrap } from '../services/api';

export interface PlayerState {
  fileId: number | null;
  filename: string | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  loop: boolean;
  error: string | null;
}

export interface UseAudioPlayer extends PlayerState {
  play: (file: AudioFile) => void;
  toggle: (file: AudioFile) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setLoop: (loop: boolean) => void;
}

/**
 * Every launch starts at full volume; the slider is a per-session adjustment and is
 * deliberately not persisted, so a level left low last time cannot make previews seem silent.
 */
const INITIAL_VOLUME = 1;

/** Loop is a listening mode, not a level, so unlike volume it is remembered. */
const LOOP_KEY = 'audioBrowser.loop';

export function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable; the toggle still works for this session.
  }
}

/**
 * A single shared HTMLAudioElement drives all preview playback.
 *
 * Reusing one element is what makes rapid auditioning feel instant: starting a new sound
 * just swaps the source, which implicitly stops whatever was playing. Audio is streamed
 * over the custom `audio-asset:` protocol, so the renderer never handles a file path.
 */
export function useAudioPlayer(): UseAudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Identifies the most recent play request so a slow URL lookup cannot revive a sound the
  // user has already moved past.
  const requestRef = useRef(0);

  const [state, setState] = useState<PlayerState>({
    fileId: null,
    filename: null,
    playing: false,
    position: 0,
    duration: 0,
    volume: INITIAL_VOLUME,
    loop: loadFlag(LOOP_KEY),
    error: null,
  });

  if (audioRef.current === null && typeof Audio !== 'undefined') {
    const element = new Audio();
    element.preload = 'auto';
    element.volume = INITIAL_VOLUME;
    // Survives src swaps, so every sound auditioned while it is on repeats.
    element.loop = loadFlag(LOOP_KEY);
    audioRef.current = element;
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setState((s) => ({ ...s, position: audio.currentTime }));
    const onMeta = () =>
      setState((s) => ({
        ...s,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      }));
    const onEnded = () => setState((s) => ({ ...s, playing: false, position: 0 }));
    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    const onError = () =>
      setState((s) => ({
        ...s,
        playing: false,
        error: 'That file could not be played. It may be missing or use an unsupported codec.',
      }));

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
    };
  }, []);

  const play = useCallback((file: AudioFile) => {
    const audio = audioRef.current;
    if (!audio) return;

    const requestId = ++requestRef.current;
    setState((s) => ({
      ...s,
      fileId: file.id,
      filename: file.filename,
      position: 0,
      duration: file.duration ?? 0,
      error: null,
    }));

    void (async () => {
      try {
        const url = await unwrap(api.getPlaybackUrl(file.id));
        if (requestId !== requestRef.current) return;

        audio.src = url;
        audio.currentTime = 0;
        await audio.play();
      } catch (error) {
        if (requestId !== requestRef.current) return;
        // A play() rejection from an interrupted load is normal when auditioning quickly.
        if ((error as Error)?.name === 'AbortError') return;
        setState((s) => ({ ...s, playing: false, error: errorMessage(error) }));
      }
    })();
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    void audio.play().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    requestRef.current++;
    audio.pause();
    audio.currentTime = 0;
    setState((s) => ({ ...s, playing: false, position: 0 }));
  }, []);

  /** Space-bar behaviour: restart a different asset, otherwise pause/resume this one. */
  const toggle = useCallback(
    (file: AudioFile) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (state.fileId !== file.id) {
        play(file);
        return;
      }
      if (audio.paused) resume();
      else stop();
    },
    [state.fileId, play, resume, stop],
  );

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
  }, []);

  const setVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(volume, 1));
    if (audioRef.current) audioRef.current.volume = clamped;
    setState((s) => ({ ...s, volume: clamped }));
  }, []);

  const setLoop = useCallback((loop: boolean) => {
    if (audioRef.current) audioRef.current.loop = loop;
    saveFlag(LOOP_KEY, loop);
    setState((s) => ({ ...s, loop }));
  }, []);

  return { ...state, play, toggle, pause, resume, stop, seek, setVolume, setLoop };
}
