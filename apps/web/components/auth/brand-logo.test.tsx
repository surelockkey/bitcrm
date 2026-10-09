import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandLogo } from "./brand-logo";

describe("BrandLogo", () => {
  it("is the Shmorkiz pill, with no typed name beside it", () => {
    render(<BrandLogo />);

    expect(screen.getByRole("img", { name: "Shmorkiz" })).toBeInTheDocument();
    expect(screen.queryByText("BitCRM")).toBeNull();
  });
});
