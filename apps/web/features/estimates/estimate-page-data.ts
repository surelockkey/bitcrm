"use client";

import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDocumentTemplatesOfKind } from "@/features/billing/templates-api";
import { useContact } from "@/features/clients/hooks";
import { useDeal, useDealProducts } from "@/features/deals/hooks";
import { useDocumentSettings } from "@/features/documents/hooks";
import { useActiveTaxRates } from "@/features/tax-rates/hooks";
import { useDealEstimates, useEstimate } from "./hooks";

/**
 * Everything an estimate's page shows, asked for at once — so the page
 * appears once, whole, instead of filling in while the reader watches.
 *
 * It used to come in waves: the estimate; then, for a job's estimate, the
 * job; then the editor, whose blocks asked for the client, the templates,
 * the tax rates and the Send defaults only once they had mounted — with one
 * tab where the job's other estimates were still on their way. This asks for
 * all of it the moment the page opens: what needs nothing goes out with the
 * estimate, what needs its job or its client the moment it lands. It calls the
 * very hooks the blocks call, so they find their answers in the cache.
 *
 * `ready` holds the page behind one skeleton until every answer is in — a
 * failed one counts, so one broken request never keeps the estimate off
 * screen — and once up the page stays up: a refetch after an edit is no
 * reason to take the estimate away mid-edit. The page is keyed by estimate,
 * so the next one starts behind the skeleton again.
 */
export function useEstimatePageData(estimateId: string) {
  const { can, isLoading: permsLoading } = usePermissions();
  const estimate = useEstimate(estimateId);

  // Needs nothing but the page — out together with the estimate.
  const templates = useDocumentTemplatesOfKind("estimate");
  const settings = useDocumentSettings();
  // The tax picker is an editor's.
  const taxRates = useActiveTaxRates(can("estimates", "edit"));

  // Needs the estimate's own fields — out the moment it lands.
  const dealId = estimate.data?.dealId ?? "";
  const client = useContact(estimate.data?.contactId ?? "");
  const deal = useDeal(dealId);
  const jobProducts = useDealProducts(dealId, !!dealId);
  const siblings = useDealEstimates(dealId);

  // A client's estimate has no job to wait for.
  const jobIn = !dealId || [deal, jobProducts, siblings].every(settled);
  const allIn = !permsLoading && settled(estimate) && jobIn && [client, templates, settings, taxRates].every(settled);

  return { ready: usePageReady(allIn), estimate, deal, jobProducts, siblings };
}
