"use client";

import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { JobDialCard } from "@/features/telephony/components/job-dial-card";

/**
 * The client's phones for somebody who may not see them.
 *
 * A masked viewer gets `phones: []` with a `phoneCount`, so any UI that renders
 * its call button *inside* a loop over `phones` shows them nothing at all —
 * they learn a number exists and have no way to ring it, which is worse than
 * not masking, because their only route back is to phone the office.
 *
 * So the count drives the rows instead. One row per withheld number, each with
 * its own call button carrying the `phoneIndex` the server will resolve. The
 * technician can still choose the mobile over the landline; they just never
 * learn which digits either one is.
 *
 * Drawn as the job page's Phone box (job_b_01_details): a locked 48px box
 * labelled "Phone" saying the number is hidden, the handset inside it.
 */
export function MaskedClientPhones({
  phoneCount,
  extensions,
  dealId,
  contactId,
  className,
}: {
  phoneCount: number;
  /**
   * What to press on each hidden number once it answers, by position
   * (`Contact.phoneExtensionsByIndex` — never keyed by the number). The call
   * presses it on its own; the row only says so.
   */
  extensions?: string[];
  dealId: string;
  contactId: string;
  className?: string;
}) {
  if (!phoneCount) return null;

  return (
    <div className={className}>
      {Array.from({ length: phoneCount }, (_, i) => {
        const ext = extensions?.[i];
        return (
          <div key={i}>
            <div
              data-slot="masked-phone"
              className="relative mr-px mb-2.5 h-12 rounded-[2px] border border-wz-disabled-border bg-wz-disabled"
            >
              <span className="pointer-events-none absolute top-[2px] left-[0.65rem] text-[12px] leading-5 text-wz-label">
                Phone
              </span>
              <span className="absolute top-[22px] right-[92px] left-2.5 truncate text-[16px] leading-4 text-wz-text">
                {phoneCount === 1 ? "Number hidden" : `Number ${i + 1} of ${phoneCount}, hidden`}
                {i === 0 && phoneCount > 1 ? " · primary" : ""}
                {ext ? ` · ext ${ext}` : ""}
              </span>
              {/* `to` is empty on purpose — the button sends a handle, and the
                  server resolves the digits. */}
              <div className="absolute top-[3px] right-3 flex items-center">
                <CallClientButton to="" dealId={dealId} contactId={contactId} phoneIndex={i} variant="workiz" />
              </div>
            </div>
            {/* Workiz: this number's own masked number — the technician line
                and a code that rings exactly this number. */}
            <JobDialCard dealId={dealId} phoneIndex={i} variant="workiz" />
          </div>
        );
      })}
    </div>
  );
}
