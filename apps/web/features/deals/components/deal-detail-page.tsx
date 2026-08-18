"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ExternalLink, Loader2, Lock, Trash2, UserCog, X } from "lucide-react";
import { ContactSource, DealPriority, type Contact, type Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact, useUpdateContact, useCreateContact } from "@/features/clients/hooks";
import {
  ClientSaveDialog,
  type ClientSaveDecision,
} from "@/features/clients/components/client-change-dialog";
import { addressInList, contactName, formatPhone } from "@/features/clients/lib";
import { PhoneInput } from "@/components/ui/phone-input";
import { JobTypeSelect } from "@/features/job-types/components/job-type-select";
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { JobStatusSelect } from "@/features/job-statuses/components/job-status-select";
import { CustomFieldsSection } from "@/features/custom-fields/components/custom-fields-section";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields, workizOrderedGroups } from "@/features/custom-fields/lib";
import { LiveCallStrip } from "@/features/calls/components/live-call-strip";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import {
  useChangeDealClient,
  useDeal,
  useDeleteDeal,
  useMoveStatus,
  useSetDealTags,
  useUpdateDeal,
} from "../hooks";
import {
  buildContactBody,
  buildDealPatch,
  clientDraftFromContact,
  dealDraftFromDeal,
  isUrgent,
  type ClientDraft,
  type DealDraft,
} from "../lib";
import { PriorityFlag, StageBadge } from "./deal-badges";
import { DealNotesCard } from "./deal-notes-card";
import { DealProductsTab } from "./deal-products-tab";
import { DealTimelinePanel } from "./deal-timeline-panel";
import { DealAttachmentsTab } from "./deal-attachments-tab";
import { useAttachments } from "../attachments-hooks";
import { AssignTechDialog } from "./assign-tech-dialog";
import { AssignedTechs } from "./assigned-techs";
import { DealAddressFields, type DealAddressValue } from "./deal-address-fields";
import { ScheduleField } from "./schedule-field";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { usePageHistoryLabel } from "@/components/shell/page-history";

type Tab = "details" | "items" | "attachments";

