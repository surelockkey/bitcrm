import { createHash, randomBytes } from 'node:crypto';

/** A client-portal bearer token: 32 random bytes, base64url. Only its hash is stored. */
export function generatePortalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashPortalToken(token) };
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check before touching the table. */
export function isPlausibleToken(token: string | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}
