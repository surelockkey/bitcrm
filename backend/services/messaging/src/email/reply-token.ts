/**
 * The reply address that threads an answer back to its conversation
 * (design §5, variant A): `Reply-To: c-<conversationId>@<replyDomain>`. The
 * conversation id is a v4 uuid — unguessable enough that no signature is
 * needed on top, and it survives any mail client verbatim. When no replies
 * subdomain is configured the token rides as a plus-address on the sender
 * (`office+c-<id>@<domain>`), which most providers deliver to `office@`.
 *
 * Both halves live here so the outbound builder and the inbound resolver
 * cannot drift: `buildReplyAddress` writes what `parseReplyAddress` reads.
 */
export const REPLY_TOKEN_PREFIX = 'c-';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `c-<uuid>@<replyDomain>` */
const SUBDOMAIN_TOKEN = new RegExp(`^${REPLY_TOKEN_PREFIX}(${UUID})@(.+)$`, 'i');
/** `<local>+c-<uuid>@<domain>` */
const PLUS_TOKEN = new RegExp(`^[^@+]+\\+${REPLY_TOKEN_PREFIX}(${UUID})@(.+)$`, 'i');

export interface ReplyAddressConfig {
  fromAddress?: string;
  replyDomain?: string;
}

/** `undefined` when neither a replies subdomain nor a sender is configured. */
export function buildReplyAddress(conversationId: string, cfg: ReplyAddressConfig): string | undefined {
  if (cfg.replyDomain) return `${REPLY_TOKEN_PREFIX}${conversationId}@${cfg.replyDomain}`;
  if (!cfg.fromAddress) return undefined;
  const at = cfg.fromAddress.indexOf('@');
  if (at <= 0) return undefined;
  return `${cfg.fromAddress.slice(0, at)}+${REPLY_TOKEN_PREFIX}${conversationId}@${cfg.fromAddress.slice(at + 1)}`;
}

/**
 * The conversation id a recipient address carries, or `undefined`. The
 * domain is checked when one is configured so a token on some other domain
 * (a forwarded copy) never routes into our threads.
 */
export function parseReplyAddress(address: string, cfg: ReplyAddressConfig): string | undefined {
  const value = address.trim().toLowerCase();
  const sub = SUBDOMAIN_TOKEN.exec(value);
  if (sub) {
    if (cfg.replyDomain && sub[2] !== cfg.replyDomain) return undefined;
    return sub[1];
  }
  const plus = PLUS_TOKEN.exec(value);
  if (plus) {
    const fromDomain = cfg.fromAddress?.split('@')[1];
    if (fromDomain && plus[2] !== fromDomain) return undefined;
    return plus[1];
  }
  return undefined;
}

/** First conversation id found among the recipient addresses (To, Cc, envelope). */
export function findReplyToken(addresses: readonly string[], cfg: ReplyAddressConfig): string | undefined {
  for (const address of addresses) {
    const id = parseReplyAddress(address, cfg);
    if (id) return id;
  }
  return undefined;
}
