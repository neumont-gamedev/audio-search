import { CHANNEL_FILTERS, DURATION_BUCKETS, SUPPORTED_EXTENSIONS } from '../../shared/constants';
import type {
  AppError,
  CopyRequest,
  DuplicateStrategy,
  SearchFilters,
  SearchQuery,
  SortDirection,
  SortField,
} from '../../shared/types';

/**
 * Everything crossing the IPC boundary is untrusted, even though the renderer is our own
 * code: a compromised renderer must not be able to steer the main process into reading or
 * writing arbitrary paths. These helpers coerce input into known-good shapes and throw
 * `ValidationError` otherwise.
 */
export class ValidationError extends Error {
  readonly code: AppError['code'] = 'INVALID_ARGUMENT';

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function requireId(value: unknown, field = 'id'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return value;
}

export function requireString(value: unknown, field: string, maxLength = 4096): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  if (value.length > maxLength) throw new ValidationError(`${field} is too long`);
  if (value.includes('\0')) throw new ValidationError(`${field} contains an invalid character`);
  return value;
}

export function optionalString(value: unknown, field: string, maxLength = 4096): string | undefined {
  return value === undefined || value === null ? undefined : requireString(value, field, maxLength);
}

function toStringArray(value: unknown, field: string, allowed?: ReadonlySet<string>): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  if (value.length > 100) throw new ValidationError(`${field} has too many entries`);

  const out: string[] = [];
  for (const entry of value) {
    const text = requireString(entry, `${field} entry`, 200);
    if (allowed && !allowed.has(text.toLowerCase())) continue;
    out.push(text);
  }
  return out;
}

function toNumberArray(value: unknown, field: string): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  if (value.length > 100) throw new ValidationError(`${field} has too many entries`);

  return value.map((entry) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new ValidationError(`${field} must contain numbers`);
    }
    return entry;
  });
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative number`);
  }
  return value;
}

const EXTENSION_SET = new Set<string>(SUPPORTED_EXTENSIONS);
const SORT_FIELDS = new Set<SortField>([
  'filename',
  'duration',
  'fileSize',
  'modifiedAt',
  'relevance',
]);

export function validateFilters(value: unknown): SearchFilters {
  const raw = (value ?? {}) as Record<string, unknown>;

  const durationRangeRaw = raw.durationRange as Record<string, unknown> | null | undefined;
  const durationRange = durationRangeRaw
    ? {
        min: optionalNumber(durationRangeRaw.min, 'durationRange.min'),
        max: optionalNumber(durationRangeRaw.max, 'durationRange.max'),
      }
    : null;

  return {
    libraryIds: toNumberArray(raw.libraryIds, 'libraryIds').map((id) => requireId(id, 'libraryId')),
    extensions: toStringArray(raw.extensions, 'extensions', EXTENSION_SET).map((e) =>
      e.toLowerCase(),
    ),
    // Unknown bucket ids are dropped rather than rejected so an older renderer cannot
    // hard-fail against a newer main process.
    durationBuckets: toStringArray(raw.durationBuckets, 'durationBuckets').filter(
      (id): id is keyof typeof DURATION_BUCKETS => id in DURATION_BUCKETS,
    ),
    channels: toStringArray(raw.channels, 'channels').filter(
      (id): id is keyof typeof CHANNEL_FILTERS => id in CHANNEL_FILTERS,
    ),
    durationRange,
    sampleRates: toNumberArray(raw.sampleRates, 'sampleRates'),
    favoritesOnly: raw.favoritesOnly === true,
  };
}

export function validateSearchQuery(value: unknown): SearchQuery {
  const raw = (value ?? {}) as Record<string, unknown>;

  const sortField = raw.sortField as SortField;
  const sortDirection = raw.sortDirection as SortDirection;

  return {
    text: requireString(raw.text ?? '', 'text', 512),
    filters: validateFilters(raw.filters),
    sortField: SORT_FIELDS.has(sortField) ? sortField : 'relevance',
    sortDirection: sortDirection === 'desc' ? 'desc' : 'asc',
    limit: Math.max(1, Math.min(Number(raw.limit) || 200, 1000)),
    offset: Math.max(0, Math.floor(Number(raw.offset) || 0)),
  };
}

const STRATEGIES = new Set<DuplicateStrategy>(['cancel', 'overwrite', 'rename']);

/** A single copy request may not exceed this, to bound one IPC call's work. */
const MAX_COPY_BATCH = 2000;

export function validateCopyRequest(value: unknown): CopyRequest {
  const raw = (value ?? {}) as Record<string, unknown>;
  const strategy = raw.strategy as DuplicateStrategy | undefined;

  if (strategy !== undefined && !STRATEGIES.has(strategy)) {
    throw new ValidationError('strategy must be cancel, overwrite or rename');
  }

  if (!Array.isArray(raw.fileIds)) throw new ValidationError('fileIds must be an array');
  if (raw.fileIds.length === 0) throw new ValidationError('fileIds must not be empty');
  if (raw.fileIds.length > MAX_COPY_BATCH) {
    throw new ValidationError(`fileIds must contain at most ${MAX_COPY_BATCH} entries`);
  }

  // De-duplicated so the same asset cannot be copied twice in one request, which would
  // otherwise produce a spurious name_2 collision against itself.
  const fileIds = [...new Set(raw.fileIds.map((id) => requireId(id, 'fileId')))];

  return {
    fileIds,
    destinationPath: requireString(raw.destinationPath, 'destinationPath'),
    strategy,
  };
}
