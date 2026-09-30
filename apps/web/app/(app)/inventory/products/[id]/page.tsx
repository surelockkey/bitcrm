import { redirect } from "next/navigation";

/**
 * The search index linked a product hit to `/inventory/products/<id>`, a page
 * the web never had. No address opens a popup: it lands on the Items list.
 */
export default function Page() {
  redirect("/inventory/items");
}
