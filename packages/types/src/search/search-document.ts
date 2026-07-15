import { Resource } from '../permissions/resource-registry';

/**
 * Every searchable entity is denormalized into this one flat shape and stored in
 * a single OpenSearch index. `type` distinguishes the entity; `permissionResource`
 * / `ownerIds` / `department` drive query-time authorization (see SearchAuthzBuilder).
 */
export type SearchType =
  | 'deal'
  | 'contact'
  | 'company'
  | 'user'
  | 'technician'
  | 'product'
  | 'warehouse'
  | 'container'
  | 'transfer'
  | 'stock';

export const SEARCH_TYPES: readonly SearchType[] = [
  'deal',
  'contact',
  'company',
  'user',
  'technician',
  'product',
  'warehouse',
  'container',
  'transfer',
  'stock',
] as const;

/**
 * Maps each search type to the permission-registry resource that gates it.
 * A user must have `view` on the mapped resource to see documents of that type,
 * and the resource's data-scope determines which of them.
 */
export const SEARCH_TYPE_TO_RESOURCE: Record<SearchType, Resource> = {
  deal: 'deals',
  contact: 'contacts',
  company: 'companies',
  user: 'users',
  technician: 'technicians',
  product: 'products',
  warehouse: 'warehouses',
  container: 'containers',
  transfer: 'transfers',
  stock: 'products',
};

/** Document lifecycle state — soft-deleted/archived docs are excluded from default results. */
export type SearchDocStatus = 'active' | 'archived' | 'deleted';

export interface SearchDocument {
  /** Upsert key: `${type}#${entityId}`. */
  docId: string;
  entityId: string;
  type: SearchType;

  // --- authorization (indexed, filtered at query time) ---
  /** Permission-registry resource gating this doc (view + data-scope). */
  permissionResource: Resource;
  /** User ids considered "owners" for ASSIGNED_ONLY scope (tech, dispatcher, creator…). */
  ownerIds: string[];
  /** Department for DEPARTMENT scope; omitted for entities with no department dimension. */
  department?: string;
  status: SearchDocStatus;

  // --- search ---
  /** Primary label ("Acme Corp", "John Smith", "Deal #1042"). Highest weight. */
  title: string;
  /** Secondary line ("Deal · Scheduled", email, SKU). */
  subtitle?: string;
  /** Extra exact/prefix tokens (phone, email, SKU, tags, skills). */
  keywords: string[];
  /** Free text (notes/description). Lowest weight. */
  body?: string;

  // --- display (returned so the client needs no hydration) ---
  /** Deep-link path the frontend routes to. */
  url?: string;
  /** Chips: stage, role, product type, status… */
  badges: string[];
  /** ISO timestamp — recency boost + tie-break. */
  updatedAt: string;
}
