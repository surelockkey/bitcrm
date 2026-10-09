"use client";

import { useMemo, useState } from "react";
import type { ExternalCompany } from "@bitcrm/types";
import { PhoneInput } from "@/components/ui/phone-input";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzTextField } from "@/components/workiz/text-field";
import { useCreateExternalCompany, useUpdateExternalCompany } from "../hooks";
import { externalCompanyFormSchema, toExternalCompanyBody } from "../schemas";

/**
 * Add / edit an external company in Workiz's settings modal (the Job Types
 * one, pg_settings_catalogs_wz_jobtypes_add_open): the company's name,
 * email, phone and address in floating-label boxes, Cancel / Save. Only the
 * name is required. Enabled / disabled is the grid's "Disable/Enable"; an
 * edit keeps the state.
 */
export function ExternalCompanyFormDialog({
  company,
  open,
  onOpenChange,
}: {
  company?: ExternalCompany;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(company);
  const create = useCreateExternalCompany();
  const update = useUpdateExternalCompany(company?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(company?.name ?? "");
  const [email, setEmail] = useState(company?.email ?? "");
  const [address, setAddress] = useState(company?.address ?? "");
  const [phone, setPhone] = useState(company?.phone ?? "");
  const active = company?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => externalCompanyFormSchema.safeParse({ name, email, address, phone, active }),
    [name, email, address, phone, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toExternalCompanyBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${company!.name}` : "Add New Company"}
      onSave={submit}
      saving={pending}
      error={error}
    >
      <WzTextField label="Company Name" value={name} onChange={(e) => setName(e.target.value)} overhang={false} />
      <WzTextField
        label="Company Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        overhang={false}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ec-phone" className="text-xs leading-4 font-bold text-wz-text">
          Company Phone
        </label>
        <PhoneInput id="ec-phone" value={phone} onChange={setPhone} />
      </div>
      <WzTextField label="Company Address" value={address} onChange={(e) => setAddress(e.target.value)} overhang={false} />
    </WzFormModal>
  );
}
