"use client";

import { Loader2, UserCog, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Contact } from "@bitcrm/types";
import { contactName, formatPhone } from "../lib";

export interface ClientEdits {
  firstName: string;
  lastName: string;
  phone: string;
}

/**
 * Asked when somebody edits the client's details on a job: is this the same
 * person with a correction, or a different person on the same number?
 *
 * Both happen. A typo in a name is a correction; a number that now belongs to
 * the new tenant is a different person. The system can't tell them apart, and
 * guessing wrong either renames a client who did nothing wrong or litters the
 * CRM with duplicates — so it asks.
 */
export function ClientChangeDialog({
  open,
  original,
  edits,
  pending,
  onUpdate,
  onCreate,
  onCancel,
}: {
  open: boolean;
  original: Contact;
  edits: ClientEdits;
  pending?: boolean;
  onUpdate: () => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const numberMoves =
    !!edits.phone && !original.phones.includes(edits.phone);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Same client, or a different one?</DialogTitle>
          <DialogDescription>
            You changed {contactName(original)} to {edits.firstName}{" "}
            {edits.lastName}
            {edits.phone ? ` · ${formatPhone(edits.phone)}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="h-auto justify-start gap-3 py-3 text-left"
            disabled={pending}
            onClick={onUpdate}
          >
            <UserCog className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Update this client</span>
              <span className="text-xs font-normal text-muted-foreground">
                Corrects {contactName(original)} everywhere they appear.
              </span>
            </span>
          </Button>

          <Button
            variant="outline"
            className="h-auto justify-start gap-3 py-3 text-left"
            disabled={pending}
            onClick={onCreate}
          >
            <UserPlus className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Create a new client</span>
              <span className="text-xs font-normal text-muted-foreground">
                {numberMoves
                  ? "A separate client; this job goes to them."
                  : `A separate client, and ${formatPhone(
                      original.phones[0] ?? "",
                    )} moves to them — future calls from it resolve to the new client.`}
              </span>
            </span>
          </Button>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Past calls keep whoever they were with.
          </span>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
