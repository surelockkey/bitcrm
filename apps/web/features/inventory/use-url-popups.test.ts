import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * A browser history in miniature: the entries, where we stand, and the
 * router calls acting on it the way the App Router's do (push/replace are
 * pushState/replaceState, back is history.back).
 */
const nav = vi.hoisted(() => {
  const state = { entries: [] as string[], at: -1 };
  const current = () => state.entries[state.at];
  return {
    state,
    current,
    reset(...entries: string[]) {
      state.entries = entries;
      state.at = entries.length - 1;
    },
    router: {
      push: (href: string) => {
        state.entries = [...state.entries.slice(0, state.at + 1), href];
        state.at += 1;
      },
      replace: (href: string) => {
        state.entries[state.at] = href;
      },
      back: () => {
        state.at = Math.max(0, state.at - 1);
      },
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.current().split("?")[1] ?? ""),
}));

import { useUrlPopups } from "./use-url-popups";

const PATH = "/inventory/items";
const POPUPS = ["edit", "stock", "new"] as const;

function renderPopups() {
  const hook = renderHook(() => useUrlPopups(PATH, POPUPS));
  // Each call is followed by a render, as a navigation would cause.
  const run = (fn: (p: ReturnType<typeof useUrlPopups<(typeof POPUPS)[number]>>) => void) =>
    act(() => {
      fn(hook.result.current);
      hook.rerender();
    });
  return { ...hook, run };
}

beforeEach(() => nav.reset("/dashboard", PATH));

describe("useUrlPopups — history", () => {
  it("opening a popup is one Back away from the list", () => {
    const { result, run } = renderPopups();
    run((p) => p.open("stock", "p1"));
    expect(nav.current()).toBe(`${PATH}?stock=p1`);
    expect(result.current.param("stock")).toBe("p1");
    expect(nav.state.entries).toEqual(["/dashboard", PATH, `${PATH}?stock=p1`]);
  });

  // Replacing the pushed entry would leave the list twice in a row, and the
  // next Back would land on the same page — a press that does nothing.
  it("closing a popup it opened steps back, so Back then leaves the page", () => {
    const { run } = renderPopups();
    run((p) => p.open("stock", "p1"));
    run((p) => p.close());
    expect(nav.current()).toBe(PATH);
    expect(nav.state.entries.slice(0, nav.state.at + 1)).toEqual(["/dashboard", PATH]);

    // Five items opened and closed — still one Back to leave.
    for (const id of ["p2", "p3", "p4", "p5", "p6"]) {
      run((p) => p.open("edit", id));
      run((p) => p.close());
    }
    expect(nav.state.entries.slice(0, nav.state.at + 1)).toEqual(["/dashboard", PATH]);
  });

  it("closing a popup that arrived in the URL replaces it — there is no list entry to go back to", () => {
    nav.reset("/dashboard", `${PATH}?edit=p9`);
    const { run } = renderPopups();
    run((p) => p.close());
    expect(nav.state.entries).toEqual(["/dashboard", PATH]);
    expect(nav.state.at).toBe(1);
  });

  it("a popup swapped for another (a new item turning into its edit) still closes back to the list", () => {
    const { run } = renderPopups();
    run((p) => p.open("new"));
    run((p) => p.replace("edit", "p7"));
    expect(nav.current()).toBe(`${PATH}?edit=p7`);
    run((p) => p.close());
    expect(nav.state.entries.slice(0, nav.state.at + 1)).toEqual(["/dashboard", PATH]);
  });

  it("keeps the rest of the query when opening and closing", () => {
    nav.reset("/dashboard", `${PATH}?tab=x`);
    const { run } = renderPopups();
    run((p) => p.open("stock", "p1"));
    expect(nav.current()).toBe(`${PATH}?tab=x&stock=p1`);
    run((p) => p.close());
    expect(nav.current()).toBe(`${PATH}?tab=x`);

    nav.reset("/dashboard", `${PATH}?tab=x&edit=p9`);
    run((p) => p.close());
    expect(nav.current()).toBe(`${PATH}?tab=x`);
  });
});

/**
 * A popup may need more than one value — Apply names a template and a van
 * (`?apply=<templateId>&container=<id>`). Its extra params come and go with it.
 */
describe("useUrlPopups — a popup with extra params", () => {
  function renderWithExtras() {
    const hook = renderHook(() => useUrlPopups(PATH, ["apply", "template"] as const, ["container"] as const));
    const run = (fn: (p: typeof hook.result.current) => void) =>
      act(() => {
        fn(hook.result.current);
        hook.rerender();
      });
    return { ...hook, run };
  }

  it("opens with its extras and reads them back", () => {
    const { result, run } = renderWithExtras();
    run((p) => p.open("apply", "t1", { container: "c1" }));
    expect(nav.current()).toBe(`${PATH}?apply=t1&container=c1`);
    expect(result.current.param("apply")).toBe("t1");
    expect(result.current.param("container")).toBe("c1");
  });

  it("drops the extras when another popup replaces it, and on close", () => {
    const { run } = renderWithExtras();
    run((p) => p.open("apply", "t1", { container: "c1" }));
    run((p) => p.replace("template", "t1"));
    expect(nav.current()).toBe(`${PATH}?template=t1`);
    run((p) => p.close());
    expect(nav.current()).toBe(PATH);

    nav.reset("/dashboard", `${PATH}?tab=x&apply=t1&container=c1`);
    const arrived = renderWithExtras();
    arrived.run((p) => p.close());
    expect(nav.current()).toBe(`${PATH}?tab=x`);
  });

  it("changes an extra in place without a new history entry", () => {
    const { run } = renderWithExtras();
    run((p) => p.open("apply", "t1", { container: "c1" }));
    const depth = nav.state.at;
    run((p) => p.replace("apply", "t1", { container: "c2" }));
    expect(nav.current()).toBe(`${PATH}?apply=t1&container=c2`);
    expect(nav.state.at).toBe(depth);
    run((p) => p.close());
    expect(nav.state.entries.slice(0, nav.state.at + 1)).toEqual(["/dashboard", PATH]);
  });
});
