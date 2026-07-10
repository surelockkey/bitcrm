import { ArrowRight, Factory, Receipt, Truck, Warehouse } from "lucide-react";
import type { Transfer } from "@bitcrm/types";
import { resolveEndpoint, type ResolvedEndpoint, type EndpointKind } from "../lib";

function KindIcon({ kind }: { kind: EndpointKind }) {
  const cls = "size-3.5 flex-none text-muted-foreground";
  if (kind === "warehouse") return <Warehouse className={cls} />;
  if (kind === "container") return <Truck className={cls} />;
  if (kind === "supplier") return <Factory className={cls} />;
  if (kind === "deal") return <Receipt className={cls} />;
  return null;
}

function Endpoint({ e }: { e: ResolvedEndpoint }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <KindIcon kind={e.kind} />
      <span className={e.kind === "deal" ? "truncate font-mono text-xs text-muted-foreground" : "truncate"}>
        {e.name}
      </span>
    </span>
  );
}

export function TransferRoute({
  transfer,
  locationMap,
}: {
  transfer: Transfer;
  locationMap: Map<string, string>;
}) {
  const from = resolveEndpoint(transfer.fromType, transfer.fromId, transfer.notes, locationMap);
  const to = resolveEndpoint(transfer.toType, transfer.toId, transfer.notes, locationMap);
  return (
    <span className="flex items-center gap-2 text-[13px]">
      <Endpoint e={from} />
      <ArrowRight className="size-3.5 flex-none text-muted-foreground/60" />
      <Endpoint e={to} />
    </span>
  );
}
