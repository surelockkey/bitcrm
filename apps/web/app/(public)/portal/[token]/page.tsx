import type { Metadata } from "next";
import { PublicPortalPage } from "@/features/portal/components/public-portal-page";

export const metadata: Metadata = {
  title: "Your documents",
  robots: { index: false, follow: false, nocache: true },
};

/** Public client portal. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicPortalPage token={token} />;
}
