"use client";

import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { fetchJobCode } from "../api";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import { useTelephonyConfig } from "../config-hooks";

/** Spoken and read in pairs — "47 29 13" is far easier to key than "472913". */
function groupCode(code: string): string {
  return code.replace(/(\d\d)(?=\d)/g, "$1 ");
}

/**
 * How to reach this job's client from a handset that has no app session.
 *
 * The situation this exists for is a technician standing in somebody's hallway
 * with a dying phone, a borrowed line, or a company mobile that never got the
 * app. They dial one number, key the job code, confirm the client's name, and
 * the same conference opens that the in-app button opens.
 *
 * The code is shown to anyone who may call about the job — including a masked
 * user, because it is precisely what they get INSTEAD of the number. Since the
 * code alone now connects the call, this card IS the credential: a screenshot
 * of it lets whoever holds it ring that job's client. It still reveals no
 * phone number to anybody.
 *
 * The card never silently vanishes. It used to return null whenever anything
 * was missing, and a workspace that had not designated a line saw nothing at
 * all where the dial-in should have been — which reads as "this feature does
 * not exist" rather than "somebody has to turn it on".
 */
export function JobDialCard({ dealId }: { dealId: string }) {
  // Read straight from workspace settings rather than taking a prop: "nobody
  // designated a line" and "we could not ask" look identical once flattened
  // into one optional string, and they call for opposite actions.
  const {
    data: config,
    isError: configFailed,
    isLoading: configLoading,
  } = useTelephonyConfig();
  const technicianLine = config?.technicianLine;
  const { data: ext, isError } = useQuery({
    queryKey: ["job-code", dealId],
    queryFn: () => fetchJobCode(dealId),
    staleTime: 5 * 60_000,
  });
  // Only somebody who can actually designate a line is worth sending to the
  // settings page; for everybody else that is a dead end.
  const { can } = usePermissions();
  const canConfigure = can("settings", "edit");

  // Nothing to say yet — and a card that flashes "not set up" on every job
  // page load before the answer arrives is worse than a beat of silence.
  if (configLoading) return null;

  if (configFailed) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Phone className="size-3.5" /> Call from any phone
        </div>
        <p className="text-xs text-muted-foreground">
          Could not load the dial-in settings — reload the job to try again.
        </p>
      </div>
    );
  }

  if (!technicianLine) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Phone className="size-3.5" /> Call from any phone
        </div>
        <p className="text-xs text-muted-foreground">
          {canConfigure
            ? "Dial-in is not set up yet. Designate one of the workspace numbers as the technician line under Settings → Phone numbers."
            : "Dial-in is not set up yet — ask the office to designate a technician line."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Phone className="size-3.5" /> Call from any phone
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="w-16 shrink-0 text-xs text-muted-foreground">Dial</dt>
          <dd className="font-mono">{formatPhone(technicianLine)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="w-16 shrink-0 text-xs text-muted-foreground">Job code</dt>
          <dd className="font-mono text-base tracking-wider">
            {ext ? (
              groupCode(ext.code)
            ) : isError ? (
              <span className="font-sans text-xs text-destructive">
                Code could not be issued — reload the job
              </span>
            ) : (
              "…"
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-muted-foreground">
        You will be asked for the code, then to confirm the client&apos;s name.
      </p>
    </div>
  );
}
