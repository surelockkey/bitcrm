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
  CustomFieldValue,
} from '@bitcrm/types';
import {
  CustomFieldSearchDef,
  DealClientSearchInput,
  TechnicianSearchInput,
} from './mapper-input';
import {
  compactUnique,
  looksLikePhone,
  phoneSearchVariants,
} from '../../common/utils/search-normalize.util';

/**
 * A phone is indexed as typed plus its digit variants, so both partial
 * formatted queries ("347-8370") and collapsed ones ("7283478370") match.
 */
function withPhoneVariants(phones: string[] | undefined): string[] {
  return (phones ?? []).flatMap((p) => [p, ...phoneSearchVariants(p)]);
}

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

/** Coerce a stored custom-field answer to a single searchable token/string. */
function stringifyCustomFieldValue(value: CustomFieldValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  // multi_select stores an array — join so every option stays searchable.
  if (Array.isArray(value)) return value.filter(Boolean).join(' ') || undefined;
  // number / date / checkbox / dropdown all coerce cleanly to text.
  return String(value);
}

/**
 * Fold a deal's stored custom-field answers into search text. Only definitions
 * flagged `searchable` contribute; ids with no matching (or non-searchable) def
 * are dropped, so unindexed answers never leak into the document.
 */
function customFieldKeywords(
  customFields: Record<string, CustomFieldValue> | undefined,
  defs: CustomFieldSearchDef[],
): string[] {
  if (!customFields) return [];
  const searchable = new Set(defs.filter((d) => d.searchable).map((d) => d.id));
  const out: string[] = [];
  for (const [id, value] of Object.entries(customFields)) {
    if (!searchable.has(id)) continue;
    const text = stringifyCustomFieldValue(value);
    if (!text) continue;
    out.push(text);
    // A phone stored in a custom field gets the same digit variants as a
    // contact's phone, so collapsed queries find it too.
    if (looksLikePhone(text)) out.push(...phoneSearchVariants(text));
  }
  return out;
}

/**
 * `jobTypeName` is resolved from `deal.jobTypeId` by the caller (see
 * CatalogNamesService) — the deal itself only stores the catalog id, and a raw
 * uuid in the subtitle would be useless to a searcher. `customFieldDefs` is
 * resolved the same way, so the mapper can fold only the searchable answers
 * (`deal.customFields` stores raw values keyed by definition id). `client` is
 * the deal's contact/company slice (resolved from crm-service) — folded in so
 * a job is findable by its client's name, phone or email, Workiz-style.
 */
export function mapDeal(
  deal: Deal,
  jobTypeName?: string,
  tagNames: string[] = [],
  customFieldDefs: CustomFieldSearchDef[] = [],
  client?: DealClientSearchInput,
  externalCompanyName?: string,
): SearchDocument {
  const addr = deal.address;
  // A "Just here" rename overrides what the job DISPLAYS; both names stay
  // searchable so either finds the job.
  const overrideName = deal.clientName
    ? `${deal.clientName.firstName} ${deal.clientName.lastName}`.trim() || undefined
    : undefined;
  const displayName = overrideName ?? client?.name;
  return {
    docId: `deal#${deal.id}`,
    entityId: deal.id,
    type: 'deal',
    permissionResource: 'deals',
    ownerIds: compactUnique([...(deal.assignedTechIds ?? []), deal.assignedDispatcherId, deal.createdBy]),
    contactId: deal.contactId,
    companyId: deal.companyId,
    status: toDocStatus(deal.status),
    title: `Deal #${deal.dealNumber}`,
    subtitle:
      compactUnique([jobTypeName, deal.superStatus, displayName]).join(' · ') || undefined,
    keywords: compactUnique([
      deal.dealNumber,
      deal.poNumber,
      deal.serviceArea,
      jobTypeName,
      deal.superStatus,
      deal.priority,
      deal.paymentStatus,
      addr?.street,
      addr?.city,
      addr?.state,
      addr?.zip,
      overrideName,
      client?.name,
      client?.companyName,
      externalCompanyName,
      ...(client?.emails ?? []),
      ...withPhoneVariants(client?.phones),
      ...tagNames,
      ...customFieldKeywords(deal.customFields, customFieldDefs),
    ]),
    body: deal.notes,
    url: `/deals/${deal.id}`,
    badges: compactUnique([deal.superStatus, deal.priority, deal.paymentStatus]),
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
      ...withPhoneVariants(contact.phones),
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
      ...withPhoneVariants(company.phones),
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
      ...withPhoneVariants(input.phone ? [input.phone] : undefined),
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
    title: container.name || (container.technicianName ? `${container.technicianName}'s van` : `Container ${container.id}`),
    subtitle: container.technicianName || container.department,
    keywords: compactUnique([container.name, container.technicianName, container.department]),
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
