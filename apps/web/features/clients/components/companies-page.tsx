"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Search } from "lucide-react";
import { ClientType } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCompanies } from "../hooks";
import { clientTypeLabel, searchCompanies } from "../lib";
import { CompaniesTable } from "./companies-table";
import { CompanyForm } from "./company-form";
import { EmptyState, NoAccess } from "./contacts-page";

const ALL = "all";

export function CompaniesPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);

  const companiesQuery = useCompanies();

  const filtered = useMemo(() => {
    const all = companiesQuery.data ?? [];
    const scoped = type === ALL ? all : all.filter((c) => c.clientType === type);
    return searchCompanies(scoped, search);
  }, [companiesQuery.data, type, search]);

  if (!can("companies", "view")) return <NoAccess entity="companies" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Commercial, government, and multi-site residential accounts.
          </p>
        </div>
        {can("companies", "create") ? (
          <Button variant="brand" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New company
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search companies"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {Object.values(ClientType).map((t) => (
              <SelectItem key={t} value={t}>{clientTypeLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "company" : "companies"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {companiesQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={search || type !== ALL ? "No matching companies" : "No companies yet"}
            hint={search || type !== ALL ? "Try a different search or filter." : "Create your first company to get started."}
          />
        ) : (
          <CompaniesTable companies={filtered} />
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New company</DialogTitle></DialogHeader>
          <CompanyForm
            onCancel={() => setCreating(false)}
            onDone={(c) => {
              setCreating(false);
              router.push(`/companies/${c.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
