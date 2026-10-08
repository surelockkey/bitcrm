"use client";

import { useState, type ReactNode } from "react";
import { MapPin, MessageSquareText, Signpost, Trash2 } from "lucide-react";
import type { Address, Contact, Deal } from "@bitcrm/types";
import { WzFieldGroup, WzLink, WzSectionHeader, WzSelect, WzTextField } from "@/components/workiz";
import { cn } from "@/lib/utils";
import {
  capNationalDigits,
  formatAsYouType,
  formatPhone,
  isValidPhone,
  MAX_EXTENSION_LENGTH,
  nationalDigits,
  nationalInput,
  normalizeExtension,
  toE164,
} from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import { ClientChatSheet } from "@/features/clients/components/client-chat-sheet";
import { contactName } from "@/features/clients/lib";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { JobDialCard } from "@/features/telephony/components/job-dial-card";
import type { ClientDraft } from "../lib";
import { addPhoneRow, addressSummary, phoneRows, removePhoneRow, type PhoneRow } from "../job-details-form";
import { directionsHref, JobAddressPane } from "./job-address-pane";
import { MaskedClientPhones } from "./masked-client-phones";
import { useEffectiveServiceArea, useServiceAreas } from "@/features/service-areas/hooks";
import { serviceAreaOptions } from "./workiz/options";

/**
 * A row of the Details form (`details-module__row`): 10px under the one
 * above, its field 1px short of the column — which is why a select is 452
 * wide in a 453 column and a text box (2px overhang) 454.
 */
export function DetailsRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mb-2.5 flex flex-nowrap [&>*]:mr-px [&>*]:min-w-0 [&>*]:grow", className)}>{children}</div>;
}

/**
 * Workiz's Client section on the job page (job_b_01_details): First | Last
 * Name, Phone (call and SMS inside) | Ext with "Add Phone" under it, the
 * masked number, Email, the one-line address box and Service area.
 *
 * Our rules ride along unchanged: the number the job was created with is
 * locked for good, extra numbers save straight to the client, a rename asks
 * "Change client" on Save (the page does that), and nothing here can make a
 * new client.
 */
export function JobClientSection({
  deal,
  contact,
  draft,
  onDraftChange,
  companyName,
  onCompanyNameChange,
  canEditClient,
  canEdit,
  address,
  onAddressChange,
  serviceAreaId,
  onServiceAreaChange,
}: {
  deal: Deal;
  contact: Contact | undefined;
  draft: ClientDraft | null;
  onDraftChange: (draft: ClientDraft) => void;
  /** Workiz's "Company name": the client's CRM company. */
  companyName: string;
  onCompanyNameChange: (name: string) => void;
  /** `contacts.edit`: name, company, phones and email. */
  canEditClient: boolean;
  /** `deals.edit`: the job's address and area. */
  canEdit: boolean;
  address: Address;
  onAddressChange: (address: Address) => void;
  serviceAreaId: string;
  onServiceAreaChange: (id: string) => void;
}) {
  const { can } = usePermissions();
  const [chatOpen, setChatOpen] = useState(false);
  const [paneOpen, setPaneOpen] = useState(false);
  const canText = can("messages", "send");
  const set = (patch: Partial<ClientDraft>) => draft && onDraftChange({ ...draft, ...patch });

  return (
    <section aria-label="Client">
      <WzSectionHeader>Client</WzSectionHeader>

      {contact && draft ? (
        <>
          <DetailsRow>
            <WzFieldGroup join="line">
              <WzTextField
                label="First Name"
                value={draft.firstName}
                disabled={!canEditClient}
                onChange={(e) => set({ firstName: e.target.value })}
              />
              <WzTextField
                label="Last Name"
                value={draft.lastName}
                disabled={!canEditClient}
                onChange={(e) => set({ lastName: e.target.value })}
              />
            </WzFieldGroup>
          </DetailsRow>

          {/* The client's CRM company, matched (or made) by title on Save —
              as the New Job page reads the same box. */}
          <DetailsRow>
            <WzTextField
              label="Company name"
              value={companyName}
              disabled={!canEditClient}
              onChange={(e) => onCompanyNameChange(e.target.value)}
            />
          </DetailsRow>

          {contact.phonesMasked ? (
            <MaskedClientPhones phoneCount={contact.phoneCount ?? 0} dealId={deal.id} contactId={contact.id} />
          ) : (
            phoneRows(contact.phones, draft).map((row) => (
              <PhoneLine
                key={row.index}
                row={row}
                canEdit={canEditClient}
                dealId={deal.id}
                contactId={contact.id}
                onText={canText ? () => setChatOpen(true) : undefined}
                onPhone={(v) => set({ phones: draft.phones.map((x, j) => (j === row.index ? v : x)) })}
                onExt={(v) =>
                  set({ phoneExts: draft.phones.map((_, j) => (j === row.index ? normalizeExtension(v) : draft.phoneExts[j] ?? "")) })
                }
                onRemove={() => onDraftChange(removePhoneRow(draft, row.index))}
              />
            ))
          )}
          {canEditClient && !contact.phonesMasked ? (
            // details-module__addPhone: right-aligned, pulled 5px up under the box.
            <div className="mb-2.5 flex justify-end">
              <WzLink tone="underlined" className="-mt-[5px]" onClick={() => onDraftChange(addPhoneRow(draft))}>
                Add Phone
              </WzLink>
            </div>
          ) : null}

          {/* Our dial-in, as Workiz shows its masked number. */}
          <JobDialCard dealId={deal.id} variant="workiz" />

          <DetailsRow>
            <WzTextField
              label="Email"
              type="email"
              value={draft.email}
              disabled={!canEditClient}
              onChange={(e) => set({ email: e.target.value })}
            />
          </DetailsRow>

          {canText ? (
            <ClientChatSheet
              contactId={contact.id}
              name={contactName(contact)}
              phone={contact.phones[0]}
              open={chatOpen}
              onOpenChange={setChatOpen}
            />
          ) : null}
        </>
      ) : null}

      <AddressBox address={address} canEdit={canEdit} onOpen={() => setPaneOpen(true)} />
      {canEdit ? (
        <JobAddressPane
          open={paneOpen}
          onOpenChange={setPaneOpen}
          value={address}
          clientAddresses={contact ? [...contact.addresses, ...(contact.billingAddress ? [contact.billingAddress] : [])] : undefined}
          onApply={onAddressChange}
        />
      ) : null}

      <DetailsRow>
        <JobServiceAreaSelect
          lat={address.lat}
          lng={address.lng}
          value={serviceAreaId || undefined}
          disabled={!canEdit}
          onChange={onServiceAreaChange}
        />
      </DetailsRow>
    </section>
  );
}

