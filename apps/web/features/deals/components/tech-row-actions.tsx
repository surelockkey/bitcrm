"use client";

import { useState } from "react";
import { IdCard, MessageSquare, Phone } from "lucide-react";
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
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      {/* Hover, as Workiz does: a dispatcher glances at it, they do not open it. */}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Technician details" className={btn}>
              <IdCard className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent align="end" className="max-w-72 p-3 text-left text-sm">
            <TechDetailsCard name={name} phone={phone} email={user?.email} address={address} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <button
        type="button"
        aria-label="Call technician"
        disabled={!phone}
        onClick={() => phone && startCall(phone)}
        className={cn(btn, !phone && "opacity-40")}
      >
        <Phone className="size-4" />
      </button>

      {/* Beside the job, not instead of it: a dispatcher messaging a technician
          is in the middle of that job. */}
      <button type="button" aria-label="Message technician" onClick={() => setChatOpen(true)} className={btn}>
        <MessageSquare className="size-4" />
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

const btn =
  "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed";

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
    <div className="space-y-1">
      {name ? <p className="font-medium">{name}</p> : null}
      <Detail label="Phone" value={phone ? formatPhone(phone) : undefined} />
      <Detail label="Email" value={email} />
      <Detail label="Address" value={address || undefined} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-muted-foreground">
      <span className="text-foreground/70">{label}: </span>
      <span>{value}</span>
    </p>
  );
}
