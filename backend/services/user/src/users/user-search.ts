/**
 * The directory's `search`: case-insensitive "contains" over the first name,
 * the last name, the full name and the email.
 *
 * It is matched in the service, over rows already read, not as a DynamoDB
 * FilterExpression: `contains` there is case-sensitive, and the stored names
 * are mixed-case ("John", "McDonald"), so a case-insensitive filter would need
 * a lowercased copy on every user and a backfill to write it. It would not
 * save a read either — every list path but the role one is a filtered Scan of
 * the whole users table (there is no index by name), and a FilterExpression is
 * applied after the read and billed the same. What the service-side match
 * costs is the ~600 user bodies crossing the wire instead of the matches.
 */

/** The term as it is matched: trimmed, lowercased, inner whitespace collapsed; blank is none. */
export function normalizeUserSearch(raw: string | undefined): string | undefined {
  const term = raw?.trim().toLowerCase().replace(/\s+/g, ' ');
  return term ? term : undefined;
}

export interface SearchableUser {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '');

/** Does the user's name or email contain the (already normalised) term? */
export function userMatchesSearch(user: SearchableUser, term: string): boolean {
  const first = text(user.firstName);
  const last = text(user.lastName);
  return [first, last, `${first} ${last}`, text(user.email)].some((field) => field.includes(term));
}

/** The attributes a match reads — what a searched count projects. */
export const USER_SEARCH_ATTRIBUTES = ['firstName', 'lastName', 'email'] as const;
