"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  JobSuperStatus,
  SUPER_STATUS_ORDER,
  isFieldTeamMember,
  type DealSubStatus,
  type JobSource,
  type JobType,
  type ServiceArea,
} from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzTrashIcon } from "@/components/workiz/icons";
import { WzShortCodeChips } from "@/components/workiz/phone-tab-parts";
import { WzMultiSelect, WzSelect, type WzOption } from "@/components/workiz/select";
import { WzTextField } from "@/components/workiz/text-field";
import { WzTextarea } from "@/components/workiz/textarea";
import { SUPER_STATUS_LABEL } from "@/features/automations/lib";
import { useCreateAutomation, useUpdateAutomation } from "@/features/automations/hooks";
import type { ShortCode } from "@/features/messaging/api";
import { cn } from "@/lib/utils";
import type { UserOption } from "../hooks";
import {
  NOTIFICATION_CATEGORY,
  emptyForm,
  fromSpec,
  notificationName,
  toSpec,
  type CallStatus,
  type NotificationForm,
  type NotificationKind,
  type NotificationRule,
  type NotifyBy,
  type ReminderForm,
  type RuleParam,
  type StatusRule,
  type UserStatusForm,
} from "../lib";

/** What the four forms list: the catalogs the page fetched before it opened. */
export interface EditorCatalogs {
  users: UserOption[];
  statuses: DealSubStatus[];
  sources: JobSource[];
  types: JobType[];
  areas: ServiceArea[];
  shortCodes: ShortCode[];
}

const WHO_HEADING = "__users";
const USER_PREFIX = "user:";
/** Workiz's small grey line under "Who to notify" (11px #999). */
const HINT = "Select notification type, notifications can be sent to clients, techs and users";

const NOTIFY_BY_OPTIONS: WzOption[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "both", label: "Both" },
];
const TRIGGER_OPTIONS: WzOption[] = [
  { value: "time", label: "Time" },
  { value: "assignment", label: "On Assignment" },
];
const AMOUNT_OPTIONS: WzOption[] = Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const UNIT_OPTIONS: WzOption[] = [
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];
const COMING_LATER = " — coming later";
const CALL_STATUS_OPTIONS: WzOption[] = [
  { value: "completed", label: "Completed" },
  { value: "voicemail", label: "Voicemail" },
  { value: "missed", label: "Missed" },
  // Telephony never publishes a busy outcome yet (notification_center.md §6.1).
  { value: "busy", label: `Busy${COMING_LATER}`, disabled: true },
];
const FLOW_OPTIONS: WzOption[] = [
  { value: "any", label: "Any Flow" },
  // No flow condition in the engine yet (§6.1, "From Call Flow").
  { value: "flows", label: `A call flow${COMING_LATER}`, disabled: true },
];
/** Workiz's "Choose Parameter" list, in its order; the three without a condition field are greyed. */
const PARAM_OPTIONS: WzOption[] = [
  { value: "externalCompany", label: `External Company${COMING_LATER}`, disabled: true },
  { value: "source", label: "Ad Group" },
  { value: "jobType", label: "Job Type" },
  { value: "paymentType", label: `Payment Type${COMING_LATER}`, disabled: true },
  { value: "tech", label: "Technician" },
  { value: "amount", label: `Amount${COMING_LATER}`, disabled: true },
  { value: "serviceArea", label: "Service Area" },
];
const PARAM_LABEL: Record<RuleParam, string> = { source: "Ad Group", jobType: "Job Type", tech: "Technician", serviceArea: "Service Area" };

/** The chips under a reminder's text: the client's codes for the client, the job's and the tech's for the tech. */
export function shortCodesFor(kind: ReminderForm["kind"], codes: readonly ShortCode[]): string[] {
  const order = kind === "client_reminder" ? ["client", "job", "business", "links", "custom"] : ["job", "client", "technician", "business", "links", "custom"];
  return order.flatMap((group) => codes.filter((c) => c.group === group).map((c) => c.code));
}

/** The "Who to notify" value a form reads as. */
function whoValue(form: NotificationForm | null): string {
  if (!form) return "";
  if (form.kind === "user_status_alert") return `${USER_PREFIX}${form.userIds[0] ?? ""}`;
  return form.kind;
}

