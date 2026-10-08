"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Headset } from "lucide-react";
import { WzDrawer } from "@/components/workiz/drawer";
import { WzBadgeIconButton } from "@/components/workiz/page-parts";
import { queryKeys } from "@/lib/query-keys";
import { listTransferTargets } from "@/features/telephony/api";
import { useRoles } from "@/features/users/hooks";
import { roleName } from "@/features/users/lib";
import { useLiveCalls } from "../hooks";
import { callParty } from "../lib";
import { LiveCalls, MonitorAvatar } from "./live-calls";

/** A section band in the drawer: "On a call (3)" — grey, centred, 16px/500. */
function Band({ children }: { children: ReactNode }) {
  return <h3 className="bg-[#e9e9e9] py-[3px] text-center text-base leading-[22px] font-medium text-foreground">{children}</h3>;
}

/**
 * Workiz's headset beside Search — "Monitor calls" (callspage_wz_04_*): a
 * red count of the calls in progress over the icon; a click opens "Call
 * monitoring" at the right: "On a call (N)" — who is talking to whom and for
 * how long, with our Listen / Join — and "Off call (N)", the teammates whose
 * phone is on and free. The teammates are asked for when the drawer opens;
 * the live calls are the page's own (it waits for them before it draws).
 */
export function CallMonitoring() {
  const [open, setOpen] = useState(false);
  const { data: live } = useLiveCalls();
  const { data: roles } = useRoles();
  const teammates = useQuery({
    queryKey: queryKeys.telephony.teammates(),
    queryFn: () => listTransferTargets(true),
    enabled: open,
    staleTime: 15_000,
  });

  const onCall = useMemo(() => {
    const ids = new Set<string>();
    for (const call of live ?? []) {
      for (const side of ["from", "to"] as const) {
        const p = callParty(call, side);
        if (p.kind === "user" && p.id) ids.add(p.id);
      }
      for (const p of call.participants ?? []) ids.add(p.userId);
    }
    return ids;
  }, [live]);
  const offCall = (teammates.data ?? []).filter((t) => t.softphoneOnline && !onCall.has(t.id));
  const liveCount = live?.length ?? 0;

  return (
    <>
      <WzBadgeIconButton
        label="Monitor calls"
        icon={<Headset className="size-5" strokeWidth={1.5} />}
        count={liveCount}
        expanded={open}
        onClick={() => setOpen(true)}
      />
      <WzDrawer open={open} onOpenChange={setOpen} title="Call monitoring" width={400} bodyClassName="p-0">
        <Band>On a call ({liveCount})</Band>
        <LiveCalls />
        <Band>Off call ({teammates.data ? offCall.length : "…"})</Band>
        {offCall.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-wz-disabled-border px-4 py-3">
            <MonitorAvatar name={t.name} />
            <div className="min-w-0">
              <div className="truncate text-sm leading-4 text-foreground">{t.name}</div>
              {t.roleId ? <div className="mt-1 text-[11px] leading-4 text-wz-caption">{roleName(t.roleId, roles)}</div> : null}
            </div>
          </div>
        ))}
      </WzDrawer>
    </>
  );
}
