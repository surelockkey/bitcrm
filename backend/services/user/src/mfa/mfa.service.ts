import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { RedisService, normalizePhone } from '@bitcrm/shared';
import {
  isSubcontractor,
  type LoginResponse,
  type MfaSetupChallenge,
  type SmsMfaChallenge,
  type User,
} from '@bitcrm/types';
import { UsersRepository } from '../users/users.repository';
import { UsersCacheService } from '../users/users-cache.service';
import { UsersService } from '../users/users.service';
import { EmailCodeSender } from '../security/email-code.sender';
import { SecurityService } from '../security/security.service';
import { TwilioVerifyClient } from './twilio-verify.client';

/** How long a texted sign-in code may take to come back. */
const LOGIN_TTL_S = 300;
/** How long a code sent to switch the second step on stays good. */
const ENROLL_TTL_S = 600;
/** How long an emailed sign-in code counts. */
const EMAIL_CODE_TTL_MS = 5 * 60_000;
/** Wrong codes a challenge survives before the sign-in has to start over. */
const MAX_ATTEMPTS = 5;

interface LoginChallenge {
  userId: string;
  email: string;
  /**
   * Where the texted code goes. On a setup (`setup: true`) it is the number
   * the person gave on the way in — absent until they do — and it reaches
   * their profile only once its code comes back.
   */
  phone?: string;
  setup?: boolean;
  /** A code mailed on request: its hash, and when it stops counting. The code itself is never stored. */
  emailCode?: { hash: string; expiresAt: number };
  tokens: LoginResponse;
  attempts: number;
}

interface Enrollment {
  phone: string;
  attempts: number;
}

const loginKey = (session: string) => `mfa:login:${session}`;
const enrollKey = (userId: string) => `mfa:enroll:${userId}`;

/** `+14045551234` → `•••• 1234`: enough to recognise the phone, not to dial it. */
export const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;

/** `bob@x.com` → `b•••@x.com`: enough to recognise the inbox, not to write to it. */
export const maskEmail = (email: string) => {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
};

