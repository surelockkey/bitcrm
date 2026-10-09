import { redirect } from "next/navigation";

/** Workiz keeps its text settings in its Phone section (/root/sms_settings → /root/callsReport/texting); so do we. */
export default function Page() {
  redirect("/calls/texting");
}
