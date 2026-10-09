import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { isSubcontractor, type LoginChallengeResponse, type LoginResponse, type User } from '@bitcrm/types';
import { UsersRepository } from '../users/users.repository';
import { UsersCacheService } from '../users/users-cache.service';
import { TwilioVerifyClient } from './twilio-verify.client';

/** How long a texted sign-in code may take to come back. */
const LOGIN_TTL_S = 300;
/** How long a code sent to switch the second step on stays good. */
const ENROLL_TTL_S = 600;
/** Wrong codes a challenge survives before the sign-in has to start over. */
const MAX_ATTEMPTS = 5;

interface LoginChallenge {
  userId: string;
  phone: string;
  tokens: LoginResponse;
  attempts: number;
}

interface Enrollment {
  phone: string;
  attempts: number;
}

type SmsChallenge = Extract<LoginChallengeResponse, { challengeName: 'SMS_MFA' }>;

const loginKey = (session: string) => `mfa:login:${session}`;
const enrollKey = (userId: string) => `mfa:enroll:${userId}`;

/** `+14045551234` → `•••• 1234`: enough to recognise the phone, not to dial it. */
export const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;

/**
 * Two-step sign-in by SMS (Twilio Verify).
 *
 * Cognito still checks the password. When the account has the second step
 * on, the tokens Cognito just issued are held here — in Redis, for five
 * minutes, under a random session id — and never reach the browser until the
 * code texted to the account's phone comes back. Five wrong codes burn the
 * challenge; the sign-in starts over from the password.
 *
 * Switching it on is proved, not declared: a code goes to the number on the
 * profile, and only that code coming back flips the flag. An admin can flip
 * it for someone (off for a lost phone, on for a person who has a number);
 * the person's next sign-in is what texts that number.
 *
 * Refreshing a session does not ask again — as with Cognito's own MFA, the
 * second step guards the sign-in, and a refresh token is its product.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly redis: RedisService,
    private readonly repository: UsersRepository,
    private readonly cache: UsersCacheService,
    private readonly twilio: TwilioVerifyClient,
  ) {}

  /** After the password: the tokens themselves, or a challenge that holds them back. */
  async gate(tokens: LoginResponse): Promise<LoginResponse | SmsChallenge> {
    const userId = userIdOf(tokens.idToken);
    const user = userId ? await this.repository.findById(userId) : null;
    if (!user?.smsMfaEnabled) return tokens;
    if (!user.phone) {
      // On, with nowhere to send the code. Letting them in would switch the
      // second step off by deleting a phone; an admin switches it off instead.
      throw new UnauthorizedException(
        'Two-step sign-in is on but there is no phone to text. Ask an admin to switch it off.',
      );
    }

    await this.twilio.send(user.phone);
    const session = randomBytes(32).toString('base64url');
    const challenge: LoginChallenge = { userId: user.id, phone: user.phone, tokens, attempts: 0 };
    await this.redis.client.set(loginKey(session), JSON.stringify(challenge), 'EX', LOGIN_TTL_S);
    return { challengeName: 'SMS_MFA', session, destination: maskPhone(user.phone) };
  }

  /** The code came back: the held tokens, once. */
  async verify(session: string, code: string): Promise<LoginResponse> {
    const challenge = await this.read<LoginChallenge>(loginKey(session));
    if (!challenge) throw new UnauthorizedException('This code has expired. Sign in again.');

    if (!(await this.twilio.check(challenge.phone, code))) {
      await this.countMiss(loginKey(session), challenge);
      throw new UnauthorizedException('That code is not right.');
    }
    await this.redis.client.del(loginKey(session));
    return challenge.tokens;
  }

  /** Text the sign-in code again, to the same number. */
  async resend(session: string): Promise<{ destination: string }> {
    const challenge = await this.read<LoginChallenge>(loginKey(session));
    if (!challenge) throw new UnauthorizedException('This code has expired. Sign in again.');
    await this.twilio.send(challenge.phone);
    return { destination: maskPhone(challenge.phone) };
  }

  /** Switching it on, step one: a code to the number on the profile. */
  async startEnrollment(userId: string): Promise<{ destination: string }> {
    const user = await this.find(userId);
    if (!user.phone) throw new BadRequestException('Add your phone to your profile first.');
    await this.twilio.send(user.phone);
    const enrollment: Enrollment = { phone: user.phone, attempts: 0 };
    await this.redis.client.set(enrollKey(userId), JSON.stringify(enrollment), 'EX', ENROLL_TTL_S);
    return { destination: maskPhone(user.phone) };
  }

  /** Step two: the code came back from that number — switch it on. */
  async confirmEnrollment(userId: string, code: string): Promise<User> {
    const enrollment = await this.read<Enrollment>(enrollKey(userId));
    if (!enrollment) throw new BadRequestException('Send a code to your phone first.');

    const user = await this.find(userId);
    if (user.phone !== enrollment.phone) {
      await this.redis.client.del(enrollKey(userId));
      throw new BadRequestException('Your phone changed since the code was sent. Send a new code.');
    }
    if (!(await this.twilio.check(enrollment.phone, code))) {
      await this.countMiss(enrollKey(userId), enrollment);
      throw new BadRequestException('That code is not right.');
    }
    await this.redis.client.del(enrollKey(userId));
    return this.write(userId, true);
  }

  async disable(userId: string): Promise<User> {
    return this.write(userId, false);
  }

  /** An admin's switch: off for anyone, on for anyone with a phone to text. */
  async setByAdmin(userId: string, enabled: boolean): Promise<User> {
    if (enabled) {
      const user = await this.find(userId);
      if (isSubcontractor(user)) throw new BadRequestException('A subcontractor cannot sign in, so there is no sign-in to protect.');
      if (!user.phone) throw new BadRequestException('This person has no phone on their profile to text the code to.');
    }
    return this.write(userId, enabled);
  }

  private async find(userId: string): Promise<User> {
    const user = await this.repository.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async write(userId: string, enabled: boolean): Promise<User> {
    await this.find(userId);
    const updated = await this.repository.update(userId, { smsMfaEnabled: enabled });
    await this.cache.invalidateUser(userId);
    return updated;
  }

  private async read<T>(key: string): Promise<T | null> {
    const raw = await this.redis.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async countMiss(key: string, state: { attempts: number }): Promise<void> {
    const attempts = state.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.redis.client.del(key);
      return;
    }
    await this.redis.client.set(key, JSON.stringify({ ...state, attempts }), 'KEEPTTL');
  }
}

/**
 * Whose tokens these are. The id token came straight from Cognito on this
 * request, over TLS, so its payload is read, not re-verified.
 */
function userIdOf(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload['custom:user_id'] === 'string' ? payload['custom:user_id'] : undefined;
  } catch {
    return undefined;
  }
}
