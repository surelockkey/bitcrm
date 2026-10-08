"use client";

import { useState } from "react";
import { IdCard, MessageSquareText, Phone } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { startCall } from "@/features/telephony/softphone-manager";
import { personName } from "../person-name";
import { TechChatSheet } from "./tech-chat-sheet";
import { TECH_ACTION } from "./assigned-tech-row";

/**
 * What a dispatcher does with the technician on a job, from the job: look them
 * up, call them, message them.
 *
 * Hidden by opacity rather than unmounted, so reaching for one does not reflow
 * the row under the cursor — the parent row is the hover group.
 */
export function TechRowActions({
  techId,
  user,
  homeAddress,
  dealId,
}: {
  techId: string;
  user:
    | { firstName?: string; lastName?: string; email?: string; phone?: string }
    | undefined;
  homeAddress?: { line1?: string; city?: string; state?: string; zip?: string };
  /** The job being worked on: it travels with anything sent from here. */
  dealId?: string;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const name = personName(user);
  const phone = user?.phone;

  const address = [homeAddress?.line1, homeAddress?.city, homeAddress?.state, homeAddress?.zip]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex items-start opacity-0 transition-opacity duration-300 focus-within:opacity-100 group-hover:opacity-100">
      {/* Hover, as Workiz does: a dispatcher glances at it, they do not open it. */}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Technician details" className={TECH_ACTION}>
              <IdCard className="size-[18px]" strokeWidth={1.5} />
            </button>
          </TooltipTrigger>
          {/* Workiz's card (jobdetails_wz_techrow_action0_hover): white, 4px
              corners, 12px padding, 12px/18px medium ink, a soft ink shadow. */}
          <TooltipContent
            side="top"
            className="block w-[264px] max-w-none rounded-[4px] bg-white p-3 text-left text-[12px] leading-[18px] font-medium tracking-[0.4px] text-foreground shadow-[0_0_4px_rgba(59,75,82,0.05),0_4px_12px_rgba(59,75,82,0.1)] [&>span:last-child]:hidden"
          >
            <TechDetailsCard name={name} phone={phone} email={user?.email} address={address} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <button
        type="button"
        aria-label="Call technician"
        disabled={!phone}
        onClick={() => phone && startCall(phone)}
        className={cn(TECH_ACTION, !phone && "opacity-40")}
      >
        <Phone className="size-[18px]" strokeWidth={1.5} />
      </button>

      {/* Beside the job, not instead of it: a dispatcher messaging a technician
          is in the middle of that job. */}
      <button type="button" aria-label="Message technician" onClick={() => setChatOpen(true)} className={TECH_ACTION}>
        <MessageSquareText className="size-5" strokeWidth={1.5} />
      </button>
      <TechChatSheet
        techId={techId}
        name={name ?? "Technician"}
        phone={phone}
        dealId={dealId}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />
    </div>
  );
}

/**
 * What the hover card says about a technician — and only what is known.
 * Workiz prints "Notes: null" in this very card; an empty line is not worth a
 * word, let alone that one.
 */
export function TechDetailsCard({
  name,
  phone,
  email,
  address,
}: {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}) {
  return (
    <div>
      {name ? <strong className="block font-medium">{name}</strong> : null}
      <Detail label="Phone" value={phone ? formatPhone(phone) : undefined} />
      <Detail label="Email" value={email} />
      <Detail label="Address" value={address || undefined} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p>
      <span>{label}: </span>
      <span>{value}</span>
    </p>
  );
}
