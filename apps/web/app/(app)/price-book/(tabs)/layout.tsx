import { PriceBookTabs } from "@/features/price-book/components/price-book-tabs";

/**
 * The Price Book — Workiz "Services & Products": every item, stock-managed or
 * not, and the categories and brands they're filed under. One title, three
 * tabs; items, categories and brands open as popups over their tab.
 */
export default function PriceBookTabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 pt-4">
        <h1 className="text-lg font-semibold tracking-tight">Price Book</h1>
        <PriceBookTabs className="-mb-px mt-3" />
      </div>
      {children}
    </div>
  );
}
