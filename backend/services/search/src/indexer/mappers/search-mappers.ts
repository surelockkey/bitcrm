import {
  Deal,
  Contact,
  Company,
  User,
  Product,
  Warehouse,
  Container,
  Transfer,
  SearchDocument,
  SearchDocStatus,
} from '@bitcrm/types';
import { TechnicianSearchInput } from './mapper-input';
import { phoneSearchKey, compactUnique } from '../../common/utils/search-normalize.util';

/** Normalize any entity's lifecycle string to the search doc status. */
function toDocStatus(status: string | undefined): SearchDocStatus {
  switch (status) {
    case 'deleted':
      return 'deleted';
    case 'inactive':
    case 'archived':
      return 'archived';
    default:
      return 'active';
  }
}

/**
 * `jobTypeName` is resolved from `deal.jobTypeId` by the caller (see
 * CatalogNamesService) — the deal itself only stores the catalog id, and a raw
 * uuid in the subtitle would be useless to a searcher.
 */
export function mapDeal(deal: Deal, jobTypeName?: string, tagNames: string[] = []): SearchDocument {
  const addr = deal.address;
  return {
    docId: `deal#${deal.id}`,
    entityId: deal.id,
    type: 'deal',
    permissionResource: 'deals',
    ownerIds: compactUnique([...(deal.assignedTechIds ?? []), deal.assignedDispatcherId, deal.createdBy]),
    status: toDocStatus(deal.status),
    title: `Deal #${deal.dealNumber}`,
    subtitle: compactUnique([jobTypeName, deal.stage]).join(' · ') || undefined,
    keywords: compactUnique([
      deal.serviceArea,
      jobTypeName,
      deal.stage,
      deal.priority,
      deal.paymentStatus,
      addr?.street,
      addr?.city,
      addr?.state,
      addr?.zip,
      ...tagNames,
    ]),
    body: deal.notes,
    url: `/deals/${deal.id}`,
    badges: compactUnique([deal.stage, deal.priority, deal.paymentStatus]),
    updatedAt: deal.updatedAt,
  };
}

export function mapContact(contact: Contact): SearchDocument {
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return {
    docId: `contact#${contact.id}`,
    entityId: contact.id,
    type: 'contact',
    permissionResource: 'contacts',
    ownerIds: compactUnique([contact.createdBy]),
    status: toDocStatus(contact.status),
    title: name,
    subtitle: contact.emails?.[0] || contact.title,
    keywords: compactUnique([
      ...(contact.emails || []),
      ...(contact.phones || []).map((p) => phoneSearchKey(p)),
      contact.title,
    ]),
    body: contact.notes,
    url: `/contacts/${contact.id}`,
    badges: compactUnique([contact.type, contact.status]),
    updatedAt: contact.updatedAt,
  };
}

export function mapCompany(company: Company): SearchDocument {
  return {
    docId: `company#${company.id}`,
    entityId: company.id,
    type: 'company',
    permissionResource: 'companies',
    ownerIds: compactUnique([company.createdBy]),
    status: toDocStatus(company.status),
    title: company.title,
    subtitle: company.website || company.clientType,
    keywords: compactUnique([
      ...(company.emails || []),
      ...(company.phones || []).map((p) => phoneSearchKey(p)),
      company.website,
      company.address,
    ]),
    body: company.notes,
    url: `/companies/${company.id}`,
    badges: compactUnique([company.clientType, company.status]),
    updatedAt: company.updatedAt,
  };
}

export function mapUser(user: User): SearchDocument {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return {
    docId: `user#${user.id}`,
    entityId: user.id,
    type: 'user',
    permissionResource: 'users',
    // A user is "assigned to" themselves — ASSIGNED_ONLY users can find their own record.
    ownerIds: [user.id],
    department: user.department,
    status: toDocStatus(user.status),
    title: name,
    subtitle: user.email,
    keywords: compactUnique([user.email, user.department]),
    // No per-user detail page in the web app — link to the admin users list.
    url: `/admin/users`,
    badges: compactUnique([user.status, user.department]),
    updatedAt: user.updatedAt,
  };
}

export function mapTechnician(input: TechnicianSearchInput): SearchDocument {
  const name = `${input.firstName} ${input.lastName}`.trim();
  return {
    docId: `technician#${input.userId}`,
    entityId: input.userId,
    type: 'technician',
    permissionResource: 'technicians',
    ownerIds: [input.userId],
    department: input.department,
    status: toDocStatus(input.status),
    title: name,
    subtitle: compactUnique([input.department, ...(input.jobTypes || [])]).slice(0, 3).join(' · ') || undefined,
    keywords: compactUnique([
      ...(input.jobTypes || []),
      ...(input.serviceAreas || []),
      phoneSearchKey(input.phone),
    ]),
    url: `/technicians/${input.userId}`,
    badges: compactUnique([input.status, ...(input.jobTypes || []).slice(0, 3)]),
    updatedAt: input.updatedAt,
  };
}

export function mapProduct(product: Product): SearchDocument {
  return {
    docId: `product#${product.id}`,
    entityId: product.id,
    type: 'product',
    permissionResource: 'products',
    ownerIds: [],
    status: toDocStatus(product.status),
    title: product.name,
    subtitle: compactUnique([product.sku, product.category]).join(' · ') || undefined,
    keywords: compactUnique([product.sku, product.barcode, product.category, product.type, product.supplier]),
    body: product.description,
    url: `/inventory/products/${product.id}`,
    badges: compactUnique([product.type, product.category, product.status]),
    updatedAt: product.updatedAt,
  };
}

export function mapWarehouse(warehouse: Warehouse): SearchDocument {
  return {
    docId: `warehouse#${warehouse.id}`,
    entityId: warehouse.id,
    type: 'warehouse',
    permissionResource: 'warehouses',
    ownerIds: [],
    status: toDocStatus(warehouse.status),
    title: warehouse.name,
    subtitle: warehouse.address,
    keywords: compactUnique([warehouse.address, warehouse.description]),
    body: warehouse.description,
    url: `/inventory/warehouses/${warehouse.id}`,
    badges: compactUnique([warehouse.status]),
    updatedAt: warehouse.updatedAt,
  };
}

export function mapContainer(container: Container): SearchDocument {
  return {
    docId: `container#${container.id}`,
    entityId: container.id,
    type: 'container',
    permissionResource: 'containers',
    ownerIds: compactUnique([container.technicianId]),
    department: container.department,
    status: toDocStatus(container.status),
    title: container.technicianName ? `${container.technicianName}'s van` : `Container ${container.id}`,
    subtitle: container.department,
    keywords: compactUnique([container.technicianName, container.department]),
    url: `/inventory/containers/${container.id}`,
    badges: compactUnique([container.status, container.department]),
    updatedAt: container.updatedAt,
  };
}

export function mapTransfer(transfer: Transfer): SearchDocument {
  return {
    docId: `transfer#${transfer.id}`,
    entityId: transfer.id,
    type: 'transfer',
    permissionResource: 'transfers',
    ownerIds: compactUnique([transfer.performedBy]),
    status: 'active',
    title: `Transfer ${transfer.type}`,
    subtitle: transfer.performedByName,
    keywords: compactUnique([
      transfer.type,
      transfer.performedByName,
      ...(transfer.items || []).map((i) => i.productName),
    ]),
    body: transfer.notes,
    // No per-transfer detail page — link to the transfers list.
    url: `/inventory/transfers`,
    badges: compactUnique([transfer.type]),
    updatedAt: transfer.createdAt,
  };
}
