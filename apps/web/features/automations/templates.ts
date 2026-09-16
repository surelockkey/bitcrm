import type { AutomationSpec } from "@bitcrm/types";

/**
 * The recipe library (Workiz "Automation Center" → Library tab). Declared
 * here so the page compiles against the shape; the recipes themselves are
 * filled in by the library stream.
 */
export const AUTOMATION_TEMPLATE_SECTIONS = [
  "Job status",
  "Phone",
  "Reminders",
  "Marketing",
] as const;

export type AutomationTemplateSection = (typeof AUTOMATION_TEMPLATE_SECTIONS)[number];

export interface AutomationTemplate {
  /** Stable kebab id, e.g. "job-canceled-notify-techs". */
  id: string;
  section: AutomationTemplateSection;
  /** "Job canceled / Notify techs" — Workiz's `<what> / <when>` convention. */
  title: string;
  /** The Workiz-style sentence, with `<slot>` markers around the editable parts. */
  sentence: string;
  /** One line: when to use it. */
  blurb: string;
  draft: { name: string; spec: AutomationSpec; category?: string };
  popular?: boolean;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [];
