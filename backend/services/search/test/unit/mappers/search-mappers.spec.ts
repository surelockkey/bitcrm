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
  DealStage,
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
      dealNumber: 1042,
      contactId: 'c1',
      companyId: 'co1',
      clientType: ClientType.RESIDENTIAL,
      serviceArea: 'Brooklyn',
      address: { street: '5 Main St', city: 'NYC', state: 'NY', zip: '11201' } as any,
      jobTypeId: 'jt-install',
      stage: DealStage.ASSIGNED,
      assignedTechId: 'tech1',
      assignedDispatcherId: 'disp1',
      priority: DealPriority.URGENT,
      tags: ['vip', 'rush'],
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
        expect.arrayContaining(['tech1', 'disp1', 'creator1']),
      );
    });

    it('builds title, keywords and deep link', () => {
      const doc = mapDeal(deal, 'Install');
      expect(doc.title).toContain('1042');
      expect(doc.keywords).toEqual(expect.arrayContaining(['Brooklyn', 'vip', 'Install']));
      expect(doc.url).toBe('/deals/d1');
      expect(doc.status).toBe('active');
    });

    it('never indexes internal notes', () => {
      const doc = mapDeal(deal);
      expect(JSON.stringify(doc)).not.toContain('do-not-index-secret');
    });

    it('maps a deleted deal status', () => {
      expect(mapDeal({ ...deal, status: DealStatus.DELETED }).status).toBe('deleted');
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

    it('indexes email and a normalized phone token', () => {
      const doc = mapContact(contact);
      expect(doc.keywords).toContain('john@acme.com');
      expect(doc.keywords).toContain('+12125550100');
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

    it('mapContainer carries technician owner and department', () => {
      const container: Container = {
        id: 'ct1',
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
      expect(doc.ownerIds).toContain('tech1');
      expect(doc.department).toBe('field');
      expect(doc.keywords).toContain('Bob Lee');
      expect(doc.url).toBe('/inventory/containers/ct1');
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
