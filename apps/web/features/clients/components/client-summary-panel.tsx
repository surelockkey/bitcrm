"use client";

import Link from "next/link";
import { MapPin, MessageSquareText, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { Company, Contact } from "@bitcrm/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WzFold } from "@/components/workiz/record-parts";
import { cn } from "@/lib/utils";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { ClientTagsField } from "@/features/client-tags/components/client-tags-field";
import { PortalLinkCard } from "@/features/portal/components/portal-link-card";
import { wzPhone } from "../client-page";
import { contactName, extensionOf, formatAddress } from "../lib";

/** Workiz's 32px IconButton (medium/white): 8px corners, #f3f6f7 under the pointer. */
const ICON_BUTTON = "grid size-8 shrink-0 place-items-center rounded-[8px] outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Workiz's left column of the client page (`clientInfo`, pg_contact_wz_269669):
 * the name (20px/24px 600) with its company under it and the ⋮ menu (Edit
 * client info / Delete client); CONTACT — the phones as plain lines, a blue
 * call and a message button beside the primary one, the email; the tag chips
 * and "+ Add tag"; then the folds — Addresses (ONE service address and ONE
 * billing address; the rest live on the Addresses tab) and, ours, the client
 * portal.
 *
 * Workiz's AI insights, Additional contacts and Payment methods have nothing
 * behind them in BitCRM and are left out. A call button stays beside the
 * second number too (Workiz has none there): we can ring it, so we do.
 */
export function ClientSummaryPanel({
  contact,
  company,
  canEdit,
  canDelete,
  canCreateTags,
  showPortal,
  canMessage,
  onEdit,
  onDelete,
  onMessage,
  onEditAddress,
}: {
  contact: Contact;
  company?: Company;
  canEdit: boolean;
  canDelete: boolean;
  /** `client_tags.create`: the Add tag popup may make a new tag. */
  canCreateTags: boolean;
  showPortal: boolean;
  /** `messages.send`: the message button beside the phone opens the chat panel. */
  canMessage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMessage: () => void;
  /** The pencil on Service / Billing address: opens the Address panel on it. */
  onEditAddress: (which: "service" | "billing") => void;
}) {
  const service = contact.addresses[0];
  const billing = contact.billingAddress;
  const phones = contact.phones;

  return (
    <aside aria-label="Client" className="flex flex-col pb-6">
      <div className="flex min-h-8 items-center gap-2 pt-4 pr-[17px] pl-[19px]">
        <div className="min-w-0 flex-1">
          <h1 data-slot="client-name" className="text-[20px] leading-6 font-semibold tracking-[0.4px] break-words text-foreground">
            {contactName(contact)}
          </h1>
        </div>
        {canEdit || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Edit client" title="Edit client" className={cn(ICON_BUTTON, "text-foreground")}>
                <MoreVertical className="size-5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            {/* pg_contact_wz_269669_08: 167px, 1px #e5e7eb, r8, two 52px rows, 13px. */}
            <DropdownMenuContent align="end" sideOffset={-12} alignOffset={0} className="w-[167px] min-w-[167px] rounded-[8px] border border-[#e5e7eb] px-0 py-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)]">
              {canEdit ? (
                <DropdownMenuItem onSelect={onEdit} className="min-h-[52px] gap-2 border-t-0! px-3.5 py-0 text-[13px] text-wz-strong focus:text-wz-strong">
                  <Pencil className="size-4" strokeWidth={1.5} /> Edit client info
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={onDelete} className="min-h-[52px] gap-2 border-t-0! px-3.5 py-0 text-[13px]">
                  <Trash2 className="size-4" strokeWidth={1.5} /> Delete client
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {company ? (
        // Workiz prints the client's company under the name (14px/21px #768287); ours opens it.
        <Link href={`/companies/${company.id}`} className="truncate pr-[17px] pl-[19px] text-sm leading-[21px] tracking-[0.4px] text-wz-outline-label hover:underline">
          {company.title}
        </Link>
      ) : null}

      <div className="pt-[18px] pr-[17px] pl-[19px]">
        <small className="block text-[10px] leading-[14px] font-medium tracking-[0.4px] text-wz-outline uppercase">Contact</small>
        <div className="mt-2 flex flex-col gap-2">
          {phones.length === 0 && contact.phonesMasked ? (
            <p className="text-sm leading-[21px] text-wz-outline-label">
              {contact.phoneCount ?? 0} {contact.phoneCount === 1 ? "number" : "numbers"}, hidden
            </p>
          ) : null}
          {phones.map((phone, index) => (
            <div key={phone} className={cn("flex items-center gap-2", index === 0 ? "min-h-8" : "min-h-[21px]")}>
              <p className="min-w-0 flex-1 truncate text-sm leading-[21px] tracking-[0.4px] text-foreground">{wzPhone(phone, extensionOf(contact, phone))}</p>
              {/* Workiz: a blue phone (an <a>, 32px) and a blue chat beside the primary number. */}
              <span className={cn("flex items-center gap-2", index > 0 && "-my-[5.5px]")}>
                <CallClientButton
                  to={phone}
                  partyId={contact.id}
                  variant="workiz"
                  className="[&>button]:size-8 [&>button]:text-wz-link [&>button_svg]:size-[22px]"
                />
                {canMessage && index === 0 ? (
                  <button type="button" aria-label="Message client" title="Message client" onClick={onMessage} className={cn(ICON_BUTTON, "text-wz-link")}>
                    <MessageSquareText className="size-[22px]" strokeWidth={1.25} />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
          {contact.emails.map((email) => (
            <p key={email} className="truncate text-sm leading-[21px] tracking-[0.4px] text-foreground">
              {email}
            </p>
          ))}
        </div>
      </div>

      {/* Workiz's tags under the contact: chips, then "+ Add tag". */}
      <ClientTagsField
        contactId={contact.id}
        tagIds={contact.tagIds}
        canEdit={canEdit}
        canCreate={canCreateTags}
        className="mt-[15px] pr-[17px] pl-[19px]"
      />

      <div className="mt-7">
        <WzFold title="Addresses">
          <AddressCard label="Service address" address={service ? formatAddress(service) : undefined} onEdit={canEdit ? () => onEditAddress("service") : undefined} />
          <AddressCard
            label="Billing address"
            address={billing ? formatAddress(billing) : undefined}
            fallback="Same as the service address"
            onEdit={canEdit ? () => onEditAddress("billing") : undefined}
          />
        </WzFold>
        {showPortal ? (
          // Ours: the client portal link, folded like Workiz's sections.
          <WzFold title="Client portal">
            <PortalLinkCard contactId={contact.id} />
          </WzFold>
        ) : null}
        <div className="border-t border-border" />
      </div>
    </aside>
  );
}

/**
 * Workiz's address card (`detailsWrapper`): 1px #dfe2e3, 5px corners, 16px in;
 * the label 12px/18px 600 ink with a 32px pencil; a pin and the address,
 * 14px/16px #404040.
 */
function AddressCard({ label, address, fallback, onEdit }: { label: string; address?: string; fallback?: string; onEdit?: () => void }) {
  return (
    <div data-slot="address-card" className="min-h-[130px] rounded-[5px] border border-border px-4 pt-[5px] pb-4">
      <div className="flex min-h-[42px] items-center justify-between">
        <div className="text-xs leading-[18px] font-semibold tracking-[0.4px] text-foreground">{label}</div>
        {onEdit ? (
          <button type="button" aria-label={`Edit ${label.toLowerCase()}`} onClick={onEdit} className={cn(ICON_BUTTON, "-mr-[5px] text-foreground")}>
            <Pencil className="size-[18px]" strokeWidth={1.25} />
          </button>
        ) : null}
      </div>
      <div className={cn("mt-2.5 flex items-start gap-1.5 text-sm leading-4 tracking-[0.4px]", address ? "text-wz-strong" : "text-wz-outline-label")}>
        <MapPin className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        <span>{address ?? fallback ?? "—"}</span>
      </div>
    </div>
  );
}
