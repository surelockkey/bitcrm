import { ScanBarcode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@bitcrm/types";
import { isService, typeLabel } from "../lib";

/** Type pill (Product/Service) + a serial-tracking marker when set. */
export function ProductTypeBadge({ product }: { product: Product }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge
        variant={isService(product) ? "secondary" : "outline"}
        className={
          isService(product)
            ? "font-normal"
            : "border-brand/25 bg-brand/10 font-normal text-brand"
        }
      >
        {typeLabel(product.type)}
      </Badge>
      {product.serialTracking ? (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
        >
          <ScanBarcode className="size-3" />
          serial
        </Badge>
      ) : null}
    </span>
  );
}
