import type { ScanProgress } from '../../shared/types';
import { formatCount } from '../services/format';

interface Props {
  total: number;
  shown: number;
  selectedCount: number;
  elapsedMs: number;
  loading: boolean;
  scans: ScanProgress[];
  error: string | null;
  onCancelScan: (libraryId: number) => void;
}

function describeScan(scan: ScanProgress): string {
  switch (scan.phase) {
    case 'discovering':
      return `Scanning ${scan.libraryName} — ${formatCount(scan.discovered)} files discovered`;
    case 'indexing':
      return (
        `Indexing ${scan.libraryName} — ${formatCount(scan.indexed + scan.skipped)} of ` +
        `${formatCount(scan.discovered)}`
      );
    case 'pruning':
      return `Tidying up ${scan.libraryName}…`;
    case 'error':
      return `${scan.libraryName}: ${scan.message ?? 'scan failed'}`;
    default:
      return scan.libraryName;
  }
}

export function StatusBar({
  total,
  shown,
  selectedCount,
  elapsedMs,
  loading,
  scans,
  error,
  onCancelScan,
}: Props) {
  const scan = scans[0];
  const progress =
    scan && scan.discovered > 0
      ? Math.min((scan.indexed + scan.skipped) / scan.discovered, 1)
      : 0;

  return (
    <div className="statusbar">
      <span>
        {formatCount(total)} {total === 1 ? 'result' : 'results'}
        {shown < total ? ` · ${formatCount(shown)} loaded` : ''}
      </span>

      {selectedCount > 1 && <span className="selected-count">{formatCount(selectedCount)} selected</span>}

      {!loading && total > 0 && <span>{elapsedMs} ms</span>}
      {loading && <span>searching…</span>}

      <span className="spacer" />

      {error && <span className="error">{error}</span>}

      {scan && (
        <>
          <span className="scanning">{describeScan(scan)}</span>
          {scan.phase === 'indexing' && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
          {scan.failed > 0 && <span>{formatCount(scan.failed)} skipped</span>}
          <button className="ghost" onClick={() => onCancelScan(scan.libraryId)}>
            cancel
          </button>
        </>
      )}

      {scans.length > 1 && <span>+{scans.length - 1} more scanning</span>}
    </div>
  );
}
