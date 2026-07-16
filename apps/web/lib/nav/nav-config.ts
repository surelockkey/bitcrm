import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  ClipboardCheck,
  Contact,
  CreditCard,
  FileText,
  LayoutDashboard,
  Map,
  MessagesSquare,
  MessageSquare,
  Package,
  Phone,
  Settings,
  ShieldCheck,
  Truck,
  UserRound,
  UsersRound,
  Warehouse,
  Wrench,
} from "lucide-react";
import type { Resource } from "@bitcrm/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Gate: item shows only if the user can `view` this resource (if set). */
  resource?: Resource;
  /** "coming-soon" items are hidden unless NEXT_PUBLIC_SHOW_ROADMAP is set. */
  status?: "available" | "coming-soon";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Shown above the groups (no gate). */
export const OVERVIEW_ITEM: NavItem = {
  label: "Dashboard",
  href: "/",
  icon: LayoutDashboard,
};

/** Shown in the sidebar footer. */
export const SETTINGS_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
  resource: "settings",
};

export const MAIN_NAV: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Deals", href: "/deals", icon: Briefcase, resource: "deals" },
      { label: "Dispatch Map", href: "/dispatch", icon: Map, resource: "deals" },
      { label: "Schedule", href: "/schedule", icon: Calendar, resource: "deals", status: "coming-soon" },
    ],
  },
  {
    label: "Clients",
    items: [
      { label: "Contacts", href: "/contacts", icon: Contact, resource: "contacts" },
      { label: "Companies", href: "/companies", icon: Building2, resource: "companies" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Products", href: "/inventory/products", icon: Package, resource: "products" },
      { label: "Warehouses", href: "/inventory/warehouses", icon: Warehouse, resource: "warehouses" },
      { label: "Containers", href: "/inventory/containers", icon: Truck, resource: "containers" },
      { label: "Transfers", href: "/inventory/transfers", icon: ArrowLeftRight, resource: "transfers" },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Technicians", href: "/technicians", icon: Wrench, resource: "technicians" },
      { label: "Users", href: "/admin/users", icon: UsersRound, resource: "users" },
      { label: "Roles", href: "/admin/roles", icon: ShieldCheck, resource: "roles" },
    ],
  },
  {
    label: "Communications",
    items: [
      { label: "Active Calls", href: "/calls", icon: Phone, status: "coming-soon" },
      { label: "SMS", href: "/sms", icon: MessageSquare, status: "coming-soon" },
      { label: "Messages", href: "/messages", icon: MessagesSquare, status: "coming-soon" },
    ],
  },
  {
    label: "Billing",
    items: [
      { label: "Invoices", href: "/invoices", icon: FileText, status: "coming-soon" },
      { label: "Payments", href: "/payments", icon: CreditCard, status: "coming-soon" },
      { label: "Work Orders", href: "/work-orders", icon: ClipboardCheck, status: "coming-soon" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Commission", href: "/reports/commission", icon: BarChart3, resource: "reports", status: "coming-soon" },
      { label: "Analytics", href: "/reports/analytics", icon: BarChart3, resource: "reports", status: "coming-soon" },
    ],
  },
];

/** Simplified nav for the Technician role (assigned-only scope). */
export const TECHNICIAN_NAV: NavItem[] = [
  { label: "My Jobs", href: "/deals", icon: Briefcase },
  { label: "My Container", href: "/inventory/containers", icon: Truck },
  { label: "My Profile", href: "/profile", icon: UserRound },
];

export const SHOW_ROADMAP = process.env.NEXT_PUBLIC_SHOW_ROADMAP === "true";

/** Filter an item list by roadmap flag + view permission. */
export function visibleNavItems(
  items: NavItem[],
  can: (resource: Resource) => boolean,
): NavItem[] {
  return items.filter((item) => {
    if (item.status === "coming-soon" && !SHOW_ROADMAP) return false;
    if (item.resource && !can(item.resource)) return false;
    return true;
  });
}
