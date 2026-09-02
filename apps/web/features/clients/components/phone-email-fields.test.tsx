import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Phone } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { RepeatableInputs } from "./phone-email-fields";

/**
 * Phones and their extensions are two parallel rows, so every add and remove
 * has to move both — an extension that drifts onto the wrong number tells
 * somebody to press the wrong keys.
 */
function Harness({ phones, exts }: { phones: string[]; exts: string[] }) {
  const form = useForm({ defaultValues: { phones, phoneExts: exts } });
  const values = useWatch({ control: form.control });
  return (
    <>
      <RepeatableInputs
        form={form}
        name="phones"
        extensionName="phoneExts"
        label="Phones"
        placeholder="(404) 555-1234"
        icon={Phone}
        variant="phone"
      />
      <pre data-testid="values">{JSON.stringify(values)}</pre>
    </>
  );
}

const values = () => JSON.parse(screen.getByTestId("values").textContent!);

describe("RepeatableInputs — phone extensions", () => {
  it("shows a small extension field beside each number", () => {
    render(<Harness phones={["+14045551234"]} exts={["102"]} />);
    expect(screen.getByLabelText("Extension for phone 1")).toHaveValue("102");
  });

  it("keeps only what can be dialled", async () => {
    const user = userEvent.setup();
    render(<Harness phones={["+14045551234"]} exts={[""]} />);

    await user.type(screen.getByLabelText("Extension for phone 1"), "ext. 102");

    expect(screen.getByLabelText("Extension for phone 1")).toHaveValue("102");
    expect(values().phoneExts).toEqual(["102"]);
  });

  it("adds an empty extension row with each new phone", async () => {
    const user = userEvent.setup();
    render(<Harness phones={["+14045551234"]} exts={["102"]} />);

    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(values().phoneExts).toEqual(["102", ""]);
    expect(screen.getByLabelText("Extension for phone 2")).toHaveValue("");
  });

  it("takes the extension with the phone it belongs to when a row is removed", async () => {
    const user = userEvent.setup();
    render(<Harness phones={["+14045551234", "+15558675309"]} exts={["102", "7"]} />);

    await user.click(screen.getByRole("button", { name: "Remove phones 1" }));

    expect(values()).toEqual({ phones: ["+15558675309"], phoneExts: ["7"] });
  });
});

/** The same list without extensions — emails still add and remove cleanly. */
describe("RepeatableInputs — no extensions", () => {
  function EmailHarness() {
    const form = useForm({
      defaultValues: { emails: ["jane@acme.com", "billing@acme.com"] },
    });
    const values = useWatch({ control: form.control });
    return (
      <>
        <RepeatableInputs
          form={form}
          name="emails"
          label="Emails"
          placeholder="name@example.com"
          icon={Phone}
        />
        <pre data-testid="values">{JSON.stringify(values)}</pre>
      </>
    );
  }

  it("has no extension box, and rows still add and remove", async () => {
    const user = userEvent.setup();
    render(<EmailHarness />);
    expect(screen.queryByPlaceholderText("Ext.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getAllByPlaceholderText("name@example.com")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Remove emails 1" }));
    expect(values().emails).toEqual(["billing@acme.com"]);
  });
});
