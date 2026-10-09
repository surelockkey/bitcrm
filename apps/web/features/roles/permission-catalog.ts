import { actionLabel, groupedResources, resourceLabel, type Schema } from "./lib";

/**
 * The words of the permission editors, as Workiz's "Edit permissions for
 * role …" prints them (pg_admin_users_wz_10_role_dispatch): one green switch
 * per row, each row a bold title ("Add Jobs") over a sentence saying what it
 * lets a person do ("Schedule new jobs"). Workiz's own words where a row is
 * the same thing; the rest say plainly what the switch opens, from what the
 * code checks (workiz-data-parser/docs/import/app-parity-2026-10-08/
 * permissions_completeness.md).
 *
 * Words only — what a switch grants is the registry's and the server's.
 */

/** What each resource covers — the line under its name in the list, and Search's. */
export const RESOURCE_DESCRIPTIONS: Record<string, string> = {
  deals: "Jobs, the schedule and the dispatch map",
  contacts: "Clients and their information — and whether their phone numbers show",
  companies: "Company clients and their people",
  client_tags: "The tags you put on clients",
  work_orders: "Work order documents attached to jobs",
  job_types: "Job types, and the technicians proposed and approved for each",
  job_sources: "Where jobs come from — the ad source on a job",
  external_companies: "Partner companies that send you jobs",
  job_tags: "The tags you put on jobs",
  job_statuses: "The statuses and sub-statuses a job moves through",
  custom_fields: "Extra fields on the job form",
  service_areas: "The areas you serve, and the technicians proposed and approved for each",
  estimates: "Estimates for clients",
  invoices: "Invoices for jobs",
  payments: "Payments on jobs and invoices",
  tax_rates: "Sales tax rates on invoices and estimates",
  document_templates: "Invoice and estimate templates and the business details on them",
  financials: "Prices, totals and costs",
  commission: "Technician commission rates and the commission report",
  calls: "The call log, recordings and live calls",
  messages: "The client inbox — texts and emails",
  team_chat: "Chats between the office and technicians",
  message_templates: "Saved text and email templates",
  products: "Items and services in the price book and inventory",
  product_categories: "The price book's categories",
  brands: "The price book's brands",
  warehouses: "Warehouses that hold stock",
  containers: "Vans and other containers that hold stock",
  transfers: "Moving stock between warehouses and containers",
  users: "Users, their roles and their permissions",
  roles: "Roles and what each one can see and do",
  technicians: "Technician cards — skills, areas, availability, onboarding",
  documents: "Files on technician cards — licences, insurance and the like",
  dashboard: "View dashboard statistics",
  reports: "The Reports hub and the reports in it",
  settings: "Account settings and preferences",
};

export function resourceDescription(resource: string): string {
  return RESOURCE_DESCRIPTIONS[resource] ?? resourceLabel(resource);
}

/**
 * Switches nothing in the code reads (checked 2026-10-09: no route guard, no
 * service check, no screen). Their stored values are kept; the editors just
 * do not offer them, since flipping one changes nothing. A test fails the day
 * one of them is checked, so it comes back to the editors with its words.
 */
export const UNUSED_PERMISSIONS: readonly string[] = [
  "transfers.edit",
  "transfers.delete",
  "reports.create",
  "reports.delete",
  "technicians.create",
  "technicians.delete",
  "tax_rates.create",
  "tax_rates.edit",
  "tax_rates.delete",
];

export function isShownPermission(resource: string, action: string): boolean {
  return !UNUSED_PERMISSIONS.includes(`${resource}.${action}`);
}

/** A resource's name in a row title ("View Price Book Items"). */
const TITLE_NOUN: Record<string, string> = {
  products: "Price Book Items",
  product_categories: "Price Book Categories",
  brands: "Price Book Brands",
  transfers: "Stock Transfers",
  documents: "Technician Documents",
};

/** The same in a sentence ("Create new price book items"). */
const SENTENCE_NOUN: Record<string, string> = {
  deals: "jobs",
  contacts: "clients",
  companies: "company clients",
  products: "price book items and services",
  product_categories: "price book categories",
  brands: "price book brands",
  transfers: "stock transfers",
  documents: "files on technician cards",
};

type Words = { title: string; description: string };

/**
 * The row words of every switch that is not plain View / Add / Edit / Delete
 * of a list — and of those whose plain words would undersell them. Workiz's
 * own rows where they match: Add Jobs, Messaging, Pricebook Access, Financial
 * Data, Voice, the Statistics Report grants, Dashboard.
 */
