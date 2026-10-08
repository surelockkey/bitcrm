"use client";

/**
 * New Job (`/deals/new`), drawn as Workiz's `/root/newJob/` (new_01_empty,
 * new_07_client_search, new_12_client_picked): "New Job", then Client
 * Details | Service Location, Job Details | Scheduled and the custom-field
 * cards in a two-column grid of 8px-cornered white cards on #fafcfc, "Need to
 * track more fields?", and the yellow Create in the bar pinned underneath.
 * Every box is the Workiz kit (`@/components/workiz`) wired to our data
 * through `./workiz`; what Workiz lacks (our Company, the calls to link) is
 * drawn the same way, where Workiz would put it.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClientType, ContactSource, DealPriority } from "@bitcrm/types";
import type { Address, Contact, CustomFieldValue } from "@bitcrm/types";
import {
  WzActionBar,
  WzButton,
  WzCard,
  WzFieldError,
  WzFieldGroup,
  WzLink,
  WzMultiSelect,
  WzSuggestion,
  WzSuggestionList,
  WzTextField,
} from "@/components/workiz";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";
import { isValidPhone, normalizeExtension, MAX_EXTENSION_LENGTH } from "@/lib/phone";
import { DEFAULT_TZ, nowScheduleDefault } from "@/lib/timezone";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useCompanyMap,
  useContact,
  useContactByPhone,
  useCreateCompany,
  useCreateContact,
  useUpdateContact,
} from "@/features/clients/hooks";
import { addressInList, contactName } from "@/features/clients/lib";
import { ClientSaveDialog, type ClientSaveDecision } from "@/features/clients/components/client-change-dialog";
import { useLinkCallToDeal } from "@/features/calls/hooks";
import { CallsToLink } from "@/features/calls/components/calls-to-link";
import { copyEstimateToJob } from "@/features/estimates/api";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { pickPrefillCompanyId } from "@/features/business-profiles/lib";
import { useEffectiveServiceArea } from "@/features/service-areas/hooks";
import { WzCustomFields } from "@/features/custom-fields/components/wz-custom-fields";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields, missingRequiredCustomFields } from "@/features/custom-fields/lib";
import { useJobFieldSettings } from "@/features/job-field-settings/hooks";
import { missingRequiredJobFields } from "@/features/job-field-settings/lib";
import { useJobTags } from "@/features/job-tags/hooks";
import { useCreateDeal } from "../hooks";
import { useNewJobPageData } from "../new-job-page-data";
import { updateDeal as updateDealApi, assignTechs as assignTechsApi } from "../api";
import { requestAttachmentUpload, uploadAttachmentBytes } from "../attachments-api";
import { dealJobSchema, type DealJobValues } from "../schemas";
import { noteToText } from "../note-html";
import {
  MAX_CLIENT_PHONES,
  clientFormFromContact,
  emptyClientForm,
  jobClientType,
  matchCompany,
  newContactBody,
  pickedClientChanges,
  type ClientForm,
  type ClientPhoneRow,
} from "../new-job-client";
import { JobNoteEditor } from "./job-note-editor";
import { useUnsavedChanges } from "./use-unsaved-changes";
import {
  WzBusinessProfileSelect,
  WzCountrySelect,
  WzExternalCompanySelect,
  WzJobSourceSelect,
  WzJobTypeSelect,
  WzScheduleBlock,
  WzServiceAreaSelect,
  WzStateSelect,
  WzTeamSelect,
  WzViewSchedule,
  countryOf,
} from "./workiz";
import { WzAddressField } from "./workiz/address-field";
import { WzClientNameField } from "./workiz/client-name-field";
import { WzPhoneField } from "./workiz/phone-field";

const REQUIRED = "Required field";

export function NewDealPage() {
  const params = useSearchParams();

  // Opened from a call: the dialer sends the call and, when it knows them,
  // the client — so neither has to be typed while somebody is on the line.
  // The call's tracked number can also carry a job source; it lands on the
  // form so the created job keeps the call's attribution.
  const callSid = params.get("callSid") ?? undefined;
  const prefillContactId = params.get("contactId") ?? undefined;
  // From the client card: which of its addresses the job is at (`address=1`,
  // or `new` for none), and where to go once the job exists — a new estimate
  // or the invoice, as Workiz's Create new → Estimate / Invoice do.
  const prefillAddress = params.get("address");
  const then = params.get("then");
  const prefillPhone = params.get("phone") ?? undefined;
  const prefillSourceId = params.get("sourceId") ?? undefined;
  // …and a company (business profile) from the number / call flow.
  const prefillCompanyId = params.get("companyId") ?? undefined;

  const prefilled = useContact(prefillContactId ?? "");

  // Everything the form shows when it opens — its catalogs, and what the link
  // brought (the client, their area and team, the call) — asked for at once;
  // the form waits behind one skeleton and then appears whole, for good.
  const page = useNewJobPageData({
    contactId: prefillContactId,
    callSid,
    phone: prefillPhone,
    address: prefilledAddress(prefilled.data ?? null, prefillAddress),
  });

  return (
    // Workiz's page under the cards is #fafcfc (new_01_empty), a one-off.
    <div className="flex flex-1 flex-col overflow-hidden bg-[#fafcfc]">
      {page.ready ? (
        <DealForm
          initialContact={prefilled.data ?? null}
          prefillPhone={prefillPhone}
          prefillSourceId={prefillSourceId}
          prefillCompanyId={prefillCompanyId}
          prefillAddress={prefillAddress}
          then={then}
          callSid={callSid}
        />
      ) : (
        <div className="mx-auto w-full max-w-[1400px] px-9">
          <div className="mt-[14px] flex h-[88px] items-center">
            <Skeleton className="h-6 w-40" />
          </div>
          <div className="grid grid-cols-2 gap-[30px]">
            <Skeleton className="h-[331px] rounded-[8px]" />
            <Skeleton className="h-[331px] rounded-[8px]" />
            <Skeleton className="h-[524px] rounded-[8px]" />
            <Skeleton className="h-[524px] rounded-[8px]" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Where a new job starts out: the client's address the link points at
 * (`address=1`), their first one by default, or none for `address=new`.
 */
