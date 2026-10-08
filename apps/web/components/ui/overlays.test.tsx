import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "./alert-dialog";
import { Button } from "./button";

const cls = (el: Element | null) => (el?.className ?? "").toString().split(/\s+/);

describe("a dialog", () => {
  it("is Workiz's modal: 16px corners, 24px in, a hard drop shadow, 18px/600 title", () => {
    // uikit_wz_pb_addnew ("Add New Item"): r16, padding 24,
    // 0 3px 9px rgba(0,0,0,.5); h4 18px/600/27px ink.
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Add New Item</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const box = document.querySelector("[data-slot=dialog-content]");
    expect(cls(box)).toEqual(expect.arrayContaining(["rounded-[16px]", "p-6", "shadow-[0_3px_9px_rgba(0,0,0,0.5)]"]));
    expect(cls(screen.getByText("Add New Item"))).toEqual(expect.arrayContaining(["text-lg", "font-semibold"]));
  });

  it("dims the page to 30% black with no blur (Workiz's modal-backdrop)", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const overlay = document.querySelector("[data-slot=dialog-overlay]");
    expect(cls(overlay)).toContain("bg-black/30");
    expect((overlay?.className ?? "").toString()).not.toContain("blur");
  });

  it("gives the footer Workiz's big 40px buttons on white, under a soft rule", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const footer = document.querySelector("[data-slot=dialog-footer]");
    expect(cls(footer)).toEqual(expect.arrayContaining(["[&>[data-size=default]]:h-10", "bg-popover"]));
    expect(cls(footer)).not.toContain("bg-muted/50");
  });
});

describe("a sheet", () => {
  it("is Workiz's side drawer: #666 at 60% behind it, no blur, a soft edge shadow", () => {
    // list_02 / uikit_wz_clients_fields / jobdetails_wz_address_open:
    // `.right-pane-container` rgb(102,102,102) — white → #a3a3a3, #ccc → #8f8f8f.
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Visible fields</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const overlay = document.querySelector("[data-slot=sheet-overlay]");
    expect(cls(overlay)).toContain("bg-wz-scrim/60");
    expect((overlay?.className ?? "").toString()).not.toContain("blur");
    expect(cls(screen.getByText("Visible fields"))).toEqual(expect.arrayContaining(["text-lg", "font-semibold"]));
  });
});

describe("an alert dialog", () => {
  it("wears the same modal chrome and backdrop as a dialog", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete job?</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(cls(document.querySelector("[data-slot=alert-dialog-content]"))).toEqual(
      expect.arrayContaining(["rounded-[16px]", "p-6"]),
    );
    const overlay = document.querySelector("[data-slot=alert-dialog-overlay]");
    expect(cls(overlay)).toContain("bg-black/30");
    expect((overlay?.className ?? "").toString()).not.toContain("blur");
  });
});
