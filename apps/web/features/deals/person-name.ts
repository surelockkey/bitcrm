/** Runs of whitespace read as one space, as the page would print them. */
const collapse = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/**
 * A person's name, or nothing — never their id.
 *
 * The directory arrives a moment after the rows do, and several screens filled
 * that moment by printing the raw uuid: unreadable, and it looks broken.
 * `useUserMap` already goes out of its way to avoid flashing ids at a manager;
 * anything that shows a person should hold the same line and simply wait.
 *
 * Someone imported from Workiz is named the way Workiz names them —
 * `workizName`, "(2) TX - Daniel Munoz", group and region prefix included —
 * since that is what Workiz prints on every tech chip, Team row and picker.
 * Anyone made here, or renamed here since, has none and reads as first + last.
 */
export function personName(
  user: { firstName?: string; lastName?: string; workizName?: string; email?: string } | undefined,
): string | undefined {
  if (!user) return undefined;
  const workiz = collapse(user.workizName);
  if (workiz) return workiz;
  const name = collapse(`${user.firstName ?? ""} ${user.lastName ?? ""}`);
  return name || user.email?.trim() || undefined;
}