/**
 * Two-step sign-in by SMS (Twilio Verify).
 *
 * Cognito still checks the password. When the account has the second step
 * on, the tokens Cognito just issued are held here — in Redis, for five
 * minutes, under a random session id — and never reach the browser until the
 * code texted to the account's phone comes back. Five wrong codes burn the
 * challenge; the sign-in starts over from the password.
 *
 * Settings → Security Center adds the account's say (`SecurityService`):
 * - "Require Two-factor authentication": everyone but a subcontractor gets
 *   the second step whatever their own switch says, and nobody's switch can
 *   go off. Someone with no phone is answered with an `MFA_SETUP` challenge:
 *   the tokens wait while they give a phone (`setupPhone`) and its code
 *   comes back (`verify`), which also writes the phone to their profile and
 *   switches their second step on.
 * - "Login sending options": the code may also go to the account's email on
 *   request (`sendEmailCode`); either code then opens the sign-in.
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
    private readonly security: SecurityService,
    private readonly usersService: UsersService,
    @Optional() private readonly emailCodes?: EmailCodeSender,
  ) {}

  /** After the password: the tokens themselves, or a challenge that holds them back. */
  async gate(tokens: LoginResponse): Promise<LoginResponse | SmsMfaChallenge | MfaSetupChallenge> {
    const userId = userIdOf(tokens.idToken);
    const user = userId ? await this.repository.findById(userId) : null;
    if (!user) return tokens;

    const settings = await this.security.getSettings();
    const required = settings.requireMfa && !isSubcontractor(user);
    if (!user.smsMfaEnabled && !required) return tokens;

    if (!user.phone) {
      if (required) {
        // The account insists, and there is nowhere to text: the phone is
        // set up on the way in, with the tokens waiting.
        const session = await this.open({ userId: user.id, email: user.email, setup: true, tokens, attempts: 0 });
        return { challengeName: 'MFA_SETUP', session };
      }
      // On, with nowhere to send the code. Letting them in would switch the
      // second step off by deleting a phone; an admin switches it off instead.
      throw new UnauthorizedException(
        'Two-step sign-in is on but there is no phone to text. Ask an admin to switch it off.',
      );
    }

    await this.twilio.send(user.phone);
    const session = await this.open({ userId: user.id, email: user.email, phone: user.phone, tokens, attempts: 0 });
    const byEmail = settings.loginCodeByEmail && this.emailCodes?.available;
    return {
      challengeName: 'SMS_MFA',
      session,
      destination: maskPhone(user.phone),
      ...(byEmail ? { emailDestination: maskEmail(user.email) } : {}),
    };
  }

  /** The code came back: the held tokens, once. On a setup, the proved phone goes on the profile first. */
  async verify(session: string, code: string): Promise<LoginResponse> {
    const key = loginKey(session);
    const challenge = await this.read<LoginChallenge>(key);
    if (!challenge) throw new UnauthorizedException('This code has expired. Sign in again.');
    if (!challenge.phone) throw new BadRequestException('Give a phone to text the code to first.');

    const ok = matchesEmailCode(challenge, session, code) || (await this.twilio.check(challenge.phone, code));
    if (!ok) {
      await this.countMiss(key, challenge);
      throw new UnauthorizedException('That code is not right.');
    }
    await this.redis.client.del(key);

    if (challenge.setup) {
      await this.usersService.setPhone(challenge.userId, challenge.phone);
      await this.repository.update(challenge.userId, { smsMfaEnabled: true });
      await this.cache.invalidateUser(challenge.userId);
    }
    return challenge.tokens;
  }

  /** Text the sign-in code again, to the same number. */
  async resend(session: string): Promise<{ destination: string }> {
    const challenge = await this.read<LoginChallenge>(loginKey(session));
    if (!challenge) throw new UnauthorizedException('This code has expired. Sign in again.');
    if (!challenge.phone) throw new BadRequestException('Give a phone to text the code to first.');
    await this.twilio.send(challenge.phone);
    return { destination: maskPhone(challenge.phone) };
  }

  /**
   * An `MFA_SETUP` challenge: the phone the person will sign in with. It is
   * checked against the team's numbers, texted, and remembered on the
   * challenge — their profile gets it only once the code comes back. They
   * may give another number before that.
   */
  async setupPhone(session: string, raw: string): Promise<{ destination: string }> {
    const key = loginKey(session);
    const challenge = await this.read<LoginChallenge>(key);
    if (!challenge) throw new UnauthorizedException('This sign-in has expired. Sign in again.');
    if (!challenge.setup) throw new BadRequestException('This sign-in already has a phone to text.');

    const phone = normalizePhone(raw);
    const owner = await this.repository.findByPhone(phone);
    if (owner && owner.id !== challenge.userId) {
      throw new ConflictException(`${phone} is already on ${owner.firstName} ${owner.lastName}'s profile.`);
    }
    await this.twilio.send(phone);
    await this.redis.client.set(key, JSON.stringify({ ...challenge, phone }), 'KEEPTTL');
    return { destination: maskPhone(phone) };
  }

  /**
   * "Login sending options": the code to the account's email instead. A
   * fresh six-digit code is minted here (Twilio's stays good too), mailed,
   * and only its hash waits with the challenge.
   */
  async sendEmailCode(session: string): Promise<{ destination: string }> {
    const key = loginKey(session);
    const challenge = await this.read<LoginChallenge>(key);
    if (!challenge) throw new UnauthorizedException('This code has expired. Sign in again.');
    if (challenge.setup) throw new BadRequestException('Set up your phone first.');

    const settings = await this.security.getSettings();
    if (!settings.loginCodeByEmail) throw new BadRequestException('Your account does not send sign-in codes by email.');
    if (!this.emailCodes?.available) throw new ServiceUnavailableException('Sign-in codes by email are not set up on this server.');

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.emailCodes.send(challenge.email, code);
    const emailCode = { hash: hashCode(session, code), expiresAt: Date.now() + EMAIL_CODE_TTL_MS };
    await this.redis.client.set(key, JSON.stringify({ ...challenge, emailCode }), 'KEEPTTL');
    return { destination: maskEmail(challenge.email) };
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

  /** The person's own switch off — not while the account requires it. */
  async disable(userId: string): Promise<User> {
    const user = await this.find(userId);
    if (await this.requiredFor(user)) {
      throw new BadRequestException('Two-factor authentication is required by your account and cannot be switched off.');
    }
    return this.write(userId, false);
  }

  /** An admin's switch: off for anyone (unless the account requires it), on for anyone with a phone to text. */
  async setByAdmin(userId: string, enabled: boolean): Promise<User> {
    const user = await this.find(userId);
    if (enabled) {
      if (isSubcontractor(user)) throw new BadRequestException('A subcontractor cannot sign in, so there is no sign-in to protect.');
      if (!user.phone) throw new BadRequestException('This person has no phone on their profile to text the code to.');
    } else if (await this.requiredFor(user)) {
      throw new BadRequestException(
        "Two-factor authentication is required by the account. For a lost phone, change the person's phone instead.",
      );
    }
    return this.write(userId, enabled);
  }

  /** Whether the account's requirement reaches this person: everyone but a subcontractor. */
  private async requiredFor(user: User): Promise<boolean> {
    if (isSubcontractor(user)) return false;
    return (await this.security.getSettings()).requireMfa;
  }

  private async open(challenge: LoginChallenge): Promise<string> {
    const session = randomBytes(32).toString('base64url');
    await this.redis.client.set(loginKey(session), JSON.stringify(challenge), 'EX', LOGIN_TTL_S);
    return session;
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

/** The emailed code's fingerprint: bound to its session, so a hash is worth nothing elsewhere. */
function hashCode(session: string, code: string): string {
  return createHash('sha256').update(`${session}:${code}`).digest('hex');
}

function matchesEmailCode(challenge: LoginChallenge, session: string, code: string): boolean {
  const pending = challenge.emailCode;
  if (!pending || pending.expiresAt <= Date.now()) return false;
  const expected = Buffer.from(pending.hash, 'hex');
  const given = Buffer.from(hashCode(session, code), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
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
