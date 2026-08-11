"use client";

import { useState } from "react";
import { Loader2, Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import { useNumbers, useReleaseNumber } from "../numbers-hooks";
import type { OwnedNumber } from "../numbers-api";
import { BuyNumberDialog } from "./buy-number-dialog";

export function PhoneNumbersPage() {
  const { can } = usePermissions();
  const { data: numbers, isLoading } = useNumbers(true);
  const release = useReleaseNumber();

  const [buyOpen, setBuyOpen] = useState(false);
  const [deleting, setDeleting] = useState<OwnedNumber | undefined>();

  const canManage = can("settings", "edit");

  if (!can("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view phone numbers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Phone numbers
          </h2>
          <p className="text-sm text-muted-foreground">
            Numbers your team calls and receives on. New numbers are wired up for
            inbound automatically.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5"
            onClick={() => setBuyOpen(true)}
          >
            <Plus className="size-4" /> Buy number
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !numbers || numbers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Phone className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No phone numbers yet</p>
          <p className="text-sm text-muted-foreground">
            Buy a number to start making and receiving calls.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Label</TableHead>
                {canManage ? (
                  <TableHead className="w-16 text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {numbers.map((n) => (
                <TableRow key={n.sid}>
                  <TableCell className="font-medium">
                    {formatPhone(n.phoneNumber)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {n.friendlyName}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setDeleting(n)}
                        aria-label="Release number"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {buyOpen ? (
        <BuyNumberDialog open={buyOpen} onOpenChange={setBuyOpen} />
      ) : null}

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this number?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? formatPhone(deleting.phoneNumber) : ""} will be
              permanently released back to Twilio. You can&apos;t get the same
              number back, and inbound/outbound on it will stop immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting)
                  release.mutate(deleting.sid, {
                    onSuccess: () => setDeleting(undefined),
                  });
              }}
            >
              {release.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Release"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
