"use client";

import { useState } from "react";
import type { ClientPhoneScope } from "@bitcrm/types";
import { WzFormModal } from "@/components/workiz/form-modal";
import { cn } from "@/lib/utils";

/**
 * "Apply these changes to…" — asked on Save when the job's first number was
 * changed (the owner's design, 2026-10-12): the kit's 500px modal, three
 * cards (8px corners, #ddd; the picked one on the link-blue edge over the
 * secondary grey), Cancel and the yellow "Save changes". Starts on the
 * profile, the usual answer: a corrected number.
 */
export function ApplyPhoneChangeDialog({
  open,
  jobNumber,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** The job's number, as its header shows it ("LSBE12"). */
  jobNumber: string;
  pending?: boolean;
  onConfirm: (scope: ClientPhoneScope) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<ClientPhoneScope>("client");
  const choices: { value: ClientPhoneScope; title: string; detail: string }[] = [
    { value: "job", title: "This job only", detail: `Job #${jobNumber}. The client profile keeps its current details.` },
    {
      value: "client",
      title: "This job and the client profile",
      detail: "Future jobs use the new details. Existing jobs are untouched.",
    },
    {
      value: "open_jobs",
      title: "This job, the profile, and open jobs",
      detail: "Open and unpaid jobs only. Paid and closed jobs never change.",
    },
  ];

  return (
    <WzFormModal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title="Apply these changes to…"
      description="You changed this client's phone number."
      saveLabel="Save changes"
      saving={pending}
      onSave={() => onConfirm(scope)}
      footerClassName="pt-8"
    >
      <div role="radiogroup" aria-label="Apply these changes to" className="-mt-2 flex flex-col gap-3">
        {choices.map((c) => (
          <label
            key={c.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-[8px] border p-4 transition-colors",
              scope === c.value
                ? "border-wz-link bg-wz-secondary-hover"
                : "border-wz-frame bg-background hover:border-wz-field-hover",
            )}
          >
            <input
              type="radio"
              name="phone-change-scope"
              value={c.value}
              checked={scope === c.value}
              onChange={() => setScope(c.value)}
              className="mt-[3px] size-[18px] shrink-0 accent-wz-link"
            />
            <span className="flex flex-col gap-1">
              <span className="text-[16px] leading-6 font-semibold text-wz-strong">{c.title}</span>
              <span className="text-[14px] leading-[21px] text-wz-outline-label">{c.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </WzFormModal>
  );
}
