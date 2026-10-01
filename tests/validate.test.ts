import { describe, expect, it } from 'vitest';
import { WAVEFORM_BUCKETS, WAVEFORM_FORMAT_VERSION } from '../src/shared/constants';
import {
  requireFileIds,
  requireId,
  requireString,
  requireWaveform,
  validateCopyRequest,
  validateFilters,
  validateSearchQuery,
  ValidationError,
} from '../src/main/ipc/validate';

describe('requireId', () => {
  it('accepts a positive integer', () => {
    expect(requireId(7)).toBe(7);
  });

  it('rejects anything else', () => {
    for (const bad of [0, -1, 1.5, '3', null, undefined, NaN, {}]) {
      expect(() => requireId(bad)).toThrow(ValidationError);
    }
  });
});

describe('requireString', () => {
  it('accepts a normal string', () => {
    expect(requireString('punch', 'text')).toBe('punch');
  });

  it('rejects a string containing a NUL byte', () => {
    expect(() => requireString('a\0b', 'text')).toThrow(ValidationError);
  });

  it('rejects an over-long string', () => {
    expect(() => requireString('x'.repeat(50), 'text', 10)).toThrow(ValidationError);
  });

  it('rejects non-strings', () => {
    expect(() => requireString(42, 'text')).toThrow(ValidationError);
  });
});

describe('validateFilters', () => {
  it('fills in defaults for a missing filter object', () => {
    const filters = validateFilters(undefined);
    expect(filters).toEqual({
      libraryIds: [],
      extensions: [],
      durationBuckets: [],
      durationRange: null,
      channels: [],
      sampleRates: [],
      favoritesOnly: false,
    });
  });

  it('drops unsupported extensions', () => {
    const filters = validateFilters({ extensions: ['.wav', '.exe', '.dll'] });
    expect(filters.extensions).toEqual(['.wav']);
  });

  it('normalises extension casing', () => {
    expect(validateFilters({ extensions: ['.WAV'] }).extensions).toEqual(['.wav']);
  });

  it('drops unknown bucket and channel ids rather than failing', () => {
    const filters = validateFilters({
      durationBuckets: ['under1', 'made_up'],
      channels: ['mono', 'quadraphonic'],
    });
    expect(filters.durationBuckets).toEqual(['under1']);
    expect(filters.channels).toEqual(['mono']);
  });

  it('rejects a non-array where an array is required', () => {
    expect(() => validateFilters({ libraryIds: 'all' })).toThrow(ValidationError);
  });

  it('rejects absurdly large filter arrays', () => {
    expect(() => validateFilters({ sampleRates: new Array(500).fill(44100) })).toThrow(
      ValidationError,
    );
  });

  it('rejects a negative duration bound', () => {
    expect(() => validateFilters({ durationRange: { min: -5, max: null } })).toThrow(
      ValidationError,
    );
  });

  it('keeps a valid custom duration range', () => {
    expect(validateFilters({ durationRange: { min: 1, max: 3 } }).durationRange).toEqual({
      min: 1,
      max: 3,
    });
  });
});

describe('validateSearchQuery', () => {
  it('supplies defaults for an empty query', () => {
    const query = validateSearchQuery({});
    expect(query.text).toBe('');
    expect(query.sortField).toBe('relevance');
    expect(query.sortDirection).toBe('asc');
    expect(query.offset).toBe(0);
  });

  it('falls back to relevance for an unknown sort field', () => {
    // A bogus field must never reach the SQL builder.
    expect(validateSearchQuery({ sortField: 'absolute_path; DROP TABLE' }).sortField).toBe(
      'relevance',
    );
  });

  it('clamps the page size', () => {
    expect(validateSearchQuery({ limit: 999999 }).limit).toBe(1000);
    expect(validateSearchQuery({ limit: 0 }).limit).toBe(200);
    expect(validateSearchQuery({ limit: -5 }).limit).toBe(1);
  });

  it('clamps a negative offset', () => {
    expect(validateSearchQuery({ offset: -10 }).offset).toBe(0);
  });

  it('rejects an over-long search string', () => {
    expect(() => validateSearchQuery({ text: 'x'.repeat(5000) })).toThrow(ValidationError);
  });
});

