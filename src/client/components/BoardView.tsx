import { ClipboardList, Plus } from "lucide-react";
import type { FocusArea, Task, TaskStatus } from "../../shared/types";
import { COLUMN_LABELS, TASK_STATUSES } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";

export function BoardView(props: {
  tasks: Task[];
  focusAreas: FocusArea[];
  singleColumn?: TaskStatus;
  onCreateTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
}) {
  const columns = props.singleColumn ? [props.singleColumn] : TASK_STATUSES;
  const focusAreaById = new Map(props.focusAreas.map((area) => [area.id, area]));

  return (
    <div className="min-w-0">
      <section
        className={cn(
          "grid gap-4",
          props.singleColumn
            ? "xl:grid-cols-[minmax(22rem,42rem)]"
            : "md:grid-cols-2 xl:grid-cols-5",
        )}
      >
        {columns.map((status) => {
          const tasks = getTasksForStatus(props.tasks, status);
          return (
            <Card
              size="sm"
              key={status}
              className="min-h-[22rem] md:min-h-[28rem]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const taskId = event.dataTransfer.getData("text/task-id");
                if (taskId) {
                  void props.onMoveTask(taskId, status);
                }
              }}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {COLUMN_LABELS[status]}
                  <Badge variant="secondary" className="ml-1">
                    {tasks.length}
                  </Badge>
                </CardTitle>
                <CardAction>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Add task to ${COLUMN_LABELS[status]}`}
                    onClick={() => props.onCreateTask(status)}
                  >
                    <Plus />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-1">
                <ScrollArea className="min-h-72 flex-1 pr-2 md:min-h-80">
                  <div className="flex flex-col gap-3">
                    {tasks.length === 0 ? (
                      <Empty className="min-h-60">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <ClipboardList />
                          </EmptyMedia>
                          <EmptyTitle>No tasks here</EmptyTitle>
                          <EmptyDescription>
                            Drop work into this column or create a new task.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button size="sm" variant="outline" onClick={() => props.onCreateTask(status)}>
                            <Plus data-icon="inline-start" />
                            Add task
                          </Button>
                        </EmptyContent>
                      </Empty>
                    ) : (
                      tasks.map((task) => (
                        <TaskCard
                          task={task}
                          focusArea={
                            task.focusAreaId ? focusAreaById.get(task.focusAreaId) : undefined
                          }
                          key={task.id}
                          onEdit={() => props.onEditTask(task)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/task-id", task.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
                {tasks.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => props.onCreateTask(status)}
                  >
                    <Plus data-icon="inline-start" />
                    Add task
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
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
