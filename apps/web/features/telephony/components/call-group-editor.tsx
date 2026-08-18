"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  useCreateCallGroup,
  useSetCallGroupMembers,
  useUpdateCallGroup,
} from "../call-groups-hooks";

/** A member as the editor holds it, before anything is saved. */
interface Draft {
  userId: string;
  channel: CallGroupChannel;
  enabled: boolean;
  name: string;
  phone?: string;
  softphoneOnline: boolean;
}

const CHANNELS: CallGroupChannel[] = ["softphone", "personal", "both"];
const CHANNEL_LABEL: Record<CallGroupChannel, string> = {
  softphone: "Softphone",
  personal: "Personal",
  both: "Both",
};

/**
 * Create or edit one group.
 *
 * Everything is held in a draft and saved on one click: the group's own fields
 * and its membership are two writes on the server, but one decision here.
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
    (group?.members ?? []).map((m) => ({
      userId: m.userId,
      channel: m.channel,
      enabled: m.enabled,
      name: m.name ?? "Former teammate",
      phone: m.phone,
      softphoneOnline: m.softphoneOnline,
    })),
  );
  const [picking, setPicking] = useState(false);

  const create = useCreateCallGroup();
  const update = useUpdateCallGroup(group?.id ?? "");
  const setServerMembers = useSetCallGroupMembers(group?.id ?? "");
  const pending = create.isPending || update.isPending || setServerMembers.isPending;

  const payload = () =>
    members.map((m, i) => ({
      userId: m.userId,
      channel: m.channel,
      order: i,
      enabled: m.enabled,
    }));

  const save = async () => {
    if (!name.trim()) return;
    if (editing) {
      // Fields first, then membership: a rejected membership leaves the group's
      // own edits saved rather than losing both.
      await update.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        type,
        active,
      });
      await setServerMembers.mutateAsync(payload());
    } else {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        active,
        members: payload(),
      });
    }
    onClose();
  };

  const setChannel = (userId: string, channel: CallGroupChannel) =>
    setMembers((list) =>
      list.map((m) => (m.userId === userId ? { ...m, channel } : m)),
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${group.name}` : "New call group"}</DialogTitle>
          <DialogDescription>
            The people an inbound call should reach, and which of their phones to
            ring.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cg-name">Name</Label>
              <Input
                id="cg-name"
                className="h-9"
                value={name}
                maxLength={CALL_GROUP_LIMITS.nameMaxLength}
                placeholder="Dispatch"
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rings</Label>
              <div className="flex h-9 items-center gap-1 rounded-md border p-0.5">
                {(["ring_all", "in_order"] as CallGroupType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-xs",
                      type === t
                        ? "bg-brand text-white"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {t === "ring_all" ? "All at once" : "In order"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cg-desc">Description</Label>
            <Textarea
              id="cg-desc"
              rows={2}
              value={description}
              placeholder="What this group is for."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* members */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Members{" "}
                <span className="font-normal text-muted-foreground">
                  ({members.length}/{CALL_GROUP_LIMITS.maxMembers})
                </span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={members.length >= CALL_GROUP_LIMITS.maxMembers}
                onClick={() => setPicking(true)}
              >
                <Plus className="size-3.5" /> Add member
              </Button>
            </div>

            {members.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Nobody yet. A group with no members can be saved, but not switched
                on.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        m.softphoneOnline ? "bg-emerald-500" : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.phone
                          ? formatPhone(m.phone)
                          : "No personal number on file"}
                        {type === "in_order"
                          ? ` · rings ${members.indexOf(m) + 1}${
                              members.indexOf(m) === 0 ? "st" : ""
                            }`
                          : ""}
                      </span>
                    </span>

                    <span className="flex items-center rounded-md border text-[11px]">
                      {CHANNELS.map((c) => {
                        // A channel nobody can be reached on is refused by the
                        // server; say why here instead of failing on save.
                        const blocked = c !== "softphone" && !m.phone;
                        return (
                          <button
                            key={c}
                            type="button"
                            disabled={blocked}
                            title={
                              blocked
                                ? `${m.name} has no personal number on file`
                                : undefined
                            }
                            onClick={() => setChannel(m.userId, c)}
                            className={cn(
                              "px-2 py-1 first:rounded-l-md last:rounded-r-md",
                              m.channel === c
                                ? "bg-brand text-white"
                                : blocked
                                  ? "text-muted-foreground/40"
                                  : "text-muted-foreground hover:bg-accent",
                            )}
                          >
                            {CHANNEL_LABEL[c]}
                          </button>
                        );
                      })}
                    </span>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove ${m.name}`}
                      onClick={() =>
                        setMembers((list) =>
                          list.filter((x) => x.userId !== m.userId),
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                A paused group keeps its members but takes no calls.
              </p>
            </div>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              aria-label="Active"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Numbers are read from each person&apos;s profile when the call comes in.
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="gap-1.5"
              disabled={pending || !name.trim()}
              onClick={save}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {editing ? "Save group" : "Create group"}
            </Button>
          </div>
        </div>

        {picking ? (
          <MemberPicker
            exclude={members.map((m) => m.userId)}
            onClose={() => setPicking(false)}
            onPick={(user) => {
              setMembers((list) => [
                ...list,
                {
                  userId: user.id,
                  // Softphone by default: it's free, and a personal number is a
                  // billed leg that should be an explicit choice.
                  channel: "softphone",
                  enabled: true,
                  name: user.name,
                  phone: user.phone,
                  softphoneOnline: user.softphoneOnline,
                },
              ]);
              setPicking(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The same roster the transfer picker uses — name, own number, softphone state. */
function MemberPicker({
  exclude,
  onPick,
  onClose,
}: {
  exclude: string[];
  onPick: (user: {
    id: string;
    name: string;
    phone?: string;
    softphoneOnline: boolean;
  }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.telephony.transferTargets(),
    queryFn: listTransferTargets,
    staleTime: 60_000,
  });

  const q = query.trim().toLowerCase();
  const hits = (data ?? [])
    .filter((u) => !exclude.includes(u.id))
    .filter((u) => !q || u.name.toLowerCase().includes(q));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Anyone on the team. Their softphone and their own number both come
            from their profile.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates…"
            className="h-9 pl-8"
          />
        </div>

        <ul className="max-h-72 divide-y overflow-y-auto">
          {isLoading ? (
            <li className="py-6 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto size-4 animate-spin" />
            </li>
          ) : hits.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">
              {exclude.length && !q ? "Everyone is already a member." : "Nobody matches."}
            </li>
          ) : (
            hits.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-1 py-2 text-left hover:bg-accent"
                  onClick={() => onPick(u)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      u.softphoneOnline ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{u.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.phone ? formatPhone(u.phone) : "No personal number"}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
