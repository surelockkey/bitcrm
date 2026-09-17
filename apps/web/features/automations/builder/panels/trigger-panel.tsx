"use client";

import { useState } from "react";
import type {
  AutomationLabelMap,
  AutomationScheduleAnchor,
  AutomationTrigger,
  AutomationTriggerKind,
} from "@bitcrm/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ANCHOR_LABEL, OFFSET_UNITS, anchorAllowsBefore, type OffsetUnit } from "../../lib";
import { AutomationEmptyNote } from "../../components/automation-empty-note";
import {
  AutomationValuePicker,
  type PickerOption,
} from "../../components/automation-value-picker";
import type { ChainNode } from "../types";
import {
  SUPER_STATUS_OPTIONS,
  TRIGGER_ENTITIES,
  TRIGGER_EVENTS,
  entityOfKind,
  eventById,
  eventIdOfTrigger,
  useConditionCatalog,
  type TriggerEntity,
} from "./catalog";
import { PanelField, PanelSection, PanelSentence, Slot } from "./controls";
import { useOffsetParts } from "./offset";

const UNIT_OPTIONS: PickerOption[] = OFFSET_UNITS.map((unit) => ({ id: unit, name: unit }));

const ANCHOR_OPTIONS: PickerOption[] = (
  Object.entries(ANCHOR_LABEL) as Array<[AutomationScheduleAnchor, string]>
).map(([id, name]) => ({ id, name }));

const CALL_DIRECTION_OPTIONS: PickerOption[] = [
  { id: "any", name: "either way" },
  { id: "inbound", name: "coming in" },
  { id: "outbound", name: "going out" },
];

const MESSAGE_CHANNEL_OPTIONS: PickerOption[] = [
  { id: "any", name: "any channel" },
  { id: "sms", name: "a text message" },
  { id: "email", name: "an email" },
  { id: "in_app", name: "an in-app message" },
];

const MESSAGE_PARTY_OPTIONS: PickerOption[] = [
  { id: "any", name: "anyone" },
  { id: "contact", name: "a contact" },
  { id: "company", name: "a company" },
  { id: "user", name: "a colleague" },
  { id: "none", name: "nobody we know" },
];

/**
 * A trigger of `kind` with nothing carried over. Switching the kind is the
 * one moment a narrowing may legitimately disappear — `to`, `callOutcome`,
 * `messageChannel` and the rest belong to one kind each, and `toSpec` has
 * always dropped the ones that no longer apply (schemas.ts). Doing it here,
 * visibly, keeps the panel and the saved rule saying the same thing.
 */
function freshTrigger(kind: AutomationTriggerKind): AutomationTrigger {
  // A relative reminder with no anchor counts from nothing; the spec's own
  // default is the job's start, and the offset row has to have a number to show.
  if (kind === "schedule.relative") return { kind, anchor: "scheduledStart", offsetMinutes: 0 };
  return { kind };
}

/**
 * Whether this trigger is already narrowed by something only "Narrow it
 * further" shows. None of these five reaches the sentence on the card —
 * `automationTriggerSentence` says the status a job comes from and nothing
 * else — so a shut disclosure over any of them is a rule that reads as "when
 * a call is missed" while it only ever fires on inbound calls. Three of the
 * eight library recipes ship exactly that (`callDirection: 'inbound'`).
 */
function isNarrowed(trigger: AutomationTrigger): boolean {
  const set = (value: string | undefined) => Boolean(value) && value !== "any";
  return (
    Boolean(trigger.from?.length) ||
    trigger.onCreate === false ||
    set(trigger.callDirection) ||
    set(trigger.messageChannel) ||
    set(trigger.messagePartyKind)
  );
}

/**
 * The trigger node: `When <a job> <is created>`, each slot a popover, as in
 * Workiz (§5.1). "has a status of" opens the status and sub-status pickers
 * under the sentence; "is coming up" opens the `<4> <hours> <ahead of> <the
 * job's start>` row.
 *
 * Everything the old editor carried past the user untouched — the status a
 * job left, "not on creation", the direction of a call, a message's channel
 * and sender — is here rather than hidden, behind "Narrow it further" so the
 * sentence stays the first thing read. Each of those writes its key only when
 * it is actually changed, so a rule opened and saved is byte for byte itself.
 */
