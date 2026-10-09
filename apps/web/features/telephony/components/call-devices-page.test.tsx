import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallDevice } from "@bitcrm/types";
import { CallDevicesPage } from "./call-devices-page";

const mocks = vi.hoisted(() => ({
  devices: [] as CallDevice[],
  remove: vi.fn(),
  can: vi.fn((_resource: string, _action?: string) => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../call-devices-hooks", () => ({
  useCallDevices: () => ({ data: mocks.devices, isLoading: false }),
  useDeleteCallDevice: () => ({ mutate: mocks.remove, isPending: false }),
  useCreateCallDevice: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useUpdateCallDevice: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
}));

const device = (over: Partial<CallDevice> = {}): CallDevice => ({
  id: "d1",
  name: "SURE CT LOCKSMITH",
  number: "+12039893585",
  type: "shop_line",
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

/**
 * Workiz Phone → Devices (`/calls/devices`): the tab Workiz keeps for its desk
 * phones and shop lines. Its grid was never captured (the tab stayed on
 * "Loading"), so the page follows the Call groups tab's pattern: the words
 * and the big pill, the strip, the grid Name | Number | Type | Actions.
 */
describe("CallDevicesPage", () => {
  beforeEach(() => {
    mocks.devices = [];
    mocks.remove.mockClear();
    mocks.can.mockReturnValue(true);
  });

  it("draws the words, Add device and the columns", () => {
    mocks.devices = [device()];
    render(<CallDevicesPage />);
    expect(screen.getByText(/desk phones and shop lines/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add device" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Number", "Type", "Actions"]);
  });

  it("lists each device by name, the number it rings on and its kind; a paused one is tagged", () => {
    mocks.devices = [
      device(),
      device({ id: "d2", name: "Shop SIP", number: undefined, sipAddress: "shop@sip.example.com", type: "other", active: false }),
    ];
    render(<CallDevicesPage />);
    expect(screen.getByText("SURE CT LOCKSMITH")).toBeInTheDocument();
    expect(screen.getByText("(203) 989-3585")).toBeInTheDocument();
    expect(screen.getByText("Shop line")).toBeInTheDocument();
    expect(screen.getByText("shop@sip.example.com")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("says what to do when there are none", () => {
    render(<CallDevicesPage />);
    expect(screen.getByText("No devices added")).toBeInTheDocument();
  });

  it("opens the editor to add, and from a row's pencil to edit", async () => {
    const u = userEvent.setup();
    mocks.devices = [device()];
    render(<CallDevicesPage />);

    await u.click(screen.getByRole("button", { name: "Add device" }));
    expect(screen.getByRole("dialog", { name: "Add device" })).toBeInTheDocument();
    await u.keyboard("{Escape}");

    await u.click(screen.getByRole("button", { name: "Edit SURE CT LOCKSMITH" }));
    expect(screen.getByRole("dialog", { name: "Edit device" })).toBeInTheDocument();
    expect(screen.getByLabelText("Device name")).toHaveValue("SURE CT LOCKSMITH");
  });

  it("says what deleting does, then deletes", async () => {
    const u = userEvent.setup();
    mocks.devices = [device()];
    render(<CallDevicesPage />);

    await u.click(screen.getByRole("button", { name: "Delete SURE CT LOCKSMITH" }));
    expect(screen.getByText(/stop ringing it/i)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("d1");
  });

  it("hides every control from someone who can only view settings", () => {
    mocks.can.mockImplementation((_r: string, action?: string) => action !== "edit");
    mocks.devices = [device()];
    render(<CallDevicesPage />);
    expect(screen.getByText("SURE CT LOCKSMITH")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add device" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit SURE CT LOCKSMITH" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete SURE CT LOCKSMITH" })).not.toBeInTheDocument();
  });
});
