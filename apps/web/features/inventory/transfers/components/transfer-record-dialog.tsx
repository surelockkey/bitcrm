"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Transfer } from "@bitcrm/types";
import { formatDate } from "@/features/users/lib";
import { returnReasonLabel, transferEndpoints } from "../lib";
import { TransferTypeBadge } from "./transfer-type-badge";
import { TransferRoute } from "./transfer-route";

export function TransferRecordDialog({
  transfer,
  locationMap,
  open,
  onOpenChange,
}: {
  transfer: Transfer | null;
  locationMap: Map<string, string>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const ends = transfer ? transferEndpoints(transfer, locationMap) : null;
  const dealId = ends?.to.dealId ?? ends?.from.dealId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Header fixed, body scrolls: a template fill of forty lines used to push
          the popup's top off the screen. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2.5">
            {transfer ? <TransferTypeBadge type={transfer.type} /> : null}
            {transfer ? (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {transfer.id.slice(0, 8)}…
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {transfer ? (
          <div data-testid="transfer-record-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <Label className="mb-1.5 block text-[11px] tracking-wide uppercase">Route</Label>
              <TransferRoute transfer={transfer} locationMap={locationMap} />
            </div>

            <div>
              <Label className="mb-1.5 block text-[11px] tracking-wide uppercase">
                Items · {transfer.items.length}
              </Label>
              <div className="divide-y rounded-lg border">
                {transfer.items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate">{it.productName}</span>
                    <span className="tabular-nums text-muted-foreground">×{it.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Performed by</dt>
                <dd className="truncate font-mono text-xs">{transfer.performedByName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">When</dt>
                <dd>{formatDate(transfer.createdAt)}</dd>
              </div>
              {transfer.reason ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd>{returnReasonLabel(transfer.reason)}</dd>
                </div>
              ) : null}
              {dealId ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Job</dt>
                  <dd className="min-w-0">
                    <Link href={`/deals/${dealId}`} className="block truncate text-brand hover:underline">
                      Open job
                    </Link>
                  </dd>
                </div>
              ) : null}
              {transfer.notes ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="truncate text-right">{transfer.notes}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
