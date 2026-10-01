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
  // Job Statistics: one action per tab (Workiz "Statistics Report" sub-grants
  // Ad 1010, Tech 1011, Area 1012, Dispatch 1013) and `view_profit` (Workiz
  // "View Profit" 1014, on top of `financials.view`). deal-service closes a
  // tab only on an explicit `false`, so a role saved before these existed
  // keeps every tab it had.
  reports: [
    'view',
    'create',
    'edit',
    'delete',
    'view_ad_statistics',
    'view_tech_statistics',
    'view_area_statistics',
    'view_dispatch_statistics',
    'view_profit',
  ],
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
  // Money across the business — revenue, profit, cost on the dashboard and
  // the job reports (Workiz: "view financial data"). Without it those show
  // counts only; the server leaves every amount out.
  financials: ['view'],
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
  /**
   * Dashboard widgets, one action per widget.
   *
   * Visibility rides the permission matrix rather than a second ACL of its
   * own: the grant is already resolved per user, cached in Redis and enforced
   * by `PermissionGuard` in every service, so a widget hidden from a role is
   * one whose **data endpoint refuses that role** — not one the browser
   * declines to paint. Widening the matrix is the price; a viewer opening
   * DevTools and getting the numbers anyway is what it buys.
   *
   * `view` is the dashboard itself; each widget then has its own action under
   * it. A new widget adds an action here and a grant in both role-seed files.
   */
  dashboard: [
    'view',
    'view_jobs_by_status',
    'view_sales',
    'view_top_sources',
    'view_top_job_types',
    'view_service_areas',
    'view_top_call_flows',
    'view_dispatch_scoreboard',
    'view_tech_scoreboard',
    'view_recent_calls',
    'view_jobs',
    'view_today',
  ],
  // `collect` takes money (portal sends + offline records); `refund` gives it
  // back and is deliberately not a technician's to hold.
  payments: ['view', 'collect', 'refund'],
} as const;

export type Resource = keyof typeof RESOURCE_REGISTRY;
export type Action<R extends Resource = Resource> = (typeof RESOURCE_REGISTRY)[R][number];
