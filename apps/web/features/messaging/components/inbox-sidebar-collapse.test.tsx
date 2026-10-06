import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { InboxSidebarCollapse, isInboxRoute, isSidebarFoldedRoute } from "./inbox-sidebar-collapse";

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

describe("isSidebarFoldedRoute", () => {
  it("folds for the Inbox and for a client card, not for the clients list", () => {
    expect(isSidebarFoldedRoute("/messages/abc")).toBe(true);
    expect(isSidebarFoldedRoute("/contacts/dbbedc9b-92be-521f-b9fc-914dc7bd1c99")).toBe(true);
    expect(isSidebarFoldedRoute("/contacts")).toBe(false);
    expect(isSidebarFoldedRoute("/contacts/")).toBe(false);
    expect(isSidebarFoldedRoute("/companies/x")).toBe(false);
    expect(isSidebarFoldedRoute(null)).toBe(false);
  });

  it("folds across settings, whose own rail wants the room the nav takes", () => {
    expect(isSidebarFoldedRoute("/settings")).toBe(true);
    expect(isSidebarFoldedRoute("/settings/job-types")).toBe(true);
    expect(isSidebarFoldedRoute("/settings/documents/abc")).toBe(true);
    expect(isSidebarFoldedRoute("/settings-old")).toBe(false);
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

  it("keeps the sidebar folded from one settings section to the next, and unfolds it on the way out", () => {
    const at = (path: string) => {
      pathname = path;
      act(() => view.rerender(
        <SidebarProvider defaultOpen>
          <InboxSidebarCollapse />
          <OpenProbe />
        </SidebarProvider>,
      ));
      return view.getByTestId("open").textContent;
    };
    pathname = "/deals";
    const view = mount(true);
    expect(at("/settings")).toBe("false");
    expect(at("/settings/job-types")).toBe("false");
    expect(at("/deals")).toBe("true");
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
