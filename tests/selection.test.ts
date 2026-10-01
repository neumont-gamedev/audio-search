import { describe, expect, it } from 'vitest';
import {
  actionTargets,
  applyClick,
  defersToClick,
  EMPTY_SELECTION,
  idsBetween,
  modifierFor,
  moveCursor,
  reconcile,
  selectAll,
  type SelectionState,
} from '../src/renderer/services/selection';

const IDS = [10, 20, 30, 40, 50];

function state(selected: number[], cursorId: number | null, anchorId = cursorId): SelectionState {
  return { selected: new Set(selected), cursorId, anchorId };
}

const asArray = (s: SelectionState) => [...s.selected].sort((a, b) => a - b);

describe('modifierFor', () => {
  it('reads plain, ctrl and shift clicks', () => {
    const base = { ctrlKey: false, metaKey: false, shiftKey: false };
    expect(modifierFor(base)).toBe('replace');
    expect(modifierFor({ ...base, ctrlKey: true })).toBe('toggle');
    expect(modifierFor({ ...base, metaKey: true })).toBe('toggle');
    expect(modifierFor({ ...base, shiftKey: true })).toBe('range');
  });

  it('treats shift as a range even alongside ctrl', () => {
    expect(modifierFor({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('range');
  });
});

describe('idsBetween', () => {
  it('works in both directions, inclusively', () => {
    expect(idsBetween(IDS, 1, 3)).toEqual([20, 30, 40]);
    expect(idsBetween(IDS, 3, 1)).toEqual([20, 30, 40]);
  });

  it('includes a single row when the ends match', () => {
    expect(idsBetween(IDS, 2, 2)).toEqual([30]);
  });

  it('clamps out-of-range bounds', () => {
    expect(idsBetween(IDS, -5, 1)).toEqual([10, 20]);
    expect(idsBetween(IDS, 3, 99)).toEqual([40, 50]);
  });
});

describe('applyClick', () => {
  it('replaces the selection on a plain click', () => {
    const next = applyClick(state([10, 20, 30], 30), IDS, 50, 'replace');
    expect(asArray(next)).toEqual([50]);
    expect(next.cursorId).toBe(50);
    expect(next.anchorId).toBe(50);
  });

  it('adds with ctrl+click', () => {
    const next = applyClick(state([10], 10), IDS, 30, 'toggle');
    expect(asArray(next)).toEqual([10, 30]);
    expect(next.cursorId).toBe(30);
  });

  it('removes an already selected row with ctrl+click', () => {
    const next = applyClick(state([10, 30], 30), IDS, 30, 'toggle');
    expect(asArray(next)).toEqual([10]);
  });

  it('selects a run with shift+click', () => {
    const next = applyClick(state([20], 20), IDS, 40, 'range');
    expect(asArray(next)).toEqual([20, 30, 40]);
  });

  it('selects a run upwards too', () => {
    const next = applyClick(state([40], 40), IDS, 20, 'range');
    expect(asArray(next)).toEqual([20, 30, 40]);
  });

  it('keeps the anchor fixed so a range can be redrawn', () => {
    const first = applyClick(state([20], 20), IDS, 50, 'range');
    expect(asArray(first)).toEqual([20, 30, 40, 50]);

    // Shift-clicking again re-draws from the same anchor rather than growing endlessly.
    const second = applyClick(first, IDS, 30, 'range');
    expect(asArray(second)).toEqual([20, 30]);
    expect(second.anchorId).toBe(20);
  });

  it('ranges from the last ctrl+click', () => {
    const toggled = applyClick(state([10], 10), IDS, 30, 'toggle');
    const ranged = applyClick(toggled, IDS, 50, 'range');
    expect(asArray(ranged)).toEqual([30, 40, 50]);
  });

  it('falls back to a single row when the anchor is gone', () => {
    const next = applyClick(state([999], 999, 999), IDS, 30, 'range');
    expect(asArray(next)).toEqual([30]);
  });

  it('starts a range from nothing without throwing', () => {
    const next = applyClick(EMPTY_SELECTION, IDS, 30, 'range');
    expect(asArray(next)).toEqual([30]);
  });
});

describe('moveCursor', () => {
  it('moves the cursor and collapses the selection', () => {
    const next = moveCursor(state([10, 20, 30], 10), IDS, 1, false);
    expect(asArray(next)).toEqual([20]);
    expect(next.cursorId).toBe(20);
  });

  it('extends the selection with shift', () => {
    const next = moveCursor(state([20], 20), IDS, 2, true);
    expect(asArray(next)).toEqual([20, 30, 40]);
    expect(next.cursorId).toBe(40);
    expect(next.anchorId).toBe(20);
  });

  it('shrinks the range when shift reverses direction', () => {
    const grown = moveCursor(state([20], 20), IDS, 2, true);
    const shrunk = moveCursor(grown, IDS, -1, true);
    expect(asArray(shrunk)).toEqual([20, 30]);
  });

  it('stops at the ends of the list', () => {
    expect(moveCursor(state([10], 10), IDS, -5, false).cursorId).toBe(10);
    expect(moveCursor(state([50], 50), IDS, 5, false).cursorId).toBe(50);
  });

  it('starts at the first row when nothing is selected', () => {
    expect(moveCursor(EMPTY_SELECTION, IDS, 1, false).cursorId).toBe(10);
  });

  it('returns an empty selection for an empty list', () => {
    expect(moveCursor(state([10], 10), [], 1, false)).toEqual(EMPTY_SELECTION);
  });
});

describe('selectAll', () => {
  it('selects every loaded row', () => {
    expect(asArray(selectAll(IDS, EMPTY_SELECTION))).toEqual(IDS);
  });

  it('keeps the existing cursor', () => {
    expect(selectAll(IDS, state([30], 30)).cursorId).toBe(30);
  });

  it('handles an empty list', () => {
    expect(selectAll([], EMPTY_SELECTION)).toEqual(EMPTY_SELECTION);
  });
});

describe('reconcile', () => {
  it('drops rows that are no longer in the results', () => {
    const next = reconcile(state([10, 20, 999], 20), IDS);
    expect(asArray(next)).toEqual([10, 20]);
  });

  it('moves the cursor to the first row when it disappears', () => {
    const next = reconcile(state([999], 999), IDS);
    expect(next.cursorId).toBe(10);
    expect(asArray(next)).toEqual([10]);
  });

  it('never leaves an empty selection while rows exist', () => {
    const next = reconcile(EMPTY_SELECTION, IDS);
    expect(next.selected.size).toBe(1);
  });

  it('clears everything when the results are empty', () => {
    const next = reconcile(state([10, 20], 10), []);
    expect(next.selected.size).toBe(0);
    expect(next.cursorId).toBeNull();
  });

  it('leaves an intact selection alone', () => {
    const next = reconcile(state([20, 30], 30, 20), IDS);
    expect(asArray(next)).toEqual([20, 30]);
    expect(next.cursorId).toBe(30);
    expect(next.anchorId).toBe(20);
  });
});

describe('defersToClick', () => {
  const multi = state([20, 30, 40], 30);

  it('defers a plain press inside a multi-row selection, so the whole selection can be dragged', () => {
    expect(defersToClick(multi, 30, 'replace')).toBe(true);
    expect(defersToClick(multi, 20, 'replace')).toBe(true);
  });

  it('acts immediately on a plain press outside the selection', () => {
    expect(defersToClick(multi, 50, 'replace')).toBe(false);
  });

  it('acts immediately when only one row is selected', () => {
    expect(defersToClick(state([30], 30), 30, 'replace')).toBe(false);
  });

  it('never defers Ctrl or Shift clicks, which edit the selection on press', () => {
    expect(defersToClick(multi, 30, 'toggle')).toBe(false);
    expect(defersToClick(multi, 30, 'range')).toBe(false);
  });

  it('collapses to the pressed row once the deferred click lands', () => {
    // What the caller does on click: an ordinary replace.
    expect(asArray(applyClick(multi, IDS, 30, 'replace'))).toEqual([30]);
  });
});

describe('actionTargets', () => {
  it('acts on the whole selection when the clicked row is inside it', () => {
    expect(actionTargets(state([10, 20, 30], 30), 20).sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it('acts on just the clicked row when it is outside the selection', () => {
    expect(actionTargets(state([10, 20], 20), 50)).toEqual([50]);
  });

  it('acts on one row when only one is selected', () => {
    expect(actionTargets(state([30], 30), 30)).toEqual([30]);
  });
});
