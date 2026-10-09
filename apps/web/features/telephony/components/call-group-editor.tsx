"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, Search } from "lucide-react";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzSwitchTabs } from "@/components/workiz/switch-tabs";
import { WzCheckbox } from "@/components/workiz/toggles";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { queryKeys } from "@/lib/query-keys";
import {
  CALL_GROUP_LIMITS,
  type CallGroupChannel,
  type CallGroupType,
  type CallGroupWithMembers,
} from "@bitcrm/types";
import { listTransferTargets } from "../api";
import { useCallDevices } from "../call-devices-hooks";
import { useCreateCallGroup, useSetCallGroupMembers, useUpdateCallGroup } from "../call-groups-hooks";

/** A member as the editor holds it, before anything is saved. */
interface Draft {
  userId: string;
  channel: CallGroupChannel;
  enabled: boolean;
  name: string;
  phone?: string;
  softphoneOnline: boolean;
}

/** A device ticked in the draft — from the Devices catalog, or one that has left it. */
interface DeviceDraft {
  deviceId: string;
  enabled: boolean;
}

/** A device the grid offers: Workiz's card says its name, "Device", and the number it rings on. */
interface DeviceCandidate {
  id: string;
  name: string;
  /** The number as people write it, or the SIP address. */
  rings?: string;
  /** Paused in the catalog, or gone from it: ticked, it would not ring. */
  silent: boolean;
}

/** A teammate the grid offers — from the directory, or a member who has left it. */
interface Candidate {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  softphoneOnline: boolean;
}

const CHANNELS: CallGroupChannel[] = ["softphone", "personal", "both"];
const CHANNEL_LABEL: Record<CallGroupChannel, string> = {
  softphone: "Softphone",
  personal: "Personal",
  both: "Both",
};
const RING_TABS = [
  { value: "ring_all", label: "All at once" },
  { value: "in_order", label: "In order" },
] as const;

/**
 * How a ticked member is rung (ours): Softphone | Personal | Both, a small
 * switch in Workiz's SwitchTabs look. A channel nobody can be reached on is
 * refused by the server, so it is held here, with the reason in its title.
 */
