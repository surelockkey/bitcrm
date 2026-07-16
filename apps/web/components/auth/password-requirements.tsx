"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { passwordChecks } from "@/features/auth/schemas";

const RULES = [
  { key: "length", label: "At least 8 characters" },
  { key: "uppercase", label: "One uppercase letter" },
  { key: "number", label: "One number" },
] as const;

/** Live password-policy checklist with green checks. */
export function PasswordRequirements({ password }: { password: string }) {
  const checks = passwordChecks(password);
  return (
    <ul className="space-y-1.5" aria-label="Password requirements">
      {RULES.map((rule) => {
        const ok = checks[rule.key];
        return (
          <li key={rule.key} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full transition-colors",
                ok
                  ? "bg-green-600 text-white"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span className={ok ? "text-foreground" : "text-muted-foreground"}>
              {rule.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
