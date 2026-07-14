"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Phone, UserPlus } from "lucide-react";
import { ClientType, ContactSource, ContactType, DealPriority } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
import { useContactByPhone, useCreateContact, useCompanyMap } from "@/features/clients/hooks";
import { clientTypeLabel, contactName } from "@/features/clients/lib";
import { useCreateDeal } from "../hooks";
import { dealJobSchema, type DealJobValues } from "../schemas";
import { jobTypeLabel } from "../lib";

const JOB_TYPES = ["lockout", "rekey", "lock_change", "installation", "repair", "safe", "automotive", "commercial", "other"];

interface ResolvedClient {
  contactId: string;
  name: string;
  companyId?: string;
  clientType: ClientType;
}

export function NewDealSheet({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {open ? <Wizard onClose={() => setOpen(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Wizard({ onClose }: { onClose: () => void }) {
  const [client, setClient] = useState<ResolvedClient | null>(null);

  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <SheetTitle>New deal{client ? ` · ${client.name}` : ""}</SheetTitle>
      </SheetHeader>
      {client ? (
        <JobStep client={client} onBack={() => setClient(null)} onClose={onClose} />
      ) : (
        <ClientStep onResolved={setClient} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ step 1: client */

function ClientStep({ onResolved }: { onResolved: (c: ResolvedClient) => void }) {
  const [phone, setPhone] = useState("");
  const trimmed = phone.trim();
  const dupe = useContactByPhone(trimmed, trimmed.length >= 7);
  const { map: companyMap } = useCompanyMap();
  const createContact = useCreateContact();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");

  const found = dupe.data ?? null;

  const clientTypeFor = (c: Contact): ClientType =>
    c.companyId ? companyMap.get(c.companyId)?.clientType ?? ClientType.RESIDENTIAL : ClientType.RESIDENTIAL;

  const selectContact = (c: Contact) =>
    onResolved({ contactId: c.id, name: contactName(c), companyId: c.companyId, clientType: clientTypeFor(c) });

  const create = () => {
    if (!first.trim() || !last.trim()) return;
    createContact.mutate(
      { firstName: first, lastName: last, phones: [trimmed], emails: [], type: ContactType.RESIDENTIAL, source: ContactSource.PHONE_CALL },
      { onSuccess: (c) => selectContact(c) },
    );
  };

  return (
    <div className="flex-1 space-y-4 px-5 py-5">
      <p className="text-sm text-muted-foreground">Start with the client&apos;s phone. We&apos;ll find them, or create a new contact.</p>
      <div className="space-y-1.5">
        <Label>Client phone</Label>
        <div className="relative">
          <Phone className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-10 pl-8" placeholder="(404) 555-1234" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
        </div>
      </div>

      {trimmed.length < 7 ? null : dupe.isFetching ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Looking up…</div>
      ) : found ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <Check className="size-4" /> <b>Existing client found</b>
          </div>
          <div className="mt-1 text-sm font-medium">{contactName(found)}</div>
          {found.companyId ? <div className="text-xs text-muted-foreground">{companyMap.get(found.companyId)?.title}</div> : null}
          <Button className="mt-3 w-full" variant="brand" onClick={() => selectContact(found)}>Continue with this client →</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><UserPlus className="size-4" /> No client with this phone — create one</div>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-9" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
            <Input className="h-9" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <Button className="mt-3 w-full gap-1.5" variant="brand" disabled={!first.trim() || !last.trim() || createContact.isPending} onClick={create}>
            {createContact.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create contact &amp; continue →
          </Button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- step 2: job */

function JobStep({ client, onBack, onClose }: { client: ResolvedClient; onBack: () => void; onClose: () => void }) {
  const router = useRouter();
  const createDeal = useCreateDeal();
  const [tagsStr, setTagsStr] = useState("");

  const form = useForm<DealJobValues>({
    resolver: zodResolver(dealJobSchema),
    defaultValues: {
      clientType: client.clientType,
      jobType: "",
      serviceArea: "",
      address: { street: "", unit: "", city: "", state: "", zip: "" },
      scheduledDate: "",
      scheduledTimeSlot: "",
      priority: DealPriority.NORMAL,
      source: "",
      notes: "",
      tags: [],
    },
  });

  const submit = (v: DealJobValues) => {
    const tags = tagsStr.split(",").map((t) => t.trim()).filter(Boolean);
    createDeal.mutate(
      {
        contactId: client.contactId,
        companyId: client.companyId,
        ...v,
        scheduledDate: v.scheduledDate || undefined,
        scheduledTimeSlot: v.scheduledTimeSlot || undefined,
        source: v.source || undefined,
        notes: v.notes || undefined,
        tags,
      },
      {
        onSuccess: (d) => {
          onClose();
          router.push(`/deals/${d.id}`);
        },
      },
    );
  };

  const err = form.formState.errors;
  const jobType = useWatch({ control: form.control, name: "jobType" });
  const priority = useWatch({ control: form.control, name: "priority" });
  const clientType = useWatch({ control: form.control, name: "clientType" });

  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-1 flex-col">
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Job type" error={err.jobType?.message} value={jobType} onChange={(v) => form.setValue("jobType", v, { shouldValidate: true })} options={JOB_TYPES.map((t) => ({ value: t, label: jobTypeLabel(t) }))} placeholder="Select" />
          <Sel label="Priority" value={priority} onChange={(v) => form.setValue("priority", v as DealPriority)} options={[{ value: DealPriority.NORMAL, label: "Normal" }, { value: DealPriority.URGENT, label: "Urgent" }]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service area" error={err.serviceArea?.message}><Input className="h-9" {...form.register("serviceArea")} /></Field>
          <Sel label="Client type" value={clientType} onChange={(v) => form.setValue("clientType", v as ClientType)} options={Object.values(ClientType).map((t) => ({ value: t, label: clientTypeLabel(t) }))} />
        </div>

        <div className="space-y-1.5">
          <Label>Service address</Label>
          <Input className="h-9" placeholder="Street" {...form.register("address.street")} />
          {err.address?.street ? <p className="text-xs text-destructive">{err.address.street.message}</p> : null}
          <div className="mt-2 grid grid-cols-[1fr_2fr_1fr_1fr] gap-2">
            <Input className="h-9" placeholder="Unit" {...form.register("address.unit")} />
            <Input className="h-9" placeholder="City" {...form.register("address.city")} />
            <Input className="h-9" placeholder="State" {...form.register("address.state")} />
            <Input className="h-9" placeholder="ZIP" {...form.register("address.zip")} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Scheduled date"><Input className="h-9" type="date" {...form.register("scheduledDate")} /></Field>
          <Field label="Time slot" error={typeof err.scheduledTimeSlot?.message === "string" ? err.scheduledTimeSlot.message : undefined}><Input className="h-9" placeholder="09:00-12:00" {...form.register("scheduledTimeSlot")} /></Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Source"><Input className="h-9" placeholder="e.g. Google Ads" {...form.register("source")} /></Field>
          <Field label="Tags (comma-separated)"><Input className="h-9" placeholder="rush, repeat" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} /></Field>
        </div>

        <Field label="Notes"><Textarea rows={2} {...form.register("notes")} /></Field>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={onBack}>← Back</Button>
        <Button type="submit" variant="brand" className="gap-1.5" disabled={createDeal.isPending}>
          {createDeal.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create deal
        </Button>
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function Sel({
  label,
  error,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
