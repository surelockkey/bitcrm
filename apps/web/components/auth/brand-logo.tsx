import Image from "next/image";
import wordmark from "@/components/brand/wordmark.png";
import { cn } from "@/lib/utils";

/** The SHMORKIZ pill — the wordmark alone, since it already spells the name. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image
      src={wordmark}
      alt="Shmorkiz"
      width={142}
      height={44}
      priority
      className={cn("h-11 w-auto", className)}
    />
  );
}
