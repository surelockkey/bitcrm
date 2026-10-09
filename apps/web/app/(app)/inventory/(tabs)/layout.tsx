import { InventoryFrame } from "@/features/inventory/components/inventory-frame";

/**
 * Workiz's Inventory (`/root/inventory`): no title, the breadcrumb and then
 * its tab row — Inventory, User locations, Warehouses, Containers (Workiz's
 * Locations, split), Templates, Transfers — each tab its own route here, each
 * with its counter. The page scrolls as one, as Workiz's main container does,
 * so a grid's header can stick to the top. Items, vans and warehouses open as
 * popups over their tab; the old [id] and new routes outside this group only
 * redirect to their lists.
 */
export default function InventoryTabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="inventory-scroller" className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong">
      <InventoryFrame>{children}</InventoryFrame>
    </div>
  );
}
