"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  Deal,
  DealProduct,
  DocumentDiscount,
  User,
} from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage, getMissingCloseFields } from "@/lib/api/errors";
import { getUserNames } from "@/features/users/api";
import { usePermissions } from "@/features/auth/use-permissions";
import { fetchAllUsers } from "@/features/technicians/api";
import * as api from "./api";
import { SEND_TO_TECH_CHANNEL_LABEL } from "./lib";
import type { CreateDealValues, UpdateDealValues, AddProductValues } from "./schemas";
import type { DealCountsParams, DealsListParams } from "./query-params";
import { windowRequests, type DealsWindow } from "./window";

/* ------------------------------------------------------------- queries */

/** Dispatch board polls so the map stays live (story 4.01). */
export const DEALS_POLL_MS = 30_000;

/**
 * A board or a schedule: the whole of a bounded window, kept fresh by
 * polling. The window is a handful of bounded requests (`windowRequests`),
 * drained and merged — a deal reached from two of them is kept once.
 */
export function useDealsWindow(window: DealsWindow, options: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.deals.window(window),
    queryFn: async () => {
      const pages = await Promise.all(windowRequests(window).map((req) => api.fetchAllDeals(req)));
      const seen = new Set<string>();
      const out: Deal[] = [];
      for (const d of pages.flat()) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        out.push(d);
      }
      return out;
    },
    refetchInterval: options.poll ? DEALS_POLL_MS : false,
    enabled: options.enabled ?? true,
  });
}

/**
 * The jobs page: one server-ordered page at a time, the next one on
 * request. Fifty rows a page, as Workiz shows them; the toolbar state is the
 * key, so a filter change starts a fresh first page.
 */
export function useDealsPage(params: DealsListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.deals.page(params),
    queryFn: ({ pageParam }) => api.listDeals({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled,
  });
}

/** A set of deals by id — a search result hydrated in one call. Nothing is asked for an empty list. */
export function useDealsByIds(ids: string[], enabled = true) {
  const wanted = useMemo(() => [...new Set(ids)].filter(Boolean), [ids]);
  return useQuery({
    queryKey: queryKeys.deals.byIds(wanted),
    queryFn: () => api.getDealsByIds(wanted),
    enabled: enabled && wanted.length > 0,
    staleTime: 30_000,
  });
}

/** The tab numbers, under the same filters as the page; the server caches them thirty seconds. */
export function useDealCounts(params: DealCountsParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.deals.counts(params),
    queryFn: () => api.getDealCounts(params),
    staleTime: 30_000,
    enabled,
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: queryKeys.deals.detail(id),
    queryFn: () => api.getDeal(id),
  });
}

export function useDealProducts(id: string) {
  return useQuery({
    queryKey: queryKeys.deals.products(id),
    queryFn: () => api.getDealProducts(id),
  });
}

/** Server totals for the job's items (discount + tax applied). */
export function useDealTotals(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.dealTotals(id),
    queryFn: () => api.getDealTotals(id),
    enabled: enabled && !!id,
  });
}

export function useDealTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.deals.timeline(id),
    queryFn: ({ pageParam }) => api.getTimeline(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}


/**
 * The per-technician sent / seen stamps of a job (`ASSIGN#` rows). Only
 * fetched where they are shown — the job page's "Send to tech" card.
 */
export function useDealAssignments(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.deals.assignments(id),
    queryFn: () => api.getDealAssignments(id),
    enabled,
  });
}

export function useQualifiedTechs(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.deals.qualifiedTechs(id),
    queryFn: () => api.getQualifiedTechs(id),
    enabled,
  });
}

/** Suggested techs for a New Job — by job type, resolved area and address point. */
export function useSuggestedTechs(
  params: { jobTypeId?: string; serviceAreaId?: string; lat?: number; lng?: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["deals", "suggested-techs", params],
    queryFn: () => api.suggestQualifiedTechs(params),
    enabled,
  });
}

/* --------------------------------------------------------------- joins */

