"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, ChevronLeft, Loader2, X } from "lucide-react";
import { ClientType, ContactSource, ContactType, DealPriority } from "@bitcrm/types";
import type { Contact, CustomFieldValue } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useContact,
  useCreateContact,
  useCreateCompany,
  useUpdateContact,
  useCompanyMap,
} from "@/features/clients/hooks";
import { addressInList, clientTypeLabel, contactName } from "@/features/clients/lib";
import { CompanyPickerDialog } from "@/features/clients/components/company-picker-dialog";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  ClientSaveDialog,
  type ClientEdits,
  type ClientSaveDecision,
} from "@/features/clients/components/client-change-dialog";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useCreateDeal } from "../hooks";
import { updateDeal as updateDealApi } from "../api";
import { requestAttachmentUpload, uploadAttachmentBytes } from "../attachments-api";
import { useLinkCallToDeal } from "@/features/calls/hooks";
import { CallsToLink } from "@/features/calls/components/calls-to-link";
import { dealJobSchema, type DealJobValues } from "../schemas";
import { JobTypeSelect } from "@/features/job-types/components/job-type-select";
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { ResolvedAreaField } from "@/features/service-areas/components/resolved-area-field";
import { ClientPicker, type ClientDraft } from "./client-picker";
import { DealAddressFields } from "./deal-address-fields";
import { ScheduleField } from "./schedule-field";
import { CustomFieldsSection } from "@/features/custom-fields/components/custom-fields-section";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { useJobFieldSettings } from "@/features/job-field-settings/hooks";
import { missingRequiredJobFields } from "@/features/job-field-settings/lib";
import {
  applicableFields,
  missingRequiredCustomFields,
  workizOrderedGroups,
} from "@/features/custom-fields/lib";

