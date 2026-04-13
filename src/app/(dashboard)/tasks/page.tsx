"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("mine");

  const params = new URLSearchParams();
  if (tab === "overdue") params.set("overdue", "true");

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", tab],
    queryFn: () => fetch(`/api/tasks?${params.toString()}`).then((r) => r.json()),
  });

  const completeTask = useMutation({
    mutationFn: (taskId: string) =>
      fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task completed");
    },
  });

  const filteredTasks =
    tab === "completed"
      ? (tasks || []).filter((t: { status: string }) => t.status === "COMPLETED")
      : tab === "overdue"
        ? tasks || []
        : (tasks || []).filter((t: { status: string }) => t.status !== "COMPLETED");

  return (
    <div>
      <PageHeader title="Tasks" description="Manage your tasks and follow-ups" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mine">My Tasks</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>

        {["mine", "overdue", "completed"].map((t) => (
          <TabsContent key={t} value={t} className="space-y-2 mt-4">
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
            ) : filteredTasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No tasks</p>
            ) : (
              filteredTasks.map(
                (task: {
                  id: string;
                  title: string;
                  status: string;
                  priority: string;
                  dueAt: string | null;
                  lead: { id: string; fullName: string } | null;
                  assignedTo: { firstName: string; lastName: string } | null;
                }) => {
                  const isOverdue =
                    task.dueAt &&
                    new Date(task.dueAt) < new Date() &&
                    task.status !== "COMPLETED";

                  return (
                    <Card key={task.id}>
                      <CardContent className="flex items-center justify-between py-3 px-4">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={task.status === "COMPLETED"}
                            onChange={() => {
                              if (task.status !== "COMPLETED") {
                                completeTask.mutate(task.id);
                              }
                            }}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <div>
                            <p
                              className={`text-sm ${task.status === "COMPLETED" ? "line-through text-muted-foreground" : ""}`}
                            >
                              {task.title}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge
                                variant={task.priority === "URGENT" ? "destructive" : "outline"}
                                className="text-[10px] px-1 py-0"
                              >
                                {task.priority}
                              </Badge>
                              {task.dueAt && (
                                <span
                                  className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                                >
                                  Due {format(new Date(task.dueAt), "MMM d, yyyy")}
                                </span>
                              )}
                              {task.lead && (
                                <Link
                                  href={`/leads/${task.lead.id}`}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  {task.lead.fullName}
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {task.assignedTo && (
                            <span className="text-xs text-muted-foreground">
                              {task.assignedTo.firstName} {task.assignedTo.lastName}
                            </span>
                          )}
                          {task.status !== "COMPLETED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => completeTask.mutate(task.id)}
                            >
                              Complete
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                }
              )
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
