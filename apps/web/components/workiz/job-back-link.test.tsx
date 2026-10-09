import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { WzJobBackLink } from "./job-back-link";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

/**
 * "← Job ID:JTX319" over a job's estimate (pg_estimate_wz_01_job) and
 * "← Job ID: XYB3JT" over a job's invoice (pg_invoice_wz_01_partial): one
 * line of 14px/16px ink with a left arrow, back to the job.
 */
describe("WzJobBackLink", () => {
  it("is a link back to the job, the arrow only decoration", () => {
    render(<WzJobBackLink href="/deals/d1">Job ID: XYB3JT</WzJobBackLink>);
    const link = screen.getByRole("link", { name: "Job ID: XYB3JT" });
    expect(link).toHaveAttribute("href", "/deals/d1");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the estimate page's line: 14px/16px ink, the arrow 10px before the words", () => {
    render(<WzJobBackLink href="/deals/d1" className="ml-5">Job ID:JTX319</WzJobBackLink>);
    const link = screen.getByRole("link", { name: "Job ID:JTX319" });
    expect(cls(link)).toEqual(
      expect.arrayContaining(["flex", "w-fit", "items-center", "gap-2.5", "text-[14px]", "leading-4", "text-foreground", "hover:underline", "ml-5"]),
    );
    expect(cls(link.querySelector("svg")!)).toEqual(expect.arrayContaining(["size-4"]));
  });
});
