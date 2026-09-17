"use client";

import { Building, ChevronRight, FileSpreadsheet, FileText } from "lucide-react";
import type { EstimateStatus, InvoiceStatus, PortalDocumentSummary } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { EstimateStatusBadge } from "@/features/estimates/components/estimate-status-badge";
import { InvoiceStatusBadge } from "@/features/invoices/components/invoice-status-badge";
import { documentKindLabel } from "../lib";

export function PortalDocumentCard({
  doc,
  preview,
  onOpen,
}: {
  doc: PortalDocumentSummary;
  preview: boolean;
  onOpen: () => void;
}) {
  const isInvoice = doc.kind === "invoice";
  const Icon = isInvoice ? FileText : FileSpreadsheet;
  const owing = isInvoice && typeof doc.balanceDue === "number" && doc.balanceDue > 0 && doc.status !== "paid";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${documentKindLabel(doc.kind)} #${doc.number}${doc.name ? ` ${doc.name}` : ""}`}
      className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs transition-colors hover:border-brand/40 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:p-4"
    >
      <span
        className={cn(
          "flex size-10 flex-none items-center justify-center rounded-lg",
          isInvoice ? "bg-brand/10 text-brand" : "bg-sky-500/10 text-sky-700 dark:text-sky-300",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">
            {documentKindLabel(doc.kind)} #{doc.number}
          </span>
          {isInvoice ? (
            <InvoiceStatusBadge status={doc.status as InvoiceStatus} />
          ) : (
            <EstimateStatusBadge status={doc.status as EstimateStatus} />
          )}
          {preview && !doc.sent ? (
            <span className="rounded border border-dashed border-amber-500/60 px-1.5 text-[10px] font-semibold tracking-wide text-amber-700 dark:text-amber-400">
              UNSENT
            </span>
          ) : null}
        </span>
        {doc.name ? <span className="block truncate text-sm">{doc.name}</span> : null}
        {doc.companyName ? (
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Building className="size-3 flex-none" aria-hidden />
            <span className="truncate">{doc.companyName}</span>
          </span>
        ) : null}
        <span className="block text-xs text-muted-foreground">
          {formatYmd(doc.date)}
          {isInvoice && doc.dueDate && doc.status !== "paid" ? ` · Due ${formatYmd(doc.dueDate)}` : ""}
        </span>
      </span>
      <span className="flex-none text-right">
        <span className="block font-mono text-base font-semibold tabular-nums">{formatMoney(doc.total)}</span>
        {owing ? (
          <span className="block text-xs font-medium text-amber-700 tabular-nums dark:text-amber-400">
            {formatMoney(doc.balanceDue ?? 0)} due
          </span>
        ) : null}
      </span>
      <ChevronRight className="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
