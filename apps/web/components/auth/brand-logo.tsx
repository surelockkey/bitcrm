import Image from "next/image";
import wordmark from "@/components/brand/wordmark.png";
import { cn } from "@/lib/utils";

/**
 * The SHMORKIZ pill — the wordmark alone, since it already spells the name.
 * Drawn at exactly the 142×44 it is declared at (`w-auto` measured 141.6,
 * which next/image reports as a width changed without its height).
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image
      src={wordmark}
      alt="Shmorkiz"
      width={142}
      height={44}
      priority
      className={cn("h-11 w-[142px] object-contain", className)}
    />
  );
}
