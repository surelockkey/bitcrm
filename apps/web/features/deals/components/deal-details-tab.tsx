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
import { DealPriority, type Deal } from "@bitcrm/types";
import { WzActionBar, WzButton, WzSectionHeader, WzSelect } from "@/components/workiz";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact, useUpdateContact } from "@/features/clients/hooks";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields, workizOrderedGroups } from "@/features/custom-fields/lib";
import { WzCustomFields } from "@/features/custom-fields/components/wz-custom-fields";
import { useResolvedServiceArea } from "@/features/service-areas/hooks";
import { DEFAULT_TZ } from "@/lib/timezone";
import { useAssignTechs, useUpdateDeal } from "../hooks";
import { clientDraftFromContact, dealDraftFromDeal, type ClientDraft, type DealDraft } from "../lib";
import { commitDetailsSave, planDetailsSave } from "../job-details-form";
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

const PRIORITY_OPTIONS = [
  { value: DealPriority.NORMAL, label: "Normal" },
  { value: DealPriority.URGENT, label: "Urgent" },
];

export function DetailsTab({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const { can, isTechnician } = usePermissions();
  const { data: contact } = useContact(deal.contactId);
  const { data: customFieldDefs } = useCustomFields();
  const update = useUpdateDeal(deal.id);
  const assignTechs = useAssignTechs(deal.id);
  const updateContact = useUpdateContact();
  const canEditClient = can("contacts", "edit");

  // One draft per side — every field below is a controlled input writing here,
  // and the single Save at the bottom persists whatever actually changed.
  const [dealDraft, setDealDraft] = useState<DealDraft>(() => dealDraftFromDeal(deal));
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(() =>
    contact ? clientDraftFromContact(contact, deal.clientName) : null,
  );
  const input = { deal, contact, dealDraft, clientDraft, canEditClient };
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

  // Workiz's group order, then alternately into the two columns: Extra Info,
  // Dispatchers, Platinum on the left; Other Contact, Tech on the right.
  const groups = workizOrderedGroups(applicableFields(customFieldDefs, dealDraft.jobTypeId)).map((g) => g.group);
  const columns = [groups.filter((_, i) => i % 2 === 0), groups.filter((_, i) => i % 2 === 1)];

  const pending = update.isPending || updateContact.isPending;
  const { confirm } = useUnsavedChanges(plan.dirty);
  const [asking, setAsking] = useState(false);

  // A rename (or an address the client could keep) is the only thing worth
  // asking about; everything else saves straight through.
  const save = () => (plan.ask ? setAsking(true) : commit({ applyToClient: true, address: "job-only" }));
  const commit = (decision: ClientSaveDecision) => {
    setAsking(false);
    const out = commitDetailsSave(input, decision);
    if (out.dealPatch) update.mutate(out.dealPatch);
    if (out.contactBody && contact) updateContact.mutate({ id: contact.id, body: out.contactBody });
  };

  const notesEditable = canEdit && !isTechnician;

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
                className="[&_.grid]:grid-cols-[48%_48%]"
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
                <div key={c} className="flex min-w-0 flex-col gap-y-10">
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
        <WzActionBar className="sticky bottom-0 z-10">
          <WzButton
            size="big"
            className="min-w-[200px]"
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
