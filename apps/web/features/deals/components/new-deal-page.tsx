"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronLeft, Loader2, UserPlus, X } from "lucide-react";
import { ClientType, ContactSource, ContactType, DealPriority } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useContactByPhone, useCreateContact, useUpdateContact, useCompanyMap } from "@/features/clients/hooks";
import { addressInList, clientTypeLabel, contactName, formatPhone } from "@/features/clients/lib";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCreateDeal } from "../hooks";
import { dealJobSchema, type DealJobValues } from "../schemas";
import { JobTypeSelect } from "@/features/job-types/components/job-type-select";
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { ResolvedAreaField } from "@/features/service-areas/components/resolved-area-field";
import { DealAddressFields } from "./deal-address-fields";
import { ScheduleField } from "./schedule-field";

export function NewDealPage() {
  const [contact, setContact] = useState<Contact | null>(null);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Jobs
        </Link>
        <h1 className="text-base font-semibold">New deal</h1>
        <span className="text-sm text-muted-foreground">· everything on one page</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DealForm contact={contact} onContact={setContact} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}<span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DealForm({ contact, onContact }: { contact: Contact | null; onContact: (c: Contact | null) => void }) {
  const router = useRouter();
  const createDeal = useCreateDeal();
  const updateContact = useUpdateContact();
  const { map: companyMap } = useCompanyMap();

  const form = useForm<DealJobValues>({
    resolver: zodResolver(dealJobSchema),
    defaultValues: {
      clientType: ClientType.RESIDENTIAL,
      jobTypeId: "",
      serviceArea: "",
      address: { street: "", unit: "", city: "", state: "", zip: "" },
      scheduledDate: "",
      scheduledTimeSlot: "",
      priority: DealPriority.NORMAL,
      sourceId: "",
      notes: "",
      tagIds: [],
    },
  });
  const err = form.formState.errors;
  const v = useWatch({ control: form.control }) as DealJobValues;

  const submit = form.handleSubmit((values) => {
    if (!contact) return;
    createDeal.mutate(
      {
        contactId: contact.id,
        companyId: contact.companyId,
        ...values,
        scheduledDate: values.scheduledDate || undefined,
        scheduledTimeSlot: values.scheduledTimeSlot || undefined,
        sourceId: values.sourceId || undefined,
        notes: values.notes || undefined,
        poNumber: values.poNumber || undefined,
        workOrderId: values.workOrderId || undefined,
      },
      {
        onSuccess: (deal) => {
          // The deal keeps its own address; a brand-new one is also saved to the
          // client so it's offered next time.
          if (!addressInList(values.address, contact.addresses)) {
            updateContact.mutate({
              id: contact.id,
              body: {
                firstName: contact.firstName,
                lastName: contact.lastName,
                phones: contact.phones,
                emails: contact.emails,
                addresses: [...contact.addresses, values.address],
                companyId: contact.companyId,
                type: contact.type,
                title: contact.title,
                notes: contact.notes,
              },
            });
          }
          router.push(`/deals/${deal.id}`);
        },
      },
    );
  });

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6" noValidate>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* Client */}
        <Section title="Client">
          <ClientPicker
            contact={contact}
            onResolved={(c) => {
              onContact(c);
              const ct = c.companyId ? companyMap.get(c.companyId)?.clientType : undefined;
              if (ct) form.setValue("clientType", ct);
            }}
            onClear={() => onContact(null)}
          />
        </Section>

        {/* Service location */}
        <Section title="Service location">
          <DealAddressFields
            value={v.address}
            onChange={(a) => form.setValue("address", a, { shouldValidate: true })}
            clientAddresses={contact?.addresses}
            error={err.address?.street?.message}
          />
          <ResolvedAreaField lat={v.address?.lat} lng={v.address?.lng} />
        </Section>

        {/* Job details */}
        <Section title="Job details">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Job type</Label>
              <JobTypeSelect value={v.jobTypeId} onChange={(val) => form.setValue("jobTypeId", val, { shouldValidate: true })} />
              {err.jobTypeId?.message ? <p className="text-xs text-destructive">{err.jobTypeId.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <JobSourceSelect value={v.sourceId} onChange={(val) => form.setValue("sourceId", val ?? "")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Priority" value={v.priority} onChange={(val) => form.setValue("priority", val as DealPriority)} options={[{ value: DealPriority.NORMAL, label: "Normal" }, { value: DealPriority.URGENT, label: "Urgent" }]} />
            <Sel label="Client type" value={v.clientType} onChange={(val) => form.setValue("clientType", val as ClientType)} options={Object.values(ClientType).map((t) => ({ value: t, label: clientTypeLabel(t) }))} />
          </div>
          <div className="space-y-1.5"><Label>Description / notes</Label><Textarea rows={4} placeholder="What needs doing…" {...form.register("notes")} /></div>
          <div className="space-y-1.5"><Label>Tags</Label><JobTagCombobox value={v.tagIds ?? []} onChange={(ids) => form.setValue("tagIds", ids)} /></div>
        </Section>

        {/* Schedule */}
        <Section title="Schedule">
          <ScheduleField
            date={v.scheduledDate || undefined}
            slot={v.scheduledTimeSlot || undefined}
            onDate={(d) => form.setValue("scheduledDate", d ?? "")}
            onSlot={(s) => form.setValue("scheduledTimeSlot", s, { shouldValidate: true })}
          />
          {typeof err.scheduledTimeSlot?.message === "string" ? <p className="text-xs text-destructive">{err.scheduledTimeSlot.message}</p> : null}
          <p className="text-xs text-muted-foreground">Assign technicians and add line items on the job page after creating.</p>
        </Section>

        {/* Work order / Platinum */}
        <Section title="Work order / Platinum">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>PO number</Label><Input className="h-9" placeholder="C-PO / VPO" {...form.register("poNumber")} /></div>
            <div className="space-y-1.5"><Label>Work order link</Label><Input className="h-9" placeholder="https://…" {...form.register("workOrderId")} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Optional — for platinum-contract jobs.</p>
        </Section>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t bg-background/90 px-6 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">
          {contact ? `Client: ${contactName(contact)}` : "Pick or create a client to continue."}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" asChild><Link href="/deals">Cancel</Link></Button>
          <Button type="submit" variant="brand" className="gap-1.5" disabled={!contact || createDeal.isPending}>
            {createDeal.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create job
          </Button>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- client picker */

function ClientPicker({
  contact,
  onResolved,
  onClear,
}: {
  contact: Contact | null;
  onResolved: (c: Contact) => void;
  onClear: () => void;
}) {
  const [phone, setPhone] = useState("");
  const trimmed = phone.trim();
  const dupe = useContactByPhone(trimmed, !contact && trimmed.length >= 7);
  const { map: companyMap } = useCompanyMap();
  const createContact = useCreateContact();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");

  if (contact) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div>
          <div className="font-medium">{contactName(contact)}</div>
          {contact.companyId ? <div className="text-xs text-muted-foreground">{companyMap.get(contact.companyId)?.title}</div> : null}
          {contact.phones[0] ? <div className="text-xs text-muted-foreground">{formatPhone(contact.phones[0])}</div> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={onClear}>
          <X className="size-3.5" /> Change
        </Button>
      </div>
    );
  }

  const found = dupe.data ?? null;
  const create = () => {
    if (!first.trim() || !last.trim()) return;
    createContact.mutate(
      { firstName: first, lastName: last, phones: [trimmed], emails: [], addresses: [], type: ContactType.RESIDENTIAL, source: ContactSource.PHONE_CALL },
      { onSuccess: (c) => onResolved(c) },
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Find or add a client</Label>
        <PhoneInput value={phone} onChange={setPhone} placeholder="Client phone…" autoFocus />
      </div>
      {trimmed.length < 7 ? (
        <p className="text-xs text-muted-foreground">Enter a phone to find an existing client or create a new one.</p>
      ) : dupe.isFetching ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Looking up…</div>
      ) : found ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><Check className="size-4" /> <b>Existing client found</b></div>
          <div className="mt-1 text-sm font-medium">{contactName(found)}</div>
          <Button className="mt-3 w-full" variant="brand" size="sm" onClick={() => onResolved(found)}>Use this client →</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><UserPlus className="size-4" /> No client with this phone — create one</div>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-9" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
            <Input className="h-9" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <Button className="mt-3 w-full gap-1.5" variant="brand" size="sm" disabled={!first.trim() || !last.trim() || createContact.isPending} onClick={create}>
            {createContact.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create client
          </Button>
        </div>
      )}
    </div>
  );
}

function Sel({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
