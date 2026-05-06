/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Priority, Task, TaskExecution } from "../../shared/types";
import { BoardView } from "./BoardView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BoardView", () => {
  it("shows higher priority tasks first within a column", async () => {
    const tasks = [
      task("low-task", "Low priority task", "low"),
      task("high-task-a", "High priority task A", "high"),
      task("medium-task", "Medium priority task", "medium"),
      task("high-task-b", "High priority task B", "high"),
    ];

    await act(async () => {
      root.render(
        <BoardView
          tasks={tasks}
          focusAreas={[]}
          singleColumn="ready"
          onCreateTask={vi.fn()}
          onEditTask={vi.fn()}
          onMoveTask={vi.fn()}
        />,
      );
    });

    const renderedTaskTitles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open task "]'),
    ).map((button) => button.getAttribute("aria-label")?.replace("Open task ", ""));

    expect(renderedTaskTitles).toEqual([
      "High priority task A",
      "High priority task B",
      "Medium priority task",
      "Low priority task",
    ]);
  });

  it("shows running task execution state on the task card", async () => {
    await act(async () => {
      root.render(
        <BoardView
          tasks={[task("running-task", "Running task", "medium", execution())]}
          focusAreas={[]}
          singleColumn="in_progress"
          onCreateTask={vi.fn()}
          onEditTask={vi.fn()}
          onMoveTask={vi.fn()}
        />,
      );
    });

    const card = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open task Running task"]',
    );

    expect(card?.textContent).toContain("Running");
  });
});

function task(
  id: string,
  title: string,
  priority: Priority,
  execution: TaskExecution | null = null,
): Task {
  return {
    id,
    title,
    description: "",
    status: execution?.status === "running" ? "in_progress" : "ready",
    priority,
    focusAreaId: null,
    tags: [],
    providerSource: "local",
    execution,
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}

function execution(): TaskExecution {
  return {
    id: "execution-1",
    taskId: "running-task",
    agentRunId: null,
    status: "running",
    provider: "openai",
    model: "gpt-5.5",
    startedAt: "2026-05-02T00:00:00.000Z",
    endedAt: null,
    progressSummary: "Preparing the task context.",
    output: "",
    error: null,
    artifacts: [],
    events: [],
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}
