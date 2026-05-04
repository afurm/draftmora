/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskExecution } from "../../shared/types";
import { TaskModal } from "./TaskModal";

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
  document.body.innerHTML = "";
});

describe("TaskModal", () => {
  it("shows completed AI work as read-only chat with the work log", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "succeeded",
        output: "**Lviv** is in western Ukraine.\n\n- It is close to Poland.",
      }),
    });

    expect(document.body.textContent).toContain("Task chat");
    expect(document.body.textContent).toContain("Assistant");
    expect(document.body.textContent).toContain("Lviv is in western Ukraine.");
    expect(document.body.textContent).not.toContain("**Lviv**");
    expect(document.body.querySelector("strong")?.textContent).toBe("Lviv");
    expect(document.body.querySelector("li")?.textContent).toBe("It is close to Poland.");
    expect(document.body.textContent).toContain("Ask a follow-up");
    expect(document.body.textContent).toContain("Work log");
    expect(document.body.textContent).toContain("Work started.");
    expect(document.body.textContent).not.toContain("Progress");
    expect(document.body.textContent).not.toContain("Save task");
    expect(document.body.textContent).not.toContain("Delete");
    expect(document.body.querySelector("#task-title")).toBeNull();
    expect(document.body.querySelector("#task-follow-up")).not.toBeNull();
  });

  it("labels editable select controls for assistive technology", async () => {
    await renderTaskModal(task());

    expect(document.body.querySelector('button[aria-label="Status"]')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="Priority"]')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="Focus area"]')).toBeTruthy();
  });
});

async function renderTaskModal(task: Task) {
  await act(async () => {
    root.render(
      <TaskModal
        task={task}
        title="Edit task"
        focusAreas={[]}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onAskFollowUp={vi.fn()}
        onSave={vi.fn()}
      />,
    );
  });
}

function task(): Task {
  return {
    id: "task-1",
    title: "Find Lviv",
    description: "Where is Lviv located?",
    status: "in_progress",
    priority: "medium",
    focusAreaId: null,
    tags: [],
    providerSource: "local",
    execution: null,
    createdAt: "2026-05-03T07:00:00.000Z",
    updatedAt: "2026-05-03T07:00:00.000Z",
  };
}

function execution(patch: Partial<TaskExecution> = {}): TaskExecution {
  return {
    id: "execution-1",
    taskId: "task-1",
    agentRunId: null,
    status: "running",
    provider: "openai",
    model: "gpt-5.4",
    startedAt: "2026-05-03T07:00:00.000Z",
    endedAt: "2026-05-03T07:01:00.000Z",
    progressSummary: "Work completed.",
    output: "",
    error: null,
    artifacts: [],
    events: [
      {
        id: "event-1",
        kind: "queued",
        message: "Request queued.",
        createdAt: "2026-05-03T07:00:00.000Z",
      },
      {
        id: "event-2",
        kind: "running",
        message: "Work started.",
        createdAt: "2026-05-03T07:00:10.000Z",
      },
      {
        id: "event-3",
        kind: "succeeded",
        message: "Work completed.",
        createdAt: "2026-05-03T07:01:00.000Z",
      },
    ],
    createdAt: "2026-05-03T07:00:00.000Z",
    updatedAt: "2026-05-03T07:01:00.000Z",
    ...patch,
  };
}
