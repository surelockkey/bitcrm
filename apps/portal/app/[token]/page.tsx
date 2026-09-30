import type { Metadata } from "next";
import { PortalApp } from "@/components/portal-app";

export const metadata: Metadata = { title: "Your documents" };

/** `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalApp token={token} />;
}
