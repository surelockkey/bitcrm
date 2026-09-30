import type { PortalDocumentSummary } from "@bitcrm/types";
import { cx, statusMeta } from "./lib";

export function StatusBadge({ doc, className }: { doc: Pick<PortalDocumentSummary, "kind" | "status">; className?: string }) {
  const meta = statusMeta(doc);
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
