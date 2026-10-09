"use client";

import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Diamond,
  Mail,
  Map as MapIcon,
  MapPin,
  Phone,
  Tag,
  Users,
  Wrench,
} from "lucide-react";
import { WzFieldsPanel, type WzFieldOption } from "@/components/workiz";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { draftFromSaved, jobFieldOptions, savedFromDraft, type FieldIcon } from "../fields";
import { useJobFieldsStore } from "../fields-store";

/** Workiz's panel glyphs (`wfi-*`), drawn with their nearest lucide twins. */
const ICONS: Record<FieldIcon, ReactNode> = {
  job: <Wrench />,
  users: <Users />,
  tag: <Tag />,
  location: <MapPin />,
  calendar: <CalendarDays />,
  money: <CircleDollarSign />,
  phone: <Phone />,
  email: <Mail />,
  map: <MapIcon />,
  source: <BarChart3 />,
  custom: <Diamond />,
};

/** The Job ID row: always first and always on, as the table draws it. */
const JOB_ID: WzFieldOption[] = [{ id: "__jobId", label: "Job ID", icon: ICONS.job }];

/**
 * Workiz's "Visible fields" side panel (list_02_fields_menu) — the kit's
 * `WzFieldsPanel` over the jobs list's field registry: every static and
 * custom field with its glyph, Job ID locked first, the saved order as the
 * draft's start, and "Save fields" writing the store (visibility + order).
 */
export function FieldsMenu() {
  const visible = useJobFieldsStore((s) => s.visible);
  const order = useJobFieldsStore((s) => s.order);
  const save = useJobFieldsStore((s) => s.save);
  const { data: customFieldDefs } = useCustomFields();
  const options = jobFieldOptions(customFieldDefs);

  return (
    <WzFieldsPanel
      options={options.map((o) => ({ id: o.id, label: o.label, icon: ICONS[o.icon] }))}
      locked={JOB_ID}
      used={draftFromSaved(options, visible, order)}
      onSave={(used) => save(savedFromDraft(options, used))}
    />
  );
}
