import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { make, tokens, user } from './mfa.harness';

/**
 * Settings → Security Center, "Require Two-factor authentication (2FA)":
 * when the account requires it, every sign-in has the second step whatever
 * the person's own switch says; someone with no phone is walked through
 * setting one up before the tokens are released; a subcontractor, who has
 * no sign-in to protect, is left alone. "Login sending options" lets the
 * code go by email too, on request.
 */
describe('MfaService — the account requires two-factor authentication', () => {
  it('texts the code to someone whose own switch is off', async () => {
    const { svc, verify } = make(user({ smsMfaEnabled: false }), { settings: { requireMfa: true } });

    const res = await svc.gate(tokens());

    expect(res).toEqual({ challengeName: 'SMS_MFA', session: expect.any(String), destination: '•••• 1234' });
    expect(verify.send).toHaveBeenCalledWith('+14045551234');
  });

  it('leaves a subcontractor alone — there is no sign-in to protect', async () => {
    const { svc, verify } = make(user({ userType: 'subcontractor', smsMfaEnabled: false }), { settings: { requireMfa: true } });

    await expect(svc.gate(tokens())).resolves.toEqual(tokens());
    expect(verify.send).not.toHaveBeenCalled();
  });

  it('asks someone with no phone to set one up, holding the tokens back', async () => {
    const { svc, verify, redis } = make(user({ phone: undefined, smsMfaEnabled: false }), { settings: { requireMfa: true } });

    const res = await svc.gate(tokens());

    expect(res).toEqual({ challengeName: 'MFA_SETUP', session: expect.any(String) });
    expect(JSON.stringify(res)).not.toContain('access');
    expect(verify.send).not.toHaveBeenCalled();
    const session = (res as { session: string }).session;
    expect(redis.data.get(`mfa:login:${session}`)?.ttl).toBe(300);
  });

  it('still refuses, as before, when the switch is on with no phone and nothing requires it', async () => {
    const { svc } = make(user({ phone: undefined, smsMfaEnabled: true }));

    await expect(svc.gate(tokens())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('setting up a phone on the way in', () => {
    async function setupChallenge(options: Parameters<typeof make>[1] = {}) {
      const ctx = make(user({ phone: undefined, smsMfaEnabled: false }), { settings: { requireMfa: true }, ...options });
      const res = (await ctx.svc.gate(tokens())) as { session: string };
      return { ...ctx, session: res.session };
    }

    it('texts the given number, in E.164, and names it masked', async () => {
      const { svc, verify, session } = await setupChallenge();

      await expect(svc.setupPhone(session, '(541) 283-0739')).resolves.toEqual({ destination: '•••• 0739' });
      expect(verify.send).toHaveBeenCalledWith('+15412830739');
    });

    it('refuses a number that is already on a teammate\'s profile', async () => {
      const { svc, verify, session } = await setupChallenge({ phoneOwners: { '+15412830739': user({ id: 'u-2', firstName: 'Ann' }) } });

      await expect(svc.setupPhone(session, '541-283-0739')).rejects.toBeInstanceOf(ConflictException);
      expect(verify.send).not.toHaveBeenCalled();
    });

    it('refuses a phone on a challenge that is not a setup, and an expired session', async () => {
      const { svc } = make(user({ smsMfaEnabled: true }));
      const res = (await svc.gate(tokens())) as { session: string };

      await expect(svc.setupPhone(res.session, '541-283-0739')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.setupPhone('nope', '541-283-0739')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('wants a phone before it checks any code', async () => {
      const { svc, session } = await setupChallenge();

      await expect(svc.verify(session, '123456')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('saves the proved phone, switches the second step on and releases the tokens', async () => {
      const { svc, verify, usersService, repository, cache, session } = await setupChallenge();
      await svc.setupPhone(session, '541-283-0739');

      await expect(svc.verify(session, '123456')).resolves.toEqual(tokens());

      expect(verify.check).toHaveBeenCalledWith('+15412830739', '123456');
      expect(usersService.setPhone).toHaveBeenCalledWith('u-1', '+15412830739');
      expect(repository.update).toHaveBeenCalledWith('u-1', { smsMfaEnabled: true });
      expect(cache.invalidateUser).toHaveBeenCalledWith('u-1');
      await expect(svc.verify(session, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('keeps the tokens and the phone back for a wrong code', async () => {
      const { svc, verify, usersService, session } = await setupChallenge();
      await svc.setupPhone(session, '541-283-0739');
      verify.check.mockResolvedValueOnce(false);

      await expect(svc.verify(session, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(usersService.setPhone).not.toHaveBeenCalled();
    });

    it('lets the person change their mind about the number before the code comes back', async () => {
      const { svc, verify, usersService, session } = await setupChallenge();
      await svc.setupPhone(session, '541-283-0739');
      await svc.setupPhone(session, '404-555-0100');

      await svc.verify(session, '123456');

      expect(verify.check).toHaveBeenCalledWith('+14045550100', '123456');
      expect(usersService.setPhone).toHaveBeenCalledWith('u-1', '+14045550100');
    });
  });

  describe('switching it off while it is required', () => {
    it('refuses the person\'s own switch', async () => {
      const { svc, repository } = make(user({ smsMfaEnabled: true }), { settings: { requireMfa: true } });

      await expect(svc.disable('u-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses an admin\'s switch too — a lost phone is fixed by changing the phone', async () => {
      const { svc, repository } = make(user({ smsMfaEnabled: true }), { settings: { requireMfa: true } });

      await expect(svc.setByAdmin('u-1', false)).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('lets an admin switch a subcontractor\'s stale flag off', async () => {
      const { svc, current } = make(user({ smsMfaEnabled: true, userType: 'subcontractor' }), { settings: { requireMfa: true } });

      await svc.setByAdmin('u-1', false);

      expect(current().smsMfaEnabled).toBe(false);
    });
  });
});

describe('MfaService — the code by email (Login sending options)', () => {
  it('offers the email only when the account allows it and the server can send it', async () => {
    const off = make(user({ smsMfaEnabled: true }));
    await expect(off.svc.gate(tokens())).resolves.not.toHaveProperty('emailDestination');

    const noSender = make(user({ smsMfaEnabled: true }), { settings: { loginCodeByEmail: true }, emailAvailable: false });
    await expect(noSender.svc.gate(tokens())).resolves.not.toHaveProperty('emailDestination');

    const on = make(user({ smsMfaEnabled: true }), { settings: { loginCodeByEmail: true } });
    await expect(on.svc.gate(tokens())).resolves.toMatchObject({ challengeName: 'SMS_MFA', emailDestination: 'b•••@x.com' });
  });

  async function challenged(options: Parameters<typeof make>[1] = { settings: { loginCodeByEmail: true } }) {
    const ctx = make(user({ smsMfaEnabled: true }), options);
    const res = (await ctx.svc.gate(tokens())) as { session: string };
    return { ...ctx, session: res.session };
  }

  it('mails a six-digit code to the account\'s email and names it masked', async () => {
    const { svc, emailCodes, session } = await challenged();

    await expect(svc.sendEmailCode(session)).resolves.toEqual({ destination: 'b•••@x.com' });

    expect(emailCodes.send).toHaveBeenCalledWith('bob@x.com', expect.stringMatching(/^\d{6}$/));
  });

  it('refuses the email when the account does not allow it, or the session is gone', async () => {
    const { svc, emailCodes, session } = await challenged({ settings: { loginCodeByEmail: false } });

    await expect(svc.sendEmailCode(session)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.sendEmailCode('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(emailCodes.send).not.toHaveBeenCalled();
  });

  it('signs the person in with the emailed code — without asking Twilio', async () => {
    const { svc, emailCodes, verify, session } = await challenged();
    await svc.sendEmailCode(session);
    const code = (emailCodes.send.mock.calls[0] as unknown as [string, string])[1];
    verify.check.mockResolvedValue(false);

    await expect(svc.verify(session, code)).resolves.toEqual(tokens());
    expect(verify.check).not.toHaveBeenCalled();
  });

  it('still takes the texted code after an email was asked for', async () => {
    const { svc, verify, session } = await challenged();
    await svc.sendEmailCode(session);

    await expect(svc.verify(session, '123456')).resolves.toEqual(tokens());
    expect(verify.check).toHaveBeenCalledWith('+14045551234', '123456');
  });

  it('counts a wrong emailed code as a miss like a wrong text', async () => {
    const { svc, verify, session } = await challenged();
    await svc.sendEmailCode(session);
    verify.check.mockResolvedValue(false);

    for (let i = 0; i < 5; i++) {
      await expect(svc.verify(session, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    // The sixth attempt finds no challenge at all.
    await expect(svc.verify(session, '123456')).rejects.toThrow(/expired/);
  });

  it('never stores the code itself', async () => {
    const { svc, emailCodes, redis, session } = await challenged();
    await svc.sendEmailCode(session);
    const code = (emailCodes.send.mock.calls[0] as unknown as [string, string])[1];

    expect(redis.data.get(`mfa:login:${session}`)?.value).not.toContain(code);
  });
});
