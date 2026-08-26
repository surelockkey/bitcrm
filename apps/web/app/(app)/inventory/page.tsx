import { redirect } from "next/navigation";

/** The sidebar's single Inventory entry lands on the Items tab. */
export default function Page() {
  redirect("/inventory/items");
}
