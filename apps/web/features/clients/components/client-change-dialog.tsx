"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
 * Only the questions that actually apply are shown.
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
            <legend className="mb-1 text-sm font-medium">
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
            <legend className="mb-1 text-sm font-medium">
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

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Past calls keep whoever they were with.
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={onCancel}
            >
              Back
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="gap-1.5"
              disabled={pending}
              onClick={() => onConfirm({ client, address })}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save job
            </Button>
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
          ? "flex cursor-pointer gap-3 rounded-lg border border-brand bg-brand/5 p-3"
          : "flex cursor-pointer gap-3 rounded-lg border p-3 hover:bg-accent"
      }
    >
      <input
        type="radio"
        className="mt-1 accent-current"
        checked={checked}
        onChange={onSelect}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