/* ------------------------------------------------------------ service area */

/**
 * "Service area" on the job page: the job's area by name ("SURE LOCK DALLAS
 * TX" — New Job's "(0 miles away)" is not on this page), found from the
 * address as everywhere else (a hand-picked area, else the one the address
 * is in, else the nearest). Same queries as the page loader asks.
 */
function JobServiceAreaSelect({
  lat,
  lng,
  value,
  disabled,
  onChange,
}: {
  lat?: number;
  lng?: number;
  value: string | undefined;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const { data: areas } = useServiceAreas();
  const effective = useEffectiveServiceArea(lat, lng, value);
  return (
    <WzSelect
      label="Service area"
      shape="square"
      options={serviceAreaOptions(areas, value)}
      value={value || effective.area?.id || ""}
      valueLabel={effective.area?.name}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/* --------------------------------------------------------------- phone row */

/** Workiz's SMS glyph inside the Phone box: 40px, 5px over the call button. */
function TextClientButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Message client"
      title="Message"
      onClick={onClick}
      className="-ml-[5px] flex size-10 items-center justify-center rounded-[8px] text-foreground transition-colors hover:bg-wz-secondary-hover"
    >
      <MessageSquareText className="size-[22px]" strokeWidth={1.25} />
    </button>
  );
}

function PhoneLine({
  row,
  canEdit,
  dealId,
  contactId,
  onText,
  onPhone,
  onExt,
  onRemove,
}: {
  row: PhoneRow;
  canEdit: boolean;
  dealId: string;
  contactId: string;
  onText?: () => void;
  onPhone: (e164: string) => void;
  onExt: (ext: string) => void;
  onRemove: () => void;
}) {
  const onFile = row.fileIndex >= 0;
  const removable = canEdit && row.removable;
  const icons = (onFile ? 1 + (onText ? 1 : 0) : 0) + (removable ? 1 : 0);
  return (
    <DetailsRow>
      <WzFieldGroup join="soft">
        <PhoneBox
          value={row.value}
          // The number the job was created with is bound to it for good.
          disabled={!canEdit || row.locked}
          onChange={onPhone}
          // Workiz lets the number run up to its icons (no padding kept for
          // them), so "(469) 396-8179" fits the 350px column too.
          inputClassName={icons > 2 ? "pr-[120px]" : icons === 0 ? "pr-2.5" : "pr-[80px]"}
          endAdornment={
            icons ? (
              <>
                {onFile ? (
                  // Dials what is on file, never the half-typed draft.
                  <CallClientButton
                    to={row.value}
                    partyId={contactId}
                    dealId={dealId}
                    contactId={contactId}
                    phoneIndex={row.fileIndex}
                    variant="workiz"
                  />
                ) : null}
                {onFile && onText ? <TextClientButton onClick={onText} /> : null}
                {removable ? (
                  <button
                    type="button"
                    aria-label="Remove phone"
                    title="Remove phone"
                    onClick={onRemove}
                    className="flex size-10 items-center justify-center rounded-[8px] text-foreground transition-colors hover:bg-wz-secondary-hover"
                  >
                    <Trash2 className="size-[18px]" strokeWidth={1.5} />
                  </button>
                ) : null}
              </>
            ) : undefined
          }
        />
        {/* What to press once the line answers — editable even on the
            locked number, since only the number itself is bound to the job. */}
        <WzTextField
          label="Ext"
          aria-label={`Extension for phone ${row.index + 1}`}
          className="w-[132px] flex-none"
          inputMode="tel"
          maxLength={MAX_EXTENSION_LENGTH}
          value={row.ext}
          disabled={!canEdit}
          onChange={(e) => onExt(e.target.value)}
        />
      </WzFieldGroup>
    </DetailsRow>
  );
}

/**
 * The Phone box: US national format as it is typed ("(469) 396-8179"),
 * capped at a whole number, E.164 out ("+14693968179") so it is stored and
 * matched like every other number. An unfinished number says so once left.
 */
function PhoneBox({
  value,
  onChange,
  disabled,
  endAdornment,
  inputClassName,
}: {
  value: string;
  onChange: (e164: string) => void;
  disabled?: boolean;
  endAdornment?: ReactNode;
  inputClassName?: string;
}) {
  const shown = (v: string) => (v ? (disabled ? formatPhone(v) : formatAsYouType(nationalDigits(v))) : "");
  const [text, setText] = useState(() => shown(value));
  // What this box last said, so a value from outside (a reset, a refetch)
  // is taken in and the echo of our own typing is not.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(shown(value));
  }
  const [left, setLeft] = useState(true);

  return (
    <WzTextField
      label="Phone"
      inputMode="tel"
      autoComplete="off"
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const digits = capNationalDigits(nationalInput(e.target.value));
        setText(digits ? formatAsYouType(digits) : "");
        const next = digits ? toE164("US", digits) : "";
        setSynced(next);
        onChange(next);
      }}
      onFocus={() => setLeft(false)}
      onBlur={() => setLeft(true)}
      error={left && !disabled && value && !isValidPhone(value) ? "Invalid phone number" : undefined}
      endAdornment={endAdornment}
      inputClassName={inputClassName}
    />
  );
}

