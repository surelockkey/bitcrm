"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { WzCheckbox } from "@/components/workiz/toggles";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import {
  CALL_FLOW_LIMITS,
  ringTargetOf,
  type CallDevice,
  type CallGroupWithMembers,
  type RingNode,
  type RingTarget,
  type RingTargetKind,
} from "@bitcrm/types";
import type { TransferTarget } from "../api";

/**
 * Workiz's "Forward Calls" pane (pg_settings_phone_wz_builder_forward),
 * measured: the words 14px/20px #404040; 16px under them the small text tabs
 * Group | User | External Number 13px #3e4b51 (the open one 600 over a 3px
 * ink bar 9px under the words, 28px in all), 15px apart, 10px over the box;
 * a 380×44 box (14px #666, 1px #b8bfc1, 8px corners, the browser's 1px 2px
 * in); under an outside number the pink box (rgba(255,111,100,.24), 8px
 * corners, 12px 23px) with "We really don’t recommend this option," 13px/600,
 * "Here's why" under it, three 14px bullets and "Are you sure you want to take
 * the risk?"; "Move to next step after [66×32] sec" 14px; then "Advanced"
 * 13px/500 over a 1px rgba(62,75,81,.24) rule with a 24px round chevron.
 *
 * Ours: a Device tab (the Devices catalog) beside Workiz's three, and the
 * key-press gate under Advanced.
 */
const TABS: { kind: RingTargetKind; label: string }[] = [
  { kind: "group", label: "Group" },
  { kind: "user", label: "User" },
  { kind: "external", label: "External Number" },
  { kind: "device", label: "Device" },
];

const BOX =
  "h-11 w-full max-w-[380px] rounded-[8px] border border-[#b8bfc1] bg-white px-3 text-sm leading-4 tracking-[0.4px] text-wz-value outline-none focus:border-wz-link";

