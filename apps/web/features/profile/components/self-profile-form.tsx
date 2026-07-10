"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { TechnicianProfile } from "@bitcrm/types";
import { useProfile, useUpdateProfile } from "@/features/technicians/hooks";

/** Self-fill only — labor cost, status and the GPS/masking flags are manager-owned. */
const selfSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  line1: z.string().trim().max(120).optional(),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(12).optional(),
});
type SelfValues = z.infer<typeof selfSchema>;

export function SelfProfileForm({ technicianId }: { technicianId: string }) {
  const { data: profile, isLoading } = useProfile(technicianId);
  if (isLoading || !profile) return <Skeleton className="h-64 w-full max-w-xl" />;
  return <Form key={profile.updatedAt} technicianId={technicianId} profile={profile} />;
}

function Form({ technicianId, profile }: { technicianId: string; profile: TechnicianProfile }) {
  const update = useUpdateProfile();
  const a = profile.homeAddress;
  const form = useForm<SelfValues>({
    resolver: zodResolver(selfSchema),
    defaultValues: {
      phone: profile.phone ?? "",
      line1: a?.line1 ?? "",
      line2: a?.line2 ?? "",
      city: a?.city ?? "",
      state: a?.state ?? "",
      zip: a?.zip ?? "",
    },
  });

  const onSubmit = (v: SelfValues) => {
    const homeAddress =
      v.line1 && v.city && v.state && v.zip
        ? { line1: v.line1, line2: v.line2 || undefined, city: v.city, state: v.state, zip: v.zip }
        : undefined;
    update.mutate({ id: technicianId, body: { phone: v.phone || undefined, homeAddress } });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl space-y-5" noValidate>
      <div className="space-y-1.5">
        <Label>Phone</Label>
        <Input className="h-10" {...form.register("phone")} />
      </div>
      <div className="space-y-1.5">
        <Label>Home address</Label>
        <Input className="h-10" placeholder="Street" {...form.register("line1")} />
        <Input className="mt-2 h-10" placeholder="Apt, suite (optional)" {...form.register("line2")} />
        <div className="mt-2 grid grid-cols-3 gap-3">
          <Input className="h-10" placeholder="City" {...form.register("city")} />
          <Input className="h-10" placeholder="State" {...form.register("state")} />
          <Input className="h-10" placeholder="ZIP" {...form.register("zip")} />
        </div>
        <p className="text-xs text-muted-foreground">Used to route jobs near you.</p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="brand" disabled={update.isPending} className="gap-1.5">
          {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save profile
        </Button>
      </div>
    </form>
  );
}
