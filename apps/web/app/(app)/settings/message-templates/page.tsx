import { redirect } from "next/navigation";

/**
 * Message templates are Workiz's "Text templates", on the Text Messages page
 * (/root/sms_settings → /root/callsReport/texting); ours live there too.
 */
export default function Page() {
  redirect("/calls/texting");
}
