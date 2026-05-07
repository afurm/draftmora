import {
  AlertTriangle,
  Check,
  ClipboardList,
  Clock3,
  LoaderCircle,
  PencilLine,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FocusArea, Task, TaskStatus } from "../../shared/types";
import { COLUMN_LABELS, TASK_STATUSES } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";

export function BoardView(props: {
  tasks: Task[];
  focusAreas: FocusArea[];
  singleColumn?: TaskStatus;
  visibleStatuses?: TaskStatus[];
  onCreateTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
}) {
  const columns = useMemo<TaskStatus[]>(
    () =>
      props.singleColumn
        ? [props.singleColumn]
        : props.visibleStatuses && props.visibleStatuses.length > 0
          ? props.visibleStatuses
          : [...TASK_STATUSES],
    [props.singleColumn, props.visibleStatuses],
  );
  const focusAreaById = new Map(props.focusAreas.map((area) => [area.id, area]));
  const mobileTabListRef = useRef<HTMLDivElement | null>(null);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>(() =>
    pickBestMobileStatus(columns, props.tasks),
  );

  useEffect(() => {
    const bestStatus = pickBestMobileStatus(columns, props.tasks);
    const currentHasTasks = props.tasks.some((task) => task.status === mobileStatus);
    const bestHasTasks = props.tasks.some((task) => task.status === bestStatus);
    if (!columns.includes(mobileStatus) || (!currentHasTasks && bestHasTasks)) {
      setMobileStatus(bestStatus);
    }
  }, [columns, mobileStatus, props.tasks]);

  useEffect(() => {
    const activeTab = mobileTabListRef.current?.querySelector<HTMLElement>(
      `[data-board-mobile-status="${mobileStatus}"]`,
    );
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [mobileStatus]);

  return (
    <div className="min-w-0">
      {!props.singleColumn && columns.length > 1 && (
        <Tabs
          value={mobileStatus}
          onValueChange={(value) => setMobileStatus(value as TaskStatus)}
          className="lg:hidden"
        >
          <div ref={mobileTabListRef} className="overflow-x-auto">
            <TabsList
              className="min-w-max justify-start"
              aria-label="Board status"
            >
              {columns.map((status) => (
                <TabsTrigger key={status} value={status} data-board-mobile-status={status}>
                  {COLUMN_LABELS[status]}
                  <Badge variant="secondary">
                    {getTasksForStatus(props.tasks, status).length}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {columns.map((status) => (
            <TabsContent key={status} value={status} className="mt-2">
              <ColumnRail
                status={status}
                tasks={getTasksForStatus(props.tasks, status)}
                focusAreaById={focusAreaById}
                onCreateTask={props.onCreateTask}
                onEditTask={props.onEditTask}
                onMoveTask={props.onMoveTask}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      <section
        className={cn(
          "min-w-0",
          !props.singleColumn && columns.length > 1 && "hidden lg:block",
        )}
        aria-label="Kanban board"
      >
        <div className="overflow-x-auto pb-2">
          <div
            className={cn(
              "flex min-w-max gap-3",
              props.singleColumn && "min-w-0",
            )}
          >
            {columns.map((status) => {
              const tasks = getTasksForStatus(props.tasks, status);
              return (
                <ColumnRail
                  status={status}
                  tasks={tasks}
                  focusAreaById={focusAreaById}
                  key={status}
                  onCreateTask={props.onCreateTask}
                  onEditTask={props.onEditTask}
                  onMoveTask={props.onMoveTask}
                  className={props.singleColumn ? "w-full max-w-2xl" : undefined}
                />
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function ColumnRail(props: {
  status: TaskStatus;
  tasks: Task[];
  focusAreaById: Map<string, FocusArea>;
  className?: string;
  onCreateTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
}) {
  const [isDragTarget, setIsDragTarget] = useState(false);
  const isDone = props.status === "done";
  const needsAttention = props.status === "needs_attention" && props.tasks.length > 0;
  const [showAllDone, setShowAllDone] = useState(false);
  const visibleTasks = isDone && !showAllDone ? props.tasks.slice(0, 4) : props.tasks;
  const hiddenDoneCount = props.tasks.length - visibleTasks.length;

  return (
    <Card
      size="sm"
      className={cn(
        "min-h-[28rem] w-full min-w-0 shrink-0 transition-colors lg:h-[calc(100dvh-15rem)] lg:w-[19rem] xl:w-[20rem]",
        needsAttention && "bg-destructive/5 ring-destructive/30",
        isDone && "bg-muted/30",
        isDragTarget && "bg-accent/40 ring-2 ring-ring/40",
        props.className,
      )}
      onDragEnter={() => setIsDragTarget(true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragTarget(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        const taskId = event.dataTransfer.getData("text/task-id");
        setIsDragTarget(false);
        if (taskId) {
          void props.onMoveTask(taskId, props.status);
        }
      }}
    >
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <ColumnIcon status={props.status} />
          <span className="truncate">{COLUMN_LABELS[props.status]}</span>
          <Badge variant="secondary">{props.tasks.length}</Badge>
        </CardTitle>
        <CardDescription className="truncate">{COLUMN_HINTS[props.status]}</CardDescription>
        <CardAction>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Add task to ${COLUMN_LABELS[props.status]}`}
            onClick={() => props.onCreateTask(props.status)}
          >
            <Plus />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-1">
        {isDragTarget && (
          <div className="rounded-lg border border-dashed bg-background px-3 py-2 text-sm text-muted-foreground">
            Drop to move to {COLUMN_LABELS[props.status]}.
          </div>
        )}
        <ScrollArea className="min-h-72 flex-1 pr-2">
          <div className="flex flex-col gap-3">
            {props.tasks.length === 0 ? (
              <Empty className="min-h-44 rounded-lg border border-dashed bg-muted/25 p-4">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClipboardList />
                  </EmptyMedia>
                  <EmptyTitle>{EMPTY_TITLES[props.status]}</EmptyTitle>
                  <EmptyDescription>{EMPTY_DESCRIPTIONS[props.status]}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => props.onCreateTask(props.status)}
                  >
                    <Plus data-icon="inline-start" />
                    Add task
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              visibleTasks.map((task) => (
                <TaskCard
                  task={task}
                  focusArea={
                    task.focusAreaId ? props.focusAreaById.get(task.focusAreaId) : undefined
                  }
                  key={task.id}
                  onEdit={() => props.onEditTask(task)}
                  onMoveTask={props.onMoveTask}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/task-id", task.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                />
              ))
            )}
          </div>
        </ScrollArea>
        {hiddenDoneCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowAllDone(true)}>
            Show {hiddenDoneCount} completed
          </Button>
        )}
        {props.tasks.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => props.onCreateTask(props.status)}
          >
            <Plus data-icon="inline-start" />
            Add task
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const COLUMN_HINTS: Record<TaskStatus, string> = {
  draft: "Ideas to refine",
  ready: "Ready to start",
  in_progress: "Currently moving",
  needs_attention: "Blocked or failed",
  done: "Completed",
};

const EMPTY_TITLES: Record<TaskStatus, string> = {
  draft: "No drafts",
  ready: "Nothing ready",
  in_progress: "No active work",
  needs_attention: "Nothing blocked",
  done: "Nothing completed",
};

const EMPTY_DESCRIPTIONS: Record<TaskStatus, string> = {
  draft: "Capture a rough idea here.",
  ready: "Prepared tasks will appear here.",
  in_progress: "Running work will appear here.",
  needs_attention: "Blocked work will appear here.",
  done: "Finished tasks will appear here.",
};

function ColumnIcon(props: { status: TaskStatus }) {
  if (props.status === "draft") {
    return <PencilLine />;
  }
  if (props.status === "ready") {
    return <Clock3 />;
  }
  if (props.status === "in_progress") {
    return <LoaderCircle />;
  }
  if (props.status === "needs_attention") {
    return <AlertTriangle />;
  }
  return <Check />;
}

const PRIORITY_SORT_VALUE: Record<Task["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function getTasksForStatus(tasks: Task[], status: TaskStatus): Task[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.status === status)
    .sort(
      (a, b) =>
        PRIORITY_SORT_VALUE[a.task.priority] - PRIORITY_SORT_VALUE[b.task.priority] ||
        a.index - b.index,
    )
    .map(({ task }) => task);
}

function pickBestMobileStatus(columns: TaskStatus[], tasks: Task[]): TaskStatus {
  const preferredOrder: TaskStatus[] = [
    "ready",
    "in_progress",
    "needs_attention",
    "draft",
    "done",
  ];
  return (
    preferredOrder.find(
      (status) => columns.includes(status) && tasks.some((task) => task.status === status),
    ) ??
    columns[0] ??
    "draft"
  );
}
