"use client";

import { useState, type FormEvent } from "react";
import { Hash } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzSettingsHeader } from "@/components/workiz/settings-page";
import { WzTextField } from "@/components/workiz/text-field";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { useNumbering, useUpdateNumbering } from "../hooks";
import {
  fieldOfRefusal,
  numberingFormSchema,
  numberingToForm,
  toNumberingBody,
  type NumberingField,
  type NumberingFormValues,
} from "../schemas";

type Errors = Partial<Record<NumberingField, string>>;

/** Workiz's legacy h5 over each control: 14px/16px 600 ink (settings_audit_wz_mailchimp, metroareas_add_open). */
const H5 = "mb-2.5 text-sm leading-4 font-semibold tracking-[0.4px] text-foreground";

/**
 * Settings → Numbering, Workiz's `/root/numbering` (legacy page; its DOM in
 * `settings_audit_wz_numbering_v3.html`): the band, then one half-width
 * column — "Job Ids" (coded, as the account's: XH5F7A, never serial),
 * "Next Invoice Id" and "Next Estimate Id" in floating-label boxes, Workiz's
 * note that numbers must be more than the last one, and Save. "Next Lead
 * Id" is left out: there is no Leads module.
 *
 * The numbers are the NEXT a client (no-job) invoice / estimate will get;
 * a job's documents keep the job's number. The server knows the last number
 * handed out and refuses anything at or below it, naming the box.
 */
export function NumberingSettingsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canRead = can("settings");
  const canEdit = can("settings", "edit");
  const { data: settings, isLoading } = useNumbering(canRead);
  const save = useUpdateNumbering();

  // The boxes are the server's numbers with the user's typing laid over
  // them — a refetch never clobbers a draft.
  const [draft, setDraft] = useState<Partial<NumberingFormValues>>({});
  const [errors, setErrors] = useState<Errors>({});
  const form: NumberingFormValues = { ...numberingToForm(settings), ...draft };

  const set = (key: NumberingField, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = numberingFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as NumberingField;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(toNumberingBody(parsed.data), {
      onSuccess: () => setDraft({}),
      onError: (err) => {
        const message = getApiErrorMessage(err, "Couldn't save the numbering");
        const field = fieldOfRefusal(message);
        if (field) setErrors({ [field]: message });
        else toast.error(message);
      },
    });
  };

  const header = (
    <WzSettingsHeader icon={<Hash />} title="Numbering" description="Set the serial numbers for your next invoice/estimate." />
  );

  // A refusal only once the answer is in — before it, `can` says no to all,
  // and the numbers are not asked for yet: one skeleton covers both.
  if (denied("settings")) return <NoAccess what="settings" />;
  if (permsLoading || isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="px-10 pt-[30px]">
          <Skeleton className="h-96 w-[660px] max-w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {header}
      <form noValidate onSubmit={submit} className="flex w-[660px] max-w-full flex-col gap-5 px-10 pt-[30px] pb-10">
        <section>
          <h5 className={H5}>Job Ids</h5>
          {/* Workiz offers a select (Use Coded / serial); ours are always coded, so the choice is shown, not offered. */}
          <p className="text-base leading-4 text-wz-text">Use Coded</p>
          <p className="mt-2.5 text-sm leading-[21px] tracking-[0.4px] text-foreground">
            Job ids will be coded and not serial
            <br />
            <small className="text-[11px] leading-[13px] text-wz-caption">Example: XH5F7A</small>
          </p>
        </section>

        <section>
          <h5 className={H5}>Next Invoice Id</h5>
          <WzTextField
            label="Next Invoice Id"
            inputMode="numeric"
            autoComplete="off"
            overhang={false}
            value={form.nextInvoiceNumber}
            error={errors.nextInvoiceNumber}
            onChange={(e) => set("nextInvoiceNumber", e.target.value)}
            disabled={!canEdit}
          />
        </section>

        <section>
          <h5 className={H5}>Next Estimate Id</h5>
          <WzTextField
            label="Next Estimate Id"
            inputMode="numeric"
            autoComplete="off"
            overhang={false}
            value={form.nextEstimateNumber}
            error={errors.nextEstimateNumber}
            onChange={(e) => set("nextEstimateNumber", e.target.value)}
            disabled={!canEdit}
          />
        </section>

        <small className="text-[11px] leading-[13px] text-wz-caption">
          *Invoice/ Estimate numbers must be more than the last number
        </small>

        {canEdit ? (
          <div>
            <WzButton type="submit" size="regular" className="min-w-[81px]" loading={save.isPending}>
              Save
            </WzButton>
          </div>
        ) : (
          <p className="text-xs leading-[18px] text-wz-outline-label">Editing needs the &quot;settings · edit&quot; permission.</p>
        )}
      </form>
    </div>
  );
}
