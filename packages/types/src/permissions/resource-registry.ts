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
  product_categories: ['view', 'create', 'edit', 'delete'],
  brands: ['view', 'create', 'edit', 'delete'],
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
  external_companies: ['view', 'create', 'edit', 'delete'],
  job_tags: ['view', 'create', 'edit', 'delete'],
  job_statuses: ['view', 'create', 'edit', 'delete'],
  custom_fields: ['view', 'create', 'edit', 'delete'],
  work_orders: ['view', 'create', 'edit', 'delete'],
  commission: ['view', 'edit'],
  documents: ['view', 'upload', 'delete'],
  // Telephony call history + live supervision. `view` gates the calls list,
  // call detail and recording playback; `join` gates live listen/join.
  calls: ['view', 'join'],
  // Client inbox: SMS, email and in-app threads with contacts, companies and
  // unknown numbers. `view` is data-scoped (all | department | assigned_only →
  // conversations of jobs the user is assigned to); `send` covers texting and
  // emailing; `manage` archives, flags, recategorises and marks unread. Party
  // phone numbers are masked by the ABSENCE of `contacts.view_numbers`, same
  // as the call log.
  messages: ['view', 'send', 'manage'],
  // Staff chat: technician threads (in-app + SMS to their phone) and groups.
  team_chat: ['view', 'send', 'manage_groups'],
  message_templates: ['view', 'create', 'edit', 'delete'],
  // Billing (Workiz invoices/estimates model).
  tax_rates: ['view', 'create', 'edit', 'delete'],
  invoices: ['view', 'create', 'edit', 'delete', 'send'],
  // `sync` = overwrite the job's items with an estimate's items.
  estimates: ['view', 'create', 'edit', 'delete', 'send', 'sync'],
  // Settings → Documents: PDF templates + business profile.
  document_templates: ['view', 'edit'],
} as const;

export type Resource = keyof typeof RESOURCE_REGISTRY;
export type Action<R extends Resource = Resource> = (typeof RESOURCE_REGISTRY)[R][number];
