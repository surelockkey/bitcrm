import { InventoryTabs } from "@/features/inventory/components/inventory-tabs";

/**
 * Shared header for the inventory list screens: one "Inventory" title with
 * Workiz-style tabs. Detail pages ([id], new) live outside this group and
 * render without it.
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
