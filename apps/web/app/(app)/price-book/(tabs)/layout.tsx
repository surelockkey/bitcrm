import { WzExplainHeader } from "@/components/workiz/explain-header";
import { PriceBookFrame } from "@/features/price-book/components/price-book-frame";

/**
 * Workiz's Price book (`/root/service_and_products`): its explanation band
 * ("Price book" | what it is for), then its big tabs 24px under it — Items &
 * products, Item categories, Item brands — each its own route here. The page
 * scrolls as one, as Workiz's main container does, so a grid's header can
 * stick to the top. Items, categories and brands open as popups over their
 * tab. Workiz's help links, video card and "Price Book Pro" banner are its
 * own and are left out. The tab row comes with the tab's page, in its first
 * whole frame (`PriceBookFrame`).
 */
export default function PriceBookTabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="price-book-scroller" className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong">
      <WzExplainHeader title="Price book">
        Price book streamlines your estimating process by letting you organize and manage your business offerings and
        pricing
      </WzExplainHeader>
      <PriceBookFrame className="mt-6">{children}</PriceBookFrame>
    </div>
  );
}
