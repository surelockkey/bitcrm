"use client";

import { useState, type ReactNode } from "react";
import { Archive, Info, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FooterPlaceholder } from "@/features/inventory/components/dialog-loading";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useArchiveProduct,
  useBrands,
  useCreateProduct,
  useItemCategories,
  useProduct,
  useReactivateProduct,
  useUpdateProduct,
} from "../hooks";
import { formatMargin, formatMoney, isService } from "../lib";
import { ProductForm, type ProductFormValues } from "./product-form";
import { ProductPhotoPanel } from "./product-photo-panel";
import { ProductTypeBadge } from "./product-type-badge";

/** The footer's Save sits outside the form and submits it by this id. */
const FORM_ID = "product-dialog-form";

/**
 * The item's Edit / Create popup — Inventory has no item page any more.
 *
 * `productId` null is a new item. The page drives it from the URL
 * (`?edit=<id>`, `?new=1`), so a link to an item still opens it.
 */
export function ProductDialog({
  productId,
  open,
  onOpenChange,
  onCreated,
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: Product) => void;
}) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Header and footer stay put; the form scrolls between them, so the
          // popup fits a phone as well as a desktop. An item's popup is one
          // height loading and loaded: 442px growing to 968px moved both edges.
          "flex flex-col gap-0 overflow-hidden p-0",
          productId
            ? "h-[min(61rem,calc(100dvh-2rem))] sm:max-w-5xl"
            : "max-h-[calc(100dvh-2rem)] sm:max-w-2xl",
        )}
      >
        {productId ? (
          <EditItem id={productId} onClose={close} />
        ) : (
          <NewItem onClose={close} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Each catalog behind its own permission; without it the form falls back.
 * `pending` while a permitted catalog (or the permissions) is still loading:
 * the form then holds Category and Brand in place instead of reshaping.
 */
function useCatalogs() {
  const { can, isLoading } = usePermissions();
  const categories = useItemCategories(can("product_categories", "view"));
  const brands = useBrands(can("brands", "view"));
  return {
    categories: categories.data ?? [],
    brands: brands.data ?? [],
    pending: !!isLoading || !!categories.isLoading || !!brands.isLoading,
  };
}

function EditItem({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = usePermissions();
  const query = useProduct(id);
  const update = useUpdateProduct();
  const archive = useArchiveProduct();
  const reactivate = useReactivateProduct();
  const { categories, brands, pending: catalogsPending } = useCatalogs();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const canEdit = can("products", "edit");
  const canArchive = can("products", "delete");
  const money = can("financials", "view");

  if (query.isLoading) {
    return (
      <>
        <Header title={canEdit ? "Edit item" : "Item"} />
        <Body>
          <div
            data-testid="product-dialog-loading"
            className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
          >
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </Body>
        <FooterPlaceholder />
      </>
    );
  }
  if (query.isError || !query.data) {
    return (
      <>
        <Header title="Item not found" description="It may have been deleted." />
        <Footer>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </Footer>
      </>
    );
  }

  const product = query.data;
  const archived = product.status === InventoryStatus.ARCHIVED;
  const service = isService(product);

  const defaults: ProductFormValues = {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? "",
    description: product.description ?? "",
    category: product.category,
    type: product.type,
    costCompany: product.costCompany,
    costTech: product.costTech,
    priceClient: product.priceClient,
    supplier: product.supplier ?? "",
    serialTracking: product.serialTracking,
    taxable: product.taxable !== false,
    minimumStockLevel: product.minimumStockLevel,
    manageStock: product.manageStock !== false,
    brandId: product.brandId ?? "",
    // Blank when the item has none: 0 is a reorder point, and clearing the
    // field sends null.
    reorderLevel: product.reorderLevel ?? undefined,
  };

  return (
    <>
      <Header
        title={canEdit ? "Edit item" : "Item"}
        description={[product.number ? `#${product.number}` : null, product.sku]
          .filter(Boolean)
          .join(" · ")}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <ProductTypeBadge product={product} />
          <Badge
            variant="outline"
            className={cn("gap-1.5 font-normal", archived ? "text-muted-foreground" : "text-foreground")}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                archived ? "bg-muted-foreground/50" : "bg-green-500",
              )}
            />
            {archived ? "Archived" : "Active"}
          </Badge>
        </div>
      </Header>

      <Body>
        {!canEdit ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Info className="size-4" />
            You have view-only access to items.
          </div>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ProductForm
            key={product.updatedAt}
            formId={FORM_ID}
            mode="edit"
            defaults={defaults}
            readOnly={!canEdit}
            showCompanyCost={money}
            categories={categories}
            brands={brands}
            catalogsPending={catalogsPending}
            // Send only what changed: an imported item can carry a value the
            // create rules reject (a name over 120 chars, a negative price) and
            // the API validates only the fields in the body.
            onSubmit={(_values, changed) => {
              if (Object.keys(changed).length === 0) return onClose();
              update.mutate({ id: product.id, body: changed }, { onSuccess: onClose });
            }}
          />

          <aside className="space-y-4">
            {canEdit ? (
              <RailCard label="Photo">
                <ProductPhotoPanel product={product} />
              </RailCard>
            ) : null}

            <RailCard label="Pricing">
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(product.priceClient)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">client</span>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                {money ? <Row label="Company cost" value={formatMoney(product.costCompany)} /> : null}
                <Row label="Tech cost" value={formatMoney(product.costTech)} />
                <Row label="Taxable" value={product.taxable === false ? "No" : "Yes"} />
                {money ? (
                  <Row
                    label="Company margin"
                    value={formatMargin(product.priceClient, product.costCompany)}
                    accent
                  />
                ) : null}
                <Row
                  label="Tech margin"
                  value={formatMargin(product.priceClient, product.costTech)}
                  accent
                />
                {!service ? (
                  <>
                    <Row label="On hand" value={String(product.onHand ?? 0)} />
                    <Row label="Min stock" value={String(product.minimumStockLevel)} />
                  </>
                ) : null}
              </dl>
            </RailCard>
          </aside>
        </div>
      </Body>

      <Footer>
        <div className="flex gap-2 sm:mr-auto">
          {canArchive && !archived ? (
            <Button
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setConfirmArchive(true)}
            >
              <Archive className="size-4" />
              Archive
            </Button>
          ) : null}
          {canEdit && archived ? (
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={reactivate.isPending}
              onClick={() => reactivate.mutate(product.id)}
            >
              <RotateCcw className="size-4" />
              Restore
            </Button>
          ) : null}
        </div>
        {canEdit ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={update.isPending} className="gap-1.5">
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </Footer>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{product.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stays in past jobs but is hidden from pickers and new jobs. You
              can restore it later from the Archived filter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => archive.mutate(product.id, { onSuccess: onClose })}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NewItem({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const { can, isLoading } = usePermissions();
  const create = useCreateProduct();
  const { categories, brands, pending: catalogsPending } = useCatalogs();
  // Until the permissions answer, the whole form stands in place, disabled: a
  // "no permission" stub that the answer then swapped for the form grew the
  // popup from 131px to 968px.
  const pending = !!isLoading;

  if (!pending && !can("products", "create")) {
    return (
      <>
        <Header title="New item" description="You don't have permission to create items." />
        <Footer>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </Footer>
      </>
    );
  }

  return (
    <>
      <Header title="New item" />
      <Body>
        <ProductForm
          formId={FORM_ID}
          mode="create"
          readOnly={pending}
          // Held while pending: the office opens this, and a field that
          // arrived with the answer reflowed the pricing row.
          showCompanyCost={pending || can("financials", "view")}
          categories={categories}
          brands={brands}
          catalogsPending={catalogsPending}
          onSubmit={(values) => create.mutate(values, { onSuccess: onCreated })}
        />
      </Body>
      <Footer>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID} disabled={pending || create.isPending} className="gap-1.5">
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Create item
        </Button>
      </Footer>
    </>
  );
}

function Header({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    // Right padding keeps the title clear of the close button.
    <DialogHeader className="border-b px-4 py-3 pr-12">
      <DialogTitle className="text-base">{title}</DialogTitle>
      {description ? (
        <DialogDescription className="font-mono text-xs">{description}</DialogDescription>
      ) : null}
      {children}
    </DialogHeader>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>;
}

function Footer({ children }: { children: ReactNode }) {
  return <DialogFooter className="m-0 flex-none">{children}</DialogFooter>;
}

function RailCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium tabular-nums", accent && "text-green-600 dark:text-green-500")}>
        {value}
      </dd>
    </div>
  );
}