export function NewDealPage() {
  const params = useSearchParams();

  // Opened from a call: the dialer sends the call and, when it knows them,
  // the client — so neither has to be typed while somebody is on the line.
  const callSid = params.get("callSid") ?? undefined;
  const prefillContactId = params.get("contactId") ?? undefined;
  const prefillPhone = params.get("phone") ?? undefined;

  const [callsToLink, setCallsToLink] = useState<string[]>(
    callSid ? [callSid] : [],
  );

  // The client is derived, not assigned during render: a call arrives with one
  // already resolved, and writing that into state while rendering is what React
  // warns about. `cleared` lets the user drop it and pick somebody else.
  const [chosen, setChosen] = useState<Contact | null>(null);
  const [cleared, setCleared] = useState(false);
  // A client created on this page needs no questions asked about them on save.
  // Kept here rather than in the form, which remounts whenever the client changes.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const prefilled = useContact(!cleared && prefillContactId ? prefillContactId : "");
  const contact = chosen ?? (cleared ? null : (prefilled.data ?? null));

  const setContact = (c: Contact | null, created = false) => {
    setChosen(c);
    setCleared(!c);
    setCreatedId(created && c ? c.id : null);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Jobs
        </Link>
        <h1 className="text-base font-semibold">New deal</h1>
        <span className="text-sm text-muted-foreground">· everything on one page</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Keyed on the client so the form takes fresh defaults — chiefly their
            address — when one resolves or is swapped, instead of writing to the
            form from render. Nothing typed is lost: picking a client is the
            first step, before any of the job fields exist. */}
        <DealForm
          key={contact?.id ?? "no-client"}
          contact={contact}
          onContact={setContact}
          createdHere={!!contact && contact.id === createdId}
          prefillPhone={prefillPhone}
          callSid={callSid}
          callsToLink={callsToLink}
          onCallsToLink={setCallsToLink}
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    // h-full: cards in a grid row stretch to the tallest neighbour.
    <div className="h-full rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}<span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DealForm({
  contact,
  onContact,
  createdHere,
  prefillPhone,
  callSid,
  callsToLink,
  onCallsToLink,
}: {
  contact: Contact | null;
  onContact: (c: Contact | null, created?: boolean) => void;
  /** The client was added on this page, so their details are already right. */
  createdHere: boolean;
  prefillPhone?: string;
  callSid?: string;
  callsToLink: string[];
  onCallsToLink: (sids: string[]) => void;
}) {
  const router = useRouter();
  const createDeal = useCreateDeal();
  const linkCall = useLinkCallToDeal();
  // A client the call already resolved to: adopt it so the client step is
  // answered before the page even renders.
  const updateContact = useUpdateContact();
  const { map: companyMap } = useCompanyMap();
  const { data: customFieldDefs } = useCustomFields();
  const { data: fieldSettings } = useJobFieldSettings();

  /** Red asterisk for a field the admin marked required (Settings → Job Fields). */
  const req = (id: string) =>
    fieldSettings?.requiredFields[id] ? <span className="text-destructive">*</span> : null;

  // Custom-field answers live outside the zod form: their applicability and
  // required-ness are data-driven from the catalog, so they're validated inline.
  const [customFields, setCustomFields] = useState<Record<string, CustomFieldValue>>({});
  const [cfError, setCfError] = useState<string | null>(null);
  // Files picked for file-type custom fields before the job exists (up to 5
  // per field). Held in memory and uploaded to S3 right after create.
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const setPendingFilesFor = (fieldId: string, files: File[]) =>
    setPendingFiles((prev) => {
      const next = { ...prev };
      if (files.length) next[fieldId] = files;
      else delete next[fieldId];
      return next;
    });
  const createContact = useCreateContact();

  // New-client details typed into the picker, created together with the job.
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(null);

  // Client edits, keyed by who they're for — swapping client drops them
  // without an effect to reset anything.
  const [draft, setDraft] = useState<{ id: string; edits: ClientEdits } | null>(null);
  const clientEdits: ClientEdits =
    draft && draft.id === contact?.id
      ? draft.edits
      : {
          firstName: contact?.firstName ?? "",
          lastName: contact?.lastName ?? "",
          phone: contact?.phones[0] ?? "",
        };
  const onClientEdits = (edits: ClientEdits) => {
    if (contact) setDraft({ id: contact.id, edits });
  };

  /** Job values held back until the save-time questions are answered. */
  const [pendingSave, setPendingSave] = useState<DealJobValues | null>(null);

  const form = useForm<DealJobValues>({
    resolver: zodResolver(dealJobSchema),
    defaultValues: {
      clientType: ClientType.RESIDENTIAL,
      jobTypeId: "",
      serviceArea: "",
      address: contact?.addresses?.[0]
        ? {
            street: contact.addresses[0].street,
            unit: contact.addresses[0].unit ?? "",
            city: contact.addresses[0].city,
            state: contact.addresses[0].state,
            zip: contact.addresses[0].zip,
            lat: contact.addresses[0].lat,
            lng: contact.addresses[0].lng,
          }
        : { street: "", unit: "", city: "", state: "", zip: "" },
      scheduledDate: "",
      scheduledTimeSlot: "",
      priority: DealPriority.NORMAL,
      sourceId: "",
      notes: "",
      tagIds: [],
    },
  });
  const err = form.formState.errors;
  const v = useWatch({ control: form.control }) as DealJobValues;

  /** Details differ from what's on file. */
  const clientChanged =
    !!contact &&
    (clientEdits.firstName.trim() !== contact.firstName ||
      clientEdits.lastName.trim() !== contact.lastName ||
      (!!clientEdits.phone && clientEdits.phone !== contact.phones[0]));

  const submit = form.handleSubmit((values) => {
    if (!contact && !clientDraft) return;
    // Required custom fields block submit just like other required deal fields.
    // A file held for post-create upload counts as answered.
    const effectiveCustomFields: Record<string, CustomFieldValue> = {
      ...customFields,
      ...Object.fromEntries(Object.keys(pendingFiles).map((id) => [id, "pending"])),
    };
    const missing = missingRequiredCustomFields(customFieldDefs, values.jobTypeId, effectiveCustomFields);
    if (missing.length) {
      setCfError(`Fill required field${missing.length > 1 ? "s" : ""}: ${missing.map((f) => f.name).join(", ")}`);
      return;
    }
    // Admin-required built-in fields block submit the same way (the backend
    // double-checks with a 422 naming the fields).
    const missingBuiltin = missingRequiredJobFields(fieldSettings, {
      values,
      clientPhone: contact?.phones[0] ?? clientDraft?.phone,
      clientEmail: contact?.emails[0] ?? clientDraft?.email,
    });
    if (missingBuiltin.length) {
      setCfError(`Fill required field${missingBuiltin.length > 1 ? "s" : ""}: ${missingBuiltin.join(", ")}`);
      return;
    }
    setCfError(null);
    // Only send answers for fields that apply to the chosen job type — switching
    // job type mid-form can leave answers for now-inapplicable fields, which the
    // backend would (correctly) reject.
    const applicableIds = new Set(applicableFields(customFieldDefs, values.jobTypeId).map((f) => f.id));
    const cleanCustomFields = Object.fromEntries(
      Object.entries(customFields).filter(([id]) => applicableIds.has(id)),
    );

    // Fresh details typed straight into the picker: adopt an exact-phone match
    // instead of duplicating them, otherwise create the client (with the job's
    // address as their first one) and then the job under them — one click.
    if (!contact && clientDraft) {
      if (clientDraft.existing) {
        onContact(clientDraft.existing, false);
        createJob(values, cleanCustomFields, clientDraft.existing);
      } else {
        createContact.mutate(
          {
            firstName: clientDraft.firstName,
            lastName: clientDraft.lastName,
            phones: clientDraft.phone ? [clientDraft.phone] : [],
            emails: clientDraft.email ? [clientDraft.email] : [],
            addresses: values.address?.street ? [values.address] : [],
            type: ContactType.RESIDENTIAL,
            source: ContactSource.PHONE_CALL,
          },
          {
            onSuccess: (c) => {
              onContact(c, true);
              createJob(values, cleanCustomFields, c);
            },
          },
        );
      }
      return;
    }
    if (!contact) return;

    // A client picked up mid-call is often "whoever answered this number", so
    // an edit is as likely to mean a new person as a typo. Same for an address
    // the client doesn't have: it might be a second property or a one-off site.
    // Ask once, here, rather than guessing — except for a client created on
    // this page, whose details are by definition already correct and whose
    // first address is simply theirs.
    const asksAboutClient = clientChanged && !createdHere;
    const asksAboutAddress =
      !createdHere && !addressInList(values.address, contact.addresses);
    if (asksAboutClient || asksAboutAddress) {
      setPendingSave(values);
      return;
    }
    finish(values, cleanCustomFields, { client: "update", address: "save" });
  });

  /**
   * Everything the save does once the questions (if any) are answered:
   * settle the client, then create the job.
   */
  const finish = (
    values: DealJobValues,
    cleanCustomFields: Record<string, CustomFieldValue>,
    decision: ClientSaveDecision,
  ) => {
    if (!contact) return;
    const saveAddress =
      decision.address === "save" &&
      !addressInList(values.address, contact.addresses);

    // "A different client" makes a new record and takes the number with it, so
    // future calls from it resolve to whoever the job is actually for. The old
    // client keeps their history untouched.
    if (clientChanged && decision.client === "create") {
      createContact.mutate(
        {
          firstName: clientEdits.firstName.trim(),
          lastName: clientEdits.lastName.trim(),
          phones: [clientEdits.phone || contact.phones[0]].filter(Boolean),
          emails: [],
          addresses: saveAddress ? [values.address] : [],
          type: contact.type,
          companyId: contact.companyId,
          source: ContactSource.PHONE_CALL,
          reassignPhones: true,
        },
        { onSuccess: (c) => createJob(values, cleanCustomFields, c) },
      );
      return;
    }

    if (clientChanged || saveAddress) {
      updateContact.mutate({
        id: contact.id,
        body: {
          firstName: clientChanged ? clientEdits.firstName.trim() : contact.firstName,
          lastName: clientChanged ? clientEdits.lastName.trim() : contact.lastName,
          phones: nextPhones(contact, clientChanged ? clientEdits.phone : ""),
          emails: contact.emails,
          addresses: saveAddress
            ? [...contact.addresses, values.address]
            : contact.addresses,
          companyId: contact.companyId,
          type: contact.type,
          title: contact.title,
          notes: contact.notes,
        },
      });
    }
    createJob(values, cleanCustomFields, contact);
  };

  const createJob = (
    values: DealJobValues,
    cleanCustomFields: Record<string, CustomFieldValue>,
    contact: Contact,
  ) => {
    createDeal.mutate(
      {
        contactId: contact.id,
        companyId: contact.companyId,
        ...values,
        scheduledDate: values.scheduledDate || undefined,
        scheduledTimeSlot: values.scheduledTimeSlot || undefined,
        sourceId: values.sourceId || undefined,
        notes: values.notes || undefined,
        poNumber: values.poNumber || undefined,
        workOrderId: values.workOrderId || undefined,
        customFields: Object.keys(cleanCustomFields).length ? cleanCustomFields : undefined,
      },
      {
        onSuccess: (deal) => {
          // Attach whichever calls are still switched on. Fire-and-forget:
          // the job exists either way, and the link can be added from the
          // call afterwards.
          for (const sid of callsToLink) {
            linkCall.mutate({ sid, dealId: deal.id });
          }
          void (async () => {
            // Files picked on the form upload now, under the fresh job, and
            // land in their custom fields. A failure doesn't lose the job —
            // the file can be re-attached on the job page.
            const entries = Object.entries(pendingFiles);
            if (entries.length) {
              try {
                const fileValues: Record<string, CustomFieldValue> = {};
                for (const [fieldId, files] of entries) {
                  const fieldIds: string[] = [];
                  for (const file of files) {
                    const ticket = await requestAttachmentUpload(deal.id, {
                      fileName: file.name,
                      contentType: file.type || "application/octet-stream",
                      size: file.size,
                    });
                    await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
                    fieldIds.push(ticket.id);
                  }
                  fileValues[fieldId] = fieldIds;
                }
                await updateDealApi(deal.id, {
                  customFields: { ...cleanCustomFields, ...fileValues },
                });
              } catch (e) {
                toast.error(
                  `Job created, but a file failed to upload (${getApiErrorMessage(e)}). Attach it on the job page.`,
                );
              }
            }
            router.push(`/deals/${deal.id}`);
          })();
        },
      },
    );
  };

  // One card per custom-field group, in the Workiz form order; groups the
  // catalog grew beyond that list follow alphabetically (groupFields' order).
  const orderedCfGroups = workizOrderedGroups(applicableFields(customFieldDefs, v.jobTypeId));

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6" noValidate>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Row 1 — Client Details | Service Location, as on the Workiz form. */}
        <Section title="Client Details">
          {contact ? (
            <ResolvedClient
              contact={contact}
              edits={clientEdits}
              onEdits={onClientEdits}
              onClear={() => onContact(null)}
              onContact={(c) => onContact(c)}
            />
          ) : null}
          <ClientPicker
            hidden={!!contact}
            contact={contact}
            initialPhone={prefillPhone}
            onDraft={setClientDraft}
            onResolved={(c, created) => {
              onContact(c, created);
              const ct = c.companyId ? companyMap.get(c.companyId)?.clientType : undefined;
              if (ct) form.setValue("clientType", ct);
            }}
          />
        </Section>

        <Section title="Service Location">
          <DealAddressFields
            value={v.address}
            onChange={(a) => form.setValue("address", a, { shouldValidate: true })}
            clientAddresses={contact?.addresses}
            error={err.address?.street?.message}
          />
          <ResolvedAreaField lat={v.address?.lat} lng={v.address?.lng} />
        </Section>

        {/* Row 2 — Job Details | Scheduled. */}
        <Section title="Job Details">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Job type</Label>
              <JobTypeSelect value={v.jobTypeId} onChange={(val) => form.setValue("jobTypeId", val, { shouldValidate: true })} />
              {err.jobTypeId?.message ? <p className="text-xs text-destructive">{err.jobTypeId.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label>Job source{req("source")}</Label>
              <JobSourceSelect value={v.sourceId} onChange={(val) => form.setValue("sourceId", val ?? "")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Client type" value={v.clientType} onChange={(val) => form.setValue("clientType", val as ClientType)} options={Object.values(ClientType).map((t) => ({ value: t, label: clientTypeLabel(t) }))} />
          </div>
          <div className="space-y-1.5"><Label>Job description{req("description")}</Label><Textarea rows={4} placeholder="What needs doing…" {...form.register("notes")} /></div>
          <div className="space-y-1.5"><Label>Tags{req("tags")}</Label><JobTagCombobox value={v.tagIds ?? []} onChange={(ids) => form.setValue("tagIds", ids)} /></div>
        </Section>

        <Section title="Scheduled">
          <ScheduleField
            date={v.scheduledDate || undefined}
            slot={v.scheduledTimeSlot || undefined}
            onDate={(d) => form.setValue("scheduledDate", d ?? "")}
            onSlot={(s) => form.setValue("scheduledTimeSlot", s, { shouldValidate: true })}
          />
          {typeof err.scheduledTimeSlot?.message === "string" ? <p className="text-xs text-destructive">{err.scheduledTimeSlot.message}</p> : null}
          <p className="text-xs text-muted-foreground">Assign technicians and add line items on the job page after creating.</p>
        </Section>

        {/* Custom-field groups, one Workiz-style card each. File fields prompt
            to save first (no dealId yet); required ones block submit inline. */}
        {orderedCfGroups.map(({ group }) => (
          <Section key={group} title={group}>
            <CustomFieldsSection
              jobTypeId={v.jobTypeId}
              value={customFields}
              onChange={setCustomFields}
              onlyGroup={group}
              pendingFiles={pendingFiles}
              onPendingFiles={setPendingFilesFor}
            />
          </Section>
        ))}

        {/* Calls this job will carry. Present whenever the page was opened
            from a call, or once a client is known and has call history. */}
        {callSid || contact ? (
          <Section title="Calls">
            <CallsToLink
              callSid={callSid}
              contactId={contact?.id}
              selected={callsToLink}
              onChange={onCallsToLink}
            />
          </Section>
        ) : null}

        {/* Work order / Platinum */}
        <Section title="Work order / Platinum">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>PO number{req("poNumber")}</Label><Input className="h-9" placeholder="C-PO / VPO" {...form.register("poNumber")} /></div>
            <div className="space-y-1.5"><Label>Work order link</Label><Input className="h-9" placeholder="https://…" {...form.register("workOrderId")} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Optional — for platinum-contract jobs.</p>
        </Section>
      </div>

      {cfError ? <p className="text-sm text-destructive">{cfError}</p> : null}

      {/* Sticky footer */}
      <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t bg-background/90 px-6 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">
          {contact
            ? `Client: ${contactName(contact)}`
            : clientDraft
              ? `New client: ${clientDraft.firstName} ${clientDraft.lastName} will be created with the job.`
              : "Pick a client or type new details to continue."}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" asChild><Link href="/deals">Cancel</Link></Button>
          <Button
            type="submit"
            variant="brand"
            className="gap-1.5"
            disabled={(!contact && !clientDraft) || createDeal.isPending || createContact.isPending}
          >
            {createDeal.isPending || createContact.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create job
          </Button>
        </div>
      </div>

      {contact && pendingSave ? (
        <ClientSaveDialog
          open
          original={contact}
          edits={clientEdits}
          clientChanged={clientChanged}
          newAddress={
            addressInList(pendingSave.address, contact.addresses)
              ? undefined
              : pendingSave.address
          }
          pending={createDeal.isPending || createContact.isPending}
          onCancel={() => setPendingSave(null)}
          onConfirm={(decision) => {
            const applicableIds = new Set(
              applicableFields(customFieldDefs, pendingSave.jobTypeId).map((f) => f.id),
            );
            finish(
              pendingSave,
              Object.fromEntries(
                Object.entries(customFields).filter(([id]) => applicableIds.has(id)),
              ),
              decision,
            );
          }}
        />
      ) : null}
    </form>
  );
}

/**
 * The edited number first, keeping the rest — a client can hold several, and
 * correcting the one they called from shouldn't drop the others.
 */
function nextPhones(contact: Contact, phone: string): string[] {
  if (!phone) return contact.phones;
  return [phone, ...contact.phones.filter((p) => p !== phone && p !== contact.phones[0])];
}

/* ------------------------------------------------------------- client picker */


/**
 * The client this job is for — their details editable in place, not behind an
 * Edit button. Nothing is written to the CRM here: edits are reported upward
 * and settled when the job is saved, because until then it isn't clear whether
 * this is a correction to them or a different person on their number.
 */
function ResolvedClient({
  contact,
  edits,
  onEdits,
  onClear,
  onContact,
}: {
  contact: Contact;
  edits: ClientEdits;
  onEdits: (e: ClientEdits) => void;
  onClear: () => void;
  /** Bubble the updated contact up after a company is (re)assigned. */
  onContact: (c: Contact) => void;
}) {
  const { map: companyMap, companies } = useCompanyMap();
  const update = useUpdateContact();
  const createCompany = useCreateCompany();
  const [pickerOpen, setPickerOpen] = useState(false);
  const companyName = contact.companyId
    ? (companyMap.get(contact.companyId)?.title ?? contact.companyId)
    : "";

  // Assigning a company is a direct write to the client's record (unlike the
  // name/phone edits, which are deferred to the save-time question).
  const assign = (companyId: string) => {
    setPickerOpen(false);
    update.mutate(
      {
        id: contact.id,
        body: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          phones: contact.phones,
          emails: contact.emails,
          addresses: contact.addresses,
          companyId,
          type: contact.type,
          title: contact.title,
          notes: contact.notes,
        },
      },
      { onSuccess: (c) => onContact(c) },
    );
  };

  const createAndAssign = (name: string) => {
    createCompany.mutate(
      { title: name, clientType: ClientType.COMMERCIAL, phones: [], emails: [] },
      { onSuccess: (co) => assign(co.id) },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {contact.companyId ? companyName : "Residential"}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mt-1 gap-1 text-muted-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" /> Change client
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          className="h-9"
          value={edits.firstName}
          onChange={(e) => onEdits({ ...edits, firstName: e.target.value })}
          placeholder="First name"
        />
        <Input
          className="h-9"
          value={edits.lastName}
          onChange={(e) => onEdits({ ...edits, lastName: e.target.value })}
          placeholder="Last name"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Company name</Label>
        <Button
          type="button"
          variant="outline"
          aria-label="Company name"
          className="h-9 w-full justify-start gap-2 font-normal"
          onClick={() => setPickerOpen(true)}
        >
          <Building2 className="size-4 flex-none text-muted-foreground" />
          <span className={companyName ? "flex-1 truncate text-left" : "flex-1 truncate text-left text-muted-foreground"}>
            {companyName || "Select or create a company…"}
          </span>
        </Button>
      </div>
      <CompanyPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        companies={companies}
        onSelect={assign}
        onCreate={createAndAssign}
      />
      <PhoneInput
        value={edits.phone}
        onChange={(v) => onEdits({ ...edits, phone: v })}
        placeholder="Phone"
        lockCountry
      />
      <p className="text-xs text-muted-foreground">
        Edits here are saved with the job — you&apos;ll be asked whether they
        correct this client or belong to a new one.
      </p>
    </div>
  );
}

function Sel({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
