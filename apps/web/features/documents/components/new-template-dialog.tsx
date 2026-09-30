"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { DocumentTemplateKind, DocumentTemplateSummary } from "@bitcrm/types";
import { DOCUMENT_TEMPLATE_KINDS } from "@bitcrm/types";
import type { DocumentPresetId } from "@bitcrm/document-renderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTemplate } from "../hooks";
import { KIND_LABELS } from "../lib";
import { newTemplateSchema } from "../schemas";
import { PresetPicker } from "./preset-picker";

const FROM_PRESET = "__preset__";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Remount per opening so the form starts fresh. */}
        {open ? <NewTemplateForm initialKind={initialKind} templates={templates} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NewTemplateForm({
  initialKind,
  templates,
  onDone,
}: {
  initialKind: DocumentTemplateKind;
  templates: DocumentTemplateSummary[];
  onDone: () => void;
}) {
  const router = useRouter();
  const create = useCreateTemplate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocumentTemplateKind>(initialKind);
  const [presetId, setPresetId] = useState<DocumentPresetId>("classic");
  const [source, setSource] = useState<string>(FROM_PRESET);
  const [error, setError] = useState<string | null>(null);

  const sameKind = templates.filter((t) => t.kind === kind);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
        onDone();
        router.push(`/settings/documents/${t.id}`);
      },
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New template</DialogTitle>
        <DialogDescription>Start from a layout, then drag blocks around to make it yours.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label htmlFor="new-template-name">Name</Label>
          <Input
            id="new-template-name"
            autoFocus
            value={name}
            maxLength={120}
            placeholder="e.g. Commercial invoice"
            aria-invalid={!!error}
            onChange={(e) => setName(e.target.value)}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label>Document type</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as DocumentTemplateKind);
              setSource(FROM_PRESET);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Document type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_TEMPLATE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS[k].singular}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sameKind.length ? (
        <div className="space-y-1.5">
          <Label>Start from</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full" aria-label="Start from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FROM_PRESET}>A layout preset</SelectItem>
              {sameKind.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  Copy of “{t.name}”
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {source === FROM_PRESET ? <PresetPicker kind={kind} value={presetId} onChange={setPresetId} /> : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={create.isPending} className="gap-1.5">
          {create.isPending ? <Loader2 className="animate-spin" /> : null}
          Create template
        </Button>
      </DialogFooter>
    </form>
  );
}
