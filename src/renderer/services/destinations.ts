import type { Destination } from '../../shared/types';

/**
 * Builds a short, unambiguous label for each destination.
 *
 * The folder name alone is usually enough (`Audio`), but projects commonly end in the same
 * folder, so `D:/Projects/SpaceGame/Content/Audio` and `D:/Projects/Prototype/Audio` would
 * both read as "Audio". Where names collide, enough parent segments are added to tell them
 * apart, falling back to the full path.
 */
export function destinationLabels(destinations: Destination[]): Map<number, string> {
  const labels = new Map<number, string>();
  const segmentsById = new Map<number, string[]>();

  for (const destination of destinations) {
    segmentsById.set(
      destination.id,
      destination.path.split('/').filter((segment) => segment.length > 0),
    );
  }

  /** The last `depth` path segments, joined for display. */
  const tail = (id: number, depth: number): string => {
    const segments = segmentsById.get(id) ?? [];
    return segments.slice(Math.max(0, segments.length - depth)).join(' / ');
  };

  let unresolved = destinations.map((destination) => destination.id);

  for (let depth = 1; depth <= 6 && unresolved.length > 0; depth++) {
    const byLabel = new Map<string, number[]>();
    for (const id of unresolved) {
      const label = tail(id, depth);
      const group = byLabel.get(label);
      if (group) group.push(id);
      else byLabel.set(label, [id]);
    }

    const stillAmbiguous: number[] = [];
    for (const [label, ids] of byLabel) {
      // A group of one is distinct at this depth, and so is a group that cannot get any
      // more specific because every path has been fully consumed.
      const exhausted = ids.every((id) => (segmentsById.get(id)?.length ?? 0) <= depth);
      if (ids.length === 1 || exhausted) {
        for (const id of ids) labels.set(id, label);
      } else {
        stillAmbiguous.push(...ids);
      }
    }
    unresolved = stillAmbiguous;
  }

  // Anything still colliding after six segments gets its full path.
  for (const id of unresolved) {
    const destination = destinations.find((entry) => entry.id === id);
    if (destination) labels.set(id, destination.path);
  }

  return labels;
}
