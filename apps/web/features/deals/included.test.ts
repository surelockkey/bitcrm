/**
 * Імена, що приїхали разом із рядками.
 *
 * Пейджер тримає в руках кілька сторінок одразу, а `included` приходить із
 * кожною окремо — тож пошук імені має бути один на весь список, а не на
 * сторінку.
 */
import { describe, expect, it } from "vitest";
import type { JobsListIncluded } from "@bitcrm/types";
import { mergeIncluded } from "./included";

const page = (included?: JobsListIncluded) => ({ included });

describe("mergeIncluded — one lookup for every page in hand", () => {
  it("merges the names of every loaded page", () => {
    const names = mergeIncluded([
      page({
        technicians: [{ id: "t1", firstName: "Ann", lastName: "Lee" }],
        clients: [{ id: "c1", firstName: "Jane", lastName: "Smith" }],
      }),
      page({
        technicians: [{ id: "t2", firstName: "Bob", lastName: "Poole" }],
        clients: [{ id: "c2", firstName: "Ivan", lastName: "Koval" }],
      }),
    ]);

    expect(names.technicians.get("t1")?.firstName).toBe("Ann");
    expect(names.technicians.get("t2")?.lastName).toBe("Poole");
    expect(names.clients.get("c1")?.lastName).toBe("Smith");
    expect(names.clients.get("c2")?.firstName).toBe("Ivan");
  });

  it("keeps one entry for somebody who works on two pages", () => {
    const ann = { id: "t1", firstName: "Ann", lastName: "Lee" };
    const names = mergeIncluded([
      page({ technicians: [ann], clients: [] }),
      page({ technicians: [ann], clients: [] }),
    ]);

    expect(names.technicians.size).toBe(1);
  });

  it("answers an empty lookup for pages the server sent without the block", () => {
    const names = mergeIncluded([page(), page()]);

    expect(names.technicians.size).toBe(0);
    expect(names.clients.size).toBe(0);
  });

  it("answers an empty lookup before the first page has landed", () => {
    const names = mergeIncluded(undefined);

    expect(names.technicians.size).toBe(0);
    expect(names.clients.size).toBe(0);
  });
});