export function TriggerPanel({
  node,
  labels,
  onChange,
  disabled,
}: {
  node: ChainNode;
  labels: AutomationLabelMap;
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}) {
  const catalog = useConditionCatalog();
  const trigger = node.trigger;
  const entity: TriggerEntity | undefined = trigger ? entityOfKind(trigger.kind) : undefined;
  const eventId = trigger ? eventIdOfTrigger(trigger) : undefined;
  // Open on a trigger that is already narrowed, shut on one that is not — the
  // same rule the webhook panel's headers follow, for the same reason: a rule
  // narrowed to inbound calls must never look like one that takes them all.
  // Seeded once per node, and the panel is remounted per node (`NodePanel`).
  const [narrowing, setNarrowing] = useState(() => Boolean(trigger && isNarrowed(trigger)));

  const emit = (next: AutomationTrigger) => onChange({ ...node, trigger: next });

  const setEntity = (id: string) => {
    const next = id as TriggerEntity;
    if (next === entity) return;
    const event = TRIGGER_EVENTS[next][0];
    const built = freshTrigger(event.kind);
    if (event.callOutcome) built.callOutcome = event.callOutcome;
    emit(built);
  };

  const setEvent = (id: string) => {
    if (!entity || !trigger) return;
    const event = eventById(entity, id);
    if (!event) return;
    if (event.kind !== trigger.kind) {
      const built = freshTrigger(event.kind);
      if (event.callOutcome) built.callOutcome = event.callOutcome;
      emit(built);
      return;
    }
    // Same kind, different outcome — a call's four events are one kind. A
    // stored trigger with no `callOutcome` already means "any", so re-picking
    // "ends" must not add the key it never had.
    if (event.callOutcome && event.callOutcome !== (trigger.callOutcome ?? "any")) {
      emit({ ...trigger, callOutcome: event.callOutcome });
    }
  };

  /**
   * One of the trigger's optional narrowings, written when set and deleted
   * when emptied. `kind` is not one of them: it is the trigger's identity and
   * only the two slots above may change it.
   */
  const patch = (key: Exclude<keyof AutomationTrigger, "kind">, value: unknown) => {
    if (!trigger) return;
    const next: AutomationTrigger = { ...trigger };
    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
    emit(next);
  };

  /** "any" is what an absent narrowing already means, so it is stored as absent. */
  const patchAny = (key: Exclude<keyof AutomationTrigger, "kind">, id: string) =>
    patch(key, id === "any" ? undefined : id);

  const setTo = (ids: string[]) => {
    if (!trigger) return;
    // A sub-status is filed under exactly one super-status, so one that no
    // longer fits can never be entered by this trigger; one the catalog cannot
    // place is kept, because "we don't know where it belongs" is not "it does
    // not fit".
    const kept = (trigger.toSubStatus ?? []).filter((id) => {
      if (!ids.length) return true;
      const group = catalog.groupOf(id);
      return group === undefined || ids.includes(group);
    });
    const next: AutomationTrigger = { ...trigger };
    if (ids.length) next.to = ids;
    else delete next.to;
    if (kept.length) next.toSubStatus = kept;
    else delete next.toSubStatus;
    emit(next);
  };

  const offset = useOffsetParts(trigger?.offsetMinutes);
  const anchor = (trigger?.anchor ?? "scheduledStart") as AutomationScheduleAnchor;

  const events = entity ? TRIGGER_EVENTS[entity] : [];
  const statusTrigger = trigger?.kind === "deal.status_changed";

  return (
    <div className="space-y-5">
      <PanelSentence>
        <span>When</span>
        <Slot
          label="What the rule is about"
          value={entity}
          options={TRIGGER_ENTITIES}
          onChange={setEntity}
          placeholder="choose…"
          disabled={disabled}
        />
        <Slot
          label="What happens to it"
          value={eventId}
          options={events.map((e) => ({ id: e.id, name: e.name, hint: e.hint }))}
          onChange={setEvent}
          placeholder="choose…"
          emptyText="Pick what the rule is about first"
          disabled={disabled || !entity}
        />
      </PanelSentence>

      {statusTrigger ? (
        <PanelSection title="Which status">
          <div className="space-y-1.5">
            <Label className="text-xs">Status entered</Label>
            <AutomationValuePicker
              label="Status entered"
              options={SUPER_STATUS_OPTIONS}
              values={trigger?.to ?? []}
              placeholder="Any status"
              disabled={disabled}
              onChange={setTo}
            />
            {/* Emptying this widens the rule from one status to every status
                change, exactly as emptying a condition widens it to every
                value — the same thing, so the same note. Not while a
                sub-status is picked: the trigger is then still narrowed to it
                and still saved with it. */}
            {trigger?.to?.length || trigger?.toSubStatus?.length ? null : <AutomationEmptyNote />}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sub-status</Label>
            <AutomationValuePicker
              label="Sub-status entered"
              options={catalog.subStatusesUnder(trigger?.to ?? [])}
              values={trigger?.toSubStatus ?? []}
              fallback={labels}
              placeholder="Any sub-status"
              emptyText="No sub-statuses here"
              disabled={disabled}
              onChange={(ids) => patch("toSubStatus", ids.length ? ids : undefined)}
            />
          </div>
        </PanelSection>
      ) : null}

      {trigger?.kind === "schedule.relative" ? (
        <PanelSection title="When exactly">
          <PanelSentence>
            <Input
              type="number"
              min={0}
              className="h-8 w-20"
              aria-label="How long"
              disabled={disabled}
              value={offset.value}
              // An emptied box reads as zero rather than as NaN, so the
              // sentence on the card stays live while the number is retyped.
              onChange={(e) => {
                const typed = Math.abs(Number(e.target.value));
                patch("offsetMinutes", offset.withValue(Number.isFinite(typed) ? typed : 0));
              }}
            />
            <Slot
              label="Unit"
              value={offset.unit}
              options={UNIT_OPTIONS}
              disabled={disabled}
              onChange={(unit) => patch("offsetMinutes", offset.withUnit(unit as OffsetUnit))}
            />
            <Slot
              label="Before or after"
              value={offset.direction}
              options={[
                {
                  id: "before",
                  name: "ahead of",
                  disabled: !anchorAllowsBefore(anchor),
                  hint: anchorAllowsBefore(anchor)
                    ? undefined
                    : "that date has already passed when the rule runs",
                },
                { id: "after", name: "after" },
              ]}
              disabled={disabled}
              onChange={(direction) =>
                patch("offsetMinutes", offset.withDirection(direction as "before" | "after"))
              }
            />
            <Slot
              label="Counted from"
              value={anchor}
              options={ANCHOR_OPTIONS}
              disabled={disabled}
              onChange={(next) => {
                const picked = next as AutomationScheduleAnchor;
                const built: AutomationTrigger = { ...(trigger ?? {}), kind: "schedule.relative", anchor: picked };
                // A date already in the past can only be counted forward from
                // — the scheduler arms nothing for a moment gone by.
                if (!anchorAllowsBefore(picked) && offset.direction === "before") {
                  built.offsetMinutes = offset.withDirection("after");
                }
                emit(built);
              }}
            />
          </PanelSentence>
        </PanelSection>
      ) : null}

      {trigger && (statusTrigger || entity === "call" || entity === "message") ? (
        <div className="space-y-3 border-t pt-3">
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
            aria-expanded={narrowing}
            onClick={() => setNarrowing((o) => !o)}
          >
            Narrow it further
          </button>

          {narrowing ? (
            <div className="space-y-3">
              {statusTrigger ? (
                <>
                  <PanelField
                    label="Only when it comes from"
                    hint="The status the job was in before. Any status when nothing is picked."
                  >
                    <AutomationValuePicker
                      label="Status left"
                      options={SUPER_STATUS_OPTIONS}
                      values={trigger.from ?? []}
                      placeholder="Any status"
                      disabled={disabled}
                      onChange={(ids) => patch("from", ids.length ? ids : undefined)}
                    />
                  </PanelField>
                  <label className="flex w-fit cursor-pointer items-start gap-2 text-xs">
                    <Checkbox
                      className="mt-0.5"
                      // Named on the control: a `<label>` names what the HTML
                      // calls a labelable element, and this one is a button.
                      aria-label="A job created straight into this status counts too"
                      disabled={disabled}
                      checked={trigger.onCreate !== false}
                      onCheckedChange={(on) => patch("onCreate", on === false ? false : undefined)}
                    />
                    <span>
                      A job created straight into this status counts too
                      <span className="block text-muted-foreground">
                        Workiz fires on creation as well; untick to wait for a real status change.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}

              {entity === "call" ? (
                <PanelSentence>
                  <span>The call goes</span>
                  <Slot
                    label="Call direction"
                    value={trigger.callDirection ?? "any"}
                    options={CALL_DIRECTION_OPTIONS}
                    disabled={disabled}
                    onChange={(id) => patchAny("callDirection", id)}
                  />
                </PanelSentence>
              ) : null}

              {entity === "message" ? (
                <PanelSentence>
                  <span>Sent over</span>
                  <Slot
                    label="Message channel"
                    value={trigger.messageChannel ?? "any"}
                    options={MESSAGE_CHANNEL_OPTIONS}
                    disabled={disabled}
                    onChange={(id) => patchAny("messageChannel", id)}
                  />
                  <span>by</span>
                  <Slot
                    label="Message sender"
                    value={trigger.messagePartyKind ?? "any"}
                    options={MESSAGE_PARTY_OPTIONS}
                    disabled={disabled}
                    onChange={(id) => patchAny("messagePartyKind", id)}
                  />
                </PanelSentence>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