const WORDS: Record<string, Record<string, Words>> = {
  deals: {
    view: { title: "View Jobs", description: "See jobs, the schedule and the dispatch map" },
    create: { title: "Add Jobs", description: "Schedule new jobs" },
    edit: { title: "Edit Jobs", description: "Change a job's details, schedule, team and items" },
    delete: { title: "Delete Jobs", description: "Remove jobs" },
    move_status: { title: "Change Job Status", description: "Move a job to another status, Done and Canceled included" },
  },
  contacts: {
    view: { title: "View Clients", description: "View clients and client information" },
    create: { title: "Add Clients", description: "Create new clients" },
    edit: { title: "Edit Clients", description: "Change client details, addresses, notes and tags" },
    delete: { title: "Delete Clients", description: "Remove clients" },
    view_numbers: {
      title: "See Client Phone Numbers",
      description: "Show clients' phone numbers on jobs, calls and messages — off masks them (call masking)",
    },
  },
  job_types: {
    view: { title: "View Job Types", description: "See job types and who may take them" },
    propose: { title: "Propose Job Types", description: "Ask for job types on one's own technician card" },
    approve: { title: "Approve Job Types", description: "Approve or reject the job types technicians propose" },
    revoke: { title: "Revoke Job Types", description: "Take an approved job type away from a technician" },
  },
  service_areas: {
    view: { title: "View Service Areas", description: "See the areas you serve and who covers them" },
    propose: { title: "Propose Service Areas", description: "Ask for service areas on one's own technician card" },
    approve: { title: "Approve Service Areas", description: "Approve or reject the areas technicians propose" },
    revoke: { title: "Revoke Service Areas", description: "Take an approved area away from a technician" },
  },
  estimates: {
    send: { title: "Send Estimates", description: "Send estimates to clients and share the client portal" },
    sync: { title: "Copy Estimate to Job", description: "Replace a job's items with an estimate's" },
  },
  invoices: {
    send: { title: "Send Invoices", description: "Send invoices to clients and share the client portal" },
  },
  payments: {
    view: { title: "View Payments", description: "See payments on jobs and invoices, and the payments report" },
    collect: { title: "Take Payments", description: "Charge cards and record payments on invoices" },
    refund: { title: "Refund Payments", description: "Can refund and delete job payments" },
  },
  tax_rates: {
    view: { title: "View Tax Rates", description: "See the sales tax rates on invoices and estimates" },
  },
  document_templates: {
    view: { title: "View Document Templates", description: "See invoice and estimate templates" },
    edit: {
      title: "Edit Document Templates",
      description: "Change templates, document defaults and the business details on them",
    },
  },
  financials: {
    view: { title: "Financial Data", description: "Can view prices, totals and costs on jobs, invoices, reports and the dashboard" },
  },
  commission: {
    view: { title: "View Commission", description: "See commission rates and the commission report" },
    edit: { title: "Edit Commission Rates", description: "Change technicians' commission rates" },
  },
  calls: {
    view: { title: "Voice", description: "Can view the call log, recordings and call reports" },
    join: { title: "Listen & Join Calls", description: "Listen in on and join live calls" },
  },
  messages: {
    view: { title: "Messaging", description: "View the messages inbox" },
    send: { title: "Send Messages", description: "Text and email clients" },
    manage: { title: "Manage Messages", description: "Archive, flag, recategorise and mark threads unread" },
  },
  team_chat: {
    view: { title: "View Team Chat", description: "Read chats between the office and technicians" },
    send: { title: "Send Team Chat Messages", description: "Write in team chats" },
    manage_groups: { title: "Manage Team Chat Groups", description: "Create and change team chat groups" },
  },
  products: {
    view: { title: "Pricebook Access", description: "Access to price book and inventory items" },
  },
  containers: {
    view: { title: "View Containers", description: "See vans and other containers and the stock in them" },
  },
  transfers: {
    view: { title: "View Stock Transfers", description: "See stock moved between warehouses and containers" },
    create: { title: "Move Stock", description: "Transfer, receive and fill stock" },
  },
  users: {
    view: { title: "View Users", description: "See the Users list and user cards" },
    create: { title: "Add Users", description: "Invite new users" },
    edit: { title: "Edit Users", description: "Change users' details, roles, two-step sign-in and permissions" },
    delete: { title: "Deactivate Users", description: "Switch users off" },
  },
  roles: {
    view: { title: "View Roles", description: "See roles and their permissions" },
  },
  technicians: {
    view: { title: "View Technicians", description: "See the Technicians list and technician cards" },
    edit: { title: "Edit Technicians", description: "Change technician cards — skills, areas, availability and onboarding" },
  },
  documents: {
    upload: { title: "Upload Technician Documents", description: "Add files to one's own technician card" },
  },
  settings: {
    view: { title: "Account Settings", description: "Access the account settings pages" },
    edit: {
      title: "Change Account Settings",
      description: "Change preferences, automations, phone numbers and payment settings",
    },
  },
  reports: {
    view: { title: "Reports", description: "View the Reports hub and the reports in it" },
    create: { title: "Create Reports", description: "Add new reports" },
    edit: { title: "Save Report Fields", description: "Save the Jobs report's fields for everyone" },
    delete: { title: "Delete Reports", description: "Remove saved reports" },
    view_ad_statistics: { title: "Statistics Report: Ad Statistics", description: "The Sources tab of the Job Statistics report" },
    view_tech_statistics: { title: "Statistics Report: Tech Statistics", description: "The Tech tab of the Job Statistics report" },
    view_area_statistics: { title: "Statistics Report: Area Statistics", description: "The Area tab of the Job Statistics report" },
    view_dispatch_statistics: {
      title: "Statistics Report: Dispatch Statistics",
      description: "The Dispatcher tab of the Job Statistics report",
    },
    view_profit: { title: "Statistics Report: View Profit", description: "Profit in the Job Statistics report (with Financial Data)" },
  },
  dashboard: {
    view: { title: "Dashboard", description: "View dashboard statistics" },
  },
};

