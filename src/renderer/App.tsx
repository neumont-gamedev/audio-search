import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioFile, CopyConflict, DuplicateStrategy, Library } from '../shared/types';
import { ContextMenu, type ContextMenuTarget } from './components/ContextMenu';
import { ConfirmDialog, ConflictDialog } from './components/Dialogs';
import { DestinationPicker } from './components/DestinationPicker';
import { FilterPanel } from './components/FilterPanel';
import { LibrarySidebar } from './components/LibrarySidebar';
import { PlayerBar } from './components/PlayerBar';
import { ResultsTable } from './components/ResultsTable';
import { SearchBar } from './components/SearchBar';
import { StatusBar } from './components/StatusBar';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useLibraries } from './hooks/useLibraries';
import { EMPTY_FILTERS, useSearch } from './hooks/useSearch';
import { useToasts } from './hooks/useToasts';
import { api, errorMessage, unwrap } from './services/api';
import {
  actionTargets,
  applyClick,
  EMPTY_SELECTION,
  modifierFor,
  moveCursor,
  reconcile,
  selectAll,
  type SelectionState,
} from './services/selection';

/** A copy paused on collisions, waiting for the user to say what to do about them. */
interface PendingCopy {
  conflicts: CopyConflict[];
  destinationPath: string;
  alreadyCopied: number;
}

const ACTIVE_DESTINATION_KEY = 'audioBrowser.activeDestination';