export function DealDetailPage({ dealId }: { dealId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: deal, isLoading } = useDeal(dealId);
  const del = useDeleteDeal();
  const setTags = useSetDealTags(dealId);
  const moveStatus = useMoveStatus(dealId);
  const [tab, setTab] = useState<Tab>("details");
  const { data: attachments } = useAttachments(dealId);
  const attachmentCount = attachments?.length ?? 0;
  usePageHistoryLabel(deal ? `Job (${deal.dealNumber})` : undefined);

  if (isLoading || !deal) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;

  const canEdit = can("deals", "edit");
  const canDelete = can("deals", "delete");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Only while a call is actually happening — that's the one moment
          "link this call" has a subject. */}
      <LiveCallStrip dealId={deal.id} />
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Jobs
        </Link>
        <span className="font-mono text-base font-semibold">#{deal.dealNumber}</span>
        <StageBadge status={deal.superStatus} />
        {isUrgent(deal) ? <PriorityFlag /> : null}
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {canEdit ? <UserCog className="size-3.5" /> : <Lock className="size-3.5" />}
          {canEdit ? "You can edit" : "Read only"}
        </span>
        {canDelete ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive"><Trash2 className="size-3.5" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete job #{deal.dealNumber}?</AlertDialogTitle>
                <AlertDialogDescription>This soft-deletes the job — it&apos;s archived and drops out of the pipeline.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); del.mutate(deal.id, { onSuccess: () => router.push("/deals") }); }}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {/* Status + tags share one row; tags wrap under the select when cramped */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <JobStatusSelect
            value={{ superStatus: deal.superStatus, subStatusId: deal.subStatusId }}
            onChange={(v) =>
              moveStatus.mutate(v, { onSuccess: () => toast.success("Status updated") })
            }
            disabled={!canEdit}
          />
        </div>
        {canEdit || (deal.tagIds?.length ?? 0) > 0 ? (
          <JobTagCombobox
            value={deal.tagIds ?? []}
            onChange={(ids) => {
              const added = ids.length > (deal.tagIds?.length ?? 0);
              setTags.mutate(ids, {
                onSuccess: () => toast.success(added ? "Tag added" : "Tag removed"),
              });
            }}
            disabled={!canEdit}
          />
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b px-6">
        {(["details", "items", "attachments"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition-colors",
              t === tab ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "attachments" && attachmentCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums">
                {attachmentCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Details stays mounted (just hidden) so its unsaved draft survives
            a hop to the other tabs. */}
        <div className={cn(tab !== "details" && "hidden")}>
          <DetailsTab deal={deal} canEdit={canEdit} />
        </div>
        {tab === "items" ? (
          <div className="mx-auto max-w-3xl"><DealProductsTab deal={deal} canEdit={canEdit} /></div>
        ) : null}
        {tab === "attachments" ? (
          <div className="mx-auto max-w-5xl"><DealAttachmentsTab dealId={deal.id} canEdit={canEdit} /></div>
        ) : null}
      </div>

      {/* Workiz-style hanging history: handle on the right edge, opens the
          timeline with the change log, filters and search. */}
      <DealTimelinePanel dealId={deal.id} canEdit={canEdit} />
    </div>
  );
}

/* -------------------------------------------------------------- details tab */

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    // h-full: cards in a grid row stretch to the tallest neighbour.
    <div className="h-full rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-border" />
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DetailsTab({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const { can, isTechnician } = usePermissions();
  const { data: contact } = useContact(deal.contactId);
  const { data: customFieldDefs } = useCustomFields();
  const update = useUpdateDeal(deal.id);
  const updateContact = useUpdateContact();
  const createContact = useCreateContact();
  const changeClient = useChangeDealClient(deal.id);
  const [assigning, setAssigning] = useState(false);
  const canEditClient = can("contacts", "edit");

  // One draft per side — every field below is a controlled input writing here,
  // and the single Save at the bottom persists whatever actually changed.
  const [dealDraft, setDealDraft] = useState<DealDraft>(() => dealDraftFromDeal(deal));
  const syncedDealId = useRef(deal.id);
  useEffect(() => {
    // Re-sync the draft from the server, but never clobber unsaved edits. A
    // fresh deal (id change) always adopts server values; a same-deal refetch —
    // an instant action like status/tag/assign bumps updatedAt — only re-syncs
    // when the draft has no pending changes.
    const freshDeal = syncedDealId.current !== deal.id;
    syncedDealId.current = deal.id;
    if (!freshDeal && buildDealPatch(deal, dealDraft)) return;
    setDealDraft(dealDraftFromDeal(deal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.updatedAt]);

  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(() =>
    contact ? clientDraftFromContact(contact) : null,
  );
  const syncedContactId = useRef(contact?.id);
  useEffect(() => {
    // Same guarded re-sync as the deal draft: keep unsaved client edits across a
    // plain contact refetch; adopt server values only for a different contact.
    const freshContact = syncedContactId.current !== contact?.id;
    syncedContactId.current = contact?.id;
    if (!freshContact && contact && clientDraft && buildContactBody(contact, clientDraft)) return;
    setClientDraft(contact ? clientDraftFromContact(contact) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, contact?.updatedAt]);

  const setDeal = (patch: Partial<DealDraft>) => setDealDraft((d) => ({ ...d, ...patch }));

  // Recomputes as the draft's job type changes — the applicable set is scoped to it.
  // One card per custom-field group, Workiz-ordered — same as the New Job form.
  const orderedCfGroups = workizOrderedGroups(applicableFields(customFieldDefs, dealDraft.jobTypeId));

  const dealPatch = buildDealPatch(deal, dealDraft);
  // A changed service address is also offered to the client's saved list — but
  // that's a contact write, so it (and any client-field edit) is gated on
  // `contacts.edit`. Without it, a deals-only editor never touches the contact.
  const contactBody =
    canEditClient && contact && clientDraft
      ? buildContactBody(contact, clientDraft, dealPatch?.address ? dealDraft.address : undefined)
      : null;
  const dirty = !!dealPatch || !!contactBody;
  const pending = update.isPending || updateContact.isPending || createContact.isPending;

  const { confirm } = useUnsavedChanges(dirty);

  // Who the client is, changed — as opposed to filling in an email or fixing a
  // typo'd unit number.
  const clientChanged =
    !!contact &&
    !!clientDraft &&
    (clientDraft.firstName !== contact.firstName ||
      clientDraft.lastName !== contact.lastName ||
      JSON.stringify(clientDraft.phones.map((p) => p.trim()).filter(Boolean)) !==
        JSON.stringify(contact.phones));
  // A service location the client doesn't have on file yet.
  const newAddress =
    contact && dealPatch?.address && !addressInList(dealDraft.address, contact.addresses)
      ? dealDraft.address
      : undefined;

  const [asking, setAsking] = useState(false);

  const save = () => {
    // Same question the job's creation asks: is this the same client corrected,
    // or someone else — and does a new address belong on their record? Skipped
    // when nothing about the client itself moved.
    if (canEditClient && contact && (clientChanged || newAddress)) {
      setAsking(true);
      return;
    }
    commit({ client: "update", address: "job-only" });
  };

  const commit = (decision: ClientSaveDecision) => {
    setAsking(false);
    if (dealPatch) update.mutate(dealPatch);
    if (!contact || !clientDraft || !canEditClient) return;

    if (clientChanged && decision.client === "create") {
      // The number follows the new client, so future calls from it resolve to
      // whoever this job is actually for; the job moves with them.
      createContact.mutate(
        {
          firstName: clientDraft.firstName.trim(),
          lastName: clientDraft.lastName.trim(),
          phones: clientDraft.phones.map((p) => p.trim()).filter(Boolean),
          emails: clientDraft.email.trim() ? [clientDraft.email.trim()] : [],
          addresses: decision.address === "save" && newAddress ? [newAddress] : [],
          type: contact.type,
          companyId: contact.companyId,
          source: ContactSource.PHONE_CALL,
          reassignPhones: true,
        },
        { onSuccess: (c) => changeClient.mutate(c.id) },
      );
      return;
    }

    const body = buildContactBody(
      contact,
      clientDraft,
      decision.address === "save" ? newAddress : undefined,
    );
    if (body) updateContact.mutate({ id: contact.id, body });
  };
  const reset = () => {
    setDealDraft(dealDraftFromDeal(deal));
    setClientDraft(contact ? clientDraftFromContact(contact) : null);
  };

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Client */}
      <Section
        title="Client"
        action={
          contact ? (
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
              <Link href={`/contacts/${contact.id}`}>
                <ExternalLink className="size-3.5" /> View client
              </Link>
            </Button>
          ) : null
        }
      >
        {contact && clientDraft ? (
          <ClientEditor contact={contact} draft={clientDraft} onChange={setClientDraft} canEdit={canEditClient} />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Section>

      {/* Schedule + Team */}
      <Section title="Schedule">
        <ScheduleField
          date={dealDraft.scheduledDate || undefined}
          slot={dealDraft.scheduledTimeSlot || undefined}
          disabled={!canEdit}
          onDate={(d) => setDeal({ scheduledDate: d ?? "" })}
          onSlot={(s) => setDeal({ scheduledTimeSlot: s })}
        />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Team</Label>
            {canEdit ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setAssigning(true)}>
                <UserCog className="size-3.5" /> Assign
              </Button>
            ) : null}
          </div>
          <AssignedTechs techIds={deal.assignedTechIds} emptyText="Unassigned" />
        </div>
      </Section>

      {/* Service location */}
      <Section title="Service location">
        <DealAddressEditor
          value={dealDraft.address}
          onChange={(a) => setDeal({ address: a })}
          clientAddresses={contact?.addresses}
          canEdit={canEdit}
        />
        <Field label="Service area">
          <Input className="h-9" value={dealDraft.serviceArea} disabled={!canEdit}
            onChange={(e) => setDeal({ serviceArea: e.target.value })} />
        </Field>
      </Section>

      {/* Job */}
      <Section title="Job">
        <Field label="Job type">
          <JobTypeSelect value={dealDraft.jobTypeId} onChange={(val) => setDeal({ jobTypeId: val })} disabled={!canEdit} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <JobSourceSelect value={dealDraft.sourceId} onChange={(val) => setDeal({ sourceId: val })} disabled={!canEdit} />
          </Field>
          <Field label="Priority">
            <Select value={dealDraft.priority} onValueChange={(val) => setDeal({ priority: val as DealPriority })} disabled={!canEdit}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DealPriority.NORMAL}>Normal</SelectItem>
                <SelectItem value={DealPriority.URGENT}>Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="PO number">
            <Input className="h-9" value={dealDraft.poNumber} disabled={!canEdit} placeholder="C-PO / VPO"
              onChange={(e) => setDeal({ poNumber: e.target.value })} />
          </Field>
          <Field label="Work order link">
            <Input className="h-9" value={dealDraft.workOrderId} disabled={!canEdit} placeholder="https://…"
              onChange={(e) => setDeal({ workOrderId: e.target.value })} />
          </Field>
        </div>
      </Section>

      {/* Custom fields — user-defined answers, held in the same draft and saved
          by the single Save below. Job-type scoped, so it re-renders on type change. */}
      {orderedCfGroups.map(({ group }) => (
        <Section key={group} title={group}>
          <CustomFieldsSection
            jobTypeId={dealDraft.jobTypeId}
            value={dealDraft.customFields}
            onChange={(cf) => setDeal({ customFields: cf })}
            dealId={deal.id}
            disabled={!canEdit}
            onlyGroup={group}
          />
        </Section>
      ))}

      {/* Notes — directly editable; the single Save below persists them */}
      <div className="lg:col-span-2">
        <DealNotesCard
          notes={dealDraft.notes}
          internalNotes={dealDraft.internalNotes}
          editable={canEdit && !isTechnician}
          onNotesChange={(v) => setDeal({ notes: v })}
          onInternalNotesChange={(v) => setDeal({ internalNotes: v })}
        />
      </div>

      {/* The one Save for the whole page */}
      {canEdit || canEditClient ? (
        <div className="flex justify-end gap-2 lg:col-span-2">
          <Button variant="ghost" size="sm" disabled={!dirty || pending} onClick={reset}>Reset</Button>
          <Button variant="brand" size="sm" className="gap-1.5" disabled={!dirty || pending} onClick={save}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
          </Button>
        </div>
      ) : null}

      {confirm}

      {contact && clientDraft && asking ? (
        <ClientSaveDialog
          open
          original={contact}
          edits={{
            firstName: clientDraft.firstName,
            lastName: clientDraft.lastName,
            phone: clientDraft.phones[0] ?? "",
          }}
          clientChanged={clientChanged}
          newAddress={newAddress}
          pending={pending}
          onCancel={() => setAsking(false)}
          onConfirm={commit}
        />
      ) : null}

      {assigning ? (
        <AssignTechDialog dealId={deal.id} assignedTechIds={deal.assignedTechIds} open={assigning} onOpenChange={setAssigning} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- service address edit */

function DealAddressEditor({
  value,
  onChange,
  clientAddresses,
  canEdit,
}: {
  value: DealAddressValue;
  onChange: (a: DealAddressValue) => void;
  clientAddresses?: Contact["addresses"];
  canEdit: boolean;
}) {
  if (!canEdit) {
    return (
      <div className="text-sm text-muted-foreground">
        {[value.street, value.unit].filter(Boolean).join(", ")}
        {value.city ? <div>{value.city}, {value.state} {value.zip}</div> : null}
      </div>
    );
  }

  return <DealAddressFields value={value} onChange={onChange} clientAddresses={clientAddresses} />;
}

/* ------------------------------------------------------------- client editor */

function ClientEditor({
  contact,
  draft,
  onChange,
  canEdit,
}: {
  contact: Contact;
  draft: ClientDraft;
  onChange: (d: ClientDraft) => void;
  canEdit: boolean;
}) {
  const set = (patch: Partial<ClientDraft>) => onChange({ ...draft, ...patch });

  if (!canEdit) {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium">{contactName(contact)}</div>
        {contact.phones.map((p, i) => (
          <div key={p} className="flex items-center gap-2 text-muted-foreground">
            {formatPhone(p)}{i === 0 ? <PrimaryBadge /> : null}
            <CallClientButton to={p} partyId={contact.id} />
          </div>
        ))}
        {contact.emails[0] ? <div className="text-muted-foreground">{contact.emails[0]}</div> : null}
        <div className="pt-1 text-xs text-muted-foreground">Editing the client needs the “contacts · edit” permission.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="First name"><Input className="h-9" value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
        <Field label="Last name"><Input className="h-9" value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
      </div>
      <Field label="Phones">
        <div className="space-y-2">
          {draft.phones.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <PhoneInput
                className="flex-1"
                value={p}
                onChange={(v) => set({ phones: draft.phones.map((x, j) => (j === i ? v : x)) })}
              />
              {i === 0 ? <PrimaryBadge /> : null}
              {/* Dials what's on file, not the half-typed draft. */}
              {contact.phones.includes(p) ? (
                <CallClientButton to={p} partyId={contact.id} />
              ) : null}
              {draft.phones.length > 1 ? (
                <Button variant="ghost" size="icon" className="size-9 flex-none" onClick={() => set({ phones: draft.phones.filter((_, j) => j !== i) })} aria-label="Remove phone"><X className="size-4" /></Button>
              ) : null}
            </div>
          ))}
          <button type="button" className="text-xs font-medium text-brand" onClick={() => set({ phones: [...draft.phones, ""] })}>＋ Add phone</button>
        </div>
        <p className="text-xs text-muted-foreground">The first phone is the client&apos;s primary number.</p>
      </Field>
      <Field label="Email"><Input className="h-9" value={draft.email} placeholder="name@example.com" onChange={(e) => set({ email: e.target.value })} /></Field>
    </div>
  );
}

function PrimaryBadge() {
  return (
    <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
      Primary
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
