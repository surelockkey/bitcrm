"use client";

/**
 * The job page's Details tab, laid out as Workiz lays it out
 * (job_b_01_details_scroll0..3): Client | Schedule, then Job | Team, then the
 * custom-field groups in two columns (Extra Info | Other Contact, Dispatchers
 * | Tech, Platinum), and the single Save in the bar at the foot. The frame
 * around it — header, status, tags, tab bar, right rail — lives in
 * deal-detail-page.tsx.
 *
 * The grid is Workiz's own CSS (details-module): the body padded 40px 20px
 * 20px; each row two flex columns (at least 500px each, so they stack on a
 * narrow screen); a section 350–500px wide with 25px before it, 175px after
 * and 40px under it — 453px columns at x 245 / 898 on a 1600px screen.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ClientType, DealPriority, type Contact, type Deal } from "@bitcrm/types";
import { WzActionBar, WzButton, WzSectionHeader, WzSelect } from "@/components/workiz";
import { usePermissions } from "@/features/auth/use-permissions";
import { getApiErrorMessage } from "@/lib/api/errors";
import { fetchAllCompanies } from "@/features/clients/api";
import { useCompany, useContact, useCreateCompany, useUpdateContact } from "@/features/clients/hooks";
import type { UpdateContactValues } from "@/features/clients/schemas";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields, workizGroupColumns, workizOrderedGroups } from "@/features/custom-fields/lib";
import { WzCustomFields } from "@/features/custom-fields/components/wz-custom-fields";
import { useResolvedServiceArea } from "@/features/service-areas/hooks";
import { DEFAULT_TZ } from "@/lib/timezone";
import { useAssignTechs, useUpdateDeal } from "../hooks";
import { clientDraftFromContact, dealDraftFromDeal, type ClientDraft, type DealDraft } from "../lib";
import { commitDetailsSave, contactBodyWithCompany, planDetailsSave, resolveCompanyName } from "../job-details-form";
import { ChangeClientDialog, type ClientSaveDecision } from "./change-client-dialog";
import { DetailsRow, JobClientSection } from "./job-client-section";
import { JobNoteEditor } from "./job-note-editor";
import { JobTeamSection } from "./job-team-section";
import { useUnsavedChanges } from "./use-unsaved-changes";
import {
  WzBusinessProfileSelect,
  WzExternalCompanySelect,
  WzJobSourceSelect,
  WzJobTypeSelect,
  WzScheduleBlock,
} from "./workiz";

/** `details-module__detailsRow`: two columns that wrap below 2 × 500px. */
function ColumnsRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap *:min-w-full *:flex-1 md:*:min-w-[500px]">{children}</div>
  );
}

/** `details-module__section`: 350–500px, 25px in, 175px clear of the next column, 40px under. */
const SECTION = "mb-10 md:mr-[175px] md:ml-[25px] md:min-w-[350px] md:max-w-[500px]";

/**
 * Workiz's Save bar runs to the screen's right edge, under the rail, so its
 * button is centred on the page minus the sidebar whether or not the
 * Timeline is open (job_b_01_details, job_b_03_rail0). Ours ends at the
 * rail; this is how far right the button must move to sit where Workiz's
 * does.
 */
function useBarShift(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setShift(r.width ? Math.max(0, Math.round((window.innerWidth - r.right) / 2)) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [el]);
  return [setEl, shift];
}

const PRIORITY_OPTIONS = [
  { value: DealPriority.NORMAL, label: "Normal" },
  { value: DealPriority.URGENT, label: "Urgent" },
];

