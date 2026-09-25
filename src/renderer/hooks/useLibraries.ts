import { useCallback, useEffect, useState } from 'react';
import type { Destination, Library, ScanProgress } from '../../shared/types';
import { api, errorMessage, unwrap } from '../services/api';

export interface UseLibraries {
  libraries: Library[];
  destinations: Destination[];
  /** Progress for each library currently being scanned, keyed by library id. */
  scans: Map<number, ScanProgress>;
  error: string | null;
  addLibrary: () => Promise<void>;
  removeLibrary: (id: number) => Promise<void>;
  rescanLibrary: (id: number) => Promise<void>;
  cancelScan: (id: number) => Promise<void>;
  openLibraryFolder: (id: number) => Promise<void>;
  addDestination: (name: string, path: string) => Promise<void>;
  chooseFolder: (title?: string) => Promise<string | null>;
  reload: () => Promise<void>;
}

/** Owns libraries, saved destinations, and live scan progress. */
export function useLibraries(onIndexChanged: () => void): UseLibraries {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [scans, setScans] = useState<Map<number, ScanProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextLibraries, nextDestinations] = await Promise.all([
        unwrap(api.listLibraries()),
        unwrap(api.listDestinations()),
      ]);
      setLibraries(nextLibraries);
      setDestinations(nextDestinations);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const offProgress = api.onScanProgress((progress) => {
      setScans((previous) => {
        const next = new Map(previous);
        if (progress.phase === 'done' || progress.phase === 'cancelled') {
          next.delete(progress.libraryId);
        } else {
          next.set(progress.libraryId, progress);
        }
        return next;
      });

      if (progress.phase === 'error') setError(progress.message ?? 'A library scan failed.');

      // Results become progressively more complete during a scan, so refresh as it runs.
      if (progress.phase === 'done') {
        void reload();
        onIndexChanged();
      }
    });

    const offLibraries = api.onLibrariesChanged(() => void reload());
    const offIndex = api.onIndexChanged(() => onIndexChanged());

    return () => {
      offProgress();
      offLibraries();
      offIndex();
    };
  }, [reload, onIndexChanged]);

  const guard = useCallback(async (work: () => Promise<unknown>) => {
    try {
      await work();
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  const chooseFolder = useCallback(async (title?: string) => {
    try {
      return await unwrap(api.selectFolder(title));
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    }
  }, []);

  const addLibrary = useCallback(async () => {
    const path = await chooseFolder('Select an audio library folder');
    if (!path) return;
    await guard(async () => {
      await unwrap(api.addLibrary(path));
      await reload();
    });
  }, [chooseFolder, guard, reload]);

  const removeLibrary = useCallback(
    (id: number) =>
      guard(async () => {
        await unwrap(api.removeLibrary(id));
        await reload();
        onIndexChanged();
      }),
    [guard, reload, onIndexChanged],
  );

  const rescanLibrary = useCallback(
    (id: number) => guard(() => unwrap(api.rescanLibrary(id))),
    [guard],
  );

  const cancelScan = useCallback((id: number) => guard(() => unwrap(api.cancelScan(id))), [guard]);

  const openLibraryFolder = useCallback(
    (id: number) => guard(() => unwrap(api.openLibraryFolder(id))),
    [guard],
  );

  const addDestination = useCallback(
    (name: string, path: string) =>
      guard(async () => {
        await unwrap(api.addDestination(name, path));
        await reload();
      }),
    [guard, reload],
  );

  return {
    libraries,
    destinations,
    scans,
    error,
    addLibrary,
    removeLibrary,
    rescanLibrary,
    cancelScan,
    openLibraryFolder,
    addDestination,
    chooseFolder,
    reload,
  };
}
