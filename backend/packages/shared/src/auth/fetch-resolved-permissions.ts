import { Logger } from '@nestjs/common';
import { type ResolvedPermissions } from '@bitcrm/types';

const logger = new Logger('fetchResolvedPermissions');

/**
 * Ask user-service to resolve a user's effective permissions.
 *
 * The one place this HTTP call is written. `PermissionGuard` uses it on every
 * Redis cache miss, and services that need a field-level grant on an *ungated*
 * handler use it too — those handlers never run the guard, so nothing has
 * populated `request.resolvedPermissions` for them.
 *
 * The `x-internal-secret` header is sent even though the route is still
 * `@Public()`. Closing that route is a separate, later commit and every caller
 * has to be sending the header first; keeping the call in one function is what
 * makes that second commit a one-line change rather than a hunt.
 */
export async function fetchResolvedPermissions(
  userServiceUrl: string,
  userId: string,
): Promise<ResolvedPermissions | null> {
  try {
    const response = await fetch(
      `${userServiceUrl}/api/users/internal/permissions/${userId}`,
      {
        headers: {
          'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '',
        },
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as ResolvedPermissions;
  } catch (error) {
    logger.warn(
      `Failed to resolve permissions for user ${userId}: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}
