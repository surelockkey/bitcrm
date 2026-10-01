"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Link2Off,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Wrench,
} from "lucide-react";
import type {
  PortalDocumentSummary,
  PortalJob,
  PortalPaymentLine,
  PortalProposalSummary,
  PortalView as PortalViewData,
} from "@bitcrm/types";
import { DocumentFrame } from "./document-frame";
import { primaryButton, outlineButton, type DocumentLoaders } from "./document-viewer";
import {
  businessInitials,
  calendarDataUrl,
  clientInitials,
  cx,
  depositOwed,
  documentTitle,
  firstNameOf,
  formatJobWhen,
  formatMoney,
  formatSentAt,
  formatYmd,
  inboxChip,
  isOpenEstimate,
  isOwing,
  proposalChip,
  telHref,
  websiteHref,
} from "./lib";
import { goTo } from "./navigate";
import { useLoad } from "./use-load";

const chip = "inline-flex items-center rounded-chip border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap";

/** What the host lets the client DO (the staff preview passes nothing — it reads, it never decides). */
export interface PortalActions {
  /** Approve an open estimate: sign it, then pay its deposit when it asks for one. */
  onApprove?: (doc: PortalDocumentSummary) => void;
  onDecline?: (doc: PortalDocumentSummary) => void;
  /** Pay an invoice's balance (signing first when the invoice asks for a signature). */
  onPay?: (doc: PortalDocumentSummary) => void;
  /** Pay what is still owed of an approved estimate's deposit. */
  onPayDeposit?: (doc: PortalDocumentSummary) => void;
}

export type PortalSelection =
  | { kind: "invoice" | "estimate"; id: string; fromProposal?: string }
  | { kind: "proposal"; id: string }
  | null;

/**
 * The client portal as Workiz lays it out: the company header, "Hey Jane,
 * it's great to see you", the Inbox / My Booking tabs, the inbox list on the
 * left with the chosen document on the right, and the profile (contact
 * details + payment history) behind the avatar. Shared by the public page
 * and the staff preview.
 */
