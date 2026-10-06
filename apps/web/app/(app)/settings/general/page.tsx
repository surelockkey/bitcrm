import { redirect } from "next/navigation";

/** General is the settings screen itself now; old links to the empty page land there. */
export default function Page() {
  redirect("/settings");
}
