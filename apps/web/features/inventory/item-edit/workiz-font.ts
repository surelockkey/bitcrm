import { Poppins } from "next/font/google";

/**
 * Workiz's typeface, for the item Edit popups only — they copy Workiz's look.
 * next/font self-hosts it and scopes it to the elements that take the class,
 * so the rest of BitCRM keeps its own font.
 */
export const workizFont = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
