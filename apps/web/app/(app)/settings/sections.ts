import type { LucideIcon } from "lucide-react";
import { MapPin, SlidersHorizontal } from "lucide-react";
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
    description: "Territories that auto-assign deals and match technicians.",
    icon: MapPin,
    resource: "service_areas",
  },
];
