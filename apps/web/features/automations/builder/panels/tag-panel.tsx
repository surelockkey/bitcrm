"use client";

import type { AutomationAction, AutomationLabelMap } from "@bitcrm/types";
import type { ChainNode } from "../types";
import { SUPER_STATUS_OPTIONS, useConditionCatalog } from "./catalog";
import { PanelSentence, Slot } from "./controls";

/**
 * "Apply a tag" (§5.4). The old editor stored `tagId` and carried it past the
 * form untouched — it had no field for it and no way to offer this action at
 * all — so a rule that tagged a job could be edited but never written. This
 * is the first place the tag itself can be chosen.
 */
export function TagPanel({
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
  const action: AutomationAction = node.action ?? { type: "add_tag" };
  const tagId = action.tagId;

  /** A tag the catalog no longer offers is still the tag this rule applies. */
  const options = tagId && !catalog.tags.some((t) => t.id === tagId)
    ? [...catalog.tags, { id: tagId, name: labels[tagId] ?? tagId }]
    : catalog.tags;

  return (
    <PanelSentence>
      <span>Add the tag</span>
      <Slot
        label="Tag to add"
        value={tagId}
        options={options}
        placeholder="choose a tag…"
        emptyText="No job tags yet"
        disabled={disabled}
        onChange={(id) => onChange({ ...node, action: { ...action, type: "add_tag", tagId: id } })}
      />
      <span>to the job</span>
    </PanelSentence>
  );
}

/**
 * "Change the sub-status" (§5.4). Two slots, because a sub-status is filed
 * under exactly one super-status (`DealSubStatus.group`) and the spec stores
 * both: picking the fine one fills in the coarse one, so the pair can never
 * be saved disagreeing with itself.
 */
export function SubStatusPanel({
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
  const action: AutomationAction = node.action ?? { type: "change_sub_status" };
  const emit = (next: AutomationAction) =>
    onChange({ ...node, action: { ...next, type: "change_sub_status" } });

  const under = catalog.subStatusesUnder(action.superStatus ? [action.superStatus] : []);
  const subOptions =
    action.subStatusId && !under.some((s) => s.id === action.subStatusId)
      ? [...under, { id: action.subStatusId, name: labels[action.subStatusId] ?? action.subStatusId }]
      : under;

  return (
    <PanelSentence>
      <span>Move the job to</span>
      <Slot
        label="Status to set"
        value={action.superStatus}
        options={SUPER_STATUS_OPTIONS}
        placeholder="choose a status…"
        disabled={disabled}
        onChange={(superStatus) => {
          const next: AutomationAction = { ...action, superStatus };
          // The sub-status it had may live under a different super-status,
          // and a pair that disagrees is a write the engine cannot make.
          const group = action.subStatusId ? catalog.groupOf(action.subStatusId) : undefined;
          if (group !== undefined && group !== superStatus) delete next.subStatusId;
          emit(next);
        }}
      />
      <Slot
        label="Sub-status to set"
        value={action.subStatusId}
        options={subOptions}
        placeholder="any sub-status"
        emptyText="No sub-statuses here"
        disabled={disabled}
        onClear={() => {
          const next: AutomationAction = { ...action };
          delete next.subStatusId;
          emit(next);
        }}
        onChange={(subStatusId) =>
          emit({
            ...action,
            subStatusId,
            // One sub-status names its super-status with it, so the coarse
            // slot follows the fine one rather than waiting to be told twice.
            superStatus: catalog.groupOf(subStatusId) ?? action.superStatus,
          })
        }
      />
    </PanelSentence>
  );
}
