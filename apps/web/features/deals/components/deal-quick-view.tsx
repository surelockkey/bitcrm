"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Mail, MapPin, MessageSquareText, SquareArrowOutUpRight, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import type { Contact, Deal } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  contactName,
  extensionOf,
  formatAddress,
  formatPhone,
  formatPhoneWithExtension,
  primaryEmail,
} from "@/features/clients/lib";
import { useContact } from "@/features/clients/hooks";
import { ClientChatSheet } from "@/features/clients/components/client-chat-sheet";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { useJobTypeName } from "@/features/job-types/lib";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { JobStatusMenu } from "@/features/job-statuses/components/job-status-menu";
import { useJobZoneOf } from "@/features/service-areas/hooks";
import { cn } from "@/lib/utils";
import { useAssignTechs, useDeal, useMoveStatus, useSetDealTags, useUpdateDeal } from "../hooks";
import { dealJobName, jobNamePatch, storedTagOrder } from "../job-shell";
import { isUrgent, jobFirstPhone } from "../lib";
import { PriorityFlag } from "./deal-badges";
import { WzTeamSelect } from "./workiz";
import { QvIconButton, QvLabel, QvTitle, QvValue } from "./quick-view/parts";
import { ScheduleJobBlock } from "./quick-view/schedule";
import { DescriptionBlock } from "./quick-view/description";
import { NotesBlock } from "./quick-view/notes";
import { FinanceBlock } from "./quick-view/finance";
import { CustomFieldsTab } from "./quick-view/custom-fields";
import { ItemsTab } from "./quick-view/items";

