import Link from "next/link";
import { ArrowRight, Factory, Receipt, Truck, Undo2, Warehouse } from "lucide-react";
import type { Transfer } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { transferEndpoints, type ResolvedEndpoint, type EndpointKind } from "../lib";

function KindIcon({ kind }: { kind: EndpointKind }) {
  const cls = "size-3.5 flex-none text-muted-foreground";
  if (kind === "warehouse") return <Warehouse className={cls} />;
  if (kind === "container") return <Truck className={cls} />;
  if (kind === "supplier") return <Factory className={cls} />;
  if (kind === "deal") return <Receipt className={cls} />;
  if (kind === "return") return <Undo2 className={cls} />;
  return null;
}

/** A warehouse or van end whose name is still on its way. */
const isLocation = (kind: EndpointKind) => kind === "warehouse" || kind === "container";

function Endpoint({ e, pending }: { e: ResolvedEndpoint; pending: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <KindIcon kind={e.kind} />
      {pending && isLocation(e.kind) ? (
        // Waiting for the name, rather than printing "Warehouse" and swapping
        // the text a moment later.
        <Skeleton data-testid="route-name-pending" className="h-3.5 w-20" />
      ) : e.kind === "deal" && e.dealId ? (
        // The row itself opens the record; the link goes to the job instead.
        <Link
          href={`/deals/${e.dealId}`}
          onClick={(ev) => ev.stopPropagation()}
          className="truncate font-mono text-xs text-brand hover:underline"
        >
          {e.name}
        </Link>
      ) : (
        <span className="truncate">{e.name}</span>
      )}
    </span>
  );
}

export function TransferRoute({
  transfer,
  locationMap,
  pending = false,
}: {
  transfer: Transfer;
  locationMap: Map<string, string>;
  /** The location names are still loading: their ends wait, a job end doesn't. */
  pending?: boolean;
}) {
  const { from, to } = transferEndpoints(transfer, locationMap);
  return (
    <span className="flex items-center gap-2 text-[13px]">
      <Endpoint e={from} pending={pending} />
      <ArrowRight className="size-3.5 flex-none text-muted-foreground/60" />
      <Endpoint e={to} pending={pending} />
    </span>
  );
}
