/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Priority, Task, TaskExecution, TaskStatus } from "../../shared/types";
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
      container.querySelectorAll<HTMLElement>('[role="button"][aria-label^="Open task "]'),
    ).map((card) => card.getAttribute("aria-label")?.replace("Open task ", ""));

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

    const card = container.querySelector<HTMLElement>(
      '[role="button"][aria-label="Open task Running task"]',
    );

    expect(card?.textContent).toContain("Running");
  });

  it("lets mobile users stay on an empty status tab", async () => {
    await act(async () => {
      root.render(
        <BoardView
          tasks={[]}
          focusAreas={[]}
          visibleStatuses={["draft", "ready"]}
          onCreateTask={vi.fn()}
          onEditTask={vi.fn()}
          onMoveTask={vi.fn()}
        />,
      );
    });

    const draftTab = container.querySelector<HTMLElement>(
      '[data-board-mobile-status="draft"]',
    );
    const readyTab = container.querySelector<HTMLElement>(
      '[data-board-mobile-status="ready"]',
    );

    expect(draftTab?.getAttribute("data-state")).toBe("active");

    await act(async () => {
      root.render(
        <BoardView
          tasks={[task("ready-task", "Ready task", "medium", null, "ready")]}
          focusAreas={[]}
          visibleStatuses={["draft", "ready"]}
          onCreateTask={vi.fn()}
          onEditTask={vi.fn()}
          onMoveTask={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(draftTab?.getAttribute("data-state")).toBe("active");
    });
    expect(readyTab?.getAttribute("data-state")).toBe("inactive");
  });
});

function task(
  id: string,
  title: string,
  priority: Priority,
  execution: TaskExecution | null = null,
  status?: TaskStatus,
): Task {
  return {
    id,
    title,
    description: "",
    status: status ?? (execution?.status === "running" ? "in_progress" : "ready"),
    priority,
    focusAreaId: null,
    tags: [],
    providerSource: "local",
    execution,
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let index = 0; index < 40; index += 1) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

function execution(): TaskExecution {
  return {
    id: "execution-1",
    taskId: "running-task",
    agentRunId: null,
    status: "running",
    provider: "openai",
    model: "gpt-5.5",
    requestKind: "initial",
    requestPrompt: "Running task",
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
