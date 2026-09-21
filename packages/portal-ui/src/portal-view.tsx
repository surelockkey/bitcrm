"use client";

import type { ReactNode } from "react";
import {
  Building2,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Globe,
  Link2Off,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
} from "lucide-react";
import type { PortalDocumentSummary, PortalView as PortalViewData } from "@bitcrm/types";
import { primaryButton, outlineButton } from "./document-viewer";
import {
  businessAddressLine,
  businessInitials,
  cx,
  documentKindLabel,
  documentTitle,
  firstNameOf,
  formatMoney,
  formatYmd,
  isOwing,
  outstanding,
  telHref,
  websiteHref,
} from "./lib";
import { StatusBadge } from "./status-badge";

const chip =
  "inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-medium sm:px-3.5 sm:text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** The client-facing portal body — shared by the public page and the staff preview. */
export function PortalView({ view, onOpen }: { view: PortalViewData; onOpen: (doc: PortalDocumentSummary) => void }) {
  const owing = outstanding(view.invoices);
  const nothing = view.invoices.length === 0 && view.estimates.length === 0;
  const name = firstNameOf(view.client);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <BusinessHeader business={view.business} />

      <section className="space-y-1 px-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{name ? `Hi ${name},` : "Hello,"}</h1>
        <p className="text-muted-foreground">Here are your documents from {view.business.name}.</p>
      </section>

      {owing.count > 0 ? <BalanceCard {...owing} invoices={view.invoices} onOpen={onOpen} /> : null}

      {nothing ? (
        <p className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Nothing to show yet. Your estimates and invoices will appear here as soon as {view.business.name} sends them.
        </p>
      ) : null}

      {view.invoices.length > 0 ? (
        <DocSection title="Invoices" icon={<FileText className="size-4" aria-hidden />} docs={view.invoices} preview={view.preview} onOpen={onOpen} />
      ) : null}
      {view.estimates.length > 0 ? (
        <DocSection title="Estimates" icon={<FileSpreadsheet className="size-4" aria-hidden />} docs={view.estimates} preview={view.preview} onOpen={onOpen} />
      ) : null}
    </div>
  );
}

