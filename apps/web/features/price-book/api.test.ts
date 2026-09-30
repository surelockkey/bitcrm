import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { createBrand, createItemCategory, updateBrand, updateItemCategory } from "./api";

type Call = { method: string; path: string; body: unknown };

/** Records method, path and JSON body of every write under `prefix`, answering `row`. */
function capture(prefix: string, row: object) {
  const calls: Call[] = [];
  const answer = async ({ request }: { request: Request }) => {
    calls.push({
      method: request.method,
      // Whatever the API base, the route from `/inventory` on.
      path: new URL(request.url).pathname.replace(/^.*(?=\/inventory\/)/, ""),
      body: await request.json(),
    });
    return HttpResponse.json({ success: true, data: row });
  };
  server.use(http.post(`*${prefix}`, answer), http.put(`*${prefix}/:id`, answer));
  return calls;
}

const row = { id: "x1", name: "Locks", active: true, createdBy: "u", createdAt: "", updatedAt: "" };

describe("item categories", () => {
  it("creates with exactly the name and the active flag", async () => {
    const calls = capture("/inventory/categories", row);
    await expect(createItemCategory({ name: "Locks", active: true })).resolves.toEqual(row);
    expect(calls).toEqual([
      { method: "POST", path: "/inventory/categories", body: { name: "Locks", active: true } },
    ]);
  });

  it("updates by id with only the fields given", async () => {
    const calls = capture("/inventory/categories", row);
    await updateItemCategory("c1", { active: false });
    expect(calls).toEqual([
      { method: "PUT", path: "/inventory/categories/c1", body: { active: false } },
    ]);
  });
});

describe("brands", () => {
  it("creates with exactly the name and the active flag", async () => {
    const calls = capture("/inventory/brands", row);
    await createBrand({ name: "Schlage", active: true });
    expect(calls).toEqual([
      { method: "POST", path: "/inventory/brands", body: { name: "Schlage", active: true } },
    ]);
  });

  it("updates by id with only the fields given", async () => {
    const calls = capture("/inventory/brands", row);
    await updateBrand("b1", { name: "Kwikset", active: true });
    expect(calls).toEqual([
      { method: "PUT", path: "/inventory/brands/b1", body: { name: "Kwikset", active: true } },
    ]);
  });
});
