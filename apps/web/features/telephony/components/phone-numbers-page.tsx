"use client";

import { useState } from "react";
import { KeyRound, Loader2, Phone, Plus, Trash2 } from "lucide-react";
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
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import {
  useNumbers,
  useNumberSettings,
  useReleaseNumber,
  useSetTechnicianLine,
  useUpdateNumberSettings,
} from "../numbers-hooks";
import type { OwnedNumber } from "../numbers-api";
import { BuyNumberDialog } from "./buy-number-dialog";

export function PhoneNumbersPage() {
  const { can } = usePermissions();
  const { data: numbers, isLoading } = useNumbers(true);
  const { data: numberSettings } = useNumberSettings(can("settings"));
  const updateSettings = useUpdateNumberSettings();
  const release = useReleaseNumber();
  const setTechLine = useSetTechnicianLine();

  const [buyOpen, setBuyOpen] = useState(false);
  const [deleting, setDeleting] = useState<OwnedNumber | undefined>();

  const canManage = can("settings", "edit");
  const sourceOf = (phoneNumber: string) =>
    numberSettings?.find((s) => s.phoneNumber === phoneNumber)?.sourceId;

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
                <TableHead>Job source</TableHead>
                {canManage ? (
                  <TableHead className="w-24 text-right">Actions</TableHead>
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
                    <span className="flex items-center gap-2">
                      {n.friendlyName}
                      {n.technicianLine ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                          <KeyRound className="size-3" /> Technician line
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  {/* Call tracking: calls through this number are attributed
                      to the chosen source, and a job created from such a call
                      carries it automatically. */}
                  <TableCell>
                    <JobSourceSelect
                      value={sourceOf(n.phoneNumber)}
                      onChange={(sourceId) =>
                        updateSettings.mutate({
                          phoneNumber: n.phoneNumber,
                          sourceId: sourceId ?? null,
                        })
                      }
                      disabled={!canManage}
                    />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {/* A workspace has exactly one technician line, so this
                          reads as a designation rather than a per-number
                          setting: turning it on elsewhere moves it. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={setTechLine.isPending}
                        onClick={() =>
                          setTechLine.mutate({ sid: n.sid, on: !n.technicianLine })
                        }
                        title={
                          n.technicianLine
                            ? "Stop using this as the technician line"
                            : "Make this the technician dial-in line"
                        }
                        aria-label={
                          n.technicianLine
                            ? "Clear technician line"
                            : "Make technician line"
                        }
                      >
                        <KeyRound
                          className={
                            n.technicianLine
                              ? "size-4 text-brand"
                              : "size-4 text-muted-foreground"
                          }
                        />
                      </Button>
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
