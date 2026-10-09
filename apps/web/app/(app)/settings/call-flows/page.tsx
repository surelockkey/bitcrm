import { redirect } from "next/navigation";

/** Workiz keeps Call flows in its Phone section (/root/flows → /root/callsReport/flows); so do we. */
export default function Page() {
  redirect("/calls/flows");
}
