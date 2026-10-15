"use client";

import { Phone } from "lucide-react";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import { jobCodeFor } from "../api";
import { useJobCode, useTelephonyConfig } from "../config-hooks";

/**
 * What a technician off the job's roster is told (the server answers 403):
 * the rule is deliberate, so say what it is and who can change it.
 */
const NOT_ON_JOB =
  "Only the technicians assigned to this job can call its client — ask the office to add you to the job.";

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
export function JobDialCard({
  dealId,
  variant = "card",
  phoneIndex = 0,
}: {
  dealId: string;
  /**
   * `card`: the boxed "Call from any phone" card. `workiz`: the job page's
   * Details tab, drawn as Workiz draws its masked number
   * (job_b_01_details: "Masked number" over "(203) 769-9944 #6872").
   */
  variant?: "card" | "workiz";
  /**
   * Which of the client's numbers this masked number rings — the call
   * buttons' `phoneIndex`. Every number has its own code (Workiz).
   */
  phoneIndex?: number;
}) {
  // Read straight from workspace settings rather than taking a prop: "nobody
  // designated a line" and "we could not ask" look identical once flattened
  // into one optional string, and they call for opposite actions.
  const {
    data: config,
    isError: configFailed,
    error: configError,
    isLoading: configLoading,
  } = useTelephonyConfig();
  const technicianLine = config?.technicianLine;
  const { data: codes, isError, error: codeError } = useJobCode(dealId);
  const code = jobCodeFor(codes, phoneIndex);
  // Refused, not failed: a technician who is not on the job's roster. No
  // reload fixes that, so it must not read like an error that one would.
  const notOnJob = isError && codeError instanceof ApiError && codeError.isForbidden;
  // Only somebody who can actually designate a line is worth sending to the
  // settings page; for everybody else that is a dead end.
  const { can } = usePermissions();
  const canConfigure = can("settings", "edit");

  // Nothing to say yet — and a card that flashes "not set up" on every job
  // page load before the answer arrives is worse than a beat of silence.
  if (configLoading) return null;

  if (variant === "workiz") {
    const note = configFailed
      ? `Could not load the dial-in settings: ${getApiErrorMessage(configError)} — reload the job to try again.`
      : !technicianLine
        ? canConfigure
          ? "Dial-in is not set up yet. Designate one of the workspace numbers as the technician line under Settings → Phone numbers."
          : "Dial-in is not set up yet — ask the office to designate a technician line."
        : notOnJob
          ? NOT_ON_JOB
          : undefined;
    return (
      // details-module__masking: a padded column, the caption 10px/1em 5px
      // over the line; the line bold, the code after a "#".
      <div className="mb-2.5 flex flex-col p-2.5 text-wz-strong">
        <span className="mb-[5px] text-[10px] leading-[1em] font-normal">Masked number</span>
        {note ? (
          <p className="text-[12px] leading-4 text-wz-caption">{note}</p>
        ) : (
          <div
            data-testid="job-dial-in"
            className="text-[14px] leading-4 font-normal"
            title="Dial the number, then key the job code. You will be asked to confirm the client's name."
          >
            <b className="font-bold">{formatPhone(technicianLine!)}</b>{" "}
            {code ? (
              `#${code}`
            ) : isError ? (
              <span className="text-[12px] text-wz-error">
                Code could not be issued: {getApiErrorMessage(codeError)} — reload the job
              </span>
            ) : codes ? (
              // A number added since the codes were read: never borrow
              // another number's code — it would ring the wrong phone.
              <span className="text-[12px] text-wz-caption">no code yet — reload the job</span>
            ) : (
              "#…"
            )}
          </div>
        )}
      </div>
    );
  }

  if (configFailed) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Phone className="size-3.5" /> Call from any phone
        </div>
        <p className="text-xs text-muted-foreground">
          Could not load the dial-in settings: {getApiErrorMessage(configError)} — reload the job to try again.
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
            {code ? (
              groupCode(code)
            ) : notOnJob ? (
              <span className="font-sans text-xs text-muted-foreground">{NOT_ON_JOB}</span>
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