/** userId → User (technicians + dispatchers), shared with the Technicians cache. */
/**
 * What a name join needs, and no more.
 *
 * A restricted viewer only ever gets these three fields back, so this is the
 * honest type for a shared user map — widening it to `User` would let a
 * consumer read an email or a phone that is simply absent for them.
 */
export type DirectoryUser = Pick<User, "id" | "firstName" | "lastName"> & {
  /**
   * Present only when the viewer may list users. Several screens fall back to
   * it when somebody has no name set — a restricted viewer simply falls
   * through to the id instead, which is the honest outcome.
   */
  email?: string;
  /** Same: present only when the viewer may list users. */
  department?: string;
};

/**
 * id → teammate, for turning assignment ids into names.
 *
 * Two paths, because two kinds of viewer:
 *
 *  - **May list users** → the whole directory, as before. `ids` is ignored.
 *  - **May not** (a technician holds `users.view: false`) → `GET /users` would
 *    403, the map would come back empty, and every consumer would render a raw
 *    uuid where a name belongs. So those ids are resolved through
 *    `POST /users/by-ids`, which returns a name and nothing else and cannot be
 *    used to enumerate.
 *
 * A restricted viewer who passes no ids gets an empty map and makes no request
 * — there is nothing to look up, and nothing to fish for.
 */
export function useUserMap(ids?: string[]) {
  const { can, isLoading: permsLoading } = usePermissions();
  // While permissions are still resolving, `can()` answers false for
  // everything — so committing to the restricted path here would flash raw
  // uuids at a manager before flipping to names. Assume the directory (which
  // may already be cached) and fetch nothing until we actually know.
  const canList = permsLoading || can("users", "view");

  // Sorted and de-duplicated so the cache key is stable across renders.
  const wanted = useMemo(
    () => [...new Set(ids ?? [])].filter(Boolean).sort(),
    [ids],
  );

  const directory = useQuery({
    queryKey: queryKeys.technicians.userMap(),
    queryFn: () => fetchAllUsers(),
    enabled: !permsLoading && canList,
  });

  const names = useQuery({
    queryKey: ["user-names", wanted],
    queryFn: () => getUserNames(wanted),
    enabled: !permsLoading && !canList && wanted.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const q = canList ? directory : names;
  const map = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    for (const u of (q.data as DirectoryUser[] | undefined) ?? []) m.set(u.id, u);
    return m;
  }, [q.data]);

  return {
    map,
    users: canList ? (directory.data ?? []) : [],
    isLoading: q.isLoading && (canList || wanted.length > 0),
  };
}

/* ----------------------------------------------------------- mutations */

function useInvalidateDeal(id?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
    if (id) {
      qc.invalidateQueries({ queryKey: queryKeys.deals.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.products(id) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(id) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.assignments(id) });
    }
  };
}

/**
 * Anything that changes what a job charges: the deal (tax snapshot, discount,
 * itemCount), its items, its totals and the invoice mirrored from it.
 */
function useInvalidateDealBilling(id: string) {
  const qc = useQueryClient();
  const invalidateDeal = useInvalidateDeal(id);
  return () => {
    invalidateDeal();
    qc.invalidateQueries({ queryKey: queryKeys.dealTotals(id) });
    qc.invalidateQueries({ queryKey: queryKeys.invoices.byDeal(id) });
  };
}

