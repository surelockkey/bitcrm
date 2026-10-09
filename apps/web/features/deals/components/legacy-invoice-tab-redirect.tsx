"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useInvoiceByDeal } from "@/features/invoices/hooks";
import { legacyInvoiceTabTarget } from "../deal-tabs";

/**
 * `/deals/<id>?tab=invoice` — the job page's old Invoice tab (Workiz has
 * none; a job's invoice opens on its own page). Links to it live on in sent
 * texts, bookmarks and history, so it still lands somewhere: on the job's
 * invoice, or on the job while it has none (or the viewer may not see it).
 * The job page's skeleton holds the screen until the answer is in.
 */
export function LegacyInvoiceTabRedirect({ dealId }: { dealId: string }) {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const canInvoices = !permsLoading && can("invoices");
  const invoice = useInvoiceByDeal(dealId, canInvoices);
  const known = !permsLoading && (!canInvoices || settled(invoice));
  const target = known ? legacyInvoiceTabTarget(dealId, canInvoices ? invoice.data : null) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return (
    <div className="p-6">
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
