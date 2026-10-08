import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function tabs(variant?: "default" | "line" | "page") {
  render(
    <Tabs defaultValue="a">
      <TabsList variant={variant} aria-label="Sections">
        <TabsTrigger value="a">Jobs</TabsTrigger>
        <TabsTrigger value="b">Estimates</TabsTrigger>
      </TabsList>
      <TabsContent value="a">A</TabsContent>
      <TabsContent value="b">B</TabsContent>
    </Tabs>,
  );
  return {
    list: screen.getByRole("tablist", { name: "Sections" }),
    on: screen.getByRole("tab", { name: "Jobs" }),
  };
}

const cls = (el: HTMLElement) => el.className.split(/\s+/);

describe("tabs", () => {
  it("draws `line` as Workiz's small tabs: 13px words, a 2px ink bar under the open one", () => {
    // uikit_wz_client_page / set_customfields (Tabs-module). The #c4c4c4
    // rule is the page's (pages already draw one on the row's container).
    const { list, on } = tabs("line");
    expect(cls(list)).not.toContain("border-b");
    expect(cls(on)).toEqual(
      expect.arrayContaining([
        "group-data-[variant=line]/tabs-list:text-[13px]",
        "group-data-[variant=line]/tabs-list:text-wz-slate",
        "group-data-[variant=line]/tabs-list:data-active:font-semibold",
        "group-data-[variant=line]/tabs-list:data-active:after:h-0.5",
      ]),
    );
  });

  it("draws the default as Workiz's segmented control (the scheduler's Day / Week / Month)", () => {
    // uikit_wz_schedule `_schViews`: 1px #ddd box, 4px corner, 12px/500 words,
    // a #ddd rule between, the chosen one on #f8f8f8.
    const { list, on } = tabs();
    expect(cls(list)).toEqual(expect.arrayContaining(["border-wz-frame", "rounded-[4px]"]));
    expect(cls(on)).toEqual(
      expect.arrayContaining([
        "group-data-[variant=default]/tabs-list:text-xs",
        "group-data-[variant=default]/tabs-list:data-active:bg-[#f8f8f8]",
      ]),
    );
  });

  it("offers Workiz's big page tabs (Price book): 16px, a 3px bar", () => {
    const { list, on } = tabs("page");
    expect(cls(list)).toContain("border-input");
    expect(cls(on)).toEqual(
      expect.arrayContaining([
        "group-data-[variant=page]/tabs-list:text-base",
        "group-data-[variant=page]/tabs-list:data-active:after:h-[3px]",
      ]),
    );
  });
});
