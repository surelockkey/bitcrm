import { redirect } from "next/navigation";

/** The Payments report lives under Reports now, as Workiz's does; old links still land on it. */
export default function Page() {
  redirect("/reports/payments");
}
