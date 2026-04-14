/**
 * Single source of truth for all resources and their allowed actions.
 *
 * To add a new resource to the permission system:
 *   1. Add one entry here
 *   2. Existing roles automatically get `false` for the new resource (deny-by-default)
 *
 * The registry is intentionally not an enum — it's a plain object so that
 * resource keys and action arrays can be iterated at runtime for validation
 * and matrix generation.
 */
export const RESOURCE_REGISTRY = {
  deals: ['view', 'create', 'edit', 'delete'],
  contacts: ['view', 'create', 'edit', 'delete'],
  companies: ['view', 'create', 'edit', 'delete'],
  products: ['view', 'create', 'edit', 'delete'],
  warehouses: ['view', 'create', 'edit', 'delete'],
  containers: ['view', 'create', 'edit', 'delete'],
  transfers: ['view', 'create', 'edit', 'delete'],
  users: ['view', 'create', 'edit', 'delete'],
  roles: ['view', 'create', 'edit', 'delete'],
  reports: ['view', 'create', 'edit', 'delete'],
  settings: ['view', 'edit'],
} as const;

export type Resource = keyof typeof RESOURCE_REGISTRY;
export type Action<R extends Resource = Resource> = (typeof RESOURCE_REGISTRY)[R][number];
