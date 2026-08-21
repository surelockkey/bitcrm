"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ExternalCompany } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCreateExternalCompany, useUpdateExternalCompany } from "../hooks";
import { externalCompanyFormSchema, toExternalCompanyBody } from "../schemas";

export function ExternalCompanyFormDialog({
  company,
  open,
  onOpenChange,
}: {
  company?: ExternalCompany;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(company);
  const create = useCreateExternalCompany();
  const update = useUpdateExternalCompany(company?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(company?.name ?? "");
  const [email, setEmail] = useState(company?.email ?? "");
  const [address, setAddress] = useState(company?.address ?? "");
  const [phone, setPhone] = useState(company?.phone ?? "");
  const [active, setActive] = useState(company?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => externalCompanyFormSchema.safeParse({ name, email, address, phone, active }),
    [name, email, address, phone, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toExternalCompanyBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${company!.name}` : "New external company"}</DialogTitle>
          <DialogDescription>
            A partner that sends work your way (Agero, Allied Dispatch, a referral
            partner). Only the name is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ec-name">Company name</Label>
            <Input
              id="ec-name"
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Allied Dispatch Solutions"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ec-email">Company email</Label>
              <Input
                id="ec-email"
                className="h-9"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dispatch@partner.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-phone">Company phone</Label>
              <PhoneInput id="ec-phone" value={phone} onChange={setPhone} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ec-address">Company address</Label>
            <Input
              id="ec-address"
              className="h-9"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="500 Borla Dr, Johnson City, TN 37604"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="ec-active">Enabled</Label>
              <p className="text-xs text-muted-foreground">
                Only enabled companies show in the job picker.
              </p>
            </div>
            <Switch id="ec-active" checked={active} onCheckedChange={setActive} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="brand" className="gap-1.5" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save changes" : "Create company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
