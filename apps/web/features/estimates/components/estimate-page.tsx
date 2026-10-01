"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useContact } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { useEstimate } from "../hooks";
import { EstimateEditor } from "./estimate-editor";

/**
 * `/estimates/[id]` — a CLIENT estimate (Workiz: one made from the client
 * card, with no job) on a page of its own. A job's estimate has its home in
 * the job's Estimates tab, so this page sends it there.
 */
export function StandaloneEstimatePage({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const { data: estimate, isLoading, isError, error } = useEstimate(estimateId);
  const { data: contact } = useContact(estimate?.contactId ?? "");

  const dealId = estimate?.dealId;
  useEffect(() => {
    if (dealId) router.replace(`/deals/${dealId}?tab=estimates&estimate=${estimateId}`);
  }, [dealId, estimateId, router]);

  if (isLoading || dealId) {
    return (
      <div className="p-6">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !estimate) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {getApiErrorMessage(error, "This estimate couldn't be loaded — it may have been deleted.")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3 text-sm text-muted-foreground">
        <FileSpreadsheet className="size-4" />
        <span>
          Estimate for{" "}
          <Link href={`/contacts/${estimate.contactId}`} className="font-medium text-primary hover:underline">
            {contact ? contactName(contact) : "the client"}
          </Link>
        </span>
        <span aria-hidden="true">·</span>
        <span>Not tied to a job</span>
      </div>
      <div className="p-6">
        <EstimateEditor
          estimateId={estimateId}
          onOpenEstimate={(id) => router.push(`/estimates/${id}`)}
          onDeleted={() => router.push(`/contacts/${estimate.contactId}`)}
        />
      </div>
    </div>
  );
}
