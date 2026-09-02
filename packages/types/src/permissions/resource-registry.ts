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
  deals: ['view', 'create', 'edit', 'delete', 'move_status'],
  service_areas: ['view', 'create', 'edit', 'delete', 'propose', 'approve', 'revoke'],
  // `view_numbers` gates CLIENT PHONE NUMBERS wherever they surface — the
  // contact record, the company record, the job page, the call log, the
  // softphone screen-pop and the job timeline. Call masking is the ABSENCE of
  // this grant, which is why it hangs off `contacts` rather than `calls`: a
  // technician holds `contacts.view` and not `calls.view`, and the job page
  // renders the client's numbers directly. Company phones ride the same key on
  // purpose — masked on residential jobs but not commercial ones is a state
  // nobody wants and everybody would eventually configure by accident.
  contacts: ['view', 'create', 'edit', 'delete', 'view_numbers'],
  companies: ['view', 'create', 'edit', 'delete'],
  products: ['view', 'create', 'edit', 'delete'],
  warehouses: ['view', 'create', 'edit', 'delete'],
  containers: ['view', 'create', 'edit', 'delete'],
  transfers: ['view', 'create', 'edit', 'delete'],
  users: ['view', 'create', 'edit', 'delete'],
  roles: ['view', 'create', 'edit', 'delete'],
  reports: ['view', 'create', 'edit', 'delete'],
  settings: ['view', 'edit'],
  technicians: ['view', 'create', 'edit', 'delete'],
  job_types: ['view', 'create', 'edit', 'delete', 'propose', 'approve', 'revoke'],
  job_sources: ['view', 'create', 'edit', 'delete'],
  job_tags: ['view', 'create', 'edit', 'delete'],
  job_statuses: ['view', 'create', 'edit', 'delete'],
  custom_fields: ['view', 'create', 'edit', 'delete'],
  work_orders: ['view', 'create', 'edit', 'delete'],
  commission: ['view', 'edit'],
  documents: ['view', 'upload', 'delete'],
  // Telephony call history + live supervision. `view` gates the calls list,
  // call detail and recording playback; `join` gates live listen/join.
  calls: ['view', 'join'],
} as const;

export type Resource = keyof typeof RESOURCE_REGISTRY;
export type Action<R extends Resource = Resource> = (typeof RESOURCE_REGISTRY)[R][number];
