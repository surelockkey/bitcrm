"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz";
import type { Address, Contact } from "@bitcrm/types";
import { contactName, formatAddress, formatPhone } from "../lib";

export interface ClientEdits {
  firstName: string;
  lastName: string;
  phone: string;
}

/** What to do with the edited details. */
export type ClientChoice = "update" | "create";
/** What to do with an address the client doesn't have on file. */
export type AddressChoice = "save" | "job-only";

export interface ClientSaveDecision {
  client: ClientChoice;
  address: AddressChoice;
}

/**
 * Asked once, when the job is saved — not while typing.
 *
 * Two questions the system genuinely can't answer. Whether edited details are
 * a correction to this client or a different person now on their number: both
 * are common, and guessing wrong either renames somebody who did nothing or
 * fills the CRM with duplicates. And whether a new address belongs on their
 * record or only on this job: a second property is worth keeping, a one-off
 * site visit isn't.
 *
 * Only the questions that actually apply are shown. It is asked from the
 * Workiz-style New Job page, so its choices and buttons are Workiz's: #ccc
 * boxes, the yellow focus edge on the chosen one, the outline and yellow
 * pills.
 */
export function ClientSaveDialog({
  open,
  original,
  edits,
  clientChanged,
  newAddress,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  original: Contact;
  edits: ClientEdits;
  clientChanged: boolean;
  /** Set when the job's address isn't already on the client. */
  newAddress?: Address;
  pending?: boolean;
  onConfirm: (decision: ClientSaveDecision) => void;
  onCancel: () => void;
}) {
  const [client, setClient] = useState<ClientChoice>("update");
  const [address, setAddress] = useState<AddressChoice>("save");

  const numberMoves =
    !!edits.phone && !original.phones.includes(edits.phone);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Before saving the job</DialogTitle>
          <DialogDescription>
            {clientChanged
              ? `You changed ${contactName(original)}'s details.`
              : "This job has an address the client doesn't have on file."}
          </DialogDescription>
        </DialogHeader>

        {clientChanged ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[14px] leading-4 font-medium text-wz-strong">
              {contactName(original)} → {edits.firstName} {edits.lastName}
              {edits.phone ? ` · ${formatPhone(edits.phone)}` : ""}
            </legend>
            <Choice
              checked={client === "update"}
              onSelect={() => setClient("update")}
              title="Same client, corrected"
              detail={`Updates ${contactName(original)} everywhere they appear.`}
            />
            <Choice
              checked={client === "create"}
              onSelect={() => setClient("create")}
              title="A different client"
              detail={
                numberMoves
                  ? "Creates a separate client; this job goes to them."
                  : `Creates a separate client, and ${formatPhone(
                      original.phones[0] ?? "",
                    )} moves to them — future calls from it resolve to the new client.`
              }
            />
          </fieldset>
        ) : null}

        {newAddress ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[14px] leading-4 font-medium text-wz-strong">
              {formatAddress(newAddress)}
            </legend>
            <Choice
              checked={address === "save"}
              onSelect={() => setAddress("save")}
              title="Keep it on the client"
              detail="Offered next time you book them."
            />
            <Choice
              checked={address === "job-only"}
              onSelect={() => setAddress("job-only")}
              title="This job only"
              detail="Their record is left alone."
            />
          </fieldset>
        ) : null}

        <div className="flex items-center justify-between border-t border-wz-rule pt-3">
          <span className="text-[12px] leading-4 text-wz-label">
            Past calls keep whoever they were with.
          </span>
          <div className="flex gap-2">
            <WzButton variant="secondary" size="regular" disabled={pending} onClick={onCancel}>
              Back
            </WzButton>
            <WzButton size="regular" loading={pending} onClick={() => onConfirm({ client, address })}>
              Save job
            </WzButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={
        checked
          ? "flex cursor-pointer gap-3 rounded-[4px] border border-wz-focus bg-white p-3"
          : "flex cursor-pointer gap-3 rounded-[4px] border border-input bg-white p-3 hover:border-wz-field-hover"
      }
    >
      <input
        type="radio"
        className="mt-1 accent-current"
        checked={checked}
        onChange={onSelect}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] leading-4 font-medium text-wz-strong">{title}</span>
        <span className="text-[12px] leading-4 text-wz-label">{detail}</span>
      </span>
    </label>
  );
}
