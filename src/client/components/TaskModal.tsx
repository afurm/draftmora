import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Info,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getFocusAreaStyle } from "../focus-areas";
import { MarkdownMessage } from "./MarkdownMessage";

const NO_FOCUS_AREA = "__none";
const NEXT_ACTION_CONTEXT_RESULT_LIMIT = 5;
const NEXT_ACTION_CONTEXT_OUTPUT_LIMIT = 2_500;

type PendingFollowUp = {
  id: string;
  prompt: string;
  content: string;
  createdAt: string;
  status: "sending" | "failed";
};

type TaskThreadMessage =
  | {
      type: "user_request";
      id: string;
      content: string;
      createdAt: string;
      label: string;
      pending?: PendingFollowUp["status"];
      prompt?: string;
    }
  | { type: "agent_result"; id: string; execution: TaskExecution; runIndex: number }
  | { type: "next_action"; id: string; execution: TaskExecution; content: string }
  | { type: "artifact_group"; id: string; execution: TaskExecution };

type InspectorTab = "details" | "context" | "runs" | "artifacts";

const INSPECTOR_TABS: Array<{
  value: InspectorTab;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "details", label: "Details", icon: Info },
  { value: "context", label: "Context", icon: MessageSquareText },
  { value: "runs", label: "Runs", icon: Clock3 },
  { value: "artifacts", label: "Files", icon: FileText },
];

