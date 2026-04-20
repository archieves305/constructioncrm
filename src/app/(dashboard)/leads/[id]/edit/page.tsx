"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { UpdateLeadInput } from "@/lib/validators/lead";
import { PageHeader } from "@/components/shared/page-header";
import { AddressAutofillFields } from "@/components/shared/address-autofill-fields";
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

function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditLeadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<UpdateLeadInput>({
    defaultValues: {
      state: "FL",
      propertyType: "RESIDENTIAL",
      insuranceClaim: false,
      financingNeeded: false,
      urgent: false,
    },
  });

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetch(`/api/leads/${id}`).then((r) => r.json()),
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

  useEffect(() => {
    if (!lead || lead.error) return;
    reset({
      firstName: lead.firstName ?? "",
      lastName: lead.lastName ?? "",
      primaryPhone: lead.primaryPhone ?? "",
      secondaryPhone: lead.secondaryPhone ?? "",
      email: lead.email ?? "",
      companyName: lead.companyName ?? "",
      propertyAddress1: lead.propertyAddress1 ?? "",
      propertyAddress2: lead.propertyAddress2 ?? "",
      city: lead.city ?? "",
      county: lead.county ?? "",
      state: lead.state ?? "FL",
      zipCode: lead.zipCode ?? "",
      propertyType: lead.propertyType ?? "RESIDENTIAL",
      sourceId: lead.sourceId ?? undefined,
      sourceDetail: lead.sourceDetail ?? "",
      assignedUserId: lead.assignedUserId ?? undefined,
      serviceCategoryIds:
        lead.services?.map(
          (s: { serviceCategory: { id: string } }) => s.serviceCategory.id
        ) ?? [],
      estimatedJobValue: lead.estimatedJobValue
        ? Number(lead.estimatedJobValue)
        : undefined,
      insuranceClaim: !!lead.insuranceClaim,
      financingNeeded: !!lead.financingNeeded,
      urgent: !!lead.urgent,
      notesSummary: lead.notesSummary ?? "",
      nextFollowUpAt: toDatetimeLocal(lead.nextFollowUpAt),
    });
  }, [lead, reset]);

  const updateLead = useMutation({
    mutationFn: (data: UpdateLeadInput) =>
      fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead updated");
      router.push(`/leads/${id}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update lead: ${err.message}`);
    },
  });

  const selectedServices = watch("serviceCategoryIds") || [];

  function toggleService(serviceId: string) {
    const next = selectedServices.includes(serviceId)
      ? selectedServices.filter((s) => s !== serviceId)
      : [...selectedServices, serviceId];
    setValue("serviceCategoryIds", next, { shouldDirty: true });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading lead...</p>
      </div>
    );
  }

  if (!lead || lead.error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground">Lead not found</p>
        <Button variant="outline" onClick={() => router.push("/leads")}>
          Back to Leads
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`Edit ${lead.fullName}`}
        description="Update lead information"
        actions={
          <Button variant="outline" onClick={() => router.push(`/leads/${id}`)}>
            Cancel
          </Button>
        }
      />

      <form
        onSubmit={handleSubmit((data) => updateLead.mutate(data))}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input id="firstName" {...register("firstName")} />
              {errors.firstName && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.firstName.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName">Last Name *</Label>
              <Input id="lastName" {...register("lastName")} />
              {errors.lastName && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.lastName.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="primaryPhone">Primary Phone *</Label>
              <Input id="primaryPhone" {...register("primaryPhone")} />
              {errors.primaryPhone && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.primaryPhone.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="secondaryPhone">Secondary Phone</Label>
              <Input id="secondaryPhone" {...register("secondaryPhone")} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.email.message}
                </p>
              )}
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
            <AddressAutofillFields
              register={register}
              setValue={setValue}
              errors={errors}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Source</Label>
              <Select
                value={watch("sourceId") ?? ""}
                onValueChange={(v: string | null) =>
                  setValue("sourceId", v ?? undefined, { shouldDirty: true })
                }
              >
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
              <Select
                value={watch("assignedUserId") ?? ""}
                onValueChange={(v: string | null) =>
                  setValue("assignedUserId", v ?? undefined, {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select rep" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    ?.filter(
                      (u: { role: { name: string }; isActive: boolean }) =>
                        u.isActive &&
                        ["SALES_REP", "MANAGER"].includes(u.role.name)
                    )
                    .map(
                      (u: {
                        id: string;
                        firstName: string;
                        lastName: string;
                      }) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                        </SelectItem>
                      )
                    )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Property Type</Label>
              <Select
                value={watch("propertyType") ?? "RESIDENTIAL"}
                onValueChange={(v: string | null) =>
                  setValue(
                    "propertyType",
                    (v ?? "RESIDENTIAL") as "RESIDENTIAL" | "COMMERCIAL",
                    { shouldDirty: true }
                  )
                }
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
                (parent: {
                  id: string;
                  name: string;
                  children?: { id: string; name: string }[];
                }) => (
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
                      <div
                        key={child.id}
                        className="ml-6 flex items-center gap-2"
                      >
                        <Checkbox
                          id={child.id}
                          checked={selectedServices.includes(child.id)}
                          onCheckedChange={() => toggleService(child.id)}
                        />
                        <Label
                          htmlFor={child.id}
                          className="text-sm font-normal"
                        >
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
                  checked={!!watch("insuranceClaim")}
                  onCheckedChange={(c: boolean) =>
                    setValue("insuranceClaim", c, { shouldDirty: true })
                  }
                />
                <Label htmlFor="insuranceClaim">Insurance Claim</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="financingNeeded"
                  checked={!!watch("financingNeeded")}
                  onCheckedChange={(c: boolean) =>
                    setValue("financingNeeded", c, { shouldDirty: true })
                  }
                />
                <Label htmlFor="financingNeeded">Financing Needed</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="urgent"
                  checked={!!watch("urgent")}
                  onCheckedChange={(c: boolean) =>
                    setValue("urgent", c, { shouldDirty: true })
                  }
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
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push(`/leads/${id}`)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!isDirty || updateLead.isPending}>
            {updateLead.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
