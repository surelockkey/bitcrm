"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronLeft, Loader2, Phone, UserPlus } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useContactByPhone, useCreateContact, useCompanyMap } from "@/features/clients/hooks";
import { clientTypeLabel, contactName } from "@/features/clients/lib";
import { MapsProvider } from "@/components/maps/maps-provider";
import { AddressAutocomplete } from "@/components/maps/address-autocomplete";
import { addressForSubmit } from "@/lib/geo/geo";
import { applyAddress } from "@/lib/geo/apply-address";
import { useCreateDeal } from "../hooks";
import { dealJobSchema, type DealJobValues } from "../schemas";
import { formatSchedule, jobTypeLabel } from "../lib";

const JOB_TYPES = ["lockout", "rekey", "lock_change", "installation", "repair", "safe", "automotive", "commercial", "other"];
const STEPS = ["Client", "Job", "Schedule", "Review"] as const;

interface ResolvedClient {
  contactId: string;
  name: string;
  companyId?: string;
  clientType: ClientType;
}

export function NewDealPage() {
  const [client, setClient] = useState<ResolvedClient | null>(null);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Deals
        </Link>
        <h1 className="text-base font-semibold">New deal</h1>
        {client ? <span className="text-sm text-muted-foreground">· {client.name}</span> : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {client ? (
            <DealForm client={client} onChangeClient={() => setClient(null)} />
          ) : (
            <>
              <Steps active={0} />
              <ClientStep onResolved={setClient} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Steps({ active }: { active: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid size-6 flex-none place-items-center rounded-full border text-[11px] font-bold",
                current ? "border-[var(--brand,theme(colors.blue.600))] bg-foreground text-background" : done ? "border-foreground/30 bg-foreground/10 text-foreground/70" : "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("text-xs font-medium", current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 ? <span className={cn("h-px flex-1", done ? "bg-foreground/30" : "bg-border")} /> : null}
          </li>
        );
      })}
    </ol>
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
    <div className="space-y-4">
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
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><Check className="size-4" /> <b>Existing client found</b></div>
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

/* -------------------------------------------------- steps 2-4: job / schedule / review */

function DealForm({ client, onChangeClient }: { client: ResolvedClient; onChangeClient: () => void }) {
  const router = useRouter();
  const createDeal = useCreateDeal();
  const [step, setStep] = useState(1); // 1=job, 2=schedule, 3=review
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

  const err = form.formState.errors;
  const v = useWatch({ control: form.control }) as DealJobValues;

  const tags = tagsStr.split(",").map((t) => t.trim()).filter(Boolean);

  const next = async () => {
    const fields: (keyof DealJobValues | `address.${string}`)[] =
      step === 1
        ? ["jobType", "serviceArea", "clientType", "address.street", "address.city", "address.state", "address.zip"]
        : ["scheduledTimeSlot"];
    const ok = await form.trigger(fields as never);
    if (ok) setStep((s) => s + 1);
  };

  const submit = () => {
    createDeal.mutate(
      {
        contactId: client.contactId,
        companyId: client.companyId,
        ...form.getValues(),
        // Normalises the empty unit and carries autocomplete coordinates through;
        // a hand-typed address arrives without them and is geocoded server-side.
        address: addressForSubmit(form.getValues("address")),
        scheduledDate: form.getValues("scheduledDate") || undefined,
        scheduledTimeSlot: form.getValues("scheduledTimeSlot") || undefined,
        source: form.getValues("source") || undefined,
        notes: form.getValues("notes") || undefined,
        tags,
      },
      { onSuccess: (d) => router.push(`/deals/${d.id}`) },
    );
  };

  return (
    // Loads Places only while the wizard is open, not on every page.
    <MapsProvider>
      <Steps active={step} />

      {step === 1 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Job type" error={err.jobType?.message} value={v.jobType} onChange={(val) => form.setValue("jobType", val, { shouldValidate: true })} options={JOB_TYPES.map((t) => ({ value: t, label: jobTypeLabel(t) }))} placeholder="Select" />
            <Sel label="Priority" value={v.priority} onChange={(val) => form.setValue("priority", val as DealPriority)} options={[{ value: DealPriority.NORMAL, label: "Normal" }, { value: DealPriority.URGENT, label: "Urgent" }]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service area" error={err.serviceArea?.message}><Input className="h-9" {...form.register("serviceArea")} /></Field>
            <Sel label="Client type" value={v.clientType} onChange={(val) => form.setValue("clientType", val as ClientType)} options={Object.values(ClientType).map((t) => ({ value: t, label: clientTypeLabel(t) }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Service address</Label>
            <AddressAutocomplete
              className="h-9"
              placeholder="Street"
              value={v.address?.street ?? ""}
              onChange={(val) => form.setValue("address.street", val, { shouldValidate: true })}
              onSelect={(address) =>
                applyAddress(
                  (path, value) =>
                    form.setValue(path as "address.street", value as never, {
                      shouldValidate: true,
                    }),
                  address,
                )
              }
            />
            {err.address?.street ? <p className="text-xs text-destructive">{err.address.street.message}</p> : null}
            <div className="mt-2 grid grid-cols-[1fr_2fr_1fr_1fr] gap-2">
              <Input className="h-9" placeholder="Unit" {...form.register("address.unit")} />
              <Input className="h-9" placeholder="City" {...form.register("address.city")} />
              <Input className="h-9" placeholder="State" {...form.register("address.state")} />
              <Input className="h-9" placeholder="ZIP" {...form.register("address.zip")} />
            </div>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scheduled date"><Input className="h-9" type="date" {...form.register("scheduledDate")} /></Field>
            <Field label="Time slot" error={typeof err.scheduledTimeSlot?.message === "string" ? err.scheduledTimeSlot.message : undefined}><Input className="h-9" placeholder="09:00-12:00" {...form.register("scheduledTimeSlot")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source"><Input className="h-9" placeholder="e.g. Google Ads" {...form.register("source")} /></Field>
            <Field label="Tags (comma-separated)"><Input className="h-9" placeholder="rush, repeat" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} /></Field>
          </div>
          <Field label="Notes"><Textarea rows={3} {...form.register("notes")} /></Field>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3 rounded-xl border p-4 text-sm">
          <ReviewRow label="Client" value={client.name} />
          <ReviewRow label="Job type" value={v.jobType ? jobTypeLabel(v.jobType) : "—"} />
          <ReviewRow label="Priority" value={v.priority === DealPriority.URGENT ? "Urgent" : "Normal"} />
          <ReviewRow label="Client type" value={clientTypeLabel(v.clientType)} />
          <ReviewRow label="Service area" value={v.serviceArea || "—"} />
          <ReviewRow label="Address" value={`${v.address.street}${v.address.unit ? ` ${v.address.unit}` : ""}, ${v.address.city} ${v.address.state} ${v.address.zip}`} />
          <ReviewRow label="Scheduled" value={formatSchedule(v.scheduledDate || undefined, v.scheduledTimeSlot || undefined)} />
          {v.source ? <ReviewRow label="Source" value={v.source} /> : null}
          {tags.length ? <ReviewRow label="Tags" value={tags.join(", ")} /> : null}
          {v.notes ? <ReviewRow label="Notes" value={v.notes} /> : null}
        </div>
      ) : null}

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (step === 1 ? onChangeClient() : setStep((s) => s - 1))}
        >
          ← {step === 1 ? "Change client" : "Back"}
        </Button>
        {step < 3 ? (
          <Button type="button" variant="brand" onClick={next}>Continue →</Button>
        ) : (
          <Button type="button" variant="brand" className="gap-1.5" disabled={createDeal.isPending} onClick={submit}>
            {createDeal.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create deal
          </Button>
        )}
      </div>
    </MapsProvider>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[70%] text-right font-medium">{value}</span>
    </div>
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
