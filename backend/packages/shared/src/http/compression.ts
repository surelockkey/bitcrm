import compression from 'compression';
import type { Request, Response } from 'express';

/**
 * Gzip on the way out.
 *
 * Responses left the services uncompressed, so a job's catalogs — 190 KB of
 * JSON that gzips to a fraction of that — cost a dispatcher over a second of
 * transfer on top of the query, and that was true of every response in the
 * app. It is the cheapest second we will ever get back.
 *
 * A stream must not be gzipped: compressing it means buffering it, and the
 * softphone and the inbox would get their events late or in clumps. The
 * library's own filter does NOT refuse `text/event-stream` — it is compressible
 * by the book — so the refusal is ours to make. `x-no-compression` on a
 * response says the same thing explicitly.
 */

/** Below this, the header costs more than the saving. */
export const COMPRESSION_THRESHOLD = 1024;

/** Content types that must reach the browser as they happen, not as a buffer. */
const STREAMING = /^text\/event-stream/i;

export function shouldCompress(req: Request, res: Response): boolean {
  if (res.getHeader('x-no-compression')) return false;
  if (STREAMING.test(String(res.getHeader('content-type') ?? ''))) return false;
  return compression.filter(req, res);
}

export function compressionMiddleware() {
  return compression({ threshold: COMPRESSION_THRESHOLD, filter: shouldCompress });
}
