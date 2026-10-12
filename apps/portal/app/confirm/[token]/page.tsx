import type { Metadata } from "next";
import { ConfirmApp } from "@/components/confirm-app";

export const metadata: Metadata = { title: "Confirm your appointment" };

/**
 * `<portal>/confirm/<token>` — what a reminder's `{{confirm_link}}` opens
 * (B12). The token is the job's own signed link, not a portal token.
 * `params` is a Promise in Next 16.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConfirmApp token={token} />;
}
