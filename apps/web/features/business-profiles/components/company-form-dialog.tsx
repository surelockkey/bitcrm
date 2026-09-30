"use client";

import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { PaymentTerms, type BusinessProfileView } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { useCreateBusinessProfile, useUpdateBusinessProfile } from "../hooks";
import {
  DUE_DATE_BASES,
  DUE_DATE_BASIS_LABELS,
  PAYMENT_TERMS_OPTIONS,
  companyFormSchema,
  companyToForm,
  formToCompanyBody,
  type CompanyFormValues,
} from "../schemas";
import { CompanyLogoField } from "./company-logo-field";

interface Props {
  /** Undefined → create. */
  company?: BusinessProfileView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

export function CompanyFormDialog({ company, open, onOpenChange, canEdit }: Props) {
  const title = company ? (canEdit ? `Edit ${company.name}` : company.name) : "Add company";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            How this company appears on jobs, invoices, estimates and the client portal.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by id: the form seeds once per company and is never reset by a
            background refetch (which would wipe an unsaved logo upload). */}
        {open ? (
          <CompanyForm
            key={company?.id ?? "new"}
            company={company}
            canEdit={canEdit}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="space-y-4 rounded-lg border p-4">{children}</div>
    </section>
  );
}

type TextKey = "name" | "legalName" | "phone" | "email" | "website" | "licenseNumber";

function CompanyForm({
  company,
  canEdit,
  onDone,
}: {
  company?: BusinessProfileView;
  canEdit: boolean;
  onDone: () => void;
}) {
  const create = useCreateBusinessProfile();
  const update = useUpdateBusinessProfile();
  const saving = create.isPending || update.isPending;
  const [uploading, setUploading] = useState(false);

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: companyToForm(company),
    disabled: !canEdit,
  });

  const logoAssetId = useWatch({ control: form.control, name: "logoAssetId" });
  const terms = useWatch({ control: form.control, name: "defaultPaymentTerms" });
  const active = useWatch({ control: form.control, name: "active" });

  const onSubmit = form.handleSubmit((values) => {
    const done = (c: BusinessProfileView) => {
      form.reset(companyToForm(c));
      onDone();
    };
    if (company) {
      update.mutate({ id: company.id, body: formToCompanyBody(values, "update") }, { onSuccess: done });
    } else {
      create.mutate(formToCompanyBody(values, "create"), { onSuccess: done });
    }
  });

  const textField = (name: TextKey, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input className="h-9" {...props} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <Section title="Company">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <CompanyLogoField
                value={logoAssetId}
                onChange={(id) => form.setValue("logoAssetId", id, { shouldDirty: true })}
                // The live list keeps these fresh (presigned URLs expire)
                // without touching the form's values.
                savedAssetId={company?.logoAssetId}
                savedUrl={company?.logoUrl}
                disabled={!canEdit}
                onBusyChange={setUploading}
              />
              <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
                {textField("name", "Company name", { placeholder: "SureLock Key" })}
                {textField("legalName", "Legal name")}
                {textField("phone", "Phone", { type: "tel", placeholder: "(860) 555-0142" })}
                {textField("email", "Email", { type: "email", placeholder: "office@example.com" })}
                {textField("website", "Website", { placeholder: "www.example.com" })}
                {textField("licenseNumber", "License #")}
              </div>
            </div>
          </Section>

          <Section title="Address">
            <FormField
              control={form.control}
              name="address.street"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Street</FormLabel>
                  {canEdit ? (
                    <AddressAutocomplete
                      value={field.value}
                      onChange={(v) => form.setValue("address.street", v, { shouldDirty: true })}
                      onSelect={(a) => {
                        const opts = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
                        form.setValue("address.street", a.street, opts);
                        form.setValue("address.city", a.city, opts);
                        form.setValue("address.state", a.state, opts);
                        form.setValue("address.zip", a.zip, opts);
                        form.setValue("address.lat", a.lat, opts);
                        form.setValue("address.lng", a.lng, opts);
                      }}
                      placeholder="Start typing an address…"
                    />
                  ) : (
                    <FormControl>
                      <Input className="h-9" {...field} />
                    </FormControl>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              {(
                [
                  ["address.unit", "Unit", "sm:col-span-1"],
                  ["address.city", "City", "sm:col-span-2"],
                  ["address.state", "State", "sm:col-span-1"],
                  ["address.zip", "ZIP", "sm:col-span-2"],
                ] as const
              ).map(([name, label, span]) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem className={span}>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input className="h-9" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </Section>

          <Section title="Invoice defaults" hint="Used for this company's new invoices when the client has no payment terms of their own.">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="defaultPaymentTerms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment terms</FormLabel>
                    <Select value={field.value} onValueChange={(v) => v && field.onChange(v)} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_TERMS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {terms === PaymentTerms.CUSTOM ? (
                <FormField
                  control={form.control}
                  name="defaultCustomTermDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Days until due</FormLabel>
                      <FormControl>
                        <Input className="h-9" type="number" inputMode="numeric" min={1} max={365} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <FormField
                control={form.control}
                name="dueDateBasis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Count due date from</FormLabel>
                    <Select value={field.value} onValueChange={(v) => v && field.onChange(v)} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DUE_DATE_BASES.map((b) => (
                          <SelectItem key={b} value={b}>
                            {DUE_DATE_BASIS_LABELS[b]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Section>

          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                <div>
                  <FormLabel>Active</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    {company?.isDefault
                      ? "The default company is always active."
                      : active
                        ? "Can be picked for new jobs."
                        : "Archived — hidden from pickers; existing jobs keep it."}
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!canEdit || company?.isDefault}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <DialogFooter className="mx-0 mb-0 items-center rounded-none border-t px-6 py-3 sm:items-center">
          {canEdit ? (
            <>
              <Button type="button" variant="outline" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" className="gap-1.5" disabled={saving || uploading}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                {company ? "Save company" : "Add company"}
              </Button>
            </>
          ) : (
            <>
              <p className="mr-auto text-xs text-muted-foreground">Editing needs the &quot;settings · edit&quot; permission.</p>
              <Button type="button" variant="outline" onClick={onDone}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </Form>
  );
}
