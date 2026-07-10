"use client";

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { TechnicianProfile, User } from "@bitcrm/types";
import { initials } from "@/features/users/lib";
import { formatMoney, techName, techUser } from "../lib";
import { TechnicianStatusBadge } from "./technician-status-badge";

export function TechniciansTable({
  technicians,
  userMap,
}: {
  technicians: TechnicianProfile[];
  userMap: Map<string, User>;
}) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Technician</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Labor</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {technicians.map((t) => {
            const u = techUser(t.userId, userMap);
            return (
              <TableRow
                key={t.userId}
                className="cursor-pointer"
                onClick={() => router.push(`/technicians/${t.userId}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {initials(u?.firstName, u?.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{techName(t.userId, userMap)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u?.email ?? t.userId}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{u?.department || "—"}</TableCell>
                <TableCell>
                  <TechnicianStatusBadge status={t.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {t.laborCostPerHour != null ? `${formatMoney(t.laborCostPerHour)}/hr` : "—"}
                </TableCell>
                <TableCell>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
