import type { AudioLibraryApi, IpcResponse } from '../../shared/types';

declare global {
  interface Window {
    audioLibrary: AudioLibraryApi;
  }
}

export const api: AudioLibraryApi = window.audioLibrary;

/** Raised for a failed IPC call so callers can use ordinary try/catch. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Unwraps the IPC result envelope. Every main-process call returns success or a described
 * error rather than throwing across the bridge, so this is where that becomes an exception.
 */
export async function unwrap<T>(call: Promise<IpcResponse<T>>): Promise<T> {
  const response = await call;
  if (!response.ok) throw new ApiError(response.error.message, response.error.code);
  return response.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
