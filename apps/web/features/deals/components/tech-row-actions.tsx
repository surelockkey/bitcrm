"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IdCard, MessageSquare, Phone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { startCall } from "@/features/telephony/softphone-manager";
import { getConversationByParty } from "@/features/messaging/api";
import { personName } from "../person-name";

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
}: {
  techId: string;
  user:
    | { firstName?: string; lastName?: string; email?: string; phone?: string }
    | undefined;
  homeAddress?: { line1?: string; city?: string; state?: string; zip?: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = personName(user);
  const phone = user?.phone;

  const address = [homeAddress?.line1, homeAddress?.city, homeAddress?.state, homeAddress?.zip]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");

  async function openChat() {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await getConversationByParty("user", techId);
      // No thread yet is not an error: the team inbox is where one starts.
      router.push(conversation ? `/messages?c=${conversation.id}` : "/messages?view=team");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Technician details" className={btn}>
            <IdCard className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 space-y-1 p-3 text-sm">
          {name ? <p className="font-medium">{name}</p> : null}
          {/* Only what is known: Workiz prints "Notes: null" here, and an empty
              line is not worth a word. */}
          <Detail label="Phone" value={phone ? formatPhone(phone) : undefined} />
          <Detail label="Email" value={user?.email} />
          <Detail label="Address" value={address || undefined} />
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        aria-label="Call technician"
        disabled={!phone}
        onClick={() => phone && startCall(phone)}
        className={cn(btn, !phone && "opacity-40")}
      >
        <Phone className="size-4" />
      </button>

      <button type="button" aria-label="Message technician" onClick={openChat} className={btn}>
        <MessageSquare className="size-4" />
      </button>
    </div>
  );
}

const btn =
  "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed";

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-muted-foreground">
      <span className="text-foreground/70">{label}: </span>
      <span>{value}</span>
    </p>
  );
}
