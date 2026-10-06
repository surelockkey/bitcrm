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
  FileText,
  Building,
  FileStack,
  CreditCard,
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
        label: "Automations",
        href: "/automations",
        description: "What the system texts on its own — job status, missed calls, reminders.",
        icon: Workflow,
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
        label: "Users",
        href: "/admin/users",
        description: "Who signs in — accounts, roles and access.",
        icon: UsersRound,
        resource: "users",
      },
      {
        label: "Roles",
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
        label: "Job Sources",
        href: "/settings/job-sources",
        description: "Where your jobs come from. Jobs pick one when created.",
        icon: Megaphone,
        resource: "job_sources",
      },
      {
        label: "Job Fields",
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
        label: "Job Statuses",
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
    label: "Calls & Text",
    sections: [
      {
        label: "Messaging",
        href: "/settings/messaging",
        description: "Default sender, prefix and signature, tech texts, quiet hours, STOP/HELP replies.",
        icon: MessagesSquare,
        resource: "settings",
      },
      {
        label: "Message Templates",
        href: "/settings/message-templates",
        description: "Canned texts with short codes the composer offers.",
        icon: FileText,
        resource: "message_templates",
      },
      {
        label: "Phone Numbers",
        href: "/settings/phone-numbers",
        description: "Buy, list, and release the numbers you call and receive on.",
        icon: Phone,
        resource: "settings",
      },
      {
        label: "Call Flows",
        href: "/settings/call-flows",
        description: "What a caller hears, and who gets rung, before anybody picks up.",
        icon: Workflow,
        resource: "settings",
      },
      {
        label: "Call Groups",
        href: "/settings/call-groups",
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

/** A DOM id for a block's heading, unique per `scope` on the page. */
export function settingsGroupId(scope: string, group: SettingsGroup): string {
  return `${scope}-${group.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}
