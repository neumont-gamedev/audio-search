import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

/**
 * Canonical form used for storage and comparison: absolute, normalized, forward slashes,
 * no trailing separator. Windows paths keep their original casing (users expect to see it)
 * but comparisons on Windows must go through `pathsEqual`.
 */
export function normalizePath(input: string): string {
  const resolved = resolve(normalize(input));
  const forward = resolved.replace(/\\/g, '/');
  return forward.length > 1 && forward.endsWith('/') && !forward.endsWith(':/')
    ? forward.slice(0, -1)
    : forward;
}

const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

export function pathComparisonKey(input: string): string {
  const normalized = normalizePath(input);
  return CASE_INSENSITIVE_FS ? normalized.toLowerCase() : normalized;
}

export function pathsEqual(a: string, b: string): boolean {
  return pathComparisonKey(a) === pathComparisonKey(b);
}

/** True when `child` is the same as, or nested inside, `parent`. */
export function isPathInside(child: string, parent: string): boolean {
  const childKey = pathComparisonKey(child);
  const parentKey = pathComparisonKey(parent);
  if (childKey === parentKey) return true;
  return childKey.startsWith(parentKey.endsWith('/') ? parentKey : `${parentKey}/`);
}

/** Library-relative path in canonical (forward slash) form. */
export function toRelativePath(libraryPath: string, absolutePath: string): string {
  const rel = relative(normalizePath(libraryPath), normalizePath(absolutePath));
  return rel.split(sep).join('/');
}

/** The immediate containing folder name, or '' for a file at the library root. */
export function parentFolderName(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/**
 * Rejects paths that are empty, relative, or contain NUL. Everything arriving over IPC or
 * read from the index goes through this before touching the filesystem.
 */
export function isSafeAbsolutePath(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input.length > 0 &&
    input.length < 32_768 &&
    !input.includes('\0') &&
    isAbsolute(input)
  );
}

/** Splits a filename into base name and extension (extension includes the dot). */
export function splitFilename(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return { base: filename, ext: '' };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}
