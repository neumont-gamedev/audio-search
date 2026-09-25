import { useCallback, useRef, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DISMISS_MS = 3200;

/**
 * Brief, non-blocking confirmations. Routine actions like copying a path should never
 * interrupt the workflow with a modal.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((previous) => [...previous, { id, kind, message }]);
    setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, DISMISS_MS);
  }, []);

  return {
    toasts,
    info: useCallback((message: string) => push('info', message), [push]),
    success: useCallback((message: string) => push('success', message), [push]),
    error: useCallback((message: string) => push('error', message), [push]),
  };
}
