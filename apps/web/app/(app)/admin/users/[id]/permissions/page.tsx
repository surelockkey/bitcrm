import { UserPermissionsPage } from "@/features/users/components/user-permissions-page";

/** Full-page per-user permission overrides editor. `params` is a Promise in Next 16. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UserPermissionsPage userId={id} />;
}
