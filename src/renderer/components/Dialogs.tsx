import { useEffect } from 'react';
import type { CopyConflict, DuplicateStrategy } from '../../shared/types';

/* ------------------------------------------------------------------ overlay */

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- duplicate prompt */

interface ConflictProps {
  conflicts: CopyConflict[];
  /** How many files in the same batch copied cleanly before the collisions. */
  alreadyCopied: number;
  onResolve: (strategy: DuplicateStrategy) => void;
}

/**
 * Shown only when a copy would overwrite something. A destination file is never replaced
 * without the user choosing to, and one answer covers the whole batch.
 */
export function ConflictDialog({ conflicts, alreadyCopied, onResolve }: ConflictProps) {
  const many = conflicts.length > 1;
  const first = conflicts[0];

  return (
    <Overlay onClose={() => onResolve('cancel')}>
      <h3>{many ? `${conflicts.length} files already exist` : 'File already exists'}</h3>

      {many ? (
        <>
          <p>
            These files are already in that folder:
          </p>
          <div className="destination-list">
            {conflicts.slice(0, 8).map((conflict) => (
              <div className="item" key={conflict.fileId}>
                <div className="meta">
                  <div>{conflict.filename}</div>
                  <div className="path">renames to {conflict.suggestedName}</div>
                </div>
              </div>
            ))}
            {conflicts.length > 8 && (
              <div className="item">
                <span style={{ color: 'var(--text-faint)' }}>
                  and {conflicts.length - 8} more…
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <p>
          <strong>{first.filename}</strong> is already in that folder:
          <br />
          {first.destinationFile}
        </p>
      )}

      {alreadyCopied > 0 && (
        <p style={{ marginTop: 10 }}>
          {alreadyCopied} other {alreadyCopied === 1 ? 'file was' : 'files were'} copied
          successfully.
        </p>
      )}

      <div className="buttons">
        <button onClick={() => onResolve('cancel')}>
          {many ? 'Skip all' : 'Cancel'}
        </button>
        <button onClick={() => onResolve('overwrite')}>
          {many ? 'Overwrite all' : 'Overwrite'}
        </button>
        <button className="primary" onClick={() => onResolve('rename')}>
          {many ? 'Keep both (rename all)' : `Keep both (${first.suggestedName})`}
        </button>
      </div>
    </Overlay>
  );
}

/* ----------------------------------------------------------------- confirm */

interface ConfirmProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Overlay onClose={onCancel}>
      <h3>{title}</h3>
      <p>{message}</p>
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}
