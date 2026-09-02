import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Phone } from "lucide-react";
import { FieldList } from "./field-list";

describe("FieldList", () => {
  it("renders each value", () => {
    render(<FieldList label="Phones" icon={Phone} values={["+14045551234"]} />);
    expect(screen.getByText("+14045551234")).toBeInTheDocument();
  });

  it("renders an em dash when there is genuinely nothing", () => {
    render(<FieldList label="Phones" icon={Phone} values={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  /**
   * The distinction that matters: a masked contact arrives with `phones: []`
   * too, and an em dash would tell the technician this client has no phone —
   * which is wrong, and sends them looking for the number somewhere else.
   */
  it("says the numbers are hidden rather than absent when masked", () => {
    render(
      <FieldList label="Phones" icon={Phone} values={[]} maskedCount={2} />,
    );
    expect(screen.getByText(/2 numbers/i)).toBeInTheDocument();
    expect(screen.getByText(/hidden/i)).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("uses the singular for a single hidden number", () => {
    render(
      <FieldList label="Phones" icon={Phone} values={[]} maskedCount={1} />,
    );
    expect(screen.getByText(/1 number\b/i)).toBeInTheDocument();
  });

  it("still says nothing-at-all when masked but the client has no numbers", () => {
    render(
      <FieldList label="Phones" icon={Phone} values={[]} maskedCount={0} />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ignores maskedCount when values are present", () => {
    render(
      <FieldList
        label="Phones"
        icon={Phone}
        values={["+14045551234"]}
        maskedCount={5}
      />,
    );
    expect(screen.getByText("+14045551234")).toBeInTheDocument();
    expect(screen.queryByText(/hidden/i)).not.toBeInTheDocument();
  });
});
