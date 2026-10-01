"use client";

import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Download,
  Link2Off,
  Loader2,
  MapPin,
  MoreVertical,
  Phone,
  RefreshCw,
  SlidersHorizontal,
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

/*
 * Colours are Workiz's own, sampled from their portal: slate ink #3b4b52,
 * secondary #637075, hint #9ea6aa, grey pane #f3f4f5, hairline #e9ebec,
 * green #50d58c (tab underline, selected card, PAID), amber #f5ba45
 * (AWAITING APPROVAL / PENDING), red #e05c5c, yellow #ffd503, link blue #6aa8ee.
 * They are written out so the staff preview (another app, other tokens)
 * renders the client's page pixel for pixel.
 */
const INK = "text-[#3b4b52]";
const SOFT = "text-[#637075]";
const chip = "inline-flex items-center rounded-chip px-2 py-[3px] text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase";
const CHIP_TONE: Record<string, string> = {
  "AWAITING APPROVAL": "bg-[#f5ba45] text-white",
  PENDING: "bg-[#f5ba45] text-white",
  PAID: "bg-[#50d58c] text-white",
  APPROVED: "bg-[#50d58c] text-white",
  OVERDUE: "bg-[#e05c5c] text-white",
  DECLINED: "bg-[#e05c5c] text-white",
  ARCHIVED: "bg-[#c7d4d0] text-[#3b4b52]",
  "NO AMOUNT": "bg-[#e9ebec] text-[#3b4b52]",
};
const Chip = ({ label }: { label: string }) => <span className={cx(chip, CHIP_TONE[label] ?? "bg-[#e9ebec]")}>{label}</span>;
const linkBlue = "text-[#6aa8ee] hover:underline";
const card =
  "block w-full rounded-lg border border-[#e9ebec] bg-white p-4 text-left shadow-[0_1px_3px_rgba(59,75,82,0.08)] transition-colors hover:border-[#50d58c]/60 focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none";
const cardSelected = "border-[#50d58c] bg-[#eefbf4]";

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

/** An older API answers without these; the page must still open. */
function normalize(view: PortalViewData): PortalViewData {
  return {
    ...view,
    invoices: view.invoices ?? [],
    estimates: view.estimates ?? [],
    proposals: view.proposals ?? [],
    jobs: view.jobs ?? [],
    payments: view.payments ?? [],
  };
}

/**
 * The client portal, laid out as Workiz lays it: the company bar, "Hey Jane,
 * it's great to see you", Inbox / My Booking, the inbox list on the left with
 * the chosen document on the grey pane to the right, the profile (contact
 * details + payment history) behind the avatar. Shared by the public page
 * and the staff preview.
 */
