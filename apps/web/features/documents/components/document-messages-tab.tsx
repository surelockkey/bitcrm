"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_MESSAGE_SHORT_CODES,
  PORTAL_LINK_SHORT_CODE,
  type DocumentSettings,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentSettings, useUpdateDocumentSettings } from "../hooks";
import type { DocumentSettingsBody } from "../api";

const KINDS = [
  { key: "invoice", label: "Invoice", subject: "invoiceEmailSubject", message: "invoiceMessage" },
  { key: "estimate", label: "Estimate", subject: "estimateEmailSubject", message: "estimateMessage" },
  { key: "proposal", label: "Sales proposal", subject: "proposalEmailSubject", message: "proposalMessage" },
] as const;

type MessageKey = (typeof KINDS)[number]["subject"] | (typeof KINDS)[number]["message"];

/**
 * Settings → Documents → Messages (Workiz "Email options" / the proposal's
 * "Edit template"): the subject and message the Send panel starts from, per
 * document, with short codes. Every message must keep the portal link.
 */
export function DocumentMessagesTab({ canEdit, permsLoading = false }: { canEdit: boolean; permsLoading?: boolean }) {
  const { data, isLoading } = useDocumentSettings();
  const save = useUpdateDocumentSettings();
  const [draft, setDraft] = useState<Partial<Record<MessageKey, string>>>({});
  const settings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS, ...(data ?? {}) };

  // Until the permissions are in too: the form came up read-only and grew
  // its Save button a beat later.
  if (isLoading || permsLoading) return <Skeleton className="h-96 w-full max-w-2xl" />;

  const valueOf = (k: MessageKey) => draft[k] ?? settings[k];
  const missingLink = KINDS.filter((k) => !valueOf(k.message).includes(PORTAL_LINK_SHORT_CODE)).map((k) => k.label);
  const empty = KINDS.some((k) => !valueOf(k.subject).trim() || !valueOf(k.message).trim());
  const dirty = Object.keys(draft).length > 0;

  const submit = () => {
    const body: DocumentSettingsBody = {};
    for (const [k, v] of Object.entries(draft) as Array<[MessageKey, string]>) {
      if (v !== settings[k]) body[k] = v;
    }
    save.mutate(body, { onSuccess: () => setDraft({}) });
  };

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-muted-foreground">
        What the Send panel starts from. Short codes:{" "}
        {DOCUMENT_MESSAGE_SHORT_CODES.map((c) => (
          <code key={c} className="mr-1 rounded bg-muted px-1 py-0.5 text-xs">{`{{${c}}}`}</code>
        ))}
      </p>
      {KINDS.map((k) => (
        <section key={k.key} className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{k.label}</h3>
          <div className="space-y-1.5">
            <Label htmlFor={`${k.key}-subject`}>{k.label} subject</Label>
            <Input
              id={`${k.key}-subject`}
              value={valueOf(k.subject)}
              maxLength={250}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, [k.subject]: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${k.key}-message`}>{k.label} message</Label>
            <Textarea
              id={`${k.key}-message`}
              rows={4}
              maxLength={5000}
              value={valueOf(k.message)}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, [k.message]: e.target.value }))}
            />
            {!valueOf(k.message).includes(PORTAL_LINK_SHORT_CODE) ? (
              <p className="text-xs text-destructive">
                The message must keep {PORTAL_LINK_SHORT_CODE} — the client has nothing to open without it.
              </p>
            ) : null}
          </div>
        </section>
      ))}
      {canEdit ? (
        <div className="flex justify-end">
          <Button variant="brand" onClick={submit} disabled={!dirty || missingLink.length > 0 || empty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
