"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { StageBadge } from "@/components/shared/stage-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  User,
  Calendar,
  AlertTriangle,
  Clock,
  FileText,
  MessageSquare,
  ShieldCheck,
  StickyNote,
} from "lucide-react";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [noteContent, setNoteContent] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetch(`/api/leads/${id}`).then((r) => r.json()),
  });

  const { data: stages } = useQuery({
    queryKey: ["stages"],
    queryFn: () => fetch("/api/admin/stages").then((r) => r.json()),
  });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });

  const changeStage = useMutation({
    mutationFn: (stageId: string) =>
      fetch(`/api/leads/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast.success("Stage updated");
    },
  });

  const assignLead = useMutation({
    mutationFn: (assignedUserId: string) =>
      fetch(`/api/leads/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast.success("Lead reassigned");
    },
  });

  const addNote = useMutation({
    mutationFn: (content: string) =>
      fetch(`/api/leads/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      setNoteContent("");
      toast.success("Note added");
    },
  });

  const createTask = useMutation({
    mutationFn: (data: { title: string; dueAt?: string; leadId: string }) =>
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      setNewTaskTitle("");
      setNewTaskDue("");
      toast.success("Task created");
    },
  });

  const completeTask = useMutation({
    mutationFn: (taskId: string) =>
      fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
    },
  });

  const logComm = useMutation({
    mutationFn: (data: { communicationType: string; body: string }) =>
      fetch(`/api/leads/${id}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      toast.success("Communication logged");
    },
  });

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

  const isOverdue =
    lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < new Date();

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/leads")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Leads
        </Button>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{lead.fullName}</h1>
            <StageBadge stage={lead.currentStage.name} />
            {lead.urgent && (
              <Badge variant="destructive">URGENT</Badge>
            )}
            {lead.isDuplicateFlag && (
              <Badge variant="destructive" className="text-xs">DUPLICATE</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Created {format(new Date(lead.createdAt), "MMM d, yyyy 'at' h:mm a")}
            {lead.createdBy && ` by ${lead.createdBy.firstName} ${lead.createdBy.lastName}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={lead.currentStage.id}
            onValueChange={(v: string | null) => v && changeStage.mutate(v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
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
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: contact and property info */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{lead.primaryPhone}</span>
              </div>
              {lead.secondaryPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.secondaryPhone}</span>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.email}</span>
                </div>
              )}
              {lead.companyName && (
                <div className="text-muted-foreground">
                  Company: {lead.companyName}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Property</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div>{lead.propertyAddress1}</div>
                  {lead.propertyAddress2 && <div>{lead.propertyAddress2}</div>}
                  <div>
                    {lead.city}, {lead.state} {lead.zipCode}
                  </div>
                  {lead.county && <div className="text-muted-foreground">{lead.county} County</div>}
                </div>
              </div>
              <div className="text-muted-foreground capitalize">
                {lead.propertyType?.toLowerCase()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>
                  {lead.assignedUser
                    ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
                    : "Unassigned"}
                </span>
              </div>
              <Select
                value={lead.assignedUser?.id || ""}
                onValueChange={(v: string | null) => v && assignLead.mutate(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Reassign..." />
                </SelectTrigger>
                <SelectContent>
                  {users
                    ?.filter((u: { isActive: boolean }) => u.isActive)
                    .map((u: { id: string; firstName: string; lastName: string }) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Source:</span>{" "}
                {lead.source?.name || "—"}
                {lead.sourceDetail && ` (${lead.sourceDetail})`}
              </div>
              {lead.estimatedJobValue && (
                <div>
                  <span className="text-muted-foreground">Est. Value:</span>{" "}
                  ${Number(lead.estimatedJobValue).toLocaleString()}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {lead.services?.map(
                  (s: { serviceCategory: { id: string; name: string } }) => (
                    <Badge key={s.serviceCategory.id} variant="outline">
                      {s.serviceCategory.name}
                    </Badge>
                  )
                )}
              </div>
              <Separator />
              <div className="flex flex-wrap gap-3">
                {lead.insuranceClaim && <Badge>Insurance Claim</Badge>}
                {lead.financingNeeded && <Badge variant="secondary">Financing</Badge>}
              </div>
              <div className={`flex items-center gap-2 ${isOverdue ? "text-red-600 font-medium" : ""}`}>
                <Calendar className="h-4 w-4" />
                Next Follow-Up:{" "}
                {lead.nextFollowUpAt
                  ? format(new Date(lead.nextFollowUpAt), "MMM d, yyyy h:mm a")
                  : "Not set"}
                {isOverdue && <AlertTriangle className="h-4 w-4" />}
              </div>
              {lead.lastContactAt && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Last contact: {formatDistanceToNow(new Date(lead.lastContactAt))} ago
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({lead.tasks?.length || 0})</TabsTrigger>
              <TabsTrigger value="comms">Communications</TabsTrigger>
              <TabsTrigger value="permits">Permits</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="history">Stage History</TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Add a note..."
                      value={noteContent}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNoteContent(e.target.value)}
                      rows={2}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={!noteContent.trim() || addNote.isPending}
                      onClick={() => addNote.mutate(noteContent)}
                    >
                      Add Note
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {lead.activityLogs?.map(
                  (activity: {
                    id: string;
                    activityType: string;
                    title: string;
                    description: string | null;
                    createdAt: string;
                    createdBy: { firstName: string; lastName: string } | null;
                  }) => (
                    <Card key={activity.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <ActivityIcon type={activity.activityType} />
                            <div>
                              <p className="text-sm font-medium">{activity.title}</p>
                              {activity.description && (
                                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                                  {activity.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground text-right shrink-0 ml-4">
                            <div>{format(new Date(activity.createdAt), "MMM d, h:mm a")}</div>
                            {activity.createdBy && (
                              <div>
                                {activity.createdBy.firstName} {activity.createdBy.lastName}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
                {!lead.activityLogs?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No activity yet
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="tasks" className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="New task..."
                      value={newTaskTitle}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTaskTitle(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="date"
                      value={newTaskDue}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTaskDue(e.target.value)}
                      className="w-[160px]"
                    />
                    <Button
                      size="sm"
                      disabled={!newTaskTitle.trim() || createTask.isPending}
                      onClick={() =>
                        createTask.mutate({
                          title: newTaskTitle,
                          leadId: id,
                          dueAt: newTaskDue || undefined,
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {lead.tasks?.map(
                  (task: {
                    id: string;
                    title: string;
                    status: string;
                    priority: string;
                    dueAt: string | null;
                    assignedTo: { firstName: string; lastName: string } | null;
                  }) => {
                    const taskOverdue =
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
                              <div className="flex gap-2 mt-0.5">
                                <Badge
                                  variant={task.priority === "URGENT" ? "destructive" : "outline"}
                                  className="text-[10px] px-1 py-0"
                                >
                                  {task.priority}
                                </Badge>
                                {task.dueAt && (
                                  <span
                                    className={`text-xs ${taskOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                                  >
                                    Due {format(new Date(task.dueAt), "MMM d")}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {task.assignedTo && (
                            <span className="text-xs text-muted-foreground">
                              {task.assignedTo.firstName} {task.assignedTo.lastName}
                            </span>
                          )}
                        </CardContent>
                      </Card>
                    );
                  }
                )}
                {!lead.tasks?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No tasks yet
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="comms" className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <CommLogForm onSubmit={(data) => logComm.mutate(data)} loading={logComm.isPending} />
                </CardContent>
              </Card>

              <div className="space-y-2">
                {lead.communications?.map(
                  (comm: {
                    id: string;
                    communicationType: string;
                    direction: string;
                    body: string;
                    createdAt: string;
                  }) => (
                    <Card key={comm.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex justify-between">
                          <div className="flex items-start gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {comm.communicationType} {comm.direction}
                            </Badge>
                            <p className="text-sm">{comm.body}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 ml-4">
                            {format(new Date(comm.createdAt), "MMM d, h:mm a")}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
                {!lead.communications?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No communications logged
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="permits" className="space-y-4">
              <div className="space-y-2">
                {lead.permits?.map(
                  (permit: {
                    id: string;
                    permitNumber: string | null;
                    permitType: string | null;
                    permitStatus: string;
                    municipality: string;
                    issueDate: string | null;
                    permitDescription: string | null;
                  }) => (
                    <Card key={permit.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex justify-between">
                          <div>
                            <p className="text-sm font-medium">
                              {permit.permitNumber || "No number"} — {permit.permitType || "Unknown type"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {permit.municipality} | Status: {permit.permitStatus}
                            </p>
                            {permit.permitDescription && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {permit.permitDescription}
                              </p>
                            )}
                          </div>
                          {permit.issueDate && (
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(permit.issueDate), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
                {!lead.permits?.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No permits on record
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="files">
              <p className="py-8 text-center text-sm text-muted-foreground">
                File uploads coming soon
              </p>
            </TabsContent>

            <TabsContent value="history" className="space-y-2">
              {lead.stageHistory?.map(
                (h: {
                  id: string;
                  fromStage: { name: string } | null;
                  toStage: { name: string };
                  changedBy: { firstName: string; lastName: string };
                  changedAt: string;
                  reason: string | null;
                }) => (
                  <Card key={h.id}>
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-2 text-sm">
                        {h.fromStage ? (
                          <>
                            <StageBadge stage={h.fromStage.name} />
                            <span className="text-muted-foreground">&rarr;</span>
                          </>
                        ) : null}
                        <StageBadge stage={h.toStage.name} />
                        {h.reason && (
                          <span className="text-muted-foreground ml-2">— {h.reason}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        <div>{format(new Date(h.changedAt), "MMM d, h:mm a")}</div>
                        <div>
                          {h.changedBy.firstName} {h.changedBy.lastName}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}
              {!lead.stageHistory?.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No stage history
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const iconClass = "h-4 w-4 mt-0.5 text-muted-foreground";
  switch (type) {
    case "NOTE":
      return <StickyNote className={iconClass} />;
    case "STAGE_CHANGE":
      return <FileText className={iconClass} />;
    case "CALL_LOGGED":
      return <Phone className={iconClass} />;
    case "SMS_LOGGED":
      return <MessageSquare className={iconClass} />;
    case "PERMIT_ADDED":
      return <ShieldCheck className={iconClass} />;
    default:
      return <Clock className={iconClass} />;
  }
}

function CommLogForm({
  onSubmit,
  loading,
}: {
  onSubmit: (data: { communicationType: string; body: string }) => void;
  loading: boolean;
}) {
  const [type, setType] = useState("CALL");
  const [body, setBody] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select value={type} onValueChange={(v: string | null) => setType(v ?? "CALL")}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CALL">Call</SelectItem>
            <SelectItem value="SMS">SMS</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Log communication..."
          value={body}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBody(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={!body.trim() || loading}
          onClick={() => {
            onSubmit({ communicationType: type, body });
            setBody("");
          }}
        >
          Log
        </Button>
      </div>
    </div>
  );
}
