import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AudioFile, Destination } from '../../shared/types';
import { destinationLabels } from '../services/destinations';

export interface ContextMenuTarget {
  file: AudioFile;
  x: number;
  y: number;
}

interface Props {
  target: ContextMenuTarget;
  /** The rows this menu's commands will act on: the selection, or just the clicked row. */
  targetIds: number[];
  destinations: Destination[];
  activeDestination: Destination | null;
  onClose: () => void;
  onShowInFolder: (file: AudioFile) => void;
  onCopyPath: (file: AudioFile) => void;
  onCopyFile: (file: AudioFile) => void;
  onCopyTo: (fileIds: number[], destinationPath: string) => void;
  onCopyToChosenFolder: (fileIds: number[]) => void;
  onToggleFavorite: (file: AudioFile) => void;
}

export function ContextMenu(props: Props) {
  const { target, targetIds, destinations, activeDestination, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => destinationLabels(destinations), [destinations]);
  const [position, setPosition] = useState({ x: target.x, y: target.y });

  // Keep the menu on screen when opened near the right or bottom edge.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      x: Math.min(target.x, window.innerWidth - width - 8),
      y: Math.min(target.y, window.innerHeight - height - 8),
    });
  }, [target.x, target.y]);

  useEffect(() => {
    // Capture phase runs before the event reaches the menu, so this must check the target
    // itself: stopPropagation inside the menu would come too late, and closing on mousedown
    // would unmount the button before its click could fire.
    const dismiss = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    // Capture beats the row handlers underneath, so a click outside just closes the menu.
    window.addEventListener('mousedown', dismiss, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', dismiss, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const file = target.file;
  const count = targetIds.length;
  const many = count > 1;
  /** "3 files" or the single filename, so every label says exactly what will happen. */
  const subject = many ? `${count} files` : file.filename;

  return (
    <div
      className="context-menu"
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {many && <div className="label">{count} selected</div>}

      <button
        className="primary-item"
        disabled={!activeDestination}
        title={
          activeDestination
            ? `Copy ${subject} to ${activeDestination.path}`
            : 'Set a destination in the toolbar first'
        }
        onClick={run(() => activeDestination && props.onCopyTo(targetIds, activeDestination.path))}
      >
        <span>
          {activeDestination
            ? `Copy ${subject} to ${labels.get(activeDestination.id) ?? activeDestination.name}`
            : 'Copy to Destination'}
        </span>
        <span className="shortcut">Ctrl+Shift+C</span>
      </button>

      <button onClick={run(() => props.onCopyToChosenFolder(targetIds))}>
        Copy {subject} to folder…
      </button>

      {destinations.length > 0 && <hr />}
      {destinations.length > 0 && <div className="label">Copy To</div>}
      {destinations
        .filter((destination) => destination.id !== activeDestination?.id)
        .map((destination) => (
          <button
            key={destination.id}
            title={destination.path}
            onClick={run(() => props.onCopyTo(targetIds, destination.path))}
          >
            {labels.get(destination.id) ?? destination.name}
          </button>
        ))}

      <hr />

      {/* These act on the clicked row only: revealing or copying a path is meaningless
          for a multi-row selection. */}
      <button onClick={run(() => props.onShowInFolder(file))}>Show in Folder</button>
      <button onClick={run(() => props.onCopyPath(file))}>
        Copy Path <span className="shortcut">Ctrl+C</span>
      </button>
      <button onClick={run(() => props.onCopyFile(file))}>Copy File</button>

      <hr />
      <button onClick={run(() => props.onToggleFavorite(file))}>
        {file.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
      </button>
    </div>
  );
}
