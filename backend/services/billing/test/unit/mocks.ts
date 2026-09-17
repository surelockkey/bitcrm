/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DEFAULT_BUSINESS_PROFILE,
  DataScope,
  PaymentTerms,
  calculateDocumentTotals,
  type BusinessProfile,
  type Deal,
  type DealProduct,
  type JwtUser,
  type ResolvedPermissions,
} from '@bitcrm/types';
import type { DealBillingView } from 'src/integrations/deal.client';

export const NOW = '2026-09-16T15:00:00.000Z';

export const user = (over: Partial<JwtUser> = {}): JwtUser => ({
  id: 'u-1',
  cognitoSub: 'sub',
  email: 'dispatcher@example.com',
  roleId: 'role-1',
  department: 'ops',
  ...over,
});

export const perms = (scope: DataScope = DataScope.ALL, extra: Record<string, Record<string, boolean>> = {}): ResolvedPermissions =>
  ({
    roleId: 'role-1',
    roleName: 'Dispatcher',
    isSystemRole: false,
    permissions: {
      invoices: { view: true, create: true, edit: true, delete: true, send: true },
      estimates: { view: true, create: true, edit: true, delete: true, send: true, sync: true },
      ...extra,
    },
    dataScope: { invoices: scope, estimates: scope, deals: scope },
  }) as unknown as ResolvedPermissions;

export const caller = (scope: DataScope = DataScope.ALL, over: Partial<JwtUser> = {}) => ({
  user: user(over),
  perms: perms(scope),
});

export const dealProduct = (over: Partial<DealProduct> = {}): DealProduct => ({
  productId: 'p-1',
  name: 'Rekey cylinder',
  sku: 'RK-1',
  quantity: 2,
  costCompany: 10,
  costForTech: 5,
  priceClient: 50,
  fulfillment: 'sourced',
  addedBy: 'u-1',
  addedAt: NOW,
  ...over,
});

export const deal = (over: Partial<Deal> = {}): Deal =>
  ({
    id: 'deal-1',
    dealNumber: 'K4T9ZW',
    contactId: 'contact-1',
    clientType: 'residential',
    serviceArea: 'Hartford',
    serviceAreaId: 'sa-1',
    address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
    jobTypeId: 'jt-1',
    superStatus: 'submitted',
    assignedTechIds: ['tech-1'],
    assignedDispatcherId: 'u-1',
    priority: 'normal',
    tagIds: [],
    taxRateId: 'tax-1',
    taxRateName: 'CT Sales',
    taxRatePercent: 6.35,
    taxSource: 'service_area',
    itemCount: 1,
    status: 'active',
    createdBy: 'u-1',
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: NOW,
    ...over,
  }) as Deal;

export const billingView = (
  dealOver: Partial<Deal> = {},
  items: DealProduct[] = [dealProduct()],
): DealBillingView => {
  const d = deal(dealOver);
  return {
    deal: d,
    items,
    totals: calculateDocumentTotals({
      lines: items,
      taxRatePercent: d.taxRatePercent,
      discount: d.discount,
    }),
    jobTypeName: 'Lockout',
    technicianNames: ['Tom Tech'],
  };
};

export const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...DEFAULT_BUSINESS_PROFILE,
  name: 'Sure Lock Key',
  ...over,
});

export function mockDealClient() {
  return {
    getBillingView: jest.fn(async (..._a: any[]): Promise<any> => billingView()),
    replaceAllProducts: jest.fn(async (..._a: any[]): Promise<any> => ({ items: [dealProduct()], deal: deal() })),
    setInvoiceLink: jest.fn(async (..._a: any[]): Promise<any> => undefined),
    addTimeline: jest.fn(async (..._a: any[]): Promise<any> => undefined),
    listTaxRates: jest.fn(async (..._a: any[]): Promise<any> => []),
    listDealIdsByTech: jest.fn(async (..._a: any[]): Promise<any> => new Set<string>()),
    listServiceAreas: jest.fn(async (..._a: any[]): Promise<any> => [{ id: 'sa-1', name: 'Hartford', timezone: 'America/New_York' }]),
    listCustomFields: jest.fn(async (..._a: any[]): Promise<any> => []),
    listNeedsInvoice: jest.fn(async (..._a: any[]): Promise<any> => []),
    listByContact: jest.fn(async (..._a: any[]): Promise<any> => []),
  };
}

export function mockCrmClient() {
  return {
    getContact: jest.fn(async (..._a: any[]): Promise<any> => ({
      id: 'contact-1',
      firstName: 'Jane',
      lastName: 'Client',
      phones: ['+18605550100'],
      emails: ['jane@example.com'],
      addresses: [],
    })),
    getCompany: jest.fn(async (..._a: any[]): Promise<any> => null as unknown),
  };
}

export function mockProfileService(p: BusinessProfile = profile()) {
  return { get: jest.fn(async (_id?: string): Promise<BusinessProfile> => p) };
}

export function mockEvents() {
  return { invoice: jest.fn(), estimate: jest.fn() };
}

export function mockDocuments() {
  return {
    html: jest.fn(async () => ({ html: '<html></html>' })),
    pdf: jest.fn(async () => ({ url: 'https://s3/pdf' })),
  };
}

export { PaymentTerms, DataScope };
