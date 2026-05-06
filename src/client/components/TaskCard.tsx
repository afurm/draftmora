import { AlertTriangle, Check, Clock3, LoaderCircle } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";
import type { FocusArea, Priority, Task } from "../../shared/types";
import { PRIORITY_LABELS } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { getFocusAreaStyle } from "../focus-areas";

type VisibleExecutionStatus = "queued" | "running";

export function TaskCard(props: {
  task: Task;
  focusArea?: FocusArea;
  onEdit: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
}) {
  const focusStyle = props.focusArea ? getFocusAreaStyle(props.focusArea.color) : null;

  function openFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onEdit();
    }
  }

  return (
    <Item
      asChild
      variant={props.task.status === "done" ? "muted" : "outline"}
      className={cn("items-start text-left", props.focusArea && "border-l-4")}
      style={focusStyle ? { borderLeftColor: focusStyle.accent } : undefined}
    >
      <button
        type="button"
        draggable
        aria-label={`Open task ${props.task.title}`}
        onDragStart={props.onDragStart}
        onClick={props.onEdit}
        onKeyDown={openFromKeyboard}
      >
        <ItemHeader>
          <ItemMedia variant="icon">
            {taskStatusIcon(props.task)}
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="line-clamp-2 w-full text-left">
              {props.task.title}
            </ItemTitle>
            {props.task.description && (
              <ItemDescription className="line-clamp-3">{props.task.description}</ItemDescription>
            )}
          </ItemContent>
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
          <Badge variant={priorityVariant(props.task.priority)}>
            {PRIORITY_LABELS[props.task.priority]}
          </Badge>
          {props.task.execution &&
            (props.task.execution.status === "queued" ||
              props.task.execution.status === "running") && (
              <Badge variant={executionBadgeVariant(props.task.execution.status)}>
                {props.task.execution.status === "running" ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Clock3 data-icon="inline-start" />
                )}
                {formatExecutionStatus(props.task.execution.status)}
              </Badge>
            )}
        </ItemFooter>
      </button>
    </Item>
  );
}

function taskStatusIcon(task: Task) {
  if (task.execution?.status === "running") {
    return <LoaderCircle className="animate-spin" />;
  }
  if (task.execution?.status === "queued") {
    return <Clock3 />;
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
  if (priority === "low") {
    return "outline";
  }
  return "secondary";
}

function executionBadgeVariant(status: VisibleExecutionStatus): "secondary" | "outline" {
  return status === "running" ? "secondary" : "outline";
}

function formatExecutionStatus(status: VisibleExecutionStatus): string {
  return status === "running" ? "Running" : "Queued";
}
