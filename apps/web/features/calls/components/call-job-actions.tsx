"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { callParty, newJobHref, type CallRecord } from "../lib";
import { LinkJobDialog } from "./link-job-dialog";

/**
 * Tie the call you're on to work: attach it to an existing job, or start a new
 * one from it.
 *
 * "Create job" navigates to the ordinary create-job page rather than opening a
 * form of its own — one create flow to maintain, and it already collects
 * everything a job needs. The call travels in the URL, so the page can prefill
 * the client and offer to attach the call on save.
 */
export function CallJobActions({ call }: { call: CallRecord | null }) {
  const router = useRouter();
  const { can } = usePermissions();
  const [linking, setLinking] = useState(false);

  if (!call?.callSid || !can("deals", "view")) return null;

  const linked = !!call.dealId;
  const canCreate = can("deals", "create");

  // Prefills the client (or their number), the call's job source and company.
  const createJob = () => router.push(newJobHref(call));

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLinking(true)}
        >
          {linked ? (
            <>
              <Briefcase className="size-3.5" /> Linked
            </>
          ) : (
            <>
              <Link2 className="size-3.5" /> Link to job
            </>
          )}
        </Button>
        {canCreate ? (
          <Button type="button" variant="outline" size="sm" onClick={createJob}>
            <Plus className="size-3.5" /> Create job
          </Button>
        ) : null}
      </div>

      <LinkJobDialog
        call={linking ? call : null}
        onClose={() => setLinking(false)}
      />
    </>
  );
}

/** The party a job would be for — exported so the call page can reuse it. */
export function callClient(call: CallRecord) {
  const from = callParty(call, "from");
  return from.kind === "user" ? callParty(call, "to") : from;
}
