"use client";

import { useState } from "react";
import {
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_MESSAGE_SHORT_CODES,
  PORTAL_LINK_SHORT_CODE,
  type DocumentSettings,
} from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzActionBar } from "@/components/workiz/layout";
import { WzAccountTitle, WzDocSettingsField } from "@/components/workiz/settings-form";
import { useDocumentSettings, useUpdateDocumentSettings } from "../hooks";
import type { DocumentSettingsBody } from "../api";

const KINDS = [
  { key: "invoice", label: "Invoice", subject: "invoiceEmailSubject", message: "invoiceMessage" },
  { key: "estimate", label: "Estimate", subject: "estimateEmailSubject", message: "estimateMessage" },
  { key: "proposal", label: "Sales proposal", subject: "proposalEmailSubject", message: "proposalMessage" },
] as const;

type MessageKey = (typeof KINDS)[number]["subject"] | (typeof KINDS)[number]["message"];

/**
 * Settings → Documents → Messages: the subject and message the Send panel
 * starts from, per document, with short codes — Workiz keeps them in each
 * template's "Document settings" (Subject / Message over grey boxes,
 * pg_settings_general_wz_doc_settings_open), drawn here the same way, one
 * block per document. Every message must keep the portal link.
 */
export function DocumentMessagesTab({ canEdit, permsLoading = false }: { canEdit: boolean; permsLoading?: boolean }) {
  const { data, isLoading } = useDocumentSettings();
  const save = useUpdateDocumentSettings();
  const [draft, setDraft] = useState<Partial<Record<MessageKey, string>>>({});
  const settings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS, ...(data ?? {}) };

  // Until the permissions are in too: the form came up read-only and grew
  // its Save button a beat later.
  if (isLoading || permsLoading) {
    return (
      <div className="px-5 pt-10">
        <Skeleton className="h-96 w-[652px] max-w-full" />
      </div>
    );
  }

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
    <>
      <div className="flex w-[652px] max-w-full flex-col gap-6 px-5 pt-10 pb-10">
        <p className="text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">
          What the Send panel starts from. Short codes:{" "}
          {DOCUMENT_MESSAGE_SHORT_CODES.map((c) => (
            <code key={c} className="mr-1 rounded-[2px] bg-muted px-1 py-0.5 text-[11px] text-wz-text">{`{{${c}}}`}</code>
          ))}
        </p>
        {KINDS.map((k, i) => (
          <section key={k.key} aria-label={k.label} className="flex flex-col gap-6">
            <WzAccountTitle className={i > 0 ? "mt-4" : undefined}>{k.label}</WzAccountTitle>
            <WzDocSettingsField
              label={
                <>
                  <span className="sr-only">{k.label} </span>Subject
                </>
              }
              multiline={false}
              helper="When you send via Email this will be the subject"
              value={valueOf(k.subject)}
              maxLength={250}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, [k.subject]: e.target.value }))}
            />
            <WzDocSettingsField
              label={
                <>
                  <span className="sr-only">{k.label} </span>Message
                </>
              }
              helper="When you send via Email or SMS this will be the Message"
              error={
                valueOf(k.message).includes(PORTAL_LINK_SHORT_CODE)
                  ? undefined
                  : `The message must keep ${PORTAL_LINK_SHORT_CODE} — the client has nothing to open without it.`
              }
              rows={5}
              maxLength={5000}
              value={valueOf(k.message)}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, [k.message]: e.target.value }))}
            />
          </section>
        ))}
      </div>
      {canEdit ? (
        <WzActionBar className="sticky bottom-0 mt-auto">
          <WzButton
            size="big"
            loading={save.isPending}
            disabled={!dirty || missingLink.length > 0 || empty}
            onClick={submit}
            // Workiz's held Save: #eff1f1 with #9ea6aa words.
            className="min-w-[81px] disabled:bg-wz-disabled-fill disabled:hover:bg-wz-disabled-fill [&:disabled>span]:text-wz-outline"
          >
            Save
          </WzButton>
        </WzActionBar>
      ) : null}
    </>
  );
}
