"use client";

import { Eye, PenLine, Phone, User } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { WzMapPinCard, WzMapPinCardRow, type WzMapPinCardAction } from "@/components/workiz/map-pin";
import { googleMapsLink } from "@/lib/geo/geo";
import { formatPhone } from "@/lib/phone";
import { mapAddress, mapStatusWord, pinCardWhen } from "../map-words";
import { MapTag } from "./map-tag";

/**
 * The card a job's pin opens (pg_dispatch_wz_05_pin_click): "<type> - Job
 * #<id>" with Edit, View and ×; the client beside the status tag; the phone
 * with its call button over a rule; the day and slot; the address; the tech.
 *
 * Ours, in Workiz's own places: the address opens the spot in Google Maps,
 * and the tech line carries "Assign" / "Edit crew" for whoever may edit jobs.
 */
export function JobPinCard({
  deal,
  title,
  clientName,
  phone,
  techNames,
  canEdit,
  onEdit,
  onView,
  onAssign,
  onClose,
}: {
  deal: Deal;
  title: string;
  clientName: string;
  phone?: string;
  /** "(2) CT - Tyler Boucher, (2) CT - Bill Ryan"; none = Unassigned. */
  techNames?: string;
  canEdit: boolean;
  onEdit: () => void;
  onView: () => void;
  onAssign: () => void;
  onClose: () => void;
}) {
  const actions: WzMapPinCardAction[] = [
    ...(canEdit ? [{ label: "Edit", icon: <PenLine strokeWidth={1.6} />, onClick: onEdit }] : []),
    { label: "View", icon: <Eye strokeWidth={1.6} />, onClick: onView },
  ];
  const when = pinCardWhen(deal);
  return (
    <WzMapPinCard title={title} actions={actions} onClose={onClose}>
      <WzMapPinCardRow icon={<User strokeWidth={1.6} />} end={<MapTag>{mapStatusWord(deal.superStatus)}</MapTag>}>
        {clientName}
      </WzMapPinCardRow>
      <WzMapPinCardRow
        rule
        icon={<Phone strokeWidth={1.6} />}
        end={
          phone ? (
            <a
              href={`tel:${phone}`}
              aria-label={`Call ${formatPhone(phone)}`}
              className="flex size-6 items-center justify-center rounded-[4px] text-foreground hover:bg-wz-secondary-hover"
            >
              <Phone className="size-4" strokeWidth={1.6} />
            </a>
          ) : (
            <span className="size-6" />
          )
        }
      >
        {phone ? formatPhone(phone) : "—"}
      </WzMapPinCardRow>
      {when ? <p>{when}</p> : null}
      <p>
        <a
          href={googleMapsLink(deal.address)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Google Maps"
          className="text-foreground hover:underline"
        >
          {mapAddress(deal.address)}
        </a>
      </p>
      <WzMapPinCardRow
        end={
          canEdit ? (
            <button
              type="button"
              onClick={onAssign}
              className="cursor-pointer text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-wz-link hover:underline"
            >
              {deal.assignedTechIds.length ? "Edit crew" : "Assign"}
            </button>
          ) : null
        }
      >
        {techNames ?? "Unassigned"}
      </WzMapPinCardRow>
    </WzMapPinCard>
  );
}
