import { AsyncLocalStorage } from 'async_hooks';

/** Async-local storage holding the current trace ID */
export const storage = new AsyncLocalStorage<string>();

/** Get the current trace ID (works in both HTTP and SQS handler contexts) */
export function getTraceId(): string | undefined {
  return storage.getStore();
}
