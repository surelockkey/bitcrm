import type { LucideIcon } from "lucide-react";
import {
  Asterisk,
  MapPin,
  SlidersHorizontal,
  Wrench,
  Megaphone,
  Building2,
  Tags,
  ListChecks,
  ListPlus,
  Phone,
  PhoneCall,
  Users,
  UsersRound,
  ShieldCheck,
  Workflow,
  MessagesSquare,
  Building,
  FileStack,
  CreditCard,
  Bell,
} from "lucide-react";
import type { Resource } from "@bitcrm/types";

export interface SettingsSection {
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
  /** Shown only if the user can `view` this resource (if set). */
  resource?: Resource;
}

export interface SettingsGroup {
  label: string;
  sections: SettingsSection[];
}

/**
 * The rail's first link: the settings screen itself, every block on it. It
 * used to open a page of its own that held nothing but "preferences will
 * live here"; /settings/general now sends old links here.
 */
export const SETTINGS_HOME = { label: "General", href: "/settings", icon: SlidersHorizontal };

/**
 * The settings, in Workiz's blocks and Workiz's order: its settings page is
 * a heading per block over that block's tiles, and the office moving over
 * from it looks for Call Flows under Calls & Text.
 *
 * Where a tile is the same thing as Workiz's it carries Workiz's name
 * (app_audit_wz_settings, 2026-10-09): Automation Center, Team Management,
 * Roles & Permissions, Ad Groups (our job sources), Field Validation (which
 * job fields are required), Sub-Status (job statuses). The routes, the
 * pages' own titles and the sidebar words are untouched — only the tile a
 * Workiz user scans for.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "General Settings",
    sections: [
      {
        label: "Companies",
        href: "/settings/companies",
        description: "Your business companies — names, logos and details used on jobs, invoices and estimates.",
        icon: Building,
        resource: "settings",
      },
      {
        // The module moved out to /automations; the settings index keeps the
        // shortcut so anyone who looks for it here still lands on it.
        label: "Automation Center",
        href: "/automations",
        description: "What the system texts on its own — job status, missed calls, reminders.",
        icon: Workflow,
        resource: "settings",
      },
      {
        // Workiz's Notification Center (`/root/notification_center`): the
        // reminders and alerts, a flat list over the same automation rules.
        label: "Notifications",
        href: "/settings/notifications",
        description: "Auto-notifications and reminders for you, your team and clients.",
        icon: Bell,
        resource: "settings",
      },
      {
        label: "Documents",
        href: "/settings/documents",
        description: "Invoice and estimate PDF templates.",
        icon: FileStack,
        resource: "document_templates",
      },
    ],
  },
  {
    // Users and roles live in the main nav's Team group; Workiz keeps them in
    // settings as well, so the shortcuts are here too, as Automations is.
    label: "Users & Roles",
    sections: [
      {
        label: "Team Management",
        href: "/admin/users",
        description: "Who signs in — accounts, roles and access.",
        icon: UsersRound,
        resource: "users",
      },
      {
        label: "Roles & Permissions",
        href: "/admin/roles",
        description: "What each role can see and do.",
        icon: ShieldCheck,
        resource: "roles",
      },
    ],
  },
  {
    label: "Job Settings",
    sections: [
      {
        label: "Service Areas",
        href: "/settings/service-areas",
        description: "Territories that auto-assign jobs, match technicians and set sales tax.",
        icon: MapPin,
        resource: "service_areas",
      },
      {
        label: "Job Types",
        href: "/settings/job-types",
        description: "Kinds of work you dispatch. Jobs pick one; technicians are approved for them.",
        icon: Wrench,
        resource: "job_types",
      },
      {
        label: "External Companies",
        href: "/settings/external-companies",
        description: "Partners that send you work. Jobs can record which one referred them.",
        icon: Building2,
        resource: "external_companies",
      },
      {
        label: "Ad Groups",
        href: "/settings/job-sources",
        description: "Where your jobs come from (job sources). Jobs pick one when created.",
        icon: Megaphone,
        resource: "job_sources",
      },
      {
        label: "Field Validation",
        href: "/settings/job-fields",
        description: "Which fields are required when creating a job — default and custom.",
        icon: Asterisk,
        resource: "settings",
      },
      {
        label: "Custom Fields",
        href: "/settings/custom-fields",
        description: "User-defined fields on deals, grouped and scoped to job types.",
        icon: ListPlus,
        resource: "custom_fields",
      },
      {
        label: "Sub-Status",
        href: "/settings/job-statuses",
        description: "Custom colored statuses under each super-status. A job carries one.",
        icon: ListChecks,
        resource: "job_statuses",
      },
      {
        label: "Job Tags",
        href: "/settings/job-tags",
        description: "Colored labels for deals. A deal can carry many.",
        icon: Tags,
        resource: "job_tags",
      },
      {
        label: "Client Tags",
        href: "/settings/client-tags",
        description: "Colored labels for clients, as Workiz's PLATINUM or tax free. Added from the client card.",
        icon: Tags,
        resource: "client_tags",
      },
    ],
  },
  {
    // Workiz's tiles, words and order (uikit_wz_settings_home). Its phone
    // settings live in its Phone section, so these four open our /calls tabs,
    // as Workiz's /root/numbers lands on /root/callsReport/numbers. Message
    // templates are on Text Messages ("Text templates"); no tile of their own.
    label: "Calls & Text",
    sections: [
      {
        label: "Text Messages",
        href: "/calls/texting",
        description: "Default sender, prefix and signature, tech texts, quiet hours, STOP/HELP replies, message templates.",
        icon: MessagesSquare,
        resource: "settings",
      },
      {
        label: "Numbers",
        href: "/calls/numbers",
        description: "Buy, list, and release the numbers you call and receive on.",
        icon: Phone,
        resource: "settings",
      },
      {
        label: "Call Flows",
        href: "/calls/flows",
        description: "What a caller hears, and who gets rung, before anybody picks up.",
        icon: Workflow,
        resource: "settings",
      },
      {
        label: "Call Groups",
        href: "/calls/groups",
        description: "Who an incoming call rings — softphones, personal numbers, or both.",
        icon: Users,
        resource: "settings",
      },
      {
        label: "Call Tags",
        href: "/settings/call-tags",
        description: "Colored labels for calls — spam, wrong number, a tech calling in.",
        icon: PhoneCall,
        resource: "settings",
      },
    ],
  },
  {
    // Workiz files its online payments ("Workiz Pay") under Integrations.
    label: "Integrations",
    sections: [
      {
        label: "Payments",
        href: "/settings/payments",
        description: "How clients pay online — card and bank, part payments, surcharge and tips.",
        icon: CreditCard,
        resource: "settings",
      },
    ],
  },
];

/**
 * The blocks as this reader sees them: the sections they may not open left
 * out, and a block left with none dropped rather than drawn as a bare heading.
 */