export function App() {
  const search = useSearch();
  const player = useAudioPlayer();
  const toasts = useToasts();

  const libraries = useLibraries(search.refresh);

  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [showFilters, setShowFilters] = useState(true);
  const [menuTarget, setMenuTarget] = useState<ContextMenuTarget | null>(null);
  const [pendingCopy, setPendingCopy] = useState<PendingCopy | null>(null);
  const [libraryToRemove, setLibraryToRemove] = useState<Library | null>(null);
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null);
  const [activeDestinationId, setActiveDestinationId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(ACTIVE_DESTINATION_KEY));
    return Number.isInteger(stored) && stored > 0 ? stored : null;
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  const items = search.items;
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const cursorFile = selection.cursorId === null ? null : (byId.get(selection.cursorId) ?? null);

  const activeDestination = useMemo(
    () => libraries.destinations.find((d) => d.id === activeDestinationId) ?? null,
    [libraries.destinations, activeDestinationId],
  );

  const totalIndexed = useMemo(
    () => libraries.libraries.reduce((sum, library) => sum + library.fileCount, 0),
    [libraries.libraries],
  );

  const activeFilterCount = useMemo(() => {
    const { filters } = search;
    return (
      filters.extensions.length +
      filters.durationBuckets.length +
      filters.channels.length +
      filters.sampleRates.length +
      (filters.durationRange ? 1 : 0) +
      (filters.favoritesOnly ? 1 : 0)
    );
  }, [search]);

  /* ------------------------------------------------------------- selection */

  // Keep the selection meaningful as results change underneath the user.
  useEffect(() => {
    setSelection((previous) => reconcile(previous, ids));
  }, [ids]);

  useEffect(() => {
    if (activeDestinationId === null) localStorage.removeItem(ACTIVE_DESTINATION_KEY);
    else localStorage.setItem(ACTIVE_DESTINATION_KEY, String(activeDestinationId));
  }, [activeDestinationId]);

  // A destination that has been deleted must not stay selected.
  useEffect(() => {
    if (activeDestinationId !== null && !activeDestination) setActiveDestinationId(null);
  }, [activeDestinationId, activeDestination]);

  const handleRowSelect = useCallback(
    (file: AudioFile, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      setSelection((previous) => applyClick(previous, ids, file.id, modifierFor(event)));
    },
    [ids],
  );

  const navigate = useCallback(
    (delta: number, extend: boolean) => {
      setSelection((previous) => {
        const next = moveCursor(previous, ids, delta, extend);
        if (next.cursorId !== null) {
          const index = ids.indexOf(next.cursorId);
          if (index >= 0) {
            setScrollToIndex(index);
            // Cleared so the same index can be requested again later.
            requestAnimationFrame(() => setScrollToIndex(null));
          }
        }
        return next;
      });
    },
    [ids],
  );

  /* --------------------------------------------------------- file actions */

  const withFeedback = useCallback(
    async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        toasts.error(errorMessage(error));
      }
    },
    [toasts],
  );

  const showInFolder = useCallback(
    (file: AudioFile) => void withFeedback(() => unwrap(api.showInFolder(file.id))),
    [withFeedback],
  );

  const copyPath = useCallback(
    (file: AudioFile) =>
      void withFeedback(async () => {
        await unwrap(api.copyPath(file.id));
        toasts.success('Path copied.');
      }),
    [withFeedback, toasts],
  );

  const copyFile = useCallback(
    (file: AudioFile) =>
      void withFeedback(async () => {
        await unwrap(api.copyFileToClipboard(file.id));
        toasts.success(`${file.filename} copied to the clipboard.`);
      }),
    [withFeedback, toasts],
  );

  /**
   * Copies files to a folder, pausing on collisions so the user can decide once for the
   * whole batch. `alreadyCopied` carries the count forward across that round trip.
   */
  const copyFiles = useCallback(
    (
      fileIds: number[],
      destinationPath: string,
      strategy?: DuplicateStrategy,
      alreadyCopied = 0,
    ) =>
      void withFeedback(async () => {
        if (fileIds.length === 0) return;

        const result = await unwrap(
          api.copyToDestination({ fileIds, destinationPath, strategy }),
        );
        const copied = alreadyCopied + result.copied.length;

        if (result.conflicts.length > 0) {
          setPendingCopy({
            conflicts: result.conflicts,
            destinationPath,
            alreadyCopied: copied,
          });
          return;
        }

        for (const failure of result.errors) {
          toasts.error(`${failure.filename}: ${failure.message}`);
        }

        if (copied > 0) {
          const where = destinationPath.split('/').pop() ?? destinationPath;
          toasts.success(
            copied === 1
              ? `Copied ${result.copied.length === 1 ? byId.get(result.copied[0].fileId)?.filename ?? '1 file' : '1 file'} → ${where}`
              : `Copied ${copied} files → ${where}`,
          );
        } else if (result.errors.length === 0 && result.cancelled > 0) {
          toasts.info(`Skipped ${result.cancelled} existing ${result.cancelled === 1 ? 'file' : 'files'}.`);
        }
      }),
    [withFeedback, toasts, byId],
  );

  const copyToChosenFolder = useCallback(
    async (fileIds: number[]) => {
      const destination = await libraries.chooseFolder('Copy assets to folder');
      if (destination) copyFiles(fileIds, destination);
    },
    [libraries, copyFiles],
  );

  /** Copies the current selection to the destination chosen in the toolbar. */
  const copySelectionToActive = useCallback(() => {
    if (!activeDestination) {
      toasts.info('Choose a destination in the toolbar first.');
      return;
    }
    const fileIds = [...selection.selected];
    if (fileIds.length === 0) return;
    copyFiles(fileIds, activeDestination.path);
  }, [activeDestination, selection.selected, copyFiles, toasts]);

  const toggleFavorite = useCallback(
    (file: AudioFile) =>
      void withFeedback(async () => {
        await unwrap(api.setFavorite(file.id, !file.favorite));
        search.patchItem(file.id, { favorite: !file.favorite });
      }),
    [withFeedback, search],
  );

  /* ---------------------------------------------------------- destinations */

  const chooseDestinationFolder = useCallback(async () => {
    const path = await libraries.chooseFolder('Select a project destination folder');
    if (!path) return;
    const name = path.split('/').pop() || path;
    await libraries.addDestination(name, path);

    // Adopt the folder just picked, which is almost always what the user wants next.
    const refreshed = await unwrap(api.listDestinations()).catch(() => []);
    const match = refreshed.find((destination) => destination.path === path);
    if (match) setActiveDestinationId(match.id);
  }, [libraries]);

  /* ---------------------------------------------------------- library side */

  const selectLibrary = useCallback(
    (libraryId: number | null, additive: boolean) => {
      search.setFilters((previous) => {
        if (libraryId === null) return { ...previous, libraryIds: [], favoritesOnly: false };
        if (!additive) return { ...previous, libraryIds: [libraryId] };
        return {
          ...previous,
          libraryIds: previous.libraryIds.includes(libraryId)
            ? previous.libraryIds.filter((id) => id !== libraryId)
            : [...previous.libraryIds, libraryId],
        };
      });
    },
    [search],
  );

  /* -------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      const accel = event.ctrlKey || event.metaKey;

      if (accel && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.select();
        searchInputRef.current?.focus();
        return;
      }

      // Ctrl+Shift+C copies the whole selection to the chosen destination.
      if (accel && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelectionToActive();
        return;
      }

      if (accel && event.key.toLowerCase() === 'a' && !typing) {
        event.preventDefault();
        setSelection((previous) => selectAll(ids, previous));
        return;
      }

      // Ctrl+C copies the focused asset's path unless the user is selecting real text.
      if (accel && event.key.toLowerCase() === 'c') {
        const hasTextSelection = (window.getSelection()?.toString().length ?? 0) > 0;
        if (!typing && !hasTextSelection && cursorFile) {
          event.preventDefault();
          copyPath(cursorFile);
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        navigate(1, event.shiftKey);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        navigate(-1, event.shiftKey);
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        navigate(20, event.shiftKey);
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        navigate(-20, event.shiftKey);
        return;
      }

      if (event.key === 'Enter' && cursorFile) {
        event.preventDefault();
        player.play(cursorFile);
        return;
      }

      // Space is the fast-audition key, but must stay available for typing a query.
      if (event.key === ' ' && !typing && cursorFile) {
        event.preventDefault();
        player.toggle(cursorFile);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cursorFile, navigate, player, copyPath, copySelectionToActive, ids]);

  /* ------------------------------------------------------------------ view */

  const menuTargetIds = menuTarget ? actionTargets(selection, menuTarget.file.id) : [];

  return (
    <div className="app">
      <div className="toolbar">
        <SearchBar
          ref={searchInputRef}
          value={search.text}
          onChange={search.setText}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((visible) => !visible)}
          activeFilterCount={activeFilterCount}
        />
        <DestinationPicker
          destinations={libraries.destinations}
          activeId={activeDestinationId}
          onSelect={setActiveDestinationId}
          onChooseFolder={() => void chooseDestinationFolder()}
        />
      </div>

      <div className={`app-body ${showFilters ? 'with-filters' : ''}`}>
        <LibrarySidebar
          libraries={libraries.libraries}
          scans={libraries.scans}
          selectedIds={search.filters.libraryIds}
          favoritesOnly={search.filters.favoritesOnly}
          totalIndexed={totalIndexed}
          onSelect={selectLibrary}
          onToggleFavorites={() =>
            search.setFilters((previous) => ({
              ...previous,
              favoritesOnly: !previous.favoritesOnly,
            }))
          }
          onAdd={() => void libraries.addLibrary()}
          onRescan={(id) => void libraries.rescanLibrary(id)}
          onRemove={setLibraryToRemove}
          onOpenFolder={(id) => void libraries.openLibraryFolder(id)}
        />

        <ResultsTable
          items={items}
          total={search.total}
          loading={search.loading}
          selected={selection.selected}
          cursorId={selection.cursorId}
          playingId={player.fileId}
          isPlaying={player.playing}
          sortField={search.sortField}
          sortDirection={search.sortDirection}
          hasLibraries={libraries.libraries.length > 0}
          onSort={search.toggleSort}
          onSelect={handleRowSelect}
          onActivate={(file) => player.toggle(file)}
          onContextMenu={(file, x, y) => setMenuTarget({ file, x, y })}
          onToggleFavorite={toggleFavorite}
          onLoadMore={search.loadMore}
          scrollToIndex={scrollToIndex}
        />

        {showFilters && (
          <FilterPanel
            filters={search.filters}
            facets={search.facets}
            onChange={search.setFilters}
            onClear={() => search.setFilters(() => EMPTY_FILTERS)}
          />
        )}
      </div>

      <PlayerBar player={player} />

      <StatusBar
        total={search.total}
        shown={items.length}
        selectedCount={selection.selected.size}
        elapsedMs={search.elapsedMs}
        loading={search.loading}
        scans={[...libraries.scans.values()]}
        error={search.error ?? libraries.error ?? player.error}
        onCancelScan={(id) => void libraries.cancelScan(id)}
      />

      {menuTarget && (
        <ContextMenu
          target={menuTarget}
          targetIds={menuTargetIds}
          destinations={libraries.destinations}
          activeDestination={activeDestination}
          onClose={() => setMenuTarget(null)}
          onShowInFolder={showInFolder}
          onCopyPath={copyPath}
          onCopyFile={copyFile}
          onCopyTo={(fileIds, path) => copyFiles(fileIds, path)}
          onCopyToChosenFolder={(fileIds) => void copyToChosenFolder(fileIds)}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {pendingCopy && (
        <ConflictDialog
          conflicts={pendingCopy.conflicts}
          alreadyCopied={pendingCopy.alreadyCopied}
          onResolve={(strategy) => {
            const copy = pendingCopy;
            setPendingCopy(null);
            if (strategy === 'cancel') {
              if (copy.alreadyCopied > 0) {
                toasts.success(
                  `Copied ${copy.alreadyCopied} ${copy.alreadyCopied === 1 ? 'file' : 'files'}, ` +
                    `skipped ${copy.conflicts.length} that already existed.`,
                );
              }
              return;
            }
            copyFiles(
              copy.conflicts.map((conflict) => conflict.fileId),
              copy.destinationPath,
              strategy,
              copy.alreadyCopied,
            );
          }}
        />
      )}

      {libraryToRemove && (
        <ConfirmDialog
          title="Remove library?"
          message={
            `"${libraryToRemove.name}" will be removed from the application and its entries ` +
            `deleted from the index. Your audio files on disk are not touched.`
          }
          confirmLabel="Remove"
          onCancel={() => setLibraryToRemove(null)}
          onConfirm={() => {
            void libraries.removeLibrary(libraryToRemove.id);
            setLibraryToRemove(null);
          }}
        />
      )}

      <div className="toasts">
        {toasts.toasts.map((toast) => (
          <div className={`toast ${toast.kind}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
