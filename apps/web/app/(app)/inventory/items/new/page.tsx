import { redirect } from "next/navigation";

/** New items are made from the Items tab's New item button; an old link lands on the list. */
export default function Page() {
  redirect("/inventory/items");
}
