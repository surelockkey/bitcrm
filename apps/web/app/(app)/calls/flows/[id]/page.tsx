import { CallFlowBuilderPage } from "@/features/telephony/components/call-flow-builder-page";

/** Workiz's call flow builder (`/root/flowBuilder/<id>`): a page in the app, not under the Phone tabs. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CallFlowBuilderPage flowId={id} />;
}
