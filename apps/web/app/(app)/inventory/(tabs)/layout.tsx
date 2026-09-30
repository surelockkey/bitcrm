import { InventoryTabs } from "@/features/inventory/components/inventory-tabs";

/**
 * Shared header for the inventory list screens: one "Inventory" title with
 * Workiz-style tabs. Nothing in Inventory has a page of its own any more —
 * items, vans and warehouses open as popups over their tab; the old [id] and
 * new routes outside this group only redirect to those popups.
 */
export default function InventoryTabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 pt-4">
        <h1 className="text-lg font-semibold tracking-tight">Inventory</h1>
        <InventoryTabs className="-mb-px mt-3" />
      </div>
      {children}
    </div>
  );
}
