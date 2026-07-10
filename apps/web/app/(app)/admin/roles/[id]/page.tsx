import { RoleEditorPage } from "@/features/roles/components/role-editor-page";

/** Full-page role editor. `params` is a Promise in Next 16. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleEditorPage roleId={id} />;
}
