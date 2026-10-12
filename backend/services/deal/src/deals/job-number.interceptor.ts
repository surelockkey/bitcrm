import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { hasPermission } from '@bitcrm/shared';

/** Deep enough for `{ data: Deal }`, `{ data: Deal[] }` and `{ data: { deal: Deal } }`. */
const MAX_DEPTH = 3;

function strip(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => strip(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'clientPhone') continue;
    out[key] = strip(v, depth + 1);
  }
  return out;
}

/** The answer without any job's own first number (`clientPhone`). */
export function withoutJobNumber<T>(body: T): T {
  return strip(body, 0) as T;
}

/**
 * A job's own first number is a client's number. crm hands those only to
 * `contacts.view_numbers`, so this keeps deal-service from handing this one
 * to everybody with `deals.view` — on every route of the controller it
 * guards. A service-to-service read (`@Internal`, no signed-in user) gets
 * the whole job: telephony dials that number.
 */
@Injectable()
export class JobNumberInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: unknown; resolvedPermissions?: never }>();
    if (!request?.user || hasPermission(request.resolvedPermissions, 'contacts', 'view_numbers')) return next.handle();
    return next.handle().pipe(map(withoutJobNumber));
  }
}
