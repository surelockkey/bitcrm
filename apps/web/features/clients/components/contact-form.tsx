"use client";

import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Building2, Link2, Loader2, Mail, Phone, Trash2, TriangleAlert } from "lucide-react";
import { ContactSource, ContactType } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/utils";
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
  onDelete,
  layout = "page",
}: {
  contact?: Contact;
  defaultCompanyId?: string;
  /** The popup's red "Delete client" at the bottom of the right column. */
  onDelete?: () => void;
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
  const watchedPhones = useWatch({ control: form.control, name: "phones" });
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
    // Workiz's "Edit client info", field for field: outlined inputs with the
    // label on the border, Client details / Contact information / Description
    // on the left, Payment / Additional on the right, Save in the middle.
    const phoneAt = (i: number) => watchedPhones?.[i] ?? "";
    const setPhone = (i: number, v: string) => {
      const list = [...form.getValues("phones")];
      const exts = [...form.getValues("phoneExts")];
      if (i === 1 && !v.trim()) {
        // An emptied secondary number is no number, not an invalid one.
        form.setValue("phones", list.slice(0, 1), { shouldValidate: true });
        form.setValue("phoneExts", exts.slice(0, 1));
        return;
      }
      list[i] = v;
      if (exts.length <= i) exts[i] = "";
      form.setValue("phones", list, { shouldValidate: true });
      form.setValue("phoneExts", exts);
    };
    const phoneErr = form.formState.errors.phones;
    return (
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-x-8 gap-y-6 pt-2 md:grid-cols-2" noValidate>
        <div className="space-y-6">
          <section className="space-y-5">
            <h3 className="text-sm font-semibold">Client details</h3>
            <div className="grid grid-cols-2 gap-4">
              <Outlined label="First Name" htmlFor="ec-first" error={form.formState.errors.firstName?.message}>
                <Input id="ec-first" className="h-11" {...form.register("firstName")} />
              </Outlined>
              <Outlined label="Last Name" htmlFor="ec-last" error={form.formState.errors.lastName?.message}>
                <Input id="ec-last" className="h-11" {...form.register("lastName")} />
              </Outlined>
            </div>
            <Outlined label="Company name">
              <Controller
                control={form.control}
                name="companyId"
                render={({ field }) => {
                  const selected = field.value ? companies.find((c) => c.id === field.value) : undefined;
                  return (
                    <>
                      <div className="flex h-11 items-center gap-2 rounded-md border px-3 text-sm">
                        <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>{selected?.title ?? "No company"}</span>
                        {selected ? (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => field.onChange("")}>
                            Detach
                          </Button>
                        ) : null}
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-brand" onClick={() => setPickerOpen(true)}>
                          {selected ? "Change" : "Attach"}
                        </Button>
                      </div>
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
            </Outlined>
          </section>

          <section className="space-y-5">
            <h3 className="text-sm font-semibold">Contact information</h3>
            <div className="grid grid-cols-[1fr_7rem] gap-4">
              <Outlined label="Phone number" htmlFor="ec-phone-0" error={phoneErr?.[0]?.message ?? (typeof phoneErr?.message === "string" ? phoneErr.message : undefined)}>
                <PhoneInput id="ec-phone-0" className="h-11" value={phoneAt(0)} onChange={(v) => setPhone(0, v)} />
              </Outlined>
              <Outlined label="ext." htmlFor="ec-ext-0">
                <Input id="ec-ext-0" className="h-11" {...form.register("phoneExts.0")} />
              </Outlined>
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-4">
              <Outlined label="Secondary phone" htmlFor="ec-phone-1" error={phoneErr?.[1]?.message}>
                <PhoneInput id="ec-phone-1" className="h-11" value={phoneAt(1)} onChange={(v) => setPhone(1, v)} />
              </Outlined>
              <Outlined label="ext." htmlFor="ec-ext-1">
                <Input id="ec-ext-1" className="h-11" {...form.register("phoneExts.1")} />
              </Outlined>
            </div>
            <Outlined label="Email" htmlFor="ec-email" error={form.formState.errors.emails?.[0]?.message}>
              <Input id="ec-email" className="h-11" type="email" {...form.register("emails.0")} />
            </Outlined>
            {duplicate ? (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                A contact with this phone already exists —{" "}
                <Link href={`/contacts/${duplicate.id}`} className="font-medium underline" onClick={() => onCancel?.()}>
                  {duplicate.firstName} {duplicate.lastName}
                </Link>
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Description</h3>
            <Textarea
              rows={4}
              aria-label="Description"
              placeholder="Add the most important information about your client that will be displayed on the page"
              {...form.register("notes")}
            />
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-5">
            <h3 className="text-sm font-semibold">Payment</h3>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="contact-tax-exempt">Tax exempt</Label>
              <Controller
                control={form.control}
                name="taxExempt"
                render={({ field }) => <Switch id="contact-tax-exempt" checked={!!field.value} onCheckedChange={field.onChange} />}
              />
            </div>
            {taxExempt ? (
              <Outlined label="Tax exempt reason" error={form.formState.errors.taxExemptReason?.message}>
                <Controller
                  control={form.control}
                  name="taxExemptReason"
                  render={({ field }) => (
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <SelectTrigger className="h-11 w-full" aria-label="Tax exempt reason"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                      <SelectContent>
                        {TAX_EXEMPT_REASONS.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Outlined>
            ) : null}
          </section>

          <section className="space-y-5">
            <h3 className="text-sm font-semibold">Additional</h3>
            <Outlined label="Ad source">
              <Controller
                control={form.control}
                name="source"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                    <SelectTrigger className="h-11 w-full" aria-label="Ad source"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(ContactSource).map((x) => (
                        <SelectItem key={x} value={x}>{sourceLabel(x)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Outlined>
            <Outlined label="Type">
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full" aria-label="Type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(ContactType).map((t) => (
                        <SelectItem key={t} value={t}>{contactTypeLabel(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Outlined>
            <Outlined label="Title" htmlFor="ec-title" error={form.formState.errors.title?.message}>
              <Input id="ec-title" className="h-11" {...form.register("title")} />
            </Outlined>
            {onDelete ? (
              <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 text-sm text-destructive hover:underline">
                <Trash2 className="size-4" /> Delete client
              </button>
            ) : null}
          </section>
        </div>

        <div className="flex justify-center md:col-span-2">
          <Button type="submit" className="min-w-24" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </div>
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

/** Workiz's outlined field: the label sits on the top border. */
function Outlined({ label, htmlFor, error, children, className }: { label: string; htmlFor?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="relative">
        <label htmlFor={htmlFor} className="absolute -top-2 left-2.5 z-10 bg-background px-1 text-[11px] leading-4 text-muted-foreground">
          {label}
        </label>
        {children}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
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
