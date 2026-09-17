import { redirect } from "next/navigation";

/** Automations moved out of settings; old bookmarks still land on the module. */
export default function Page() {
  redirect("/automations");
}
