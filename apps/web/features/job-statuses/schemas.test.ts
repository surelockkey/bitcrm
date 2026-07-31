import { describe, it, expect } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { jobStatusFormSchema, toJobStatusBody } from "./schemas";

describe("jobStatusFormSchema", () => {
  it("accepts a valid form and coerces priority", () => {
    const parsed = jobStatusFormSchema.parse({
      name: "Job Done",
      group: JobSuperStatus.IN_PROGRESS,
      color: "green",
      priority: "5",
      active: true,
    });
    expect(parsed).toEqual({
      name: "Job Done",
      group: JobSuperStatus.IN_PROGRESS,
      color: "green",
      priority: 5,
      active: true,
    });
  });

  it("requires a super-status group", () => {
    expect(jobStatusFormSchema.safeParse({ name: "X", color: "red" }).success).toBe(false);
  });

  it("rejects a group outside the enum", () => {
    expect(jobStatusFormSchema.safeParse({ name: "X", group: "nonsense" }).success).toBe(false);
  });

  it("trims the name and rejects an empty one", () => {
    expect(
      jobStatusFormSchema.safeParse({ name: "   ", group: JobSuperStatus.PENDING }).success,
    ).toBe(false);
  });

  it("defaults color to slate, priority to 0 and active to true", () => {
    const parsed = jobStatusFormSchema.parse({ name: "Will Call Back", group: JobSuperStatus.PENDING });
    expect(parsed.color).toBe("slate");
    expect(parsed.priority).toBe(0);
    expect(parsed.active).toBe(true);
  });

  it("maps to the request body", () => {
    const body = toJobStatusBody({
      name: "NO ANSWER",
      group: JobSuperStatus.PENDING,
      color: "blue",
      priority: 3,
      active: false,
    });
    expect(body).toEqual({
      name: "NO ANSWER",
      group: JobSuperStatus.PENDING,
      color: "blue",
      priority: 3,
      active: false,
    });
  });
});
