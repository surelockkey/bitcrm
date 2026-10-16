import { Injectable } from '@nestjs/common';
import { type RegisterPushTokenDto } from './dto/register-push-token.dto';
import { PushRepository } from './push.repository';

/** The caller's own devices — there is no way to touch anyone else's. */
@Injectable()
export class PushTokensService {
  constructor(private readonly repository: PushRepository) {}

  register(userId: string, dto: RegisterPushTokenDto): Promise<void> {
    return this.repository.register(userId, dto.token, dto.platform);
  }

  /** An unknown token, or one that has since moved to another user, changes nothing for them. */
  unregister(userId: string, token: string): Promise<void> {
    return this.repository.unregister(userId, token);
  }
}
