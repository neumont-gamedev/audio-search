import { forwardRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { value, onChange, showFilters, onToggleFilters, activeFilterCount },
  ref,
) {
  return (
    <div className="searchbar">
      <input
        ref={ref}
        type="search"
        placeholder="Search filenames and folders…  (Ctrl+F)"
        value={value}
        spellCheck={false}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        aria-label="Search audio assets"
      />

      <span className="hint">multiple words narrow results</span>

      <button onClick={onToggleFilters} title="Show or hide the filter panel">
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} {showFilters ? '▸' : '◂'}
      </button>
    </div>
  );
});
