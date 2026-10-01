import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { AudioFile, SortDirection, SortField } from '../../shared/types';
import {
  formatChannels,
  formatDuration,
  formatFileSize,
  formatFolder,
  formatSampleRate,
} from '../services/format';

interface Props {
  items: AudioFile[];
  total: number;
  loading: boolean;
  /** Every selected row. Commands act on all of them. */
  selected: ReadonlySet<number>;
  /** The keyboard cursor: the row Space and Enter act on. */
  cursorId: number | null;
  playingId: number | null;
  isPlaying: boolean;
  sortField: SortField;
  sortDirection: SortDirection;
  hasLibraries: boolean;
  onSort: (field: SortField) => void;
  onSelect: (file: AudioFile, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onActivate: (file: AudioFile) => void;
  onContextMenu: (file: AudioFile, x: number, y: number) => void;
  onToggleFavorite: (file: AudioFile) => void;
  onLoadMore: () => void;
  /** Set by the parent so keyboard navigation can scroll the selection into view. */
  scrollToIndex: number | null;
}

const ROW_HEIGHT = 26;
/** Rows rendered beyond the viewport, so fast scrolling does not show blank space. */
const OVERSCAN = 12;
/** Fetch the next page once the user is within this many rows of the end. */
const PREFETCH_ROWS = 40;

const COLUMNS: Array<{ field: SortField | null; label: string; className?: string }> = [
  { field: null, label: '' },
  { field: 'filename', label: 'Name' },
  { field: null, label: 'Folder' },
  { field: 'duration', label: 'Length', className: 'num' },
  { field: null, label: 'Type' },
  { field: null, label: 'Rate' },
  { field: null, label: 'Ch' },
  { field: 'fileSize', label: 'Size', className: 'num' },
];

/**
 * A dense, virtualized result list.
 *
 * Only the visible rows exist in the DOM, so a 100k-row result set costs the same as a
 * 100-row one.
 */
export function ResultsTable(props: Props) {
  const {
    items,
    total,
    loading,
    selected,
    cursorId,
    playingId,
    isPlaying,
    sortField,
    sortDirection,
    hasLibraries,
    onSort,
    onSelect,
    onActivate,
    onContextMenu,
    onToggleFavorite,
    onLoadMore,
    scrollToIndex,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Pull the next page as the end of the loaded range comes into view.
  const last = virtualRows[virtualRows.length - 1];
  useEffect(() => {
    if (!last) return;
    if (last.index >= items.length - PREFETCH_ROWS) onLoadMore();
  }, [last, items.length, onLoadMore]);

  useEffect(() => {
    if (scrollToIndex === null) return;
    virtualizer.scrollToIndex(scrollToIndex, { align: 'auto' });
  }, [scrollToIndex, virtualizer]);

  if (items.length === 0 && !loading) {
    return (
      <div className="results">
        <Header sortField={sortField} sortDirection={sortDirection} onSort={onSort} />
        <div className="empty-state">
          {hasLibraries ? (
            <>
              <h3>No matching assets</h3>
              <span>Try fewer words, or clear a filter.</span>
            </>
          ) : (
            <>
              <h3>No libraries yet</h3>
              <span>Add a folder of audio assets to start indexing.</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="results">
      <Header sortField={sortField} sortDirection={sortDirection} onSort={onSort} />

      <div className="results-scroll" ref={scrollRef} tabIndex={-1}>
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualRows.map((virtualRow) => {
            const file = items[virtualRow.index];
            if (!file) return null;

            const isSelected = selected.has(file.id);
            const isCursor = file.id === cursorId;
            const isCurrent = file.id === playingId;

            return (
              <div
                key={file.id}
                className={[
                  'result-row',
                  isSelected ? 'selected' : '',
                  isCursor ? 'cursor' : '',
                  isCurrent ? 'playing' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ height: ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
                onMouseDown={(event) => {
                  // Right-button mousedown fires before contextmenu; selecting here would
                  // collapse a multi-row selection before the menu could act on it.
                  // onContextMenu below owns right-click selection.
                  if (event.button !== 0) return;
                  // The play and star buttons are mouse targets only. Left to the browser
                  // they keep focus, and the next keypress draws a focus ring around them;
                  // the list itself takes focus instead, exactly as clicking the row does.
                  if ((event.target as HTMLElement).closest('button')) {
                    event.preventDefault();
                    scrollRef.current?.focus({ preventScroll: true });
                  }
                  onSelect(file, event);
                }}
                onDoubleClick={() => onActivate(file)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  // Right-clicking outside the current selection moves it to this row;
                  // right-clicking inside it leaves the multi-row selection alone.
                  if (!selected.has(file.id)) {
                    onSelect(file, { ctrlKey: false, metaKey: false, shiftKey: false });
                  }
                  onContextMenu(file, event.clientX, event.clientY);
                }}
                title={file.absolutePath}
              >
                <span className="play-cell">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onActivate(file);
                    }}
                    title={isCurrent && isPlaying ? 'Stop' : 'Play'}
                  >
                    {isCurrent && isPlaying ? '■' : '▶'}
                  </button>
                </span>

                <span className="filename">
                  <button
                    className={`star ${file.favorite ? 'on' : ''}`}
                    title={file.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(file);
                    }}
                  >
                    {file.favorite ? '★' : '☆'}
                  </button>{' '}
                  {file.filename}
                </span>

                {/* RTL direction keeps the deepest, most identifying folder visible when
                    a long path has to be truncated. */}
                <span className="folder">{formatFolder(file.relativePath)}</span>
                <span className="num">{formatDuration(file.duration)}</span>
                <span className="tag">{file.extension.slice(1)}</span>
                <span className="num">{formatSampleRate(file.sampleRate)}</span>
                <span className="tag">{formatChannels(file.channels)}</span>
                <span className="num">{formatFileSize(file.fileSize)}</span>
              </div>
            );
          })}
        </div>

        {items.length < total && (
          <div style={{ padding: '6px 10px', color: 'var(--text-faint)', fontSize: 11 }}>
            Loading more…
          </div>
        )}
      </div>
    </div>
  );
}

function Header({
  sortField,
  sortDirection,
  onSort,
}: Pick<Props, 'sortField' | 'sortDirection' | 'onSort'>) {
  const arrow = sortDirection === 'asc' ? '▲' : '▼';

  return (
    <div className="results-header">
      {COLUMNS.map((column, index) => {
        if (!column.field) {
          return (
            <span key={index} className={column.className}>
              {column.label}
            </span>
          );
        }
        const active = sortField === column.field;
        return (
          <span
            key={index}
            className={`sortable ${column.className ?? ''} ${active ? 'active' : ''}`}
            onClick={() => onSort(column.field as SortField)}
          >
            {column.label} {active ? arrow : ''}
          </span>
        );
      })}
    </div>
  );
}
