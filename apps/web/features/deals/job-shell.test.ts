import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import {
  countLabel,
  dealBalance,
  dealJobName,
  dealTabSublabel,
  fileTitle,
  formatBoxAmount,
  jobActions,
  jobChatPhone,
  jobClientName,
  jobDueDate,
  jobNamePatch,
  storedTagOrder,
  workizDate,
  workizDateTime,
} from "./job-shell";

describe("job title — 'Job #5TU7ZA - Dustin Roselle'", () => {
  it("names the client the way the job shows it: its own name first, else the contact's", () => {
    expect(jobClientName({ clientName: { firstName: "Clinic", lastName: "" } }, { firstName: "Jane", lastName: "Smith" })).toBe(
      "Clinic",
    );
    expect(jobClientName({}, { firstName: "Jane", lastName: "Smith" })).toBe("Jane Smith");
    expect(jobClientName({}, undefined)).toBe("");
  });
});

describe("job name (Workiz 'Job name: ✎')", () => {
  it("reads the job's name, or nothing while the API does not send one", () => {
    expect(dealJobName({ jobName: "Back gate" })).toBe("Back gate");
    expect(dealJobName({})).toBe("");
    expect(dealJobName({ jobName: null })).toBe("");
  });

  it("saves a trimmed new name", () => {
    expect(jobNamePatch("", "  Back gate ")).toEqual({ jobName: "Back gate" });
    expect(jobNamePatch("Back gate", "Front gate")).toEqual({ jobName: "Front gate" });
  });

  it("clears the name with null when the box is emptied", () => {
    expect(jobNamePatch("Back gate", "   ")).toEqual({ jobName: null });
  });

  it("sends nothing when nothing changed", () => {
    expect(jobNamePatch("Back gate", "Back gate ")).toBeNull();
    expect(jobNamePatch("", "")).toBeNull();
  });
});

describe("Actions menu — Workiz's Job Done / View Work Order / Duplicate Job / Delete Job", () => {
  it("offers Job Done and Delete Job to someone who may do both", () => {
    expect(jobActions({ superStatus: JobSuperStatus.SUBMITTED, canEdit: true, canDelete: true })).toEqual([
      "done",
      "delete",
    ]);
  });

  it("drops Job Done once the job is done", () => {
    expect(jobActions({ superStatus: JobSuperStatus.DONE, canEdit: true, canDelete: true })).toEqual(["delete"]);
  });

  it("follows the permissions: no status change without edit, no delete without delete", () => {
    expect(jobActions({ superStatus: JobSuperStatus.IN_PROGRESS, canEdit: false, canDelete: true })).toEqual([
      "delete",
    ]);
    expect(jobActions({ superStatus: JobSuperStatus.IN_PROGRESS, canEdit: true, canDelete: false })).toEqual([
      "done",
    ]);
    expect(jobActions({ superStatus: JobSuperStatus.IN_PROGRESS, canEdit: false, canDelete: false })).toEqual([]);
  });

  it("lists View Work Order, in Workiz's place, for a job a work order authorized — to someone who may see work orders", () => {
    const base = { superStatus: JobSuperStatus.SUBMITTED, canEdit: true, canDelete: true };
    expect(jobActions({ ...base, workOrderId: "wo-1", canViewWorkOrders: true })).toEqual(["done", "work_order", "delete"]);
    expect(jobActions({ ...base, workOrderId: "wo-1", canViewWorkOrders: false })).toEqual(["done", "delete"]);
    expect(jobActions({ ...base, canViewWorkOrders: true })).toEqual(["done", "delete"]);
  });
});

