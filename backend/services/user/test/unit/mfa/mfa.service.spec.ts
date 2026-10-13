import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { SecuritySettings } from '@bitcrm/types';
import { MfaService } from '../../../src/mfa/mfa.service';
import { SecurityService } from '../../../src/security/security.service';
import { make, tokens, user } from './mfa.harness';

/**
 * Two-step sign-in by SMS. Cognito checks the password; when the account has
 * the second step on, the tokens it issued wait server-side — never reaching
 * the browser — until the code texted to the account's phone comes back.
 * (The account-wide requirement and the code by email: mfa-required.spec.)
 */

describe('MfaService.gate — after the password', () => {
  it('reads the user and the security settings side by side, the settings fresh', async () => {
    const { svc, repository, security } = make(user({ smsMfaEnabled: false }));
    let releaseUser!: () => void;
    repository.findById.mockImplementation(
      () => new Promise((resolve) => (releaseUser = () => resolve(user({ smsMfaEnabled: false })))),
    );

    const answer = svc.gate(tokens());
    await new Promise((r) => setImmediate(r));
    expect(security.getSettings).toHaveBeenCalledTimes(1);
    releaseUser();

    await expect(answer).resolves.toEqual(tokens());
  });

  it('"Require 2FA" switched on through another task holds on the very next sign-in here', async () => {
    // One stored row, two tasks' SecurityServices over it.
    let row: SecuritySettings = { requireMfa: false, loginCodeByEmail: false, otpByEmail: false };
    const settingsRepo = () => ({
      get: jest.fn(async () => ({ ...row })),
      put: jest.fn(async (next: SecuritySettings) => void (row = next)),
      recordChange: jest.fn(async () => undefined),
      listChanges: jest.fn(async () => []),
    });
    const thisTask = new SecurityService(settingsRepo() as never, { available: true } as never);
    const otherTask = new SecurityService(settingsRepo() as never, { available: true } as never);
    const { repository, cache, verify, usersService, emailCodes, redis } = make(user({ smsMfaEnabled: false }));
    const svc = new MfaService(
      { client: redis } as never,
      repository as never,
      cache as never,
      verify as never,
      thisTask,
      usersService as never,
      emailCodes as never,
    );

    await expect(svc.gate(tokens())).resolves.toEqual(tokens());

    await otherTask.updateSettings({ requireMfa: true }, 'u-admin');

    await expect(svc.gate(tokens())).resolves.toMatchObject({ challengeName: 'SMS_MFA' });
    expect(verify.send).toHaveBeenCalledTimes(1);
  });

  it('hands the tokens straight back when the account has no second step', async () => {
    const { svc, verify } = make(user({ smsMfaEnabled: false }));

    await expect(svc.gate(tokens())).resolves.toEqual(tokens());
    expect(verify.send).not.toHaveBeenCalled();
  });

  it('holds the tokens back and texts a code when it does', async () => {
    const { svc, verify, redis } = make(user({ smsMfaEnabled: true }));

    const res = await svc.gate(tokens());

    expect(res).toEqual({ challengeName: 'SMS_MFA', session: expect.any(String), destination: '•••• 1234' });
    expect(JSON.stringify(res)).not.toContain('access');
    expect(verify.send).toHaveBeenCalledWith('+14045551234');
    const session = (res as { session: string }).session;
    expect(session.length).toBeGreaterThanOrEqual(32);
    expect(redis.data.get(`mfa:login:${session}`)?.ttl).toBe(300);
  });

  // On, but nowhere to send the code: refusing is the only safe answer.
  it('refuses the sign-in when the second step is on but there is no phone', async () => {
    const { svc } = make(user({ smsMfaEnabled: true, phone: undefined }));

    await expect(svc.gate(tokens())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('MfaService.verify — the code comes back', () => {
  async function challenged() {
    const ctx = make(user({ smsMfaEnabled: true }));
    const res = (await ctx.svc.gate(tokens())) as { session: string };
    return { ...ctx, session: res.session };
  }

  it('releases the held tokens for the right code, once', async () => {
    const { svc, verify, session } = await challenged();

    await expect(svc.verify(session, '123456')).resolves.toEqual(tokens());
    expect(verify.check).toHaveBeenCalledWith('+14045551234', '123456');
    await expect(svc.verify(session, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps the tokens back for a wrong code and lets the person try again', async () => {
    const { svc, verify, session } = await challenged();
    verify.check.mockResolvedValueOnce(false);

    await expect(svc.verify(session, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verify(session, '123456')).resolves.toEqual(tokens());
  });

  it('burns the challenge after five wrong codes', async () => {
    const { svc, verify, session } = await challenged();
    verify.check.mockResolvedValue(false);

    for (let i = 0; i < 5; i += 1) {
      await expect(svc.verify(session, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    verify.check.mockResolvedValue(true);
    await expect(svc.verify(session, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an unknown or expired session without asking Twilio', async () => {
    const { svc, verify } = make();

    await expect(svc.verify('nope', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify.check).not.toHaveBeenCalled();
  });

  it('texts a fresh code on request, to the same number', async () => {
    const { svc, verify, session } = await challenged();
    verify.send.mockClear();

    await expect(svc.resend(session)).resolves.toEqual({ destination: '•••• 1234' });
    expect(verify.send).toHaveBeenCalledWith('+14045551234');
  });
});

describe('MfaService — switching it on and off', () => {
  it('turns it on only after the number on the profile proves it receives texts', async () => {
    const { svc, verify, repository, cache } = make(user());

    await expect(svc.startEnrollment('u-1')).resolves.toEqual({ destination: '•••• 1234' });
    expect(verify.send).toHaveBeenCalledWith('+14045551234');
    expect(repository.update).not.toHaveBeenCalled();

    const updated = await svc.confirmEnrollment('u-1', '123456');

    expect(verify.check).toHaveBeenCalledWith('+14045551234', '123456');
    expect(repository.update).toHaveBeenCalledWith('u-1', { smsMfaEnabled: true });
    expect(updated.smsMfaEnabled).toBe(true);
    expect(cache.invalidateUser).toHaveBeenCalledWith('u-1');
  });

  it('asks for a phone on the profile first', async () => {
    const { svc } = make(user({ phone: undefined }));

    await expect(svc.startEnrollment('u-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not switch on for a wrong code', async () => {
    const { svc, verify, repository } = make(user());
    await svc.startEnrollment('u-1');
    verify.check.mockResolvedValueOnce(false);

    await expect(svc.confirmEnrollment('u-1', '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not switch on without a code having been sent', async () => {
    const { svc, repository } = make(user());

    await expect(svc.confirmEnrollment('u-1', '123456')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  // A number changed between the text and the code is not the number that proved itself.
  it('does not switch on if the profile number changed after the code went out', async () => {
    const { svc, repository } = make(user());
    await svc.startEnrollment('u-1');
    repository.findById.mockResolvedValueOnce(user({ phone: '+17705550000' }));

    await expect(svc.confirmEnrollment('u-1', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('switches off on request', async () => {
    const { svc, repository, cache } = make(user({ smsMfaEnabled: true }));

    const updated = await svc.disable('u-1');

    expect(repository.update).toHaveBeenCalledWith('u-1', { smsMfaEnabled: false });
    expect(updated.smsMfaEnabled).toBe(false);
    expect(cache.invalidateUser).toHaveBeenCalledWith('u-1');
  });
});

describe('MfaService.setByAdmin', () => {
  it('switches someone off — a lost phone', async () => {
    const { svc, repository } = make(user({ smsMfaEnabled: true }));

    await svc.setByAdmin('u-1', false);

    expect(repository.update).toHaveBeenCalledWith('u-1', { smsMfaEnabled: false });
  });

  it('switches someone on when they have a phone; their next sign-in texts it', async () => {
    const { svc, repository } = make(user());

    await svc.setByAdmin('u-1', true);

    expect(repository.update).toHaveBeenCalledWith('u-1', { smsMfaEnabled: true });
  });

  it('cannot switch on someone with no phone to text', async () => {
    const { svc, repository } = make(user({ phone: undefined }));

    await expect(svc.setByAdmin('u-1', true)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('cannot switch on a subcontractor — they have no sign-in to protect (Workiz greys it)', async () => {
    const { svc, repository } = make(user({ userType: 'subcontractor' }));

    await expect(svc.setByAdmin('u-1', true)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
