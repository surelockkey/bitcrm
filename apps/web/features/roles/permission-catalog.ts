import { RESOURCE_REGISTRY } from "@bitcrm/types";
import { actionLabel, groupedResources, resourceLabel, type Schema } from "./lib";

/**
 * The words of the permission editors, as Workiz's "Edit permissions for
 * role …" prints them (pg_admin_users_wz_10_role_dispatch): each row a bold
 * title over a sentence saying what it lets a person do, the switch at the
 * right. Workiz's own sentences where a row is the same thing ("View
 * dashboard statistics", "Access the account settings page and change
 * preferences"); the rest say plainly what the switch opens.
 *
 * Words only — what a switch grants is the registry's and the server's.
 */

/** What each resource covers, under its name. */
export const RESOURCE_DESCRIPTIONS: Record<string, string> = {
  deals: "View, add and work on jobs and their schedule",
  contacts: "View and manage clients and client information — without “See client numbers” their phone numbers are masked",
  companies: "View and manage company clients and their people",
  client_tags: "The tags you put on clients",
  work_orders: "Work order documents attached to jobs",
  job_types: "Job types, and the technicians proposed and approved for each",
  job_sources: "Where jobs come from — the ad source on a job",
  external_companies: "Partner companies that send you jobs",
  job_tags: "The tags you put on jobs",
  job_statuses: "The statuses and sub-statuses a job moves through",
  custom_fields: "Extra fields on the job form",
  service_areas: "The areas you serve, and the technicians proposed and approved for each",
  estimates: "Estimates for clients — sending them, and copying their items to a job",
  invoices: "Invoices for jobs — and sending them to the client",
  payments: "Job payments — taking them, and refunding them",
  tax_rates: "Sales tax rates on invoices and estimates",
  document_templates: "Invoice and estimate templates and the business details on them",
  financials: "Can view prices, totals and costs on jobs, reports and the dashboard",
  commission: "Technician commission rates and the commission report",
  calls: "The call log and recordings — and listening in on live calls",
  messages: "View the messages inbox — send texts and emails, archive and flag threads",
  team_chat: "Chat between the office and technicians, and its groups",
  message_templates: "Saved text and email templates",
  products: "Items and services in the price book and inventory",
  product_categories: "The price book's categories",
  brands: "The price book's brands",
  warehouses: "Warehouses that hold stock",
  containers: "Vans and other containers that hold stock",
  transfers: "Moving stock between warehouses and containers",
  users: "Manage users and users settings",
  roles: "Roles and what each one can see and do",
  technicians: "Technician cards — skills, areas, onboarding and commission",
  documents: "Files on technician cards — licences, insurance and the like",
  dashboard: "View dashboard statistics",
  reports: "View the Reports hub and the reports in it",
  settings: "Access the account settings page and change preferences",
};

export function resourceDescription(resource: string): string {
  return RESOURCE_DESCRIPTIONS[resource] ?? resourceLabel(resource);
}

/**
 * The resources of the Reports tab. Workiz lists each report grant as a row
 * of its own (pg_admin_users_wz_13_tab_reports: "Statistics Report: Ad
 * Statistics" …); the dashboard's widgets read the same way.
 */
export const REPORT_TAB_RESOURCES = ["reports", "dashboard"];

/** One switch of the Reports tab. */
export interface ReportRow {
  resource: string;
  action: string;
  title: string;
  description: string;
}

const REPORT_WORDS: Record<string, Record<string, { title: string; description: string }>> = {
  reports: {
    view: { title: "Reports", description: "View the Reports hub and the reports in it" },
    create: { title: "Create Reports", description: "Add new reports" },
    edit: { title: "Edit Reports", description: "Change saved reports" },
    delete: { title: "Delete Reports", description: "Remove saved reports" },
    view_ad_statistics: { title: "Statistics Report: Ad Statistics", description: "The Sources tab of the Job Statistics report" },
    view_tech_statistics: { title: "Statistics Report: Tech Statistics", description: "The Tech tab of the Job Statistics report" },
    view_area_statistics: { title: "Statistics Report: Area Statistics", description: "The Area tab of the Job Statistics report" },
    view_dispatch_statistics: {
      title: "Statistics Report: Dispatch Statistics",
      description: "The Dispatcher tab of the Job Statistics report",
    },
    view_profit: {
      title: "Statistics Report: View Profit",
      description: "Profit in the Job Statistics report (with Financial Data)",
    },
  },
  dashboard: {
    view: { title: "Dashboard", description: "View dashboard statistics" },
  },
};

function reportWords(resource: string, action: string): { title: string; description: string } {
  const known = REPORT_WORDS[resource]?.[action];
  if (known) return known;
  const name = actionLabel(action, resource);
  if (resource === "dashboard") {
    return { title: `Dashboard: ${name}`, description: `The ${name} card on the dashboard` };
  }
  return { title: `${resourceLabel(resource)}: ${name}`, description: `${name} — ${resourceLabel(resource)}` };
}

/** Every switch of the Reports tab the schema has, in registry order. */
export function reportRows(schema: Schema): ReportRow[] {
  return REPORT_TAB_RESOURCES.flatMap((resource) =>
    (schema[resource] ?? []).map((action) => ({ resource, action, ...reportWords(resource, action) })),
  );
}

/** The Actions tab: every other resource, under its section's name. */
export function actionSections(schema: Schema): { label: string; resources: string[] }[] {
  return groupedResources(schema)
    .map((g) => ({ label: g.label, resources: g.resources.filter((r) => !REPORT_TAB_RESOURCES.includes(r)) }))
    .filter((g) => g.resources.length > 0);
}

/**
 * Whether Search keeps a row: a resource row by its name, its sentence or the
 * words of any of its switches; a Reports row (`action` given) by its own
 * title and sentence. Any case; blank keeps everything.
 */
export function permissionMatches(resource: string, query: string, action?: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const words =
    action !== undefined
      ? Object.values(reportWords(resource, action))
      : [resourceLabel(resource), resourceDescription(resource), ...actionsOf(resource).map((a) => actionLabel(a, resource))];
  return words.some((w) => w.toLowerCase().includes(q));
}

function actionsOf(resource: string): readonly string[] {
  return (RESOURCE_REGISTRY as unknown as Record<string, readonly string[]>)[resource] ?? [];
}