function prefilledAddress(contact: Contact | null, which?: string | null): Address | undefined {
  if (which === "new") return undefined;
  return contact?.addresses?.[Number(which ?? 0) || 0];
}

/** A client's address as the job's service location. */
function jobAddress(a: Address | undefined): DealJobValues["address"] {
  return a
    ? {
        street: a.street,
        unit: a.unit ?? "",
        city: a.city,
        state: a.state,
        zip: a.zip,
        ...(a.country ? { country: a.country } : {}),
        lat: a.lat,
        lng: a.lng,
      }
    : { street: "", unit: "", city: "", state: "", zip: "" };
}

/** An empty rich-text note ("<p></p>") is no note. */
function cleanNote(html: string): string {
  return noteToText(html).trim() ? html : "";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Missing = { labels: string[]; ids: string[]; customIds: string[] };

function DealForm({
  initialContact,
  prefillPhone,
  prefillSourceId,
  prefillCompanyId,
  prefillAddress,
  then,
  callSid,
}: {
  initialContact: Contact | null;
  prefillPhone?: string;
  /** Job source the referring call was attributed to. */
  prefillSourceId?: string;
  /** Company the referring call was attributed to. */
  prefillCompanyId?: string;
  /** Which of the client's addresses the job is at (`"1"`), or `"new"` for none. */
  prefillAddress?: string | null;
  /** Where to go once the job exists: `estimate`, `invoice` or `copy-estimate:<id>`. */
  then?: string | null;
  callSid?: string;
}) {
  const router = useRouter();
  const { can } = usePermissions();
  const createDeal = useCreateDeal();
  const linkCall = useLinkCallToDeal();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const createCompany = useCreateCompany();
  const { map: companyMap, companies } = useCompanyMap();
  const { data: customFieldDefs } = useCustomFields();
  const { data: fieldSettings } = useJobFieldSettings();
  const required = (id: string) => Boolean(fieldSettings?.requiredFields[id]);

  /* ------------------------------------------------------------ the client */

  const titleOf = (c: Contact | null) => (c?.companyId ? companyMap.get(c.companyId)?.title : undefined);
  const [contact, setContact] = useState<Contact | null>(initialContact);
  // A client created on this page needs no questions asked about them on save.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState<ClientForm>(() =>
    initialContact ? clientFormFromContact(initialContact, titleOf(initialContact)) : emptyClientForm(prefillPhone),
  );
  const [initialClient] = useState(() => JSON.stringify(clientForm));
  const setClient = (patch: Partial<ClientForm>) => setClientForm((f) => ({ ...f, ...patch }));
  const setPhone = (i: number, patch: Partial<ClientPhoneRow>) =>
    setClientForm((f) => ({ ...f, phones: f.phones.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  // An unknown number that already belongs to a client: offer them, and adopt
  // them on Create rather than making a twin.
  const typedPhone = clientForm.phones[0]?.phone ?? "";
  const owner = useContactByPhone(typedPhone, !contact && isValidPhone(typedPhone));
  const phoneOwner = !contact ? (owner.data ?? null) : null;

  // The company a typed "Company name" means, and what kind of client that makes.
  const companyTitle = clientForm.company.trim();
  const matchedCompany = matchCompany(companies, companyTitle);
  const contactCompanyTitle = titleOf(contact) ?? "";
  const clientType = jobClientType(
    matchedCompany ?? (contact?.companyId ? companyMap.get(contact.companyId) : undefined),
    companyTitle,
  );

  /** Job values held back until the save-time questions are answered. */
  const [pendingSave, setPendingSave] = useState<{ values: DealJobValues; companyId?: string } | null>(null);

  /* --------------------------------------------------------------- the job */

  // Prefill the schedule with "now" in the business timezone (Connecticut).
  const scheduleNow = useMemo(() => nowScheduleDefault(), []);
  const form = useForm<DealJobValues>({
    resolver: zodResolver(dealJobSchema),
    defaultValues: {
      clientType: ClientType.RESIDENTIAL,
      jobTypeId: "",
      jobName: "",
      serviceArea: "",
      address: jobAddress(prefilledAddress(initialContact, prefillAddress)),
      scheduledDate: scheduleNow.date,
      scheduledEndDate: scheduleNow.date,
      scheduledTimeSlot: `${scheduleNow.start}-${scheduleNow.end}`,
      allDay: false,
      priority: DealPriority.NORMAL,
      sourceId: prefillSourceId ?? "",
      serviceAreaId: "",
      externalCompanyId: "",
      notes: "",
      tagIds: [],
    },
  });
  const v = useWatch({ control: form.control }) as DealJobValues;
  const address = v.address ?? jobAddress(undefined);
  const country = countryOf(address);
  const setAddress = (patch: Partial<DealJobValues["address"]>) =>
    form.setValue("address", { ...form.getValues("address"), ...patch }, { shouldDirty: true });

  // Manual pick > containing area > nearest fallback — one answer for the
  // field, the create payload, and the schedule's timezone alike.
  const effectiveArea = useEffectiveServiceArea(address.lat, address.lng, v.serviceAreaId || undefined);
  const jobTz = effectiveArea.area?.timezone ?? DEFAULT_TZ;

  // Workiz starts the schedule at the next quarter hour where the job is
  // ("It's 7:53 AM in Princeton" → 08:00–09:00): until somebody touches it,
  // the default follows the job's timezone as the address settles it.
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [defaultTz, setDefaultTz] = useState(DEFAULT_TZ);
  useEffect(() => {
    if (scheduleTouched || jobTz === defaultTz) return;
    const d = nowScheduleDefault(jobTz);
    form.setValue("scheduledDate", d.date);
    form.setValue("scheduledEndDate", d.date);
    form.setValue("scheduledTimeSlot", `${d.start}-${d.end}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remembers which zone the default was made in
    setDefaultTz(jobTz);
  }, [jobTz, scheduleTouched, defaultTz, form]);
  const verified = address.lat !== undefined && address.lng !== undefined;

  // Company: a hand pick sticks; until then it follows ?companyId= → the
  // effective area's default company → the account default.
  const { data: businessProfiles } = useBusinessProfiles();
  const [companyTouched, setCompanyTouched] = useState(false);
  const businessProfileId = companyTouched
    ? v.businessProfileId || undefined
    : pickPrefillCompanyId({
        queryId: prefillCompanyId,
        areaDefaultId: effectiveArea.area?.defaultBusinessProfileId,
        companies: businessProfiles,
      });

  // Answers live outside the zod form: applicability and required-ness are
  // data-driven from the catalog. Files picked before the job exists are held
  // here and uploaded right after create; techs are assigned then too.
  const [customFields, setCustomFields] = useState<Record<string, CustomFieldValue>>({});
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const setPendingFilesFor = (fieldId: string, files: File[]) =>
    setPendingFiles((prev) => {
      const next = { ...prev };
      if (files.length) next[fieldId] = files;
      else delete next[fieldId];
      return next;
    });
  const [assignTechIds, setAssignTechIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const { data: jobTags } = useJobTags();
  const [callsToLink, setCallsToLink] = useState<string[]>(callSid ? [callSid] : []);

  /* ------------------------------------------------------- what is missing */

  /**
   * Everything a blocked Create left empty, gathered in ONE pass: the
   * client, the address, the job type, the admin-required built-ins and the
   * required custom fields. Each field says "Required field" under itself
   * (Workiz's words) and the first one is brought into view.
   */
  const [missing, setMissing] = useState<Missing | null>(null);
  const collectMissing = (values: DealJobValues): Missing | null => {
    const labels: string[] = [];
    const ids: string[] = [];
    const mark = (id: string, label?: string) => {
      ids.push(id);
      if (label && !labels.includes(label)) labels.push(label);
    };
    if (!contact && !clientForm.name.trim() && !phoneOwner) mark("client", "Client");
    const phoneErr = clientForm.phones.some((r) => r.phone && !isValidPhone(r.phone));
    if (phoneErr) mark("phoneInvalid", "Client phone");
    if (clientForm.email.trim() && !EMAIL.test(clientForm.email.trim())) mark("emailInvalid", "Client email");
    if (!values.jobTypeId) mark("jobType", "Job type");
    const a = values.address;
    if (!a?.street?.trim()) mark("address", "Service address");
    if (!a?.city?.trim()) mark("city", "Service address");
    if (!a?.state?.trim()) mark("state", "Service address");
    if (!a?.zip?.trim()) mark("zip", "Service address");

    // A file held for post-create upload counts as answered.
    const answered: Record<string, CustomFieldValue> = {
      ...customFields,
      ...Object.fromEntries(Object.keys(pendingFiles).map((id) => [id, "pending"])),
    };
    const builtin = missingRequiredJobFields(fieldSettings, {
      values: { ...values, tagIds, serviceArea: effectiveArea.area?.name ?? "" },
      clientPhone: clientForm.phones[0]?.phone || contact?.phones[0],
      clientEmail: clientForm.email.trim() || contact?.emails[0],
    });
    for (const f of builtin) mark(f.id, f.label);
    const custom = missingRequiredCustomFields(customFieldDefs, values.jobTypeId, answered);
    for (const f of custom) labels.push(f.name);

    if (!ids.length && !custom.length) return null;
    return { labels, ids, customIds: custom.map((f) => f.id) };
  };
  // Re-judged every render once a Create has been blocked, so each mark
  // clears the moment its field is actually filled.
  const missingNow = missing ? collectMissing(v) : null;
  const errorFor = (id: string) => (missingNow?.ids.includes(id) ? REQUIRED : undefined);

  const blockOn = (report: Missing) => {
    setMissing(report);
    requestAnimationFrame(() => {
      document.querySelector('[aria-invalid="true"], [data-missing]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  /* ---------------------------------------------------------------- saving */

  const [created, setCreated] = useState(false);
  const busy = createDeal.isPending || createContact.isPending || createCompany.isPending || updateContact.isPending;

  const dirty =
    !created &&
    (form.formState.isDirty ||
      JSON.stringify(clientForm) !== initialClient ||
      contact?.id !== initialContact?.id ||
      Object.keys(customFields).length > 0 ||
      Object.keys(pendingFiles).length > 0 ||
      assignTechIds.length > 0);
  const { confirm } = useUnsavedChanges(dirty);

  const applicable = (values: DealJobValues) => {
    // Only answers for fields that apply to the chosen job type — switching
    // type mid-form can leave answers the backend would (rightly) refuse.
    const ids = new Set(applicableFields(customFieldDefs, values.jobTypeId).map((f) => f.id));
    return Object.fromEntries(Object.entries(customFields).filter(([id]) => ids.has(id)));
  };

  /**
   * The CRM company for the typed "Company name": the client's own when it
   * is unchanged, a matching one, or a new one created now (Workiz's company
   * name is free text; ours is a record).
   */
  const resolveCompany = (done: (companyId: string | undefined) => void) => {
    if (!companyTitle) return done(undefined);
    if (contact?.companyId && companyTitle.toLowerCase() === contactCompanyTitle.trim().toLowerCase()) {
      return done(contact.companyId);
    }
    if (matchedCompany) return done(matchedCompany.id);
    createCompany.mutate(
      { title: companyTitle, clientType: ClientType.COMMERCIAL, phones: [], emails: [] },
      { onSuccess: (co) => done(co.id) },
    );
  };

  const submit = form.handleSubmit(
    (values) => {
      const report = collectMissing(values);
      if (report) return blockOn(report);
      setMissing(null);
      const cf = applicable(values);

      resolveCompany((companyId) => {
        if (!contact) {
          // A number that already belongs to a client adopts them instead of
          // duplicating them; anybody else is created with the job's address
          // as their first, and the job under them — one click.
          if (phoneOwner) {
            setContact(phoneOwner);
            createJob(values, cf, phoneOwner);
            return;
          }
          createContact.mutate(newContactBody(clientForm, { companyId, address: values.address }), {
            onSuccess: (c) => {
              setContact(c);
              setCreatedId(c.id);
              createJob(values, cf, c);
            },
          });
          return;
        }

        // A client picked up mid-call is often "whoever answered this
        // number", so a new name or number is as likely a new person as a
        // typo; an address they don't have may be a second property or a
        // one-off. Ask once — except for a client created on this page.
        const createdHere = contact.id === createdId;
        const changes = pickedClientChanges(contact, clientForm, companyId);
        const asksAboutClient = changes.asks && !createdHere;
        const asksAboutAddress = !createdHere && !addressInList(values.address, contact.addresses);
        if (asksAboutClient || asksAboutAddress) {
          setPendingSave({ values, companyId });
          return;
        }
        finish(values, cf, { client: "update", address: "save" }, companyId);
      });
    },
    // Zod said no (job type / address) — still show every missing field.
    () => {
      const report = collectMissing(form.getValues() as DealJobValues);
      if (report) blockOn(report);
    },
  );

  /** Settle the picked client (as answered), then create the job. */
  const finish = (
    values: DealJobValues,
    cf: Record<string, CustomFieldValue>,
    decision: ClientSaveDecision,
    companyId: string | undefined,
  ) => {
    if (!contact) return;
    const changes = pickedClientChanges(contact, clientForm, companyId);
    const clientChanged = changes.asks && contact.id !== createdId;
    const saveAddress = decision.address === "save" && !addressInList(values.address, contact.addresses);

    // "A different client" makes a new record and takes the number with it,
    // so future calls from it resolve to whoever the job is actually for. The
    // old client keeps their history untouched.
    if (clientChanged && decision.client === "create") {
      createContact.mutate(
        {
          firstName: changes.edits.firstName.trim(),
          lastName: changes.edits.lastName.trim(),
          phones: [changes.edits.phone || contact.phones[0]].filter(Boolean),
          emails: clientForm.email.trim() ? [clientForm.email.trim()] : [],
          addresses: saveAddress ? [values.address] : [],
          type: contact.type,
          companyId: companyId ?? contact.companyId,
          source: ContactSource.PHONE_CALL,
          reassignPhones: true,
        },
        { onSuccess: (c) => createJob(values, cf, c) },
      );
      return;
    }

    if (clientChanged || saveAddress || changes.extras) {
      const extras = changes.extras;
      updateContact.mutate({
        id: contact.id,
        body: {
          firstName: clientChanged ? changes.edits.firstName : contact.firstName,
          lastName: clientChanged ? changes.edits.lastName : contact.lastName,
          phones: extras?.phones ?? contact.phones,
          phoneExtensions: extras ? extras.phoneExtensions : contact.phoneExtensions,
          emails: extras?.emails ?? contact.emails,
          addresses: saveAddress ? [...contact.addresses, values.address] : contact.addresses,
          companyId: extras ? extras.companyId : contact.companyId,
          type: extras?.type ?? contact.type,
          title: contact.title,
          notes: contact.notes,
        },
      });
    }
    createJob(values, cf, contact);
  };

  const createJob = (values: DealJobValues, cf: Record<string, CustomFieldValue>, client: Contact) => {
    createDeal.mutate(
      {
        contactId: client.id,
        companyId: client.companyId,
        ...values,
        clientType,
        jobName: values.jobName?.trim() || undefined,
        address: { ...values.address, country: countryOf(values.address) },
        tagIds,
        scheduledDate: values.scheduledDate || undefined,
        scheduledEndDate: values.scheduledDate ? values.scheduledEndDate || undefined : undefined,
        scheduledTimeSlot: values.allDay ? undefined : values.scheduledTimeSlot || undefined,
        allDay: values.allDay || undefined,
        sourceId: values.sourceId || undefined,
        businessProfileId,
        // Manual pick or the nearest-area fallback; absent, the backend
        // resolves from the address — its answer is the authoritative one.
        serviceAreaId: effectiveArea.submitId,
        externalCompanyId: values.externalCompanyId || undefined,
        notes: values.notes || undefined,
        poNumber: values.poNumber || undefined,
        workOrderId: values.workOrderId || undefined,
        customFields: Object.keys(cf).length ? cf : undefined,
      },
      {
        onSuccess: (deal) => {
          setCreated(true);
          // Fire-and-forget: the job exists either way, and a call or a tech
          // can be added on the job page if one of these ever fails.
          for (const sid of callsToLink) linkCall.mutate({ sid, dealId: deal.id });
          if (assignTechIds.length) {
            void assignTechsApi(deal.id, assignTechIds).catch((e) =>
              toast.error(`Job created, but assigning technicians failed (${getApiErrorMessage(e)}).`),
            );
          }
          void (async () => {
            // Files picked on the form upload now, under the fresh job, and
            // land in their custom fields.
            const entries = Object.entries(pendingFiles);
            if (entries.length) {
              try {
                const fileValues: Record<string, CustomFieldValue> = {};
                for (const [fieldId, files] of entries) {
                  const ids: string[] = [];
                  for (const file of files) {
                    const ticket = await requestAttachmentUpload(deal.id, {
                      fileName: file.name,
                      contentType: file.type || "application/octet-stream",
                      size: file.size,
                    });
                    await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
                    ids.push(ticket.id);
                  }
                  fileValues[fieldId] = ids;
                }
                await updateDealApi(deal.id, { customFields: { ...cf, ...fileValues } });
              } catch (e) {
                toast.error(`Job created, but a file failed to upload (${getApiErrorMessage(e)}). Attach it on the job page.`);
              }
            }
            // Workiz "Copy to job" from a client estimate: the new job gets
            // the estimate's items and the estimate moves onto it.
            const copyId = then?.startsWith("copy-estimate:") ? then.slice("copy-estimate:".length) : null;
            if (copyId) {
              let openId = copyId;
              try {
                const copied = await copyEstimateToJob(copyId, deal.id);
                openId = copied?.estimate?.id ?? copyId;
              } catch (e) {
                toast.error(`Job created, but the estimate could not be copied onto it (${getApiErrorMessage(e)}).`);
              }
              router.push(`/estimates/${encodeURIComponent(openId)}`);
              return;
            }
            router.push(
              then === "estimate"
                ? `/deals/${deal.id}?tab=estimates&estimate=new`
                : then === "invoice"
                  ? `/deals/${deal.id}?tab=invoice`
                  : `/deals/${deal.id}`,
            );
          })();
        },
      },
    );
  };

  /* --------------------------------------------------------- client events */

  const pick = (c: Contact) => {
    setContact(c);
    setCreatedId(null);
    setClientForm(clientFormFromContact(c, titleOf(c)));
    // Workiz fills the service location from the client they picked.
    if (c.addresses?.[0]) {
      form.setValue("address", jobAddress(c.addresses[0]), { shouldDirty: true });
    }
  };
  const unassign = () => {
    setContact(null);
    setCreatedId(null);
    setClientForm(emptyClientForm());
  };

  /* ------------------------------------------------------------------ view */

  const schedule = {
    date: v.scheduledDate || "",
    endDate: v.scheduledEndDate || "",
    slot: v.scheduledTimeSlot || "",
    allDay: Boolean(v.allDay),
  };
  const canAddCustomField = can("custom_fields", "create");

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden" noValidate>
      <div className="relative flex-1 overflow-y-auto">
        {/* newJob-module__form: 1400px max, 50px under, sides 40px — 36px
            here: our sidebar is 8px wider than Workiz's, and 36px keeps the
            cards Workiz's 645px (2×645 + 30 = 1320) so every box inside
            measures the same. */}
        <div className="mx-auto w-full max-w-[1400px] px-9 pb-[50px]">
          {/* newJob-module__header: 88px, the h3 centred (28px/600 #3b4c53). */}
          <header className="mt-[14px] flex h-[88px] flex-col justify-center">
            <h1 className="text-[28px] leading-[25px] font-semibold text-[#3b4c53]">New Job</h1>
          </header>

          <div className="grid grid-cols-2 gap-[30px]">
            <WzCard title="Client Details">
              {contact ? (
                // assignedClient-module__row: "Client: <name> … Unassign", 10px over the fields.
                <div className="-mt-2.5 mb-2.5 flex items-start text-[14px] leading-4 font-normal text-wz-strong">
                  <span className="mr-[5px]">Client:</span>
                  <a
                    href={`/contacts/${contact.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-wz-link underline hover:text-[#3589e9]"
                  >
                    {contactName(contact) || "Client"}
                  </a>
                  <button type="button" onClick={unassign} className="cursor-pointer text-wz-link underline hover:text-[#3589e9]">
                    Unassign
                  </button>
                </div>
              ) : null}
              <WzClientNameField
                value={clientForm.name}
                onChange={(name) => setClient({ name })}
                onPick={pick}
                error={errorFor("client")}
                autoFocus={!contact}
              />
              <WzTextField
                label="Company name"
                autoComplete="off"
                value={clientForm.company}
                onChange={(e) => setClient({ company: e.target.value })}
              />
              <ClientPhones
                rows={clientForm.phones}
                email={clientForm.email}
                onPhone={setPhone}
                onEmail={(email) => setClient({ email })}
                onAddPhone={() => setClient({ phones: [...clientForm.phones, { phone: "", ext: "" }] })}
                phoneError={
                  errorFor("phone") ?? (missingNow?.ids.includes("phoneInvalid") ? "Invalid phone number" : undefined)
                }
                emailError={errorFor("email") ?? (missingNow?.ids.includes("emailInvalid") ? "Invalid email" : undefined)}
                owner={phoneOwner}
                onUseOwner={pick}
              />
            </WzCard>

            <WzCard title="Service Location" className="relative">
              {verified ? <Verified /> : null}
              <WzFieldGroup join="seamless">
                <WzAddressField
                  value={address.street}
                  onChange={(street) => setAddress({ street })}
                  onSelect={(a) =>
                    setAddress({
                      street: a.street,
                      ...(a.unit !== undefined ? { unit: a.unit ?? "" } : {}),
                      city: a.city,
                      state: a.state,
                      zip: a.zip,
                      ...(a.country ? { country: a.country } : {}),
                      lat: a.lat,
                      lng: a.lng,
                    })
                  }
                  saved={contact?.addresses}
                  country={country}
                  error={errorFor("address")}
                />
                <WzTextField
                  label="Unit"
                  className="w-[151px] flex-none"
                  value={address.unit ?? ""}
                  onChange={(e) => setAddress({ unit: e.target.value })}
                />
              </WzFieldGroup>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                <WzTextField
                  label="City"
                  value={address.city}
                  error={errorFor("city")}
                  onChange={(e) => setAddress({ city: e.target.value })}
                />
                <WzStateSelect
                  country={country}
                  value={address.state}
                  error={errorFor("state")}
                  onChange={(state) => setAddress({ state })}
                />
                <WzTextField
                  label="Zip"
                  value={address.zip}
                  error={errorFor("zip")}
                  onChange={(e) => setAddress({ zip: e.target.value })}
                />
                <WzCountrySelect value={address.country} onChange={(code) => setAddress({ country: code })} />
              </div>
              <WzServiceAreaSelect
                lat={address.lat}
                lng={address.lng}
                value={v.serviceAreaId || undefined}
                error={errorFor("serviceArea")}
                onChange={(id) => form.setValue("serviceAreaId", id, { shouldDirty: true })}
              />
            </WzCard>

            <WzCard title="Job Details">
              <WzTextField label="Job name" maxLength={200} autoComplete="off" {...form.register("jobName")} />
              <WzJobTypeSelect
                value={v.jobTypeId}
                canCreate={can("job_types", "create")}
                error={errorFor("jobType")}
                onChange={(id) => form.setValue("jobTypeId", id, { shouldValidate: true, shouldDirty: true })}
              />
              <WzJobSourceSelect
                value={v.sourceId}
                canCreate={can("job_sources", "create")}
                error={errorFor("source")}
                onChange={(id) => form.setValue("sourceId", id, { shouldDirty: true })}
              />
              <div data-missing={missingNow?.ids.includes("description") || undefined}>
                <JobNoteEditor
                  value={v.notes ?? ""}
                  ariaLabel="Description"
                  placeholder="Description"
                  onChange={(html) => form.setValue("notes", cleanNote(html), { shouldDirty: true })}
                />
                {errorFor("description") ? <WzFieldError>{REQUIRED}</WzFieldError> : null}
              </div>
              <WzExternalCompanySelect
                value={v.externalCompanyId}
                error={errorFor("externalCompany")}
                onChange={(id) => form.setValue("externalCompanyId", id, { shouldDirty: true })}
              />
              {/* Ours: the company the job is issued under. Workiz picks it at
                  the top of the app; it comes prefilled from the area. */}
              <WzBusinessProfileSelect
                value={businessProfileId}
                showDefaultHint
                onChange={(id) => {
                  setCompanyTouched(true);
                  form.setValue("businessProfileId", id, { shouldDirty: true });
                }}
              />
              {/* Built-ins Workiz keeps as custom fields; shown only when an
                  admin made them required, so a Create is never blocked on a
                  field the form does not have. */}
              {required("poNumber") ? (
                <WzTextField label="PO number" error={errorFor("poNumber")} {...form.register("poNumber")} />
              ) : null}
              {required("tags") ? (
                <div data-missing={missingNow?.ids.includes("tags") || undefined}>
                  <WzMultiSelect
                    label="Tags"
                    options={(jobTags ?? []).map((t) => ({ value: t.id, label: t.name }))}
                    value={tagIds}
                    onChange={setTagIds}
                    error={errorFor("tags")}
                  />
                </div>
              ) : null}
            </WzCard>

            <WzScheduleBlock
              layout="card"
              value={schedule}
              tz={jobTz}
              place={verified && address.city ? address.city : undefined}
              onChange={(s) => {
                setScheduleTouched(true);
                form.setValue("scheduledDate", s.date, { shouldDirty: true });
                form.setValue("scheduledEndDate", s.endDate);
                form.setValue("scheduledTimeSlot", s.slot, { shouldValidate: true });
                form.setValue("allDay", s.allDay);
              }}
            >
              {errorFor("scheduled") ? <WzFieldError className="mb-2.5 ml-0">{REQUIRED}</WzFieldError> : null}
              <WzTeamSelect
                jobTypeId={v.jobTypeId}
                address={{ lat: address.lat, lng: address.lng }}
                serviceAreaId={v.serviceAreaId || undefined}
                value={assignTechIds}
                onChange={setAssignTechIds}
                aside={<WzViewSchedule href="/schedule" className="mt-[15px]" />}
              />
            </WzScheduleBlock>

            <WzCustomFields
              layout="card"
              jobTypeId={v.jobTypeId}
              value={customFields}
              onChange={setCustomFields}
              pendingFiles={pendingFiles}
              onPendingFiles={setPendingFilesFor}
              missingIds={missingNow?.customIds}
            />

            {/* Ours: the calls this job will carry — opened from a call, or a
                client with call history. */}
            {callSid || contact ? (
              <WzCard title="Calls">
                <CallsToLink
                  callSid={callSid}
                  contactId={contact?.id}
                  selected={callsToLink}
                  onChange={setCallsToLink}
                />
              </WzCard>
            ) : null}
          </div>

          {canAddCustomField ? (
            // newJob-module__addCustom: the link sits 10px down (newJob-module__link).
            <div className="mt-[30px] mb-20 text-[14px] leading-4 text-wz-strong">
              Need to track more fields?{" "}
              <a href="/settings/custom-fields" className="mt-2.5 inline-block text-wz-link underline hover:text-[#3589e9]">
                Add a custom field
              </a>
            </div>
          ) : null}
        </div>
      </div>

      <WzActionBar>
        {/* Read out, not drawn: Workiz marks the fields themselves. */}
        <p role="status" className="sr-only">
          {missingNow ? `Missing required: ${missingNow.labels.join(", ")}` : ""}
        </p>
        <WzButton type="submit" size="big" className="min-w-[150px]" loading={busy}>
          Create
        </WzButton>
      </WzActionBar>

      {confirm}

      {contact && pendingSave ? (
        <ClientSaveDialog
          open
          original={contact}
          edits={pickedClientChanges(contact, clientForm, pendingSave.companyId).edits}
          clientChanged={pickedClientChanges(contact, clientForm, pendingSave.companyId).asks && contact.id !== createdId}
          newAddress={
            addressInList(pendingSave.values.address, contact.addresses) ? undefined : pendingSave.values.address
          }
          pending={busy}
          onCancel={() => setPendingSave(null)}
          onConfirm={(decision) => {
            const { values, companyId } = pendingSave;
            setPendingSave(null);
            finish(values, applicable(values), decision, companyId);
          }}
        />
      ) : null}
    </form>
  );
}

/** "✓ Verified" at the card's top right once the address is geocoded (address-module__verified). */
function Verified() {
  return (
    <div className="absolute top-[38px] right-10 flex items-center text-[14px] leading-4 font-normal text-wz-link">
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden className="relative top-px mr-3">
        <path d="M1.5 6.5 5.5 10.5 14.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Verified
    </div>
  );
}

/**
 * Phone | Ext (one seamless box) beside Email, "Add phone" under the phone
 * (new_01_empty); with a second number the two phones share the row and
 * Email takes its own (new_08_add_phone), and the link goes.
 */
function ClientPhones({
  rows,
  email,
  onPhone,
  onEmail,
  onAddPhone,
  phoneError,
  emailError,
  owner,
  onUseOwner,
}: {
  rows: ClientPhoneRow[];
  email: string;
  onPhone: (i: number, patch: Partial<ClientPhoneRow>) => void;
  onEmail: (email: string) => void;
  onAddPhone: () => void;
  phoneError?: string;
  emailError?: string;
  /** A client the typed number already belongs to. */
  owner: Contact | null;
  onUseOwner: (c: Contact) => void;
}) {
  const phone = (i: number) => (
    <div className="relative min-w-0">
      <WzFieldGroup join="seamless">
        <WzPhoneField
          aria-label={i === 0 ? "Phone" : `Phone ${i + 1}`}
          value={rows[i].phone}
          onChange={(p) => onPhone(i, { phone: p })}
          error={i === 0 ? phoneError : undefined}
        />
        <WzTextField
          label="Ext"
          aria-label={i === 0 ? "Ext" : `Ext ${i + 1}`}
          inputMode="tel"
          maxLength={MAX_EXTENSION_LENGTH}
          className="w-[100px] flex-none"
          value={rows[i].ext}
          onChange={(e) => onPhone(i, { ext: normalizeExtension(e.target.value) })}
        />
      </WzFieldGroup>
      {i === 0 && owner ? (
        <WzSuggestionList aria-label="Existing client" className="top-12">
          <WzSuggestion
            title={contactName(owner)}
            subtitle="A client already has this phone — use them"
            query=""
            onSelect={() => onUseOwner(owner)}
          />
        </WzSuggestionList>
      ) : null}
    </div>
  );
  const emailBox = (
    <WzTextField
      label="Email"
      type="email"
      autoComplete="off"
      value={email}
      error={emailError}
      onChange={(e) => onEmail(e.target.value)}
    />
  );

  if (rows.length >= MAX_CLIENT_PHONES) {
    return (
      <>
        <div className="grid grid-cols-2 gap-x-5">
          {phone(0)}
          {phone(1)}
        </div>
        {emailBox}
      </>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-5">
      <div className="min-w-0">
        {phone(0)}
        <WzLink tone="bold" className="mt-[5px]" onClick={onAddPhone}>
          Add phone
        </WzLink>
      </div>
      {emailBox}
    </div>
  );
}
