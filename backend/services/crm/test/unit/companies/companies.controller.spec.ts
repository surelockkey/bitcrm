import { Test } from '@nestjs/testing';
import { CompaniesController } from 'src/companies/companies.controller';
import { CompaniesService } from 'src/companies/companies.service';
import { ContactsService } from 'src/contacts/contacts.service';
import { NotFoundException } from '@nestjs/common';
import { createMockCompany, createMockContact, createMockJwtUser } from '../mocks';
import { ClientType } from '@bitcrm/types';

describe('CompaniesController', () => {
  let controller: CompaniesController;
  let service: Record<string, jest.Mock>;
  let contactsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findAll: jest.fn(),
    };
    contactsService = {
      list: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: CompaniesService, useValue: service },
        { provide: ContactsService, useValue: contactsService },
      ],
    }).compile();

    controller = module.get(CompaniesController);
  });

  describe('create', () => {
    it('should return success wrapper with created company', async () => {
      const company = createMockCompany();
      const caller = createMockJwtUser();
      service.create.mockResolvedValue(company);

      const result = await controller.create(
        { title: 'Acme Corp', clientType: ClientType.COMMERCIAL } as any,
        caller,
      );

      expect(result).toEqual({ success: true, data: company });
    });
  });

  describe('list', () => {
    it('should return paginated companies', async () => {
      const companies = [createMockCompany()];
      service.list.mockResolvedValue({ items: companies, nextCursor: undefined });

      const result = await controller.list({ limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: companies,
        pagination: { nextCursor: undefined, count: 1 },
      });
    });
  });

  describe('findById', () => {
    it('should return success wrapper with company', async () => {
      const company = createMockCompany();
      service.findById.mockResolvedValue(company);

      const result = await controller.findById('company-1');

      expect(result).toEqual({ success: true, data: company });
    });
  });

  describe('findByIdInternal', () => {
    it('should return success wrapper with company', async () => {
      const company = createMockCompany();
      service.findById.mockResolvedValue(company);

      const result = await controller.findByIdInternal('company-1');

      expect(result).toEqual({ success: true, data: company });
      expect(service.findById).toHaveBeenCalledWith('company-1');
    });

    it('should throw NotFoundException when company is null', async () => {
      service.findById.mockResolvedValue(null);

      await expect(controller.findByIdInternal('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAllInternal', () => {
    it('should return items and nextCursor wrapped in data', async () => {
      const companies = [createMockCompany()];
      service.findAll.mockResolvedValue({ items: companies, nextCursor: 'next-1' });

      const result = await controller.findAllInternal('50', 'cursor-1');

      expect(result).toEqual({
        success: true,
        data: { items: companies, nextCursor: 'next-1' },
      });
      expect(service.findAll).toHaveBeenCalledWith(50, 'cursor-1');
    });

    it('should default limit to 200 when not provided', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.findAllInternal(undefined, undefined);

      expect(service.findAll).toHaveBeenCalledWith(200, undefined);
    });

    it('should clamp limit to a max of 500', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.findAllInternal('1000', undefined);

      expect(service.findAll).toHaveBeenCalledWith(500, undefined);
    });
  });

  describe('update', () => {
    it('should return success wrapper with updated company', async () => {
      const company = createMockCompany({ title: 'New Name' });
      service.update.mockResolvedValue(company);

      const result = await controller.update('company-1', { title: 'New Name' } as any);

      expect(result).toEqual({ success: true, data: company });
    });
  });

  describe('delete', () => {
    it('should return success wrapper with deleted indicator', async () => {
      service.delete.mockResolvedValue(undefined);

      const result = await controller.delete('company-1');

      expect(result).toEqual({ success: true, data: { id: 'company-1', deleted: true } });
    });
  });

  describe('getCompanyContacts', () => {
    it('should return contacts linked to company', async () => {
      const contacts = [createMockContact({ companyId: 'company-1' })];
      contactsService.list.mockResolvedValue({ items: contacts, nextCursor: undefined });

      const result = await controller.getCompanyContacts('company-1', { limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: contacts,
        pagination: { nextCursor: undefined, count: 1 },
      });
      expect(contactsService.list).toHaveBeenCalledWith({
        companyId: 'company-1',
        limit: 20,
      });
    });
  });
});
