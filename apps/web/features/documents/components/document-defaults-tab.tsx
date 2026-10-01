"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * Settings → Documents → Defaults: what every new estimate and invoice starts
 * with (Workiz: the notes, the deposit's "Set for future estimates", the Send
 * panel's "Request signature", the proposal manager's unselected options).
 */
export function DocumentDefaultsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useDocumentSettings();
  const save = useUpdateDocumentSettings();
  const [draft, setDraft] = useState<Draft>({});
  const settings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS, ...(data ?? {}) };

  if (isLoading) return <Skeleton className="h-80 w-full max-w-2xl" />;

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
    <div className="max-w-2xl space-y-5">
      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Default notes</h3>
        <p className="text-xs text-muted-foreground">Pre-filled on every new estimate and invoice; printed on the document.</p>
        <div className="space-y-1.5">
          <Label htmlFor="default-estimate-notes">Estimate notes</Label>
          <Textarea
            id="default-estimate-notes"
            rows={2}
            maxLength={5000}
            value={estimateNotes}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, estimateNotes: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="default-invoice-notes">Invoice notes</Label>
          <Textarea
            id="default-invoice-notes"
            rows={2}
            maxLength={5000}
            value={invoiceNotes}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, invoiceNotes: e.target.value }))}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Default deposit on new estimates</h3>
        <p className="text-xs text-muted-foreground">
          Collected on the client portal right after the client signs the estimate. 0 = no deposit.
        </p>
        <div className="flex gap-2">
          <div role="radiogroup" aria-label="Deposit type" className="flex rounded-md border">
            {(["amount", "percent"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                aria-label={m === "amount" ? "$" : "%"}
                disabled={!canEdit}
                className={cn("px-3 text-sm", mode === m ? "bg-muted font-semibold" : "text-muted-foreground")}
                onClick={() => setDraft((d) => ({ ...d, depositMode: m, depositValue: d.depositValue ?? storedValue }))}
              >
                {m === "amount" ? "$" : "%"}
              </button>
            ))}
          </div>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={mode === "percent" ? 100 : undefined}
            step={mode === "percent" ? 1 : 0.01}
            value={value}
            disabled={!canEdit}
            aria-label="Deposit amount"
            className="max-w-40"
            onChange={(e) => setDraft((d) => ({ ...d, depositValue: e.target.value }))}
          />
        </div>
        {!depositValid ? (
          <p className="text-xs text-destructive">
            {mode === "percent" ? "Enter a percent between 0 and 100" : "Enter an amount of 0 or more"}
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Client portal</h3>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Request a signature on invoices
            <span className="block text-xs text-muted-foreground">
              Starts checked in the Send panel; the client signs before paying. Estimates always need a signature to be approved.
            </span>
          </span>
          <Switch
            checked={requestSignature}
            disabled={!canEdit}
            aria-label="Request a signature on invoices"
            onCheckedChange={(v) => setDraft((d) => ({ ...d, requestInvoiceSignature: v }))}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Keep unselected proposal options visible
            <span className="block text-xs text-muted-foreground">
              After the client approves one option of a proposal, the other options stay on their portal.
            </span>
          </span>
          <Switch
            checked={showUnselected}
            disabled={!canEdit}
            aria-label="Keep unselected proposal options visible"
            onCheckedChange={(v) => setDraft((d) => ({ ...d, showUnselectedProposalOptions: v }))}
          />
        </label>
      </section>

      {canEdit ? (
        <div className="flex justify-end">
          <Button variant="brand" onClick={submit} disabled={!dirty || !depositValid || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
