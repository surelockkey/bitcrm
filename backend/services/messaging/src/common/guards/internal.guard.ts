import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Service-to-service routes: authenticated by the `x-internal-secret` header
 * (`INTERNAL_SERVICE_SECRET`), the same way crm/deal/user/inventory/search
 * gate theirs. Used through `@Internal()`, which also marks the route
 * `@Public()` so the Cognito guard steps aside.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-internal-secret'];
    const expected = process.env.INTERNAL_SERVICE_SECRET;

    if (!expected || secret !== expected) {
      throw new ForbiddenException('Internal access denied');
    }

    return true;
  }
}
