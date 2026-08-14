"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDeal } from "@/features/deals/hooks";
import { ChangeClientDialog } from "./change-client-dialog";
import { LinkJobDialog } from "./link-job-dialog";
import { useJobTypeName } from "@/features/job-types/lib";
import { counterparty, formatEndpoint, type CallRecord } from "../lib";

/**
 * Who a call was with and what job it was about — the two things a person
 * corrects afterwards. Both are editable here because the log is evidence:
 * automatic matching gets it right most of the time, and when it doesn't,
 * somebody has to be able to say so.
 */
export function CallAssociations({ call }: { call: CallRecord }) {
  const { can } = usePermissions();
  const [changingClient, setChangingClient] = useState(false);
  const [changingJob, setChangingJob] = useState(false);
  const { data: deal, isLoading: dealLoading } = useDeal(call.dealId ?? "");
  const jobTypeName = useJobTypeName();

  const client = counterparty(call);
  const canEditClient = can("calls", "view");
  const canEditJob = can("deals", "view");

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Associations</h2>
      <dl className="divide-y rounded-lg border">
        <div className="flex items-center gap-3 px-4 py-3">
          <User className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Client
            </dt>
            <dd className="mt-0.5 text-sm font-medium">
              {client.kind === "contact" || client.kind === "company" ? (
                <Link
                  href={
                    client.kind === "company"
                      ? `/companies/${client.id}`
                      : `/contacts/${client.id}`
                  }
                  className="underline-offset-2 hover:text-brand hover:underline"
                >
                  {client.name}
                </Link>
              ) : (
                (client.name ?? formatEndpoint(client.number))
              )}
              {call.partySource === "manual" ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  set by hand
                </span>
              ) : null}
            </dd>
          </div>
          {canEditClient ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChangingClient(true)}
            >
              Change
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <Briefcase className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Job
            </dt>
            <dd className="mt-0.5 text-sm font-medium">
              {!call.dealId ? (
                <span className="text-muted-foreground">Not linked</span>
              ) : dealLoading ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : deal ? (
                <Link
                  href={`/deals/${deal.id}`}
                  className="underline-offset-2 hover:text-brand hover:underline"
                >
                  #{deal.dealNumber} — {jobTypeName(deal.jobTypeId)}
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  Linked to a job that no longer exists
                </span>
              )}
            </dd>
          </div>
          {canEditJob ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChangingJob(true)}
            >
              {call.dealId ? "Change" : "Link"}
            </Button>
          ) : null}
        </div>
      </dl>

      <ChangeClientDialog
        call={changingClient ? call : null}
        onClose={() => setChangingClient(false)}
      />
      <LinkJobDialog
        call={changingJob ? call : null}
        onClose={() => setChangingJob(false)}
      />
    </section>
  );
}