describe("the header's Tags row: newest first, stored in the order added", () => {
  it("keeps the stored order of what stays and adds a new tag at the end (it shows first)", () => {
    // Shown newest first: [c, b, a]; the picker hands back [c, b, a, d] after adding d.
    expect(storedTagOrder(["a", "b", "c"], ["c", "b", "a", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("drops a removed tag without reordering the rest", () => {
    expect(storedTagOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });
});

describe("attachment names as Workiz lists them (audit_pixels T8)", () => {
  it("drops the extension: 'file - 2026-10-07t153737.209'", () => {
    expect(fileTitle("file - 2026-10-07t153737.209.jpg")).toBe("file - 2026-10-07t153737.209");
    expect(fileTitle("before.jpg")).toBe("before");
    expect(fileTitle("archive.tar.gz")).toBe("archive.tar");
  });

  it("leaves a name without an extension, or a dotfile, as it is", () => {
    expect(fileTitle("README")).toBe("README");
    expect(fileTitle(".env")).toBe(".env");
  });
});

describe("the number 'Message Client' texts (J1)", () => {
  it("is the job's own primary number first, as Workiz texts the job's phone", () => {
    expect(jobChatPhone(["+15715310137"], ["+14045551234"])).toEqual({ phone: "+15715310137", onContact: false });
  });

  it("knows when the job's number is also on the client record, whatever its format", () => {
    expect(jobChatPhone(["(571) 531-0137"], ["+15715310137"])).toEqual({ phone: "(571) 531-0137", onContact: true });
  });

  it("falls back to the client's number when the job has none", () => {
    expect(jobChatPhone(undefined, ["+15715310137"])).toEqual({ phone: "+15715310137", onContact: true });
    expect(jobChatPhone([], [])).toEqual({ phone: undefined, onContact: true });
  });
});

describe("the Items tab's Due (job_amount_due_date)", () => {
  it("is the invoice's due date when the job has an invoice", () => {
    expect(jobDueDate({ scheduledDate: "2026-10-09", createdAt: "2026-10-05T10:00:00.000Z" }, "2026-10-20")).toBe("10/20/2026");
  });

  it("is the job's day otherwise, as Workiz fills it, else the day it was created", () => {
    expect(jobDueDate({ scheduledDate: "2026-10-08", createdAt: "2026-10-05T10:00:00.000Z" })).toBe("10/8/2026");
    expect(jobDueDate({ createdAt: "2026-10-05T16:00:00.000Z" })).toBe("10/5/2026");
    expect(jobDueDate({})).toBe("");
  });
});

describe("the job's balance off the job row (before or without the ledger)", () => {
  it("is the total less what billing says was collected", () => {
    expect(dealBalance({ totals: { total: 150 } as never, amountPaid: 100 })).toBe(50);
    expect(dealBalance({ totals: { total: 150 } as never, amountPaid: 150 })).toBe(0);
  });

  it("reads Workiz's own amount due on an imported job billing has not touched", () => {
    expect(dealBalance({ totals: { total: 150, amountDue: 0 } as never })).toBe(0);
  });

  it("is the whole total when nothing says otherwise, and nothing without a total", () => {
    expect(dealBalance({ totals: { total: 150 } as never })).toBe(150);
    expect(dealBalance({})).toBe(0);
  });

  it("never goes below zero", () => {
    expect(dealBalance({ totals: { total: 100 } as never, amountPaid: 120 })).toBe(0);
  });
});

describe("amounts in the Items tab's grey boxes", () => {
  it("are bare numbers with two decimals, as Workiz writes them", () => {
    expect(formatBoxAmount(150)).toBe("150.00");
    expect(formatBoxAmount(0)).toBe("0.00");
    expect(formatBoxAmount(134595.41)).toBe("134,595.41");
  });
});

describe("dates as Workiz prints them on the job's tabs", () => {
  it("a day: 10/8/2026", () => {
    expect(workizDate("2026-10-08")).toBe("10/8/2026");
    expect(workizDate("2026-05-04T23:59:00.000Z")).toBe("5/4/2026");
    expect(workizDate(undefined)).toBe("");
  });

  it("a moment, on business time: 5/4/2026 at 8:59 PM", () => {
    // 00:59 UTC on the 5th is 8:59 PM on the 4th in New York (EDT).
    expect(workizDateTime("2026-05-05T00:59:00.000Z")).toBe("5/4/2026 at 8:59 PM");
    expect(workizDateTime("not a date")).toBe("");
  });
});

describe("count words, as the tab bar writes them", () => {
  it("is singular for one and plural otherwise", () => {
    expect(countLabel(0, "estimate")).toBe("0 estimates");
    expect(countLabel(1, "estimate")).toBe("1 estimate");
    expect(countLabel(3, "attachment")).toBe("3 attachments");
  });
});

describe("tab sublabels (the grey second line)", () => {
  const ctx = {
    jobTypeName: "Lockout",
    itemsTotal: 150,
    balanceDue: 0,
    estimateCount: 1,
    invoiceStatus: "paid" as const,
    attachmentCount: 3,
  };

  it("Details names the job type, N/A when there is none", () => {
    expect(dealTabSublabel("details", ctx)).toBe("Lockout");
    expect(dealTabSublabel("details", { ...ctx, jobTypeName: undefined })).toBe("N/A");
  });

  it("Items is the items' total", () => {
    expect(dealTabSublabel("items", ctx)).toBe("$150.00");
    expect(dealTabSublabel("items", { ...ctx, itemsTotal: undefined })).toBe("$0.00");
  });

  it("Payments is the balance", () => {
    expect(dealTabSublabel("payments", ctx)).toBe("$0.00 balance");
    expect(dealTabSublabel("payments", { ...ctx, balanceDue: 1234.5 })).toBe("$1,234.50 balance");
  });

  it("Payments falls back to the items total when the ledger is not in", () => {
    expect(dealTabSublabel("payments", { ...ctx, balanceDue: undefined })).toBe("$150.00 balance");
  });

  it("Estimates and Attachments count", () => {
    expect(dealTabSublabel("estimates", ctx)).toBe("1 estimate");
    expect(dealTabSublabel("estimates", { ...ctx, estimateCount: 0 })).toBe("0 estimates");
    expect(dealTabSublabel("attachments", ctx)).toBe("3 attachments");
  });

  it("Invoice reads the invoice's status, or says there is none", () => {
    expect(dealTabSublabel("invoice", ctx)).toBe("Paid");
    expect(dealTabSublabel("invoice", { ...ctx, invoiceStatus: undefined })).toBe("No invoice");
  });
});
