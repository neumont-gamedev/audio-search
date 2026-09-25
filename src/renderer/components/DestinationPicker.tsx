import { useMemo } from 'react';
import type { Destination } from '../../shared/types';
import { destinationLabels } from '../services/destinations';

interface Props {
  destinations: Destination[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onChooseFolder: () => void;
}

const BROWSE = '__browse';

/**
 * Chooses where "Copy to Destination" sends assets.
 *
 * Browsing is the first entry because it is how the list gets populated; everything below
 * the separator is a folder already copied to, most recent first. There is no separate
 * management step: picking a folder is what adds it, and the list prunes itself.
 */
export function DestinationPicker({ destinations, activeId, onSelect, onChooseFolder }: Props) {
  const labels = useMemo(() => destinationLabels(destinations), [destinations]);
  const active = destinations.find((destination) => destination.id === activeId) ?? null;

  const handleChange = (value: string) => {
    if (value === BROWSE) {
      onChooseFolder();
      return;
    }
    if (value !== '') onSelect(Number(value));
  };

  return (
    <div className="destination-picker" title={active ? active.path : 'No destination chosen yet'}>
      <span className="label">Copy to</span>
      <select
        // A select cannot show a value that has no option, so the placeholder stays
        // present until a destination is actually chosen.
        value={activeId === null ? '' : activeId}
        onChange={(event) => handleChange(event.target.value)}
        aria-label="Destination folder for copying assets"
      >
        {activeId === null && (
          <option value="">Choose a destination…</option>
        )}
        <option value={BROWSE}>Browse for folder…</option>
        {destinations.length > 0 && (
          <optgroup label="Recent">
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {labels.get(destination.id) ?? destination.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
