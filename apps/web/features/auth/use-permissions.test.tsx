import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePermissions, useDenied } from "./use-permissions";

const me = vi.fn<() => { data?: unknown; isLoading: boolean }>();
vi.mock("./use-me", () => ({ useMe: () => me() }));

// A real seeded role, resolved the way the app resolves it (by `roleId`).
// A technician holds `deals.view` and not `users.view` — the latter is why
// the names-by-ids endpoint exists at all.
const technician = { id: "u-1", roleId: "role-technician" };

/**
 * `denied()` — чи відмовляти екран.
 *
 * `can()` поки права їдуть відповідає `false` на все, бо матриці ще немає.
 * Сторінки писали `if (!can(...)) return <NoAccess/>` — і на кожному оновленні
 * блимало «немає доступу», перш ніж екран сам себе виправляв. Відмова має
 * лунати лише тоді, коли відповідь справді відома.
 */
describe("useDenied", () => {
  it("does not refuse while the permissions are still resolving", () => {
    me.mockReturnValue({ data: undefined, isLoading: true });
    const { result } = renderHook(() => ({ denied: useDenied(), ...usePermissions() }));

    expect(result.current.denied("deals", "view")).toBe(false);
    // `can` still says no — that is the trap this exists to avoid.
    expect(result.current.can("deals", "view")).toBe(false);
  });

  it("refuses once the answer is in and it is no", () => {
    me.mockReturnValue({ data: technician, isLoading: false });
    const { result } = renderHook(() => ({ denied: useDenied() }));

    expect(result.current.denied("users", "view")).toBe(true);
  });

  it("allows once the answer is in and it is yes", () => {
    me.mockReturnValue({ data: technician, isLoading: false });
    const { result } = renderHook(() => ({ denied: useDenied() }));

    expect(result.current.denied("deals", "view")).toBe(false);
  });

  // Права завантажились, але користувача немає — це вже справжня відмова.
  it("refuses when loading finished with nobody signed in", () => {
    me.mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => ({ denied: useDenied() }));

    expect(result.current.denied("deals", "view")).toBe(true);
  });

  it("defaults to the view action, as `can` does", () => {
    me.mockReturnValue({ data: technician, isLoading: false });
    const { result } = renderHook(() => ({ denied: useDenied() }));

    expect(result.current.denied("deals")).toBe(false);
    expect(result.current.denied("users")).toBe(true);
  });
});
