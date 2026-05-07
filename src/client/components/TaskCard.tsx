import {
  AlertTriangle,
  Check,
  CircleStop,
  Clock3,
  LoaderCircle,
  MoreHorizontal,
} from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";
import type { FocusArea, Priority, Task, TaskStatus } from "../../shared/types";
import { COLUMN_LABELS, PRIORITY_LABELS, TASK_STATUSES } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { getFocusAreaStyle } from "../focus-areas";

type VisibleExecutionStatus = "queued" | "running" | "cancelled";

export function TaskCard(props: {
  task: Task;
  focusArea?: FocusArea;
  onEdit: () => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
}) {
  const focusStyle = props.focusArea ? getFocusAreaStyle(props.focusArea.color) : null;
  const isDone = props.task.status === "done";

  function openFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onEdit();
    }
  }

  return (
    <Item
      role="button"
      tabIndex={0}
      draggable
      aria-label={`Open task ${props.task.title}`}
      variant={isDone ? "muted" : "outline"}
      className={cn(
        "items-start text-left shadow-xs hover:bg-accent/30 hover:text-accent-foreground",
        props.focusArea && "border-l-4",
        isDone && "opacity-90",
      )}
      style={focusStyle ? { borderLeftColor: focusStyle.accent } : undefined}
      onClick={props.onEdit}
      onDragStart={props.onDragStart}
      onKeyDown={openFromKeyboard}
    >
      <ItemHeader className="items-start">
        <ItemMedia variant="icon" className="mt-0.5">
          {taskStatusIcon(props.task)}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-2 w-full text-left">
            {props.task.title}
          </ItemTitle>
          {props.task.description && !isDone && (
            <ItemDescription className="line-clamp-2">{props.task.description}</ItemDescription>
          )}
        </ItemContent>
        <ItemActions onClick={(event) => event.stopPropagation()}>
          <TaskActionsMenu task={props.task} onMoveTask={props.onMoveTask} />
        </ItemActions>
      </ItemHeader>

      <ItemFooter className="flex-wrap justify-start gap-1.5 pt-1">
        {props.focusArea && (
          <Badge
            variant="outline"
            style={{
              backgroundColor: focusStyle?.background,
              borderColor: focusStyle?.border,
              color: focusStyle?.foreground,
            }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: focusStyle?.accent }}
            />
            {props.focusArea.label}
          </Badge>
        )}
        <Badge
          variant={priorityVariant(props.task.priority)}
          className={cn(props.task.priority === "medium" && "text-muted-foreground")}
        >
          {PRIORITY_LABELS[props.task.priority]}
        </Badge>
        {props.task.execution &&
          (props.task.execution.status === "queued" ||
            props.task.execution.status === "running" ||
            props.task.execution.status === "cancelled") && (
            <Badge variant={executionBadgeVariant(props.task.execution.status)}>
              {props.task.execution.status === "running" ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : props.task.execution.status === "cancelled" ? (
                <CircleStop data-icon="inline-start" />
              ) : (
                <Clock3 data-icon="inline-start" />
              )}
              {formatExecutionStatus(props.task.execution.status)}
            </Badge>
          )}
      </ItemFooter>
    </Item>
  );
}

function TaskActionsMenu(props: {
  task: Task;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Task actions for ${props.task.title}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        <DropdownMenuGroup>
          {TASK_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              disabled={status === props.task.status}
              onSelect={() => props.onMoveTask(props.task.id, status)}
            >
              {status === props.task.status && <Check />}
              <span className={cn(status !== props.task.status && "pl-5")}>
                {COLUMN_LABELS[status]}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function taskStatusIcon(task: Task) {
  if (task.execution?.status === "running") {
    return <LoaderCircle className="animate-spin" />;
  }
  if (task.execution?.status === "queued") {
    return <Clock3 />;
  }
  if (task.execution?.status === "cancelled") {
    return <CircleStop />;
  }
  if (task.status === "done") {
    return <Check />;
  }
  if (task.status === "needs_attention") {
    return <AlertTriangle />;
  }
  return <Clock3 />;
}

function priorityVariant(priority: Priority): "secondary" | "outline" | "destructive" {
  if (priority === "high") {
    return "destructive";
  }
  if (priority === "low" || priority === "medium") {
    return "outline";
  }
  return "secondary";
}

function executionBadgeVariant(status: VisibleExecutionStatus): "secondary" | "outline" {
  return status === "running" ? "secondary" : "outline";
}

function formatExecutionStatus(status: VisibleExecutionStatus): string {
  if (status === "running") {
    return "Running";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  return "Queued";
}
