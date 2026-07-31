"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Lock, Trash2, UserCog, X } from "lucide-react";
import { DealPriority, type Contact, type Deal } from "@bitcrm/types";
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
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact, useUpdateContact } from "@/features/clients/hooks";
import { addressInList, contactName, formatPhone } from "@/features/clients/lib";
import { PhoneInput } from "@/components/ui/phone-input";
import { JobTypeSelect } from "@/features/job-types/components/job-type-select";
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { toast } from "sonner";
import { useDeal, useDeleteDeal, useSetDealTags, useUpdateDeal } from "../hooks";
import { isUrgent } from "../lib";
import { PriorityFlag, StageBadge } from "./deal-badges";
import { StageMenu } from "./stage-menu";
import { DealNotesCard } from "./deal-notes-card";
import { DealProductsTab } from "./deal-products-tab";
import { DealTimelineTab } from "./deal-timeline-tab";
import { DealAttachmentsTab } from "./deal-attachments-tab";
import { AssignTechDialog } from "./assign-tech-dialog";
import { AssignedTechs } from "./assigned-techs";
import { DealAddressFields, type DealAddressValue } from "./deal-address-fields";
import { ScheduleField } from "./schedule-field";

type Tab = "details" | "items" | "attachments" | "timeline";

export function DealDetailPage({ dealId }: { dealId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: deal, isLoading } = useDeal(dealId);
  const del = useDeleteDeal();
  const setTags = useSetDealTags(dealId);
  const [tab, setTab] = useState<Tab>("details");

  if (isLoading || !deal) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;

  const canEdit = can("deals", "edit");
  const canDelete = can("deals", "delete");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Jobs
        </Link>
        <span className="font-mono text-base font-semibold">#{deal.dealNumber}</span>
        <StageBadge stage={deal.stage} />
        {isUrgent(deal) ? <PriorityFlag /> : null}
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {canEdit ? <UserCog className="size-3.5" /> : <Lock className="size-3.5" />}
          {canEdit ? "You can edit" : "Read only"}
        </span>
        {canEdit ? <StageMenu dealId={deal.id} /> : null}
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

      {/* Tags — top-left, with a "+" to quickly add existing tags */}
      {canEdit || (deal.tagIds?.length ?? 0) > 0 ? (
        <div className="flex items-center gap-2 border-b px-6 py-2.5">
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
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 border-b px-6">
        {(["details", "items", "attachments", "timeline"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition-colors",
              t === tab ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "details" ? <DetailsTab deal={deal} canEdit={canEdit} /> : null}
        {tab === "items" ? (
          <div className="mx-auto max-w-3xl"><DealProductsTab deal={deal} canEdit={canEdit} /></div>
        ) : null}
        {tab === "attachments" ? (
          <div className="mx-auto max-w-3xl"><DealAttachmentsTab dealId={deal.id} canEdit={canEdit} /></div>
        ) : null}
        {tab === "timeline" ? (
          <div className="mx-auto max-w-2xl"><DealTimelineTab dealId={deal.id} canEdit={canEdit} /></div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- details tab */

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
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
  const { can } = usePermissions();
  const { data: contact } = useContact(deal.contactId);
  const update = useUpdateDeal(deal.id);
  const [assigning, setAssigning] = useState(false);

  const commit = (patch: Record<string, unknown>) => update.mutate(patch);

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {/* Client */}
      <Section title="Client">
        {contact ? (
          <ClientEditor contact={contact} canEdit={can("contacts", "edit")} />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Section>

      {/* Schedule + Team */}
      <Section title="Schedule">
        <ScheduleField
          date={deal.scheduledDate || undefined}
          slot={deal.scheduledTimeSlot || undefined}
          disabled={!canEdit}
          onDate={(d) => commit({ scheduledDate: d || undefined })}
          onSlot={(s) => commit({ scheduledTimeSlot: s || undefined })}
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
        <DealAddressEditor deal={deal} contact={contact ?? null} canEdit={canEdit} />
        <Field label="Service area">
          <Input className="h-9" defaultValue={deal.serviceArea ?? ""} disabled={!canEdit}
            onBlur={(e) => { if (e.target.value !== (deal.serviceArea ?? "")) commit({ serviceArea: e.target.value }); }} />
        </Field>
      </Section>

      {/* Job */}
      <Section title="Job">
        <Field label="Job type">
          <JobTypeSelect value={deal.jobTypeId} onChange={(val) => commit({ jobTypeId: val })} disabled={!canEdit} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <JobSourceSelect value={deal.sourceId ?? ""} onChange={(val) => commit({ sourceId: val || undefined })} disabled={!canEdit} />
          </Field>
          <Field label="Priority">
            <Select value={deal.priority} onValueChange={(val) => commit({ priority: val as DealPriority })} disabled={!canEdit}>
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
            <Input className="h-9" defaultValue={deal.poNumber ?? ""} disabled={!canEdit} placeholder="C-PO / VPO"
              onBlur={(e) => { if (e.target.value !== (deal.poNumber ?? "")) commit({ poNumber: e.target.value || undefined }); }} />
          </Field>
          <Field label="Work order link">
            <Input className="h-9" defaultValue={deal.workOrderId ?? ""} disabled={!canEdit} placeholder="https://…"
              onBlur={(e) => { if (e.target.value !== (deal.workOrderId ?? "")) commit({ workOrderId: e.target.value || undefined }); }} />
          </Field>
        </div>
      </Section>

      {/* Notes (reuses the existing inline notes card) */}
      <div className="lg:col-span-2"><DealNotesCard deal={deal} /></div>

      {assigning ? (
        <AssignTechDialog dealId={deal.id} assignedTechIds={deal.assignedTechIds} open={assigning} onOpenChange={setAssigning} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- service address edit */

function DealAddressEditor({ deal, contact, canEdit }: { deal: Deal; contact: Contact | null; canEdit: boolean }) {
  const update = useUpdateDeal(deal.id);
  const updateContact = useUpdateContact();
  const initial: DealAddressValue = {
    street: deal.address?.street ?? "",
    unit: deal.address?.unit ?? "",
    city: deal.address?.city ?? "",
    state: deal.address?.state ?? "",
    zip: deal.address?.zip ?? "",
    lat: deal.address?.lat,
    lng: deal.address?.lng,
  };
  const [draft, setDraft] = useState<DealAddressValue>(initial);
  useEffect(() => { setDraft(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [deal.id, deal.updatedAt]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const save = () => {
    update.mutate({ address: draft });
    // A brand-new address is also saved to the client for next time.
    if (contact && !addressInList(draft, contact.addresses)) {
      updateContact.mutate({
        id: contact.id,
        body: {
          firstName: contact.firstName, lastName: contact.lastName,
          phones: contact.phones, emails: contact.emails,
          addresses: [...contact.addresses, draft],
          companyId: contact.companyId, type: contact.type, title: contact.title, notes: contact.notes,
        },
      });
    }
  };

  if (!canEdit) {
    return (
      <div className="text-sm text-muted-foreground">
        {[draft.street, draft.unit].filter(Boolean).join(", ")}
        {draft.city ? <div>{draft.city}, {draft.state} {draft.zip}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <DealAddressFields value={draft} onChange={setDraft} clientAddresses={contact?.addresses} />
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(initial)}>Reset</Button>
          <Button variant="brand" size="sm" className="gap-1.5" disabled={update.isPending} onClick={save}>
            {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save address
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- client editor */

function ClientEditor({ contact, canEdit }: { contact: Contact; canEdit: boolean }) {
  const update = useUpdateContact();
  const [first, setFirst] = useState(contact.firstName);
  const [last, setLast] = useState(contact.lastName);
  const [phones, setPhones] = useState<string[]>(contact.phones.length ? contact.phones : [""]);
  const [email, setEmail] = useState(contact.emails[0] ?? "");

  useEffect(() => {
    setFirst(contact.firstName); setLast(contact.lastName);
    setPhones(contact.phones.length ? contact.phones : [""]);
    setEmail(contact.emails[0] ?? "");
  }, [contact.id, contact.updatedAt]);

  const cleanPhones = phones.map((p) => p.trim()).filter(Boolean);
  const emails = email.trim() ? [email.trim(), ...contact.emails.slice(1)] : contact.emails.slice(1);
  const dirty =
    first !== contact.firstName || last !== contact.lastName ||
    JSON.stringify(cleanPhones) !== JSON.stringify(contact.phones) ||
    (email.trim() || "") !== (contact.emails[0] ?? "");

  const save = () => {
    update.mutate({
      id: contact.id,
      body: {
        firstName: first.trim(), lastName: last.trim(),
        phones: cleanPhones.length ? cleanPhones : contact.phones,
        emails,
        addresses: contact.addresses, companyId: contact.companyId,
        type: contact.type, title: contact.title, notes: contact.notes,
      },
    });
  };

  if (!canEdit) {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium">{contactName(contact)}</div>
        {contact.phones.map((p, i) => (
          <div key={p} className="flex items-center gap-2 text-muted-foreground">
            {formatPhone(p)}{i === 0 ? <PrimaryBadge /> : null}
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
        <Field label="First name"><Input className="h-9" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Last name"><Input className="h-9" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
      </div>
      <Field label="Phones">
        <div className="space-y-2">
          {phones.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <PhoneInput
                className="flex-1"
                value={p}
                onChange={(v) => setPhones((arr) => arr.map((x, j) => (j === i ? v : x)))}
              />
              {i === 0 ? <PrimaryBadge /> : null}
              {phones.length > 1 ? (
                <Button variant="ghost" size="icon" className="size-9 flex-none" onClick={() => setPhones((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove phone"><X className="size-4" /></Button>
              ) : null}
            </div>
          ))}
          <button type="button" className="text-xs font-medium text-brand" onClick={() => setPhones((arr) => [...arr, ""])}>＋ Add phone</button>
        </div>
        <p className="text-xs text-muted-foreground">The first phone is the client&apos;s primary number.</p>
      </Field>
      <Field label="Email"><Input className="h-9" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} /></Field>
      {dirty ? (
        <div className="flex justify-end">
          <Button variant="brand" size="sm" className="gap-1.5" disabled={update.isPending} onClick={save}>
            {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save client
          </Button>
        </div>
      ) : null}
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
