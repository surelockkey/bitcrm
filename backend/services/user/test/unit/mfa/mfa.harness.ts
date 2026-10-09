import type { LoginResponse, SecuritySettings, User } from '@bitcrm/types';
import { MfaService } from '../../../src/mfa/mfa.service';

/**
 * The pieces every two-step sign-in spec builds on: a Redis that keeps
 * strings with a TTL, a Cognito id token for a user, and a service wired to
 * hand-rolled collaborators.
 */

/** Enough of ioredis for the store: string values with a TTL. */
export function fakeRedis() {
  const data = new Map<string, { value: string; ttl?: number }>();
  return {
    data,
    set: jest.fn(async (key: string, value: string, ...args: (string | number)[]) => {
      const keep = args.includes('KEEPTTL');
      const ex = args.indexOf('EX');
      data.set(key, { value, ttl: keep ? data.get(key)?.ttl : ex >= 0 ? Number(args[ex + 1]) : undefined });
      return 'OK';
    }),
    get: jest.fn(async (key: string) => data.get(key)?.value ?? null),
    del: jest.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
  };
}

export function idToken(userId: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64({ 'custom:user_id': userId, email: 'x@y.z' })}.sig`;
}

export const tokens = (userId = 'u-1'): LoginResponse => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  idToken: idToken(userId),
  expiresIn: 3600,
});

export const user = (extra: Partial<User> = {}): User => ({
  id: 'u-1',
  cognitoSub: 'sub-1',
  email: 'bob@x.com',
  firstName: 'Bob',
  lastName: 'Ray',
  roleId: 'r',
  department: 'ops',
  phone: '+14045551234',
  status: 'active' as User['status'],
  createdAt: '',
  updatedAt: '',
  ...extra,
});

export interface HarnessOptions {
  /** The account's Security Center row; nothing required by default. */
  settings?: Partial<SecuritySettings>;
  /** Whether the server can mail a code (`MESSAGING_EMAIL_FROM` set). */
  emailAvailable?: boolean;
  /** Who holds which other numbers (the phone index) — a setup must not take a teammate's. */
  phoneOwners?: Record<string, User>;
}

export function make(stored: User = user(), options: HarnessOptions = {}) {
  const redis = fakeRedis();
  let current = stored;
  const repository = {
    findById: jest.fn(async () => current),
    update: jest.fn(async (_id: string, attrs: Partial<User>) => (current = { ...current, ...attrs })),
    findByPhone: jest.fn(async (phone: string) => options.phoneOwners?.[phone] ?? null),
  };
  const cache = { invalidateUser: jest.fn(async () => undefined) };
  const verify = { send: jest.fn(async () => undefined), check: jest.fn(async () => true) };
  const security = {
    getSettings: jest.fn(async () => ({ requireMfa: false, loginCodeByEmail: false, otpByEmail: false, ...options.settings })),
  };
  const usersService = {
    setPhone: jest.fn(async (_id: string, phone: string) => (current = { ...current, phone })),
  };
  const emailCodes = {
    available: options.emailAvailable ?? true,
    send: jest.fn(async () => undefined),
  };
  const svc = new MfaService(
    { client: redis } as never,
    repository as never,
    cache as never,
    verify as never,
    security as never,
    usersService as never,
    emailCodes as never,
  );
  return { svc, redis, repository, cache, verify, security, usersService, emailCodes, current: () => current };
}
