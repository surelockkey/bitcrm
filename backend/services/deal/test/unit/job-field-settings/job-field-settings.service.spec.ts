import { BadRequestException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { JobFieldSettingsService } from 'src/job-field-settings/job-field-settings.service';

const caller: JwtUser = {
  id: 'admin-1',
  cognitoSub: 'sub',
  email: 'a@x.com',
  roleId: 'role-admin',
  department: 'HQ',
};

describe('JobFieldSettingsService', () => {
  let repo: { get: jest.Mock; put: jest.Mock };
  let service: JobFieldSettingsService;

  beforeEach(() => {
    repo = { get: jest.fn().mockResolvedValue(null), put: jest.fn().mockResolvedValue(undefined) };
    service = new JobFieldSettingsService(repo as never);
  });

  describe('get', () => {
    it('falls back to the defaults when nothing is stored', async () => {
      const s = await service.get();

      expect(s.requiredFields.address).toBe(true);
      expect(s.requiredFields.jobType).toBe(true);
      expect(s.requiredFields.source).toBe(false);
      expect(s.requiredFields.poNumber).toBe(false);
    });

    it('merges the stored choices over the defaults, dropping unknown ids', async () => {
      repo.get.mockResolvedValue({ requiredFields: { source: true, bogus: true, address: false } });

      const s = await service.get();

      expect(s.requiredFields.source).toBe(true);
      expect(s.requiredFields.address).toBe(false);
      expect(s.requiredFields).not.toHaveProperty('bogus');
    });
  });

  describe('update', () => {
    it('persists known ids and returns the merged settings', async () => {
      const s = await service.update({ requiredFields: { source: true } }, caller);

      expect(repo.put).toHaveBeenCalledWith(
        expect.objectContaining({ requiredFields: expect.objectContaining({ source: true }) }),
      );
      expect(s.requiredFields.source).toBe(true);
      expect(s.requiredFields.jobType).toBe(true);
    });

    it('rejects unknown field ids', async () => {
      await expect(
        service.update({ requiredFields: { warpDrive: true } }, caller),
      ).rejects.toThrow(BadRequestException);
      expect(repo.put).not.toHaveBeenCalled();
    });
  });

  describe('missingRequiredForCreate', () => {
    it('lists admin-required deal fields the create body leaves empty', async () => {
      repo.get.mockResolvedValue({
        requiredFields: { source: true, scheduled: true, description: true, address: true },
      });

      const missing = await service.missingRequiredForCreate({
        address: { street: '1 Main', city: 'Phoenix', state: 'AZ', zip: '85001' },
        jobTypeId: 'jt-1',
        notes: '',
      } as never);

      expect(missing.map((f) => f.id).sort()).toEqual(['description', 'scheduled', 'source']);
      expect(missing.find((f) => f.id === 'source')?.label).toBe('Job source');
    });

    it('is quiet when everything required is filled', async () => {
      repo.get.mockResolvedValue({ requiredFields: { source: true, tags: true } });

      const missing = await service.missingRequiredForCreate({
        address: { street: '1 Main', city: 'Phoenix', state: 'AZ', zip: '85001' },
        jobTypeId: 'jt-1',
        sourceId: 'src-1',
        tagIds: ['t1'],
      } as never);

      expect(missing).toEqual([]);
    });

    it('skips client-side-only fields (phone/email) it cannot verify', async () => {
      repo.get.mockResolvedValue({ requiredFields: { phone: true, email: true } });

      const missing = await service.missingRequiredForCreate({
        address: { street: '1 Main', city: 'Phoenix', state: 'AZ', zip: '85001' },
        jobTypeId: 'jt-1',
      } as never);

      expect(missing).toEqual([]);
    });
  });
});
