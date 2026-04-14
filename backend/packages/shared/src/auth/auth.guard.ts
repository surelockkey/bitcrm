import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PermissionCacheReader } from './permission-cache-reader';

function extractBearerToken(request: { headers: Record<string, string | undefined> }): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const [type, token] = authorization.split(' ');
  return type === 'Bearer' ? token ?? null : null;
}

@Injectable()
export class CognitoAuthGuard implements CanActivate {
  private readonly logger = new Logger(CognitoAuthGuard.name);
  private verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

  constructor(
    private reflector: Reflector,
    private cacheReader: PermissionCacheReader,
  ) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (userPoolId && clientId) {
      this.verifier = CognitoJwtVerifier.create({
        userPoolId,
        clientId,
        tokenUse: 'id',
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!this.verifier) {
      this.logger.warn('Auth rejected: Cognito is not configured');
      throw new UnauthorizedException('Cognito is not configured');
    }

    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request);
    if (!token) {
      this.logger.warn(`Auth rejected: missing token for ${request.method} ${request.url}`);
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.verifier.verify(token);
      const userId = payload['custom:user_id'] as string;

      // Check if user has been deactivated
      if (userId) {
        const isDisabled = await this.cacheReader.isUserDisabled(userId);
        if (isDisabled) {
          this.logger.warn(`Auth rejected: deactivated user ${userId} attempted access`);
          throw new UnauthorizedException('Account has been deactivated');
        }
      }

      request.user = {
        id: userId,
        cognitoSub: payload.sub,
        email: (payload as Record<string, unknown>).email || payload['username' as keyof typeof payload],
        roleId: payload['custom:role_id'],
        department: payload['custom:department'],
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(`Auth rejected: invalid token for ${request.method} ${request.url}`);
      throw new UnauthorizedException();
    }
  }
}
