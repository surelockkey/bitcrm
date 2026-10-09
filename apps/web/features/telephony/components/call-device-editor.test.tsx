import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallDevice } from "@bitcrm/types";
import { CallDeviceEditor } from "./call-device-editor";

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
}));

vi.mock("../call-devices-hooks", () => ({
  useCreateCallDevice: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCallDevice: () => ({ mutateAsync: mocks.update, isPending: false }),
}));

const device: CallDevice = {
  id: "d1",
  name: "SURE CT LOCKSMITH",
  number: "+12039893585",
  type: "shop_line",
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

/** The Devices tab's modal: a name and the number (or SIP address) the device rings on. */
describe("CallDeviceEditor", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.update.mockClear();
  });

  it("adds a device from its name and number, a desk phone unless said otherwise", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<CallDeviceEditor open onClose={onClose} />);

    await u.type(screen.getByLabelText("Device name"), "Front desk");
    await u.type(screen.getByLabelText("Phone number"), "2039893585");
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.create).toHaveBeenCalledWith({ name: "Front desk", number: "+12039893585", type: "desk_phone", active: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("takes a SIP address instead of a number", async () => {
    const u = userEvent.setup();
    render(<CallDeviceEditor open onClose={vi.fn()} />);
    await u.type(screen.getByLabelText("Device name"), "Shop SIP");
    await u.type(screen.getByLabelText("SIP address"), "shop@sip.example.com");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create).toHaveBeenCalledWith({ name: "Shop SIP", sipAddress: "shop@sip.example.com", type: "desk_phone", active: true });
  });

  it("won't save without a name or without anything to ring", async () => {
    const u = userEvent.setup();
    render(<CallDeviceEditor open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await u.type(screen.getByLabelText("Device name"), "Nothing");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await u.type(screen.getByLabelText("Phone number"), "2039893585");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("edits a device, sending what changed and clearing a number that was emptied", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<CallDeviceEditor device={device} open onClose={onClose} />);

    expect(screen.getByLabelText("Device name")).toHaveValue("SURE CT LOCKSMITH");
    await u.clear(screen.getByLabelText("Device name"));
    await u.type(screen.getByLabelText("Device name"), "CT shop line");
    await u.click(screen.getByRole("checkbox", { name: "Active" }));
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.update).toHaveBeenCalledWith({ name: "CT shop line", number: "+12039893585", sipAddress: null, type: "shop_line", active: false });
    expect(onClose).toHaveBeenCalled();
  });
});
