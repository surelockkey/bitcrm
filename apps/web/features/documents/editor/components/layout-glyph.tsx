import { cn } from "@/lib/utils";

/** A tiny picture of a row's column split (e.g. 4/8). */
export function LayoutGlyph({ spans, className }: { spans: number[]; className?: string }) {
  return (
    <span className={cn("grid h-4 gap-0.5", className)} style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }} aria-hidden>
      {spans.map((s, i) => (
        <span key={i} className="rounded-[2px] bg-current opacity-60" style={{ gridColumn: `span ${s}` }} />
      ))}
    </span>
  );
}
