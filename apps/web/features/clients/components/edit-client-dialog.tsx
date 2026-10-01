"use client";

import type { Contact } from "@bitcrm/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactForm } from "./contact-form";

/**
 * Workiz's "Edit client info": the client's details in a popup over the card,
 * not a page of their own — the card stays where it was when the popup closes.
 */
export function EditClientDialog({
  contact,
  open,
  onOpenChange,
  onDelete,
}: {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The popup's "Delete client" (needs `contacts.delete`). */
  onDelete?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto px-6 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit client info</DialogTitle>
          <DialogDescription className="sr-only">
            {contact.firstName} {contact.lastName}
          </DialogDescription>
        </DialogHeader>
        {open ? <ContactForm contact={contact} layout="dialog" onCancel={() => onOpenChange(false)} onDone={() => onOpenChange(false)} onDelete={onDelete} /> : null}
      </DialogContent>
    </Dialog>
  );
}
