"use client";

import { MapPin, MessageSquareText, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { Company } from "@bitcrm/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WzFold } from "@/components/workiz/record-parts";
import { cn } from "@/lib/utils";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { tagSolidClasses } from "@/features/client-tags/lib";
import { wzPhone } from "../client-page";
import { websiteHref } from "../companies-list";
import { clientTypeLabel, extensionOf } from "../lib";

/** Workiz's 32px IconButton (medium/white): 8px corners, #f3f6f7 under the pointer. */
const ICON_BUTTON = "grid size-8 shrink-0 place-items-center rounded-[8px] outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * The company page's left column, drawn as Workiz's client column
 * (`clientInfo`, pg_contact_wz_269669 — our `ClientSummaryPanel`): the name
 * (20px/24px 600) with the ⋮ menu (Edit company info / Delete company) and
 * the client type under it where Workiz prints a client's company; CONTACT —
 * the numbers as plain lines with a blue call button (the company's own call
 * history) and, by the primary one, the message button; the emails and the
 * website; the PLATINUM chip where Workiz's tag chips sit; then the
 * Addresses fold with the company's one address.
 *
 * Workiz's AI insights, Additional contacts and Payment methods are not
 * drawn: the company's people are the Contacts tab, its terms the
 * Compliance tab.
 */
export function CompanySummaryPanel({
  company,
  canEdit,
  canDelete,
  canMessage,
  onEdit,
  onDelete,
  onMessage,
}: {
  company: Company;
  canEdit: boolean;
  canDelete: boolean;
  /** `messages.send`: the message button beside the primary number opens the thread. */
  canMessage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMessage: () => void;
}) {
  const phones = company.phones;

  return (
    <aside aria-label="Company" className="flex flex-col pb-6">
      <div className="flex min-h-8 items-center gap-2 pt-4 pr-[17px] pl-[19px]">
        <div className="min-w-0 flex-1">
          <h1 data-slot="company-name" className="text-[20px] leading-6 font-semibold tracking-[0.4px] break-words text-foreground">
            {company.title}
          </h1>
        </div>
        {canEdit || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Edit company" title="Edit company" className={cn(ICON_BUTTON, "text-foreground")}>
                <MoreVertical className="size-5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            {/* pg_contact_wz_269669_08: 167px, 1px #e5e7eb, r8, two 52px rows, 13px — opened below the button. */}
            <DropdownMenuContent
              align="end"
              sideOffset={2}
              className="w-[180px] min-w-[180px] rounded-[8px] border border-[#e5e7eb] px-0 py-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)]"
            >
              {canEdit ? (
                <DropdownMenuItem onSelect={onEdit} className="min-h-[52px] gap-2 border-t-0! px-3.5 py-0 text-[13px] text-wz-strong focus:text-wz-strong">
                  <Pencil className="size-4" strokeWidth={1.5} /> Edit company info
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={onDelete} className="min-h-[52px] gap-2 border-t-0! px-3.5 py-0 text-[13px]">
                  <Trash2 className="size-4" strokeWidth={1.5} /> Delete company
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {/* Where Workiz prints a client's company (14px/21px #768287): the company's client type. */}
      <p className="truncate pr-[17px] pl-[19px] text-sm leading-[21px] tracking-[0.4px] text-wz-outline-label">{clientTypeLabel(company.clientType)}</p>

      <div className="pt-[18px] pr-[17px] pl-[19px]">
        <small className="block text-[10px] leading-[14px] font-medium tracking-[0.4px] text-wz-outline uppercase">Contact</small>
        <div className="mt-2 flex flex-col gap-2">
          {phones.length === 0 && company.phonesMasked ? (
            <p className="text-sm leading-[21px] text-wz-outline-label">
              {company.phoneCount ?? 0} {company.phoneCount === 1 ? "number" : "numbers"}, hidden
            </p>
          ) : null}
          {phones.map((phone, index) => (
            <div key={phone} className={cn("flex items-center gap-2", index === 0 ? "min-h-8" : "min-h-[21px]")}>
              <p className="min-w-0 flex-1 truncate text-sm leading-[21px] tracking-[0.4px] text-foreground">{wzPhone(phone, extensionOf(company, phone))}</p>
              {/* Workiz: a blue phone (32px) and a blue chat beside the primary number; ours rings the others too. */}
              <span className={cn("flex items-center gap-2", index > 0 && "-my-[5.5px]")}>
                <CallClientButton
                  to={phone}
                  partyId={company.id}
                  kind="company"
                  variant="workiz"
                  className="[&>button]:size-8 [&>button]:text-wz-link [&>button_svg]:size-[22px]"
                />
                {canMessage && index === 0 ? (
                  <button type="button" aria-label="Message company" title="Message company" onClick={onMessage} className={cn(ICON_BUTTON, "text-wz-link")}>
                    <MessageSquareText className="size-[22px]" strokeWidth={1.25} />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
          {company.emails.map((email) => (
            <p key={email} className="truncate text-sm leading-[21px] tracking-[0.4px] text-foreground">
              {email}
            </p>
          ))}
          {company.website ? (
            <a
              href={websiteHref(company.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm leading-[21px] tracking-[0.4px] text-wz-link hover:underline"
            >
              {company.website}
            </a>
          ) : null}
        </div>
      </div>

      {company.isPlatinum ? (
        // Workiz's tag chip on the client column (24px, r3, 14px/16px 500 white on the tag's colour).
        <div className="mt-[15px] flex pr-[17px] pl-[19px]">
          <span className={cn("inline-flex h-6 items-center rounded-[3px] px-2 text-sm leading-4 font-medium tracking-[0.4px] uppercase", tagSolidClasses("blue"))}>
            Platinum
          </span>
        </div>
      ) : null}

      <div className="mt-7">
        <WzFold title="Addresses">
          <AddressCard label="Company address" address={company.address} onEdit={canEdit ? onEdit : undefined} />
        </WzFold>
        <div className="border-t border-border" />
      </div>
    </aside>
  );
}

/**
 * Workiz's address card (`detailsWrapper`): 1px #dfe2e3, 5px corners, 16px in;
 * the label 12px/18px 600 ink with a 32px pencil; a pin and the address,
 * 14px/16px #404040. The company keeps one address, in a single line.
 */
function AddressCard({ label, address, onEdit }: { label: string; address?: string; onEdit?: () => void }) {
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
        <span>{address || "No address"}</span>
      </div>
    </div>
  );
}
