import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzOutlinedTextField } from "./outlined-text-field";

/**
 * The text box of Workiz's newer forms (FloatingLabel-module + Input-module,
 * the user page — pg_technicians_wz_measure_user.json): 40px, 1px #9ea6aa,
 * 4px corners, 13px ink 12px in; the label in the notch (11px ink on white,
 * 8px in, 8px up) once there is something in it, resting inside (13px
 * #768287) while empty.
 */
describe("WzOutlinedTextField", () => {
  it("is a text box named by its label, and types like one", async () => {
    render(<WzOutlinedTextField label="Name" defaultValue="Bohdan" />);
    const box = screen.getByLabelText("Name");
    expect(box).toHaveValue("Bohdan");
    await userEvent.type(box, " TECH");
    expect(box).toHaveValue("Bohdan TECH");
  });

  it("floats the label by the input's own state, so a form reset moves it too", () => {
    render(<WzOutlinedTextField label="Email" defaultValue="" />);
    const box = screen.getByLabelText("Email");
    // A space no one sees: `:placeholder-shown` then means "empty".
    expect(box).toHaveAttribute("placeholder", " ");
    const label = document.querySelector("label")!;
    expect(label.className).toContain("peer-[:not(:placeholder-shown)]:-top-2");
    expect(label.className).toContain("peer-focus:-top-2");
  });

  it("keeps a real placeholder and the label in the notch from the start", () => {
    render(<WzOutlinedTextField label="Allowed IP addresses" placeholder="Leave empty if all IPs apply" />);
    const box = screen.getByLabelText("Allowed IP addresses");
    expect(box).toHaveAttribute("placeholder", "Leave empty if all IPs apply");
    expect(document.querySelector("label")!.getAttribute("data-floated")).toBe("true");
  });

  it("is a bare box with only a placeholder (Labor cost's '00.00'), named by aria-label", () => {
    render(<WzOutlinedTextField placeholder="00.00" aria-label="Labor cost per hour" />);
    expect(screen.getByLabelText("Labor cost per hour")).toHaveAttribute("placeholder", "00.00");
    expect(document.querySelector("label")).toBeNull();
  });

  it("ties an error to the box", () => {
    render(<WzOutlinedTextField label="Phone" error="Enter a valid phone" />);
    const box = screen.getByLabelText("Phone");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(box.getAttribute("aria-describedby")!)).toHaveTextContent("Enter a valid phone");
  });

  it("is 40px with the 1px #9ea6aa edge", () => {
    render(<WzOutlinedTextField label="Name" />);
    const box = screen.getByLabelText("Name");
    expect(box.className).toContain("h-10");
    expect(box.className).toContain("border-wz-outline");
  });
});
