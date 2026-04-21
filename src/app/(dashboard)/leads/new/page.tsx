"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { CreateLeadInput } from "@/lib/validators/lead";
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
import { UserCheck, X } from "lucide-react";

type ContactMatch = {
  firstName: string;
  lastName: string;
  email: string | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  companyName: string | null;
  leadCount: number;
  latestLeadId: string;
};

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
  const phoneInput = watch("primaryPhone") || "";
  const emailInput = watch("email") || "";

  const [matches, setMatches] = useState<ContactMatch[]>([]);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);

  useEffect(() => {
    const phoneDigits = phoneInput.replace(/\D/g, "");
    const phoneReady = phoneDigits.length >= 10;
    const emailReady = emailInput.includes("@") && emailInput.includes(".");
    if (!phoneReady && !emailReady) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (phoneReady) params.set("phone", phoneInput);
      if (emailReady) params.set("email", emailInput);
      fetch(`/api/leads/contact-lookup?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : { matches: [] }))
        .then((d) => setMatches(d.matches || []))
        .catch(() => {});
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [phoneInput, emailInput]);

  const matchKey = (m: ContactMatch) =>
    `${m.primaryPhone}|${m.email ?? ""}|${m.firstName} ${m.lastName}`;

  const visibleMatches = matches.filter(
    (m) => matchKey(m) !== dismissedKey && matchKey(m) !== appliedKey,
  );

  function applyContact(m: ContactMatch) {
    setValue("firstName", m.firstName);
    setValue("lastName", m.lastName);
    setValue("primaryPhone", m.primaryPhone);
    if (m.secondaryPhone) setValue("secondaryPhone", m.secondaryPhone);
    if (m.email) setValue("email", m.email);
    if (m.companyName) setValue("companyName", m.companyName);
    setAppliedKey(matchKey(m));
    toast.success(`Contact filled from ${m.leadCount} prior lead${m.leadCount === 1 ? "" : "s"}`);
  }

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
          <CardContent className="space-y-4">
            {visibleMatches.length > 0 && (
              <div className="space-y-2">
                {visibleMatches.map((m) => {
                  const key = matchKey(m);
                  return (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"
                    >
                      <div className="flex items-start gap-2">
                        <UserCheck className="mt-0.5 h-4 w-4 text-blue-700" />
                        <div>
                          <div className="font-medium text-blue-900">
                            Existing contact: {m.firstName} {m.lastName}
                          </div>
                          <div className="text-xs text-blue-800">
                            {m.primaryPhone}
                            {m.email ? ` · ${m.email}` : ""}
                            {m.companyName ? ` · ${m.companyName}` : ""}
                          </div>
                          <div className="text-xs text-blue-700">
                            {m.leadCount} prior lead{m.leadCount === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => applyContact(m)}
                        >
                          Use this contact
                        </Button>
                        <button
                          type="button"
                          className="rounded p-1 text-blue-700 hover:bg-blue-100"
                          onClick={() => setDismissedKey(key)}
                          aria-label="Dismiss"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
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
