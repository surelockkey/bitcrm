"use client";

import { useState } from "react";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzActionBar } from "@/components/workiz/layout";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzAccountTitle, WzAccountToggle, WzDocSettingsField } from "@/components/workiz/settings-form";
import { cn } from "@/lib/utils";
import { useDocumentSettings, useUpdateDocumentSettings } from "../hooks";
import type { DocumentSettingsBody } from "../api";

interface Draft {
  estimateNotes?: string;
  invoiceNotes?: string;
  depositMode?: "amount" | "percent";
  depositValue?: string;
  requestInvoiceSignature?: boolean;
  showUnselectedProposalOptions?: boolean;
}

/** The 12px #768287 line under an Account page title. */
function Lead({ children }: { children: React.ReactNode }) {
  return <p className="-mt-4 text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">{children}</p>;
}

/**
 * Settings → Documents → Defaults: what every new estimate and invoice starts
 * with (Workiz: the notes, the deposit's "Set for future estimates", the Send
 * panel's "Request signature", the proposal manager's unselected options),
 * laid out as Workiz's Account page: a 652px column under 20px titles, the
 * Document settings boxes for the notes, Account Preferences toggle rows, the
 * Save in the white bar at the bottom.
 */
export function DocumentDefaultsTab({ canEdit, permsLoading = false }: { canEdit: boolean; permsLoading?: boolean }) {
  const { data, isLoading } = useDocumentSettings();
  const save = useUpdateDocumentSettings();
  const [draft, setDraft] = useState<Draft>({});
  const settings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS, ...(data ?? {}) };

  // Until the permissions are in too: the form came up read-only and grew
  // its Save button a beat later.
  if (isLoading || permsLoading) {
    return (
      <div className="px-5 pt-10">
        <Skeleton className="h-80 w-[652px] max-w-full" />
      </div>
    );
  }

  const storedMode: "amount" | "percent" = settings.depositAmount ? "amount" : "percent";
  const storedValue = settings.depositAmount ? String(settings.depositAmount) : String(settings.depositPercentage ?? 0);
  const mode = draft.depositMode ?? storedMode;
  const value = draft.depositValue ?? storedValue;
  const n = Number(value);
  const depositValid = value.trim() !== "" && Number.isFinite(n) && n >= 0 && (mode === "amount" || n <= 100);
  const estimateNotes = draft.estimateNotes ?? settings.estimateNotes;
  const invoiceNotes = draft.invoiceNotes ?? settings.invoiceNotes;
  const requestSignature = draft.requestInvoiceSignature ?? settings.requestInvoiceSignature;
  const showUnselected = draft.showUnselectedProposalOptions ?? settings.showUnselectedProposalOptions;
  const dirty = Object.keys(draft).length > 0;

  const submit = () => {
    const body: DocumentSettingsBody = {};
    if (draft.estimateNotes !== undefined && draft.estimateNotes !== settings.estimateNotes) body.estimateNotes = draft.estimateNotes;
    if (draft.invoiceNotes !== undefined && draft.invoiceNotes !== settings.invoiceNotes) body.invoiceNotes = draft.invoiceNotes;
    if (draft.depositMode !== undefined || draft.depositValue !== undefined) {
      if (!depositValid) return;
      if (n <= 0) {
        body.depositPercentage = null;
        body.depositAmount = null;
      } else if (mode === "percent") {
        body.depositPercentage = n;
        body.depositAmount = null;
      } else {
        body.depositAmount = n;
        body.depositPercentage = null;
      }
    }
    if (draft.requestInvoiceSignature !== undefined) body.requestInvoiceSignature = draft.requestInvoiceSignature;
    if (draft.showUnselectedProposalOptions !== undefined) body.showUnselectedProposalOptions = draft.showUnselectedProposalOptions;
    save.mutate(body, { onSuccess: () => setDraft({}) });
  };

  return (
    <>
      <div className="flex w-[652px] max-w-full flex-col gap-6 px-5 pt-10 pb-10">
        <WzAccountTitle>Default Notes</WzAccountTitle>
        <Lead>Pre-filled on every new estimate and invoice; printed on the document.</Lead>
        <WzDocSettingsField
          label="Estimate Notes"
          rows={3}
          maxLength={5000}
          value={estimateNotes}
          disabled={!canEdit}
          className="[&_textarea]:min-h-[80px]"
          onChange={(e) => setDraft((d) => ({ ...d, estimateNotes: e.target.value }))}
        />
        <WzDocSettingsField
          label="Invoice Notes"
          rows={3}
          maxLength={5000}
          value={invoiceNotes}
          disabled={!canEdit}
          className="[&_textarea]:min-h-[80px]"
          onChange={(e) => setDraft((d) => ({ ...d, invoiceNotes: e.target.value }))}
        />

        <WzAccountTitle className="mt-4">Default Deposit on New Estimates</WzAccountTitle>
        <Lead>Collected on the client portal right after the client signs the estimate. 0 = no deposit.</Lead>
        <div className="flex items-start gap-4">
          {/* Workiz's segmented box (the Files panel's All | Media), as radios. */}
          <div role="radiogroup" aria-label="Deposit type" className="flex h-10 shrink-0 rounded-[4px] bg-wz-secondary-hover p-0.5">
            {(["amount", "percent"] as const).map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={m === "amount" ? "$" : "%"}
                  disabled={!canEdit}
                  className={cn(
                    "h-9 min-w-[52px] cursor-pointer rounded-[2px] px-4 leading-[19px] outline-none focus-visible:underline disabled:cursor-not-allowed",
                    on ? "bg-white text-sm font-semibold text-wz-link shadow-[0_2px_4px_rgba(59,75,82,0.1)]" : "text-[13px] text-foreground",
                  )}
                  onClick={() => setDraft((d) => ({ ...d, depositMode: m, depositValue: d.depositValue ?? storedValue }))}
                >
                  {m === "amount" ? "$" : "%"}
                </button>
              );
            })}
          </div>
          <WzOutlinedTextField
            label="Deposit amount"
            className="w-[200px]"
            type="number"
            inputMode="decimal"
            min={0}
            max={mode === "percent" ? 100 : undefined}
            step={mode === "percent" ? 1 : 0.01}
            value={value}
            disabled={!canEdit}
            error={depositValid ? undefined : mode === "percent" ? "Enter a percent between 0 and 100" : "Enter an amount of 0 or more"}
            onChange={(e) => setDraft((d) => ({ ...d, depositValue: e.target.value }))}
          />
        </div>

        <WzAccountTitle className="mt-4">Client Portal</WzAccountTitle>
        <div className="flex flex-col gap-[38px]">
          <WzAccountToggle
            label="Request a signature on invoices"
            hint="Starts checked in the Send panel; the client signs before paying. Estimates always need a signature to be approved."
            checked={requestSignature}
            disabled={!canEdit}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, requestInvoiceSignature: v }))}
          />
          <WzAccountToggle
            label="Keep unselected proposal options visible"
            hint="After the client approves one option of a proposal, the other options stay on their portal."
            checked={showUnselected}
            disabled={!canEdit}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, showUnselectedProposalOptions: v }))}
          />
        </div>
      </div>

      {canEdit ? (
        <WzActionBar className="sticky bottom-0 mt-auto">
          <WzButton
            size="big"
            loading={save.isPending}
            disabled={!dirty || !depositValid}
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
