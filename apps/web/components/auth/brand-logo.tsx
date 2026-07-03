import { cn } from "@/lib/utils";

/** BitCRM wordmark: black rounded square "B" + name. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-11 items-center justify-center rounded-xl bg-foreground">
        <span className="text-xl font-bold text-background">B</span>
      </div>
      <span className="text-2xl font-bold tracking-tight">BitCRM</span>
    </div>
  );
}
