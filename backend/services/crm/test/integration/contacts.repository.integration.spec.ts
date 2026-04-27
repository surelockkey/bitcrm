import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { ContactType, ContactSource, CrmStatus, type Contact } from '@bitcrm/types';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import {
  CONTACTS_TEST_TABLE,
  getTestDynamoDbClient,
  createTestTables,
  clearTestTable,
  destroyRawClient,
} from './setup';

describe('ContactsRepository (integration)', () => {
  let repository: ContactsRepository;

  const makeContact = (overrides?: Partial<Contact>): Contact => ({
    id: 'contact-1',
    firstName: 'John',
    lastName: 'Doe',
    phones: ['+14045551234'],
    emails: ['john@example.com'],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.MANUAL,
    status: CrmStatus.ACTIVE,
    createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTables();

    const module = await Test.createTestingModule({
      providers: [
        ContactsRepository,
        { provide: DynamoDbService, useValue: { client: getTestDynamoDbClient() } },
      ],
    }).compile();

    repository = module.get(ContactsRepository);
    (repository as any).tableName = CONTACTS_TEST_TABLE;
  });

  afterAll(() => {
    destroyRawClient();
  });

  beforeEach(async () => {
    await clearTestTable(CONTACTS_TEST_TABLE);
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a contact', async () => {
      const contact = makeContact();
      await repository.create(contact);

      const found = await repository.findById('contact-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('contact-1');
      expect(found!.firstName).toBe('John');
      expect(found!.lastName).toBe('Doe');
      expect(found!.phones).toEqual(['+14045551234']);
      expect(found!.emails).toEqual(['john@example.com']);
    });
  });

  describe('phone index', () => {
    it('should find contact by phone number', async () => {
      const contact = makeContact();
      await repository.create(contact);

      const found = await repository.findByPhone('+14045551234');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('contact-1');
    });

    it('should find contact by any of its phone numbers', async () => {
      const contact = makeContact({
        phones: ['+14045551234', '+15558675309'],
      });
      await repository.create(contact);

      const found1 = await repository.findByPhone('+14045551234');
      const found2 = await repository.findByPhone('+15558675309');

      expect(found1).not.toBeNull();
      expect(found2).not.toBeNull();
      expect(found1!.id).toBe('contact-1');
      expect(found2!.id).toBe('contact-1');
    });

    it('should return null for non-existent phone', async () => {
      const found = await repository.findByPhone('+19999999999');
      expect(found).toBeNull();
    });
  });

  describe('findByCompany', () => {
    it('should find contacts by company ID via GSI1', async () => {
      await repository.create(makeContact({ id: 'c-1', companyId: 'company-1' }));
      await repository.create(makeContact({ id: 'c-2', companyId: 'company-1', phones: ['+15551111111'] }));
      await repository.create(makeContact({ id: 'c-3', companyId: 'company-2', phones: ['+15552222222'] }));

      const result = await repository.findByCompany('company-1', 10);

      expect(result.items).toHaveLength(2);
      const ids = result.items.map((c) => c.id).sort();
      expect(ids).toEqual(['c-1', 'c-2']);
    });
  });

  describe('findAll', () => {
    it('should return all active contacts with pagination', async () => {
      await repository.create(makeContact({ id: 'c-1' }));
      await repository.create(makeContact({ id: 'c-2', phones: ['+15551111111'] }));

      const result = await repository.findAll(10);

      expect(result.items.length).toBe(2);
    });

    it('should paginate through all contacts', async () => {
      await repository.create(makeContact({ id: 'c-1' }));
      await repository.create(makeContact({ id: 'c-2', phones: ['+15551111111'] }));
      await repository.create(makeContact({ id: 'c-3', phones: ['+15552222222'] }));

      // Scan limit applies to raw items (including phone index items),
      // so we collect all pages to verify all 3 contacts are returned.
      const allItems: any[] = [];
      let cursor: string | undefined;
      do {
        const page = await repository.findAll(10, cursor);
        allItems.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);

      expect(allItems.length).toBe(3);
      const ids = allItems.map((c) => c.id).sort();
      expect(ids).toEqual(['c-1', 'c-2', 'c-3']);
    });
  });

  describe('update', () => {
    it('should update contact fields', async () => {
      await repository.create(makeContact());

      const updated = await repository.update('contact-1', { firstName: 'Jane' });

      expect(updated.firstName).toBe('Jane');
      expect(updated.lastName).toBe('Doe');
    });
  });

  describe('updatePhoneIndex', () => {
    it('should remove old phone items and add new ones', async () => {
      const contact = makeContact({ phones: ['+14045551234'] });
      await repository.create(contact);

      await repository.updatePhoneIndex('contact-1', ['+14045551234'], ['+15558675309']);

      const oldResult = await repository.findByPhone('+14045551234');
      const newResult = await repository.findByPhone('+15558675309');

      expect(oldResult).toBeNull();
      expect(newResult).not.toBeNull();
      expect(newResult!.id).toBe('contact-1');
    });
  });
});
