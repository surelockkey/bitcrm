import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLinkedPopup, usePopup, type LegacyPopupQuery } from "./use-popup";

type Popup = { kind: "edit"; id: string } | { kind: "new" };

const LEGACY: LegacyPopupQuery<Popup> = {
  params: ["edit", "new"],
  parse: (q) => {
    const edit = q.get("edit");
    if (edit) return { kind: "edit", id: edit };
    return q.get("new") === "1" ? { kind: "new" } : null;
  },
};

const PATH = "/inventory/items";

function at(url: string) {
  window.history.replaceState(null, "", url);
}
const address = () => `${window.location.pathname}${window.location.search}`;

function renderPopup(initial?: Popup | null, legacy?: LegacyPopupQuery<Popup>) {
  return renderHook(() => usePopup(useLinkedPopup(initial, legacy), PATH));
}

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

  it("keeps whatever else the address holds", () => {
    at(`${PATH}?view=grid`);
    const { result } = renderPopup();
    act(() => result.current.open({ kind: "edit", id: "p1" }));
    act(() => result.current.close());
    expect(address()).toBe(`${PATH}?view=grid`);
  });
});

/** `/inventory/items/<id>`: the list, its popup open from the first frame. */
describe("usePopup — a link's own page", () => {
  it("opens the link's popup from the first frame", () => {
    at(`${PATH}/p9`);
    const { result } = renderPopup({ kind: "edit", id: "p9" });
    expect(result.current.popup).toEqual({ kind: "edit", id: "p9" });
    expect(address()).toBe(`${PATH}/p9`);
  });

  it("leaves the list's own address once that popup closes — a reload shows the list", () => {
    at(`${PATH}/p9`);
    const { result } = renderPopup({ kind: "edit", id: "p9" });
    act(() => result.current.close());
    expect(address()).toBe(PATH);
  });

  it("leaves it too when another popup takes that one's place", () => {
    at(`${PATH}/p9`);
    const { result } = renderPopup({ kind: "edit", id: "p9" });
    act(() => result.current.open({ kind: "edit", id: "p2" }));
    expect(address()).toBe(PATH);
    expect(result.current.popup).toEqual({ kind: "edit", id: "p2" });
  });
});

/** Before this, the popups lived in the query; links like that still open them. */
describe("useLinkedPopup — old ?edit= links", () => {
  it("opens the popup an old link names, then takes it out of the address", () => {
    at(`${PATH}?edit=p7`);
    const { result } = renderPopup(null, LEGACY);
    expect(result.current.popup).toEqual({ kind: "edit", id: "p7" });
    expect(address()).toBe(PATH);
  });

  it("takes out only the popup's params", () => {
    at(`${PATH}?new=1&view=grid`);
    const { result } = renderPopup(null, LEGACY);
    expect(result.current.popup).toEqual({ kind: "new" });
    expect(address()).toBe(`${PATH}?view=grid`);
  });

  it("prefers the page's own link to anything in the query", () => {
    at(`${PATH}/p9?edit=p7`);
    const { result } = renderPopup({ kind: "edit", id: "p9" }, LEGACY);
    expect(result.current.popup).toEqual({ kind: "edit", id: "p9" });
  });

  it("opens nothing without a popup param", () => {
    at(`${PATH}?view=grid`);
    const { result } = renderPopup(null, LEGACY);
    expect(result.current.popup).toBeNull();
    expect(address()).toBe(`${PATH}?view=grid`);
  });
});