export function DetailsTab({
  deal,
  canEdit,
  onDirtyChange,
}: {
  deal: Deal;
  canEdit: boolean;
  /** Whether the draft holds unsaved edits — the page asks before its own buttons lead away. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { can, isTechnician } = usePermissions();
  const { data: contact } = useContact(deal.contactId);
  const { data: customFieldDefs } = useCustomFields();
  const update = useUpdateDeal(deal.id);
  const assignTechs = useAssignTechs(deal.id);
  const updateContact = useUpdateContact();
  const createCompany = useCreateCompany();
  const canEditClient = can("contacts", "edit");
  // Workiz's "Company name" is our client's CRM company (else the name the
  // job came with from Workiz); `null` while the box is untouched.
  const { data: clientCompany } = useCompany(contact?.companyId ?? "");
  const baseCompany = clientCompany?.title ?? deal.clientCompanyName ?? "";
  const [companyTyped, setCompanyTyped] = useState<string | null>(null);
  const company = { base: baseCompany, typed: companyTyped ?? baseCompany };

  // One draft per side — every field below is a controlled input writing here,
  // and the single Save at the bottom persists whatever actually changed.
  const [dealDraft, setDealDraft] = useState<DealDraft>(() => dealDraftFromDeal(deal));
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(() =>
    contact ? clientDraftFromContact(contact, deal.clientName) : null,
  );
  const input = { deal, contact, dealDraft, clientDraft, canEditClient, company };
  const plan = planDetailsSave(input);

  const syncedDealId = useRef(deal.id);
  useEffect(() => {
    // Re-sync the draft from the server, but never clobber unsaved edits. A
    // fresh deal (id change) always adopts server values; a same-deal refetch —
    // an instant action like status/tag/assign bumps updatedAt — only re-syncs
    // when the draft has no pending changes.
    const freshDeal = syncedDealId.current !== deal.id;
    syncedDealId.current = deal.id;
    if (!freshDeal && plan.dealPatch) return;
    setDealDraft(dealDraftFromDeal(deal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.updatedAt]);

  const syncedContactId = useRef(contact?.id);
  useEffect(() => {
    // Same guarded re-sync as the deal draft: keep unsaved client edits across a
    // plain contact refetch; adopt server values only for a different contact.
    const freshContact = syncedContactId.current !== contact?.id;
    syncedContactId.current = contact?.id;
    if (!freshContact && contact && clientDraft && (plan.contactBody || plan.nameChanged)) return;
    setClientDraft(contact ? clientDraftFromContact(contact, deal.clientName) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, contact?.updatedAt]);

  const setDeal = (patch: Partial<DealDraft>) => setDealDraft((d) => ({ ...d, ...patch }));

  // The job's timezone: its resolved service area's, else Connecticut.
  const { data: jobArea } = useResolvedServiceArea(dealDraft.address.lat, dealDraft.address.lng);
  const jobTz = jobArea?.timezone ?? DEFAULT_TZ;

  // Workiz's group order, each group at its Workiz side (job_b_01_details_scroll1:
  // Extra Info, Dispatchers, Platinum down the left; Other Contact, Tech down
  // the right) — by name, so a catalog without one of them keeps the rest
  // where Workiz has them (app_audit #7).
  const groups = workizOrderedGroups(applicableFields(customFieldDefs, dealDraft.jobTypeId));
  const columns = workizGroupColumns(groups).map((col) => col.map((g) => g.group));

  const [savingCompany, setSavingCompany] = useState(false);
  const pending = update.isPending || updateContact.isPending || savingCompany;
  const { confirm } = useUnsavedChanges(plan.dirty);
  useEffect(() => {
    onDirtyChange?.(plan.dirty);
  }, [plan.dirty, onDirtyChange]);
  const [asking, setAsking] = useState(false);

  // A rename (or an address the client could keep) is the only thing worth
  // asking about; everything else saves straight through.
  const save = () => (plan.ask ? setAsking(true) : commit({ applyToClient: true, address: "job-only" }));
  const commit = (decision: ClientSaveDecision) => {
    setAsking(false);
    const out = commitDetailsSave(input, decision);
    if (out.dealPatch) update.mutate(out.dealPatch);
    if (!contact) return;
    if (plan.companyChanged) void saveWithCompany(contact, out.contactBody);
    else if (out.contactBody) updateContact.mutate({ id: contact.id, body: out.contactBody });
  };

  /**
   * A changed Company name: the client's own company while it still says its
   * name, a company with that title, or a new one — then the contact, once,
   * with everything else edited alongside it.
   */
  const saveWithCompany = async (c: Contact, body: UpdateContactValues | null) => {
    setSavingCompany(true);
    try {
      const read = (companies: Awaited<ReturnType<typeof fetchAllCompanies>>) =>
        resolveCompanyName({ typed: company.typed, currentId: c.companyId, currentTitle: clientCompany?.title ?? "", companies });
      // The whole company list is only worth reading for a name that is new to this client.
      let r = read([]);
      if (r.kind === "create") r = read(await fetchAllCompanies());
      const companyId =
        r.kind === "clear"
          ? undefined
          : r.kind === "link"
            ? r.id
            : r.kind === "create"
              ? (await createCompany.mutateAsync({ title: r.title, clientType: ClientType.COMMERCIAL, phones: [], emails: [] })).id
              : c.companyId;
      setCompanyTyped(null);
      if (r.kind === "keep" && !body) return;
      updateContact.mutate({ id: c.id, body: contactBodyWithCompany(c, body, companyId) });
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setSavingCompany(false);
    }
  };

  const notesEditable = canEdit && !isTechnician;
  const [barRef, barShift] = useBarShift();

  return (
    <>
      {/* The page's own scroll region carries these fields; nothing here
          scrolls on its own. */}
      <div data-testid="job-details" className="relative flex w-full max-w-[1400px] flex-1 flex-col px-[15px] pt-5 pb-5 md:px-5 md:pt-10">
        <ColumnsRow>
          <div>
            <div className={SECTION}>
              <JobClientSection
                deal={deal}
                contact={contact}
                draft={clientDraft}
                onDraftChange={setClientDraft}
                companyName={company.typed}
                onCompanyNameChange={setCompanyTyped}
                canEditClient={canEditClient}
                canEdit={canEdit}
                address={dealDraft.address}
                onAddressChange={(address) => setDeal({ address })}
                serviceAreaId={dealDraft.serviceAreaId}
                onServiceAreaChange={(serviceAreaId) => setDeal({ serviceAreaId })}
              />
            </div>
          </div>
          <div>
            <div className={SECTION}>
              <WzScheduleBlock
                layout="section"
                // Workiz's Starts / At columns are 48% each (a 4% gap), so they
                // fit the 350px column the open Timeline leaves.
                // View schedule is at least 160px wide there (showScheduleButton).
                className="[&_.grid]:grid-cols-[48%_48%] [&_a[data-slot=wz-button]]:min-w-[160px]"
                tz={jobTz}
                disabled={!canEdit}
                viewScheduleHref="/schedule"
                value={{
                  date: dealDraft.scheduledDate,
                  endDate: dealDraft.scheduledEndDate,
                  slot: dealDraft.scheduledTimeSlot,
                  allDay: dealDraft.allDay,
                }}
                onChange={(s) =>
                  setDeal({
                    scheduledDate: s.date,
                    scheduledEndDate: s.endDate,
                    scheduledTimeSlot: s.slot,
                    allDay: s.allDay,
                  })
                }
              />
            </div>
          </div>
        </ColumnsRow>

        <ColumnsRow>
          <div>
            <section aria-label="Job" className={SECTION}>
              <WzSectionHeader>Job</WzSectionHeader>
              <DetailsRow>
                <WzJobTypeSelect
                  shape="square"
                  value={dealDraft.jobTypeId}
                  onChange={(jobTypeId) => setDeal({ jobTypeId })}
                  disabled={!canEdit}
                  canCreate={can("job_types", "create")}
                />
              </DetailsRow>
              {/* Workiz nests this row in another, so External company sits 20px under it. */}
              <DetailsRow className="mb-5">
                <WzJobSourceSelect
                  shape="square"
                  value={dealDraft.sourceId}
                  onChange={(sourceId) => setDeal({ sourceId })}
                  disabled={!canEdit}
                  canCreate={can("job_sources", "create")}
                />
              </DetailsRow>
              <DetailsRow>
                <WzExternalCompanySelect
                  shape="square"
                  value={dealDraft.externalCompanyId}
                  onChange={(externalCompanyId) => setDeal({ externalCompanyId })}
                  disabled={!canEdit}
                />
              </DetailsRow>
              {/* Ours, not Workiz's: the company the job is issued under and
                  its priority — job fields, so with the job's other selects. */}
              <DetailsRow>
                <WzBusinessProfileSelect
                  shape="square"
                  value={dealDraft.businessProfileId}
                  fallbackName={deal.businessProfileName}
                  onChange={(businessProfileId) => setDeal({ businessProfileId })}
                  disabled={!canEdit}
                />
              </DetailsRow>
              <DetailsRow>
                <WzSelect
                  label="Priority"
                  shape="square"
                  searchable={false}
                  options={PRIORITY_OPTIONS}
                  value={dealDraft.priority}
                  onChange={(v) => v && setDeal({ priority: v as DealPriority })}
                  disabled={!canEdit}
                />
              </DetailsRow>
              {/* The job's description: Workiz's editor, our note. */}
              <DetailsRow>
                <JobNoteEditor
                  value={dealDraft.notes}
                  onChange={(notes) => setDeal({ notes })}
                  editable={notesEditable}
                  ariaLabel="Notes"
                  placeholder="Description"
                />
              </DetailsRow>
            </section>
          </div>
          <div>
            <div className={SECTION}>
              <JobTeamSection
                deal={deal}
                canEdit={canEdit}
                jobTypeId={dealDraft.jobTypeId}
                address={{ lat: dealDraft.address.lat, lng: dealDraft.address.lng }}
                serviceAreaId={dealDraft.serviceAreaId || undefined}
                onChange={(ids) => assignTechs.mutate(ids)}
              />
            </div>
          </div>
        </ColumnsRow>

        {groups.length ? (
          // details-module__customRow: two columns, each a stack 40px apart.
          <div className="grid w-full grid-cols-1 items-start gap-y-10 pb-10 md:grid-cols-2">
            {columns.map((col, c) =>
              col.length ? (
                <div key={c} data-cf-column={c === 0 ? "left" : "right"} className="flex min-w-0 flex-col gap-y-10">
                  {col.map((group) => (
                    <WzCustomFields
                      key={group}
                      layout="section"
                      onlyGroup={group}
                      jobTypeId={dealDraft.jobTypeId}
                      value={dealDraft.customFields}
                      onChange={(customFields) => setDeal({ customFields })}
                      dealId={deal.id}
                      disabled={!canEdit}
                      className="md:ml-[25px] md:max-w-[500px]"
                    />
                  ))}
                </div>
              ) : null,
            )}
          </div>
        ) : null}

        {confirm}

        {contact && clientDraft && asking ? (
          <ChangeClientDialog
            open
            nameChanged={plan.nameChanged}
            newAddress={plan.newAddress}
            pending={pending}
            onCancel={() => setAsking(false)}
            onConfirm={commit}
          />
        ) : null}
      </div>

      {/* One Save for the whole page (.sbmt_bar): pinned to the foot of the
          page's scroll region, so it stays on screen while the fields scroll
          under it. Workiz has no Reset: leaving with unsaved edits asks first. */}
      {canEdit || canEditClient ? (
        <WzActionBar ref={barRef} className="sticky bottom-0 z-10">
          <WzButton
            size="big"
            className="min-w-[200px]"
            style={barShift ? { transform: `translateX(${barShift}px)` } : undefined}
            loading={pending}
            disabled={!plan.dirty || !plan.phonesOk}
            onClick={save}
          >
            Save
          </WzButton>
        </WzActionBar>
      ) : null}
    </>
  );
}
