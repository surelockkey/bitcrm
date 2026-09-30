import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Server secret the portal tokens are derived from: `PORTAL_TOKEN_SECRET`, else
 * the `INTERNAL_SERVICE_SECRET` every service already carries. Empty → tokens are
 * random and cannot be recovered after creation (the pre-derivation behaviour).
 */
export const portalTokenSecret = (): string =>
  process.env.PORTAL_TOKEN_SECRET || process.env.INTERNAL_SERVICE_SECRET || '';

/**
 * A client-portal bearer token, base64url. Only its hash is stored.
 *
 * With a secret it is `HMAC(secret, contactId:nonce)`: the stored `nonce`
 * alone cannot rebuild it, but the service can, which is what lets a staff
 * member re-send the SAME link (SMS, copy) instead of regenerating one and
 * killing the URL the client already has. Without a secret it is 32 random
 * bytes and only ever shown once.
 */
export function generatePortalToken(contactId: string): { token: string; hash: string; nonce?: string } {
  const secret = portalTokenSecret();
  if (!secret) {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashPortalToken(token) };
  }
  const nonce = randomBytes(16).toString('base64url');
  const token = deriveToken(secret, contactId, nonce);
  return { token, hash: hashPortalToken(token), nonce };
}

/** Rebuilds a link's token from its stored nonce; null when the link is not recoverable. */
export function recoverPortalToken(contactId: string, nonce: string | undefined, hash: string): string | null {
  const secret = portalTokenSecret();
  if (!secret || !nonce) return null;
  const token = deriveToken(secret, contactId, nonce);
  // The secret may have been rotated since the link was made.
  return hashPortalToken(token) === hash ? token : null;
}

function deriveToken(secret: string, contactId: string, nonce: string): string {
  return createHmac('sha256', secret).update(`portal-token:v1:${contactId}:${nonce}`).digest('base64url');
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check before touching the table. */
export function isPlausibleToken(token: string | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}