export function visibleSettingsGroups(can: (resource: Resource) => boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter((s) => !s.resource || can(s.resource)),
  })).filter((group) => group.sections.length > 0);
}

/**
 * The settings pages rebuilt as Workiz's: each draws its own frame (the grey
 * band, the grid edge to edge) and none has a settings rail — Workiz goes
 * back to the settings home for the next one. A page not in here yet keeps
 * the old frame (the "Settings" heading and the rail) until its rebuild
 * lands and adds its href.
 */
export const WORKIZ_FRAMED_SETTINGS: ReadonlySet<string> = new Set([
  SETTINGS_HOME.href,
  "/settings/job-types",
  "/settings/job-sources",
  "/settings/job-statuses",
  "/settings/job-tags",
  "/settings/client-tags",
  "/settings/custom-fields",
  "/settings/job-fields",
  "/settings/service-areas",
  "/settings/external-companies",
  "/settings/call-tags",
  "/settings/companies",
  "/settings/documents",
  "/settings/payments",
  "/settings/notifications",
]);

/**
 * The template editor (`/settings/documents/<id>`): Workiz's sits in its app
 * shell (pg_settings_general_wz_doc_invoice), the paper and the side panel
 * filling what is left of the window and scrolling on their own.
 */
const TEMPLATE_EDITOR = /^\/settings\/documents\/[^/]+$/;

/**
 * Which frame the settings layout draws round `pathname`: none (`workiz`),
 * none but bounded to the content area (`editor`), or the old heading and
 * rail (`rail`).
 */
export function settingsFrame(pathname: string): "workiz" | "editor" | "rail" {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (WORKIZ_FRAMED_SETTINGS.has(path)) return "workiz";
  return TEMPLATE_EDITOR.test(path) ? "editor" : "rail";
}

/** A DOM id for a block's heading, unique per `scope` on the page. */
export function settingsGroupId(scope: string, group: SettingsGroup): string {
  return `${scope}-${group.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}
