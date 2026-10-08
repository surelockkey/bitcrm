import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzActionBar, WzCard, WzSectionHeader } from "./layout";
import { WzUploadField } from "./upload";

describe("WzCard", () => {
  it("is a titled region", () => {
    render(
      <WzCard title="Client Details">
        <p>fields</p>
      </WzCard>,
    );
    const region = screen.getByRole("region", { name: "Client Details" });
    expect(region).toHaveTextContent("fields");
    expect(screen.getByRole("heading", { name: "Client Details" }).tagName).toBe("H5");
  });

  it("puts an action at the right of the title (the Scheduled toggle)", () => {
    render(
      <WzCard title="Scheduled" action={<button type="button">toggle</button>}>
        x
      </WzCard>,
    );
    const heading = screen.getByRole("heading", { name: "Scheduled" });
    expect(heading.parentElement).toContainElement(screen.getByRole("button", { name: "toggle" }));
  });
});

describe("WzSectionHeader", () => {
  it("is an h4 with the rule under it", () => {
    render(<WzSectionHeader>Client</WzSectionHeader>);
    const h = screen.getByRole("heading", { name: "Client", level: 4 });
    expect(h.className).toContain("border-b");
    expect(h.className).toContain("border-wz-rule");
  });

  it("lays a switch or a button out at the right", () => {
    render(<WzSectionHeader action={<button type="button">Send</button>}>Team</WzSectionHeader>);
    const h = screen.getByRole("heading", { name: /Team/, level: 4 });
    expect(h).toContainElement(screen.getByRole("button", { name: "Send" }));
    expect(h.className).toContain("justify-between");
  });
});

describe("WzActionBar", () => {
  it("centres its buttons in a toolbar", () => {
    render(
      <WzActionBar aria-label="Job actions">
        <button type="button">Create</button>
      </WzActionBar>,
    );
    const bar = screen.getByRole("toolbar", { name: "Job actions" });
    expect(bar.className).toContain("justify-center");
  });
});

const file = (name: string) => new File(["x"], name, { type: "image/png" });

describe("WzUploadField", () => {
  it("labels the group and shows the limit", () => {
    render(<WzUploadField label="Check Image Front" files={[]} onAdd={() => {}} />);
    expect(screen.getByRole("group", { name: "Check Image Front" })).toBeInTheDocument();
    expect(screen.getByText("You can choose up to 5 files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add files to Check Image Front" })).toBeInTheDocument();
  });

  it("hands picked files up, trimmed to what is left of the limit", async () => {
    const onAdd = vi.fn();
    render(
      <WzUploadField
        label="Before Job Image"
        files={[
          { id: "1", name: "a.png", url: "blob:a" },
          { id: "2", name: "b.png", url: "blob:b" },
          { id: "3", name: "c.png", url: "blob:c" },
        ]}
        onAdd={onAdd}
      />,
    );
    const input = screen.getByLabelText("Add files to Before Job Image", { selector: "input" });
    await userEvent.upload(input, [file("d.png"), file("e.png"), file("f.png")]);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].map((f: File) => f.name)).toEqual(["d.png", "e.png"]);
  });

  it("shows thumbnails and drops the + once full", () => {
    render(
      <WzUploadField
        label="Before Job Image"
        max={2}
        files={[
          { id: "1", name: "a.png", url: "blob:a" },
          { id: "2", name: "b.png", url: "blob:b" },
        ]}
        onAdd={() => {}}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Add files/ })).not.toBeInTheDocument();
    expect(screen.getByText("You can choose up to 2 files")).toBeInTheDocument();
  });

  it("removes and opens a file", async () => {
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    render(
      <WzUploadField
        label="Before Job Image"
        files={[{ id: "1", name: "a.png", url: "blob:a" }]}
        onAdd={() => {}}
        onRemove={onRemove}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(onRemove).toHaveBeenCalledWith("1");
    await userEvent.click(screen.getByRole("button", { name: "Open a.png" }));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("offers nothing to change while disabled", () => {
    render(
      <WzUploadField
        label="Before Job Image"
        files={[{ id: "1", name: "a.png", url: "blob:a" }]}
        onAdd={() => {}}
        onRemove={() => {}}
        disabled
      />,
    );
    expect(screen.queryByRole("button", { name: /Add files/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove a.png" })).not.toBeInTheDocument();
  });
});
