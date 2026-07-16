"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Info, RotateCcw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryStatus } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useProduct,
  useUpdateProduct,
  useArchiveProduct,
  useReactivateProduct,
} from "../hooks";
import { formatDate } from "@/features/users/lib";
import { formatMargin, formatMoney, isService } from "../lib";
import { ProductTypeBadge } from "./product-type-badge";
import { ProductForm, type ProductFormValues } from "./product-form";
import { ProductPhotoPanel } from "./product-photo-panel";
import { ProductStockTab } from "./product-stock-tab";

export function ProductEditorPage({ productId }: { productId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const query = useProduct(productId);
  const update = useUpdateProduct();
  const archive = useArchiveProduct();
  const reactivate = useReactivateProduct();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [tab, setTab] = useState("details");

  const canEdit = can("products", "edit");
  const canArchive = can("products", "delete");

  if (!can("products", "view")) {
    return <Center title="No access" body="You don't have permission to view products." />;
  }
  if (query.isLoading) return <EditorSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Center
        title="Product not found"
        body="It may have been deleted."
        action={
          <Button variant="outline" onClick={() => router.push("/inventory/products")}>
            Back to products
          </Button>
        }
      />
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
    minimumStockLevel: product.minimumStockLevel,
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => router.push("/inventory/products")}
        >
          <ArrowLeft className="size-4" />
          Products
        </Button>
        <h1 className="truncate text-lg font-semibold tracking-tight">{product.name}</h1>
        <ProductTypeBadge product={product} />
        <Badge
          variant="outline"
          className={cn("gap-1.5 font-normal", archived ? "text-muted-foreground" : "text-foreground")}
        >
          <span className={cn("size-1.5 rounded-full", archived ? "bg-muted-foreground/50" : "bg-green-500")} />
          {archived ? "Archived" : "Active"}
        </Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{product.sku}</span>
        {canEdit && archived ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={reactivate.isPending}
            onClick={() => reactivate.mutate(product.id)}
          >
            <RotateCcw className="size-3.5" />
            Restore
          </Button>
        ) : null}
        {canArchive && !archived ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Archive product"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmArchive(true)}
          >
            <Archive className="size-4" />
          </Button>
        ) : null}
      </div>

      {!canEdit ? (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-sm text-muted-foreground">
          <Info className="size-4" />
          You have view-only access to products.
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <div className="border-b px-6">
          <div className="mx-auto max-w-6xl">
            <TabsList variant="line" className="h-11">
              <TabsTrigger value="details" className="px-2">
                Details
              </TabsTrigger>
              <TabsTrigger value="stock" className="px-2">
                Stock
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-6">
            <TabsContent value="details" className="mt-0">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <ProductForm
                  key={product.updatedAt}
                  mode="edit"
                  defaults={defaults}
                  readOnly={!canEdit}
                  showCompanyCost={canEdit}
                  categories={[]}
                  submitting={update.isPending}
                  submitLabel="Save changes"
                  onCancel={() => router.push("/inventory/products")}
                  onSubmit={(values) => update.mutate({ id: product.id, body: values })}
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
                      {canEdit ? (
                        <Row label="Company cost" value={formatMoney(product.costCompany)} />
                      ) : null}
                      <Row label="Tech cost" value={formatMoney(product.costTech)} />
                      {canEdit ? (
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
                        <Row label="Min stock" value={String(product.minimumStockLevel)} />
                      ) : null}
                    </dl>
                    {!service ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => setTab("stock")}
                      >
                        View stock breakdown
                      </Button>
                    ) : null}
                  </RailCard>

                  <RailCard label="Record">
                    <dl className="space-y-1.5 text-sm">
                      <Row label="Created" value={formatDate(product.createdAt)} />
                      <Row label="Updated" value={formatDate(product.updatedAt)} />
                    </dl>
                  </RailCard>
                </aside>
              </div>
            </TabsContent>

            <TabsContent value="stock" className="mt-0">
              <ProductStockTab
                productId={product.id}
                minStockLevel={product.minimumStockLevel}
                serviceType={service}
              />
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{product.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stays in past deals but is hidden from pickers and new jobs. You
              can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => archive.mutate(product.id)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
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

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-medium tabular-nums",
          accent && "text-green-600 dark:text-green-500",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Center({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