const STATUS_PREFIX = { super: "super:", sub: "sub:" } as const;

function statusValue(form: UserStatusForm): string {
  return "subStatusId" in form.status ? `${STATUS_PREFIX.sub}${form.status.subStatusId}` : `${STATUS_PREFIX.super}${form.status.superStatus}`;
}

/** The job-status list: every super-status, its sub-statuses indented under it. */
function statusOptions(statuses: readonly DealSubStatus[]): WzOption[] {
  return SUPER_STATUS_ORDER.flatMap((group) => [
    { value: `${STATUS_PREFIX.super}${group}`, label: SUPER_STATUS_LABEL[group] ?? group },
    ...statuses
      .filter((s) => s.group === group && s.active)
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
      .map((s) => ({ value: `${STATUS_PREFIX.sub}${s.id}`, label: s.name })),
  ]);
}

/**
 * Workiz's "Add new notification" / "Edit notification" (notif_audit_wz_03,
 * _04, _05, _10, _11, _12): the full-window modal with one 1015px column —
 * h5 "Notify", the "Who to notify" select with its grey hint, then the
 * fields of the chosen kind, 24px apart; Cancel / Save in the footer. On
 * Save the form is compiled to an automation spec (`toSpec`) and written as
 * a rule of the notification category.
 */
export function NotificationEditor({
  open,
  onOpenChange,
  rule,
  catalogs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent: a new notification. */
  rule?: NotificationRule;
  catalogs: EditorCatalogs;
}) {
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const [form, setForm] = useState<NotificationForm | null>(() => (rule?.spec ? fromSpec(rule.spec) : null));
  const [error, setError] = useState<string | null>(null);

  const statusNames = useMemo(() => ({ statuses: Object.fromEntries(catalogs.statuses.map((s) => [s.id, s.name])) }), [catalogs.statuses]);

  const whoOptions = useMemo<WzOption[]>(
    () => [
      { value: "client_reminder", label: "Assigned client" },
      { value: "tech_reminder", label: "Assigned tech" },
      { value: "call_alert", label: "When a call comes in" },
      { value: WHO_HEADING, label: "Custom notification to User:", disabled: true },
      ...catalogs.users.map((u) => ({ value: `${USER_PREFIX}${u.id}`, label: `${u.name} (${u.email})` })),
    ],
    [catalogs.users],
  );

  const chooseWho = (value: string) => {
    setError(null);
    if (!value) return;
    if (value.startsWith(USER_PREFIX)) {
      const id = value.slice(USER_PREFIX.length);
      setForm((f) => (f?.kind === "user_status_alert" ? { ...f, userIds: [id] } : { ...(emptyForm("user_status_alert") as UserStatusForm), userIds: [id] }));
      return;
    }
    setForm((f) => (f?.kind === value ? f : emptyForm(value as NotificationKind)));
  };

  const save = () => {
    if (!form) {
      setError("Choose who to notify");
      return;
    }
    if ((form.kind === "client_reminder" || form.kind === "tech_reminder") && !form.body.trim()) {
      setError("Write the message");
      return;
    }
    if ((form.kind === "call_alert" || form.kind === "user_status_alert") && form.userIds.length === 0) {
      setError("Choose who to notify");
      return;
    }
    setError(null);
    const spec = toSpec(form);
    const name = notificationName(form, statusNames);
    const close = { onSuccess: () => onOpenChange(false) };
    if (rule) update.mutate({ id: rule.id, body: { name, spec, notificationKind: form.kind } }, close);
    else create.mutate({ name, spec, enabled: false, category: NOTIFICATION_CATEGORY, notificationKind: form.kind }, close);
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      variant="full"
      title={rule ? "Edit notification" : "Add new notification"}
      onSave={save}
      saving={create.isPending || update.isPending}
      error={error}
      formClassName="mx-auto w-[1015px] max-w-full pl-0 pt-[5px]"
    >
      <div>
        <h5 className="text-sm leading-4 font-semibold text-foreground">Notify</h5>
        <WzSelect
          label="Who to notify"
          className="mt-[10px]"
          options={whoOptions}
          value={whoValue(form)}
          onChange={chooseWho}
          renderOption={(option) =>
            option.value === WHO_HEADING ? (
              <span className="font-bold text-input">{option.label}</span>
            ) : option.value.startsWith(USER_PREFIX) ? (
              <span className="pl-[10px]">{option.label}</span>
            ) : (
              option.label
            )
          }
        />
        {/* Workiz's small: 11px/13px #999, 1px under the box (notif_audit_wz_04: y156). */}
        <small className="mt-px block text-[11px] leading-[13px] text-wz-caption">{HINT}</small>
      </div>

      {form?.kind === "client_reminder" || form?.kind === "tech_reminder" ? (
        <ReminderFields form={form} onChange={setForm} shortCodes={catalogs.shortCodes} />
      ) : form?.kind === "call_alert" ? (
        <CallAlertFields form={form} onChange={setForm} users={catalogs.users} />
      ) : form?.kind === "user_status_alert" ? (
        <UserStatusFields form={form} onChange={setForm} catalogs={catalogs} />
      ) : null}
    </WzFormModal>
  );
}

