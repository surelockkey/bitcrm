import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Restricts service-to-service ("internal") endpoints to callers that present a
 * matching `x-internal-secret` header. Mirrors the guard used by the other
 * services so a single INTERNAL_SERVICE_SECRET works across the mesh.
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
