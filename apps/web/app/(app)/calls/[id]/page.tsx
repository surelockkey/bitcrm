import { CallDetailPage } from "@/features/calls/components/call-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CallDetailPage callId={id} />;
}
