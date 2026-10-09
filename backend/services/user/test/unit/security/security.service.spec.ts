import { BadRequestException } from '@nestjs/common';
import type { SecuritySettings } from '@bitcrm/types';
import { SecurityService } from '../../../src/security/security.service';

/**
 * Settings → Security Center: the account's switches, saved by an admin and
 * logged. A switch that sends codes by email cannot go on while the server
 * has no sender for them — the page must not promise what the sign-in
 * cannot do.
 */
function make(stored?: Partial<SecuritySettings>, emailAvailable = true) {
  let current: SecuritySettings = { requireMfa: false, loginCodeByEmail: false, otpByEmail: false, ...stored };
  const repository = {
    get: jest.fn(async () => ({ ...current })),
    put: jest.fn(async (next: SecuritySettings) => {
      current = next;
    }),
    recordChange: jest.fn(async () => undefined),
    listChanges: jest.fn(async () => []),
  };
  const emailCodes = { available: emailAvailable };
  const svc = new SecurityService(repository as never, emailCodes as never);
  return { svc, repository, emailCodes };
}

describe('SecurityService', () => {
  it('reads the row as stored', async () => {
    const { svc } = make({ requireMfa: true });

    await expect(svc.getSettings()).resolves.toMatchObject({ requireMfa: true, loginCodeByEmail: false, otpByEmail: false });
  });

  describe('updateSettings', () => {
    it('lays the given switches over the row, stamps who and when, and logs the change', async () => {
      const { svc, repository } = make();

      const saved = await svc.updateSettings({ requireMfa: true }, 'u-admin');

      expect(saved).toEqual({
        requireMfa: true,
        loginCodeByEmail: false,
        otpByEmail: false,
        updatedAt: expect.any(String),
        updatedBy: 'u-admin',
      });
      expect(repository.put).toHaveBeenCalledWith(saved);
      expect(repository.recordChange).toHaveBeenCalledWith({
        actorId: 'u-admin',
        timestamp: saved.updatedAt,
        before: { requireMfa: false, loginCodeByEmail: false, otpByEmail: false },
        after: { requireMfa: true, loginCodeByEmail: false, otpByEmail: false },
      });
    });

    it('writes and logs nothing when nothing changed', async () => {
      const { svc, repository } = make({ requireMfa: true, updatedAt: 't0', updatedBy: 'u-0' });

      const saved = await svc.updateSettings({ requireMfa: true }, 'u-admin');

      expect(saved).toMatchObject({ requireMfa: true, updatedAt: 't0', updatedBy: 'u-0' });
      expect(repository.put).not.toHaveBeenCalled();
      expect(repository.recordChange).not.toHaveBeenCalled();
    });

    it('refuses to send codes by email while the server has no sender for them', async () => {
      const { svc, repository } = make({}, false);

      await expect(svc.updateSettings({ loginCodeByEmail: true }, 'u-admin')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.updateSettings({ otpByEmail: true }, 'u-admin')).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.put).not.toHaveBeenCalled();
    });

    it('still lets the email switches go off, and the requirement on, without a sender', async () => {
      const { svc } = make({ loginCodeByEmail: true, otpByEmail: true }, false);

      await expect(svc.updateSettings({ loginCodeByEmail: false, otpByEmail: false, requireMfa: true }, 'u-admin')).resolves.toMatchObject({
        requireMfa: true,
        loginCodeByEmail: false,
        otpByEmail: false,
      });
    });
  });

  it('listAudit reads the log newest first', async () => {
    const { svc, repository } = make();

    await svc.listAudit(10);

    expect(repository.listChanges).toHaveBeenCalledWith(10);
  });
});