/* --------------------------------------------------------------- reminder */

function NotifyBySelect({ value, onChange }: { value: NotifyBy; onChange: (v: NotifyBy) => void }) {
  return <WzSelect label="Notify by" options={NOTIFY_BY_OPTIONS} value={value} onChange={(v) => onChange(v as NotifyBy)} searchable={false} />;
}

function ReminderFields({
  form,
  onChange,
  shortCodes,
}: {
  form: ReminderForm;
  onChange: (f: NotificationForm) => void;
  shortCodes: readonly ShortCode[];
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<ReminderForm>) => onChange({ ...form, ...patch });
  const codes = useMemo(() => shortCodesFor(form.kind, shortCodes), [form.kind, shortCodes]);

  /** `{{code}}` where the caret is (or at the end), the caret after it. */
  const insert = (code: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? start;
    set({ body: `${form.body.slice(0, start)}${code}${form.body.slice(end)}` });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + code.length, start + code.length);
    });
  };

  return (
    <>
      <NotifyBySelect value={form.notifyBy} onChange={(notifyBy) => set({ notifyBy })} />
      <WzSelect
        label="Trigger By"
        options={TRIGGER_OPTIONS}
        value={form.triggerBy}
        onChange={(v) => set({ triggerBy: v as ReminderForm["triggerBy"] })}
        searchable={false}
      />
      {form.triggerBy === "time" ? (
        // Three 323px columns 23px apart; the words top-aligned in the third (notif_audit_wz_04: x293 / 639 / 985, y343).
        <div className="grid grid-cols-3 gap-[23px]">
          <WzSelect label="Number" geometry="bare" options={AMOUNT_OPTIONS} value={String(form.amount)} onChange={(v) => set({ amount: Number(v) || 1 })} />
          <WzSelect label="Unit" geometry="bare" options={UNIT_OPTIONS} value={form.unit} onChange={(v) => set({ unit: v as ReminderForm["unit"] })} searchable={false} />
          <p className="text-sm leading-4 text-wz-strong">Before job start</p>
        </div>
      ) : null}
      {form.notifyBy !== "sms" ? <WzTextField label="Subject" value={form.subject} onChange={(e) => set({ subject: e.target.value })} /> : null}
      <div>
        <WzTextarea
          ref={box}
          aria-label="Message"
          placeholder="Message"
          value={form.body}
          onChange={(e) => set({ body: e.target.value })}
          className={cn(form.kind === "client_reminder" ? "h-[247px]" : "h-[121px]")}
        />
        {/* The chips 33px under the box (y611 → y644). */}
        <WzShortCodeChips label="Short codes" codes={codes} onInsert={insert} className="mt-[33px]" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------- call alert */

function CallAlertFields({
  form,
  onChange,
  users,
}: {
  form: Extract<NotificationForm, { kind: "call_alert" }>;
  onChange: (f: NotificationForm) => void;
  users: UserOption[];
}) {
  const options = useMemo<WzOption[]>(() => users.map((u) => ({ value: u.id, label: u.name })), [users]);
  return (
    <>
      <NotifyBySelect value={form.notifyBy} onChange={(notifyBy) => onChange({ ...form, notifyBy })} />
      <WzSelect
        label="When call is"
        options={CALL_STATUS_OPTIONS}
        value={form.callStatus}
        onChange={(v) => onChange({ ...form, callStatus: v as CallStatus })}
        searchable={false}
      />
      <WzSelect label="From Call Flow" options={FLOW_OPTIONS} value="any" onChange={() => undefined} searchable={false} />
      <WzMultiSelect label="Notify" options={options} value={form.userIds} onChange={(userIds) => onChange({ ...form, userIds })} clearable={false} />
    </>
  );
}

/* ------------------------------------------------------------ user status */

function UserStatusFields({
  form,
  onChange,
  catalogs,
}: {
  form: UserStatusForm;
  onChange: (f: NotificationForm) => void;
  catalogs: EditorCatalogs;
}) {
  const statuses = useMemo(() => statusOptions(catalogs.statuses), [catalogs.statuses]);
  const valuesFor = (param: RuleParam): WzOption[] => {
    switch (param) {
      case "source":
        return catalogs.sources.map((s) => ({ value: s.id, label: s.name }));
      case "jobType":
        return catalogs.types.map((t) => ({ value: t.id, label: t.name }));
      case "tech":
        return catalogs.users.filter((u) => isFieldTeamMember(u.user)).map((u) => ({ value: u.id, label: u.name }));
      case "serviceArea":
        return catalogs.areas.map((a) => ({ value: a.id, label: a.name }));
    }
  };
  const setRule = (i: number, rule: StatusRule) => onChange({ ...form, rules: form.rules.map((r, at) => (at === i ? rule : r)) });

  return (
    <>
      <NotifyBySelect value={form.notifyBy} onChange={(notifyBy) => onChange({ ...form, notifyBy })} />
      <WzSelect
        label="When Job Status"
        options={statuses}
        value={statusValue(form)}
        onChange={(v) => {
          if (v.startsWith(STATUS_PREFIX.sub)) onChange({ ...form, status: { subStatusId: v.slice(STATUS_PREFIX.sub.length) } });
          else if (v.startsWith(STATUS_PREFIX.super)) onChange({ ...form, status: { superStatus: v.slice(STATUS_PREFIX.super.length) as JobSuperStatus } });
        }}
        renderOption={(option) => (option.value.startsWith(STATUS_PREFIX.sub) ? <span className="pl-[10px]">{option.label}</span> : option.label)}
      />
      {form.rules.length ? (
        <div>
          <h5 className="text-sm leading-4 font-semibold text-foreground">And</h5>
          <div className="mt-[14px] flex flex-col gap-6">
            {form.rules.map((r, i) => {
              const options = r.param ? valuesFor(r.param) : [];
              return (
                <div key={i} className="flex items-start gap-[23px]">
                  <WzSelect
                    label="Choose Parameter"
                    className="w-[323px]"
                    options={PARAM_OPTIONS}
                    value={r.param}
                    onChange={(v) => setRule(i, { param: v as RuleParam, values: [], labels: [] })}
                    searchable={false}
                  />
                  {r.param ? (
                    <WzMultiSelect
                      label={PARAM_LABEL[r.param]}
                      className="w-[323px]"
                      options={options}
                      value={r.values}
                      onChange={(values) =>
                        setRule(i, { ...r, values, labels: values.map((v) => options.find((o) => o.value === v)?.label ?? v) })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => onChange({ ...form, rules: form.rules.filter((_, at) => at !== i) })}
                    className="mt-1.5 mr-[27px] ml-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-wz-strong text-wz-strong outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus"
                  >
                    <WzTrashIcon size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={cn(form.rules.length && "mt-[17px]")}>
        <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} onClick={() => onChange({ ...form, rules: [...form.rules, { param: "", values: [] }] })}>
          Add Rule
        </WzButton>
      </div>
    </>
  );
}
