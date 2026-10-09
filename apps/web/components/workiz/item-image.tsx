"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Workiz's `emptyPlaceholder.svg` — what its price book draws for an item or
 * a category without a picture (pg_pricebook_wz_01_default,
 * _11_categories): a #ecedee square, a sun and a mountain in #9ea6aa at 70%.
 * Fills whatever box it is put in.
 */
export function WzItemImagePlaceholder({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 56" fill="none" aria-hidden="true" className={cn("block size-full", className)}>
      <rect width="56" height="56" fill="#ECEDEE" />
      <path
        d="M13.0061 19.1187C13.0061 20.4763 13.5454 21.7783 14.5053 22.7382C15.4653 23.6981 16.7673 24.2374 18.1248 24.2374C19.4824 24.2374 20.7844 23.6981 21.7443 22.7382C22.7043 21.7783 23.2435 20.4763 23.2435 19.1187C23.2435 17.7612 22.7043 16.4592 21.7443 15.4992C20.7844 14.5393 19.4824 14 18.1248 14C16.7673 14 15.4653 14.5393 14.5053 15.4992C13.5454 16.4592 13.0061 17.7612 13.0061 19.1187Z"
        fill="#9EA6AA"
        fillOpacity="0.7"
      />
      <path
        d="M34.4274 24.7219C34.2289 24.3414 33.9294 24.0229 33.5618 23.8013C33.1942 23.5798 32.7727 23.4638 32.3435 23.4661C31.9143 23.4759 31.4965 23.606 31.1377 23.8417C30.7789 24.0774 30.4936 24.4092 30.3142 24.7992L26.7698 32.6115C26.73 32.7002 26.668 32.7771 26.5899 32.8349C26.5118 32.8927 26.4201 32.9294 26.3237 32.9415C26.2272 32.9536 26.1293 32.9407 26.0393 32.904C25.9493 32.8674 25.8703 32.8082 25.8098 32.7321L23.9443 30.4025C23.7237 30.126 23.4417 29.9047 23.1206 29.7562C22.7996 29.6077 22.4483 29.5361 22.0947 29.5471C21.7418 29.5597 21.3965 29.6538 21.0859 29.8219C20.7753 29.99 20.5078 30.2277 20.3043 30.5163L13.2109 40.6468C13.0894 40.8174 13.0174 41.0181 13.0028 41.227C12.9881 41.4359 13.0314 41.6447 13.1279 41.8305C13.2243 42.0164 13.3702 42.172 13.5494 42.2802C13.7286 42.3885 13.9343 42.4452 14.1436 42.444H41.4435C41.6372 42.4439 41.8277 42.3944 41.9969 42.3C42.1661 42.2057 42.3084 42.0696 42.4103 41.9049C42.5121 41.7401 42.5701 41.552 42.5789 41.3585C42.5877 41.1651 42.5469 40.9725 42.4604 40.7992L34.4274 24.7219Z"
        fill="#9EA6AA"
        fillOpacity="0.7"
      />
    </svg>
  );
}

/**
 * A picture in a Workiz grid row (`itemImage-module` / the categories'
 * `imgWrapper`): 40×40, 8px corners, a #cad3d6 hairline, the picture cut to
 * fill it — or the placeholder when there is none, or it fails to load. The
 * size is fixed, so nothing moves when it arrives.
 */
export function WzItemImage({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = src && src !== failed ? src : null;
  return (
    <span className={cn("block size-10 flex-none overflow-hidden rounded-lg border border-wz-rule", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote picture at its own size, no optimiser
        <img
          src={url}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(url)}
        />
      ) : (
        <WzItemImagePlaceholder />
      )}
    </span>
  );
}
