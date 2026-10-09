import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallDevice, CallGroupWithMembers, RingNode } from "@bitcrm/types";
import type { TransferTarget } from "../api";
import { ForwardStepFields } from "./forward-step-fields";

/**
 * Workiz's "Forward Calls" pane (pg_settings_phone_wz_builder_forward): the
 * tabs Group | User | External Number (+ our Device), the number box with its
 * warning, "Move to next step after N sec", and Advanced.
 */
const groups = [
  { id: "g1", name: "Dispatch", members: [{}, {}] },
  { id: "g2", name: "On call", members: [] },
] as unknown as CallGroupWithMembers[];
const teammates: TransferTarget[] = [
  { id: "u-riley", name: "Riley CSR", email: "riley@surelockkey.com", softphoneOnline: true },
  { id: "u-dana", name: "Dana Petrenko", softphoneOnline: false },
];
const devices = [
  { id: "d-ct", name: "SURE CT LOCKSMITH", number: "+12039893585", type: "shop_line", active: true },
] as CallDevice[];

/** The pane is controlled by the editor; here a small state holder stands in for it. */
function Harness({ initial, onChange }: { initial: RingNode; onChange: (n: RingNode) => void }) {
  const [node, setNode] = useState(initial);
  return (
    <ForwardStepFields
      node={node}
      groups={groups}
      teammates={teammates}
      devices={devices}
      onChange={(n) => {
        setNode(n);
        onChange(n);
      }}
    />
  );
}

function setup(node: RingNode) {
  const onChange = vi.fn();
  const u = userEvent.setup();
  render(<Harness initial={node} onChange={onChange} />);
  const last = () => onChange.mock.calls.at(-1)![0] as RingNode;
  return { u, onChange, last };
}

describe("ForwardStepFields", () => {
  it("opens on the tab of the target it has — a legacy groupId counts as a group", () => {
    setup({ id: "r", type: "ring", groupId: "g1" });
    expect(screen.getByRole("tab", { name: "Group" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Call group" })).toHaveValue("g1");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Group", "User", "External Number", "Device"]);
  });

  it("forwards to an outside number, with Workiz's warning about what it costs", async () => {
    const { u, last } = setup({ id: "r", type: "ring", target: { kind: "group", id: "g1" }, timeoutSec: 300, whisper: true });
    await u.click(screen.getByRole("tab", { name: "External Number" }));
    // Switching tabs drops the group but keeps the step's own settings.
    expect(last()).toMatchObject({ target: { kind: "external", number: "" }, timeoutSec: 300, whisper: true });
    expect(last()).not.toHaveProperty("groupId");

    expect(screen.getByText(/We really don.t recommend this option/)).toBeInTheDocument();
    expect(screen.getByText("Calls to a phone that is off or out of service will NOT be marked as missed.")).toBeInTheDocument();
    expect(screen.getByText("Who answered the call is NOT tracked.")).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to take the risk?")).toBeInTheDocument();
  });

  it("takes the number as typed; the server stores it as E.164", async () => {
    const { u, last } = setup({ id: "r", type: "ring", target: { kind: "external", number: "" } });
    await u.type(screen.getByRole("textbox", { name: "External number" }), "8888996849");
    expect(last().target).toEqual({ kind: "external", number: "8888996849" });
  });

  it("forwards to one teammate", async () => {
    const { u, last } = setup({ id: "r", type: "ring", target: { kind: "group", id: "" } });
    await u.click(screen.getByRole("tab", { name: "User" }));
    await u.selectOptions(screen.getByRole("combobox", { name: "User" }), "u-riley");
    expect(last().target).toEqual({ kind: "user", id: "u-riley" });
    expect(screen.getByRole("option", { name: /Riley CSR/ })).toBeInTheDocument();
  });

  it("forwards to a device, listed with the number it rings on", async () => {
    const { u, last } = setup({ id: "r", type: "ring", target: { kind: "group", id: "" } });
    await u.click(screen.getByRole("tab", { name: "Device" }));
    await u.selectOptions(screen.getByRole("combobox", { name: "Device" }), "d-ct");
    expect(last().target).toEqual({ kind: "device", id: "d-ct" });
    expect(screen.getByRole("option", { name: /SURE CT LOCKSMITH .*203.*989.*3585/ })).toBeInTheDocument();
  });

  it("sets how long to ring before the next step, and forgets it when cleared", async () => {
    const { u, last } = setup({ id: "r", type: "ring", target: { kind: "group", id: "g1" } });
    const box = screen.getByRole("spinbutton", { name: "Move to next step after" });
    expect(box).toHaveAttribute("placeholder", "60");
    await u.type(box, "300");
    expect(last().timeoutSec).toBe(300);
    await u.clear(box);
    expect(last()).not.toHaveProperty("timeoutSec");
  });

  it("keeps the key-press gate under Advanced", async () => {
    const { u, last } = setup({ id: "r", type: "ring", target: { kind: "group", id: "g1" } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Advanced" }));
    await u.click(screen.getByRole("checkbox", { name: /press a key/i }));
    expect(last().whisper).toBe(true);
  });
});
