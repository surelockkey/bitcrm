import { BadGatewayException, HttpException, Logger } from '@nestjs/common';
import type { BusinessMetricsService } from '@bitcrm/shared';
import { INTERNAL_SERVICE_SECRET } from '../common/constants/services.constants';

/** Injection token for a `fetch` replacement — tests only; production uses the global. */
export const INTERNAL_FETCH = 'BILLING_INTERNAL_FETCH';

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }>;

export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export interface InternalRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Answer `null` instead of throwing on 404. */
  nullOn404?: boolean;
  /** Replaces the internal-secret header (e.g. a forwarded user bearer). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  operation: string;
}

/**
 * `fetch` + the `x-internal-secret` header + the `{ success, data }` envelope,
 * for billing's peers. 4xx answers keep their status (a deal-service 409/422
 * is the caller's problem, not a gateway failure); everything else is a 502.
 */
export class InternalHttp {
  private readonly logger = new Logger(InternalHttp.name);

  constructor(
    private readonly target: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike,
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async request<T>(path: string, req: InternalRequest): Promise<T | null> {
    const timer = this.metrics?.internalHttpDuration.startTimer({
      target_service: this.target,
      operation: req.operation,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 15_000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: req.method ?? 'GET',
        headers: {
          ...(req.headers ?? { 'x-internal-secret': INTERNAL_SERVICE_SECRET }),
          ...(req.body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(req.body !== undefined && { body: JSON.stringify(req.body) }),
        signal: controller.signal,
      });
      if (res.status === 404 && req.nullOn404) return null;
      if (res.status === 204) return null;
      const payload = (await res.json().catch(() => null)) as
        | { data?: T; error?: { message?: string; code?: string }; message?: string }
        | null;
      if (!res.ok) {
        const message =
          payload?.error?.message ?? payload?.message ?? `${this.target} ${req.operation} failed (${res.status})`;
        if (res.status >= 400 && res.status < 500) {
          throw new HttpException(message, res.status);
        }
        throw new BadGatewayException(message);
      }
      if (payload && typeof payload === 'object' && 'data' in payload) return (payload.data ?? null) as T | null;
      return (payload as T) ?? null;
    } catch (err) {
      if (!(err instanceof HttpException) || err.getStatus() >= 500) {
        this.metrics?.internalHttpErrors.inc({ target_service: this.target, operation: req.operation });
      }
      if (err instanceof HttpException) throw err;
      this.logger.warn(`${this.target} ${req.operation} failed: ${(err as Error).message}`);
      throw new BadGatewayException(`${this.target} service unavailable`);
    } finally {
      clearTimeout(timeout);
      timer?.();
    }
  }
}
