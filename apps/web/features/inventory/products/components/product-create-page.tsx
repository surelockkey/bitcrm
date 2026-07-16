"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCreateProduct } from "../hooks";
import { ProductForm } from "./product-form";

export function ProductCreatePage() {
  const router = useRouter();
  const { can } = usePermissions();
  const create = useCreateProduct();

  if (!can("products", "create")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to create products.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
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
        <h1 className="text-lg font-semibold tracking-tight">New product</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <ProductForm
            mode="create"
            showCompanyCost
            categories={[]}
            submitting={create.isPending}
            submitLabel="Create product"
            onCancel={() => router.push("/inventory/products")}
            onSubmit={(values) =>
              create.mutate(values, {
                onSuccess: (p) => router.push(`/inventory/products/${p.id}`),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
