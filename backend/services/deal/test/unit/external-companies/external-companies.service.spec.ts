import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExternalCompaniesService } from 'src/external-companies/external-companies.service';
import {
  createMockExternalCompaniesRepository,
  createMockExternalCompany,
  createMockSnsPublisherService,
  createMockJwtUser,
} from '../mocks';

describe('ExternalCompaniesService', () => {
  let repo: ReturnType<typeof createMockExternalCompaniesRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: ExternalCompaniesService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockExternalCompaniesRepository();
    sns = createMockSnsPublisherService();
    service = new ExternalCompaniesService(repo as any, sns as any);
  });

  describe('create', () => {
    it('persists a new company with its contact details and emits an event', async () => {
      const company = await service.create(
        {
          name: 'Allied Dispatch Solutions',
          email: 'Tammy.Killen@allieddispatch.com',
          address: '500 Borla Dr, Johnson City, TN 37604',
          phone: '(855) 281-0219',
        } as any,
        caller,
      );

      expect(company).toMatchObject({
        name: 'Allied Dispatch Solutions',
        email: 'Tammy.Killen@allieddispatch.com',
        phone: '(855) 281-0219',
        active: true,
      });
      expect(company.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Allied Dispatch Solutions' }),
      );
      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'external-company.created',
        expect.any(Object),
      );
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockExternalCompany({ name: 'Agero' })]);
      await expect(service.create({ name: '  agero ' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates contact details and re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockExternalCompany({ id: 'ec-1', name: 'Agero' }));
      repo.listAll.mockResolvedValue([
        createMockExternalCompany({ id: 'ec-1', name: 'Agero' }),
        createMockExternalCompany({ id: 'ec-2', name: 'BNG' }),
      ]);
      await expect(service.update('ec-1', { name: 'BNG' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
    });

    it('toggles enabled/disabled via active', async () => {
      repo.get.mockResolvedValue(createMockExternalCompany({ id: 'ec-1', active: true }));
      repo.listAll.mockResolvedValue([createMockExternalCompany({ id: 'ec-1' })]);

      const updated = await service.update('ec-1', { active: false } as any, caller);

      expect(updated.active).toBe(false);
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'external-company.updated',
        expect.any(Object),
      );
    });

    it('404s on an unknown id', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.update('ghost', {} as any, caller)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('archives a referenced company instead of deleting it', async () => {
      repo.get.mockResolvedValue(createMockExternalCompany({ id: 'ec-1', active: true }));
      repo.isReferencedByDeal.mockResolvedValue(true);

      const result = await service.remove('ec-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    });

    it('deletes an unreferenced company outright', async () => {
      repo.get.mockResolvedValue(createMockExternalCompany({ id: 'ec-1' }));
      repo.isReferencedByDeal.mockResolvedValue(false);

      const result = await service.remove('ec-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('ec-1');
    });
  });

  describe('list', () => {
    it('sorts alphabetically by name', async () => {
      repo.listAll.mockResolvedValue([
        createMockExternalCompany({ id: 'b', name: 'Yelp' }),
        createMockExternalCompany({ id: 'a', name: 'Agero' }),
      ]);
      const list = await service.list();
      expect(list.map((c) => c.name)).toEqual(['Agero', 'Yelp']);
    });
  });
});
