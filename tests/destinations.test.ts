import { describe, expect, it } from 'vitest';
import type { Destination } from '../src/shared/types';
import { destinationLabels } from '../src/renderer/services/destinations';

function make(paths: string[]): Destination[] {
  return paths.map((path, index) => ({
    id: index + 1,
    name: path.split('/').pop() ?? path,
    path,
  }));
}

describe('destinationLabels', () => {
  it('uses the folder name when that is unambiguous', () => {
    const destinations = make(['D:/Projects/SpaceGame/Content/Audio', 'D:/Sounds/Music']);
    const labels = destinationLabels(destinations);

    expect(labels.get(1)).toBe('Audio');
    expect(labels.get(2)).toBe('Music');
  });

  it('adds parent folders when names collide', () => {
    // Two projects both ending in "Audio" must not both read as "Audio".
    const destinations = make([
      'D:/Projects/SpaceGame/Content/Audio',
      'D:/Projects/Prototype/Content/Audio',
    ]);
    const labels = destinationLabels(destinations);

    expect(labels.get(1)).not.toBe(labels.get(2));
    expect(labels.get(1)).toBe('SpaceGame / Content / Audio');
    expect(labels.get(2)).toBe('Prototype / Content / Audio');
  });

  it('adds only as much path as it needs', () => {
    const destinations = make(['D:/Projects/SpaceGame/Audio', 'D:/Projects/Prototype/Audio']);
    const labels = destinationLabels(destinations);

    expect(labels.get(1)).toBe('SpaceGame / Audio');
    expect(labels.get(2)).toBe('Prototype / Audio');
  });

  it('leaves unrelated names short even when others collide', () => {
    const destinations = make([
      'D:/Projects/SpaceGame/Audio',
      'D:/Projects/Prototype/Audio',
      'D:/Sounds/Ambience',
    ]);
    const labels = destinationLabels(destinations);

    expect(labels.get(3)).toBe('Ambience');
    expect(labels.get(1)).toBe('SpaceGame / Audio');
  });

  it('handles a folder at a drive root', () => {
    const labels = destinationLabels(make(['D:/Audio']));
    expect(labels.get(1)).toBe('Audio');
  });

  it('gives every destination a label', () => {
    const destinations = make([
      'D:/A/Audio',
      'D:/B/Audio',
      'D:/C/Audio',
      'E:/Other',
      'D:/A/Music',
    ]);
    const labels = destinationLabels(destinations);

    expect(labels.size).toBe(destinations.length);
    for (const destination of destinations) {
      expect(labels.get(destination.id)).toBeTruthy();
    }
  });

  it('produces distinct labels for every distinct path', () => {
    const destinations = make([
      'D:/Projects/Alpha/Content/Audio/SFX',
      'D:/Projects/Beta/Content/Audio/SFX',
      'D:/Projects/Alpha/Content/Audio',
    ]);
    const labels = destinationLabels(destinations);

    const distinct = new Set(labels.values());
    expect(distinct.size).toBe(destinations.length);
  });

  it('copes with an empty list', () => {
    expect(destinationLabels([]).size).toBe(0);
  });
});
