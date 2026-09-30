import { redirect } from "next/navigation";

/** New items are created in a popup on the Items tab now. */
export default function Page() {
  redirect("/inventory/items?new=1");
}