function BusinessHeader({ business }: { business: PortalViewData["business"] }) {
  const address = businessAddressLine(business.address);
  return (
    <header className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div aria-hidden className="h-1.5 bg-brand" />
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3.5">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API, not a static asset
            <img src={business.logoUrl} alt="" className="h-12 w-auto max-w-36 flex-none object-contain sm:h-14" />
          ) : (
            <span
              aria-hidden
              className="flex size-12 flex-none items-center justify-center rounded-xl bg-brand text-base font-semibold text-brand-foreground sm:size-14 sm:text-lg"
            >
              {businessInitials(business.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-lg leading-tight font-semibold tracking-tight sm:text-xl">{business.name}</p>
            {address ? (
              <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 flex-none" aria-hidden />
                <span>{address}</span>
              </p>
            ) : null}
          </div>
        </div>
        {business.phone || business.email || business.website ? (
          <ul className="flex flex-wrap gap-2">
            {business.phone ? (
              <li>
                <a href={telHref(business.phone)} className={chip}>
                  <Phone className="size-4" aria-hidden /> {business.phone}
                </a>
              </li>
            ) : null}
            {business.email ? (
              <li>
                <a href={`mailto:${business.email}`} className={chip}>
                  <Mail className="size-4" aria-hidden /> {business.email}
                </a>
              </li>
            ) : null}
            {business.website ? (
              <li>
                <a href={websiteHref(business.website)} target="_blank" rel="noopener noreferrer" className={chip}>
                  <Globe className="size-4" aria-hidden /> {business.website.replace(/^https?:\/\//i, "")}
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </header>
  );
}

function BalanceCard({
  total,
  count,
  overdue,
  invoices,
  onOpen,
}: {
  total: number;
  count: number;
  overdue: boolean;
  invoices: PortalDocumentSummary[];
  onOpen: (doc: PortalDocumentSummary) => void;
}) {
  const only = count === 1 ? invoices.find(isOwing) : undefined;
  return (
    <section
      aria-label="Balance due"
      className={cx(
        "flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6",
        overdue ? "border-red-500/30 bg-red-500/5" : "border-brand/25 bg-brand/5",
      )}
    >
      <div>
        <p className="text-sm font-medium text-muted-foreground">{overdue ? "Balance overdue" : "Balance due"}</p>
        <p className="font-mono text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(total)}</p>
        <p className="text-sm text-muted-foreground">
          {count === 1 ? "on 1 invoice" : `across ${count} invoices`}
        </p>
      </div>
      {only ? (
        <button type="button" onClick={() => onOpen(only)} className={primaryButton}>
          View invoice #{only.number}
        </button>
      ) : null}
    </section>
  );
}

function DocSection({
  title,
  icon,
  docs,
  preview,
  onOpen,
}: {
  title: string;
  icon: ReactNode;
  docs: PortalDocumentSummary[];
  preview: boolean;
  onOpen: (doc: PortalDocumentSummary) => void;
}) {
  return (
    <section aria-label={title} className="space-y-2.5">
      <h2 className="flex items-center gap-2 px-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {icon} {title}
        <span className="font-normal">· {docs.length}</span>
      </h2>
      <ul className="space-y-2.5">
        {docs.map((d) => (
          <li key={`${d.kind}-${d.id}`}>
            <DocumentCard doc={d} preview={preview} onOpen={() => onOpen(d)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DocumentCard({ doc, preview, onOpen }: { doc: PortalDocumentSummary; preview: boolean; onOpen: () => void }) {
  const isInvoice = doc.kind === "invoice";
  const Icon = isInvoice ? FileText : FileSpreadsheet;
  const owing = isOwing(doc);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${documentTitle(doc)}${doc.name ? ` ${doc.name}` : ""}`}
      className="group flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-xs transition-colors hover:border-brand/40 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:p-4"
    >
      <span
        aria-hidden
        className={cx(
          "flex size-11 flex-none items-center justify-center rounded-xl",
          isInvoice ? "bg-brand/10 text-brand" : "bg-sky-500/10 text-sky-700 dark:text-sky-300",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{documentTitle(doc)}</span>
          <StatusBadge doc={doc} />
          {preview && !doc.sent ? (
            <span className="rounded border border-dashed border-amber-500/60 px-1.5 text-[10px] font-semibold tracking-wide text-amber-700 dark:text-amber-400">
              UNSENT
            </span>
          ) : null}
        </span>
        {doc.name ? <span className="block truncate text-sm">{doc.name}</span> : null}
        {doc.companyName ? (
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Building2 className="size-3 flex-none" aria-hidden />
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
      <ChevronRight
        className="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
      <span className="sr-only">Open this {documentKindLabel(doc.kind).toLowerCase()}</span>
    </button>
  );
}

/* --------------------------------------------------------------- page states */

export function PortalSkeleton() {
  const bar = "animate-pulse rounded-lg bg-muted";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" aria-busy role="status" aria-label="Loading your documents">
      <div className={cx(bar, "h-36 rounded-2xl")} />
      <div className={cx(bar, "h-8 w-1/2")} />
      <div className="space-y-2.5">
        <div className={cx(bar, "h-24 rounded-2xl")} />
        <div className={cx(bar, "h-24 rounded-2xl")} />
      </div>
    </div>
  );
}

export function InvalidPortalLink({ businessName }: { businessName?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-xs">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Link2Off className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold">This link is no longer valid</h1>
      <p className="text-sm text-muted-foreground">
        {businessName
          ? `Please contact ${businessName} for a new link to your documents.`
          : "Please contact the business that sent it to you for a new link to your documents."}
      </p>
    </div>
  );
}

export function PortalLoadError({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-xs">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">We couldn&apos;t load your documents. Please try again.</p>
      <button type="button" onClick={onRetry} disabled={retrying} className={outlineButton}>
        <RefreshCw className={cx("size-4", retrying && "animate-spin")} aria-hidden /> Try again
      </button>
    </div>
  );
}
