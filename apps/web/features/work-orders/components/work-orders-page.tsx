"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { WorkOrderStatus, type WorkOrder } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useCompanies } from "@/features/clients/hooks";
import { formatDate } from "@/features/users/lib";
import { useWorkOrders, useCreateWorkOrder, useDeleteWorkOrder } from "../hooks";
import { workOrderStatusLabel, filterWorkOrders } from "../lib";
import { workOrderFormSchema, type WorkOrderFormValues } from "../schemas";

/**
 * Every column of the registry, in order, with the width it starts at.
 *
 * `table-fixed` on purpose: the client name comes from the companies request
 * and lands after the rows, and under auto layout the whole grid re-measures
 * when it does. Declared once — the colgroup and the headers are both built
 * from here. There is no page-size preference for this list, so its widths
 * are remembered under its own name, `work-orders`.
 */
const COLUMNS: { id: string; label: string; width: number; right?: boolean }[] = [
  { id: "woNumber", label: "WO #", width: 160 },
  { id: "client", label: "Client", width: 240 },
  { id: "date", label: "Date", width: 130 },
  { id: "amount", label: "Amount", width: 120 },
  { id: "status", label: "Status", width: 130 },
  { id: "job", label: "Job", width: 90 },
  { id: "actions", label: "Actions", width: 60, right: true },
];

const COLUMN_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width]),
);

export function WorkOrdersPage({ initialId }: { initialId?: string } = {}) {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [companyId, setCompanyId] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  // `?id=` (a job's Actions → View Work Order): that one alone, its number
  // standing in the search box until the reader types over it.
  const [pinnedId, setPinnedId] = useState<string | null>(initialId ?? null);
  const [creating, setCreating] = useState(false);

  const canCreate = can("work_orders", "create");
  const canDelete = can("work_orders", "delete");

  const workOrdersQuery = useWorkOrders();
  const companiesQuery = useCompanies();
  const workOrders = workOrdersQuery.data;
  const companies = companiesQuery.data;
  // The rows come up with their clients named (the companies are a request
  // of their own) and once the permissions have answered — until then a
  // refusal is not known, and neither is the delete button on every row.
  const ready = usePageReady(!permsLoading && settled(workOrdersQuery) && settled(companiesQuery));
  const del = useDeleteWorkOrder();
  // The reader's own widths for this list; the declarations only set the
  // start. Read before the no-access branch below — a hook has no branches.
  const { widthOf, setWidth, reset } = useColumnWidths("work-orders", COLUMN_WIDTHS);

  const companyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies ?? []) m.set(c.id, c.title);
    return m;
  }, [companies]);

  const rows = useMemo(
    () =>
      filterWorkOrders(workOrders ?? [], {
        id: pinnedId ?? undefined,
        companyId: companyId === "all" ? undefined : companyId,
        status: status === "all" ? undefined : (status as WorkOrderStatus),
        query: pinnedId ? undefined : query,
      }),
    [workOrders, pinnedId, companyId, status, query],
  );
  const searchText = pinnedId ? (workOrders?.find((w) => w.id === pinnedId)?.woNumber ?? "") : query;

  // A refusal only once the answer is in — before it, `can` says no to all.
  if (denied("work_orders", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view work orders.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Work Orders</h1>
        <Input
          className="h-9 w-48"
          placeholder="Search WO number…"
          value={searchText}
          onChange={(e) => {
            setPinnedId(null);
            setQuery(e.target.value);
          }}
        />
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Company" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {(companies ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.values(WorkOrderStatus).map((s) => (
              <SelectItem key={s} value={s}>{workOrderStatusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreate ? (
          <Button variant="brand" size="sm" className="ml-auto gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New work order
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {!ready ? (
          <Skeleton className="h-64 w-full" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
            <ClipboardCheck className="size-6" />
            <p className="text-sm">No work orders.</p>
          </div>
        ) : (
          <div className="overflow-hidden border">
            <Table className="table-fixed">
              <colgroup>
                {COLUMNS.map((c) => (
                  <col key={c.id} style={{ width: widthOf(c.id) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {COLUMNS.map((c) => (
                    <ResizableHead
                      key={c.id}
                      columnId={c.id}
                      label={c.label}
                      width={widthOf(c.id)}
                      onResize={(px) => setWidth(c.id, px)}
                      onReset={reset}
                      className={c.right ? "text-right" : undefined}
                    >
                      {/* The delete column is titled for the screen reader and
                          for the handle beside it, not on screen. */}
                      {c.id === "actions" ? <span className="sr-only">{c.label}</span> : c.label}
                    </ResizableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id}>
                    {/* Under `table-fixed` a cell that does not clip spills
                        over the next column instead of widening its own. */}
                    <TableCell className="truncate font-medium">{w.woNumber}</TableCell>
                    <TableCell className="truncate">{companyName.get(w.companyId) ?? "—"}</TableCell>
                    <TableCell className="truncate tabular-nums text-muted-foreground">{formatDate(w.date)}</TableCell>
                    <TableCell className="truncate tabular-nums">{w.amount != null ? `$${w.amount.toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="overflow-hidden"><StatusBadge status={w.status} /></TableCell>
                    <TableCell className="truncate">
                      {w.dealId ? (
                        <Link href={`/deals/${w.dealId}`} className="text-wz-link hover:underline">Open</Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="overflow-hidden text-right">
                      {canDelete ? (
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => del.mutate(w.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <CreateWorkOrderDialog open={creating} onOpenChange={setCreating} companies={companies ?? []} />
    </div>
  );
}

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return <Badge variant="outline" className="font-normal">{workOrderStatusLabel(status)}</Badge>;
}

function CreateWorkOrderDialog({
  open,
  onOpenChange,
  companies,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: { id: string; title: string }[];
}) {
  const create = useCreateWorkOrder();
  const form = useForm<WorkOrderFormValues>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: { woNumber: "", companyId: "", date: "", description: "" },
  });

  const selectedCompany = useWatch({ control: form.control, name: "companyId" });

  const submit = (v: WorkOrderFormValues) =>
    create.mutate(v, { onSuccess: () => { form.reset(); onOpenChange(false); } });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New work order</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>WO number</Label>
              <Input className="h-9" placeholder="WO-2026-11-005" {...form.register("woNumber")} />
              {form.formState.errors.woNumber ? <p className="text-xs text-destructive">{form.formState.errors.woNumber.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" className="h-9" {...form.register("date")} />
              {form.formState.errors.date ? <p className="text-xs text-destructive">{form.formState.errors.date.message}</p> : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Select value={selectedCompany} onValueChange={(v) => form.setValue("companyId", v, { shouldValidate: true })}>
              <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.companyId ? <p className="text-xs text-destructive">{form.formState.errors.companyId.message}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" min={0} className="h-9" {...form.register("amount", { valueAsNumber: true })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input className="h-9" {...form.register("description")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" className="gap-1.5" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
