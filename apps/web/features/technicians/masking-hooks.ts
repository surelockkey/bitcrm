"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUserPermissions,
  setUserPermissions,
} from "@/features/users/api";

/**
 * Turn client-number masking on or off for one user.
 *
 * Writes through `contacts.view_numbers` — the permission that actually
 * governs this — rather than the retired `callMaskingEnabled` profile flag,
 * which nothing ever read. One behaviour, one switch: two of them is how a
 * privacy setting ends up saying one thing and doing another.
 *
 * Merges rather than replaces, because `PUT /users/:id/permissions` stores the
 * whole override object and a user may hold others that have nothing to do
 * with masking.
 */
export function useSetClientNumberVisibility() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      hideNumbers,
    }: {
      userId: string;
      hideNumbers: boolean;
    }) => {
      const resolved = await getUserPermissions(userId).catch(() => null);
      const existing = resolved?.hasOverrides
        ? (resolved as unknown as { overrides?: { permissions?: Record<string, Record<string, boolean>> } })
            .overrides
        : undefined;

      return setUserPermissions(userId, {
        ...(existing ?? {}),
        permissions: {
          ...(existing?.permissions ?? {}),
          contacts: {
            ...(existing?.permissions?.contacts ?? {}),
            // Masking is the ABSENCE of the grant.
            view_numbers: !hideNumbers,
          },
        },
      });
    },
    onSuccess: (_data, { userId }) => {
      void qc.invalidateQueries({ queryKey: ["user-permissions", userId] });
      void qc.invalidateQueries({ queryKey: ["technician-profile", userId] });
    },
  });
}