function ChannelSwitch({ member, onChange }: { member: Draft; onChange: (c: CallGroupChannel) => void }) {
  return (
    <div role="tablist" aria-label={`How ${member.name} is rung`} className="inline-flex gap-1 rounded-[4px] bg-wz-secondary-hover p-0.5">
      {CHANNELS.map((c) => {
        const blocked = c !== "softphone" && !member.phone;
        const on = member.channel === c;
        return (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={blocked}
            title={blocked ? `${member.name} has no personal number on file` : undefined}
            onClick={() => onChange(c)}
            className={cn(
              "cursor-pointer rounded-[2px] px-2.5 py-1 text-xs leading-4 tracking-[0.4px] outline-none focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:text-wz-outline-disabled",
              on ? "bg-white font-semibold text-wz-link shadow-[0_2px_4px_rgba(59,75,82,0.1)]" : "text-foreground",
            )}
          >
            {CHANNEL_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Create or edit one group — Workiz's "create group" / "Edit group" modal
 * (pg_settings_phone_wz_groups_create_open, _edit_open): 938px, Group name,
 * "Members in group" with its line about who rings, and every teammate as a
 * 60px card in two columns (phone glyph, name and number over a second line,
 * a tick box at the right). Ours kept in it: All at once | In order (ticked
 * order is ring order), the description, how each ticked member is rung,
 * whether anybody would ring right now, Active. Devices (the Devices
 * catalog) come first, as Workiz lists them: name, "Device", the number.
 * Everything is held in a
 * draft and saved on one click: the group's own fields and its membership
 * are two writes on the server, but one decision here.
 */
export function CallGroupEditor({
  group,
  open,
  onClose,
}: {
  /** Absent = creating a new group. */
  group?: CallGroupWithMembers;
  open: boolean;
  onClose: () => void;
}) {
  const editing = !!group;

  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [type, setType] = useState<CallGroupType>(group?.type ?? "ring_all");
  const [active, setActive] = useState(group?.active ?? true);
  const [members, setMembers] = useState<Draft[]>(
    [...(group?.members ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        userId: m.userId,
        channel: m.channel,
        enabled: m.enabled,
        name: m.name ?? "Former teammate",
        phone: m.phone,
        softphoneOnline: m.softphoneOnline,
      })),
  );
  const [deviceDrafts, setDeviceDrafts] = useState<DeviceDraft[]>(
    [...(group?.deviceMembers ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((d) => ({ deviceId: d.deviceId, enabled: d.enabled })),
  );
  const [query, setQuery] = useState("");
  const { data: catalog } = useCallDevices(open);

  const { data: directory } = useQuery({
    queryKey: [...queryKeys.telephony.transferTargets(), "with-self"],
    // Including yourself: adding yourself to a group is the common case, and
    // leaving yourself out is how somebody ends up adding the wrong account.
    queryFn: () => listTransferTargets(true),
    staleTime: 60_000,
    enabled: open,
  });

  const create = useCreateCallGroup();
  const update = useUpdateCallGroup(group?.id ?? "");
  const setServerMembers = useSetCallGroupMembers(group?.id ?? "");
  const pending = create.isPending || update.isPending || setServerMembers.isPending;

  // Every teammate once; a member the directory no longer lists stays offered
  // (ticked), so saving never drops them by accident.
  const candidates = useMemo<Candidate[]>(() => {
    const list: Candidate[] = (directory ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email ?? undefined,
      phone: u.phone ?? undefined,
      softphoneOnline: u.softphoneOnline,
    }));
    // The group's own members too (unticked ones stay offered for the session).
    const known = [
      ...(group?.members ?? []).map((m) => ({ ...m, name: m.name ?? "Former teammate" })),
      ...members,
    ];
    for (const m of known) {
      if (!list.some((c) => c.id === m.userId)) {
        list.push({ id: m.userId, name: m.name, phone: m.phone, softphoneOnline: m.softphoneOnline });
      }
    }
    return list;
  }, [directory, members, group?.members]);

  // Every device in the catalog once, plus any the group holds that has left it.
  const deviceCandidates = useMemo<DeviceCandidate[]>(() => {
    const list: DeviceCandidate[] = (catalog ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      rings: d.number ? formatPhone(d.number) || d.number : d.sipAddress,
      silent: !d.active,
    }));
    for (const d of group?.deviceMembers ?? []) {
      if (!list.some((c) => c.id === d.deviceId)) {
        list.push({
          id: d.deviceId,
          name: d.missing || !d.name ? "Deleted device" : d.name,
          rings: d.number ? formatPhone(d.number) || d.number : undefined,
          silent: d.missing,
        });
      }
    }
    return list;
  }, [catalog, group?.deviceMembers]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? candidates.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q))
    : candidates;
  const shownDevices = q
    ? deviceCandidates.filter((d) => d.name.toLowerCase().includes(q) || (d.rings ?? "").toLowerCase().includes(q))
    : deviceCandidates;

  /**
   * How this member would be reached if a call arrived now, or null if they
   * wouldn't be. A group full of unreachable people looks perfectly healthy
   * otherwise — you find out from a missed call.
   */
  const reachOf = (m: Draft): string | null => {
    const ways: string[] = [];
    if (m.channel !== "personal" && m.softphoneOnline) ways.push("softphone");
    if (m.channel !== "softphone" && m.phone) ways.push(formatPhone(m.phone));
    return ways.length ? ways.join(" + ") : null;
  };
  // A device rings whenever the group does, unless it is paused or gone.
  const ringingDevices = deviceDrafts.filter(
    (d) => d.enabled && !deviceCandidates.find((c) => c.id === d.deviceId)?.silent,
  ).length;
  const reachable = members.filter((m) => m.enabled && reachOf(m)).length + ringingDevices;
  const everyone = members.length + deviceDrafts.length;
  // People and devices share the one cap: every one of them is a billed leg.
  const full = everyone >= CALL_GROUP_LIMITS.maxMembers;

  const toggleDevice = (d: DeviceCandidate) =>
    setDeviceDrafts((list) =>
      list.some((x) => x.deviceId === d.id) ? list.filter((x) => x.deviceId !== d.id) : [...list, { deviceId: d.id, enabled: true }],
    );

  const toggle = (c: Candidate) =>
    setMembers((list) =>
      list.some((m) => m.userId === c.id)
        ? list.filter((m) => m.userId !== c.id)
        : [
            ...list,
            {
              userId: c.id,
              // Softphone by default: it's free, and a personal number is a
              // billed leg that should be an explicit choice.
              channel: "softphone",
              enabled: true,
              name: c.name,
              phone: c.phone,
              softphoneOnline: c.softphoneOnline,
            },
          ],
    );

  const setChannel = (userId: string, channel: CallGroupChannel) =>
    setMembers((list) => list.map((m) => (m.userId === userId ? { ...m, channel } : m)));

  const payload = () => members.map((m, i) => ({ userId: m.userId, channel: m.channel, order: i, enabled: m.enabled }));
  const devicePayload = () => deviceDrafts.map((d, i) => ({ deviceId: d.deviceId, order: i, enabled: d.enabled }));
  // Devices go only where there are any to speak of — an API from before
  // them would refuse a field it doesn't know.
  const sendsDevices = deviceCandidates.length > 0 || group?.deviceMembers !== undefined;

  const save = async () => {
    if (!name.trim()) return;
    if (editing) {
      // Fields first, then membership: a rejected membership leaves the group's
      // own edits saved rather than losing both.
      await update.mutateAsync({ name: name.trim(), description: description.trim(), type, active });
      await setServerMembers.mutateAsync({
        members: payload(),
        ...(sendsDevices && { deviceMembers: devicePayload() }),
      });
    } else {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        active,
        members: payload(),
        ...(deviceDrafts.length > 0 && { deviceMembers: devicePayload() }),
      });
    }
    onClose();
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? "Edit group" : "Create group"}
      onSave={() => void save()}
      saving={pending}
      saveDisabled={!name.trim()}
      className="max-h-[92vh] w-[938px] overflow-y-auto sm:max-w-[938px]"
    >
      <div className="flex flex-wrap items-start gap-4">
        <WzOutlinedTextField
          label="Group name"
          value={name}
          maxLength={CALL_GROUP_LIMITS.nameMaxLength}
          onChange={(e) => setName(e.target.value)}
          className="w-[445px] max-w-full"
        />
        <WzSwitchTabs
          aria-label="Rings"
          tabs={RING_TABS}
          value={type}
          onChange={(v) => setType(v as CallGroupType)}
          className="w-[300px]"
        />
      </div>
      <WzOutlinedTextField
        label="Description"
        placeholder="What this group is for"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div>
        <h3 className="text-base leading-6 font-semibold tracking-[0.4px] text-foreground">Members in group</h3>
        <p className="mt-2 text-[13px] leading-[19px] tracking-[0.4px] text-wz-slate">
          {type === "ring_all"
            ? "Calls forwarded to this group will simultaneously ring all selected users."
            : "Calls forwarded to this group will ring the selected users one after another, in the order they were ticked."}
          {" "}*Softphones will ring if open and available for logged in users; a personal phone rings its own number.
        </p>
        {everyone > 0 ? (
          <p
            className={cn(
              "mt-2 text-[13px] leading-[19px] tracking-[0.4px]",
              reachable === 0 ? "font-semibold text-wz-danger" : "text-wz-slate",
            )}
          >
            {reachable === 0
              ? "Nobody here can be reached right now — a call to this group would go unanswered."
              : `${reachable} of ${everyone} reachable right now.`}
          </p>
        ) : null}

        <div className="relative mt-4 w-[445px] max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-wz-outline-label" aria-hidden />
          <input
            type="search"
            aria-label="Search teammates"
            placeholder="Search teammates…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-[4px] border border-wz-outline bg-white pr-3 pl-9 text-[13px] tracking-[0.4px] text-foreground outline-none placeholder:text-wz-outline-label hover:border-foreground focus:border-wz-link"
          />
        </div>

        <ul aria-label="Members in group" className="mt-4 grid max-h-[360px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {/* Workiz lists the devices first (pg_settings_phone_wz_groups_edit_open):
              the name, "Device" under it, the number beside the name. */}
          {shownDevices.map((d) => {
            const ticked = deviceDrafts.find((x) => x.deviceId === d.id);
            const position = ticked ? deviceDrafts.indexOf(ticked) + 1 : 0;
            return (
              <li
                key={`device-${d.id}`}
                className={cn(
                  "flex min-h-[60px] items-start gap-3 rounded-[4px] border border-wz-frame px-4 py-2.5",
                  ticked && "border-foreground/40",
                )}
              >
                <Phone className="mt-0.5 size-[18px] shrink-0 text-foreground" strokeWidth={1.5} aria-hidden />
                <div className="min-w-0 flex-1 text-sm leading-[21px] tracking-[0.4px] text-foreground">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {ticked && type === "in_order" ? (
                      <span className="shrink-0 text-xs font-semibold text-wz-slate">{position}.</span>
                    ) : null}
                    <span className="truncate">{d.name}</span>
                    {d.rings ? <span className="shrink-0">{d.rings}</span> : null}
                  </div>
                  <div className="truncate">Device</div>
                  {ticked && d.silent ? (
                    <span className="mt-1 block text-xs leading-4 text-wz-danger">Won&apos;t ring — paused or removed from Devices</span>
                  ) : null}
                </div>
                <input
                  type="checkbox"
                  className="mt-1 size-[13px] shrink-0 cursor-pointer disabled:cursor-not-allowed"
                  aria-label={[d.name, "Device", d.rings].filter(Boolean).join(" ")}
                  checked={!!ticked}
                  disabled={!ticked && full}
                  onChange={() => toggleDevice(d)}
                />
              </li>
            );
          })}
          {shown.map((c) => {
            const member = members.find((m) => m.userId === c.id);
            const position = member ? members.indexOf(member) + 1 : 0;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex min-h-[60px] items-start gap-3 rounded-[4px] border border-wz-frame px-4 py-2.5",
                  member && "border-foreground/40",
                )}
              >
                <Phone className="mt-0.5 size-[18px] shrink-0 text-foreground" strokeWidth={1.5} aria-hidden />
                <div className="min-w-0 flex-1 text-sm leading-[21px] tracking-[0.4px] text-foreground">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {member && type === "in_order" ? (
                      <span className="shrink-0 text-xs font-semibold text-wz-slate">{position}.</span>
                    ) : null}
                    <span className="truncate">{c.name}</span>
                    {c.phone ? <span className="shrink-0">{formatPhone(c.phone)}</span> : null}
                  </div>
                  <div className="truncate text-wz-slate">{c.email ?? "Not in the team directory"}</div>
                  {member ? (
                    <div className="mt-2 flex flex-col items-start gap-1">
                      <ChannelSwitch member={member} onChange={(ch) => setChannel(member.userId, ch)} />
                      <span className={cn("text-xs leading-4", reachOf(member) ? "text-wz-slate" : "text-wz-danger")}>
                        {reachOf(member) ? `Rings on ${reachOf(member)}` : "Won't ring — softphone offline and no personal number"}
                      </span>
                    </div>
                  ) : null}
                </div>
                <input
                  type="checkbox"
                  className="mt-1 size-[13px] shrink-0 cursor-pointer disabled:cursor-not-allowed"
                  aria-label={[c.name, c.email].filter(Boolean).join(" ")}
                  checked={!!member}
                  disabled={!member && full}
                  onChange={() => toggle(c)}
                />
              </li>
            );
          })}
          {shown.length === 0 && shownDevices.length === 0 ? (
            <li className="col-span-full py-6 text-center text-sm text-wz-slate">{q ? "Nobody matches." : "Loading the team…"}</li>
          ) : null}
        </ul>
        <p className="mt-2 text-xs leading-4 text-wz-caption">
          {`${everyone}/${CALL_GROUP_LIMITS.maxMembers} members`} · numbers are read from each person&apos;s profile and each device when the call comes in.
        </p>
      </div>

      <div>
        <WzCheckbox label="Active" checked={active} onCheckedChange={setActive} />
        <p className="mt-1 pl-[28px] text-[13px] leading-[19px] tracking-[0.4px] text-wz-slate">
          A paused group keeps its members but takes no calls.
        </p>
      </div>
    </WzFormModal>
  );
}