export function ForwardStepFields({
  node,
  groups,
  teammates,
  devices,
  onChange,
}: {
  node: RingNode;
  groups: CallGroupWithMembers[];
  teammates: TransferTarget[];
  devices: CallDevice[];
  onChange: (node: RingNode) => void;
}) {
  const target = ringTargetOf(node) ?? { kind: "group" as const, id: "" };
  const [advanced, setAdvanced] = useState(!!node.whisper);
  // What each tab last held, so a look at another tab doesn't lose a pick.
  const picks = useRef<Partial<Record<RingTargetKind, RingTarget>>>({});

  /** The step without either target shape — what every change starts from. */
  const bare = (): Omit<RingNode, "target" | "groupId"> => {
    const { target: _t, groupId: _g, ...rest } = node;
    return rest;
  };
  const setTarget = (next: RingTarget) => onChange({ ...bare(), target: next });

  const switchTo = (kind: RingTargetKind) => {
    if (kind === target.kind) return;
    picks.current[target.kind] = target;
    setTarget(picks.current[kind] ?? (kind === "external" ? { kind, number: "" } : { kind, id: "" }));
  };

  const setTimeout_ = (raw: string) => {
    const { timeoutSec: _t, ...rest } = node;
    onChange(raw.trim() === "" ? rest : { ...rest, timeoutSec: Number(raw) });
  };

  const pickedId = target.kind === "external" ? "" : target.id;

  return (
    <div className="-mx-[15px]">
      <p className="px-[30px] pt-[10px] pb-5 text-sm leading-5 tracking-[0.4px] text-wz-strong">
        Direct incoming calls to a group, a single user, or multiple users
      </p>

      <div role="tablist" aria-label="Forward to" className="mt-4 mb-[10px] flex items-end gap-[15px] px-[25px]">
        {TABS.map((tab) => {
          const on = tab.kind === target.kind;
          return (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => switchTo(tab.kind)}
              className={cn(
                "cursor-pointer border-b-[3px] pb-[9px] text-[13px] leading-4 tracking-[0.4px] text-[#3e4b51] outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
                on ? "border-[#3e4b51] font-semibold" : "border-transparent font-normal",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="px-[30px]">
        {target.kind === "group" ? (
          <select aria-label="Call group" className={BOX} value={pickedId} onChange={(e) => setTarget({ kind: "group", id: e.target.value })}>
            <option value="">Pick a call group…</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} — {group.members.length} member{group.members.length === 1 ? "" : "s"}
                {group.deviceMembers?.length ? `, ${group.deviceMembers.length} device${group.deviceMembers.length === 1 ? "" : "s"}` : ""}
              </option>
            ))}
          </select>
        ) : null}

        {target.kind === "user" ? (
          <select aria-label="User" className={BOX} value={pickedId} onChange={(e) => setTarget({ kind: "user", id: e.target.value })}>
            <option value="">Pick a teammate…</option>
            {teammates.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
                {user.email ? ` — ${user.email}` : ""}
              </option>
            ))}
          </select>
        ) : null}

        {target.kind === "device" ? (
          <select aria-label="Device" className={BOX} value={pickedId} onChange={(e) => setTarget({ kind: "device", id: e.target.value })}>
            <option value="">Pick a device…</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
                {device.number ? ` — ${formatPhone(device.number) || device.number}` : device.sipAddress ? ` — ${device.sipAddress}` : ""}
                {device.active ? "" : " (paused)"}
              </option>
            ))}
          </select>
        ) : null}

        {target.kind === "external" ? (
          <>
            <input
              type="tel"
              aria-label="External number"
              placeholder="Phone number"
              className={cn(BOX, "px-0.5 text-[#666]")}
              value={target.number}
              onChange={(e) => setTarget({ kind: "external", number: e.target.value })}
            />
            {/* Workiz's WarningMessage: the same three caveats hold here — an
                outside phone has no softphone to answer and no agent to log. */}
            <div className="mt-[11px] max-w-[380px] rounded-[8px] bg-[rgba(255,111,100,0.24)] px-[23px] py-3 text-center">
              <h6 className="text-[13px] leading-4 font-semibold tracking-[0.4px] text-foreground">We really don’t recommend this option,</h6>
              <p className="text-[13px] leading-4 tracking-[0.4px] text-foreground">Here&apos;s why</p>
            </div>
            <ul className="mt-[15px] max-w-[380px] list-disc space-y-[15px] pl-[25px] text-sm leading-4 tracking-[0.4px] text-wz-strong">
              <li>Calls to a phone that is off or out of service will NOT be marked as missed.</li>
              <li>Calls sent to voicemail will NOT be marked as missed.</li>
              <li>Who answered the call is NOT tracked.</li>
            </ul>
            <p className="mt-[37px] mb-5 text-sm leading-4 tracking-[0.4px] text-wz-strong">Are you sure you want to take the risk?</p>
          </>
        ) : null}
      </div>

      <label className="flex items-center gap-2 px-[30px] py-[25px] text-sm leading-4 tracking-[0.4px] text-wz-strong">
        Move to next step after
        <input
          type="number"
          aria-label="Move to next step after"
          min={CALL_FLOW_LIMITS.minRingTimeoutSec}
          max={CALL_FLOW_LIMITS.maxRingTimeoutSec}
          placeholder={String(CALL_FLOW_LIMITS.defaultRingTimeoutSec)}
          className="h-8 w-[66px] rounded-[8px] border border-[#b8bfc1] bg-white px-0.5 text-sm leading-4 text-[#666] outline-none focus:border-wz-link"
          value={node.timeoutSec ?? ""}
          onChange={(e) => setTimeout_(e.target.value)}
        />
        sec
      </label>

      <div className="mx-[30px] border-b border-[rgba(62,75,81,0.24)] pt-3">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((o) => !o)}
          className="flex w-full cursor-pointer items-center justify-between pb-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-wz-focus"
        >
          <span className="text-[13px] leading-[19px] font-medium tracking-[0.4px] text-foreground">Advanced</span>
          <span className="grid size-6 place-items-center rounded-full bg-[#3e4b51] text-[#50d58c]" aria-hidden>
            <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} strokeWidth={2.5} />
          </span>
        </button>
        {advanced ? (
          <div className="pb-4">
            <WzCheckbox
              label="Make real phones press a key first"
              checked={!!node.whisper}
              onCheckedChange={(checked) => onChange({ ...node, whisper: checked })}
            />
            <p className="mt-1 pl-[28px] text-[13px] leading-4 tracking-[0.4px] text-wz-slate">
              Stops a phone&apos;s voicemail answering and taking the call from everyone else still ringing. Softphones never need it.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
