import { redirect } from "next/navigation";

/**
 * A van has no page of its own, and no address opens a popup: an old link
 * (a bookmark, the search index) lands on the plain list of its tab.
 */
export default function Page() {
  redirect("/inventory/containers");
}
