"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Info, Loader2, Users } from "lucide-react";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import type { UserContainer } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DialogLoadingBody } from "@/features/inventory/components/dialog-loading";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { personName } from "@/features/deals/person-name";
import { useUser } from "@/features/users/hooks";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import type { StockLocation } from "@/features/inventory/stock/lib";
import { LocationPicker } from "@/features/inventory/stock/components/location-picker";
import { useAssignUserContainer, useUserContainers, useUserNames } from "../hooks";
import {
  assignmentOf,
  containerUserNames,
  namesSummary,
  unnamedUserIds,
  usersOfContainer,
  type Assignment,
  type ContainerUser,
} from "../lib";

/**
 * Which van one user works from — Workiz's "User containers" popup: one
 * specific container, every location, or none. A van may be shared, so
 * picking one somebody else uses is allowed; the popup only says so.
 *
 * Opened from the row or `?assign=<userId>`; read-only without `containers.edit`.
 */
export function AssignContainerDialog({
  userId,
  user,
  open,
  onOpenChange,
}: {
  userId: string;
  /** The row the page already holds; without it the user is looked up. */
  user?: { userId: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = usePermissions();
  const readOnly = !can("containers", "edit");
  const lookup = useUser(user ? undefined : userId);
  const name = user?.name ?? personName(lookup.data) ?? "";

  const rows = useUserContainers(open);
  const locations = useAllLocations(open);
  const close = () => onOpenChange(false);
  // Escape in the open container list closes the list, not the popup. The
  // form says how to do that; a ref, since Radix may call an older handler.
  const closeListRef = useRef<(() => boolean) | null>(null);

  let content: ReactNode;
  if (rows.isLoading || locations.isLoading || (!user && lookup.isLoading)) {
    content = (
      <>
        <Header name={name} />
        <DialogLoadingBody testId="assign-container-loading" fields={["input", "input", "switch"]} />
      </>
    );
  } else if (!user && (lookup.isError || !lookup.data)) {
    content = (
      <>
        <Header name="User not found" />
        <DialogFooter className="m-0 flex-none">
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  } else {
    content = (
      <AssignForm
        userId={userId}
        name={name}
        rows={rows.data ?? []}
        locations={locations.data}
        readOnly={readOnly}
        onClose={close}
        closeListRef={closeListRef}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        onEscapeKeyDown={(e) => {
          if (closeListRef.current?.()) e.preventDefault();
        }}
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}

const CHOICES: { access: UserContainerAccess; title: string; detail: string }[] = [
  { access: UserContainerAccess.CONTAINER, title: "Specific container", detail: "Works from one van." },
  { access: UserContainerAccess.ALL, title: "All locations", detail: "May use stock in every warehouse and van." },
  { access: UserContainerAccess.NONE, title: "No access", detail: "Works from no stock location." },
];

function AssignForm({
  userId,
  name,
  rows,
  locations,
  readOnly,
  onClose,
  closeListRef,
}: {
  userId: string;
  name: string;
  rows: UserContainer[];
  locations: StockLocation[];
  readOnly: boolean;
  onClose: () => void;
  closeListRef: RefObject<(() => boolean) | null>;
}) {
  const assign = useAssignUserContainer();
  const rowsByUser = useMemo(() => new Map(rows.map((r) => [r.userId, r] as const)), [rows]);
  const vans = useMemo(() => locations.filter((l) => l.type === "container"), [locations]);
  const current: Assignment = useMemo(() => assignmentOf(userId, rowsByUser, vans), [userId, rowsByUser, vans]);

  // Rows the backfill wrote carry the user id as the name: look those up.
  const unnamed = useMemo(() => unnamedUserIds(rows), [rows]);
  const { names } = useUserNames(unnamed);
  const byVan = useMemo(() => containerUserNames(rows, names), [rows, names]);
  const usersOf = (van: StockLocation): ContainerUser[] => usersOfContainer(van, byVan, rowsByUser);

  const [access, setAccess] = useState<UserContainerAccess>(current.access ?? UserContainerAccess.CONTAINER);
  const [containerId, setContainerId] = useState<string | undefined>(current.containerId);
  const [limited, setLimited] = useState(current.limited);
  const [picking, setPicking] = useState(false);
  const labelId = useId();
  useEffect(() => {
    closeListRef.current = () => {
      if (!picking) return false;
      setPicking(false);
      return true;
    };
  }, [picking, closeListRef]);

  const openVans = vans.filter((v) => v.status !== InventoryStatus.ARCHIVED);
  // The user's own van stays showable even if it was archived since.
  const chosen = vans.find((v) => v.id === containerId) ?? null;
  const others = chosen ? usersOf(chosen).filter((u) => u.userId !== userId) : [];
  const withContainer = access === UserContainerAccess.CONTAINER;

  const hint = (van: StockLocation) => {
    const people = usersOf(van).map((u) => u.name).filter((n): n is string => !!n);
    const { text, more } = namesSummary(people);
    return more ? `${text} +${more}` : text;
  };

  const save = () => {
    if (withContainer && !containerId) return;
    const unchanged =
      !current.legacy &&
      current.access === access &&
      (!withContainer || (current.containerId === containerId && current.limited === limited));
    if (unchanged) return onClose();
    assign.mutate(
      {
        userId,
        body: withContainer
          ? { userName: name, access, containerId, limited }
          : { userName: name, access },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) save();
      }}
    >
      <Header name={name} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {readOnly ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Info className="size-4" />
            You have view-only access to containers.
          </div>
        ) : null}

        <div role="radiogroup" aria-label="Access" className="grid gap-2">
          {CHOICES.map((c) => (
            <label
              key={c.access}
              className={cn(
                "flex gap-3 rounded-lg border p-3",
                access === c.access ? "border-brand bg-brand/5" : "hover:bg-accent",
                readOnly ? "cursor-default" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name="access"
                className="mt-1 accent-current"
                checked={access === c.access}
                disabled={readOnly}
                onChange={() => setAccess(c.access)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{c.title}</span>
                <span className="text-xs text-muted-foreground">{c.detail}</span>
              </span>
            </label>
          ))}
        </div>

        {withContainer ? (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <div className="space-y-1.5">
              <Label id={labelId}>Container</Label>
              <LocationPicker
                labelId={labelId}
                groups={{ warehouses: [], containers: openVans }}
                value={chosen}
                onChange={(v) => {
                  setContainerId(v.id);
                  setPicking(false);
                }}
                open={picking}
                onOpenChange={setPicking}
                hint={hint}
                placeholder="Pick a container"
                searchPlaceholder="Search containers"
                emptyText="No active containers."
                disabled={readOnly}
              />
              {current.legacy && containerId === current.containerId ? (
                <p className="text-xs text-muted-foreground">
                  From the van&apos;s technician link — saving makes it their assignment.
                </p>
              ) : null}
            </div>

            {others.length ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Users className="mt-0.5 size-4 flex-none" />
                Also used by {othersText(others)}.
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
              <div>
                <Label htmlFor={`${labelId}-limited`}>Limited to this container</Label>
                <p className="text-xs text-muted-foreground">They may use stock from their own van only.</p>
              </div>
              <Switch
                id={`${labelId}-limited`}
                aria-label="Limited to this container"
                checked={limited}
                disabled={readOnly}
                onCheckedChange={setLimited}
              />
            </div>
          </div>
        ) : null}
      </div>

      <DialogFooter className="m-0 flex-none">
        {readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="gap-1.5"
              disabled={assign.isPending || (withContainer && !containerId)}
            >
              {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

/** "Taras Koval, Pavlo Bondar" — and "2 others" for people not named yet. */
function othersText(others: ContainerUser[]): string {
  const named = others.map((o) => o.name).filter((n): n is string => !!n);
  const rest = others.length - named.length;
  return [...named, ...(rest ? [`${rest} other${rest === 1 ? "" : "s"}`] : [])].join(", ");
}

function Header({ name }: { name: string }) {
  return (
    // Right padding keeps the title clear of the close button.
    <DialogHeader className="border-b px-4 py-3 pr-12">
      <DialogTitle className="text-base">Assign container</DialogTitle>
      <DialogDescription className={name ? undefined : "sr-only"}>
        {name || "Which van this user works from."}
      </DialogDescription>
    </DialogHeader>
  );
}
