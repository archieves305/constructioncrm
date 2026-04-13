"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

export default function PipelinePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: stages } = useQuery({
    queryKey: ["stages"],
    queryFn: () => fetch("/api/admin/stages").then((r) => r.json()),
  });

  const { data: leadsData } = useQuery({
    queryKey: ["leads", "all-pipeline"],
    queryFn: () => fetch("/api/leads?pageSize=500").then((r) => r.json()),
  });

  const changeStage = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) =>
      fetch(`/api/leads/${leadId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead moved");
    },
  });

  const leads = leadsData?.data || [];

  const stageColumns = (stages || [])
    .filter((s: { isClosed: boolean }) => !s.isClosed)
    .sort((a: { stageOrder: number }, b: { stageOrder: number }) => a.stageOrder - b.stageOrder);

  return (
    <div>
      <PageHeader title="Pipeline" description="Visual pipeline view" />

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stageColumns.map((stage: { id: string; name: string }) => {
          const stageLeads = leads.filter(
            (l: { currentStageId: string }) => l.currentStageId === stage.id
          );

          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-[280px] rounded-lg border bg-gray-50"
            >
              <div className="flex items-center justify-between border-b bg-white px-3 py-2 rounded-t-lg">
                <span className="text-sm font-medium">{stage.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {stageLeads.length}
                </Badge>
              </div>

              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-2 p-2">
                  {stageLeads.map(
                    (lead: {
                      id: string;
                      fullName: string;
                      primaryPhone: string;
                      source: { name: string } | null;
                      services: { serviceCategory: { name: string } }[];
                      assignedUser: { firstName: string; lastName: string } | null;
                      currentStageId: string;
                      urgent: boolean;
                    }) => (
                      <Card
                        key={lead.id}
                        className="cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => router.push(`/leads/${lead.id}`)}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <p className="text-sm font-medium leading-tight">
                              {lead.fullName}
                            </p>
                            {lead.urgent && (
                              <Badge variant="destructive" className="text-[10px] px-1 py-0 ml-1">
                                !
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {lead.primaryPhone}
                          </p>
                          {lead.services?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {lead.services.slice(0, 2).map(
                                (s: { serviceCategory: { name: string } }, i: number) => (
                                  <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">
                                    {s.serviceCategory.name}
                                  </Badge>
                                )
                              )}
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground">
                              {lead.assignedUser
                                ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName[0]}.`
                                : "Unassigned"}
                            </span>
                            <Select
                              value={lead.currentStageId}
                              onValueChange={(v: string | null) => {
                                v && changeStage.mutate({ leadId: lead.id, stageId: v });
                              }}
                            >
                              <SelectTrigger className="h-6 w-6 p-0 border-0 [&>svg]:h-3 [&>svg]:w-3">
                                <span className="sr-only">Move</span>
                              </SelectTrigger>
                              <SelectContent>
                                {stages?.map((s: { id: string; name: string }) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  )}
                  {stageLeads.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No leads
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}
