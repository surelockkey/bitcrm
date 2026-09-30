import { DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/** The shape of one field in a form popup: a text box, a text area, a switch row or a panel. */
export type FieldShape = "input" | "area" | "switch" | "panel";

/**
 * A form popup's body while its record loads: the fields' shapes at their
 * heights, and the footer already in place. Without the footer the popup grew
 * when the form arrived — and, centred, moved both its edges.
 */
export function DialogLoadingBody({ testId, fields }: { testId: string; fields: FieldShape[] }) {
  return (
    <>
      <div data-testid={testId} aria-busy="true" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {fields.map((shape, i) =>
          shape === "switch" ? (
            <Skeleton key={i} className="h-[4.5rem] w-full rounded-lg" />
          ) : shape === "panel" ? (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ) : (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className={shape === "area" ? "h-[4.5rem] w-full" : "h-10 w-full"} />
            </div>
          ),
        )}
      </div>
      <FooterPlaceholder />
    </>
  );
}

/** The footer's place, held while the buttons it will hold are not known yet. */
export function FooterPlaceholder() {
  return (
    <DialogFooter data-testid="dialog-footer-placeholder" aria-hidden="true" className="m-0 flex-none">
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-8 w-20" />
    </DialogFooter>
  );
}
