import type { Library, ScanProgress } from '../../shared/types';
import { formatCount } from '../services/format';

interface Props {
  libraries: Library[];
  scans: Map<number, ScanProgress>;
  selectedIds: number[];
  favoritesOnly: boolean;
  totalIndexed: number;
  onSelect: (libraryId: number | null, additive: boolean) => void;
  onToggleFavorites: () => void;
  onAdd: () => void;
  onRescan: (id: number) => void;
  onRemove: (library: Library) => void;
  onOpenFolder: (id: number) => void;
}

export function LibrarySidebar(props: Props) {
  const {
    libraries,
    scans,
    selectedIds,
    favoritesOnly,
    totalIndexed,
    onSelect,
    onToggleFavorites,
    onAdd,
    onRescan,
    onRemove,
    onOpenFolder,
  } = props;

  return (
    <aside className="sidebar">
      <div className="section-title">Libraries</div>

      <div
        className={`library-row ${selectedIds.length === 0 && !favoritesOnly ? 'selected' : ''}`}
        onClick={() => onSelect(null, false)}
      >
        <span className="name">All Audio</span>
        <span className="count">{formatCount(totalIndexed)}</span>
      </div>

      <div
        className={`library-row ${favoritesOnly ? 'selected' : ''}`}
        onClick={onToggleFavorites}
        title="Show only assets you have starred"
      >
        <span className="name">★ Favorites</span>
      </div>

      {libraries.map((library) => {
        const scan = scans.get(library.id);
        return (
          <div
            key={library.id}
            className={[
              'library-row',
              selectedIds.includes(library.id) ? 'selected' : '',
              library.available ? '' : 'unavailable',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(event) => onSelect(library.id, event.ctrlKey || event.metaKey)}
            title={library.available ? library.path : `${library.path}\n(unavailable)`}
          >
            <span className="name">{library.name}</span>

            {scan ? (
              <span className="count">{formatCount(scan.indexed + scan.skipped)}…</span>
            ) : (
              <span className="count">{formatCount(library.fileCount)}</span>
            )}

            <span className="actions" onClick={(event) => event.stopPropagation()}>
              <button
                className="ghost"
                title="Rescan this library"
                disabled={Boolean(scan)}
                onClick={() => onRescan(library.id)}
              >
                ⟳
              </button>
              <button
                className="ghost"
                title="Open this folder"
                onClick={() => onOpenFolder(library.id)}
              >
                ⧉
              </button>
              <button
                className="ghost"
                title="Remove from the application (your files are not deleted)"
                onClick={() => onRemove(library)}
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}

      <div className="sidebar-footer">
        <button onClick={onAdd}>+ Add Library</button>
      </div>
    </aside>
  );
}
