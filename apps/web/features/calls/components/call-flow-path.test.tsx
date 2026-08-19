import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CallFlowPath } from "./call-flow-path";

const at = (m: number) => `2026-08-19T10:0${m}:00.000Z`;

describe("CallFlowPath", () => {
  it("shows nothing for a call that never went through a flow", () => {
    const { container } = render(<CallFlowPath />);
    expect(container).toBeEmptyDOMElement();
  });

  it("retraces the route the caller took, in order", () => {
    render(
      <CallFlowPath
        flowName="Main line"
        path={[
          { nodeId: "hello", type: "say", at: at(0), detail: "Thanks for calling." },
          { nodeId: "m", type: "menu", at: at(1), detail: "Pressed 2 · Existing job" },
          { nodeId: "r", type: "ring", at: at(2), detail: "Rang Dispatch — 2 phones" },
        ]}
      />,
    );

    expect(screen.getByText(/Main line/)).toBeInTheDocument();
    expect(screen.getByText("Heard a message")).toBeInTheDocument();
    expect(screen.getByText("Pressed 2 · Existing job")).toBeInTheDocument();
    expect(screen.getByText("Rang Dispatch — 2 phones")).toBeInTheDocument();
  });

  it("says why a missed call was missed — the point of keeping this", () => {
    render(
      <CallFlowPath
        flowName="After hours"
        path={[
          { nodeId: "h", type: "hours", at: at(0), detail: "Closed" },
          { nodeId: "r", type: "ring", at: at(1), detail: "On call — nobody reachable" },
          { nodeId: "vm", type: "voicemail", at: at(2), detail: "Took a message" },
        ]}
      />,
    );

    // Without this a missed call says only that it was missed.
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("On call — nobody reachable")).toBeInTheDocument();
  });
});
