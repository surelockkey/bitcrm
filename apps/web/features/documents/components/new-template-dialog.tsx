"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentTemplateKind, DocumentTemplateSummary } from "@bitcrm/types";
import { DOCUMENT_TEMPLATE_KINDS } from "@bitcrm/types";
import type { DocumentPresetId } from "@bitcrm/document-renderer";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzModalTextField } from "@/components/workiz/modal-text-field";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { useCreateTemplate } from "../hooks";
import { KIND_LABELS } from "../lib";
import { newTemplateSchema } from "../schemas";
import { PresetPicker } from "./preset-picker";

const FROM_PRESET = "__preset__";

/**
 * "Add New Template" in Workiz's settings modal (WzFormModal: 16px corners,
 * the outlined boxes, Cancel / Save) — widened for the three layout pictures.
 */
export function NewTemplateDialog({
  open,
  onOpenChange,
  initialKind = "invoice",
  templates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind?: DocumentTemplateKind;
  templates: DocumentTemplateSummary[];
}) {
  // Mounted per opening so the form starts fresh.
  return open ? <NewTemplateForm initialKind={initialKind} templates={templates} onOpenChange={onOpenChange} /> : null;
}

function NewTemplateForm({
  initialKind,
  templates,
  onOpenChange,
}: {
  initialKind: DocumentTemplateKind;
  templates: DocumentTemplateSummary[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateTemplate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocumentTemplateKind>(initialKind);
  const [presetId, setPresetId] = useState<DocumentPresetId>("classic");
  const [source, setSource] = useState<string>(FROM_PRESET);
  const [error, setError] = useState<string | null>(null);

  const sameKind = templates.filter((t) => t.kind === kind);

  const submit = () => {
    const parsed = newTemplateSchema.safeParse(
      source === FROM_PRESET ? { name, kind, presetId } : { name, kind, fromTemplateId: source },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setError(null);
    create.mutate(parsed.data, {
      onSuccess: (t) => {
        onOpenChange(false);
        router.push(`/settings/documents/${t.id}`);
      },
    });
  };

  return (
    <WzFormModal
      open
      onOpenChange={onOpenChange}
      title="Add New Template"
      description="Start from a layout, then drag blocks around to make it yours."
      onSave={submit}
      saving={create.isPending}
      className="w-[576px] sm:max-w-[576px]"
    >
      <WzModalTextField
        label="Name"
        value={name}
        maxLength={120}
        error={error ?? undefined}
        onChange={(v) => {
          setName(v);
          setError(null);
        }}
      />
      <WzOutlinedSelect
        label="Document type"
        options={DOCUMENT_TEMPLATE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k].singular }))}
        value={kind}
        onChange={(v) => {
          if (!v) return;
          setKind(v as DocumentTemplateKind);
          setSource(FROM_PRESET);
        }}
      />
      {sameKind.length ? (
        <WzOutlinedSelect
          label="Start from"
          options={[
            { value: FROM_PRESET, label: "A layout preset" },
            ...sameKind.map((t) => ({ value: t.id, label: `Copy of “${t.name}”` })),
          ]}
          value={source}
          onChange={(v) => v && setSource(v)}
        />
      ) : null}
      {source === FROM_PRESET ? <PresetPicker kind={kind} value={presetId} onChange={setPresetId} /> : null}
    </WzFormModal>
  );
}
