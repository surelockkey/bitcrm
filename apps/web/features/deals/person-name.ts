/**
 * A person's name, or nothing — never their id.
 *
 * The directory arrives a moment after the rows do, and several screens filled
 * that moment by printing the raw uuid: unreadable, and it looks broken.
 * `useUserMap` already goes out of its way to avoid flashing ids at a manager;
 * anything that shows a person should hold the same line and simply wait.
 */
export function personName(
  user: { firstName?: string; lastName?: string; email?: string } | undefined,
): string | undefined {
  if (!user) return undefined;
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim().replace(/\s+/g, " ");
  return name || user.email?.trim() || undefined;
}
