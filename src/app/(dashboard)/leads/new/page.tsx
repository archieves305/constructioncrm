"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createLeadSchema, type CreateLeadInput } from "@/lib/validators/lead";
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
import { Lock, UserCheck, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { useSession } from "@/lib/auth/session-client";
import { canWriteLeads } from "@/lib/access/roles";
import { EmptyState } from "@/components/shared/empty-state";
import { Field } from "@/components/ui/field";

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


const PROPERTY_TYPE_ITEMS = { RESIDENTIAL: "Residential", COMMERCIAL: "Commercial" };
export default function NewLeadPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const returnTo = useSearchParams().get("returnTo");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateLeadInput>({
    // The server's own schema, so a missing field is shown before any request is made.
    resolver: zodResolver(createLeadSchema) as Resolver<CreateLeadInput>,
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

  const createLead = useMutation({
    mutationFn: (data: CreateLeadInput) =>
      fetchJson<{ lead: { id: string }; duplicates?: unknown[] }>("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (result) => {
      if (result.duplicates?.length) {
        toast.warning(
          `Possible duplicate detected! ${result.duplicates.length} similar lead(s) found.`
        );
      } else {
        toast.success("Lead created successfully");
      }
      // A "create the property first" round trip (code-violation intake):
      // go back where we came from with the new lead's id.
      if (returnTo && returnTo.startsWith("/")) {
        const sep = returnTo.includes("?") ? "&" : "?";
        router.push(`${returnTo}${sep}createdLeadId=${result.lead.id}`);
        return;
      }
      router.push(`/leads/${result.lead.id}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to create lead: ${err.message}`);
    },
  });

  // Base UI shows the selected value itself unless it is given the labels.
  const sourceItems = (sources ?? []).map((s: { id: string; name: string }) => ({ value: s.id, label: s.name }));
  const repOptions: { id: string; firstName: string; lastName: string }[] = (users ?? []).filter(
    (u: { role: { name: string }; isActive: boolean }) => u.isActive && ["ADMIN", "MANAGER", "SALES_REP"].includes(u.role.name),
  );
  const repItems = repOptions.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }));

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

  if (session && !canWriteLeads(session.user.role)) {
    return (
      <EmptyState
        icon={Lock}
        title="You don't have access to this"
        description="Your role can look at leads but not add them. Ask an office manager if you need to."
        action={<Button variant="outline" size="sm" onClick={() => router.push("/leads")}>Back to leads</Button>}
      />
    );
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
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {visibleMatches.length > 0 && (
              <div className="space-y-2">
                {visibleMatches.map((m) => {
                  const key = matchKey(m);
                  return (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-3 rounded-md border border-tone-info-line bg-tone-info-soft p-3 text-sm"
                    >
                      <div className="flex items-start gap-2">
                        <UserCheck className="mt-0.5 h-4 w-4 text-tone-info-fg" />
                        <div>
                          <div className="font-medium text-tone-info-fg">
                            Existing contact: {m.firstName} {m.lastName}
                          </div>
                          <div className="text-xs text-tone-info-fg">
                            {m.primaryPhone}
                            {m.email ? ` · ${m.email}` : ""}
                            {m.companyName ? ` · ${m.companyName}` : ""}
                          </div>
                          <div className="text-xs text-tone-info-fg">
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
                          className="rounded p-1 text-tone-info-fg hover:bg-tone-info-soft"
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
            <Field label="Source">
              <Select items={sourceItems} onValueChange={(v: string | null) => setValue("sourceId", v ?? undefined)}>
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
              <Select items={repItems} onValueChange={(v: string | null) => setValue("assignedUserId", v ?? undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select rep" />
                </SelectTrigger>
                <SelectContent>
                  {repOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Property Type">
              <Select
                items={PROPERTY_TYPE_ITEMS}
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
            </Field>
            <Field label="Estimated Job Value ($)" id="estimatedJobValue">
              <Input
                id="estimatedJobValue"
                type="number"
                {...register("estimatedJobValue", { setValueAs: (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v)) })}
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
            <Field label="Notes" id="notesSummary">
              <Textarea
                id="notesSummary"
                {...register("notesSummary")}
                rows={3}
                placeholder="Initial notes about this lead..."
              />
            </Field>
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
