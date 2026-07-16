import { describe, expect, it } from "vitest";
import { formatUpdatedAge } from "./last-updated";

describe("formatUpdatedAge", () => {
  it("reads freshly under 5s as 'just now'", () => {
    expect(formatUpdatedAge(0)).toBe("just now");
    expect(formatUpdatedAge(4_999)).toBe("just now");
  });

  it("counts seconds under a minute", () => {
    expect(formatUpdatedAge(12_000)).toBe("12s ago");
  });

  it("rolls up to minutes then hours", () => {
    expect(formatUpdatedAge(90_000)).toBe("1 min ago");
    expect(formatUpdatedAge(3 * 3_600_000)).toBe("3h ago");
  });
});
