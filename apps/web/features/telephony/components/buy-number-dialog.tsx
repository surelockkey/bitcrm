"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPhone } from "@/lib/phone";
import { useAvailableNumbers, useBuyNumber } from "../numbers-hooks";
import { formatMonthlyPrice, type AvailableSearch } from "../numbers-api";

export function BuyNumberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  // Only the submitted params drive the query, so typing doesn't spam Twilio.
  const [submitted, setSubmitted] = useState<AvailableSearch | null>(null);

  const { data: results, isFetching } = useAvailableNumbers(
    submitted ?? {},
    submitted !== null,
  );
  const buy = useBuyNumber();

  const search = () =>
    setSubmitted({ country: "US", areaCode: areaCode.trim(), contains: contains.trim() });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buy a phone number</DialogTitle>
          <DialogDescription>
            Search US numbers by area code or digits. Buying provisions the number
            for inbound automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="area-code" className="text-xs">
              Area code
            </Label>
            <Input
              id="area-code"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
              placeholder="262"
              inputMode="numeric"
              className="w-24"
            />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="contains" className="text-xs">
              Contains
            </Label>
            <Input
              id="contains"
              value={contains}
              onChange={(e) => setContains(e.target.value)}
              placeholder="digits or letters"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            onClick={search}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {submitted === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Search to see available numbers.
            </p>
          ) : isFetching ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Searching…
            </p>
          ) : !results || results.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No numbers found. Try a different area code.
            </p>
          ) : (
            <ul className="divide-y">
              {results.map((n) => (
                <li
                  key={n.phoneNumber}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {formatPhone(n.phoneNumber)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[n.locality, n.region].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {formatMonthlyPrice(n.price, n.priceUnit) ? (
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatMonthlyPrice(n.price, n.priceUnit)}
                      </span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="brand"
                      disabled={buy.isPending}
                      onClick={() =>
                        buy.mutate(n.phoneNumber, {
                          onSuccess: () => onOpenChange(false),
                        })
                      }
                    >
                      {buy.isPending && buy.variables === n.phoneNumber ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Buy"
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
