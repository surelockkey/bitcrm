import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxHref, useInboxNavigate } from "./inbox-url";

const replace = vi.fn();
const push = vi.fn();
let search = "view=unread";
vi.mock("next/navigation", () => ({
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push }),
}));

describe("inboxHref", () => {
  it("writes the open thread, keeping the category", () => {
    expect(inboxHref("/messages", "view=unread", { c: "b" })).toBe("/messages?view=unread&c=b");
  });

  it("drops what is cleared, and the default view", () => {
    expect(inboxHref("/messages", "c=a&view=unread", { c: undefined, view: "all" })).toBe("/messages");
    expect(inboxHref("/messages", "c=a", { kind: "team" })).toBe("/messages?c=a&kind=team");
  });
});

/**
 * Opening a thread is the browser's own business: the URL changes at once,
 * without a server round trip. Through the router, every click waited on the
 * server for /messages?c=…; while the dev server compiled the pages the open
 * thread links to, the next click sat in that queue and the thread never
 * changed — "I open one chat and then can't open another".
 */
describe("useInboxNavigate", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    search = "view=unread";
    replace.mockReset();
    push.mockReset();
    spy = vi.spyOn(window.history, "replaceState");
  });
  afterEach(() => spy.mockRestore());

  it("opens a thread in the address bar without asking the server", () => {
    const { result } = renderHook(() => useInboxNavigate());

    result.current({ c: "conv-2" });

    expect(spy).toHaveBeenCalledWith(null, "", "/messages?view=unread&c=conv-2");
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
