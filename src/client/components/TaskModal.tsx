import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Send,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  FocusArea,
  Priority,
  Task,
  TaskCreateInput,
  TaskExecution,
  TaskExecutionArtifact,
  TaskStatus,
} from "../../shared/types";
import { COLUMN_LABELS, PRIORITIES, TASK_STATUSES } from "../../shared/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { getFocusAreaStyle } from "../focus-areas";
import { MarkdownMessage } from "./MarkdownMessage";

const NO_FOCUS_AREA = "__none";

export function TaskModal(props: {
  task: Task;
  title: string;
  focusAreas: FocusArea[];
  onClose: () => void;
  onDelete?: () => Promise<void>;
  onAskFollowUp?: (prompt: string) => Promise<void>;
  onSave: (input: TaskCreateInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.task.title);
  const [description, setDescription] = useState(props.task.description);
  const [status, setStatus] = useState<TaskStatus>(props.task.status);
  const [priority, setPriority] = useState<Priority>(props.task.priority);
  const [focusAreaId, setFocusAreaId] = useState(props.task.focusAreaId ?? NO_FOCUS_AREA);
  const [saving, setSaving] = useState(false);
  const [titleTouched, setTitleTouched] = useState(Boolean(props.task.title));
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const finished =
    props.task.status === "done" || props.task.execution?.status === "succeeded";
  const canSave = useMemo(() => title.trim().length > 0, [title]);
  const showTitleError = !canSave && (titleTouched || attemptedSave);

  async function submit() {
    setAttemptedSave(true);
    if (!canSave) return;
    setSaving(true);
    try {
      await props.onSave({
        title,
        description,
        status,
        priority,
        focusAreaId: focusAreaId === NO_FOCUS_AREA ? null : focusAreaId,
        tags: [],
      });
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete() {
    if (!props.onDelete) {
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setSaving(true);
    try {
      await props.onDelete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{finished ? props.task.title || props.title : props.title}</DialogTitle>
          <DialogDescription>
            {finished
              ? "Completed result."
              : "Capture the work and focus area. If AI works on it, progress and follow-ups stay attached to the task."}
          </DialogDescription>
        </DialogHeader>

        {finished ? (
          <>
            <FinishedTaskContent task={props.task} onAskFollowUp={props.onAskFollowUp} />
            <DialogFooter>
              <Button variant="outline" onClick={props.onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="task-title">Title</FieldLabel>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={() => setTitleTouched(true)}
                  autoFocus
                  placeholder="Give this task a clear name"
                  aria-invalid={showTitleError}
                />
                {showTitleError && <FieldDescription>Title is required.</FieldDescription>}
              </Field>

              <Field>
                <FieldLabel htmlFor="task-notes">Notes</FieldLabel>
                <Textarea
                  id="task-notes"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="min-h-24 sm:min-h-28"
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-3">
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
                    <SelectTrigger className="w-full" aria-label="Status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {TASK_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {COLUMN_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Priority</FieldLabel>
                  <Select
                    value={priority}
                    onValueChange={(value) => setPriority(value as Priority)}
                  >
                    <SelectTrigger className="w-full" aria-label="Priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PRIORITIES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Focus area</FieldLabel>
                  <Select value={focusAreaId} onValueChange={setFocusAreaId}>
                    <SelectTrigger className="w-full" aria-label="Focus area">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={NO_FOCUS_AREA}>No focus area</SelectItem>
                        {props.focusAreas.map((area) => (
                          <SelectItem key={area.id} value={area.id}>
                            <FocusAreaOption area={area} />
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>

            {props.task.execution && (
              <TaskExecutionPanel
                execution={props.task.execution}
                onAskFollowUp={props.onAskFollowUp}
              />
            )}

            <DialogFooter>
              {props.onDelete && (
                <Button variant="destructive" onClick={requestDelete} disabled={saving}>
                  <Trash2 data-icon="inline-start" />
                  {confirmingDelete ? "Confirm delete" : "Delete"}
                </Button>
              )}
              <Button variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button disabled={!canSave || saving} onClick={submit}>
                {saving ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : null}
                {saving ? "Saving..." : "Save task"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FinishedTaskContent(props: {
  task: Task;
  onAskFollowUp?: (prompt: string) => Promise<void>;
}) {
  if (props.task.execution) {
    return (
      <TaskExecutionPanel
        execution={props.task.execution}
        onAskFollowUp={props.onAskFollowUp}
        mode="finished"
      />
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>Task complete</span>
          <Badge variant="secondary">
            <CheckCircle2 data-icon="inline-start" />
            Done
          </Badge>
        </CardTitle>
        <CardDescription>{props.task.description || "This task is complete."}</CardDescription>
      </CardHeader>
      <CardContent>
        <Item variant="muted">
          <ItemMedia variant="icon">
            <CheckCircle2 />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Completed</ItemTitle>
            <p className="text-sm text-muted-foreground">
              {props.task.description || "No notes saved."}
            </p>
          </ItemContent>
        </Item>
      </CardContent>
    </Card>
  );
}

function FocusAreaOption(props: { area: FocusArea }) {
  const style = getFocusAreaStyle(props.area.color);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.accent }}
      />
      <span className="truncate">{props.area.label}</span>
    </span>
  );
}

function TaskExecutionPanel(props: {
  execution: TaskExecution;
  onAskFollowUp?: (prompt: string) => Promise<void>;
  mode?: "active" | "finished";
}) {
  const [followUp, setFollowUp] = useState("");
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = props.mode === "finished";
  const running =
    !finished && (props.execution.status === "queued" || props.execution.status === "running");

  async function askFollowUp() {
    const prompt = followUp.trim();
    if (!prompt || !props.onAskFollowUp) {
      return;
    }
    setAsking(true);
    setNotice(null);
    setError(null);
    try {
      await props.onAskFollowUp(prompt);
      setFollowUp("");
      setNotice(
        finished
          ? "Follow-up sent."
          : running
            ? "Follow-up sent. Progress will update here."
            : "Follow-up work started.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{finished ? "Task chat" : "AI work"}</span>
          <Badge variant={props.execution.status === "failed" ? "destructive" : "secondary"}>
            {executionStatusIcon(props.execution)}
            {formatExecutionStatus(props.execution)}
          </Badge>
        </CardTitle>
        <CardDescription>{formatExecutionWindow(props.execution)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!finished && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Current step</span>
              <span className="text-right font-medium">
                {formatExecutionMessage(props.execution.progressSummary)}
              </span>
            </div>
            <Progress value={executionProgress(props.execution)} />
          </div>
        )}

        {props.execution.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{props.execution.error}</AlertDescription>
          </Alert>
        )}

        {props.execution.output && (
          <Item variant="muted">
            <ItemMedia variant="icon">
              {finished ? <MessageSquareText /> : <CheckCircle2 />}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{finished ? "Assistant" : "Result"}</ItemTitle>
              <MarkdownMessage>{props.execution.output}</MarkdownMessage>
            </ItemContent>
          </Item>
        )}

        {props.execution.artifacts.length > 0 && (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Artifacts</h3>
              <ItemGroup>
                {props.execution.artifacts.map((artifact) => (
                  <ArtifactRow artifact={artifact} key={artifact.id} />
                ))}
              </ItemGroup>
            </section>
          </>
        )}

        {props.execution.events.length > 0 && (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{finished ? "Work log" : "Progress"}</h3>
              <ScrollArea className="max-h-72 pr-3">
                <ItemGroup>
                  {props.execution.events.map((event) => (
                    <Item variant="outline" size="sm" key={event.id}>
                      <ItemMedia variant="icon">
                        {executionEventIcon(event.kind)}
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{formatEventTime(event.createdAt)}</ItemTitle>
                        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {formatExecutionMessage(event.message)}
                        </p>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </ScrollArea>
            </section>
          </>
        )}

        {props.onAskFollowUp && (
          <>
            <Separator />
            <FieldGroup>
              {(notice || error) && (
                <Alert variant={error ? "destructive" : "default"}>
                  <MessageSquareText />
                  <AlertDescription>{error ?? notice}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="task-follow-up">
                  {running ? "Ask while it works" : "Ask a follow-up"}
                </FieldLabel>
                <Textarea
                  id="task-follow-up"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  placeholder={
                    running
                      ? "Add context, ask a question, or request a change."
                      : "Ask another question or request a change."
                  }
                  className="min-h-24"
                />
                {!finished && (
                  <FieldDescription>
                    The new request stays attached to this task and appears in the progress log.
                  </FieldDescription>
                )}
              </Field>
              <Button
                className="w-full sm:w-fit"
                onClick={askFollowUp}
                disabled={asking || !followUp.trim()}
              >
                {asking ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                {asking ? "Sending..." : "Send follow-up"}
              </Button>
            </FieldGroup>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactRow(props: { artifact: TaskExecutionArtifact }) {
  const icon =
    props.artifact.type === "link" ? (
      <Link2 />
    ) : props.artifact.type === "evidence" ? (
      <CheckCircle2 />
    ) : (
      <FileText />
    );
  const content = (
    <>
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{props.artifact.title}</ItemTitle>
        {props.artifact.content && (
          <p className="text-sm text-muted-foreground">{props.artifact.content}</p>
        )}
      </ItemContent>
      {props.artifact.url && (
        <ItemActions>
          <ExternalLink />
        </ItemActions>
      )}
    </>
  );

  return props.artifact.url ? (
    <Item asChild variant="outline" size="sm">
      <a href={props.artifact.url} target="_blank" rel="noreferrer">
        {content}
      </a>
    </Item>
  ) : (
    <Item variant="outline" size="sm">
      {content}
    </Item>
  );
}

function executionStatusIcon(execution: TaskExecution) {
  if (execution.status === "succeeded") {
    return <CheckCircle2 data-icon="inline-start" />;
  }
  if (execution.status === "failed") {
    return <AlertTriangle data-icon="inline-start" />;
  }
  if (execution.status === "queued") {
    return <Clock3 data-icon="inline-start" />;
  }
  return <LoaderCircle className="animate-spin" data-icon="inline-start" />;
}

function executionEventIcon(kind: TaskExecution["events"][number]["kind"]) {
  if (kind === "succeeded") {
    return <CheckCircle2 />;
  }
  if (kind === "failed") {
    return <AlertTriangle />;
  }
  if (kind === "queued") {
    return <Clock3 />;
  }
  return <MessageSquareText />;
}

function executionProgress(execution: TaskExecution) {
  if (execution.status === "succeeded") return 100;
  if (execution.status === "failed") return 100;
  if (execution.status === "running") return 58;
  return 18;
}

function formatExecutionStatus(execution: TaskExecution) {
  if (execution.status === "succeeded") {
    return "Done";
  }
  if (execution.status === "failed") {
    return "Needs attention";
  }
  if (execution.status === "queued") {
    return "Queued";
  }
  return "Running";
}

function formatExecutionWindow(execution: TaskExecution) {
  if (execution.status === "queued") {
    return "Queued to start";
  }
  if (execution.status === "running") {
    return `Working for ${formatDuration(execution.startedAt)}`;
  }
  if (execution.endedAt) {
    return `Finished ${formatEventTime(execution.endedAt)}`;
  }
  return "Finished recently";
}

function formatDuration(startedAt: string | null) {
  const started = startedAt ? new Date(startedAt).getTime() : NaN;
  if (!Number.isFinite(started)) {
    return "a moment";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function formatExecutionMessage(message: string) {
  return message
    .replace("Agent execution queued.", "Request queued.")
    .replace("Follow-up execution queued.", "Follow-up queued.")
    .replace("Agent run queued.", "Request queued.")
    .replace("Agent run started.", "Work started.")
    .replace("Agent is preparing context.", "Preparing the folder and task details.")
    .replace(/^Agent model round \d+\.$/, "Thinking through the next step.")
    .replace("Agent execution completed.", "Work completed.")
    .replace("Agent execution blocked.", "Work needs setup before it can continue.")
    .replace("Agent execution failed.", "Work needs attention.");
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