export function TaskModal(props: {
  task: Task;
  title: string;
  focusAreas: FocusArea[];
  onClose: () => void;
  onDelete?: () => Promise<void>;
  onAskFollowUp?: (prompt: string) => Promise<void>;
  onCreateDraft?: (input: TaskCreateInput) => Promise<void>;
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

  useEffect(() => {
    setTitle(props.task.title);
    setDescription(props.task.description);
    setStatus(props.task.status);
    setPriority(props.task.priority);
    setFocusAreaId(props.task.focusAreaId ?? NO_FOCUS_AREA);
    setTitleTouched(Boolean(props.task.title));
    setAttemptedSave(false);
  }, [props.task.id]);

  const isCreateFlow = !props.task.id;
  const activeExecution = isTaskExecutionActive(props.task.execution);
  const detailsLocked = !isCreateFlow && Boolean(props.task.execution);
  const canSave = useMemo(
    () => title.trim().length > 0 && !detailsLocked,
    [detailsLocked, title],
  );
  const showTitleError = !detailsLocked && !canSave && (titleTouched || attemptedSave);

  async function submit() {
    setAttemptedSave(true);
    if (detailsLocked) return;
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

  if (isCreateFlow) {
    return (
      <CreateTaskDialog
        title={props.title}
        taskTitle={title}
        description={description}
        status={status}
        priority={priority}
        focusAreaId={focusAreaId}
        focusAreas={props.focusAreas}
        saving={saving}
        canSave={canSave}
        showTitleError={showTitleError}
        onClose={props.onClose}
        onSubmit={submit}
        onTitleChange={setTitle}
        onDescriptionChange={setDescription}
        onStatusChange={setStatus}
        onPriorityChange={setPriority}
        onFocusAreaChange={setFocusAreaId}
        onTitleTouched={() => setTitleTouched(true)}
      />
    );
  }

  return (
    <TaskDetailWorkspace
      task={props.task}
      title={props.title}
      taskTitle={title}
      description={description}
      status={status}
      priority={priority}
      focusAreaId={focusAreaId}
      focusAreas={props.focusAreas}
      saving={saving}
      canSave={canSave}
      showTitleError={showTitleError}
      detailsLocked={detailsLocked}
      statusDisabled={activeExecution}
      onClose={props.onClose}
      onDelete={props.onDelete}
      onSubmit={submit}
      onTitleChange={setTitle}
      onDescriptionChange={setDescription}
      onStatusChange={setStatus}
      onPriorityChange={setPriority}
      onFocusAreaChange={setFocusAreaId}
      onTitleTouched={() => setTitleTouched(true)}
      onAskFollowUp={props.onAskFollowUp}
      onCreateDraft={props.onCreateDraft}
    />
  );
}

function CreateTaskDialog(props: {
  title: string;
  taskTitle: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  focusAreaId: string;
  focusAreas: FocusArea[];
  saving: boolean;
  canSave: boolean;
  showTitleError: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: TaskStatus) => void;
  onPriorityChange: (value: Priority) => void;
  onFocusAreaChange: (value: string) => void;
  onTitleTouched: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>
            Capture the work and focus area. If AI works on it, progress and follow-ups stay attached to the task.
          </DialogDescription>
        </DialogHeader>

        <TaskDetailsFields
          idPrefix="task-create"
          taskTitle={props.taskTitle}
          description={props.description}
          status={props.status}
          priority={props.priority}
          focusAreaId={props.focusAreaId}
          focusAreas={props.focusAreas}
          showTitleError={props.showTitleError}
          autoFocus
          onTitleChange={props.onTitleChange}
          onDescriptionChange={props.onDescriptionChange}
          onStatusChange={props.onStatusChange}
          onPriorityChange={props.onPriorityChange}
          onFocusAreaChange={props.onFocusAreaChange}
          onTitleTouched={props.onTitleTouched}
        />

        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!props.canSave || props.saving} onClick={props.onSubmit}>
            {props.saving ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            {props.saving ? "Saving..." : "Save task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailWorkspace(props: {
  task: Task;
  title: string;
  taskTitle: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  focusAreaId: string;
  focusAreas: FocusArea[];
  saving: boolean;
  canSave: boolean;
  showTitleError: boolean;
  detailsLocked: boolean;
  statusDisabled: boolean;
  onClose: () => void;
  onDelete?: () => Promise<void>;
  onSubmit: () => Promise<void>;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: TaskStatus) => void;
  onPriorityChange: (value: Priority) => void;
  onFocusAreaChange: (value: string) => void;
  onTitleTouched: () => void;
  onAskFollowUp?: (prompt: string) => Promise<void>;
  onCreateDraft?: (input: TaskCreateInput) => Promise<void>;
}) {
  const [followUp, setFollowUp] = useState("");
  const [asking, setAsking] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [nextActionConsumed, setNextActionConsumed] = useState(false);
  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => Boolean(props.task.execution));
  const latestExecution = props.task.execution;
  const running = isTaskExecutionActive(latestExecution);
  const nextAction = useMemo(
    () => (latestExecution ? extractExecutionNextAction(latestExecution) : null),
    [latestExecution],
  );

  useEffect(() => {
    setNextActionConsumed(false);
  }, [nextAction]);

  useEffect(() => {
    setFollowUp("");
    setPendingFollowUps([]);
    setNotice(null);
    setError(null);
    setDeleteDialogOpen(false);
    setDeleteError(null);
    setInspectorCollapsed(Boolean(props.task.execution));
  }, [props.task.id]);

  async function confirmDelete() {
    if (!props.onDelete) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await props.onDelete();
      setDeleteDialogOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  async function askFollowUp(
    promptOverride?: string,
    displayOverride?: string,
    pendingId?: string,
  ) {
    const prompt = (promptOverride ?? followUp).trim();
    if (!prompt || !props.onAskFollowUp) {
      return;
    }
    const id = pendingId ?? `pending-${Date.now()}`;
    const content = displayOverride ?? prompt;
    setAsking(true);
    setNotice(null);
    setError(null);
    setPendingFollowUps((current) =>
      pendingId
        ? current.map((entry) => (entry.id === pendingId ? { ...entry, status: "sending" } : entry))
        : [
            ...current,
            {
              id,
              prompt,
              content,
              createdAt: new Date().toISOString(),
              status: "sending",
            },
          ],
    );
    try {
      await props.onAskFollowUp(prompt);
      setPendingFollowUps((current) => current.filter((entry) => entry.id !== id));
      if (!promptOverride) {
        setFollowUp("");
      }
      if (promptOverride) {
        setNextActionConsumed(true);
      }
      setNotice(
        running
          ? "Follow-up queued. It will start after the current work finishes."
          : "Follow-up queued.",
      );
    } catch (err) {
      setPendingFollowUps((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, status: "failed" } : entry)),
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  }

  async function retryPendingFollowUp(entry: PendingFollowUp) {
    await askFollowUp(entry.prompt, entry.content, entry.id);
  }

  async function runNextActionAsFollowUp() {
    if (!nextAction) {
      return;
    }
    await askFollowUp(
      formatNextActionFollowUpPrompt(props.task, latestExecution!, nextAction),
      `Run next action: ${nextAction}`,
    );
  }

  async function createDraftFromNextAction() {
    if (!nextAction || !latestExecution || !props.onCreateDraft) {
      return;
    }
    setCreatingDraft(true);
    setNotice(null);
    setError(null);
    try {
      await props.onCreateDraft({
        title: formatNextActionTaskTitle(nextAction),
        description: formatNextActionTaskDescription(props.task, latestExecution, nextAction),
        status: "draft",
        priority: props.task.priority,
        focusAreaId: props.task.focusAreaId,
        tags: [],
        providerSource: "local",
      });
      setNextActionConsumed(true);
      setNotice("Draft task created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingDraft(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="h-dvh gap-0 p-0 data-[side=right]:w-screen data-[side=right]:max-w-none data-[side=right]:sm:w-[min(100vw,72rem)] data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="shrink-0 border-b p-0">
          <div className="flex min-w-0 items-start gap-3 p-3 sm:p-4">
            <SheetClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close task">
                <X data-icon="icon" />
              </Button>
            </SheetClose>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <SheetTitle className="sr-only">{props.title}</SheetTitle>
              <SheetDescription className="sr-only">{formatTaskSurfaceState(props.task)}</SheetDescription>
              <Input
                id="task-title-inline"
                value={props.taskTitle}
                onChange={(event) => props.onTitleChange(event.target.value)}
                onBlur={props.onTitleTouched}
                placeholder="Give this task a clear name"
                aria-invalid={props.showTitleError}
                readOnly={props.detailsLocked}
                aria-readonly={props.detailsLocked}
                className="h-9 border-transparent bg-transparent px-0 text-base font-medium shadow-none focus-visible:border-input focus-visible:px-2 sm:text-lg"
              />
              <div className="flex flex-wrap items-center gap-2">
                <TaskStateBadge task={props.task} />
                {latestExecution?.model && <Badge variant="outline">{latestExecution.model}</Badge>}
                <span className="text-sm text-muted-foreground">
                  Last activity {formatEventTime(latestExecution?.updatedAt ?? props.task.updatedAt)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!props.detailsLocked && (
                <Button
                  size="sm"
                  onClick={props.onSubmit}
                  disabled={!props.canSave || props.saving}
                >
                  {props.saving ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : null}
                  {props.saving ? (
                    "Saving..."
                  ) : (
                    <>
                      <span className="sm:hidden">Save</span>
                      <span className="hidden sm:inline">Save details</span>
                    </>
                  )}
                </Button>
              )}
              {props.onDelete && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Task actions">
                      <MoreHorizontal data-icon="icon" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(event) => {
                        event.preventDefault();
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {running && latestExecution && (
            <div className="border-t px-3 py-2 sm:px-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Current step</span>
                <span className="text-right font-medium">
                  {formatExecutionMessage(latestExecution.progressSummary)}
                </span>
              </div>
              <Progress className="mt-2" value={executionProgress(latestExecution)} />
            </div>
          )}
        </SheetHeader>

        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-1",
            inspectorCollapsed
              ? "lg:grid-cols-[minmax(0,1fr)_3.5rem]"
              : "lg:grid-cols-[minmax(0,1fr)_24rem]",
          )}
        >
          <TaskConversation
            task={props.task}
            pendingFollowUps={pendingFollowUps}
            notice={notice}
            error={error}
            followUp={followUp}
            asking={asking}
            wide={inspectorCollapsed}
            nextActionConsumed={nextActionConsumed}
            creatingDraft={creatingDraft}
            onFollowUpChange={setFollowUp}
            onAskFollowUp={() => void askFollowUp()}
            onRetryPendingFollowUp={(entry) => void retryPendingFollowUp(entry)}
            onRunNextAction={nextAction && props.onAskFollowUp ? () => void runNextActionAsFollowUp() : undefined}
            onCreateDraft={nextAction && props.onCreateDraft ? () => void createDraftFromNextAction() : undefined}
          />
          <TaskInspector
            task={props.task}
            taskTitle={props.taskTitle}
            description={props.description}
            status={props.status}
            priority={props.priority}
            focusAreaId={props.focusAreaId}
            focusAreas={props.focusAreas}
            saving={props.saving}
            canSave={props.canSave}
            showTitleError={props.showTitleError}
            deleting={deleting}
            detailsLocked={props.detailsLocked}
            collapsed={inspectorCollapsed}
            statusDisabled={props.statusDisabled}
            onCollapsedChange={setInspectorCollapsed}
            onSubmit={props.onSubmit}
            onDeleteRequest={props.onDelete ? () => setDeleteDialogOpen(true) : undefined}
            onTitleChange={props.onTitleChange}
            onDescriptionChange={props.onDescriptionChange}
            onStatusChange={props.onStatusChange}
            onPriorityChange={props.onPriorityChange}
            onFocusAreaChange={props.onFocusAreaChange}
            onTitleTouched={props.onTitleTouched}
          />
        </div>
        {props.onDelete && (
          <TaskDeleteDialog
            open={deleteDialogOpen}
            taskTitle={props.task.title}
            deleting={deleting}
            error={deleteError}
            onOpenChange={(open) => {
              setDeleteDialogOpen(open);
              if (open) {
                setDeleteError(null);
              }
            }}
            onConfirm={() => void confirmDelete()}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskDeleteDialog(props: {
  open: boolean;
  taskTitle: string;
  deleting: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes "{props.taskTitle || "Untitled task"}" and its saved agent
            history from the local board.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {props.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={props.deleting}
            onClick={(event) => {
              event.preventDefault();
              props.onConfirm();
            }}
          >
            {props.deleting ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            {props.deleting ? "Deleting..." : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TaskDetailsFields(props: {
  idPrefix: string;
  taskTitle: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  focusAreaId: string;
  focusAreas: FocusArea[];
  showTitleError: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  stackedControls?: boolean;
  statusDisabled?: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: TaskStatus) => void;
  onPriorityChange: (value: Priority) => void;
  onFocusAreaChange: (value: string) => void;
  onTitleTouched: () => void;
}) {
  return (
    <FieldGroup>
      <Field data-invalid={props.showTitleError} data-disabled={props.disabled}>
        <FieldLabel htmlFor={`${props.idPrefix}-title`}>Title</FieldLabel>
        <Input
          id={`${props.idPrefix}-title`}
          value={props.taskTitle}
          onChange={(event) => props.onTitleChange(event.target.value)}
          onBlur={props.onTitleTouched}
          autoFocus={props.autoFocus}
          placeholder="Give this task a clear name"
          aria-invalid={props.showTitleError}
          disabled={props.disabled}
        />
        {props.showTitleError && <FieldDescription>Title is required.</FieldDescription>}
      </Field>

      <Field data-disabled={props.disabled}>
        <FieldLabel htmlFor={`${props.idPrefix}-notes`}>Notes</FieldLabel>
        <Textarea
          id={`${props.idPrefix}-notes`}
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          className="min-h-28"
          disabled={props.disabled}
        />
      </Field>

      <FieldGroup className={props.stackedControls ? "grid gap-4" : "grid gap-4 md:grid-cols-3"}>
        <Field data-disabled={props.disabled || props.statusDisabled}>
          <FieldLabel>Status</FieldLabel>
          {props.disabled ? (
            <Input aria-label="Status" value={COLUMN_LABELS[props.status]} readOnly disabled />
          ) : (
            <Select
              value={props.status}
              onValueChange={(value) => props.onStatusChange(value as TaskStatus)}
              disabled={props.statusDisabled}
            >
              <SelectTrigger
                className="w-full"
                aria-label="Status"
                disabled={props.statusDisabled}
              >
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
          )}
          {!props.disabled && props.statusDisabled && (
            <FieldDescription>Status is locked while work is active.</FieldDescription>
          )}
        </Field>

        <Field data-disabled={props.disabled}>
          <FieldLabel>Priority</FieldLabel>
          {props.disabled ? (
            <Input aria-label="Priority" value={props.priority} readOnly disabled />
          ) : (
            <Select
              value={props.priority}
              onValueChange={(value) => props.onPriorityChange(value as Priority)}
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
          )}
        </Field>

        <Field data-disabled={props.disabled}>
          <FieldLabel>Focus area</FieldLabel>
          {props.disabled ? (
            <Input
              aria-label="Focus area"
              value={formatFocusAreaLabel(props.focusAreaId, props.focusAreas)}
              readOnly
              disabled
            />
          ) : (
            <Select value={props.focusAreaId} onValueChange={props.onFocusAreaChange}>
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
          )}
        </Field>
      </FieldGroup>
    </FieldGroup>
  );
}

function TaskConversation(props: {
  task: Task;
  pendingFollowUps: PendingFollowUp[];
  notice: string | null;
  error: string | null;
  followUp: string;
  asking: boolean;
  wide: boolean;
  nextActionConsumed: boolean;
  creatingDraft: boolean;
  onFollowUpChange: (value: string) => void;
  onAskFollowUp: () => void;
  onRetryPendingFollowUp: (entry: PendingFollowUp) => void;
  onRunNextAction?: () => void;
  onCreateDraft?: () => void;
}) {
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scrollIntoView = threadEndRef.current?.scrollIntoView;
      if (typeof scrollIntoView === "function") {
        scrollIntoView.call(threadEndRef.current, { block: "end" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    props.task.id,
    props.task.execution?.id,
    props.task.execution?.updatedAt,
    props.pendingFollowUps.length,
  ]);

  return (
    <section className="flex min-h-0 flex-col" aria-label="Task conversation">
      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-4 p-4 sm:p-5",
            props.wide ? "max-w-5xl" : "max-w-3xl",
          )}
        >
          <TaskThread
            task={props.task}
            pendingFollowUps={props.pendingFollowUps}
            nextActionConsumed={props.nextActionConsumed}
            creatingDraft={props.creatingDraft}
            onRetryPendingFollowUp={props.onRetryPendingFollowUp}
            onRunNextAction={props.onRunNextAction}
            onCreateDraft={props.onCreateDraft}
          />
          <div ref={threadEndRef} aria-hidden="true" />
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t bg-background p-3 sm:p-4">
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-3",
            props.wide ? "max-w-5xl" : "max-w-3xl",
          )}
        >
          {(props.notice || props.error) && (
            <Alert variant={props.error ? "destructive" : "default"}>
              <MessageSquareText />
              <AlertDescription>{props.error ?? props.notice}</AlertDescription>
            </Alert>
          )}
          <TaskThreadComposer
            task={props.task}
            followUp={props.followUp}
            asking={props.asking}
            onFollowUpChange={props.onFollowUpChange}
            onAskFollowUp={props.onAskFollowUp}
          />
        </div>
      </div>
    </section>
  );
}

function TaskThread(props: {
  task: Task;
  pendingFollowUps: PendingFollowUp[];
  nextActionConsumed: boolean;
  creatingDraft: boolean;
  onRetryPendingFollowUp: (entry: PendingFollowUp) => void;
  onRunNextAction?: () => void;
  onCreateDraft?: () => void;
}) {
  const messages = useMemo(
    () => buildTaskThreadMessages(props.task, props.pendingFollowUps),
    [props.task, props.pendingFollowUps],
  );
  const hasExecutions = Boolean(props.task.execution);

  return (
    <ItemGroup>
      {messages.map((message) => (
        <TaskThreadMessageRow
          key={message.id}
          message={message}
          nextActionConsumed={props.nextActionConsumed}
          creatingDraft={props.creatingDraft}
          onRetryPendingFollowUp={props.onRetryPendingFollowUp}
          onRunNextAction={props.onRunNextAction}
          onCreateDraft={props.onCreateDraft}
        />
      ))}
      {!hasExecutions && (
        <Empty className="min-h-40 border">
          <EmptyMedia variant="icon">
            <MessageSquareText />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No agent run yet</EmptyTitle>
            <EmptyDescription>
              Ask the agent to work on this task from the reply box below.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </ItemGroup>
  );
}

function TaskThreadMessageRow(props: {
  message: TaskThreadMessage;
  nextActionConsumed: boolean;
  creatingDraft: boolean;
  onRetryPendingFollowUp: (entry: PendingFollowUp) => void;
  onRunNextAction?: () => void;
  onCreateDraft?: () => void;
}) {
  const message = props.message;
  if (message.type === "user_request") {
    return (
      <div className="flex justify-start">
        <Item
          variant={message.pending === "failed" ? "outline" : "muted"}
          className="items-start"
        >
          <ItemContent className="items-start text-left">
            <ItemTitle>
              <UserRound data-icon="inline-start" />
              {message.label}
              {message.pending && (
                <Badge variant={message.pending === "failed" ? "destructive" : "secondary"}>
                  {message.pending === "failed" ? "Not sent" : "Sending"}
                </Badge>
              )}
            </ItemTitle>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {message.content}
            </p>
            {message.pending === "failed" && message.prompt && (
              <ItemFooter className="justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    props.onRetryPendingFollowUp({
                      id: message.id,
                      prompt: message.prompt!,
                      content: message.content,
                      createdAt: message.createdAt,
                      status: "failed",
                    })
                  }
                >
                  <RotateCcw data-icon="inline-start" />
                  Retry
                </Button>
              </ItemFooter>
            )}
          </ItemContent>
        </Item>
      </div>
    );
  }

  if (message.type === "agent_result") {
    const output = displayExecutionOutput(message.execution).trim();
    return (
      <Item className="items-start px-0">
        <ItemMedia variant="icon">
          <Bot />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-2">
          <ItemTitle>Assistant</ItemTitle>
          {output ? (
            <MarkdownMessage>{output}</MarkdownMessage>
          ) : message.execution.error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{message.execution.error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isExecutionActive(message.execution) ? "No final result yet." : "No result saved."}
            </p>
          )}
        </ItemContent>
      </Item>
    );
  }

  if (message.type === "next_action") {
    return (
      <section className="flex min-w-0 flex-col gap-2" aria-label="Next action">
        <Item variant="outline" className="items-start">
          <ItemMedia variant="icon">
            <MessageSquareText />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemHeader>
              <ItemTitle>Next action</ItemTitle>
            </ItemHeader>
            <p className="break-words text-sm text-muted-foreground">{message.content}</p>
            {(props.onRunNextAction || props.onCreateDraft) && (
              <ItemFooter className="flex-wrap justify-start">
                {props.onRunNextAction && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={props.onRunNextAction}
                    disabled={props.nextActionConsumed}
                  >
                    <MessageSquareText data-icon="inline-start" />
                    Run as follow-up
                  </Button>
                )}
                {props.onCreateDraft && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={props.onCreateDraft}
                    disabled={props.creatingDraft || props.nextActionConsumed}
                  >
                    {props.creatingDraft ? (
                      <LoaderCircle className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <Plus data-icon="inline-start" />
                    )}
                    {props.creatingDraft ? "Creating..." : "Draft task"}
                  </Button>
                )}
              </ItemFooter>
            )}
          </ItemContent>
        </Item>
      </section>
    );
  }

  if (message.type !== "artifact_group") {
    return null;
  }

  return (
    <ItemGroup>
      {message.execution.artifacts.map((artifact) => (
        <ArtifactRow artifact={artifact} key={artifact.id} />
      ))}
    </ItemGroup>
  );
}

function TaskThreadComposer(props: {
  task: Task;
  followUp: string;
  asking: boolean;
  onFollowUpChange: (value: string) => void;
  onAskFollowUp: () => void;
}) {
  const running = isTaskExecutionActive(props.task.execution);
  return (
    <Field>
      <FieldLabel htmlFor="task-follow-up">Reply to task</FieldLabel>
      <InputGroup className="min-h-32">
        <InputGroupTextarea
          id="task-follow-up"
          value={props.followUp}
          onChange={(event) => props.onFollowUpChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              props.onAskFollowUp();
            }
          }}
          placeholder={composerPlaceholder(props.task)}
          className="min-h-24"
        />
        <InputGroupAddon align="block-end" className="justify-between border-t">
          <InputGroupText>
            {running ? <Clock3 /> : <MessageSquareText />}
            <span>{running ? "Queues behind current work" : "Attached to task"}</span>
          </InputGroupText>
          <InputGroupButton
            type="button"
            variant="default"
            onClick={props.onAskFollowUp}
            disabled={props.asking || !props.followUp.trim()}
          >
            {props.asking ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Send data-icon="inline-start" />
            )}
            {props.asking ? "Sending..." : "Send"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {running && <FieldDescription>This will queue behind the active run.</FieldDescription>}
    </Field>
  );
}

function TaskInspector(props: {
  task: Task;
  taskTitle: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  focusAreaId: string;
  focusAreas: FocusArea[];
  saving: boolean;
  canSave: boolean;
  showTitleError: boolean;
  deleting: boolean;
  detailsLocked: boolean;
  collapsed: boolean;
  statusDisabled: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSubmit: () => Promise<void>;
  onDeleteRequest?: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: TaskStatus) => void;
  onPriorityChange: (value: Priority) => void;
  onFocusAreaChange: (value: string) => void;
  onTitleTouched: () => void;
}) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("details");

  function openInspectorTab(tab: InspectorTab) {
    setActiveTab(tab);
    props.onCollapsedChange(false);
  }

  if (props.collapsed) {
    return (
      <aside
        aria-label="Task details"
        data-state="collapsed"
        className="min-h-0 border-t bg-muted/20 lg:border-l lg:border-t-0"
      >
        <TooltipProvider>
          <div className="flex items-center gap-1 p-2 lg:h-full lg:flex-col">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand task details"
                  aria-expanded={false}
                  onClick={() => props.onCollapsedChange(false)}
                >
                  <PanelRightOpen data-icon="icon" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Expand task details</TooltipContent>
            </Tooltip>
            <div className="flex min-w-0 flex-1 items-center gap-1 lg:flex-col lg:justify-start">
              {INSPECTOR_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Tooltip key={tab.value}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={activeTab === tab.value ? "secondary" : "ghost"}
                        size="icon-sm"
                        aria-label={`Open ${tab.label}`}
                        onClick={() => openInspectorTab(tab.value)}
                      >
                        <Icon data-icon="icon" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">{tab.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </TooltipProvider>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Task details"
      data-state="expanded"
      className="min-h-0 border-t bg-muted/20 lg:border-l lg:border-t-0"
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as InspectorTab)}
        className="h-full gap-0"
      >
        <div className="flex items-center gap-2 border-b p-3">
          <TabsList className="grid min-w-0 flex-1 grid-cols-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="artifacts">Files</TabsTrigger>
          </TabsList>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse task details"
            aria-expanded={true}
            onClick={() => props.onCollapsedChange(true)}
          >
            <PanelRightClose data-icon="icon" />
          </Button>
        </div>
        <ScrollArea className="h-[42dvh] lg:h-full">
          <div className="p-4">
            <TabsContent value="details">
              <div className="flex flex-col gap-5">
                <TaskDetailsFields
                  idPrefix="task-detail"
                  taskTitle={props.taskTitle}
                  description={props.description}
                  status={props.status}
                  priority={props.priority}
                  focusAreaId={props.focusAreaId}
                  focusAreas={props.focusAreas}
                  showTitleError={props.showTitleError}
                  disabled={props.detailsLocked}
                  stackedControls
                  statusDisabled={props.statusDisabled}
                  onTitleChange={props.onTitleChange}
                  onDescriptionChange={props.onDescriptionChange}
                  onStatusChange={props.onStatusChange}
                  onPriorityChange={props.onPriorityChange}
                  onFocusAreaChange={props.onFocusAreaChange}
                  onTitleTouched={props.onTitleTouched}
                />
                {props.detailsLocked && (
                  <ItemGroup>
                    <Item variant="muted" size="sm">
                      <ItemMedia variant="icon">
                        <LockKeyhole />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>Details locked</ItemTitle>
                        <ItemDescription>Use the reply box for follow-ups.</ItemDescription>
                      </ItemContent>
                    </Item>
                  </ItemGroup>
                )}
                <ItemGroup>
                  <Item variant="muted" size="sm">
                    <ItemContent>
                      <ItemTitle>Created</ItemTitle>
                      <ItemDescription>{formatEventTime(props.task.createdAt)}</ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item variant="muted" size="sm">
                    <ItemContent>
                      <ItemTitle>Updated</ItemTitle>
                      <ItemDescription>{formatEventTime(props.task.updatedAt)}</ItemDescription>
                    </ItemContent>
                  </Item>
                </ItemGroup>
                <div className="flex flex-wrap gap-2">
                  {!props.detailsLocked && (
                    <Button
                      type="button"
                      onClick={props.onSubmit}
                      disabled={!props.canSave || props.saving}
                    >
                      {props.saving ? (
                        <LoaderCircle className="animate-spin" data-icon="inline-start" />
                      ) : null}
                      {props.saving ? "Saving..." : "Save details"}
                    </Button>
                  )}
                  {props.onDeleteRequest && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={props.onDeleteRequest}
                      disabled={props.saving || props.deleting}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="context">
              <TaskContextPanel task={props.task} />
            </TabsContent>
            <TabsContent value="runs">
              <TaskRunsPanel task={props.task} />
            </TabsContent>
            <TabsContent value="artifacts">
              <TaskArtifactsPanel task={props.task} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

function TaskContextPanel(props: { task: Task }) {
  const nextAction = getLatestTaskNextAction(props.task);
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Current notes</h3>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {props.task.description.trim() || "No notes saved."}
        </p>
      </section>
      {nextAction && (
        <>
          <Separator />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Latest next action</h3>
            <p className="break-words text-sm text-muted-foreground">{nextAction}</p>
          </section>
        </>
      )}
    </div>
  );
}

function TaskRunsPanel(props: { task: Task }) {
  const executions = getTaskExecutionHistory(props.task);
  const latestNeedsLogOpen = [...executions]
    .reverse()
    .find((execution) => execution.status === "running" || execution.status === "failed");
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(
    latestNeedsLogOpen?.id ?? null,
  );

  useEffect(() => {
    if (latestNeedsLogOpen) {
      setExpandedExecutionId(latestNeedsLogOpen.id);
    }
  }, [latestNeedsLogOpen?.id]);

  if (executions.length === 0) {
    return (
      <Empty className="min-h-40 border">
        <EmptyMedia variant="icon">
          <Clock3 />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No runs yet</EmptyTitle>
          <EmptyDescription>Task work will appear here after the first agent run.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ItemGroup>
      {executions.map((execution, index) => (
        <Item variant="outline" className="items-start" key={execution.id}>
          <ItemMedia variant="icon">{executionStatusIcon(execution)}</ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>
              Run {index + 1}: {formatExecutionStatus(execution)}
            </ItemTitle>
            <ItemDescription className="line-clamp-none">
              {formatExecutionWindow(execution)} · {formatProvider(execution.provider)}
              {execution.model ? ` · ${execution.model}` : ""}
            </ItemDescription>
            <ExecutionOutput
              execution={execution}
              expanded={expandedExecutionId === execution.id}
              onExpandedChange={(expanded) => setExpandedExecutionId(expanded ? execution.id : null)}
            />
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

function TaskArtifactsPanel(props: { task: Task }) {
  const artifacts = getTaskExecutionHistory(props.task).flatMap((execution) => execution.artifacts);
  if (artifacts.length === 0) {
    return (
      <Empty className="min-h-40 border">
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No artifacts</EmptyTitle>
          <EmptyDescription>Links and evidence from task runs will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ItemGroup>
      {artifacts.map((artifact) => (
        <ArtifactRow artifact={artifact} key={artifact.id} />
      ))}
    </ItemGroup>
  );
}

function TaskStateBadge(props: { task: Task }) {
  const execution = props.task.execution;
  if (execution?.status === "running" || execution?.status === "queued") {
    return (
      <Badge variant="secondary">
        {executionStatusIcon(execution)}
        {execution.status === "queued" ? "Queued" : "Running now"}
      </Badge>
    );
  }
  if (execution?.status === "failed" || props.task.status === "needs_attention") {
    return (
      <Badge variant="destructive">
        <AlertTriangle data-icon="inline-start" />
        Needs attention
      </Badge>
    );
  }
  if (execution?.status === "succeeded" || props.task.status === "done") {
    return (
      <Badge variant="secondary">
        <CheckCircle2 data-icon="inline-start" />
        Done
      </Badge>
    );
  }
  return <Badge variant="outline">{COLUMN_LABELS[props.task.status]}</Badge>;
}

function formatTaskSurfaceState(task: Task) {
  if (task.execution?.status === "running" || task.execution?.status === "queued") {
    return "Running now";
  }
  if (task.execution?.status === "failed" || task.status === "needs_attention") {
    return "Needs attention";
  }
  if (task.execution?.status === "succeeded" || task.status === "done") {
    return "Completed";
  }
  return "Task conversation";
}

function buildTaskThreadMessages(
  task: Task,
  pendingFollowUps: PendingFollowUp[],
): TaskThreadMessage[] {
  const messages: TaskThreadMessage[] = [];
  const originalRequest = formatInitialTaskRequest(task);
  if (originalRequest) {
    messages.push({
      type: "user_request",
      id: `${task.id}-initial-request`,
      content: originalRequest,
      createdAt: task.createdAt,
      label: "Original request",
    });
  }

  const executions = getTaskExecutionHistory(task);
  executions.forEach((execution, index) => {
    const isLatestExecution = execution === task.execution;
    const requestPrompt = displayExecutionRequestPrompt(execution);
    if (requestPrompt) {
      messages.push({
        type: "user_request",
        id: `${execution.id}-request`,
        content: requestPrompt,
        createdAt: execution.createdAt,
        label: execution.requestKind === "follow_up" ? "Follow-up" : "Request",
      });
    }
    if (execution.output.trim() || (isLatestExecution && isExecutionActive(execution)) || execution.error) {
      messages.push({
        type: "agent_result",
        id: `${execution.id}-result`,
        execution,
        runIndex: index,
      });
    }
    if (isLatestExecution) {
      const nextAction = extractExecutionNextAction(execution);
      if (nextAction) {
        messages.push({
          type: "next_action",
          id: `${execution.id}-next-action`,
          execution,
          content: nextAction,
        });
      }
    }
    if (execution.artifacts.length > 0) {
      messages.push({
        type: "artifact_group",
        id: `${execution.id}-artifacts`,
        execution,
      });
    }
  });

  pendingFollowUps.forEach((entry) => {
    messages.push({
      type: "user_request",
      id: entry.id,
      content: entry.content,
      createdAt: entry.createdAt,
      label: "Follow-up",
      pending: entry.status,
      prompt: entry.prompt,
    });
  });

  return messages;
}

function formatInitialTaskRequest(task: Task) {
  const title = task.title.trim();
  const notes = task.description.trim();
  if (!title && !notes) {
    return "";
  }
  return [title, notes].filter(Boolean).join("\n\n");
}

function displayExecutionRequestPrompt(execution: TaskExecution) {
  const prompt = execution.requestPrompt?.trim() ?? "";
  if (!prompt || execution.requestKind === "initial") {
    return "";
  }
  return normalizeDisplayedPrompt(prompt);
}

function displayExecutionOutput(execution: TaskExecution) {
  const withoutTechnicalLog = stripMarkdownSection(
    execution.output,
    /^#{2,6}\s+Recent agent log\s*$/i,
  );
  if (execution.status !== "failed") {
    return withoutTechnicalLog;
  }
  return stripMarkdownSection(
    withoutTechnicalLog,
    /^#{2,6}\s+Next assignee step\s*$/i,
  );
}

function stripMarkdownSection(output: string, headingPattern: RegExp) {
  const lines = output.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (headingIndex === -1) {
    return output;
  }
  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && /^#{2,6}\s+\S/.test(line.trim()),
  );
  const visibleLines =
    nextHeadingIndex === -1
      ? lines.slice(0, headingIndex)
      : [...lines.slice(0, headingIndex), ...lines.slice(nextHeadingIndex)];
  return visibleLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeDisplayedPrompt(prompt: string) {
  const nextActionMatch = prompt.match(/## Next action to complete\s+([\s\S]+)$/i);
  if (nextActionMatch?.[1]) {
    return `Run next action: ${normalizeNextActionLine(nextActionMatch[1]) ?? nextActionMatch[1].trim()}`;
  }
  return prompt;
}

function getTaskExecutionHistory(task: Task): TaskExecution[] {
  const previous = task.execution?.previousExecutions ?? [];
  return task.execution ? [...previous, task.execution] : previous;
}

function isTaskExecutionActive(execution: TaskExecution | null | undefined) {
  return execution ? isExecutionActive(execution) : false;
}

function isExecutionActive(execution: TaskExecution) {
  return execution.status === "queued" || execution.status === "running";
}

function composerPlaceholder(task: Task) {
  const execution = task.execution;
  if (execution?.status === "running" || execution?.status === "queued") {
    return "Add context or queue a follow-up...";
  }
  if (execution?.status === "failed" || task.status === "needs_attention") {
    return "Tell the agent how to recover...";
  }
  if (execution?.status === "succeeded" || task.status === "done") {
    return "Ask a follow-up or request a change...";
  }
  return "Ask the agent to work on this task...";
}

function formatFocusAreaLabel(focusAreaId: string, focusAreas: FocusArea[]) {
  if (focusAreaId === NO_FOCUS_AREA) {
    return "No focus area";
  }
  return focusAreas.find((area) => area.id === focusAreaId)?.label ?? "Unknown focus area";
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

function executionTerminalLines(execution: TaskExecution): string[] {
  const lines = execution.events.map(
    (event) => `[${formatEventTime(event.createdAt)}] ${formatExecutionMessage(event.message)}`,
  );
  if (execution.status === "queued") {
    lines.push("", "Waiting for the current task run to finish.");
  } else if (execution.status === "running") {
    lines.push("", "Waiting for assistant output...");
  }
  if (execution.error) {
    lines.push("", `error: ${execution.error}`);
  }
  return lines.length > 0 ? lines : ["No output yet."];
}

function extractExecutionNextAction(execution: TaskExecution) {
  return extractNextAction(execution.output);
}

function getLatestTaskNextAction(task: Task) {
  if (task.execution) {
    const executionNextAction = extractExecutionNextAction(task.execution);
    if (executionNextAction) {
      return executionNextAction;
    }
  }
  return extractNextAction(task.description);
}

function extractNextAction(output: string) {
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (isNextActionHeading(lines[index])) {
      const nextAction = firstNextActionLine(lines.slice(index + 1));
      if (nextAction) {
        return nextAction;
      }
    }
  }

  for (const line of lines) {
    const inlineMatch = line.match(
      /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:next actions?|next steps?|next assignee step|what(?:'s| is) next)\s*(?:\*\*)?\s*[:：-]\s*(.+)$/i,
    );
    if (inlineMatch?.[1]) {
      return normalizeNextActionLine(inlineMatch[1]);
    }
  }

  return null;
}

function isNextActionHeading(line: string) {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s*(?:next actions?|next steps?|next assignee step|what(?:'s| is) next)\b/i.test(
      trimmed,
    ) ||
    /^(?:[-*]\s*)?(?:\*\*)?\s*(?:next actions?|next steps?|next assignee step|what(?:'s| is) next)\s*(?:\*\*)?\s*[:：]?\s*$/i.test(
      trimmed,
    )
  );
}

function firstNextActionLine(lines: string[]) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      return null;
    }
    if (!trimmed || trimmed === "---" || trimmed.startsWith("```")) {
      continue;
    }
    return normalizeNextActionLine(trimmed);
  }
  return null;
}

function normalizeNextActionLine(line: string) {
  const normalized = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function formatNextActionFollowUpPrompt(
  task: Task,
  execution: TaskExecution,
  nextAction: string,
) {
  return [
    "Please continue with the next action below.",
    "Treat this as the full task context if no other state is available.",
    formatNextActionContext(task, execution, nextAction),
  ].join("\n\n");
}

function formatNextActionTaskTitle(nextAction: string) {
  if (nextAction.length <= 96) {
    return nextAction;
  }
  const shortened = nextAction.slice(0, 93).trimEnd();
  const lastSpace = shortened.lastIndexOf(" ");
  return `${lastSpace > 48 ? shortened.slice(0, lastSpace) : shortened}...`;
}

function formatNextActionTaskDescription(
  task: Task,
  execution: TaskExecution,
  nextAction: string,
) {
  return [
    "Drafted from an existing task result. This note includes the needed context so the task can stand alone.",
    formatNextActionContext(task, execution, nextAction),
  ].join("\n\n");
}

function formatNextActionContext(task: Task, execution: TaskExecution, nextAction: string) {
  const latestOutput = execution.output.trim();
  const previousResultLimit = latestOutput
    ? NEXT_ACTION_CONTEXT_RESULT_LIMIT - 1
    : NEXT_ACTION_CONTEXT_RESULT_LIMIT;
  const sections = [
    "## Source task",
    `Title: ${task.title || "Untitled task"}`,
    `Status: ${COLUMN_LABELS[task.status]}`,
    `Priority: ${task.priority}`,
    task.description.trim() ? `Notes:\n${task.description.trim()}` : "Notes: None saved.",
    latestOutput ? `## Latest result\n${truncateForTaskContext(latestOutput)}` : null,
    formatPreviousResultContext(execution.previousExecutions ?? [], previousResultLimit),
    `## Next action to complete\n${nextAction}`,
  ];
  return sections.filter(Boolean).join("\n\n");
}

function formatPreviousResultContext(executions: TaskExecution[], limit: number) {
  if (limit <= 0) {
    return null;
  }
  const previousResults = executions
    .filter((execution) => execution.output.trim())
    .slice(-Math.max(0, limit))
    .map(
      (execution, index) =>
        `### Previous result ${index + 1}\n${truncateForTaskContext(execution.output.trim())}`,
    );
  if (previousResults.length === 0) {
    return null;
  }
  return [
    "## Previous results",
    ...previousResults,
  ].join("\n\n");
}

function truncateForTaskContext(value: string) {
  if (value.length <= NEXT_ACTION_CONTEXT_OUTPUT_LIMIT) {
    return value;
  }
  return `${value.slice(0, NEXT_ACTION_CONTEXT_OUTPUT_LIMIT)}\n...[truncated]`;
}

function ExecutionOutput(props: {
  execution: TaskExecution;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const lineCount = executionTerminalLines(props.execution).length;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Technical details</h3>
          <p className="text-sm text-muted-foreground">{lineCount} log lines</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          <FileText data-icon="inline-start" />
          {props.expanded ? "Hide log" : "Show log"}
        </Button>
      </div>
      {props.expanded && (
        <ScrollArea className="max-h-48 max-w-full overflow-hidden rounded-lg border bg-muted">
          <pre className="min-h-24 max-w-full whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {executionTerminalLines(props.execution).join("\n")}
          </pre>
        </ScrollArea>
      )}
    </section>
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

function formatProvider(provider: TaskExecution["provider"]) {
  if (provider === "openai") {
    return "OpenAI";
  }
  return "Local";
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