describe('requireFileIds', () => {
  it('accepts ids and removes duplicates, keeping first-seen order', () => {
    expect(requireFileIds([5, 2, 5, 9, 2])).toEqual([5, 2, 9]);
  });

  it.each([
    ['not an array', 'nope'],
    ['empty', []],
    ['a non-integer id', [1, 2.5]],
    ['a negative id', [1, -3]],
    ['a string id', [1, '2']],
    ['a path smuggled in', ['C:/Windows/System32/cmd.exe']],
  ])('rejects %s', (_label, value) => {
    expect(() => requireFileIds(value)).toThrow(ValidationError);
  });

  it('rejects an oversized batch', () => {
    const ids = Array.from({ length: 2001 }, (_, i) => i + 1);
    expect(() => requireFileIds(ids)).toThrow(/at most/);
  });
});

describe('requireWaveform', () => {
  const valid = () => {
    const data = new Uint8Array(WAVEFORM_BUCKETS + 1);
    data[0] = WAVEFORM_FORMAT_VERSION;
    return data;
  };

  it('accepts data in the current format', () => {
    const data = valid();
    expect(requireWaveform(data)).toBe(data);
  });

  it.each([
    ['a plain array', Array.from(valid())],
    ['a string', 'peaks'],
    ['the wrong length', new Uint8Array(10)],
  ])('rejects %s', (_label, value) => {
    expect(() => requireWaveform(value)).toThrow(ValidationError);
  });

  it('rejects another format version', () => {
    const data = valid();
    data[0] = WAVEFORM_FORMAT_VERSION + 1;
    expect(() => requireWaveform(data)).toThrow(/version/);
  });
});

describe('validateCopyRequest', () => {
  it('accepts a well-formed request', () => {
    const request = validateCopyRequest({
      fileIds: [3],
      destinationPath: 'D:/Projects/Game/Audio',
      strategy: 'rename',
    });
    expect(request.fileIds).toEqual([3]);
    expect(request.strategy).toBe('rename');
  });

  it('accepts a batch of several files', () => {
    const request = validateCopyRequest({ fileIds: [1, 2, 3], destinationPath: 'D:/x' });
    expect(request.fileIds).toEqual([1, 2, 3]);
  });

  it('de-duplicates repeated ids', () => {
    // Copying the same asset twice in one request would otherwise collide with itself.
    const request = validateCopyRequest({ fileIds: [4, 4, 7, 4], destinationPath: 'D:/x' });
    expect(request.fileIds).toEqual([4, 7]);
  });

  it('allows an omitted strategy for the first attempt', () => {
    const request = validateCopyRequest({ fileIds: [1], destinationPath: 'D:/x' });
    expect(request.strategy).toBeUndefined();
  });

  it('rejects an unknown strategy', () => {
    expect(() =>
      validateCopyRequest({ fileIds: [1], destinationPath: 'D:/x', strategy: 'delete_source' }),
    ).toThrow(ValidationError);
  });

  it('rejects an empty or missing file list', () => {
    expect(() => validateCopyRequest({ fileIds: [], destinationPath: 'D:/x' })).toThrow(
      ValidationError,
    );
    expect(() => validateCopyRequest({ destinationPath: 'D:/x' })).toThrow(ValidationError);
    expect(() => validateCopyRequest({ fileIds: 5, destinationPath: 'D:/x' })).toThrow(
      ValidationError,
    );
  });

  it('rejects an unreasonably large batch', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => i + 1);
    expect(() => validateCopyRequest({ fileIds: huge, destinationPath: 'D:/x' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a bad id inside the list', () => {
    expect(() => validateCopyRequest({ fileIds: [1, -2], destinationPath: 'D:/x' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a missing destination', () => {
    expect(() => validateCopyRequest({ fileIds: [1] })).toThrow(ValidationError);
  });
});
