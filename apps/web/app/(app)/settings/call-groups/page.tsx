import { redirect } from "next/navigation";

/** Workiz keeps Call groups in its Phone section (/root/ct_groups → /root/callsReport/groups); so do we. */
export default function Page() {
  redirect("/calls/groups");
}