const TABS = [
  { value: "details", label: "Details" },
  { value: "custom", label: "Custom fields" },
  { value: "items", label: "Items" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/**
 * Workiz's job Quick view (jobs list → Job ID → "Quick view"; captured
 * 2026-10-14 as quickview_wz_* in the parser kit): a 440px white pane with
 * "Job ID: …", the job in a new tab and ×, three tabs — Details · Custom
 * fields · Items — and, on Details, every block editable where the job page
 * is: Status, Tags, Schedule job, Team, Description, Notes, Finance.
 *
 * It opens whole: the list warms its data while the cursor is on the Job ID
 * (`prefetchQuickView`), and the body is drawn once the job and its client
 * are in hand — a skeleton of the same frame until then, never a spinner
 * that gives way to a taller pane.
 */
export function DealQuickView({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[440px] max-w-[94vw] gap-0 bg-white p-0 text-[#404040] sm:max-w-[440px]"
      >
        {open && dealId ? <QuickView dealId={dealId} /> : <SheetTitle className="sr-only">Job</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}

function QuickView({ dealId }: { dealId: string }) {
  const { can } = usePermissions();
  const { data: deal } = useDeal(dealId);
  const contactQuery = useContact(deal?.contactId ?? "");
  const [tab, setTab] = useState<Tab>("details");
  const canEdit = can("deals", "edit");

  // The job and its client, or nothing: the pane never shows the job first
  // and the name a frame later.
  const ready = !!deal && (!deal.contactId || contactQuery.data !== undefined || contactQuery.isError);

  return (
    <>
      <Header deal={deal} canEdit={canEdit} />
      <div role="tablist" aria-label="Quick view" className="flex h-[41px] shrink-0 border-b border-[#e5e7eb]">
        {TABS.map((t) => {
          const active = t.value === tab;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`qv-${t.value}`}
              onClick={() => setTab(t.value)}
              className={cn(
                "relative h-8 flex-1 rounded-[2px] px-4 pt-[9px] pb-[5px] text-[14px] leading-[18px] tracking-[0.5px]",
                active
                  ? "font-bold text-[#3b4b52] after:absolute after:inset-x-0 after:-bottom-[9px] after:h-[2px] after:bg-[#3b4b52]"
                  : "font-medium text-[#6b7280] hover:text-[#3b4b52]",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div id={`qv-${tab}`} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {!ready || !deal ? (
          <Skeleton />
        ) : tab === "details" ? (
          <DetailsTab deal={deal} contact={contactQuery.data} canEdit={canEdit} canSeeMoney={can("financials", "view")} />
        ) : tab === "custom" ? (
          <CustomFieldsTab deal={deal} canEdit={canEdit} />
        ) : (
          <ItemsTab dealId={deal.id} />
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ header */

/**
 * quickview_wz_open: "Job ID: LSBE12" (18px/600/27px ink) 29px down, the
 * pencil for the job name after it; open-in-new-tab and × at the right.
 * The whole head is 88px, then the tab row.
 */
function Header({ deal, canEdit }: { deal: Deal | undefined; canEdit: boolean }) {
  return (
    <div className="flex h-[88px] shrink-0 items-start justify-between pt-[29px] pr-5 pl-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <SheetTitle className="text-[18px] leading-[27px] font-semibold text-[#3b4b52]">
            {deal ? `Job ID: ${deal.dealNumber}` : "Job"}
          </SheetTitle>
          {deal && canEdit ? <JobNameField deal={deal} /> : null}
        </div>
        {deal?.jobName ? <p className="truncate text-[13px] leading-[19px] text-[#404040]">{deal.jobName}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {deal ? (
          <Link
            href={`/deals/${deal.id}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open full job"
            title="Open full job"
            className="grid size-8 place-items-center rounded-[8px] text-[#3b4b52] hover:bg-[#f3f6f7]"
          >
            <SquareArrowOutUpRight className="size-5" strokeWidth={1.5} />
          </Link>
        ) : null}
        <SheetClose asChild>
          <button type="button" aria-label="Close" className="grid size-8 place-items-center rounded-[8px] text-[#3b4b52] hover:bg-[#f3f6f7]">
            <X className="size-5" strokeWidth={1.5} />
          </button>
        </SheetClose>
      </div>
    </div>
  );
}

/** The pencil beside the Job ID ("Add job name"): an inline box, Enter or ✓ saves. */
function JobNameField({ deal }: { deal: Deal }) {
  const update = useUpdateDeal(deal.id);
  const name = dealJobName(deal);
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null) return;
    const patch = jobNamePatch(name, draft);
    setDraft(null);
    if (patch) update.mutate(patch);
  };
  if (draft === null) {
    return <QvIconButton label={name ? "Edit job name" : "Add job name"} icon="pencil" onClick={() => setDraft(name)} />;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        aria-label="Job name"
        maxLength={200}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setDraft(null);
        }}
        className="h-7 w-44 rounded-[4px] border border-[#9ea6aa] bg-white px-2 text-[13px] text-[#3b4b52] outline-none focus:border-[#3b4b52]"
      />
      <button type="button" aria-label="Save job name" onClick={save} className="grid size-6 place-items-center rounded-[4px] text-[#6aa8ee] hover:bg-[#f3f6f7]">
        <Check className="size-4" />
      </button>
      <button type="button" aria-label="Cancel" onClick={() => setDraft(null)} className="grid size-6 place-items-center rounded-[4px] text-[#3b4b52] hover:bg-[#f3f6f7]">
        <X className="size-4" />
      </button>
    </span>
  );
}

/* ----------------------------------------------------------------- details */

function DetailsTab({
  deal,
  contact,
  canEdit,
  canSeeMoney,
}: {
  deal: Deal;
  contact: Contact | undefined;
  canEdit: boolean;
  canSeeMoney: boolean;
}) {
  const jobTypeName = useJobTypeName();
  const zoneOf = useJobZoneOf();
  const moveStatus = useMoveStatus(deal.id);
  const setTags = useSetDealTags(deal.id);
  const assignTechs = useAssignTechs(deal.id);
  const phone = jobFirstPhone(deal, contact);
  const email = contact ? primaryEmail(contact) : undefined;
  // Message the client — the job page's chat panel, for anyone who may send.
  const { can } = usePermissions();
  const canText = !!contact && can("messages", "send");
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="pb-6">
      {/* STATUS · CLIENT · JOB TYPE (· COMPANY, ours) · TAGS, then the rule. */}
      <div className="px-6 pt-6">
        <QvLabel>Status</QvLabel>
        <div className="mt-[5px] flex flex-wrap items-center gap-2">
          {isUrgent(deal) ? <PriorityFlag /> : null}
          {/* The job page's menu, undressed to Workiz's quick-view row: the dot, the name, the caret. */}
          <div className="[&>button]:h-[19px] [&>button]:w-auto [&>button]:rounded-none [&>button]:bg-transparent [&>button]:pl-0 [&>button]:text-[#3b4b52]">
            <JobStatusMenu
              value={{ superStatus: deal.superStatus, subStatusId: deal.subStatusId }}
              onChange={(v) => moveStatus.mutate(v, { onSuccess: () => toast.success("Status updated") })}
              disabled={!canEdit}
            />
          </div>
        </div>

        <QvLabel className="mt-[26px]">Client</QvLabel>
        <div className="mt-[10px] flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {contact ? (
              <Link href={`/contacts/${contact.id}`} className="text-[14px] leading-[21px] text-[#3b4b52] hover:underline">
                {contactName(contact)}
              </Link>
            ) : (
              <QvValue>—</QvValue>
            )}
            {deal.clientCompanyName ? <QvValue className="mt-[9px]">{deal.clientCompanyName}</QvValue> : null}
            {phone ? (
              <QvValue className="mt-1">{contact ? formatPhoneWithExtension(phone, extensionOf(contact, phone)) : formatPhone(phone)}</QvValue>
            ) : null}
            {deal.address ? (
              <QvValue className="mt-1 flex items-center gap-1">
                <MapPin className="size-3.5 flex-none text-[#768287]" /> {formatAddress(deal.address)}
              </QvValue>
            ) : null}
          </div>
          {/* Workiz: call and message at the right edge. Ours: the masked
              bridge's call button (the obvious action), then message — on
              every job with a client, email or not — and mail when there is one. */}
          <div className="flex shrink-0 items-center gap-2">
            {contact ? (
              <CallClientButton to={phone ?? ""} partyId={contact.id} dealId={deal.id} contactId={contact.id} phoneIndex={0} variant="prominent" />
            ) : null}
            {canText ? (
              <button
                type="button"
                aria-label="Message client"
                title="Message"
                onClick={() => setChatOpen(true)}
                className="grid size-8 place-items-center rounded-[8px] text-[#6aa8ee] hover:bg-[#f3f6f7]"
              >
                <MessageSquareText className="size-[18px]" strokeWidth={1.5} />
              </button>
            ) : null}
            {email ? (
              <a
                href={`mailto:${email}`}
                title={email}
                aria-label={`Email ${email}`}
                className="grid size-8 place-items-center rounded-[8px] text-[#6aa8ee] hover:bg-[#f3f6f7]"
              >
                <Mail className="size-[18px]" strokeWidth={1.5} />
              </a>
            ) : null}
          </div>
        </div>

        {canText && contact ? (
          <ClientChatSheet
            contactId={contact.id}
            name={contactName(contact)}
            phone={phone}
            open={chatOpen}
            onOpenChange={setChatOpen}
          />
        ) : null}

        <QvLabel className="mt-[22px]">Job type</QvLabel>
        <QvValue className="mt-[2px]">{jobTypeName(deal.jobTypeId)}</QvValue>

        {deal.businessProfileName ? (
          <>
            <QvLabel className="mt-[22px]">Company</QvLabel>
            <QvValue className="mt-[2px]">{deal.businessProfileName}</QvValue>
          </>
        ) : null}
      </div>

      <div className="mt-[22px] border-b border-[#e5e7eb] px-6 pb-4">
        <QvLabel>Tags</QvLabel>
        <div className="mt-[9px]">
          <JobTagCombobox
            variant="workiz"
            value={deal.tagIds ?? []}
            onChange={(ids) => {
              const added = ids.length > (deal.tagIds?.length ?? 0);
              setTags.mutate(storedTagOrder(deal.tagIds ?? [], ids), {
                onSuccess: () => toast.success(added ? "Tag added" : "Tag removed"),
              });
            }}
            disabled={!canEdit}
          />
        </div>
      </div>

      <ScheduleJobBlock deal={deal} zone={zoneOf(deal)} canEdit={canEdit} />

      <section aria-label="Team" className="px-6 pt-6 pb-6">
        <QvTitle>Team</QvTitle>
        <WzTeamSelect
          className="mt-2"
          label="Assign tech"
          variant="multi"
          shape="rounded"
          hideNotice
          jobTypeId={deal.jobTypeId}
          address={{ lat: deal.address?.lat, lng: deal.address?.lng }}
          serviceAreaId={deal.serviceAreaId}
          value={deal.assignedTechIds}
          onChange={(ids) => assignTechs.mutate(ids)}
          disabled={!canEdit}
        />
      </section>

      <DescriptionBlock deal={deal} canEdit={canEdit} />
      <NotesBlock dealId={deal.id} canEdit={canEdit} />
      {canSeeMoney ? <FinanceBlock deal={deal} canEdit={canEdit} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- skeleton */

/** The Details frame in grey while the job and its client arrive: same heights, nothing jumps. */
function Skeleton() {
  const bar = (w: string, h = "h-[14px]", extra = "") => <div className={cn("animate-pulse rounded-[3px] bg-[#eef1f2]", w, h, extra)} />;
  return (
    <div aria-busy="true" className="px-6 pt-6">
      {bar("w-12", "h-[10px]")}
      {bar("w-28", "h-[19px]", "mt-2")}
      {bar("w-12", "h-[10px]", "mt-[26px]")}
      {bar("w-44", "h-[21px]", "mt-[10px]")}
      {bar("w-60", "h-[21px]", "mt-1")}
      {bar("w-16", "h-[10px]", "mt-[22px]")}
      {bar("w-36", "h-[21px]", "mt-[2px]")}
      {bar("w-10", "h-[10px]", "mt-[22px]")}
      {bar("w-24", "h-6", "mt-[9px]")}
      {bar("w-28", "h-[21px]", "mt-10")}
      {bar("w-40", "h-[19px]", "mt-2")}
      {bar("w-12", "h-[21px]", "mt-6")}
      {bar("w-full", "h-10", "mt-2")}
    </div>
  );
}
