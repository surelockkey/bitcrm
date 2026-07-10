import { Badge } from "@/components/ui/badge";
import { UserStatus } from "@bitcrm/types";
import { cn } from "@/lib/utils";

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const active = status === UserStatus.ACTIVE;
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-green-500" : "bg-muted-foreground/50",
        )}
      />
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}
