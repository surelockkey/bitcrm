"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useCallFlows } from "../call-flows-hooks";
import { useCallGroups, useTeammates } from "../call-groups-hooks";
import { useCallDevices } from "../call-devices-hooks";
import { useNumbers } from "../numbers-hooks";
import { CallFlowEditor } from "./call-flow-editor";

/**
 * The call flow builder as a page in the app (`/calls/flows/<id>`, a new one
 * at `/calls/flows/new`) — Workiz's /root/flowBuilder/<id>, which sits in its
 * shell under the breadcrumb, not over it. One skeleton, then the whole
 * builder: the flows, the groups its ring cards name and the numbers it
 * offers are all in before it is drawn. Its ← goes back to the list.
 */
export function CallFlowBuilderPage({ flowId }: { flowId?: string }) {
  const router = useRouter();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const enabled = can("settings");
  const flowsQuery = useCallFlows(enabled);
  const groupsQuery = useCallGroups(enabled);
  const numbersQuery = useNumbers(enabled);
  // The Forward cards name teammates and devices too, so those come in
  // before the canvas is drawn — never a card that renames itself a beat later.
  const teammatesQuery = useTeammates(enabled);
  const devicesQuery = useCallDevices(enabled);
  const ready = usePageReady(
    !permissionsLoading && [flowsQuery, groupsQuery, numbersQuery, teammatesQuery, devicesQuery].every(settled),
  );

  if (denied("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view call flows.</p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-[92px] shrink-0" />
        <Skeleton className="min-h-[400px] flex-1 rounded-none" />
      </div>
    );
  }

  const flow = flowId ? flowsQuery.data?.find((f) => f.id === flowId) : undefined;
  if (flowId && !flow) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-foreground">This call flow no longer exists.</p>
        <Link href="/calls/flows" className="text-[13px] font-semibold text-wz-link hover:underline">
          Back to call flows
        </Link>
      </div>
    );
  }

  return <CallFlowEditor key={flow?.id ?? "new"} flow={flow} open onClose={() => router.push("/calls/flows")} />;
}
