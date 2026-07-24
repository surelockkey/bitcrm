import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CompaniesService } from 'src/companies/companies.service';
import { CompaniesRepository } from 'src/companies/companies.repository';
import { CompaniesCacheService } from 'src/companies/companies-cache.service';
import { SnsPublisherService } from '@bitcrm/shared';
import { ClientType, CrmStatus, PaymentTerms } from '@bitcrm/types';
import {
  createMockCompany,
  createMockCompaniesRepository,
  createMockCompaniesCacheService,
  createMockSnsPublisherService,
} from '../mocks';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let repository: ReturnType<typeof createMockCompaniesRepository>;
  let cache: ReturnType<typeof createMockCompaniesCacheService>;
  let snsPublisher: ReturnType<typeof createMockSnsPublisherService>;

  beforeEach(async () => {
    repository = createMockCompaniesRepository();
    cache = createMockCompaniesCacheService();
    snsPublisher = createMockSnsPublisherService();

    const module = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: CompaniesRepository, useValue: repository },
        { provide: CompaniesCacheService, useValue: cache },
        { provide: SnsPublisherService, useValue: snsPublisher },
      ],
    }).compile();

    service = module.get(CompaniesService);
  });

  describe('create', () => {
    const dto = { title: 'Acme Corp', clientType: ClientType.COMMERCIAL };
    const caller = { id: 'admin-1', cognitoSub: 'sub', email: 'admin@test.com', roleId: 'role-admin', department: 'HQ' };

    it('should create company and publish event', async () => {
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(dto as any, caller);

      expect(result.title).toBe('Acme Corp');
      expect(result.clientType).toBe(ClientType.COMMERCIAL);
      expect(result.status).toBe(CrmStatus.ACTIVE);
      expect(result.createdBy).toBe('admin-1');
      expect(repository.create).toHaveBeenCalled();
      expect(snsPublisher.publish).toHaveBeenCalledWith(
        'crm', 'company.created', expect.objectContaining({ companyId: result.id }),
      );
    });

    it('persists platinum financial terms & compliance fields', async () => {
      repository.create.mockResolvedValue(undefined);
      const platinumDto = {
        title: 'ABC Supply',
        clientType: ClientType.COMMERCIAL,
        isPlatinum: true,
        paymentTerms: PaymentTerms.NET_30,
        taxExempt: true,
        poRequired: true,
        coiExpiration: '2026-12-31',
      };

      const result = await service.create(platinumDto as any, caller);

      expect(result).toMatchObject({
        isPlatinum: true,
        paymentTerms: PaymentTerms.NET_30,
        taxExempt: true,
        poRequired: true,
        coiExpiration: '2026-12-31',
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isPlatinum: true, paymentTerms: PaymentTerms.NET_30 }),
      );
    });
  });

  describe('findById', () => {
    it('should return cached company on cache hit', async () => {
      const company = createMockCompany();
      cache.get.mockResolvedValue(company);

      const result = await service.findById('company-1');

      expect(result).toEqual(company);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should fetch from repo on cache miss and populate cache', async () => {
      const company = createMockCompany();
      cache.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(company);

      const result = await service.findById('company-1');

      expect(result).toEqual(company);
      expect(cache.set).toHaveBeenCalledWith(company);
    });

    it('should throw NotFoundException when not found', async () => {
      cache.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should delegate to repository with query params', async () => {
      const companies = [createMockCompany()];
      repository.findAll.mockResolvedValue({ items: companies, nextCursor: undefined });

      const result = await service.list({ limit: 20 });

      expect(result).toEqual({ items: companies, nextCursor: undefined });
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined);
    });

    it('should filter by clientType when provided', async () => {
      const companies = [createMockCompany()];
      repository.findByClientType.mockResolvedValue({ items: companies, nextCursor: undefined });

      const result = await service.list({ clientType: ClientType.COMMERCIAL, limit: 20 });

      expect(repository.findByClientType).toHaveBeenCalledWith(ClientType.COMMERCIAL, 20, undefined);
    });

    it('coerces a string limit (raw query param) to a number for DynamoDB', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      // Without a ValidationPipe transform, `limit` arrives as a string; a
      // string Limit makes DynamoDB throw SerializationException.
      await service.list({ limit: '100' as unknown as number });

      expect(repository.findAll).toHaveBeenCalledWith(100, undefined);
    });

    it('clamps an out-of-range limit into 1..100', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({ limit: '9999' as unknown as number });

      expect(repository.findAll).toHaveBeenCalledWith(100, undefined);
    });
  });

  describe('update', () => {
    it('should update company, invalidate cache, and publish event', async () => {
      const existing = createMockCompany();
      const updated = createMockCompany({ title: 'New Name' });
      cache.get.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('company-1', { title: 'New Name' } as any);

      expect(result).toEqual(updated);
      expect(cache.invalidate).toHaveBeenCalledWith('company-1');
      expect(snsPublisher.publish).toHaveBeenCalledWith(
        'crm', 'company.updated', expect.objectContaining({ companyId: 'company-1' }),
      );
    });
  });

  describe('delete', () => {
    it('should soft-delete by setting status to DELETED', async () => {
      const existing = createMockCompany();
      cache.get.mockResolvedValue(existing);
      repository.update.mockResolvedValue({ ...existing, status: CrmStatus.DELETED });

      await service.delete('company-1');

      expect(repository.update).toHaveBeenCalledWith('company-1', { status: CrmStatus.DELETED });
      expect(cache.invalidate).toHaveBeenCalledWith('company-1');
    });
  });
});