/* ------------------------------------------------------------- address box */

/**
 * The job's address on one line (details-module__address): 1px #cad3d6 box,
 * 15px 10px, the pin, "Princeton, Princeton, Texas 75407", and the road
 * sign at the right — Google Maps directions in a new tab. The box opens the
 * Address pane.
 */
function AddressBox({ address, canEdit, onOpen }: { address: Address; canEdit: boolean; onOpen: () => void }) {
  const summary = addressSummary(address);
  return (
    <div
      role={canEdit ? "button" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      aria-label={canEdit ? `Address: ${summary || "none"}. Edit address` : undefined}
      data-slot="job-address-box"
      onClick={canEdit ? onOpen : undefined}
      onKeyDown={
        canEdit
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className={cn(
        "mb-2.5 flex items-center border border-wz-rule px-2.5 py-[15px] text-[14px] leading-4 font-normal text-wz-strong outline-none focus-visible:border-wz-focus",
        canEdit ? "cursor-pointer" : "cursor-default bg-wz-disabled",
      )}
    >
      <MapPin className="size-[17px] shrink-0" strokeWidth={1.25} aria-hidden />
      <span className={cn("ml-2.5 min-w-0 flex-1 truncate leading-[18px]", !summary && "text-wz-placeholder")}>
        {summary || "Address"}
      </span>
      {summary ? (
        <a
          href={directionsHref(address)}
          target="_blank"
          rel="noreferrer"
          aria-label="Get directions"
          title="Get directions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="ml-2.5 shrink-0 text-foreground"
        >
          <Signpost className="size-[17px]" strokeWidth={1.25} aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
