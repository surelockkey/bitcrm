import { cn } from "@/lib/utils";

/**
 * Workiz's loader: three ink dots, 15 / 12 / 5px, bouncing (`.bounce1-3`,
 * pg_messages_wz_06b_search_empty) — while the next page comes.
 */
export function WzBounceDots({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={cn("inline-flex items-center gap-2", className)}>
      <span className="size-[15px] animate-pulse rounded-full bg-foreground" />
      <span className="size-3 animate-pulse rounded-full bg-foreground [animation-delay:160ms]" />
      <span className="size-[5px] animate-pulse rounded-full bg-foreground [animation-delay:320ms]" />
    </span>
  );
}
