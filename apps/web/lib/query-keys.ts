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

  search: {
    global: (q: string, mode: string) => ["search", mode, q] as const,
  },

  deals: {
    all: () => ["deals"] as const,
    list: (filters?: unknown) => ["deals", "list", filters] as const,
    detail: (id: string) => ["deals", "detail", id] as const,
    timeline: (id: string) => ["deals", id, "timeline"] as const,
    allowedStages: (id: string) => ["deals", id, "allowed-stages"] as const,
    qualifiedTechs: (id: string) => ["deals", id, "qualified-techs"] as const,
    products: (id: string) => ["deals", id, "products"] as const,
  },

  serviceAreas: {
    all: () => ["service-areas"] as const,
    list: () => ["service-areas", "list"] as const,
    detail: (id: string) => ["service-areas", "detail", id] as const,
    resolve: (point?: unknown) => ["service-areas", "resolve", point] as const,
  },

  jobTypes: {
    all: () => ["job-types"] as const,
    list: () => ["job-types", "list"] as const,
    detail: (id: string) => ["job-types", "detail", id] as const,
  },

  jobSources: {
    all: () => ["job-sources"] as const,
    list: () => ["job-sources", "list"] as const,
    detail: (id: string) => ["job-sources", "detail", id] as const,
  },

  jobTags: {
    all: () => ["job-tags"] as const,
    list: () => ["job-tags", "list"] as const,
    detail: (id: string) => ["job-tags", "detail", id] as const,
  },

  contacts: {
    all: () => ["contacts"] as const,
    list: (filters?: unknown) => ["contacts", "list", filters] as const,
    detail: (id: string) => ["contacts", "detail", id] as const,
    byPhone: (phone: string) => ["contacts", "by-phone", phone] as const,
  },

  companies: {
    all: () => ["companies"] as const,
    list: (filters?: unknown) => ["companies", "list", filters] as const,
    detail: (id: string) => ["companies", "detail", id] as const,
    contacts: (id: string) => ["companies", id, "contacts"] as const,
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
} as const;
