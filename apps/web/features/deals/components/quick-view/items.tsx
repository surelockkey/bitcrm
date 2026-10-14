"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { DealProduct } from "@bitcrm/types";
import { useDealProducts } from "../../hooks";
import { formatMoney } from "../../lib";
import { ItemsArt } from "../job-empty-art";

const lineTotal = (p: DealProduct) => Math.round((Number(p.quantity) || 0) * (Number(p.priceClient) || 0) * 100) / 100;

/**
 * Workiz's Items tab, view only (quickview_wz_tab_items,
 * quickview_wz_items_job_ANQ7B7_items): each line as its name, "2 x $45.00
 * each", the line's total and a TAXABLE chip, ruled apart; then the note that
 * items are added on the job page, and the link there. No lines: the art,
 * "No items", and the same link.
 */
export function ItemsTab({ dealId }: { dealId: string }) {
  const { data: lines, isPending } = useDealProducts(dealId);
  const href = `/deals/${dealId}?tab=items`;

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-[#768287]" />
      </div>
    );
  }
  if (!lines?.length) {
    return (
      <div className="flex flex-col items-center px-6 pt-[62px] text-center">
        <ItemsArt />
        <p className="mt-5 text-[14px] leading-[21px] font-semibold text-[#3b4b52]">No items</p>
        <p className="mt-2 text-[13px] leading-[19px] text-[#566d76]">You can add items from the job page only.</p>
        <Link href={href} className="mt-2 text-[14px] leading-4 font-medium text-[#3589e9] hover:underline">
          Add items from the job page
        </Link>
      </div>
    );
  }
  return (
    <div className="px-6 pt-6">
      <ul>
        {lines.map((p) => (
          <li key={p.lineId ?? p.productId} className="mb-3 border-b border-[#dfe2e3] pb-4">
            <p className="text-[14px] leading-5 font-semibold text-[#374151]">{p.name}</p>
            <p className="mt-1 text-[14px] leading-5 text-[#6b7280]">{`${p.quantity} x ${formatMoney(Number(p.priceClient) || 0)} each`}</p>
            <div className="mt-[6px] flex items-center gap-2">
              <span className="text-[16px] leading-4 font-semibold text-[#374151]">{formatMoney(lineTotal(p))}</span>
              {p.taxable !== false ? (
                <span className="rounded-chip bg-[#d574e4] px-3 py-1 text-[10px] leading-4 font-medium text-white uppercase">TAXABLE</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[14px] leading-[19px] text-[#6b7280]">This is view only. To add an item you will be redirected to the job page.</p>
      <Link href={href} className="mt-3 inline-block text-[14px] leading-4 font-medium text-[#3589e9] hover:underline">
        Go to Items page
      </Link>
    </div>
  );
}
