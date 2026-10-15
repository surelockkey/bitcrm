import type { IncomingMessage } from 'node:http';

/**
 * The extra fields on a request's log lines: its trace id and, once
 * `CognitoAuthGuard` has run, who made it (`userId`, `roleId` — never the
 * email; the id maps to a person in one lookup).
 *
 * This is pino-http's `customProps`, and it has to be: the `req` serializer is
 * bound when the request arrives, before any guard, so a caller read there is
 * always empty. `customProps` is evaluated again when the response finishes,
 * which is the "request completed" line. By then the trace id is already bound
 * (from the first call), so only the caller is added — returning it again would
 * print `traceId` twice on that line.
 */
export function requestLogProps(req: IncomingMessage): Record<string, string> {
  const { id, user } = req as IncomingMessage & {
    id?: string;
    user?: { id?: string; roleId?: string };
  };
  if (!user?.id) return { traceId: id as string };
  return { userId: user.id, ...(user.roleId && { roleId: user.roleId }) };
}