export function useCreateDeal() {
  const invalidate = useInvalidateDeal();
  return useMutation({
    mutationFn: (body: CreateDealValues) => api.createDeal(body),
    onSuccess: (d) => {
      invalidate();
      toast.success(`Deal #${d.dealNumber} created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateDeal(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (body: UpdateDealValues) => api.updateDeal(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Deal saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Re-point this job at another client — used when the details captured during a
 * call turn out to belong to somebody else.
 */
export function useChangeDealClient(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (contactId: string) => api.changeDealClient(id, contactId),
    onSuccess: () => {
      invalidate();
      // The new client's own job list gains this one.
      qc.invalidateQueries({ queryKey: queryKeys.contacts.all() });
      toast.success("Job moved to the new client");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Tags auto-save immediately (no Save button) and are optimistic: the chip
 * paints before the server round-trip, rolls back on error, reconciles on
 * settle. The success toast is left to the caller so it can say "Tag added"
 * vs "Tag removed".
 */
export function useSetDealTags(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (tagIds: string[]) => api.updateDeal(id, { tagIds }),
    onMutate: async (tagIds) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals.detail(id) });
      const previous = qc.getQueryData<Deal>(queryKeys.deals.detail(id));
      if (previous) {
        qc.setQueryData<Deal>(queryKeys.deals.detail(id), { ...previous, tagIds });
      }
      return { previous };
    },
    onError: (e, _tagIds, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.deals.detail(id), ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(),
  });
}

/**
 * Move a deal's status (super-status + optional sub-status). Auto-saves and is
 * optimistic so the new status paints before the round-trip; the success toast
 * is left to the caller. Gated server-side by deals.move_status.
 */
export function useMoveStatus(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (body: api.MoveStatusBody) => api.moveStatus(id, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals.detail(id) });
      const previous = qc.getQueryData<Deal>(queryKeys.deals.detail(id));
      if (previous) {
        qc.setQueryData<Deal>(queryKeys.deals.detail(id), {
          ...previous,
          superStatus: body.superStatus,
          subStatusId: body.subStatusId || undefined,
        });
      }
      return { previous };
    },
    onError: (e, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.deals.detail(id), ctx.previous);
      // A required-to-close gate (422) rolls the status back and tells the user
      // exactly which custom fields to fill — they stay on the job to fill them
      // (in the Custom fields section) and retry. Any other error is plain.
      const missing = getMissingCloseFields(e);
      if (missing) {
        const names = missing.map((f) => f.name).join(", ");
        toast.error(`Fill these required fields before closing the job: ${names}`);
      } else {
        toast.error(getApiErrorMessage(e));
      }
    },
    onSettled: () => invalidate(),
  });
}

export function useDeleteDeal() {
  const invalidate = useInvalidateDeal();
  return useMutation({
    mutationFn: (id: string) => api.deleteDeal(id),
    onSuccess: () => {
      invalidate();
      toast.success("Deal deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAssignTechs(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (techIds: string[]) => api.assignTechs(id, techIds),
    onSuccess: () => {
      invalidate();
      toast.success("Technicians updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUnassignTech(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (techId: string) => api.unassignTech(id, techId),
    onSuccess: () => {
      invalidate();
      toast.success("Technician removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Workiz "Send to tech". The job is stamped at the click — delivery is
 * asynchronous, so the toast names the channels rather than promising
 * arrival, and the per-channel outcome lands on the assignment rows a
 * moment later (hence the second, delayed refetch).
 */
export function useSendToTech(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (body: api.SendToTechBody) => api.sendToTech(id, body),
    onSuccess: (deal, body) => {
      invalidate();
      const via = body.channels.map((c) => SEND_TO_TECH_CHANNEL_LABEL[c]).join(" & ");
      // The card sends no `techIds` — that means "the whole roster", so the
      // count comes from the job the server handed back, not from the request.
      const recipients = body.techIds?.length ?? deal.assignedTechIds?.length ?? 0;
      toast.success(`Job sent to the technician${recipients === 1 ? "" : "s"} by ${via}`);
      // messaging reports each channel back through deal-service; give it a
      // beat, then pick the deliveries up without making the user reload.
      setTimeout(
        () => qc.invalidateQueries({ queryKey: queryKeys.deals.assignments(id) }),
        SEND_TO_TECH_DELIVERY_REFETCH_MS,
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** How long messaging is given to report its deliveries before the card refetches. */
export const SEND_TO_TECH_DELIVERY_REFETCH_MS = 4000;

/**
 * Workiz "Viewed job in app": the technician's own view of a job stamps it
 * seen the first time they open it. Fires once per mounted job, and only for
 * a technician actually on the roster — the endpoint ignores anyone else, so
 * this is about not making the request at all.
 */
export function useMarkSeenOnOpen(deal: Deal | undefined, viewerId: string | undefined) {
  const qc = useQueryClient();
  const marked = useRef<string | null>(null);
  const assigned = !!deal && !!viewerId && deal.assignedTechIds.includes(viewerId);
  const dealId = deal?.id;

  useEffect(() => {
    if (!assigned || !dealId || marked.current === dealId) return;
    marked.current = dealId;
    api
      .markDealSeen(dealId)
      .then((res) => {
        // Only the first open changes anything worth repainting.
        if (!res.first) return;
        qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
        qc.invalidateQueries({ queryKey: queryKeys.deals.assignments(dealId) });
      })
      // Silent: a technician opening a job must never see an error about a
      // read receipt they did not ask for.
      .catch(() => undefined);
  }, [assigned, dealId, qc]);
}

/** Reorder a technician's jobs, then refresh the board so badges catch up. */
export function useReorderDeals() {
  const invalidate = useInvalidateDeal();
  return useMutation({
    mutationFn: ({ techId, orderedDealIds }: { techId: string; orderedDealIds: string[] }) =>
      api.reorderDeals(techId, orderedDealIds),
    onSuccess: () => {
      invalidate();
      toast.success("Job order updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAddNote(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (note: string) => api.addNote(id, note),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateNote(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ entryId, timestamp, note }: { entryId: string; timestamp: string; note: string }) =>
      api.updateNote(id, entryId, { note, timestamp }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteNote(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ entryId, timestamp }: { entryId: string; timestamp: string }) =>
      api.deleteNote(id, entryId, timestamp),
    onSuccess: () => {
      invalidate();
      toast.success("Note deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAddProduct(id: string) {
  const invalidate = useInvalidateDealBilling(id);
  return useMutation({
    mutationFn: (body: AddProductValues) => api.addDealProduct(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Product added");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useReplaceProduct(id: string) {
  const invalidate = useInvalidateDealBilling(id);
  return useMutation({
    mutationFn: ({ lineId, body }: { lineId: string; body: AddProductValues }) =>
      api.replaceDealProduct(id, lineId, body),
    onSuccess: () => {
      invalidate();
      toast.success("Item updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useRemoveProduct(id: string) {
  const invalidate = useInvalidateDealBilling(id);
  return useMutation({
    mutationFn: (lineId: string) => api.removeDealProduct(id, lineId),
    onSuccess: () => {
      invalidate();
      toast.success("Product removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useMarkProductOrdered(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ lineId, ordered }: { lineId: string; ordered: boolean }) =>
      api.markDealProductOrdered(id, lineId, ordered),
    onSuccess: (_data, { ordered }) => {
      invalidate();
      toast.success(ordered ? "Marked as ordered" : "Marked as not ordered");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/* ------------------------------------------------------ tax / discount */

export function useSetDealTax(id: string) {
  const invalidate = useInvalidateDealBilling(id);
  return useMutation({
    mutationFn: (taxRateId: string | null) => api.setDealTax(id, taxRateId),
    onSuccess: (deal) => {
      invalidate();
      toast.success(deal.taxRateId ? `Tax set to ${deal.taxRateName ?? "rate"}` : "Tax removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useResetDealTax(id: string) {
  const invalidate = useInvalidateDealBilling(id);
  return useMutation({
    mutationFn: () => api.resetDealTaxAuto(id),
    onSuccess: () => {
      invalidate();
      toast.success("Tax reset to automatic");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useSetDealDiscount(id: string) {
  const invalidate = useInvalidateDealBilling(id);
  return useMutation({
    mutationFn: (discount: DocumentDiscount | null) => api.setDealDiscount(id, discount),
    onSuccess: (_deal, discount) => {
      invalidate();
      toast.success(discount ? "Discount applied" : "Discount removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Flip a line's `taxable` flag; the checkbox updates before the server answers. */
export function useSetProductTaxable(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDealBilling(id);
  const key = queryKeys.deals.products(id);
  return useMutation({
    mutationFn: ({ lineId, taxable }: { lineId: string; taxable: boolean }) =>
      api.setDealProductTaxable(id, lineId, taxable),
    onMutate: async ({ lineId, taxable }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DealProduct[]>(key);
      qc.setQueryData<DealProduct[]>(key, (old) =>
        old?.map((p) => (p.lineId === lineId ? { ...p, taxable } : p)),
      );
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(),
  });
}
