import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The softphone is its own switch, `calls.phone` (Roles → Calls → Use Phone):
 * a role without it — the owner's Logistics — has no phone in the header and
 * never connects one, even if the phone was left switched on in this browser.
 */
const mocks = vi.hoisted(() => ({
  canPhone: true,
  phoneOn: true,
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    isLoading: false,
    can: (resource: string, action?: string) => (resource === "calls" && action === "phone" ? mocks.canPhone : true),
  }),
}));
vi.mock("../softphone-store", () => ({
  useSoftphoneStore: (sel: (s: unknown) => unknown) =>
    sel({ status: "offline", phoneOn: mocks.phoneOn, setDialerOpen: vi.fn() }),
}));
vi.mock("../softphone-manager", () => ({ enableSoftphone: mocks.enable, disableSoftphone: mocks.disable }));
vi.mock("../use-call-tab-title", () => ({ useCallTabTitle: () => {} }));
vi.mock("./softphone-widget", () => ({ SoftphoneWidget: () => <div data-testid="softphone-widget" /> }));

import { SoftphoneControls } from "./softphone-controls";
import { SoftphoneProvider } from "./softphone-provider";

beforeEach(() => {
  mocks.canPhone = true;
  mocks.phoneOn = true;
  mocks.enable.mockClear();
  mocks.disable.mockClear();
});

describe("the header phone", () => {
  it("is there with calls.phone", () => {
    render(<TooltipProvider><SoftphoneControls /></TooltipProvider>);
    expect(screen.getByRole("button", { name: "Open phone" })).toBeInTheDocument();
  });

  it("is not there without it", () => {
    mocks.canPhone = false;
    render(<TooltipProvider><SoftphoneControls /></TooltipProvider>);
    expect(screen.queryByRole("button", { name: "Open phone" })).toBeNull();
  });
});

describe("the softphone itself", () => {
  it("connects when the phone is on and the role has calls.phone", () => {
    render(<SoftphoneProvider />);
    expect(mocks.enable).toHaveBeenCalled();
    expect(screen.getByTestId("softphone-widget")).toBeInTheDocument();
  });

  it("never connects without calls.phone — a phone left on in this browser is switched off — and draws no dialer", () => {
    mocks.canPhone = false;
    render(<SoftphoneProvider />);
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(mocks.disable).toHaveBeenCalled();
    expect(screen.queryByTestId("softphone-widget")).toBeNull();
  });
});
