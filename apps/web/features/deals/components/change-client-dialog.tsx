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
import type { Address } from "@bitcrm/types";
import { formatAddress } from "@/features/clients/lib";

/** What to do with an address the client doesn't have on file. */
export type AddressChoice = "save" | "job-only";

export interface ClientSaveDecision {
  /** true → the rename updates the contact record; false → it stays on this job only. */
  applyToClient: boolean;
  address: AddressChoice;
}

/**
 * Asked once, on Save. A rename on the job either follows the client
 * everywhere ("Yes, make change") or stays a per-job label ("Just here") —
 * the client record is never forked into a new contact from here. The
 * address question appears only when the job's address isn't on the client.
 */
export function ChangeClientDialog({
  open,
  nameChanged,
  newAddress,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  nameChanged: boolean;
  /** Set when the job's address isn't already on the client. */
  newAddress?: Address;
  pending?: boolean;
  onConfirm: (decision: ClientSaveDecision) => void;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState<AddressChoice>("save");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {nameChanged ? "Change client" : "Before saving the job"}
          </DialogTitle>
          <DialogDescription>
            {nameChanged
              ? "Do you want these changes to also be applied to the client?"
              : "This job has an address the client doesn't have on file."}
          </DialogDescription>
        </DialogHeader>

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

        <div className="flex justify-end gap-2 border-t pt-3">
          {nameChanged ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => onConfirm({ applyToClient: false, address })}
              >
                Just here
              </Button>
              <Button
                variant="brand"
                size="sm"
                className="gap-1.5"
                disabled={pending}
                onClick={() => onConfirm({ applyToClient: true, address })}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Yes, make change
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
                Back
              </Button>
              <Button
                variant="brand"
                size="sm"
                className="gap-1.5"
                disabled={pending}
                onClick={() => onConfirm({ applyToClient: true, address })}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Save job
              </Button>
            </>
          )}
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
