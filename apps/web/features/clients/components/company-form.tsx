"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail, Phone } from "lucide-react";
import { ClientType } from "@bitcrm/types";
import type { Company } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { companyFormSchema, type CompanyFormValues } from "../schemas";
import { useCreateCompany, useUpdateCompany } from "../hooks";
import { clientTypeLabel } from "../lib";
import { RepeatableInputs } from "./phone-email-fields";

export function CompanyForm({
  company,
  onDone,
  onCancel,
}: {
  company?: Company;
  onDone?: (c: Company) => void;
  onCancel?: () => void;
}) {
  const isEdit = !!company;
  const create = useCreateCompany();
  const update = useUpdateCompany();

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: company
      ? {
          title: company.title,
          phones: company.phones,
          emails: company.emails,
          address: company.address ?? "",
          website: company.website ?? "",
          clientType: company.clientType,
          notes: company.notes ?? "",
        }
      : {
          title: "",
          phones: [""],
          emails: [],
          address: "",
          website: "",
          clientType: ClientType.COMMERCIAL,
          notes: "",
        },
  });

  const pending = create.isPending || update.isPending;

  const submit = (v: CompanyFormValues) => {
    const body = {
      title: v.title,
      phones: v.phones,
      emails: v.emails,
      address: v.address || undefined,
      website: v.website || undefined,
      clientType: v.clientType,
      notes: v.notes || undefined,
    };
    if (isEdit) update.mutate({ id: company.id, body }, { onSuccess: (c) => onDone?.(c) });
    else create.mutate(body, { onSuccess: (c) => onDone?.(c) });
  };

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-[1fr_180px] gap-3">
        <div className="space-y-1.5">
          <Label>Company name</Label>
          <Input className="h-9" {...form.register("title")} />
          {form.formState.errors.title ? (
            <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Client type</Label>
          <Controller
            control={form.control}
            name="clientType"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(ClientType).map((t) => (
                    <SelectItem key={t} value={t}>{clientTypeLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <RepeatableInputs form={form} name="phones" label="Phones" placeholder="(404) 555-2000" icon={Phone} markPrimary />
      <RepeatableInputs form={form} name="emails" label="Emails" placeholder="hello@company.com" icon={Mail} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Address</Label>
          <Input className="h-9" placeholder="City, State" {...form.register("address")} />
        </div>
        <div className="space-y-1.5">
          <Label>Website</Label>
          <Input className="h-9" placeholder="company.com" {...form.register("website")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea rows={3} {...form.register("notes")} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        ) : null}
        <Button type="submit" variant="brand" className="gap-1.5" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {isEdit ? "Save changes" : "Create company"}
        </Button>
      </div>
    </form>
  );
}
