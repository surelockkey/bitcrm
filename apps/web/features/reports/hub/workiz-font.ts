import { Poppins } from "next/font/google";

/**
 * Workiz's typeface, for the Reports hub only — the hub copies Workiz's page.
 * next/font self-hosts it and scopes it to the element that takes the class,
 * so the rest of BitCRM keeps its own font.
 */
export const workizFont = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
