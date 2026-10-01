import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePopup } from "./use-popup";

type Popup = { kind: "edit"; id: string } | { kind: "new" };

const PATH = "/inventory/items";
const STALE = ["edit", "new"] as const;

const at = (url: string) => window.history.replaceState(null, "", url);
const address = () => `${window.location.pathname}${window.location.search}`;
const renderPopup = () => renderHook(() => usePopup<Popup>(STALE));

beforeEach(() => at(PATH));

/** The owner's rule: a popup is the page's state — opening one never touches the address. */
describe("usePopup — state, not the URL", () => {
  it("opens and closes without changing the address or the history", () => {
    const length = window.history.length;
    const { result } = renderPopup();
    expect(result.current.popup).toBeNull();

    act(() => result.current.open({ kind: "edit", id: "p1" }));
    expect(result.current.popup).toEqual({ kind: "edit", id: "p1" });
    expect(address()).toBe(PATH);

    act(() => result.current.close());
    expect(result.current.popup).toBeNull();
    expect(address()).toBe(PATH);
    expect(window.history.length).toBe(length);
  });

  it("keeps one popup at a time — opening another replaces it", () => {
    const { result } = renderPopup();
    act(() => result.current.open({ kind: "edit", id: "p1" }));
    act(() => result.current.open({ kind: "new" }));
    expect(result.current.popup).toEqual({ kind: "new" });
  });
});

/** No deep links: an old link with a popup in its query lands on the plain list. */
describe("usePopup — old ?edit= links", () => {
  it("opens nothing from an old ?edit= link, and takes the param out of the address", () => {
    at(`${PATH}?edit=p7`);
    const { result } = renderPopup();
    expect(result.current.popup).toBeNull();
    expect(address()).toBe(PATH);
  });

  it("takes out only the old popup params", () => {
    at(`${PATH}?new=1&view=grid`);
    const { result } = renderPopup();
    expect(result.current.popup).toBeNull();
    expect(address()).toBe(`${PATH}?view=grid`);
  });

  it("leaves an address without them alone", () => {
    at(`${PATH}?view=grid`);
    renderPopup();
    expect(address()).toBe(`${PATH}?view=grid`);
  });
});
