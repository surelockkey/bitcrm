"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { ContactForm } from "@/features/clients/components/contact-form";
import { formatEndpoint } from "../lib";

/**
 * Turn an unrecognised caller into a client without leaving the call log —
 * the number is prefilled, so the only work left is who they are.
 *
 * On success the calls queries are invalidated: the backend resolves names
 * from the CRM at read time, so a refetch is what makes the new client's name
 * appear on this call and every other one they're on.
 */
export function NewClientFromCallDialog({
  phone,
  onClose,
}: {
  /** The number to prefill; null keeps the dialog closed. */
  phone: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  return (
    <Dialog open={!!phone} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>
            From the call with {phone ? formatEndpoint(phone) : ""}.
          </DialogDescription>
        </DialogHeader>
        {phone ? (
          <ContactForm
            key={phone}
            defaultPhone={phone}
            onCancel={onClose}
            onDone={() => {
              qc.invalidateQueries({ queryKey: queryKeys.calls.all() });
              onClose();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
