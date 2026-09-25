import {
  CHANNEL_FILTERS,
  COMMON_SAMPLE_RATES,
  DURATION_BUCKETS,
  SUPPORTED_EXTENSIONS,
  type ChannelFilterId,
  type DurationBucketId,
} from '../../shared/constants';
import type { FacetCounts, SearchFilters } from '../../shared/types';
import { formatCount } from '../services/format';

interface Props {
  filters: SearchFilters;
  facets: FacetCounts;
  onChange: (update: (previous: SearchFilters) => SearchFilters) => void;
  onClear: () => void;
}

/** Adds or removes `value` from a filter array. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function FilterPanel({ filters, facets, onChange, onClear }: Props) {
  const range = filters.durationRange;

  const setRange = (key: 'min' | 'max', raw: string) => {
    const parsed = raw.trim() === '' ? null : Number(raw);
    const value = parsed === null || Number.isNaN(parsed) ? null : Math.max(0, parsed);

    onChange((previous) => {
      const next = { min: previous.durationRange?.min ?? null, max: previous.durationRange?.max ?? null, [key]: value };
      // Drop the range entirely once both bounds are cleared.
      return {
        ...previous,
        durationRange: next.min === null && next.max === null ? null : next,
      };
    });
  };

  return (
    <aside className="filters">
      <div className="section-title" style={{ padding: '0 0 6px' }}>
        <span>Filters</span>
        <button className="ghost" onClick={onClear} title="Clear all filters">
          clear
        </button>
      </div>

      <div className="filter-group">
        <h4>Duration</h4>
        {(Object.keys(DURATION_BUCKETS) as DurationBucketId[]).map((id) => (
          <label className="check" key={id}>
            <input
              type="checkbox"
              checked={filters.durationBuckets.includes(id)}
              onChange={() =>
                onChange((previous) => ({
                  ...previous,
                  durationBuckets: toggle(previous.durationBuckets, id),
                }))
              }
            />
            {DURATION_BUCKETS[id].label}
          </label>
        ))}

        <div className="custom-range">
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="min"
            value={range?.min ?? ''}
            onChange={(event) => setRange('min', event.target.value)}
            aria-label="Minimum duration in seconds"
          />
          <span style={{ color: 'var(--text-faint)' }}>–</span>
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="max"
            value={range?.max ?? ''}
            onChange={(event) => setRange('max', event.target.value)}
            aria-label="Maximum duration in seconds"
          />
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>sec</span>
        </div>
      </div>

      <div className="filter-group">
        <h4>File Type</h4>
        {SUPPORTED_EXTENSIONS.map((extension) => {
          const count = facets.extensions[extension] ?? 0;
          return (
            <label className="check" key={extension}>
              <input
                type="checkbox"
                checked={filters.extensions.includes(extension)}
                onChange={() =>
                  onChange((previous) => ({
                    ...previous,
                    extensions: toggle(previous.extensions, extension),
                  }))
                }
              />
              {extension.slice(1).toUpperCase()}
              <span className="count">{formatCount(count)}</span>
            </label>
          );
        })}
      </div>

      <div className="filter-group">
        <h4>Channels</h4>
        {(Object.keys(CHANNEL_FILTERS) as ChannelFilterId[]).map((id) => (
          <label className="check" key={id}>
            <input
              type="checkbox"
              checked={filters.channels.includes(id)}
              onChange={() =>
                onChange((previous) => ({ ...previous, channels: toggle(previous.channels, id) }))
              }
            />
            {CHANNEL_FILTERS[id].label}
          </label>
        ))}
      </div>

      <div className="filter-group">
        <h4>Sample Rate</h4>
        {COMMON_SAMPLE_RATES.map((rate) => (
          <label className="check" key={rate}>
            <input
              type="checkbox"
              checked={filters.sampleRates.includes(rate)}
              onChange={() =>
                onChange((previous) => ({
                  ...previous,
                  sampleRates: toggle(previous.sampleRates, rate),
                }))
              }
            />
            {(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz
          </label>
        ))}
      </div>
    </aside>
  );
}
