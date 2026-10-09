import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  ClipboardCheck,
  FileText,
  House,
  LayoutGrid,
  Map,
  MessagesSquare,
  Package,
  Phone,
  Receipt,
  Settings,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  UsersRound,
  Workflow,
  Wrench,
} from "lucide-react";
import type { Resource } from "@bitcrm/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Gate: item shows only if the user can `view` this resource (if set). */
  resource?: Resource;
  /** Gate: item shows if the user can `view` ANY of these resources. */
  resources?: Resource[];
  /** "coming-soon" items are hidden unless NEXT_PUBLIC_SHOW_ROADMAP is set. */
  status?: "available" | "coming-soon";
}

/**
 * One block of the sidebar. Workiz draws its blocks apart with thin rules and
 * no captions, so `label` is a key for code and tests, never shown. The
 * `features` block is Workiz's "Features" row with its indented sub-rows.
 */
export interface NavGroup {
  label: string;
  items: NavItem[];
  kind?: "features";
}

/**
 * The first row, alone above the first rule, as Workiz's "Home". (Its crumb
 * still reads "Dashboard" — Workiz's breadcrumb says so on the same page.)
 */
export const OVERVIEW_ITEM: NavItem = {
  label: "Home",
  href: "/",
  icon: House,
};

/**
 * Not a sidebar row: Workiz keeps Settings in the top-right avatar menu, and
 * so do we (NavUser). The command palette and the crumbs still know it.
 */
export const SETTINGS_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
  resource: "settings",
};

/**
 * The sidebar after Home, in Workiz's blocks, words and order
 * (app_audit_wz_home): Workiz Phone … | Schedule · Map · Jobs · Clients … |
 * Estimates · Invoices · Price book | Reports | Features ▸ Automations …
 * Inventory. Pages Workiz lacks (Messages, Companies, Work Orders) sit in the
 * block Workiz would file them under; pages we lack (Answering, Marketing,
 * Leads, Recordings, Workiz Pay, Online booking …) are not drawn at all.
 */
export const MAIN_NAV: NavGroup[] = [
  {
    label: "Communications",
    items: [
      { label: "BitCRM Phone", href: "/calls", icon: Phone, resource: "calls" },
      // The client inbox (SMS today; email and in-app land on the same page).
      { label: "Messages", href: "/messages", icon: MessagesSquare, resource: "messages" },
    ],
  },
  {
    label: "Work",
    items: [
      { label: "Schedule", href: "/schedule", icon: Calendar, resource: "deals" },
      { label: "Map", href: "/dispatch", icon: Map, resource: "deals" },
      { label: "Jobs", href: "/deals", icon: Briefcase, resource: "deals" },
      { label: "Clients", href: "/contacts", icon: Users, resource: "contacts" },
      { label: "Companies", href: "/companies", icon: Building2, resource: "companies" },
    ],
  },
  {
    label: "Documents",
    items: [
      { label: "Estimates", href: "/estimates", icon: FileText, resource: "estimates" },
      { label: "Invoices", href: "/invoices", icon: Receipt, resource: "invoices" },
      { label: "Work Orders", href: "/work-orders", icon: ClipboardCheck, resource: "work_orders" },
      // Workiz "Services & Products": every item, stock-managed or not, and
      // the categories and brands they're filed under. Inventory is the stock.
      { label: "Price book", href: "/price-book", icon: BookOpen, resource: "products" },
    ],
  },
  {
    label: "Insights",
    items: [
      // The Reports hub; every report, Commissions (Legacy) included, is a
      // tile in it — Workiz has no separate menu entries either.
      { label: "Reports", href: "/reports", icon: BarChart3, resource: "reports" },
    ],
  },
  {
    label: "Features",
    kind: "features",
    items: [
      { label: "Automations", href: "/automations", icon: Workflow, resource: "settings" },
      {
        label: "Inventory",
        href: "/inventory",
        icon: Package,
        resources: ["products", "warehouses", "containers", "transfers"],
      },
    ],
  },
];

/** Workiz's "Features" row: the heading over the block's sub-rows. */
export const FEATURES_HEADING = { label: "Features", icon: LayoutGrid };

/**
 * Team, as Workiz keeps it: under Settings only (its Team Management and
 * Roles & Permissions tiles), never a sidebar row. Reached from the settings
 * home and the command palette; the crumbs name them from here.
 */
export const TEAM_NAV: NavItem[] = [
  { label: "Technicians", href: "/technicians", icon: Wrench, resource: "technicians" },
  { label: "Users", href: "/admin/users", icon: UsersRound, resource: "users" },
  { label: "Roles", href: "/admin/roles", icon: ShieldCheck, resource: "roles" },
];

/**
 * Simplified nav for the Technician role (assigned-only scope). The
 * phone-first pages come first: the day list, then the van. `/deals` and
 * `/inventory/containers` keep working for a technician who lands on them
 * (the office's table view of the same jobs, the same van read-only).
 */
export const TECHNICIAN_NAV: NavItem[] = [
  { label: "My Jobs", href: "/my-jobs", icon: Briefcase },
  { label: "Messages", href: "/messages", icon: MessagesSquare, resource: "messages" },
  { label: "My Stock", href: "/my-stock", icon: Truck, resource: "containers" },
  { label: "My Profile", href: "/profile", icon: UserRound },
];

/** Where a technician lands after signing in — their day, not a dashboard. */
export const TECHNICIAN_HOME = "/my-jobs";

export const SHOW_ROADMAP = process.env.NEXT_PUBLIC_SHOW_ROADMAP === "true";

/** Filter an item list by roadmap flag + view permission. */
export function visibleNavItems(
  items: NavItem[],
  can: (resource: Resource) => boolean,
): NavItem[] {
  return items.filter((item) => {
    if (item.status === "coming-soon" && !SHOW_ROADMAP) return false;
    if (item.resource && !can(item.resource)) return false;
    if (item.resources && !item.resources.some(can)) return false;
    return true;
  });
}
