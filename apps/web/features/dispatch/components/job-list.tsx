"use client";

import Link from "next/link";
import type { Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { seenByTechLabel, sentToTechLabel } from "@/features/deals/lib";
import { mapAddress, mapStatusWord } from "../map-words";
import { MapTag } from "./map-tag";

/*
 * The Map's job cards (Sidebar-module cardWrapper, pg_dispatch_wz_02_loaded):
 * 16px in, 8px between lines, a #dfe2e3 rule under each; "<type> - Job #<id>"
 * 14px/16px semibold, the address under it, and the green status tag. No
 * hover or selected look — Workiz shows the pointer only.
 */

/**
 * Ours, kept from the dispatch board: whether the job has been handed to its
 * technician (`last_sent`) and whether they have opened it (`seen`), as two
 * more Workiz tags beside the status. A job never sent shows neither.
 */
function SendStamps({ deal }: { deal: Deal }) {
  const sent = sentToTechLabel(deal);
  if (!sent) return null;
  const seen = seenByTechLabel(deal);
  return (
    <>
      <MapTag tone="archived" bold title={sent}>
        Sent
      </MapTag>
      {seen ? (
        <MapTag tone="primary" bold title={seen}>
          Seen
        </MapTag>
      ) : null}
    </>
  );
}

const CARD = "flex w-full flex-col gap-2 border-b border-border p-4 text-left text-sm leading-4 tracking-[0.4px] text-wz-strong outline-none focus-visible:bg-wz-secondary-hover";

function CardBody({ deal, title }: { deal: Deal; title: string }) {
  return (
    <>
      <span className="font-semibold">{title}</span>
      <span>{mapAddress(deal.address)}</span>
      <span className="flex flex-wrap items-center gap-1">
        <MapTag bold>{mapStatusWord(deal.superStatus)}</MapTag>
        <SendStamps deal={deal} />
      </span>
    </>
  );
}

export function JobList({
  mapped,
  unmapped,
  title,
  hoveredId,
  onHover,
  onSelect,
}: {
  mapped: Deal[];
  unmapped: Deal[];
  /** "Car Key Copy - Job #A4IC4E". */
  title: (deal: Deal) => string;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {mapped.map((deal) => (
        <button
          key={deal.id}
          type="button"
          data-testid={`job-row-${deal.id}`}
          data-hovered={hoveredId === deal.id ? "true" : "false"}
          onMouseEnter={() => onHover(deal.id)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(deal.id)}
          onBlur={() => onHover(null)}
          onClick={() => onSelect(deal.id)}
          className={cn(CARD, "cursor-pointer")}
        >
          <CardBody deal={deal} title={title(deal)} />
        </button>
      ))}

      {/*
        Jobs we could not place. Shown, not hidden — a map missing a third of the
        day's work looks complete and is worse than one that admits the gap.
        With no pin to open a card over, each opens its job page.
      */}
      {unmapped.length > 0 ? (
        <>
          <p className="border-b border-border px-4 pt-3 pb-3 text-sm leading-[21px] tracking-[0.4px] text-wz-slate">
            Not on the map ({unmapped.length}) — address has no coordinates yet
          </p>
          {unmapped.map((deal) => (
            <Link key={deal.id} href={`/deals/${deal.id}`} data-testid={`job-row-${deal.id}`} data-hovered="false" className={CARD}>
              <CardBody deal={deal} title={title(deal)} />
            </Link>
          ))}
        </>
      ) : null}
    </>
  );
}