const PLAIN: Record<string, (title: string, noun: string) => Words> = {
  view: (t, n) => ({ title: `View ${t}`, description: `See ${n}` }),
  create: (t, n) => ({ title: `Add ${t}`, description: `Create new ${n}` }),
  edit: (t, n) => ({ title: `Edit ${t}`, description: `Change ${n}` }),
  delete: (t, n) => ({ title: `Delete ${t}`, description: `Remove ${n}` }),
};

/** A switch's row: its title and the sentence under it. */
export function permissionWords(resource: string, action: string): Words {
  const known = WORDS[resource]?.[action];
  if (known) return known;
  if (resource === "dashboard") {
    const name = actionLabel(action, resource);
    return { title: `Dashboard: ${name}`, description: `The ${name} card on the dashboard` };
  }
  const title = TITLE_NOUN[resource] ?? resourceLabel(resource);
  const noun = SENTENCE_NOUN[resource] ?? resourceLabel(resource).toLowerCase();
  const plain = PLAIN[action];
  if (plain) return plain(title, noun);
  const name = actionLabel(action, resource);
  return { title: `${title}: ${name}`, description: `${name} — ${noun}` };
}

/**
 * The resources of the Reports tab. Workiz lists each report grant as a row
 * of its own (pg_admin_users_wz_13_tab_reports); the dashboard's cards read
 * the same way.
 */
export const REPORT_TAB_RESOURCES = ["reports", "dashboard"];

/** One switch of the Reports tab. */
export interface ReportRow extends Words {
  resource: string;
  action: string;
}

/** Every shown switch of the Reports tab the schema has, in registry order. */
export function reportRows(schema: Schema): ReportRow[] {
  return REPORT_TAB_RESOURCES.flatMap((resource) =>
    (schema[resource] ?? [])
      .filter((action) => isShownPermission(resource, action))
      .map((action) => ({ resource, action, ...permissionWords(resource, action) })),
  );
}

/** The Actions tab: every other resource under its section's caption, with the switches it shows. */
export function actionSections(
  schema: Schema,
): { label: string; resources: { resource: string; actions: string[] }[] }[] {
  return groupedResources(schema)
    .map((g) => ({
      label: g.label,
      resources: g.resources
        .filter((r) => !REPORT_TAB_RESOURCES.includes(r))
        .map((resource) => ({ resource, actions: schema[resource].filter((a) => isShownPermission(resource, a)) }))
        .filter((r) => r.actions.length > 0),
    }))
    .filter((g) => g.resources.length > 0);
}

/**
 * Whether Search keeps a row: by its title, its sentence, or its resource's
 * name ("payments" keeps every payment row). Any case; blank keeps all.
 */
export function permissionMatches(resource: string, query: string, action: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const w = permissionWords(resource, action);
  return [w.title, w.description, resourceLabel(resource)].some((s) => s.toLowerCase().includes(q));
}
