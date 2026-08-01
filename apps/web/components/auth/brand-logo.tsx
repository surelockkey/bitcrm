import Image from "next/image";
import icon from "@/app/icon.png";
import { cn } from "@/lib/utils";

/** BitCRM wordmark: blob logo + name. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image src={icon} alt="" width={44} height={44} className="size-11" />
      <span className="text-2xl font-bold tracking-tight">BitCRM</span>
    </div>
  );
}
