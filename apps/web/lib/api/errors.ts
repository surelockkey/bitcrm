/** Error thrown for any non-2xx response or a `{ success: false }` envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** A custom field the backend requires filled before a job can be closed. */
export interface MissingCloseField {
  id: string;
  name: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * The required-to-close custom fields the backend reported unfilled when a
 * status move to a terminal state was rejected (HTTP 422 with a
 * `{ missingFields:[{id,name}] }` body). Returns `null` for any other error so
 * callers fall back to the plain message.
 */
export function getMissingCloseFields(error: unknown): MissingCloseField[] | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  if (!isRecord(error.body)) return null;
  const raw = error.body.missingFields;
  if (!Array.isArray(raw)) return null;
  const fields = raw.filter(
    (f): f is MissingCloseField =>
      isRecord(f) && typeof f.id === "string" && typeof f.name === "string" && f.name !== "",
  );
  return fields.length ? fields : null;
}

/** Best-effort human-readable message from any thrown value. */
export function getApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