export function PortalView({
  view,
  loaders,
  actions = {},
  scope = "portal",
  initialSelection = null,
}: {
  view: PortalViewData;
  loaders: DocumentLoaders;
  actions?: PortalActions;
  /** Tells one host's documents from another's (token, or preview contact). */
  scope?: string;
  initialSelection?: PortalSelection;
}) {
  const [tab, setTab] = useState<"inbox" | "booking">("inbox");
  const [profile, setProfile] = useState(false);
  const [selected, setSelected] = useState<PortalSelection>(initialSelection);
  const name = firstNameOf(view.client);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PortalHeader business={view.business} />

      <div className="flex items-center justify-between gap-3 px-1">
        <h1 className="text-lg sm:text-xl">
          {name ? (
            <>
              Hey <span className="font-semibold">{name}</span>, it&apos;s great to see you.
            </>
          ) : (
            "Welcome, it's great to see you."
          )}
        </h1>
        <button
          type="button"
          onClick={() => setProfile((p) => !p)}
          aria-label="Your profile"
          aria-pressed={profile}
          className="flex size-10 flex-none items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand hover:bg-brand/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {clientInitials(view.client)}
        </button>
      </div>

      {profile ? (
        <ProfilePanel view={view} onBack={() => setProfile(false)} />
      ) : (
        <>
          <div role="tablist" aria-label="Portal sections" className="flex border-b px-1">
            {(["inbox", "booking"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx(
                  "-mb-px border-b-2 px-5 py-2.5 text-sm transition-colors",
                  tab === t ? "border-emerald-500 font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "inbox" ? "Inbox" : "My Booking"}
              </button>
            ))}
          </div>
          {tab === "inbox" ? (
            <Inbox view={view} loaders={loaders} actions={actions} scope={scope} selected={selected} onSelect={setSelected} />
          ) : (
            <Booking jobs={view.jobs} businessName={view.business.name} />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function PortalHeader({ business }: { business: PortalViewData["business"] }) {
  return (
    <header className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-xs sm:px-6">
      {business.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API, not a static asset
        <img src={business.logoUrl} alt="" className="h-10 w-auto max-w-32 flex-none object-contain sm:h-12" />
      ) : (
        <span aria-hidden className="flex size-10 flex-none items-center justify-center rounded-xl bg-brand text-sm font-semibold text-brand-foreground">
          {businessInitials(business.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base leading-tight font-semibold sm:text-lg">{business.name}</p>
        {business.description ? <p className="truncate text-xs text-muted-foreground sm:text-sm">{business.description}</p> : null}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        {business.phone ? (
          <a href={telHref(business.phone)} className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
            <Phone className="size-4" aria-hidden /> {business.phone}
          </a>
        ) : null}
        {business.bookingUrl ? (
          <a
            href={websiteHref(business.bookingUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium hover:underline sm:ml-2 sm:border-l sm:pl-3"
          >
            <CalendarDays className="size-4" aria-hidden /> Book a service
          </a>
        ) : null}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------- inbox */

type InboxEntry =
  | { kind: "doc"; doc: PortalDocumentSummary; sentAt: string }
  | { kind: "proposal"; proposal: PortalProposalSummary; sentAt: string };

function inboxEntries(view: PortalViewData): InboxEntry[] {
  const inProposal = new Set(view.proposals.flatMap((p) => p.estimateIds));
  const docs: InboxEntry[] = [...view.invoices, ...view.estimates.filter((e) => !inProposal.has(e.id))].map((doc) => ({
    kind: "doc",
    doc,
    sentAt: doc.date,
  }));
  const proposals: InboxEntry[] = view.proposals.map((proposal) => ({ kind: "proposal", proposal, sentAt: proposal.sentAt }));
  return [...docs, ...proposals].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

function Inbox({
  view,
  loaders,
  actions,
  scope,
  selected,
  onSelect,
}: {
  view: PortalViewData;
  loaders: DocumentLoaders;
  actions: PortalActions;
  scope: string;
  selected: PortalSelection;
  onSelect: (s: PortalSelection) => void;
}) {
  const entries = inboxEntries(view);
  const byId = new Map(
    [...view.invoices, ...view.estimates].map((d) => [`${d.kind}:${d.id}`, d] as const),
  );
  const current =
    selected && selected.kind !== "proposal" ? (byId.get(`${selected.kind}:${selected.id}`) ?? null) : null;
  const proposal = selected?.kind === "proposal" ? (view.proposals.find((p) => p.id === selected.id) ?? null) : null;
  const parent = selected && selected.kind !== "proposal" && selected.fromProposal
    ? view.proposals.find((p) => p.id === selected.fromProposal)
    : undefined;

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(260px,330px)_1fr]">
      <section aria-label="Your inbox" className={cx("space-y-3", selected && "hidden md:block")}>
        <h2 className="px-1 text-lg font-semibold">Your Inbox ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Nothing to show yet. Your estimates and invoices will appear here as soon as {view.business.name} sends them.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {entries.map((e) =>
              e.kind === "doc" ? (
                <li key={`${e.doc.kind}-${e.doc.id}`}>
                  <DocumentCard
                    doc={e.doc}
                    preview={view.preview}
                    selected={current?.id === e.doc.id && current.kind === e.doc.kind}
                    onOpen={() => onSelect({ kind: e.doc.kind, id: e.doc.id })}
                  />
                </li>
              ) : (
                <li key={`proposal-${e.proposal.id}`}>
                  <ProposalCard
                    proposal={e.proposal}
                    selected={proposal?.id === e.proposal.id}
                    onOpen={() => onSelect({ kind: "proposal", id: e.proposal.id })}
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section aria-label="Document" className={cx("min-w-0", !selected && "hidden md:block")}>
        {proposal ? (
          <ProposalDetail
            proposal={proposal}
            onBack={() => onSelect(null)}
            onOpenOption={(doc) => onSelect({ kind: "estimate", id: doc.id, fromProposal: proposal.id })}
          />
        ) : current ? (
          <DocumentDetail
            key={`${scope}:${current.kind}:${current.id}`}
            doc={current}
            loaders={loaders}
            actions={actions}
            preview={view.preview}
            onBack={() => onSelect(parent ? { kind: "proposal", id: parent.id } : null)}
            backLabel={parent ? `Back to Proposal #${parent.number}` : "Back to inbox"}
          />
        ) : (
          <div className="hidden h-full min-h-64 items-center justify-center rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground md:flex">
            {entries.length ? "Pick a document on the left to read it." : "Nothing to read yet."}
          </div>
        )}
      </section>
    </div>
  );
}

export function DocumentCard({
  doc,
  preview,
  selected,
  onOpen,
}: {
  doc: PortalDocumentSummary;
  preview: boolean;
  selected?: boolean;
  onOpen: () => void;
}) {
  const isInvoice = doc.kind === "invoice";
  const status = inboxChip(doc);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${documentTitle(doc)}${doc.name ? ` ${doc.name}` : ""}`}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "block w-full rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected && "border-emerald-500/60 bg-emerald-500/5",
      )}
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-base font-semibold">{documentTitle(doc)}</span>
        <span className={cx(chip, status.className)}>{status.label}</span>
      </span>
      {doc.name ? <span className="mt-1 block truncate text-sm">{doc.name}</span> : null}
      {preview && !doc.sent ? (
        <span className="mt-1 inline-block rounded border border-dashed border-amber-500/60 px-1.5 text-[10px] font-semibold tracking-wide text-amber-700 dark:text-amber-400">
          UNSENT
        </span>
      ) : null}
      <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="size-3.5" aria-hidden />
        {doc.sent ? `Sent ${formatYmd(doc.date)}` : formatYmd(doc.date)}
        {isInvoice && doc.dueDate ? ` | Due ${formatYmd(doc.dueDate)}` : ""}
      </span>
      <span className="mt-2 flex justify-end gap-4 border-t pt-2 text-sm">
        {!isInvoice && doc.depositDue ? (
          <span>
            <span className="text-muted-foreground">Deposit: </span>
            <span className="font-semibold tabular-nums">{formatMoney(doc.depositDue)}</span>
          </span>
        ) : null}
        <span>
          <span className="text-muted-foreground">Total: </span>
          <span className="font-semibold tabular-nums">{formatMoney(doc.total)}</span>
        </span>
      </span>
    </button>
  );
}

function ProposalCard({ proposal, selected, onOpen }: { proposal: PortalProposalSummary; selected?: boolean; onOpen: () => void }) {
  const status = proposalChip(proposal);
  const n = proposal.options.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Proposal #${proposal.number}`}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "block w-full rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected && "border-emerald-500/60 bg-emerald-500/5",
      )}
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-base font-semibold">Proposal #{proposal.number}</span>
        <span className={cx(chip, status.className)}>{status.label}</span>
      </span>
      <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="size-3.5" aria-hidden /> Sent {formatSentAt(proposal.sentAt)}
      </span>
      <span className="mt-2 flex justify-end border-t pt-2 text-sm font-semibold">
        {n} estimate{n === 1 ? "" : "s"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ detail */

function DocumentDetail({
  doc,
  loaders,
  actions,
  preview,
  onBack,
  backLabel,
}: {
  doc: PortalDocumentSummary;
  loaders: DocumentLoaders;
  actions: PortalActions;
  preview: boolean;
  onBack: () => void;
  backLabel: string;
}) {
  const title = documentTitle(doc);
  const page = useLoad(() => loaders.getHtml(doc), `${doc.kind}:${doc.id}`);
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const isInvoice = doc.kind === "invoice";
  const open = isOpenEstimate(doc);
  const owedDeposit = depositOwed(doc);
  const status = inboxChip(doc);

  const download = async () => {
    setBusy(true);
    setPdfError(null);
    try {
      const { url } = await loaders.getPdfUrl(doc, true);
      goTo(url);
    } catch {
      setPdfError("Couldn't prepare the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // What the client can do right now. A button that cannot act is worse than none.
  const approve = open && actions.onApprove ? actions.onApprove : undefined;
  const decline = open && actions.onDecline ? actions.onDecline : undefined;
  const payDeposit = !open && doc.status === "approved" && owedDeposit > 0 && doc.payable && actions.onPayDeposit ? actions.onPayDeposit : undefined;
  const pay = isInvoice && isOwing(doc) && doc.payable && actions.onPay ? actions.onPay : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> {backLabel}
        </button>
        <button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} Download PDF
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {title}
            {doc.name ? <span className="font-normal text-muted-foreground"> - {doc.name}</span> : null}
          </h2>
          {!isInvoice && open && doc.depositDue ? (
            <p className="text-base font-semibold">Required deposit: {formatMoney(doc.depositDue)}</p>
          ) : null}
          {!isInvoice && !open && owedDeposit > 0 ? (
            <p className="text-base font-semibold">Deposit still owed: {formatMoney(owedDeposit)}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {isInvoice && isOwing(doc) ? `Balance: ${formatMoney(doc.balanceDue ?? doc.total)} · ` : ""}
            Total: {formatMoney(doc.total)}
          </p>
          <span className={cx(chip, status.className, "mt-1")}>{status.label}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {decline ? (
            <button type="button" onClick={() => decline(doc)} className={outlineButton}>
              Decline
            </button>
          ) : null}
          {approve ? (
            <button type="button" onClick={() => approve(doc)} className={primaryButton}>
              {doc.depositDue ? "Approve & pay deposit" : "Approve"}
            </button>
          ) : null}
          {payDeposit ? (
            <button type="button" onClick={() => payDeposit(doc)} className={primaryButton}>
              <CreditCard className="size-4" aria-hidden /> Pay deposit {formatMoney(owedDeposit)}
            </button>
          ) : null}
          {pay ? (
            <button type="button" onClick={() => pay(doc)} className={primaryButton}>
              <CreditCard className="size-4" aria-hidden /> {doc.signatureNeeded ? "Sign & pay invoice" : "Pay invoice"}
            </button>
          ) : null}
        </div>
      </div>
      {preview && (open || isOwing(doc)) ? (
        <p className="text-xs text-muted-foreground">Preview — approving, signing and paying are the client&apos;s to do.</p>
      ) : null}
      {pdfError ? (
        <p role="alert" className="text-xs text-destructive">{pdfError}</p>
      ) : null}

      <div className="rounded-2xl border bg-muted/40 p-2 sm:p-3">
        {page.loading ? (
          <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Loading…
          </div>
        ) : page.error || !page.data ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>We couldn&apos;t show this document on the page. You can still download the PDF above.</p>
            <button type="button" onClick={page.reload} className={outlineButton}>
              Try again
            </button>
          </div>
        ) : (
          <DocumentFrame html={page.data.html} title={title} />
        )}
      </div>
    </div>
  );
}

function ProposalDetail({
  proposal,
  onBack,
  onOpenOption,
}: {
  proposal: PortalProposalSummary;
  onBack: () => void;
  onOpenOption: (doc: PortalDocumentSummary) => void;
}) {
  const status = proposalChip(proposal);
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline md:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Back to inbox
      </button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Proposal #{proposal.number}</h2>
          <p className="text-sm text-muted-foreground">Sent {formatSentAt(proposal.sentAt)} · {proposal.options.length} estimates</p>
        </div>
        <span className={cx(chip, status.className)}>{status.label}</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {proposal.options.map((o, i) => {
          const picked = proposal.selectedEstimateId === o.id;
          const s = inboxChip(o);
          return (
            <li
              key={o.id}
              className={cx("relative flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-xs", picked && "border-emerald-500/60")}
            >
              {picked ? (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-chip bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Selected option
                </span>
              ) : null}
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{o.name || `Option ${i + 1}`}</span>
                <span className="font-mono font-semibold tabular-nums">{formatMoney(o.total)}</span>
              </span>
              <span className="text-xs text-muted-foreground">Estimate #{o.number}</span>
              <span className={cx(chip, s.className, "self-start")}>{s.label}</span>
              <button type="button" onClick={() => onOpenOption(o)} className={cx(primaryButton, "mt-auto")}>
                View estimate
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- booking */

function Booking({ jobs, businessName }: { jobs: PortalJob[]; businessName: string }) {
  const upcoming = jobs.filter((j) => j.kind === "upcoming");
  const completed = jobs.filter((j) => j.kind === "completed");
  return (
    <div className="space-y-6">
      <JobList title="Upcoming" jobs={upcoming} businessName={businessName} empty="No upcoming visits." />
      <JobList title="Completed" jobs={completed} businessName={businessName} empty="No completed jobs yet." />
    </div>
  );
}

function JobList({ title, jobs, businessName, empty }: { title: string; jobs: PortalJob[]; businessName: string; empty: string }) {
  return (
    <section aria-label={title} className="space-y-2.5">
      <h2 className="px-1 text-lg font-semibold">
        {title} <span className="text-base font-normal text-muted-foreground">({jobs.length})</span>
      </h2>
      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {jobs.map((j) => {
            const ics = calendarDataUrl(j, businessName);
            return (
              <li key={j.id} className="space-y-2 rounded-2xl border bg-card p-4 shadow-xs">
                <p className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{j.jobType ?? "Service visit"}</span>
                  <span className="text-xs text-muted-foreground">#{j.number}</span>
                </p>
                <p className="flex items-center gap-1.5 text-sm">
                  <CalendarDays className="size-4 flex-none text-muted-foreground" aria-hidden />
                  {formatJobWhen(j.scheduledDate, j.scheduledEndDate, j.timezone)}
                </p>
                {j.address ? (
                  <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 size-4 flex-none" aria-hidden /> {j.address}
                  </p>
                ) : null}
                {j.technicians.length ? (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Wrench className="size-4 flex-none" aria-hidden /> {j.technicians.join(", ")}
                  </p>
                ) : null}
                {ics && j.kind === "upcoming" ? (
                  <a href={ics} download={`job-${j.number}.ics`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
                    <CalendarPlus className="size-4" aria-hidden /> Add to calendar
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- profile */

const METHOD_LABEL: Record<string, string> = { card: "Card", bank: "Bank transfer", cash: "Cash", check: "Check", other: "Other" };
const PAYMENT_STATUS: Record<string, string> = {
  settled: "Paid",
  pending: "Clearing",
  refunded: "Refunded",
  reversed: "Returned",
  failed: "Failed",
};

function ProfilePanel({ view, onBack }: { view: PortalViewData; onBack: () => void }) {
  const c = view.client;
  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      <h2 className="text-2xl font-semibold">Your Profile</h2>
      <section aria-label="Personal info" className="space-y-2 rounded-2xl border bg-card p-4 shadow-xs">
        <h3 className="font-semibold">Personal Info</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <Info label="Name" value={[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"} />
          <Info label="Email" value={c.email ?? "—"} />
          <Info label="Phone" value={c.phone ?? "—"} />
        </dl>
        <p className="text-xs text-muted-foreground">To change these, please contact {view.business.name}.</p>
      </section>
      <section aria-label="Payment history" className="space-y-2 rounded-2xl border bg-card p-4 shadow-xs">
        <h3 className="font-semibold">Payment History</h3>
        {view.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y">
            {view.payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function PaymentRow({ payment: p }: { payment: PortalPaymentLine }) {
  const what = p.estimateId ? "Deposit on an estimate" : p.invoiceId ? "Invoice payment" : "Payment";
  const how = [METHOD_LABEL[p.method] ?? p.method, p.cardBrand && p.last4 ? `${p.cardBrand} ···· ${p.last4}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block font-medium">{what}</span>
        <span className="block text-xs text-muted-foreground">
          {formatSentAt(p.takenAt)} · {how}
        </span>
      </span>
      <span className="text-right">
        <span className="block font-mono font-semibold tabular-nums">{formatMoney(p.amount)}</span>
        <span className="block text-xs text-muted-foreground">{PAYMENT_STATUS[p.status] ?? p.status}</span>
      </span>
    </li>
  );
}

/* --------------------------------------------------------------- page states */

export function PortalSkeleton() {
  const bar = "animate-pulse rounded-lg bg-muted";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" aria-busy role="status" aria-label="Loading your documents">
      <div className={cx(bar, "h-16 rounded-2xl")} />
      <div className={cx(bar, "h-8 w-1/2")} />
      <div className="grid gap-5 md:grid-cols-[330px_1fr]">
        <div className="space-y-2.5">
          <div className={cx(bar, "h-28 rounded-2xl")} />
          <div className={cx(bar, "h-28 rounded-2xl")} />
        </div>
        <div className={cx(bar, "hidden h-96 rounded-2xl md:block")} />
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

/** Kept for hosts that still render a lone icon per kind. */
export const KIND_ICON: Record<PortalDocumentSummary["kind"] | "proposal", ReactNode> = {
  invoice: <FileText className="size-4" aria-hidden />,
  estimate: <FileSpreadsheet className="size-4" aria-hidden />,
  proposal: <Layers className="size-4" aria-hidden />,
};
