"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { CreateLeadInput } from "@/lib/validators/lead";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function NewLeadPage() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateLeadInput>({
    defaultValues: {
      state: "FL",
      propertyType: "RESIDENTIAL",
      insuranceClaim: false,
      financingNeeded: false,
      urgent: false,
    },
  });

  const { data: sources } = useQuery({
    queryKey: ["sources"],
    queryFn: () => fetch("/api/admin/sources").then((r) => r.json()),
  });

  const { data: services } = useQuery({
    queryKey: ["services"],
    queryFn: () => fetch("/api/admin/services").then((r) => r.json()),
  });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });

  const createLead = useMutation({
    mutationFn: (data: CreateLeadInput) =>
      fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: (result) => {
      if (result.duplicates?.length) {
        toast.warning(
          `Possible duplicate detected! ${result.duplicates.length} similar lead(s) found.`
        );
      } else {
        toast.success("Lead created successfully");
      }
      router.push(`/leads/${result.lead.id}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to create lead: ${err.message}`);
    },
  });

  const selectedServices = watch("serviceCategoryIds") || [];

  function toggleService(serviceId: string) {
    const current = selectedServices;
    const next = current.includes(serviceId)
      ? current.filter((id) => id !== serviceId)
      : [...current, serviceId];
    setValue("serviceCategoryIds", next);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New Lead"
        description="Enter lead information"
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        }
      />

      <form onSubmit={handleSubmit((data: CreateLeadInput) => createLead.mutate(data))} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input id="firstName" {...register("firstName")} />
              {errors.firstName && <p className="mt-1 text-xs text-red-600">{errors.firstName.message}</p>}
            </div>
            <div>
              <Label htmlFor="lastName">Last Name *</Label>
              <Input id="lastName" {...register("lastName")} />
              {errors.lastName && <p className="mt-1 text-xs text-red-600">{errors.lastName.message}</p>}
            </div>
            <div>
              <Label htmlFor="primaryPhone">Primary Phone *</Label>
              <Input id="primaryPhone" {...register("primaryPhone")} />
              {errors.primaryPhone && <p className="mt-1 text-xs text-red-600">{errors.primaryPhone.message}</p>}
            </div>
            <div>
              <Label htmlFor="secondaryPhone">Secondary Phone</Label>
              <Input id="secondaryPhone" {...register("secondaryPhone")} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" {...register("companyName")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Property Address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="propertyAddress1">Address Line 1 *</Label>
              <Input id="propertyAddress1" {...register("propertyAddress1")} />
              {errors.propertyAddress1 && <p className="mt-1 text-xs text-red-600">{errors.propertyAddress1.message}</p>}
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="propertyAddress2">Address Line 2</Label>
              <Input id="propertyAddress2" {...register("propertyAddress2")} />
            </div>
            <div>
              <Label htmlFor="city">City *</Label>
              <Input id="city" {...register("city")} />
              {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city.message}</p>}
            </div>
            <div>
              <Label htmlFor="county">County</Label>
              <Input id="county" {...register("county")} />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" {...register("state")} />
            </div>
            <div>
              <Label htmlFor="zipCode">ZIP Code *</Label>
              <Input id="zipCode" {...register("zipCode")} />
              {errors.zipCode && <p className="mt-1 text-xs text-red-600">{errors.zipCode.message}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Source</Label>
              <Select onValueChange={(v: string | null) => setValue("sourceId", v ?? undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {sources?.map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sourceDetail">Source Detail / Campaign</Label>
              <Input id="sourceDetail" {...register("sourceDetail")} />
            </div>
            <div>
              <Label>Assign To</Label>
              <Select onValueChange={(v: string | null) => setValue("assignedUserId", v ?? undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select rep" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    ?.filter((u: { role: { name: string }; isActive: boolean }) =>
                      u.isActive && ["SALES_REP", "MANAGER"].includes(u.role.name)
                    )
                    .map((u: { id: string; firstName: string; lastName: string }) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Property Type</Label>
              <Select
                defaultValue="RESIDENTIAL"
                onValueChange={(v: string | null) => setValue("propertyType", (v ?? "RESIDENTIAL") as "RESIDENTIAL" | "COMMERCIAL")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RESIDENTIAL">Residential</SelectItem>
                  <SelectItem value="COMMERCIAL">Commercial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="estimatedJobValue">Estimated Job Value ($)</Label>
              <Input
                id="estimatedJobValue"
                type="number"
                {...register("estimatedJobValue", { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label htmlFor="nextFollowUpAt">Next Follow-Up</Label>
              <Input
                id="nextFollowUpAt"
                type="datetime-local"
                {...register("nextFollowUpAt")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Services Needed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {services?.map(
                (parent: { id: string; name: string; children?: { id: string; name: string }[] }) => (
                  <div key={parent.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <Checkbox
                        id={parent.id}
                        checked={selectedServices.includes(parent.id)}
                        onCheckedChange={() => toggleService(parent.id)}
                      />
                      <Label htmlFor={parent.id} className="font-medium">
                        {parent.name}
                      </Label>
                    </div>
                    {parent.children?.map((child) => (
                      <div key={child.id} className="ml-6 flex items-center gap-2">
                        <Checkbox
                          id={child.id}
                          checked={selectedServices.includes(child.id)}
                          onCheckedChange={() => toggleService(child.id)}
                        />
                        <Label htmlFor={child.id} className="text-sm font-normal">
                          {child.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Flags & Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="insuranceClaim"
                  onCheckedChange={(c: boolean) => setValue("insuranceClaim", c)}
                />
                <Label htmlFor="insuranceClaim">Insurance Claim</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="financingNeeded"
                  onCheckedChange={(c: boolean) => setValue("financingNeeded", c)}
                />
                <Label htmlFor="financingNeeded">Financing Needed</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="urgent"
                  onCheckedChange={(c: boolean) => setValue("urgent", c)}
                />
                <Label htmlFor="urgent">Urgent</Label>
              </div>
            </div>
            <div>
              <Label htmlFor="notesSummary">Notes</Label>
              <Textarea
                id="notesSummary"
                {...register("notesSummary")}
                rows={3}
                placeholder="Initial notes about this lead..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={createLead.isPending}>
            {createLead.isPending ? "Creating..." : "Create Lead"}
          </Button>
        </div>
      </form>
    </div>
  );
}
