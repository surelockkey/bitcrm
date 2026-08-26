import {
  mapDeal,
  mapContact,
  mapCompany,
  mapUser,
  mapTechnician,
  mapProduct,
  mapWarehouse,
  mapContainer,
  mapTransfer,
} from 'src/indexer/mappers/search-mappers';
import {
  Deal,
  Contact,
  Company,
  User,
  Product,
  Warehouse,
  Container,
  Transfer,
  JobSuperStatus,
  DealStatus,
  DealPriority,
  ClientType,
  ContactType,
  ContactSource,
  CrmStatus,
  UserStatus,
  ProductType,
  InventoryStatus,
  TransferType,
} from '@bitcrm/types';

describe('search-mappers', () => {
  describe('mapDeal', () => {
    const deal: Deal = {
      id: 'd1',
      dealNumber: 'K4T9ZW',
      contactId: 'c1',
      companyId: 'co1',
      clientType: ClientType.RESIDENTIAL,
      serviceArea: 'Brooklyn',
      address: { street: '5 Main St', city: 'NYC', state: 'NY', zip: '11201' } as any,
      jobTypeId: 'jt-install',
      superStatus: JobSuperStatus.IN_PROGRESS,
      assignedTechIds: ['tech1', 'tech2'],
      assignedDispatcherId: 'disp1',
      priority: DealPriority.URGENT,
      tagIds: ['t-vip', 't-rush'],
      notes: 'call before arrival',
      internalNotes: 'do-not-index-secret',
      status: DealStatus.ACTIVE,
      createdBy: 'creator1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    } as Deal;

    it('produces a stable docId and identity', () => {
      const doc = mapDeal(deal);
      expect(doc.docId).toBe('deal#d1');
      expect(doc.entityId).toBe('d1');
      expect(doc.type).toBe('deal');
      expect(doc.permissionResource).toBe('deals');
    });

    it('collects all owner ids for ASSIGNED_ONLY scope', () => {
      const doc = mapDeal(deal);
      expect(doc.ownerIds).toEqual(
        expect.arrayContaining(['tech1', 'tech2', 'disp1', 'creator1']),
      );
    });

    it('builds title, keywords and deep link', () => {
      const doc = mapDeal(deal, 'Install', ['vip', 'rush']);
      expect(doc.title).toContain('K4T9ZW');
      expect(doc.keywords).toEqual(expect.arrayContaining(['Brooklyn', 'vip', 'Install']));
      expect(doc.url).toBe('/deals/d1');
      expect(doc.status).toBe('active');
    });

    it('never indexes internal notes', () => {
      const doc = mapDeal(deal);
      expect(JSON.stringify(doc)).not.toContain('do-not-index-secret');
    });

    it('folds searchable custom-field values into keywords and drops non-searchable ones', () => {
      const withFields = {
        ...deal,
        customFields: {
          'cf-warranty': 'AllState Gold', // searchable text
          'cf-secret': 'hidden-internal', // searchable=false → excluded
          'cf-gate': 4210, // searchable number
          'cf-installed': true, // searchable checkbox
          'cf-tools': ['drill', 'saw'], // searchable multi_select
        },
      } as Deal;
      const defs = [
        { id: 'cf-warranty', searchable: true },
        { id: 'cf-secret', searchable: false },
        { id: 'cf-gate', searchable: true },
        { id: 'cf-installed', searchable: true },
        { id: 'cf-tools', searchable: true },
      ];
      const doc = mapDeal(withFields, 'Install', [], defs);
      expect(doc.keywords).toEqual(
        expect.arrayContaining(['AllState Gold', '4210', 'true', 'drill saw']),
      );
      expect(doc.keywords).not.toContain('hidden-internal');
      expect(JSON.stringify(doc)).not.toContain('hidden-internal');
    });

    it('ignores custom-field ids that have no matching definition', () => {
      const withFields = { ...deal, customFields: { 'cf-unknown': 'ghost' } } as Deal;
      const doc = mapDeal(withFields, undefined, [], [{ id: 'cf-warranty', searchable: true }]);
      expect(doc.keywords).not.toContain('ghost');
    });

    it('maps a deleted deal status', () => {
      expect(mapDeal({ ...deal, status: DealStatus.DELETED }).status).toBe('deleted');
    });

    it('indexes the job number and PO number as keywords', () => {
      const doc = mapDeal({ ...deal, poNumber: 'PO-77812' } as Deal);
      expect(doc.keywords).toContain('K4T9ZW');
      expect(doc.keywords).toContain('PO-77812');
    });

    it('folds the client (contact + company) into keywords so a phone or name finds the job', () => {
      const doc = mapDeal(deal, 'Install', [], [], {
        name: 'John Smith',
        phones: ['(728) 347-8370'],
        emails: ['john@acme.com'],
        companyName: 'Acme Corp',
      });
      expect(doc.keywords).toEqual(
        expect.arrayContaining([
          'John Smith',
          '(728) 347-8370',
          '7283478370',
          '17283478370',
          'john@acme.com',
          'Acme Corp',
        ]),
      );
      // Client name is visible in the hit's subtitle (Workiz-style).
      expect(doc.subtitle).toContain('John Smith');
    });

    it('indexes the external company name so its jobs are findable by partner', () => {
      const doc = mapDeal(deal, 'Install', [], [], undefined, 'Allied Dispatch Solutions');
      expect(doc.keywords).toContain('Allied Dispatch Solutions');
    });

    it('prefers the per-job client-name override in subtitle and still indexes both names', () => {
      const overridden = {
        ...deal,
        clientName: { firstName: 'Janet', lastName: 'Poole' },
      } as Deal;
      const doc = mapDeal(overridden, 'Install', [], [], {
        name: 'Jane Smith',
        phones: [],
        emails: [],
      });
      // The job displays its own name…
      expect(doc.subtitle).toContain('Janet Poole');
      expect(doc.subtitle).not.toContain('Jane Smith');
      // …but a search by either name still finds the job.
      expect(doc.keywords).toEqual(
        expect.arrayContaining(['Janet Poole', 'Jane Smith']),
      );
    });

    it('stamps contactId and companyId so client edits can reindex their deals', () => {
      const doc = mapDeal(deal);
      expect(doc.contactId).toBe('c1');
      expect(doc.companyId).toBe('co1');
    });

    it('adds digit variants for phone-like searchable custom-field values', () => {
      const withFields = {
        ...deal,
        customFields: { 'cf-alt-phone': '(728) 347-8370' },
      } as Deal;
      const doc = mapDeal(withFields, undefined, [], [
        { id: 'cf-alt-phone', searchable: true },
      ]);
      expect(doc.keywords).toEqual(
        expect.arrayContaining(['(728) 347-8370', '7283478370', '17283478370']),
      );
    });
  });

  describe('mapContact', () => {
    const contact: Contact = {
      id: 'c1',
      firstName: 'John',
      lastName: 'Smith',
      phones: ['(212) 555-0100'],
      emails: ['john@acme.com'],
      companyId: 'co1',
      type: ContactType.RESIDENTIAL as any,
      source: ContactSource.WEB_FORM as any,
      notes: 'prefers email',
      status: CrmStatus.ACTIVE,
      createdBy: 'creator1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    } as Contact;

    it('maps identity, name and owner', () => {
      const doc = mapContact(contact);
      expect(doc.type).toBe('contact');
      expect(doc.permissionResource).toBe('contacts');
      expect(doc.title).toBe('John Smith');
      expect(doc.ownerIds).toContain('creator1');
    });

    it('indexes email, the raw phone and its digit variants', () => {
      const doc = mapContact(contact);
      expect(doc.keywords).toContain('john@acme.com');
      // Raw format matches partial queries like "555-0100"; digit variants match
      // collapsed queries like "2125550100" / "+1 212 555 0100".
      expect(doc.keywords).toContain('(212) 555-0100');
      expect(doc.keywords).toContain('2125550100');
      expect(doc.keywords).toContain('12125550100');
    });

    it('indexes phone suffixes so a pasted tail like "5550100" matches', () => {
      const doc = mapContact(contact);
      expect(doc.keywords).toEqual(expect.arrayContaining(['5550100', '0100']));
    });
  });

  describe('mapCompany', () => {
    const company: Company = {
      id: 'co1',
      title: 'Acme Corp',
      phones: ['212-555-0199'],
      emails: ['info@acme.com'],
      website: 'acme.com',
      clientType: ClientType.COMMERCIAL,
      status: CrmStatus.ACTIVE,
      createdBy: 'creator1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    } as Company;

    it('maps name, website and owner', () => {
      const doc = mapCompany(company);
      expect(doc.type).toBe('company');
      expect(doc.permissionResource).toBe('companies');
      expect(doc.title).toBe('Acme Corp');
      expect(doc.keywords).toEqual(expect.arrayContaining(['info@acme.com', 'acme.com']));
    });

    it('indexes the raw phone and its digit variants', () => {
      const doc = mapCompany(company);
      expect(doc.keywords).toEqual(
        expect.arrayContaining(['212-555-0199', '2125550199', '12125550199']),
      );
    });
  });

  describe('mapUser', () => {
    const user: User = {
      id: 'u1',
      cognitoSub: 'sub-should-not-index',
      email: 'jane@corp.com',
      firstName: 'Jane',
      lastName: 'Doe',
      roleId: 'role1',
      department: 'sales',
      status: UserStatus.ACTIVE,
      permissionOverrides: { permissions: { deals: { view: true } } } as any,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    } as User;

    it('sets department and self-ownership', () => {
      const doc = mapUser(user);
      expect(doc.type).toBe('user');
      expect(doc.permissionResource).toBe('users');
      expect(doc.department).toBe('sales');
      expect(doc.ownerIds).toEqual(['u1']);
      expect(doc.title).toBe('Jane Doe');
      // No per-user detail page — links to the admin users list.
      expect(doc.url).toBe('/admin/users');
    });

    it('never indexes cognitoSub or permission overrides', () => {
      const serialized = JSON.stringify(mapUser(user));
      expect(serialized).not.toContain('sub-should-not-index');
      expect(serialized).not.toContain('permissionOverrides');
    });

    it('maps inactive user to archived', () => {
      expect(mapUser({ ...user, status: UserStatus.INACTIVE }).status).toBe('archived');
    });
  });

  describe('mapTechnician', () => {
    it('indexes skills and service areas as keywords', () => {
      const doc = mapTechnician({
        userId: 'u1',
        firstName: 'Bob',
        lastName: 'Lee',
        department: 'field',
        phone: '212-555-0000',
        jobTypes: ['HVAC', 'Plumbing'],
        serviceAreas: ['Queens'],
        status: 'active',
        updatedAt: '2026-02-01T00:00:00Z',
      });
      expect(doc.type).toBe('technician');
      expect(doc.permissionResource).toBe('technicians');
      expect(doc.ownerIds).toEqual(['u1']);
      expect(doc.department).toBe('field');
      expect(doc.keywords).toEqual(expect.arrayContaining(['HVAC', 'Plumbing', 'Queens']));
      expect(doc.title).toBe('Bob Lee');
    });
  });

  describe('inventory mappers', () => {
    it('mapProduct indexes sku and name', () => {
      const product: Product = {
        id: 'p1',
        sku: 'SKU-123',
        name: 'Thermostat',
        category: 'HVAC',
        type: ProductType.PRODUCT as any,
        costCompany: 10,
        costTech: 12,
        priceClient: 20,
        serialTracking: false,
        minimumStockLevel: 1,
        status: InventoryStatus.ACTIVE,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      } as Product;
      const doc = mapProduct(product);
      expect(doc.type).toBe('product');
      expect(doc.permissionResource).toBe('products');
      expect(doc.title).toBe('Thermostat');
      expect(doc.keywords).toContain('SKU-123');
      expect(doc.url).toBe('/inventory/products/p1');
    });

    it('mapWarehouse maps name', () => {
      const warehouse: Warehouse = {
        id: 'w1',
        name: 'Main WH',
        status: InventoryStatus.ACTIVE,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      } as Warehouse;
      const doc = mapWarehouse(warehouse);
      expect(doc.type).toBe('warehouse');
      expect(doc.permissionResource).toBe('warehouses');
      expect(doc.title).toBe('Main WH');
      expect(doc.url).toBe('/inventory/warehouses/w1');
    });

    it('mapContainer titles by the container name and carries technician owner', () => {
      const container: Container = {
        id: 'ct1',
        name: 'Van 1',
        description: 'North route',
        technicianId: 'tech1',
        technicianName: 'Bob Lee',
        department: 'field',
        status: InventoryStatus.ACTIVE,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      } as Container;
      const doc = mapContainer(container);
      expect(doc.type).toBe('container');
      expect(doc.permissionResource).toBe('containers');
      expect(doc.title).toBe('Van 1');
      expect(doc.ownerIds).toContain('tech1');
      expect(doc.department).toBe('field');
      expect(doc.keywords).toContain('Bob Lee');
      expect(doc.keywords).toContain('Van 1');
      expect(doc.url).toBe('/inventory/containers/ct1');
    });

    it('mapContainer handles an unassigned container', () => {
      const container: Container = {
        id: 'ct2',
        name: 'Spare van',
        status: InventoryStatus.ACTIVE,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      } as Container;
      const doc = mapContainer(container);
      expect(doc.title).toBe('Spare van');
      expect(doc.ownerIds).toEqual([]);
    });

    it('mapTransfer maps performedBy owner', () => {
      const transfer: Transfer = {
        id: 't1',
        type: TransferType.RECEIVE as any,
        fromType: null,
        fromId: null,
        toType: null,
        toId: null,
        items: [{ productId: 'p1', productName: 'Thermostat', quantity: 2 }],
        performedBy: 'u9',
        performedByName: 'Ann',
        createdAt: '2026-01-01T00:00:00Z',
      } as Transfer;
      const doc = mapTransfer(transfer);
      expect(doc.type).toBe('transfer');
      expect(doc.permissionResource).toBe('transfers');
      expect(doc.ownerIds).toContain('u9');
      expect(doc.keywords).toContain('Thermostat');
      expect(doc.url).toBe('/inventory/transfers');
    });
  });
});
