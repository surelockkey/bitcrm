import { Test } from '@nestjs/testing';
import { CompaniesController } from 'src/companies/companies.controller';
import { CompaniesService } from 'src/companies/companies.service';
import { ContactsService } from 'src/contacts/contacts.service';
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
