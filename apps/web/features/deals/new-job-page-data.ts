"use client";

import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useCallDetail } from "@/features/calls/hooks";
import { useCompanies, useContact, useContactByPhone, useContactSearch } from "@/features/clients/hooks";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useJobFieldSettings } from "@/features/job-field-settings/hooks";
import { useActiveJobSources } from "@/features/job-sources/active-hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useActiveJobTypes } from "@/features/job-types/active-hooks";
import { useEffectiveServiceArea, useServiceAreas } from "@/features/service-areas/hooks";
import { useSuggestedTechs } from "./hooks";

/** What the client picker needs typed before it searches, and how much it asks for. */
const SEARCH_MIN = 3;
const SEARCH_LIMIT = 16;

/**
 * Everything the New Job form shows when it opens, asked for at once — so the
 * form appears once, whole, instead of filling in under the dispatcher.
 *
 * Each field reads its own catalog and used to draw itself before it came:
 * the custom-field cards a beat after the form, pushing "Work order /
 * Platinum" down; the company "Loading…"; the required marks late. Opened
 * from a call or a client card it was worse — the form drew itself empty,
 * then again with the client in it, their area "Detecting…" and the team
 * "Finding technicians…".
 *
 * This calls the very hooks the fields call, so they find their answers in
 * the cache: the catalogs, the prefilled client, the call, the client's area
 * and who can go there, and the caller's number searched in the client book.
 * `ready` holds the form behind one skeleton until all of it is in — a
 * failure counts — and then latches: the form is a draft, and nothing that
 * refetches afterwards may take it away.
 *
 * The team directory is not waited for: it only names a technician once
 * somebody is picked.
 */
export function useNewJobPageData({
  contactId,
  callSid,
  phone,
  address,
}: {
  /** `?contactId=` — the client the call or the client card already knows. */
  contactId?: string;
  /** `?callSid=` — the call the job is being made from. */
  callSid?: string;
  /** `?phone=` — an unknown caller's number, searched in the client book. */
  phone?: string;
  /** Where the job starts out: the prefilled client's address, once they are in. */
  address?: { lat?: number; lng?: number };
}): { ready: boolean } {
  const { isLoading: permsLoading } = usePermissions();

  // The catalogs the fields draw from.
  const catalogs = [
    useJobTags(),
    useCompanies(),
    useCustomFields(),
    useJobFieldSettings(),
    useServiceAreas(),
    useActiveJobTypes(),
    useActiveJobSources(),
    useBusinessProfiles(),
    useExternalCompanies(),
  ];

  // What the link brought.
  const contact = useContact(contactId ?? "");
  const call = useCallDetail(callSid ?? "");
  const query = phone?.trim() ?? "";
  const search = useContactSearch(query.length >= SEARCH_MIN ? query : "", SEARCH_LIMIT);
  // …and checked for an exact owner, as the picker does before it offers to
  // create them — so a Create clicked at once adopts that client, not a twin.
  const digits = query.replace(/\D/g, "");
  const isPhone = digits.length >= 7 && digits.length >= query.length - 6;
  const owner = useContactByPhone(isPhone ? query : "", isPhone);

  // The client's address → its area (and the company it defaults to), and
  // who can go there — the same questions the Service Location card and the
  // team picker ask, with the same answers.
  const lat = address?.lat;
  const lng = address?.lng;
  const area = useEffectiveServiceArea(lat, lng, undefined);
  const suggestions = useSuggestedTechs({ lat, lng }, lat !== undefined && lng !== undefined);

  const allIn =
    !permsLoading &&
    [...catalogs, contact, call, owner, suggestions].every(settled) &&
    !search.isLoading &&
    !area.isFetching;

  // The page is not keyed by anything: once the form is up it stays up.
  return { ready: usePageReady(allIn) };
}
