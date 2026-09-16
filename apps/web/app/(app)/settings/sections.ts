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
  Workflow,
  MessagesSquare,
  FileText,
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

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    label: "General",
    href: "/settings/general",
    description: "Workspace-wide preferences.",
    icon: SlidersHorizontal,
  },
  {
    label: "Service Areas",
    href: "/settings/service-areas",
    description: "Territories that auto-assign jobs and match technicians.",
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
    label: "Job Sources",
    href: "/settings/job-sources",
    description: "Where your jobs come from. Jobs pick one when created.",
    icon: Megaphone,
    resource: "job_sources",
  },
  {
    label: "External Companies",
    href: "/settings/external-companies",
    description: "Partners that send you work. Jobs can record which one referred them.",
    icon: Building2,
    resource: "external_companies",
  },
  {
    label: "Job Tags",
    href: "/settings/job-tags",
    description: "Colored labels for deals. A deal can carry many.",
    icon: Tags,
    resource: "job_tags",
  },
  {
    label: "Job Fields",
    href: "/settings/job-fields",
    description: "Which fields are required when creating a job — default and custom.",
    icon: Asterisk,
    resource: "settings",
  },
  {
    label: "Job Statuses",
    href: "/settings/job-statuses",
    description: "Custom colored statuses under each super-status. A job carries one.",
    icon: ListChecks,
    resource: "job_statuses",
  },
  {
    label: "Custom Fields",
    href: "/settings/custom-fields",
    description: "User-defined fields on deals, grouped and scoped to job types.",
    icon: ListPlus,
    resource: "custom_fields",
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
  {
    label: "Phone Numbers",
    href: "/settings/phone-numbers",
    description: "Buy, list, and release the numbers you call and receive on.",
    icon: Phone,
    resource: "settings",
  },
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
    // The module moved out to /automations; the settings index keeps the
    // shortcut so anyone who looks for it here still lands on it.
    label: "Automations",
    href: "/automations",
    description: "What the system texts on its own — job status, missed calls, reminders.",
    icon: Workflow,
    resource: "settings",
  },
];
