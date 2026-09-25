/**
 * Selection maths for the results list, kept pure so the rules can be tested without
 * rendering anything.
 *
 * The model follows file-explorer convention: a plain click replaces the selection, Ctrl
 * toggles one row, and Shift selects the run between the anchor (the last plain click) and
 * the row clicked now.
 */

export interface SelectionState {
  /** Every selected row id. */
  selected: ReadonlySet<number>;
  /** The row the keyboard acts on, and the one Space/Enter plays. */
  cursorId: number | null;
  /** Where a Shift range starts from: the last row picked without Shift. */
  anchorId: number | null;
}

export const EMPTY_SELECTION: SelectionState = {
  selected: new Set<number>(),
  cursorId: null,
  anchorId: null,
};

export type ClickModifier = 'replace' | 'toggle' | 'range';

/** Works out which modifier a mouse or key event implies. */
export function modifierFor(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ClickModifier {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'replace';
}

/** The ids between two positions in the list, in either direction, inclusive. */
export function idsBetween(ids: readonly number[], fromIndex: number, toIndex: number): number[] {
  const start = Math.max(0, Math.min(fromIndex, toIndex));
  const end = Math.min(ids.length - 1, Math.max(fromIndex, toIndex));
  if (start > end) return [];
  return ids.slice(start, end + 1);
}

/**
 * Applies a click on `id` to the current selection.
 *
 * `ids` is the ordered list of currently loaded row ids, which is what makes a Shift range
 * meaningful: ranges follow what the user can see, not database order.
 */
export function applyClick(
  state: SelectionState,
  ids: readonly number[],
  id: number,
  modifier: ClickModifier,
): SelectionState {
  if (modifier === 'toggle') {
    const selected = new Set(state.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    // The anchor moves with a Ctrl+click, so a following Shift+click ranges from here.
    return { selected, cursorId: id, anchorId: id };
  }

  if (modifier === 'range') {
    const anchorId = state.anchorId ?? state.cursorId ?? id;
    const anchorIndex = ids.indexOf(anchorId);
    const targetIndex = ids.indexOf(id);

    // If the anchor has scrolled out of the loaded window there is no range to draw.
    if (anchorIndex < 0 || targetIndex < 0) {
      return { selected: new Set([id]), cursorId: id, anchorId: id };
    }

    return {
      selected: new Set(idsBetween(ids, anchorIndex, targetIndex)),
      cursorId: id,
      // The anchor deliberately stays put, so dragging Shift around keeps one end fixed.
      anchorId,
    };
  }

  return { selected: new Set([id]), cursorId: id, anchorId: id };
}

/**
 * Moves the cursor by `delta` rows. With `extend` the selection grows from the anchor,
 * matching Shift+Arrow in a file list; otherwise the cursor row becomes the selection.
 */
export function moveCursor(
  state: SelectionState,
  ids: readonly number[],
  delta: number,
  extend: boolean,
): SelectionState {
  if (ids.length === 0) return EMPTY_SELECTION;

  const currentIndex = state.cursorId === null ? -1 : ids.indexOf(state.cursorId);

  // With no cursor yet, the first keypress lands on the end the user is moving towards
  // rather than stepping past the first row.
  const nextIndex =
    currentIndex < 0
      ? delta >= 0
        ? 0
        : ids.length - 1
      : Math.max(0, Math.min(currentIndex + delta, ids.length - 1));

  const nextId = ids[nextIndex];

  if (!extend) {
    return { selected: new Set([nextId]), cursorId: nextId, anchorId: nextId };
  }

  const anchorId = state.anchorId ?? state.cursorId ?? nextId;
  const anchorIndex = ids.indexOf(anchorId);
  if (anchorIndex < 0) {
    return { selected: new Set([nextId]), cursorId: nextId, anchorId: nextId };
  }

  return {
    selected: new Set(idsBetween(ids, anchorIndex, nextIndex)),
    cursorId: nextId,
    anchorId,
  };
}

export function selectAll(ids: readonly number[], state: SelectionState): SelectionState {
  if (ids.length === 0) return EMPTY_SELECTION;
  return {
    selected: new Set(ids),
    cursorId: state.cursorId ?? ids[0],
    anchorId: ids[0],
  };
}

/**
 * Drops ids that are no longer in the result set, so a selection cannot linger invisibly
 * after the query changes.
 */
export function reconcile(state: SelectionState, ids: readonly number[]): SelectionState {
  const available = new Set(ids);
  const selected = new Set([...state.selected].filter((id) => available.has(id)));

  const cursorId =
    state.cursorId !== null && available.has(state.cursorId)
      ? state.cursorId
      : (ids[0] ?? null);

  const anchorId =
    state.anchorId !== null && available.has(state.anchorId) ? state.anchorId : cursorId;

  if (selected.size === 0 && cursorId !== null) selected.add(cursorId);

  return { selected, cursorId, anchorId };
}

/**
 * The ids to act on for a command aimed at `targetId` (the right-clicked row).
 *
 * Right-clicking inside a multi-row selection acts on the whole selection; right-clicking
 * outside it acts on just that row, which is what every file manager does.
 */
export function actionTargets(state: SelectionState, targetId: number): number[] {
  if (state.selected.has(targetId) && state.selected.size > 1) {
    return [...state.selected];
  }
  return [targetId];
}
