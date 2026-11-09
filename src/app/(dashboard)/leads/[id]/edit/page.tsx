"use client";

import { useEffect } from "react";
import { ListSkeleton } from "@/components/shared/list-skeleton";
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
import { fetchJson } from "@/lib/fetch-json";
import { Field } from "@/components/ui/field";

function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


const PROPERTY_TYPE_ITEMS = { RESIDENTIAL: "Residential", COMMERCIAL: "Commercial" };
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
    queryFn: () => fetchJson(`/api/leads/${id}`),
  });

  const { data: sources } = useQuery({
    queryKey: ["sources"],
    queryFn: () => fetchJson("/api/admin/sources"),
  });

  const { data: services } = useQuery({
    queryKey: ["services"],
    queryFn: () => fetchJson("/api/admin/services"),
  });

  const { data: users } = useQuery({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
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
      fetchJson(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
        <ListSkeleton rows={4} className="w-full max-w-2xl" />
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
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="First Name" id="firstName" required error={errors.firstName?.message}>
              <Input id="firstName" {...register("firstName")} />
            </Field>
            <Field label="Last Name" id="lastName" required error={errors.lastName?.message}>
              <Input id="lastName" {...register("lastName")} />
            </Field>
            <Field label="Primary Phone" id="primaryPhone" required error={errors.primaryPhone?.message}>
              <Input id="primaryPhone" {...register("primaryPhone")} />
            </Field>
            <Field label="Secondary Phone" id="secondaryPhone">
              <Input id="secondaryPhone" {...register("secondaryPhone")} />
            </Field>
            <Field label="Email" id="email" error={errors.email?.message}>
              <Input id="email" type="email" {...register("email")} />
            </Field>
            <Field label="Company Name" id="companyName">
              <Input id="companyName" {...register("companyName")} />
            </Field>
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
            <Field label="Source">
              <Select
                items={(sources ?? []).map((s: { id: string; name: string }) => ({ value: s.id, label: s.name }))}
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
            </Field>
            <Field label="Source Detail / Campaign" id="sourceDetail">
              <Input id="sourceDetail" {...register("sourceDetail")} />
            </Field>
            <Field label="Assign To">
              <Select
                items={(users ?? []).map((u: { id: string; firstName: string; lastName: string }) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))}
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
                        ["ADMIN", "MANAGER", "SALES_REP"].includes(u.role.name)
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
            </Field>
            <Field label="Property Type">
              <Select
                items={PROPERTY_TYPE_ITEMS}
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
            </Field>
            <Field label="Estimated Job Value ($)" id="estimatedJobValue">
              <Input
                id="estimatedJobValue"
                type="number"
                {...register("estimatedJobValue", { valueAsNumber: true })}
              />
            </Field>
            <Field label="Next Follow-Up" id="nextFollowUpAt">
              <Input
                id="nextFollowUpAt"
                type="datetime-local"
                {...register("nextFollowUpAt")}
              />
            </Field>
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
            <Field label="Notes" id="notesSummary">
              <Textarea
                id="notesSummary"
                {...register("notesSummary")}
                rows={3}
              />
            </Field>
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
