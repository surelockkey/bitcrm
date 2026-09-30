import { redirect } from "next/navigation";

/** The sidebar's Price Book entry lands on the Items tab. */
export default function Page() {
  redirect("/price-book/items");
}
