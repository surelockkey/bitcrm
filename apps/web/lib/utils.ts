import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge, told about this app's own corner tokens (globals.css
 * `--radius-pill` / `--radius-chip`), so `cn("rounded-pill", "rounded-[8px]")`
 * keeps only the later corner the way it does for the stock radii.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["pill", "chip"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
