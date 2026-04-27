import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

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
