"use client";

import { useQuery } from "@tanstack/react-query";
import type { Deal, InvoiceView } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDocumentTemplatesOfKind } from "@/features/billing/templates-api";
import { useContact } from "@/features/clients/hooks";
import { listAttachments } from "@/features/deals/attachments-api";
import { useDealProducts, useDealTotals } from "@/features/deals/hooks";
import { useInvoicePayments } from "@/features/payments/hooks";
import { usePaymentSchedule } from "@/features/payments/schedule-hooks";
import { useActiveTaxRates } from "@/features/tax-rates/hooks";

/**
 * Everything an invoice's screen shows besides the invoice, asked for at once
 * — the job's Invoice tab (`deal` given) or a client invoice's own page.
 *
 * Its blocks each read their own data and used to ask only once mounted: the
 * Template picker said "Loading…", the job's items and the payments were grey
 * blocks, and as each landed the sections under it were pushed down. This
 * calls the very hooks the blocks call, so they find their answers in the
 * cache; `allIn` says every one has answered (a failure counts — one broken
 * request never keeps the invoice off screen).
 *
 * `invoice` null is a job with no invoice yet: only the job's items are shown
 * (they decide whether one can be created). Undefined is "not known yet".
 */
export function useInvoiceViewData({
  invoice,
  deal,
  canEditItems,
}: {
  invoice: InvoiceView | null | undefined;
  deal?: Deal;
  canEditItems: boolean;
}): { allIn: boolean } {
  const { can } = usePermissions();
  const shown = !!invoice;
  const dealId = deal?.id ?? "";

  const ledger = useInvoicePayments(invoice?.id ?? "", can("payments"));
  const templates = useDocumentTemplatesOfKind("invoice", shown);
  const client = useContact(invoice?.contactId ?? "");
  // The tax picker is an editor's: of the job's items on a job, of the invoice's own lines otherwise.
  const taxRates = useActiveTaxRates(shown && (deal ? canEditItems : can("invoices", "edit")));
  // A job's invoice is the job's items, tax and discount.
  const products = useDealProducts(dealId, !!dealId);
  const totals = useDealTotals(dealId, !!dealId && shown);
  // Workiz's invoice page also carries the job's payment schedule (or "Add
  // payment schedule") and the job's files — asked with the same keys their
  // blocks use (`usePaymentSchedule`, `useAttachments`), so they find them.
  const schedule = usePaymentSchedule(dealId, !!dealId && shown && can("payments"));
  const files = useQuery({
    queryKey: queryKeys.deals.attachments(dealId),
    queryFn: () => listAttachments(dealId),
    enabled: !!dealId && shown,
  });

  const jobIn = !deal || [products, totals, schedule, files].every(settled);
  return { allIn: invoice !== undefined && jobIn && [ledger, templates, client, taxRates].every(settled) };
}
