"use client";

import type { ReactNode } from "react";
import { FileSpreadsheet, FileText, Globe, Mail, MapPin, Phone } from "lucide-react";
import type { PortalDocumentSummary, PortalView as PortalViewData } from "@bitcrm/types";
import { businessAddressLine, portalGreeting, telHref } from "../lib";
import { PortalDocumentCard } from "./portal-document-card";

function websiteHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

/** The client-facing portal body — shared by the public page and the staff preview. */
export function PortalView({
  view,
  onOpen,
}: {
  view: PortalViewData;
  onOpen: (doc: PortalDocumentSummary) => void;
}) {
  const { business } = view;
  const address = businessAddressLine(business.address);
  const initials = business.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:p-6">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API, not a static asset
          <img
            src={business.logoUrl}
            alt={business.name}
            className="h-14 w-auto max-w-40 flex-none object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-14 flex-none items-center justify-center rounded-xl bg-brand text-lg font-semibold text-brand-foreground"
          >
            {initials}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{business.name}</h1>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
            {business.phone ? (
              <li>
                <a href={telHref(business.phone)} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-3.5" aria-hidden /> {business.phone}
                </a>
              </li>
            ) : null}
            {business.email ? (
              <li>
                <a href={`mailto:${business.email}`} className="inline-flex items-center gap-1.5 break-all hover:text-foreground">
                  <Mail className="size-3.5" aria-hidden />
                  {business.email}
                </a>
              </li>
            ) : null}
            {business.website ? (
              <li>
                <a
                  href={websiteHref(business.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  <Globe className="size-3.5" aria-hidden /> {business.website.replace(/^https?:\/\//i, "")}
                </a>
              </li>
            ) : null}
            {address ? (
              <li className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden /> {address}
              </li>
            ) : null}
          </ul>
        </div>
      </header>

      <p className="text-lg font-medium">{portalGreeting(view)}</p>

      <DocSection
        title="Estimates"
        icon={<FileSpreadsheet className="size-4" />}
        docs={view.estimates}
        empty="No estimates to show right now."
        preview={view.preview}
        onOpen={onOpen}
      />
      <DocSection
        title="Invoices"
        icon={<FileText className="size-4" />}
        docs={view.invoices}
        empty="No invoices to show right now."
        preview={view.preview}
        onOpen={onOpen}
      />
    </div>
  );
}

function DocSection({
  title,
  icon,
  docs,
  empty,
  preview,
  onOpen,
}: {
  title: string;
  icon: ReactNode;
  docs: PortalDocumentSummary[];
  empty: string;
  preview: boolean;
  onOpen: (doc: PortalDocumentSummary) => void;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {icon} {title}
        {docs.length ? <span className="font-normal">· {docs.length}</span> : null}
      </h2>
      {docs.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={`${d.kind}-${d.id}`}>
              <PortalDocumentCard doc={d} preview={preview} onOpen={() => onOpen(d)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
