import { redirect } from "next/navigation";

/** Workiz keeps Phone numbers in its Phone section (/root/numbers → /root/callsReport/numbers); so do we. */
export default function Page() {
  redirect("/calls/numbers");
}
