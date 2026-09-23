/**
 * Centralized React Query key factory. Every query/mutation references keys
 * from here so invalidation stays precise and typo-free.
 *
 * Convention: `[resource, scope, ...params]`, e.g.
 *   queryKeys.deals.list(filters)   -> ["deals", "list", filters]
 *   queryKeys.deals.detail(id)      -> ["deals", "detail", id]
 */
export const queryKeys = {
  me: () => ["me"] as const,

  jobFieldSettings: () => ["job-field-settings"] as const,

  telephony: {
    numbers: () => ["telephony", "numbers"] as const,
    available: (params?: unknown) =>
      ["telephony", "numbers", "available", params] as const,
    /** Teammates a live call can be handed to or pulled onto. */
    transferTargets: () => ["telephony", "transfer-targets"] as const,
    callGroups: () => ["telephony", "call-groups"] as const,
    callFlows: () => ["telephony", "call-flows"] as const,
  },

  /**
   * The call-tag catalog. Its own root (not under `telephony`) so that the
   * chips, the picker and the Settings page share one cache entry that a
   * telephony-wide invalidation never sweeps out from under them.
   */
  callTags: {
    all: () => ["call-tags"] as const,
    list: () => ["call-tags", "list"] as const,
  },

  calls: {
    all: () => ["calls"] as const,
    /** Prefix for every filtered list — use for invalidation. */
    lists: () => ["calls", "list"] as const,
    list: (filters?: unknown) => ["calls", "list", filters] as const,
    detail: (id: string) => ["calls", "detail", id] as const,
    byParty: (kind: string, id: string) =>
      ["calls", "party", kind, id] as const,
    live: () => ["calls", "live"] as const,
    active: () => ["calls", "active"] as const,
  },

  search: {
    global: (q: string, mode: string) => ["search", mode, q] as const,
  },

  deals: {
    all: () => ["deals"] as const,
    list: (filters?: unknown) => ["deals", "list", filters] as const,
    /** One server-paged list (the jobs page); invalidated with the rest of `all()`. */
    page: (params?: unknown) => ["deals", "page", params] as const,
    /** A bounded window a board / schedule holds whole (dispatch, schedule). */
    window: (window?: unknown) => ["deals", "window", window] as const,
    counts: (params?: unknown) => ["deals", "counts", params] as const,
    byIds: (ids: string[]) => ["deals", "by-ids", ids] as const,
    detail: (id: string) => ["deals", "detail", id] as const,
    timeline: (id: string) => ["deals", id, "timeline"] as const,
    qualifiedTechs: (id: string) => ["deals", id, "qualified-techs"] as const,
    assignments: (id: string) => ["deals", id, "assignments"] as const,
    products: (id: string) => ["deals", id, "products"] as const,
    attachments: (id: string) => ["deals", id, "attachments"] as const,
    attachmentUrl: (id: string, attachmentId: string) =>
      ["deals", id, "attachments", attachmentId, "url"] as const,
  },

  serviceAreas: {
    all: () => ["service-areas"] as const,
    list: () => ["service-areas", "list"] as const,
    detail: (id: string) => ["service-areas", "detail", id] as const,
    resolve: (point?: unknown) => ["service-areas", "resolve", point] as const,
    nearest: (point?: unknown) => ["service-areas", "nearest", point] as const,
  },

  jobTypes: {
    all: () => ["job-types"] as const,
    list: () => ["job-types", "list"] as const,
    /** Only what a picker can offer — cached apart from the full catalog. */
    active: () => ["job-types", "list", "active"] as const,
    detail: (id: string) => ["job-types", "detail", id] as const,
  },

  jobSources: {
    all: () => ["job-sources"] as const,
    list: () => ["job-sources", "list"] as const,
    /** Only what a picker can offer — cached apart from the full catalog. */
    active: () => ["job-sources", "list", "active"] as const,
    detail: (id: string) => ["job-sources", "detail", id] as const,
  },

  externalCompanies: {
    all: () => ["external-companies"] as const,
    list: () => ["external-companies", "list"] as const,
    detail: (id: string) => ["external-companies", "detail", id] as const,
  },

  jobTags: {
    all: () => ["job-tags"] as const,
    list: () => ["job-tags", "list"] as const,
    detail: (id: string) => ["job-tags", "detail", id] as const,
  },

  jobStatuses: {
    all: () => ["job-statuses"] as const,
    list: () => ["job-statuses", "list"] as const,
    detail: (id: string) => ["job-statuses", "detail", id] as const,
  },

  customFields: {
    all: () => ["custom-fields"] as const,
    list: () => ["custom-fields", "list"] as const,
    detail: (id: string) => ["custom-fields", "detail", id] as const,
  },

  contacts: {
    all: () => ["contacts"] as const,
    list: (filters?: unknown) => ["contacts", "list", filters] as const,
    detail: (id: string) => ["contacts", "detail", id] as const,
    byPhone: (phone: string) => ["contacts", "by-phone", phone] as const,
    byIds: (ids: string[]) => ["contacts", "by-ids", ids] as const,
    /** The server-paged Contacts list (optionally one company's people). */
    page: (companyId?: string) => ["contacts", "page", companyId] as const,
  },

  companies: {
    all: () => ["companies"] as const,
    list: (filters?: unknown) => ["companies", "list", filters] as const,
    detail: (id: string) => ["companies", "detail", id] as const,
    contacts: (id: string) => ["companies", id, "contacts"] as const,
    documents: (id: string) => ["companies", id, "documents"] as const,
  },

  workOrders: {
    all: () => ["work-orders"] as const,
    list: (filters?: unknown) => ["work-orders", "list", filters] as const,
    detail: (id: string) => ["work-orders", "detail", id] as const,
  },

  inventory: {
    products: {
      all: () => ["products"] as const,
      list: (filters?: unknown) => ["products", "list", filters] as const,
      detail: (id: string) => ["products", "detail", id] as const,
      bySku: (sku: string) => ["products", "by-sku", sku] as const,
      photo: (id: string) => ["products", id, "photo"] as const,
      map: () => ["products", "all-map"] as const,
    },
    warehouses: {
      all: () => ["warehouses"] as const,
      list: () => ["warehouses", "list"] as const,
      detail: (id: string) => ["warehouses", "detail", id] as const,
      stock: (id: string) => ["warehouses", id, "stock"] as const,
      transfers: (id: string) => ["warehouses", id, "transfers"] as const,
    },
    containers: {
      all: () => ["containers"] as const,
      list: (filters?: unknown) => ["containers", "list", filters] as const,
      mine: () => ["containers", "mine"] as const,
      detail: (id: string) => ["containers", "detail", id] as const,
      stock: (id: string) => ["containers", id, "stock"] as const,
      transfers: (id: string) => ["containers", id, "transfers"] as const,
    },
    transfers: {
      all: () => ["transfers"] as const,
      list: (filters?: unknown) => ["transfers", "list", filters] as const,
      detail: (id: string) => ["transfers", "detail", id] as const,
    },
  },

  users: {
    all: () => ["users"] as const,
    list: (filters?: unknown) => ["users", "list", filters] as const,
    detail: (id: string) => ["users", "detail", id] as const,
    permissions: (id: string) => ["users", id, "permissions"] as const,
  },

  roles: {
    all: () => ["roles"] as const,
    list: () => ["roles", "list"] as const,
    detail: (id: string) => ["roles", "detail", id] as const,
    schema: () => ["roles", "schema"] as const,
    members: (id: string) => ["roles", id, "members"] as const,
  },

  technicians: {
    all: () => ["technicians"] as const,
    list: (filters?: unknown) => ["technicians", "list", filters] as const,
    profile: (id: string) => ["technicians", id, "profile"] as const,
    onboarding: (id: string) => ["technicians", id, "onboarding"] as const,
    assignments: (id: string) => ["technicians", id, "assignments"] as const,
    pendingAssignments: () => ["technicians", "assignments", "pending"] as const,
    commission: (id: string) => ["technicians", id, "commission"] as const,
    commissionHistory: (id: string) => ["technicians", id, "commission", "history"] as const,
    commissionCalc: (id: string, q?: unknown) => ["technicians", id, "commission", "calc", q] as const,
    documents: (id: string) => ["technicians", id, "documents"] as const,
    sensitive: (id: string) => ["technicians", id, "sensitive"] as const,
    audit: (id: string) => ["technicians", id, "audit"] as const,
    userMap: () => ["users", "all-map"] as const,
    locations: () => ["technicians", "locations"] as const,
  },

  calendarEvents: {
    all: () => ["calendar-events"] as const,
    range: (techIds: string[], from: string, to: string) =>
      ["calendar-events", "range", techIds, from, to] as const,
  },

  messaging: {
    all: () => ["messaging"] as const,
    /** Prefix for every inbox tab — use for invalidation / cache patching. */
    conversationLists: () => ["messaging", "conversations", "list"] as const,
    conversationList: (filter?: unknown) =>
      ["messaging", "conversations", "list", filter] as const,
    conversation: (id: string) => ["messaging", "conversations", "detail", id] as const,
    conversationByParty: (kind: string, id: string) =>
      ["messaging", "conversations", "by-party", kind, id] as const,
    conversationByJob: (dealId: string) =>
      ["messaging", "conversations", "by-job", dealId] as const,
    conversationByAddress: (address: string) =>
      ["messaging", "conversations", "by-address", address] as const,
    textLookups: () => ["messaging", "text-lookup"] as const,
    textLookup: (params?: unknown) => ["messaging", "text-lookup", params] as const,
    /** Prefix for every thread's send options — an opt-out anywhere invalidates the lot. */
    sendOptionsAll: () => ["messaging", "send-options"] as const,
    sendOptions: (conversationId: string) =>
      ["messaging", "send-options", conversationId] as const,
    messages: (conversationId: string) =>
      ["messaging", "messages", "conversation", conversationId] as const,
    messagesByJob: (dealId: string) => ["messaging", "messages", "by-job", dealId] as const,
    flaggedMessages: () => ["messaging", "messages", "flagged"] as const,
    counters: () => ["messaging", "counters"] as const,
    /** The caller's own team-chat badge (`GET /team/counters`). */
    teamCounters: () => ["messaging", "team-counters"] as const,
    templates: (params?: unknown) => ["messaging", "templates", "list", params] as const,
    templatesAll: () => ["messaging", "templates"] as const,
    template: (id: string) => ["messaging", "templates", "detail", id] as const,
    shortCodes: () => ["messaging", "short-codes"] as const,
    settings: () => ["messaging", "settings"] as const,
    optOuts: (address: string) => ["messaging", "opt-outs", address] as const,
  },

  automations: {
    all: () => ["automations"] as const,
    list: () => ["automations", "list"] as const,
    detail: (id: string) => ["automations", "detail", id] as const,
    runs: (id: string) => ["automations", "runs", id] as const,
    /** Every rule's firings in one stream (`GET /automations/runs`). */
    runsFeed: (params?: unknown) => ["automations", "runs-feed", params] as const,
  },

  taxRates: {
    all: () => ["tax-rates"] as const,
    list: () => ["tax-rates", "list"] as const,
  },

  dealTotals: (dealId: string) => ["deals", dealId, "totals"] as const,

  invoices: {
    all: () => ["invoices"] as const,
    list: (params?: unknown) => ["invoices", "list", params] as const,
    detail: (id: string) => ["invoices", "detail", id] as const,
    byDeal: (dealId: string) => ["invoices", "by-deal", dealId] as const,
    byContact: (contactId: string) => ["invoices", "by-contact", contactId] as const,
    summary: () => ["invoices", "summary"] as const,
    needingInvoice: () => ["invoices", "needing-invoice"] as const,
  },

  estimates: {
    all: () => ["estimates"] as const,
    list: (params?: unknown) => ["estimates", "list", params] as const,
    detail: (id: string) => ["estimates", "detail", id] as const,
    byDeal: (dealId: string) => ["estimates", "by-deal", dealId] as const,
    byContact: (contactId: string) => ["estimates", "by-contact", contactId] as const,
    summary: () => ["estimates", "summary"] as const,
  },

  documentTemplates: {
    all: () => ["document-templates"] as const,
    list: () => ["document-templates", "list"] as const,
    detail: (id: string) => ["document-templates", "detail", id] as const,
  },

  /** Companies (business profiles). The old singleton key is gone — read the default company from this list. */
  businessProfiles: {
    all: () => ["business-profiles"] as const,
    list: () => ["business-profiles", "list"] as const,
    detail: (id: string) => ["business-profiles", "detail", id] as const,
  },

  portal: {
    link: (contactId: string) => ["portal", "link", contactId] as const,
  },
} as const;