export function PortalView({
  view: raw,
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
  const view = normalize(raw);
  const [tab, setTab] = useState<"inbox" | "booking">("inbox");
  const [profile, setProfile] = useState(false);
  const [selected, setSelected] = useState<PortalSelection>(initialSelection);
  const name = firstNameOf(view.client);

  return (
    <div className={cx("flex min-h-full w-full flex-col bg-white font-sans [color-scheme:light]", INK)}>
      <PortalHeader business={view.business} />

      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[17px] sm:text-lg">
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
            className="flex size-10 flex-none items-center justify-center rounded-full bg-[#6aa8ee] text-sm font-semibold text-white hover:bg-[#5b9be6] focus-visible:ring-2 focus-visible:ring-[#3b4b52] focus-visible:outline-none"
          >
            {clientInitials(view.client)}
          </button>
        </div>

        {profile ? (
          <ProfilePanel view={view} onBack={() => setProfile(false)} />
        ) : (
          <>
            <div role="tablist" aria-label="Portal sections" className="mt-4 flex border-b border-[#e9ebec]">
              {(["inbox", "booking"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cx(
                    "-mb-px min-w-[150px] border-b-[3px] px-6 py-2.5 text-center text-sm transition-colors",
                    tab === t ? "border-[#50d58c] font-semibold" : cx("border-transparent hover:text-[#3b4b52]", SOFT),
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
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function PortalHeader({ business }: { business: PortalViewData["business"] }) {
  return (
    <header className="w-full bg-white shadow-[0_2px_8px_rgba(59,75,82,0.10)]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API, not a static asset
          <img src={business.logoUrl} alt="" className="h-10 w-auto max-w-[140px] flex-none object-contain sm:h-12" />
        ) : (
          <span aria-hidden className="flex size-10 flex-none items-center justify-center rounded-md bg-[#3b4b52] text-sm font-semibold text-white">
            {businessInitials(business.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] leading-tight font-semibold sm:text-xl">{business.name}</p>
          {business.description ? <p className="truncate text-xs text-[#9ea6aa] sm:text-sm">{business.description}</p> : null}
        </div>
        <div className="flex w-full items-center gap-4 text-sm font-medium sm:w-auto">
          {business.phone ? (
            <a href={telHref(business.phone)} className="inline-flex items-center gap-2 hover:underline">
              <Phone className="size-4" aria-hidden /> {business.phone}
            </a>
          ) : null}
          {business.bookingUrl ? (
            <a
              href={websiteHref(business.bookingUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-2 hover:underline sm:ml-0 sm:border-l sm:border-[#e9ebec] sm:pl-4"
            >
              <CalendarDays className="size-4" aria-hidden /> Book a service
            </a>
          ) : null}
        </div>
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
  const byId = new Map([...view.invoices, ...view.estimates].map((d) => [`${d.kind}:${d.id}`, d] as const));
  const current = selected && selected.kind !== "proposal" ? (byId.get(`${selected.kind}:${selected.id}`) ?? null) : null;
  const proposal = selected?.kind === "proposal" ? (view.proposals.find((p) => p.id === selected.id) ?? null) : null;
  const parent =
    selected && selected.kind !== "proposal" && selected.fromProposal
      ? view.proposals.find((p) => p.id === selected.fromProposal)
      : undefined;

  return (
    <div className="flex flex-1 flex-col md:grid md:grid-cols-[minmax(320px,390px)_1fr]">
      <section aria-label="Your inbox" className={cx("space-y-3 py-4 md:pr-5", selected && "hidden md:block")}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Your Inbox ({entries.length})</h2>
          <SlidersHorizontal className="size-4 text-[#637075]" aria-hidden />
        </div>
        {entries.length === 0 ? (
          <p className={cx("rounded-lg border border-dashed border-[#e9ebec] p-6 text-center text-sm", SOFT)}>
            Nothing to show yet. Your estimates and invoices will appear here as soon as {view.business.name} sends them.
          </p>
        ) : (
          <ul className="space-y-3">
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

      <section
        aria-label="Document"
        className={cx("min-w-0 flex-1 bg-[#f3f4f5] md:-mr-4 md:border-l md:border-[#e9ebec] md:px-6 md:py-4 lg:-mr-8", !selected && "hidden md:block")}
      >
        {proposal ? (
          <ProposalDetail
            proposal={proposal}
            business={view.business}
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
            alwaysBack={!!parent}
          />
        ) : (
          <div className={cx("hidden h-full min-h-72 items-center justify-center p-8 text-center text-sm md:flex", SOFT)}>
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
      className={cx(card, selected && cardSelected)}
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-[17px] font-semibold">{documentTitle(doc)}</span>
        <Chip label={status.label} />
      </span>
      {doc.name ? <span className="mt-0.5 block truncate text-sm">{doc.name}</span> : null}
      {preview && !doc.sent ? (
        <span className="mt-1 inline-block rounded-chip border border-dashed border-[#f5ba45] px-1.5 text-[10px] font-semibold tracking-wide text-[#8a5a00]">
          UNSENT
        </span>
      ) : null}
      <span className={cx("mt-2.5 flex items-center gap-1.5 text-xs", SOFT)}>
        <CalendarDays className="size-3.5" aria-hidden />
        {doc.sent ? `Sent ${formatYmd(doc.date)}` : formatYmd(doc.date)}
        {isInvoice && doc.dueDate ? ` | Due ${formatYmd(doc.dueDate)}` : ""}
      </span>
      <span className="mt-2.5 flex justify-end gap-4 border-t border-[#e9ebec] pt-2.5 text-sm">
        {!isInvoice && doc.depositDue ? (
          <span>
            <span className={SOFT}>Deposit: </span>
            <span className="font-semibold tabular-nums">{formatMoney(doc.depositDue)}</span>
          </span>
        ) : null}
        <span>
          <span className={SOFT}>Total: </span>
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
      className={cx(card, selected && cardSelected)}
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-[17px] font-semibold">Proposal #{proposal.number}</span>
        <Chip label={status.label} />
      </span>
      <span className="mt-0.5 block text-sm">Proposal #{proposal.number}</span>
      <span className={cx("mt-2.5 flex items-center gap-1.5 text-xs", SOFT)}>
        <CalendarDays className="size-3.5" aria-hidden /> Sent {formatSentAt(proposal.sentAt)}
      </span>
      <span className="mt-2.5 flex justify-end border-t border-[#e9ebec] pt-2.5 text-sm font-semibold">
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
  alwaysBack,
}: {
  doc: PortalDocumentSummary;
  loaders: DocumentLoaders;
  actions: PortalActions;
  preview: boolean;
  onBack: () => void;
  backLabel: string;
  /** "Back to Proposal" shows on every width; "Back to inbox" only where the list is hidden (phones). */
  alwaysBack: boolean;
}) {
  const title = documentTitle(doc);
  const page = useLoad(() => loaders.getHtml(doc), `${doc.kind}:${doc.id}`);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const isInvoice = doc.kind === "invoice";
  const open = isOpenEstimate(doc);
  const owedDeposit = depositOwed(doc);
  const status = inboxChip(doc);

  const download = async () => {
    setBusy(true);
    setMenu(false);
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
  const payDeposit =
    !open && doc.status === "approved" && owedDeposit > 0 && doc.payable && actions.onPayDeposit ? actions.onPayDeposit : undefined;
  const pay = isInvoice && isOwing(doc) && doc.payable && actions.onPay ? actions.onPay : undefined;
  const primary = approve
    ? { label: doc.depositDue ? "Approve & pay deposit" : "Approve", run: () => approve(doc) }
    : payDeposit
      ? { label: `Pay deposit ${formatMoney(owedDeposit)}`, run: () => payDeposit(doc) }
      : pay
        ? { label: doc.signatureNeeded ? "Sign & pay invoice" : "Pay invoice", run: () => pay(doc) }
        : null;

  return (
    <div className="flex min-h-full flex-col">
      {/* Phone top bar (Workiz): ← Back … ⤓ Download PDF */}
      <div className={cx("flex items-center justify-between gap-2 bg-white px-4 py-3 md:bg-transparent md:px-0 md:py-0", alwaysBack ? "" : "md:hidden")}>
        <button type="button" onClick={onBack} className={cx("inline-flex items-center gap-1 text-sm font-semibold", linkBlue)}>
          <ArrowLeft className="size-4" aria-hidden /> {backLabel}
        </button>
        <button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold md:hidden disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} Download PDF
        </button>
      </div>

      <div className={cx("space-y-3 px-4 pt-3 md:px-0 md:pt-2", (primary || decline) && "pb-44 md:pb-0")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base">
                {title}
                {doc.name ? ` - ${doc.name}` : ""}
              </h2>
              <span className="md:hidden">
                <Chip label={status.label} />
              </span>
            </div>
            {!isInvoice && open && doc.depositDue ? (
              <p className="text-lg font-semibold">Required deposit: {formatMoney(doc.depositDue)}</p>
            ) : null}
            {!isInvoice && !open && owedDeposit > 0 ? (
              <p className="text-lg font-semibold">Deposit still owed: {formatMoney(owedDeposit)}</p>
            ) : null}
            <p className={cx("text-sm md:hidden", SOFT)}>
              {doc.sent ? `Sent ${formatYmd(doc.date)}` : formatYmd(doc.date)}
              {isInvoice && doc.dueDate ? ` | Due ${formatYmd(doc.dueDate)}` : ""}
            </p>
            <p className="hidden text-sm md:block">
              {isInvoice && isOwing(doc) ? `Balance: ${formatMoney(doc.balanceDue ?? doc.total)} · ` : ""}
              Total: {formatMoney(doc.total)}
            </p>
          </div>
          {/* One set of controls: beside the title on a desk (Workiz), a sticky bottom panel on a phone. */}
          <div className="flex items-center gap-2">
            {primary || decline ? (
              <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-3 border-t border-[#e9ebec] bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(59,75,82,0.08)] md:static md:z-auto md:flex-row md:items-center md:gap-2 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
                <div className="flex items-baseline justify-between md:hidden">
                  <span className={cx("text-[11px] font-semibold tracking-wide uppercase", SOFT)}>
                    {isInvoice ? "Total invoice" : "Total estimate"}
                  </span>
                  <span className="text-xl font-semibold tabular-nums">{formatMoney(doc.total)}</span>
                </div>
                {!isInvoice && (doc.depositDue || owedDeposit > 0) ? (
                  <div className="flex items-baseline justify-between md:hidden">
                    <span className={cx("text-[11px] font-semibold tracking-wide uppercase", SOFT)}>Required deposit</span>
                    <span className="text-xl font-semibold tabular-nums">{formatMoney(open ? (doc.depositDue ?? 0) : owedDeposit)}</span>
                  </div>
                ) : null}
                {decline ? (
                  <button type="button" onClick={() => decline(doc)} className={cx(outlineButton, "order-2 h-12 w-full text-base md:order-none md:h-10 md:w-auto md:text-sm")}>
                    Decline
                  </button>
                ) : null}
                {primary ? (
                  <button type="button" onClick={primary.run} className={cx(primaryButton, "order-1 h-12 w-full text-base md:order-none md:h-10 md:w-auto md:text-sm")}>
                    {primary.label}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="relative hidden md:block">
              <button
                type="button"
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((m) => !m)}
                className="flex size-9 items-center justify-center rounded-full hover:bg-[#e9ebec]"
              >
                <MoreVertical className="size-5" aria-hidden />
              </button>
              {menu ? (
                <div role="menu" className="absolute right-0 z-10 mt-1 min-w-44 rounded-lg border border-[#e9ebec] bg-white py-1 shadow-lg">
                  <button type="button" role="menuitem" onClick={download} disabled={busy} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#f3f4f5]">
                    <Download className="size-4" aria-hidden /> Download PDF
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {preview && (open || isOwing(doc)) ? (
          <p className={cx("text-xs", SOFT)}>Preview — approving, signing and paying are the client&apos;s to do.</p>
        ) : null}
        {pdfError ? (
          <p role="alert" className="text-xs text-[#e05c5c]">{pdfError}</p>
        ) : null}

        {/* The document, as Workiz shows it: a white sheet under a slate rule. */}
        <div className="border-t-[3px] border-[#3b4c53] bg-white shadow-[0_1px_3px_rgba(59,75,82,0.10)]">
          {page.loading ? (
            <div role="status" className={cx("flex min-h-72 flex-col items-center justify-center gap-2 text-sm", SOFT)}>
              <Loader2 className="size-5 animate-spin" aria-hidden /> Loading…
            </div>
          ) : page.error || !page.data ? (
            <div className={cx("mx-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center text-sm", SOFT)}>
              <p>We couldn&apos;t show this document on the page. You can still download the PDF.</p>
              <button type="button" onClick={page.reload} className={outlineButton}>
                Try again
              </button>
            </div>
          ) : (
            <DocumentFrame html={page.data.html} title={title} />
          )}
        </div>
      </div>

    </div>
  );
}

function ProposalDetail({
  proposal,
  business,
  onBack,
  onOpenOption,
}: {
  proposal: PortalProposalSummary;
  business: PortalViewData["business"];
  onBack: () => void;
  onOpenOption: (doc: PortalDocumentSummary) => void;
}) {
  const status = proposalChip(proposal);
  return (
    <div className="space-y-3 px-4 py-3 md:px-0 md:py-2">
      <button type="button" onClick={onBack} className={cx("inline-flex items-center gap-1 text-sm font-semibold md:hidden", linkBlue)}>
        <ArrowLeft className="size-4" aria-hidden /> Back to inbox
      </button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Proposal #{proposal.number}</h2>
          <p className={cx("text-sm", SOFT)}>
            Sent {formatSentAt(proposal.sentAt)} · {proposal.options.length} estimates
          </p>
        </div>
        <Chip label={status.label} />
      </div>
      {/* Workiz's proposal sheet: the company and PROPOSAL across the top, an option per card. */}
      <div role="group" aria-label="Proposal options" className="border-t-[3px] border-[#3b4c53] bg-white shadow-[0_1px_3px_rgba(59,75,82,0.10)]">
        <div className="flex items-center gap-4 border-b border-[#e9ebec] px-5 py-4 sm:px-6">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API
            <img src={business.logoUrl} alt="" className="h-12 w-auto max-w-[140px] object-contain" />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-lg font-semibold">{business.name}</span>
          <span className="text-lg font-semibold tracking-[0.08em] text-[#9ea6aa]">PROPOSAL</span>
        </div>
        <ul className="grid gap-5 bg-[#f7f8f8] p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
          {proposal.options.map((o, i) => {
            const picked = proposal.selectedEstimateId === o.id;
            const s = inboxChip(o);
            const accent = OPTION_ACCENTS[i % OPTION_ACCENTS.length];
            return (
              <li
                key={o.id}
                className={cx(
                  "relative flex flex-col items-stretch gap-4 rounded-xl border border-transparent bg-white p-5 shadow-[0_2px_10px_rgba(59,75,82,0.08)]",
                  picked && "border-[#50d58c]",
                )}
              >
                {picked ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-chip bg-[#50d58c] px-2 py-0.5 text-[11px] font-semibold text-white">
                    Selected option
                  </span>
                ) : null}
                <span className="flex items-start justify-between gap-2">
                  <span className="text-lg font-semibold">{o.name || `Option ${i + 1}`}</span>
                  <span className="text-lg tabular-nums">{formatMoney(o.total)}</span>
                </span>
                <span aria-hidden className="h-1 w-full rounded-full" style={{ backgroundColor: accent }} />
                <span
                  aria-hidden
                  className="mx-auto flex size-40 items-center justify-center overflow-hidden rounded-full border-4 bg-[#f3f4f5]"
                  style={{ borderColor: accent }}
                >
                  {o.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL from the API
                    <img src={o.coverUrl} alt="" className="size-full object-cover" />
                  ) : null}
                </span>
                {o.description ? <p className={cx("text-center text-sm whitespace-pre-line", SOFT)}>{o.description}</p> : null}
                {s.label !== "AWAITING APPROVAL" && s.label !== "PENDING" ? (
                  <span className="self-center">
                    <Chip label={s.label} />
                  </span>
                ) : null}
                <button type="button" onClick={() => onOpenOption(o)} className={cx(primaryButton, "mt-auto self-center px-10")}>
                  View Option
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Workiz's option colours, in order: green, blue, purple, amber. */
const OPTION_ACCENTS = ["#50d58c", "#6aa8ee", "#c66dd6", "#f5ba45"];

/* ----------------------------------------------------------------- booking */

function Booking({ jobs, businessName }: { jobs: PortalJob[]; businessName: string }) {
  const upcoming = jobs.filter((j) => j.kind === "upcoming");
  const completed = jobs.filter((j) => j.kind === "completed");
  return (
    <div className="space-y-6 py-4">
      <JobList title="Upcoming" jobs={upcoming} businessName={businessName} empty="No upcoming visits." />
      <JobList title="Completed" jobs={completed} businessName={businessName} empty="No completed jobs yet." />
    </div>
  );
}

function JobList({ title, jobs, businessName, empty }: { title: string; jobs: PortalJob[]; businessName: string; empty: string }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-xl font-semibold">
        {title} <span className={cx("text-base font-normal", SOFT)}>({jobs.length})</span>
      </h2>
      {jobs.length === 0 ? (
        <p className={cx("rounded-lg border border-dashed border-[#e9ebec] p-6 text-center text-sm", SOFT)}>{empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => {
            const ics = calendarDataUrl(j, businessName);
            return (
              <li key={j.id} className="space-y-2 rounded-lg border border-[#e9ebec] bg-white p-4 shadow-[0_1px_3px_rgba(59,75,82,0.08)]">
                <p className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{j.jobType ?? "Service visit"}</span>
                  <span className={cx("text-xs", SOFT)}>#{j.number}</span>
                </p>
                <p className="flex items-center gap-1.5 text-sm">
                  <CalendarDays className={cx("size-4 flex-none", SOFT)} aria-hidden />
                  {formatJobWhen(j.scheduledDate, j.scheduledEndDate, j.timezone)}
                </p>
                {j.address ? (
                  <p className={cx("flex items-start gap-1.5 text-sm", SOFT)}>
                    <MapPin className="mt-0.5 size-4 flex-none" aria-hidden /> {j.address}
                  </p>
                ) : null}
                {j.technicians.length ? (
                  <p className={cx("flex items-center gap-1.5 text-sm", SOFT)}>
                    <Wrench className="size-4 flex-none" aria-hidden /> {j.technicians.join(", ")}
                  </p>
                ) : null}
                {ics && j.kind === "upcoming" ? (
                  <a href={ics} download={`job-${j.number}.ics`} className={cx("inline-flex items-center gap-1.5 text-sm font-semibold", linkBlue)}>
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
    <div className="space-y-5 py-4">
      <button type="button" onClick={onBack} className={cx("inline-flex items-center gap-1 text-sm font-semibold", linkBlue)}>
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      <h2 className="text-2xl font-semibold">Your Profile</h2>
      <section aria-label="Personal info" className="space-y-2 rounded-lg border border-[#e9ebec] bg-white p-4 shadow-[0_1px_3px_rgba(59,75,82,0.08)]">
        <h3 className="text-lg font-semibold">Personal Info</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Info label="Name" value={[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"} />
          <Info label="Email" value={c.email ?? "—"} />
          <Info label="Phone" value={c.phone ?? "—"} />
        </dl>
        <p className={cx("text-xs", SOFT)}>To change these, please contact {view.business.name}.</p>
      </section>
      <section aria-label="Payment history" className="space-y-2 rounded-lg border border-[#e9ebec] bg-white p-4 shadow-[0_1px_3px_rgba(59,75,82,0.08)]">
        <h3 className="text-lg font-semibold">Payment History</h3>
        {view.payments.length === 0 ? (
          <p className={cx("text-sm", SOFT)}>No payments yet.</p>
        ) : (
          <ul className="divide-y divide-[#e9ebec]">
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
      <dt className={cx("text-xs", SOFT)}>{label}</dt>
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
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="min-w-0">
        <span className="block font-medium">{what}</span>
        <span className={cx("block text-xs", SOFT)}>
          {formatSentAt(p.takenAt)} · {how}
        </span>
      </span>
      <span className="text-right">
        <span className="block font-semibold tabular-nums">{formatMoney(p.amount)}</span>
        <span className={cx("block text-xs", SOFT)}>{PAYMENT_STATUS[p.status] ?? p.status}</span>
      </span>
    </li>
  );
}

/* --------------------------------------------------------------- page states */

export function PortalSkeleton() {
  const bar = "animate-pulse rounded-lg bg-[#f3f4f5]";
  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-4 py-6 sm:px-6 lg:px-8" aria-busy role="status" aria-label="Loading your documents">
      <div className={cx(bar, "h-16")} />
      <div className={cx(bar, "h-7 w-1/2")} />
      <div className="grid gap-5 md:grid-cols-[330px_1fr]">
        <div className="space-y-3">
          <div className={cx(bar, "h-32")} />
          <div className={cx(bar, "h-32")} />
        </div>
        <div className={cx(bar, "hidden h-96 md:block")} />
      </div>
    </div>
  );
}

export function InvalidPortalLink({ businessName }: { businessName?: string }) {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border border-[#e9ebec] bg-white p-8 text-center shadow-[0_1px_3px_rgba(59,75,82,0.08)]">
      <span className="flex size-12 items-center justify-center rounded-full bg-[#f3f4f5] text-[#637075]">
        <Link2Off className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold">This link is no longer valid</h1>
      <p className={cx("text-sm", SOFT)}>
        {businessName
          ? `Please contact ${businessName} for a new link to your documents.`
          : "Please contact the business that sent it to you for a new link to your documents."}
      </p>
    </div>
  );
}

export function PortalLoadError({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border border-[#e9ebec] bg-white p-8 text-center shadow-[0_1px_3px_rgba(59,75,82,0.08)]">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className={cx("text-sm", SOFT)}>We couldn&apos;t load your documents. Please try again.</p>
      <button type="button" onClick={onRetry} disabled={retrying} className={outlineButton}>
        <RefreshCw className={cx("size-4", retrying && "animate-spin")} aria-hidden /> Try again
      </button>
    </div>
  );
}
