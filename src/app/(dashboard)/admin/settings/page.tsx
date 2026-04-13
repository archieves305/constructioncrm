"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();

  // Sources
  const { data: sources } = useQuery({
    queryKey: ["sources"],
    queryFn: () => fetch("/api/admin/sources").then((r) => r.json()),
  });

  const [newSource, setNewSource] = useState("");
  const [newSourceChannel, setNewSourceChannel] = useState("OTHER");

  const addSource = useMutation({
    mutationFn: () =>
      fetch("/api/admin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSource, channelType: newSourceChannel }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      setNewSource("");
      toast.success("Source added");
    },
  });

  // Services
  const { data: services } = useQuery({
    queryKey: ["services"],
    queryFn: () => fetch("/api/admin/services").then((r) => r.json()),
  });

  const [newService, setNewService] = useState("");

  const addService = useMutation({
    mutationFn: () =>
      fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newService }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setNewService("");
      toast.success("Service added");
    },
  });

  // Stages
  const { data: stages } = useQuery({
    queryKey: ["stages"],
    queryFn: () => fetch("/api/admin/stages").then((r) => r.json()),
  });

  return (
    <div>
      <PageHeader title="Settings" description="Configure CRM lookup values" />

      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">Lead Sources</TabsTrigger>
          <TabsTrigger value="services">Service Categories</TabsTrigger>
          <TabsTrigger value="stages">Lead Stages</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lead Sources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input
                  placeholder="New source name..."
                  value={newSource}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewSource(e.target.value)}
                  className="max-w-sm"
                />
                <Select value={newSourceChannel} onValueChange={(v: string | null) => setNewSourceChannel(v ?? "OTHER")}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAID">Paid</SelectItem>
                    <SelectItem value="ORGANIC">Organic</SelectItem>
                    <SelectItem value="REFERRAL">Referral</SelectItem>
                    <SelectItem value="DIRECT">Direct</SelectItem>
                    <SelectItem value="SOCIAL">Social</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  disabled={!newSource.trim() || addSource.isPending}
                  onClick={() => addSource.mutate()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>

              <div className="space-y-2">
                {sources?.map(
                  (source: {
                    id: string;
                    name: string;
                    channelType: string;
                    children?: { id: string; name: string }[];
                  }) => (
                    <div key={source.id} className="flex items-center gap-2 py-1">
                      <span className="text-sm">{source.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {source.channelType}
                      </Badge>
                      {source.children?.map((c) => (
                        <Badge key={c.id} variant="secondary" className="text-[10px]">
                          {c.name}
                        </Badge>
                      ))}
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Service Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input
                  placeholder="New service category..."
                  value={newService}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewService(e.target.value)}
                  className="max-w-sm"
                />
                <Button
                  disabled={!newService.trim() || addService.isPending}
                  onClick={() => addService.mutate()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>

              <div className="space-y-3">
                {services?.map(
                  (service: {
                    id: string;
                    name: string;
                    children?: { id: string; name: string }[];
                  }) => (
                    <div key={service.id}>
                      <p className="text-sm font-medium">{service.name}</p>
                      {service.children && service.children.length > 0 && (
                        <div className="ml-4 mt-1 flex flex-wrap gap-1">
                          {service.children.map((c) => (
                            <Badge key={c.id} variant="outline" className="text-xs">
                              {c.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stages" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lead Stages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stages?.map(
                  (stage: {
                    id: string;
                    name: string;
                    stageOrder: number;
                    isClosed: boolean;
                    isWon: boolean;
                    isLost: boolean;
                  }) => (
                    <div key={stage.id} className="flex items-center gap-2 py-1">
                      <span className="w-6 text-xs text-muted-foreground text-right">
                        {stage.stageOrder}
                      </span>
                      <span className="text-sm">{stage.name}</span>
                      {stage.isWon && <Badge className="bg-green-100 text-green-800 text-[10px]">Won</Badge>}
                      {stage.isLost && <Badge className="bg-red-100 text-red-800 text-[10px]">Lost</Badge>}
                      {stage.isClosed && !stage.isWon && !stage.isLost && (
                        <Badge variant="secondary" className="text-[10px]">Closed</Badge>
                      )}
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
