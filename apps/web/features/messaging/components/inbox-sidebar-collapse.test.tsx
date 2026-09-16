import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { InboxSidebarCollapse, isInboxRoute } from "./inbox-sidebar-collapse";

let pathname = "/deals";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function OpenProbe() {
  const { open } = useSidebar();
  return <span data-testid="open">{String(open)}</span>;
}

function mount(defaultOpen = true) {
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      <InboxSidebarCollapse />
      <OpenProbe />
    </SidebarProvider>,
  );
}

describe("isInboxRoute", () => {
  it("matches the Inbox and its threads only", () => {
    expect(isInboxRoute("/messages")).toBe(true);
    expect(isInboxRoute("/messages/abc")).toBe(true);
    expect(isInboxRoute("/messages-archive")).toBe(false);
    expect(isInboxRoute("/deals")).toBe(false);
    expect(isInboxRoute(null)).toBe(false);
  });
});

describe("InboxSidebarCollapse", () => {
  it("folds the sidebar on the Inbox and unfolds it when leaving", () => {
    pathname = "/deals";
    const view = mount(true);
    expect(view.getByTestId("open").textContent).toBe("true");

    pathname = "/messages";
    act(() => view.rerender(
      <SidebarProvider defaultOpen>
        <InboxSidebarCollapse />
        <OpenProbe />
      </SidebarProvider>,
    ));
    expect(view.getByTestId("open").textContent).toBe("false");

    pathname = "/contacts";
    act(() => view.rerender(
      <SidebarProvider defaultOpen>
        <InboxSidebarCollapse />
        <OpenProbe />
      </SidebarProvider>,
    ));
    expect(view.getByTestId("open").textContent).toBe("true");
  });

  it("leaves a sidebar the user had already collapsed alone", () => {
    pathname = "/messages";
    const view = mount(false);
    expect(view.getByTestId("open").textContent).toBe("false");

    pathname = "/deals";
    act(() => view.rerender(
      <SidebarProvider defaultOpen={false}>
        <InboxSidebarCollapse />
        <OpenProbe />
      </SidebarProvider>,
    ));
    // Not folded by us → not unfolded by us either.
    expect(view.getByTestId("open").textContent).toBe("false");
  });
});
