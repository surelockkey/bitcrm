"use client";

import { useId, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PaymentTerms, type BusinessProfileView } from "@bitcrm/types";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzFieldError } from "@/components/workiz/messages";
import { NotchedLabel } from "@/components/workiz/outlined";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzAccountTitle, WzAccountToggle } from "@/components/workiz/settings-form";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { cn } from "@/lib/utils";
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

/**
 * A company, as Workiz's Account page draws the account
 * (pg_settings_general_wz_account): the whole-window form, a 652px column of
 * outlined boxes 24px apart — name, description, address, website, email,
 * phone — with the logo 48px to its right; then "Company Preferences" (Workiz:
 * "Account Preferences") with Default Payment Terms, Calculate due date from
 * and the Active toggle row. Legal name, license and the booking link are
 * ours, in the same boxes.
 */
export function CompanyFormDialog({ company, open, onOpenChange, canEdit }: Props) {
  // Keyed by id: the form seeds once per company and is never reset by a
  // background refetch (which would wipe an unsaved logo upload).
  return open ? (
    <CompanyForm key={company?.id ?? "new"} company={company} canEdit={canEdit} onOpenChange={onOpenChange} />
  ) : null;
}

/** The 12px ink line under a box ("The "from" header on your sent emails"). */
function Helper({ id, children }: { id: string; children: ReactNode }) {
  return (
    <small id={id} className="-mt-6 block pl-[12.5px] text-xs leading-[18px] tracking-[0.4px] text-foreground">
      {children}
    </small>
  );
}

function CompanyForm({
  company,
  canEdit,
  onOpenChange,
}: {
  company?: BusinessProfileView;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateBusinessProfile();
  const update = useUpdateBusinessProfile();
  const saving = create.isPending || update.isPending;
  const [uploading, setUploading] = useState(false);
  const ids = { street: useId(), description: useId(), booking: useId() };

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: companyToForm(company),
    disabled: !canEdit,
  });
  const { register, control } = form;
  const errors = form.formState.errors;

  const logoAssetId = useWatch({ control, name: "logoAssetId" });
  const terms = useWatch({ control, name: "defaultPaymentTerms" });
  const active = useWatch({ control, name: "active" });
  const street = useWatch({ control, name: "address.street" });

  const onSave = form.handleSubmit((values) => {
    const done = (c: BusinessProfileView) => {
      form.reset(companyToForm(c));
      onOpenChange(false);
    };
    if (company) {
      update.mutate({ id: company.id, body: formToCompanyBody(values, "update") }, { onSuccess: done });
    } else {
      create.mutate(formToCompanyBody(values, "create"), { onSuccess: done });
    }
  });

  const text = (
    name: "name" | "legalName" | "phone" | "email" | "website" | "licenseNumber" | "description" | "bookingUrl",
    label: string,
    props: React.ComponentProps<typeof WzOutlinedTextField> = {},
  ) => <WzOutlinedTextField label={label} error={errors[name]?.message} {...props} {...register(name)} />;

  const addressError = (key: "street" | "unit" | "city" | "state" | "zip") => errors.address?.[key]?.message;

  return (
    <WzFormModal
      open
      onOpenChange={onOpenChange}
      variant="full"
      title={company ? company.name : "Add New Company"}
      onSave={() => void onSave()}
      saving={saving}
      saveDisabled={uploading}
      readOnly={!canEdit}
      aside={
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
      }
    >
      <div className="flex w-[652px] max-w-full flex-col gap-6 pt-2">
        {text("name", "Company Name")}
        {text("description", "Company Description", { "aria-describedby": ids.description })}
        <Helper id={ids.description}>The header your clients see when they open an estimate or invoice.</Helper>
        {text("legalName", "Legal Name")}

        <div className="relative">
          {canEdit ? (
            <AddressAutocomplete
              id={ids.street}
              value={street}
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
              placeholder=" "
              // The outlined box of the fields round it (Input-module, 40px #9ea6aa).
              className="h-10 rounded-[4px] border-wz-outline bg-white pl-8 text-[13px] tracking-[0.4px] hover:border-foreground focus-visible:border-wz-link md:text-[13px]"
            />
          ) : (
            <input
              id={ids.street}
              readOnly
              disabled
              value={street}
              className={cn(
                "block h-10 w-full rounded-[4px] border border-wz-outline-disabled bg-wz-disabled-fill px-3 text-[13px] text-wz-outline-label",
              )}
            />
          )}
          <NotchedLabel htmlFor={ids.street} floated>
            Business Address
          </NotchedLabel>
          {addressError("street") ? <WzFieldError>{addressError("street")}</WzFieldError> : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <WzOutlinedTextField label="City" error={addressError("city")} {...register("address.city")} />
          <WzOutlinedTextField label="Zip" error={addressError("zip")} {...register("address.zip")} />
          <WzOutlinedTextField label="Unit" error={addressError("unit")} {...register("address.unit")} />
          <WzOutlinedTextField label="State" error={addressError("state")} {...register("address.state")} />
        </div>

        {text("website", "Company Website")}
        {text("email", "Company Email", { type: "email" })}
        {text("phone", "Company Phone", { type: "tel" })}
        {text("licenseNumber", "License #")}
        {text("bookingUrl", "Book a Service Link", { type: "url", "aria-describedby": ids.booking })}
        <Helper id={ids.booking}>&quot;Book a service&quot; on the client portal, starting with https://</Helper>

        <WzAccountTitle className="mt-6">Company Preferences</WzAccountTitle>
        <Controller
          control={control}
          name="defaultPaymentTerms"
          render={({ field }) => (
            <WzOutlinedSelect
              label="Default Payment Terms"
              options={PAYMENT_TERMS_OPTIONS}
              value={field.value}
              onChange={(v) => v && field.onChange(v)}
              onBlur={field.onBlur}
              disabled={!canEdit}
            />
          )}
        />
        {terms === PaymentTerms.CUSTOM ? (
          <WzOutlinedTextField
            label="Days Until Due"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            error={errors.defaultCustomTermDays?.message}
            {...register("defaultCustomTermDays")}
          />
        ) : null}
        <Controller
          control={control}
          name="dueDateBasis"
          render={({ field }) => (
            <WzOutlinedSelect
              label="Calculate due date from"
              options={DUE_DATE_BASES.map((b) => ({ value: b, label: DUE_DATE_BASIS_LABELS[b] }))}
              value={field.value}
              onChange={(v) => v && field.onChange(v)}
              onBlur={field.onBlur}
              disabled={!canEdit}
            />
          )}
        />
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <WzAccountToggle
              label="Active"
              hint={
                company?.isDefault
                  ? "The default company is always active."
                  : active
                    ? "Can be picked for new jobs."
                    : "Archived — hidden from pickers; existing jobs keep it."
              }
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!canEdit || company?.isDefault}
            />
          )}
        />
        {!canEdit ? (
          <p className="text-xs leading-[18px] text-wz-outline-label">Editing needs the &quot;settings · edit&quot; permission.</p>
        ) : null}
      </div>
    </WzFormModal>
  );
}
