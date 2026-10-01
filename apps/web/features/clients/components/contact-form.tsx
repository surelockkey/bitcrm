"use client";

import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Building2, Link2, Loader2, Mail, Phone, TriangleAlert } from "lucide-react";
import { ContactSource, ContactType } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { TAX_EXEMPT_REASONS } from "@/features/billing/lib";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { contactFormSchema, type ContactFormValues } from "../schemas";
import { useContactByPhone, useCompanyMap, useCreateContact, useUpdateContact } from "../hooks";
import { contactTypeLabel, extensionRows, extensionsFromRows, sourceLabel } from "../lib";
import { RepeatableInputs } from "./phone-email-fields";
import { ContactAddressFields } from "./contact-address-fields";
import { CompanyPickerDialog } from "./company-picker-dialog";

export function ContactForm({
  contact,
  defaultCompanyId,
  defaultPhone,
  onDone,
  onCancel,
  layout = "page",
}: {
  contact?: Contact;
  defaultCompanyId?: string;
  /** `dialog`: Workiz's two-column "Edit client info" popup. */
  layout?: "page" | "dialog";
  /** Prefills the first phone — e.g. creating a client from an unknown caller. */
  defaultPhone?: string;
  onDone?: (c: Contact) => void;
  onCancel?: () => void;
}) {
  const isEdit = !!contact;
  const { companies } = useCompanyMap();
  const create = useCreateContact();
  const update = useUpdateContact();
  const [pickerOpen, setPickerOpen] = useState(false);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          phones: contact.phones.length ? contact.phones : [""],
          phoneExts: extensionRows(
            contact.phones.length ? contact.phones : [""],
            contact.phoneExtensions,
          ),
          emails: contact.emails,
          addresses: contact.addresses ?? [],
          companyId: contact.companyId ?? "",
          type: contact.type,
          source: contact.source,
          title: contact.title ?? "",
          notes: contact.notes ?? "",
          taxExempt: contact.taxExempt ?? false,
          taxExemptReason: contact.taxExemptReason ?? "",
        }
      : {
          firstName: "",
          lastName: "",
          phones: [defaultPhone ?? ""],
          phoneExts: [""],
          emails: [],
          addresses: [],
          companyId: defaultCompanyId ?? "",
          type: ContactType.RESIDENTIAL,
          // A prefilled number always came from a call we just handled.
          source: defaultPhone ? ContactSource.PHONE_CALL : ContactSource.MANUAL,
          title: "",
          notes: "",
          taxExempt: false,
          taxExemptReason: "",
        },
  });

  const watchedPhone = useWatch({ control: form.control, name: "phones.0" });
  const taxExempt = useWatch({ control: form.control, name: "taxExempt" });
  const firstPhone = (watchedPhone ?? "").trim();
  const dupe = useContactByPhone(firstPhone, !isEdit && firstPhone.length >= 7);
  // Dedup only surfaces while creating (isEdit === false), so any match is a
  // genuine other contact — no need to exclude "self".
  const duplicate = !isEdit ? dupe.data ?? null : null;

  const pending = create.isPending || update.isPending;

  const submit = (v: ContactFormValues) => {
    const base = {
      firstName: v.firstName,
      lastName: v.lastName,
      phones: v.phones,
      phoneExtensions: extensionsFromRows(v.phones, v.phoneExts),
      emails: v.emails,
      addresses: v.addresses,
      companyId: v.companyId || undefined,
      type: v.type,
      title: v.title || undefined,
      notes: v.notes || undefined,
      taxExempt: v.taxExempt,
      // "" clears a stale reason once the client is no longer exempt.
      taxExemptReason: v.taxExempt ? (v.taxExemptReason ?? "") : "",
    };
    if (isEdit) {
      update.mutate({ id: contact.id, body: base }, { onSuccess: (c) => onDone?.(c) });
    } else {
      create.mutate({ ...base, source: v.source }, { onSuccess: (c) => onDone?.(c) });
    }
  };

  const dialog = layout === "dialog";

  const names = (
    <div className="grid grid-cols-2 gap-3">
      <Field label="First name" error={form.formState.errors.firstName?.message}>
        <Input className="h-9" {...form.register("firstName")} />
      </Field>
      <Field label="Last name" error={form.formState.errors.lastName?.message}>
        <Input className="h-9" {...form.register("lastName")} />
      </Field>
    </div>
  );

  const phones = (
    <>
      <RepeatableInputs form={form} name="phones" extensionName="phoneExts" label="Phones" placeholder="(404) 555-1234" icon={Phone} markPrimary variant="phone" />
      {duplicate ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 size-4 flex-none" />
          <span>
            A contact with this phone already exists —{" "}
            <Link href={`/contacts/${duplicate.id}`} className="font-medium underline" onClick={() => onCancel?.()}>
              {duplicate.firstName} {duplicate.lastName}
            </Link>
            . Open it instead?
          </span>
        </div>
      ) : null}
    </>
  );

  const emails = <RepeatableInputs form={form} name="emails" label="Emails" placeholder="name@example.com" icon={Mail} />;

  const companyAndType = (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Company</Label>
        <Controller
          control={form.control}
          name="companyId"
          render={({ field }) => {
            const selected = field.value ? companies.find((c) => c.id === field.value) : undefined;
            return (
              <>
                {selected ? (
                  <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                    <Building2 className="size-4 flex-none text-brand" />
                    <span className="flex-1 truncate">{selected.title}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => field.onChange("")}
                    >
                      Detach
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full justify-start gap-2 font-normal text-muted-foreground"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Link2 className="size-4" /> Attach to a company
                  </Button>
                )}
                <CompanyPickerDialog
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  companies={companies}
                  onSelect={(id) => {
                    field.onChange(id);
                    setPickerOpen(false);
                  }}
                />
              </>
            );
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Type</Label>
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(ContactType).map((t) => (
                  <SelectItem key={t} value={t}>{contactTypeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
    </div>
  );

  const titleAndSource = (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Title" error={form.formState.errors.title?.message}>
        <Input className="h-9" placeholder="e.g. Facilities Manager" {...form.register("title")} />
      </Field>
      <div className="space-y-1.5">
        <Label>Source {isEdit ? <span className="text-xs text-muted-foreground">· set once</span> : null}</Label>
        <Controller
          control={form.control}
          name="source"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(ContactSource).map((s) => (
                  <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
    </div>
  );

  const tax = (
    <div className="space-y-3 rounded-md border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="contact-tax-exempt" className="flex flex-col items-start gap-0.5">
          <span>Tax exempt</span>
          <span className="text-xs font-normal text-muted-foreground">
            New jobs and estimates for this client carry no tax.
          </span>
        </Label>
        <Controller
          control={form.control}
          name="taxExempt"
          render={({ field }) => (
            <Switch id="contact-tax-exempt" checked={!!field.value} onCheckedChange={field.onChange} />
          )}
        />
      </div>
      {taxExempt ? (
        <Field label="Exemption reason" error={form.formState.errors.taxExemptReason?.message}>
          <Input
            className="h-9"
            list="tax-exempt-reasons"
            placeholder="e.g. Non-profit"
            aria-label="Exemption reason"
            {...form.register("taxExemptReason")}
          />
          <datalist id="tax-exempt-reasons">
            {TAX_EXEMPT_REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
      ) : null}
    </div>
  );

  const notes = (
    <div className="space-y-1.5">
      <Label>{dialog ? "Description" : "Notes"}</Label>
      <Textarea rows={3} placeholder={dialog ? "Add the most important information about your client that will be displayed on the page" : undefined} {...form.register("notes")} />
    </div>
  );

  const actions = (
    <div className={dialog ? "flex justify-center gap-2 pt-1 md:col-span-2" : "flex justify-end gap-2 pt-1"}>
      {onCancel ? (
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      ) : null}
      <Button type="submit" variant="brand" className="gap-1.5" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {dialog ? "Save" : isEdit ? "Save changes" : "Create contact"}
      </Button>
    </div>
  );

  if (dialog) {
    // Workiz's "Edit client info": details and how to reach them on the
    // left, payment and the rest on the right, the address list underneath.
    return (
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-x-8 gap-y-4 md:grid-cols-2" noValidate>
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Client details</h3>
          {names}
          {companyAndType}
          <h3 className="pt-2 text-sm font-semibold">Contact information</h3>
          {phones}
          {emails}
          <h3 className="pt-2 text-sm font-semibold">Description</h3>
          {notes}
        </div>
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Payment</h3>
          {tax}
          <h3 className="pt-2 text-sm font-semibold">Additional</h3>
          {titleAndSource}
        </div>
        <div className="md:col-span-2">
          <ContactAddressFields form={form} />
        </div>
        {actions}
      </form>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
      {names}
      {phones}
      {emails}
      <ContactAddressFields form={form} />
      {companyAndType}
      {titleAndSource}
      {tax}
      {notes}
      {actions}
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
