import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { ActivitySource } from '@bitcrm/types';

/**
 * Where the request that is writing a timeline event came from — Workiz's
 * laptop / phone icon on every Activity row. Held for the request in
 * async-local storage, so the timeline writer can read it without every
 * service method passing it down.
 */
const storage = new AsyncLocalStorage<ActivitySource | undefined>();

/** The source of the request being served, if one is known. */
export function currentActivitySource(): ActivitySource | undefined {
  return storage.getStore();
}

/** Runs `fn` as if serving a request from `source` (tests, scripts). */
export function withActivitySource<T>(source: ActivitySource | undefined, fn: () => T): T {
  return storage.run(source, fn);
}

/**
 * Decides the source from the request: an explicit `x-bitcrm-client: web |
 * mobile` wins; a service-to-service call (internal secret) is `system`; a
 * browser (`Mozilla/…`) is `web`; the mobile app's HTTP stacks (iOS
 * `CFNetwork`/`Darwin`, Android `okhttp`, Expo) are `mobile`. Anything else
 * stays unknown rather than guessed.
 */
export function activitySourceFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): ActivitySource | undefined {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const explicit = one(headers['x-bitcrm-client']).trim().toLowerCase();
  if (explicit === 'web' || explicit === 'mobile') return explicit;
  if (one(headers['x-internal-secret'])) return 'system';
  const ua = one(headers['user-agent']);
  if (/^Mozilla\//.test(ua)) return 'web';
  if (/okhttp|CFNetwork|Darwin|Expo|ReactNative/i.test(ua)) return 'mobile';
  return undefined;
}

@Injectable()
export class ActivitySourceMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    storage.run(activitySourceFromHeaders(req.headers), () => next());
  }
}
