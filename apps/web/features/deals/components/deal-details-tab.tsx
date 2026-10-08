"use client";

/**
 * The job page's Details tab: the form body (Client, Schedule, Job, Team, the
 * custom-field groups) and its single sticky Save bar. The frame around it —
 * header, status, tags, tab bar, right rail — lives in deal-detail-page.tsx.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, X } from "lucide-react";
import { DealPriority, type Contact, type Deal } from "@bitcrm/types";
import type { UpdateDealValues } from "../schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact, useUpdateContact } from "@/features/clients/hooks";
import {
  ChangeClientDialog,
  type ClientSaveDecision,
} from "./change-client-dialog";
import {
  addressInList,
  contactName,
  extensionOf,
  formatPhoneWithExtension,
} from "@/features/clients/lib";
import { PhoneInput } from "@/components/ui/phone-input";
import { isValidPhone, MAX_EXTENSION_LENGTH, normalizeExtension } from "@/lib/phone";
import { JobTypeSelect } from "@/features/job-types/components/job-type-select";
import { BusinessProfileSelect } from "@/features/business-profiles/components/business-profile-select";
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import { ExternalCompanySelect } from "@/features/external-companies/components/external-company-select";
import { CustomFieldsSection } from "@/features/custom-fields/components/custom-fields-section";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields, workizOrderedGroups } from "@/features/custom-fields/lib";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { JobDialCard } from "@/features/telephony/components/job-dial-card";
import { MaskedClientPhones } from "./masked-client-phones";
import { useAssignTechs, useUpdateDeal } from "../hooks";
import {
  buildContactBody,
  buildDealPatch,
  clientDraftFromContact,
  dealDraftFromDeal,
  type ClientDraft,
  type DealDraft,
} from "../lib";
import { DealNotesCard } from "./deal-notes-card";
import { SendToTechCard } from "./send-to-tech-card";
import { TeamSection } from "./team-section";
import { DealAddressFields, type DealAddressValue } from "./deal-address-fields";
import { ScheduledBlock } from "./scheduled-block";
import { useEffectiveServiceArea, useResolvedServiceArea } from "@/features/service-areas/hooks";
import { ServiceAreaField } from "@/features/service-areas/components/service-area-field";
import { DEFAULT_TZ } from "@/lib/timezone";
import { useUnsavedChanges } from "./use-unsaved-changes";

/* -------------------------------------------------------------- details tab */

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    // Plain, borderless — just a titled block, Workiz-style.
    <div className="h-full">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="h-px flex-1 bg-border" />
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

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
  const syncedDealId = useRef(deal.id);
  useEffect(() => {
    // Re-sync the draft from the server, but never clobber unsaved edits. A
    // fresh deal (id change) always adopts server values; a same-deal refetch —
    // an instant action like status/tag/assign bumps updatedAt — only re-syncs
    // when the draft has no pending changes.
    const freshDeal = syncedDealId.current !== deal.id;
    syncedDealId.current = deal.id;
    if (!freshDeal && buildDealPatch(deal, dealDraft)) return;
    setDealDraft(dealDraftFromDeal(deal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.updatedAt]);

  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(() =>
    contact ? clientDraftFromContact(contact, deal.clientName) : null,
  );
  const syncedContactId = useRef(contact?.id);
  useEffect(() => {
    // Same guarded re-sync as the deal draft: keep unsaved client edits across a
    // plain contact refetch; adopt server values only for a different contact.
    const freshContact = syncedContactId.current !== contact?.id;
    syncedContactId.current = contact?.id;
    if (!freshContact && contact && clientDraft && buildContactBody(contact, clientDraft)) return;
    setClientDraft(contact ? clientDraftFromContact(contact, deal.clientName) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, contact?.updatedAt]);

  const setDeal = (patch: Partial<DealDraft>) => setDealDraft((d) => ({ ...d, ...patch }));

  // Recomputes as the draft's job type changes — the applicable set is scoped to it.
  // One card per custom-field group, Workiz-ordered — same as the New Job form.
  const orderedCfGroups = workizOrderedGroups(applicableFields(customFieldDefs, dealDraft.jobTypeId));

  // The job's timezone: its resolved service area's, else Connecticut.
  const { data: jobArea } = useResolvedServiceArea(dealDraft.address.lat, dealDraft.address.lng);
  // Що дала б адреса, якби площу не обирали руками — відповідь для «Авто».
  const autoArea = useEffectiveServiceArea(dealDraft.address.lat, dealDraft.address.lng, undefined);
  const jobTz = jobArea?.timezone ?? DEFAULT_TZ;

  const dealPatch = buildDealPatch(deal, dealDraft);
  // A changed service address is also offered to the client's saved list — but
  // that's a contact write, so it (and any client-field edit) is gated on
  // `contacts.edit`. Without it, a deals-only editor never touches the contact.
  // A rename is the only client edit that prompts: it either follows the
  // client record or stays a per-job label. Phones/emails live on the client
  // record alone, so they save straight through. The rename is measured
  // against what the job currently shows (its override, else the contact).
  const baseFirstName = deal.clientName?.firstName ?? contact?.firstName ?? "";
  const baseLastName = deal.clientName?.lastName ?? contact?.lastName ?? "";
  const nameChanged =
    !!contact &&
    !!clientDraft &&
    (clientDraft.firstName.trim() !== baseFirstName ||
      clientDraft.lastName.trim() !== baseLastName);
  // The client box shows the job's name for the client, so the name only
  // counts as an edit against that — never against the contact's own name,
  // which a job imported with its own name for the client never matches.
  const contactBody =
    canEditClient && contact && clientDraft
      ? buildContactBody(contact, clientDraft, dealPatch?.address ? dealDraft.address : undefined, {
          includeName: nameChanged,
        })
      : null;
  const dirty = !!dealPatch || !!contactBody || (canEditClient && nameChanged);
  const pending = update.isPending || updateContact.isPending;
  // A half-typed phone must not ride a Save into the client record; the
  // input itself is already explaining what's wrong, live.
  const phonesOk =
    !clientDraft || clientDraft.phones.every((p) => !p.trim() || isValidPhone(p));

  const { confirm } = useUnsavedChanges(dirty);

  // A service location the client doesn't have on file yet.
  const newAddress =
    contact && dealPatch?.address && !addressInList(dealDraft.address, contact.addresses)
      ? dealDraft.address
      : undefined;

  const [asking, setAsking] = useState(false);

  const save = () => {
    // A rename (or a new address) is the only thing worth asking about;
    // everything else saves straight through.
    if (canEditClient && contact && (nameChanged || newAddress)) {
      setAsking(true);
      return;
    }
    commit({ applyToClient: true, address: "job-only" });
  };

  const commit = (decision: ClientSaveDecision) => {
    setAsking(false);

    // "Just here" pins the new name to this job; "Yes, make change" writes it
    // to the contact record and drops any stale per-job pin.
    const overridePatch: Partial<UpdateDealValues> =
      canEditClient && contact && clientDraft && nameChanged
        ? decision.applyToClient
          ? deal.clientName
            ? { clientName: null }
            : {}
          : {
              clientName: {
                firstName: clientDraft.firstName.trim(),
                lastName: clientDraft.lastName.trim(),
              },
            }
        : {};
    const patch = { ...(dealPatch ?? {}), ...overridePatch };
    if (Object.keys(patch).length > 0) update.mutate(patch);

    if (!contact || !clientDraft || !canEditClient) return;
    const body = buildContactBody(
      contact,
      clientDraft,
      decision.address === "save" ? newAddress : undefined,
      // Only a rename the dispatcher made, and chose to apply, reaches the
      // contact — the job's own name for the client never does.
      { includeName: nameChanged && decision.applyToClient },
    );
    if (body) updateContact.mutate({ id: contact.id, body });
  };
  const reset = () => {
    setDealDraft(dealDraftFromDeal(deal));
    setClientDraft(contact ? clientDraftFromContact(contact, deal.clientName) : null);
  };

  return (
    <>
    {/* The page's own scroll region carries these fields; nothing here
        scrolls on its own. */}
    <div className="relative flex-1 p-6">
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
      {/* Client */}
      <Section
        title="Client"
        action={
          contact ? (
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
              <Link href={`/contacts/${contact.id}`}>
                <ExternalLink className="size-3.5" /> View client
              </Link>
            </Button>
          ) : null
        }
      >
        {contact && clientDraft ? (
          <ClientEditor contact={contact} draft={clientDraft} onChange={setClientDraft} canEdit={canEditClient} dealId={deal.id} />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
        {/* Address lives in the Client card, as on the Workiz form. */}
        <DealAddressEditor
          value={dealDraft.address}
          onChange={(a) => setDeal({ address: a })}
          clientAddresses={contact?.addresses}
          canEdit={canEdit}
        />
        {/* Той самий вибір, що й на створенні роботи: площа — запис довідника,
            а не текст. Вільне поле пускало назву, якої в довіднику немає, і
            робота випадала з фільтрів і звітів за площею. */}
        <ServiceAreaField
          lat={dealDraft.address.lat}
          lng={dealDraft.address.lng}
          value={dealDraft.serviceAreaId || undefined}
          disabled={!canEdit}
          // «Авто» на вже створеній роботі — це конкретна площа, яку дає
          // адреса: id мусить бути, інакше збереження нічого не змінить.
          onChange={(id) => setDeal({ serviceAreaId: id ?? autoArea.submitId ?? "" })}
        />
      </Section>

      {/* Schedule */}
      <Section title="Schedule">
        <ScheduledBlock
          date={dealDraft.scheduledDate || ""}
          endDate={dealDraft.scheduledEndDate || ""}
          slot={dealDraft.scheduledTimeSlot || ""}
          allDay={dealDraft.allDay}
          tz={jobTz}
          areaName={jobArea?.name}
          onChange={(s) =>
            setDeal({
              scheduledDate: s.date,
              scheduledEndDate: s.endDate,
              scheduledTimeSlot: s.slot,
              allDay: s.allDay,
            })
          }
        />
      </Section>

      {/* Job */}
      <Section title="Job">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Job type">
            <JobTypeSelect value={dealDraft.jobTypeId} onChange={(val) => setDeal({ jobTypeId: val })} disabled={!canEdit} />
          </Field>
          <Field label="Company">
            <BusinessProfileSelect
              className="h-9"
              value={dealDraft.businessProfileId}
              fallbackName={deal.businessProfileName}
              placeholder="Default company"
              onChange={(val) => setDeal({ businessProfileId: val ?? "" })}
              disabled={!canEdit}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <JobSourceSelect value={dealDraft.sourceId} onChange={(val) => setDeal({ sourceId: val })} disabled={!canEdit} />
          </Field>
          <Field label="External company">
            <ExternalCompanySelect
              value={dealDraft.externalCompanyId}
              onChange={(val) => setDeal({ externalCompanyId: val ?? "" })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Priority">
            <Select value={dealDraft.priority} onValueChange={(val) => setDeal({ priority: val as DealPriority })} disabled={!canEdit}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DealPriority.NORMAL}>Normal</SelectItem>
                <SelectItem value={DealPriority.URGENT}>Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* The job's note belongs with the job, the way Workiz shows it —
            a dispatcher reads what the job is about without scrolling past
            the schedule and the team. Saved by the page's single Save. */}
        <DealNotesCard
          notes={dealDraft.notes}
          editable={canEdit && !isTechnician}
          onNotesChange={(v) => setDeal({ notes: v })}
        />
      </Section>

      {/* Team — inline assign (Workiz-style): pick techs who can do the job,
          then hand them the job over the channels they use. */}
      <Section title="Team">
        {/* One technician per row, as Workiz lists them: the row has somewhere
            to put what a dispatcher does with that person. */}
        <TeamSection
          techIds={deal.assignedTechIds}
          canEdit={canEdit}
          onChange={(ids) => assignTechs.mutate(ids)}
          address={{ lat: dealDraft.address.lat, lng: dealDraft.address.lng }}
          jobTypeId={dealDraft.jobTypeId}
          dealId={deal.id}
        />
        <div className="border-t pt-3">
          <SendToTechCard deal={deal} canEdit={canEdit} />
        </div>
      </Section>

      {/* Custom fields — user-defined answers, held in the same draft and saved
          by the single Save below. Job-type scoped, so it re-renders on type change. */}
      {orderedCfGroups.map(({ group }) => (
        <Section key={group} title={group}>
          <CustomFieldsSection
            jobTypeId={dealDraft.jobTypeId}
            value={dealDraft.customFields}
            onChange={(cf) => setDeal({ customFields: cf })}
            dealId={deal.id}
            disabled={!canEdit}
            onlyGroup={group}
          />
        </Section>
      ))}

      </div>

      {confirm}

      {contact && clientDraft && asking ? (
        <ChangeClientDialog
          open
          nameChanged={nameChanged}
          newAddress={newAddress}
          pending={pending}
          onCancel={() => setAsking(false)}
          onConfirm={commit}
        />
      ) : null}
      </div>

      {/* One Save for the whole page — sticky to the bottom of the page's
          scroll region, so it stays on screen while the fields scroll under it. */}
      {canEdit || canEditClient ? (
        <div className="sticky bottom-0 z-10 flex items-center justify-center gap-2 border-t bg-background px-6 py-4 shadow-[0_-6px_16px_-8px_rgba(0,0,0,0.15)]">
          <Button variant="ghost" size="sm" disabled={!dirty || pending} onClick={reset}>Reset</Button>
          <Button variant="brand" size="sm" className="gap-1.5" disabled={!dirty || pending || !phonesOk} onClick={save}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
          </Button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------- service address edit */

function DealAddressEditor({
  value,
  onChange,
  clientAddresses,
  canEdit,
}: {
  value: DealAddressValue;
  onChange: (a: DealAddressValue) => void;
  clientAddresses?: Contact["addresses"];
  canEdit: boolean;
}) {
  if (!canEdit) {
    return (
      <div className="text-sm text-muted-foreground">
        {[value.street, value.unit].filter(Boolean).join(", ")}
        {value.city ? <div>{value.city}, {value.state} {value.zip}</div> : null}
      </div>
    );
  }

  return <DealAddressFields value={value} onChange={onChange} clientAddresses={clientAddresses} />;
}

/* ------------------------------------------------------------- client editor */

function ClientEditor({
  contact,
  draft,
  onChange,
  canEdit,
  dealId,
}: {
  contact: Contact;
  draft: ClientDraft;
  onChange: (d: ClientDraft) => void;
  canEdit: boolean;
  /** The job these calls are about — the bridge authorises against it. */
  dealId: string;
}) {
  const set = (patch: Partial<ClientDraft>) => onChange({ ...draft, ...patch });

  if (!canEdit) {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium">{contactName(contact)}</div>
        {contact.phones.map((p, i) => (
          // A job page is where somebody decides to ring the client, and on a
          // technician's phone that decision should not hinge on spotting a
          // 28px glyph at the end of a line of grey text.
          <div
            key={p}
            className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="truncate">{formatPhoneWithExtension(p, extensionOf(contact, p))}</span>
              {i === 0 ? <PrimaryBadge /> : null}
            </span>
            <CallClientButton to={p} partyId={contact.id} dealId={dealId} contactId={contact.id} phoneIndex={i} variant="prominent" />
          </div>
        ))}
        {/* The call button lives inside the phones loop above, and a masked
            viewer's `phones` is empty — so without this they would see that a
            number exists and have no way to ring it. */}
        {contact.phonesMasked ? (
          <MaskedClientPhones
            phoneCount={contact.phoneCount ?? 0}
            dealId={dealId}
            contactId={contact.id}
            className="space-y-1"
          />
        ) : null}
        {contact.emails[0] ? <div className="text-muted-foreground">{contact.emails[0]}</div> : null}
        <JobDialCard dealId={dealId} />
        <div className="pt-1 text-xs text-muted-foreground">Editing the client needs the “contacts · edit” permission.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="First name"><Input className="h-9" value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
        <Field label="Last name"><Input className="h-9" value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
      </div>
      <Field label="Phones">
        <div className="space-y-2">
          {draft.phones.map((p, i) => {
            // The number the job was created with is permanently bound to it:
            // it can't be edited or removed here, only new ones added.
            const locked = i === 0 && contact.phones.length > 0;
            return (
              <div key={i} className="flex items-center gap-2">
                <PhoneInput
                  className="flex-1"
                  value={p}
                  onChange={(v) => set({ phones: draft.phones.map((x, j) => (j === i ? v : x)) })}
                  usOnly
                  disabled={locked}
                />
                {/* What to press once this line answers — editable even on the
                    locked original number, since only the number itself is
                    bound to the job. */}
                <Input
                  className="h-9 w-[4.5rem] flex-none px-2 text-center text-sm"
                  placeholder="Ext."
                  aria-label={`Extension for phone ${i + 1}`}
                  inputMode="tel"
                  maxLength={MAX_EXTENSION_LENGTH}
                  value={draft.phoneExts[i] ?? ""}
                  onChange={(e) =>
                    set({
                      phoneExts: draft.phones.map((_, j) =>
                        j === i ? normalizeExtension(e.target.value) : draft.phoneExts[j] ?? "",
                      ),
                    })
                  }
                />
                {i === 0 ? <PrimaryBadge /> : null}
                {/* Dials what's on file, not the half-typed draft. */}
                {contact.phones.includes(p) ? (
                  <CallClientButton
                    to={p}
                    partyId={contact.id}
                    dealId={dealId}
                    contactId={contact.id}
                    // `i` indexes the DRAFT, which may hold unsaved rows; the
                    // server resolves against what is on file.
                    phoneIndex={contact.phones.indexOf(p)}
                  />
                ) : null}
                {!locked && draft.phones.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 flex-none"
                    onClick={() =>
                      set({
                        phones: draft.phones.filter((_, j) => j !== i),
                        phoneExts: draft.phoneExts.filter((_, j) => j !== i),
                      })
                    }
                    aria-label="Remove phone"
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            );
          })}
          {contact.phonesMasked ? (
            <MaskedClientPhones
              phoneCount={contact.phoneCount ?? 0}
              dealId={dealId}
              contactId={contact.id}
              className="space-y-1"
            />
          ) : null}
          <button type="button" className="text-xs font-medium text-brand" onClick={() => set({ phones: [...draft.phones, ""], phoneExts: [...draft.phoneExts, ""] })}>＋ Add phone</button>
        </div>
        <p className="text-xs text-muted-foreground">The first number is the one the job was created with — it stays with the job.</p>
      </Field>
      <Field label="Email"><Input className="h-9" value={draft.email} placeholder="name@example.com" onChange={(e) => set({ email: e.target.value })} /></Field>
      {/* Needed just as much by somebody who CAN edit the client: the card is
          about reaching them from a handset, not about who may edit what. */}
      <JobDialCard dealId={dealId} />
    </div>
  );
}

function PrimaryBadge() {
  return (
    <span className="rounded-chip bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
      Primary
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
