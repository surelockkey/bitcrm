import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The client's "confirm your appointment" link — Workiz `{{confirm_link}}`.
 *
 * One link per job, stateless: the token is the job's id and an HMAC of it,
 * so nothing is stored, a reminder sent twice carries the same link, and the
 * service that renders the text (messaging) and the one that answers the tap
 * (billing's public portal routes) agree without talking to each other.
 *
 *   token = base64url(the job's uuid, 16 bytes)            22 chars
 *         + base64url(HMAC-SHA256(secret, "client-confirm:v1:<id>")[0..16])   22 chars
 *
 * The secret is the portal tokens' one (`PORTAL_TOKEN_SECRET`, else the
 * `INTERNAL_SERVICE_SECRET` every service carries), domain-separated by the
 * label, so a portal token can never pass for a confirm token. Rotating it
 * orphans the links already sent; whether a link may still act is the job's
 * business (done, canceled, the visit over), decided by deal-service.
 */
const LABEL = 'client-confirm:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{44}$/;

type Env = Record<string, string | undefined>;

/** The HMAC key: the portal tokens' secret, else the internal one; empty = no links. */
export function clientConfirmSecret(env: Env = process.env): string {
  return env.PORTAL_TOKEN_SECRET || env.INTERNAL_SERVICE_SECRET || '';
}

/**
 * The client portal's origin. Billing gets `PORTAL_BASE_URL` from the task
 * definition; every task also carries the SSM parameter it is built from
 * (`/bitcrm/dev/app/portal-domain` → `APP_PORTAL_DOMAIN`). Empty = unknown.
 */
export function clientConfirmPortalBase(env: Env = process.env): string {
  const base = env.PORTAL_BASE_URL || (env.APP_PORTAL_DOMAIN ? `https://${env.APP_PORTAL_DOMAIN}` : '');
  return base.replace(/\/+$/, '');
}

function signature(dealId: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${LABEL}${dealId}`).digest().subarray(0, 16);
}

/** The job's token, or null for an id that is not a uuid or without a secret. */
export function signClientConfirmToken(dealId: string, secret: string = clientConfirmSecret()): string | null {
  const id = dealId?.toLowerCase();
  if (!secret || !id || !UUID.test(id)) return null;
  const idBytes = Buffer.from(id.replace(/-/g, ''), 'hex');
  return idBytes.toString('base64url') + signature(id, secret).toString('base64url');
}

/** The job a token names, or null when it is malformed, forged or signed with another secret. */
export function verifyClientConfirmToken(token: string, secret: string = clientConfirmSecret()): string | null {
  if (!secret || typeof token !== 'string' || !TOKEN.test(token)) return null;
  const idBytes = Buffer.from(token.slice(0, 22), 'base64url');
  const given = Buffer.from(token.slice(22), 'base64url');
  if (idBytes.length !== 16 || given.length !== 16) return null;
  // The 22nd character of each half carries spare bits the decoder ignores:
  // only the spelling this module writes is the link, never a sibling of it.
  if (idBytes.toString('base64url') + given.toString('base64url') !== token) return null;
  const hex = idBytes.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return timingSafeEqual(given, signature(id, secret)) ? id : null;
}

/** `<portal>/confirm/<token>`, or undefined when the portal or the secret is unknown. */
export function clientConfirmUrl(
  dealId: string,
  opts: { portalBase?: string; secret?: string } = {},
): string | undefined {
  const base = (opts.portalBase ?? clientConfirmPortalBase()).replace(/\/+$/, '');
  const token = signClientConfirmToken(dealId, opts.secret ?? clientConfirmSecret());
  return base && token ? `${base}/confirm/${token}` : undefined;
}
