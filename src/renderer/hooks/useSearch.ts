import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SEARCH_PAGE_SIZE } from '../../shared/constants';
import type {
  AudioFile,
  FacetCounts,
  SearchFilters,
  SearchQuery,
  SortDirection,
  SortField,
} from '../../shared/types';
import { api, errorMessage, unwrap } from '../services/api';

export const EMPTY_FILTERS: SearchFilters = {
  libraryIds: [],
  extensions: [],
  durationBuckets: [],
  durationRange: null,
  channels: [],
  sampleRates: [],
  favoritesOnly: false,
};

/** Keystrokes settle for this long before a query runs; search itself is far faster. */
const DEBOUNCE_MS = 120;

interface SearchState {
  items: AudioFile[];
  total: number;
  elapsedMs: number;
  loading: boolean;
  error: string | null;
}

export interface UseSearch extends SearchState {
  text: string;
  setText: (text: string) => void;
  filters: SearchFilters;
  setFilters: (update: (previous: SearchFilters) => SearchFilters) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  toggleSort: (field: SortField) => void;
  facets: FacetCounts;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  /** Applies a local change to one row without re-running the query. */
  patchItem: (fileId: number, patch: Partial<AudioFile>) => void;
}

/**
 * Owns the query, its results, and paging.
 *
 * Results are appended page by page as the user scrolls rather than fetched all at once:
 * a 100k-file library must not be pulled across IPC to show the first screen.
 */
export function useSearch(): UseSearch {
  const [text, setText] = useState('');
  const [filters, setFiltersState] = useState<SearchFilters>(EMPTY_FILTERS);
  const [sortField, setSortField] = useState<SortField>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [offset, setOffset] = useState(0);
  const [nonce, setNonce] = useState(0);

  const [state, setState] = useState<SearchState>({
    items: [],
    total: 0,
    elapsedMs: 0,
    loading: false,
    error: null,
  });
  const [facets, setFacets] = useState<FacetCounts>({ extensions: {}, libraries: {} });

  // Guards against an older, slower query overwriting a newer one's results.
  const requestId = useRef(0);
  // Lets the paging effect append to the current items without depending on them.
  const itemsRef = useRef<AudioFile[]>([]);
  itemsRef.current = state.items;

  const baseQuery = useMemo(
    (): Omit<SearchQuery, 'offset'> => ({
      text,
      filters,
      sortField,
      sortDirection,
      limit: SEARCH_PAGE_SIZE,
    }),
    [text, filters, sortField, sortDirection],
  );

  // Any change to the query itself starts again from the first page.
  useEffect(() => {
    setOffset(0);
  }, [baseQuery]);

  useEffect(() => {
    const id = ++requestId.current;
    const isFirstPage = offset === 0;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    const timer = setTimeout(async () => {
      try {
        const result = await unwrap(api.search({ ...baseQuery, offset }));
        if (id !== requestId.current) return;

        setState({
          items: isFirstPage ? result.items : [...itemsRef.current, ...result.items],
          total: result.total,
          elapsedMs: result.elapsedMs,
          loading: false,
          error: null,
        });

        if (isFirstPage) {
          const counts = await unwrap(api.getFacets({ ...baseQuery, offset: 0 }));
          if (id === requestId.current) setFacets(counts);
        }
      } catch (error) {
        if (id !== requestId.current) return;
        setState((previous) => ({ ...previous, loading: false, error: errorMessage(error) }));
      }
      // Paging should feel instant, so only fresh queries are debounced.
    }, isFirstPage ? DEBOUNCE_MS : 0);

    return () => clearTimeout(timer);
  }, [baseQuery, offset, nonce]);

  const setFilters = useCallback((update: (previous: SearchFilters) => SearchFilters) => {
    setFiltersState(update);
  }, []);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSortField(field);
      // Newest-first and largest-first are the useful defaults for these columns.
      setSortDirection(field === 'modifiedAt' || field === 'fileSize' ? 'desc' : 'asc');
    },
    [sortField],
  );

  const hasMore = state.items.length < state.total;

  const loadMore = useCallback(() => {
    if (state.loading || !hasMore) return;
    setOffset(state.items.length);
  }, [state.loading, state.items.length, hasMore]);

  const refresh = useCallback(() => {
    setOffset(0);
    setNonce((value) => value + 1);
  }, []);

  const patchItem = useCallback((fileId: number, patch: Partial<AudioFile>) => {
    setState((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === fileId ? { ...item, ...patch } : item)),
    }));
  }, []);

  return {
    ...state,
    text,
    setText,
    filters,
    setFilters,
    sortField,
    sortDirection,
    toggleSort,
    facets,
    hasMore,
    loadMore,
    refresh,
    patchItem,
  };
}
