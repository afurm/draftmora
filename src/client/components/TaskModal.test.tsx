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
    expect(document.body.textContent).toContain("Info");
    expect(document.body.textContent).toContain("Notes");
    expect(document.body.textContent).toContain("Where is Lviv located?");
    expect(document.body.textContent).toContain("Result");
    expect(document.body.textContent).toContain("Technical details");
    expect(document.body.textContent).toContain("Show log");
    expect(document.body.textContent).toContain("Lviv is in western Ukraine.");
    expect(document.body.textContent).not.toContain("**Lviv**");
    expect(document.body.querySelector("strong")?.textContent).toBe("Lviv");
    expect(document.body.querySelector("li")?.textContent).toBe("It is close to Poland.");
    expect(document.body.textContent).toContain("Ask a follow-up");
    expect(document.body.textContent).not.toContain("Work started.");
    expect(document.body.textContent).not.toContain("Progress");
    expect(document.body.textContent).not.toContain("Save task");
    expect(document.body.textContent).not.toContain("Delete");
    expect(document.body.querySelector("#task-title")).toBeNull();
    expect(document.body.querySelector("#task-follow-up")).not.toBeNull();
  });

  it("shows running AI work with terminal-style output", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "running",
        endedAt: null,
        progressSummary: "Preparing the task context.",
      }),
    });

    expect(document.body.textContent).toContain("Running work");
    expect(document.body.textContent).toContain("Current step");
    expect(document.body.textContent).toContain("Result");
    expect(document.body.textContent).toContain("No final result yet.");
    expect(document.body.textContent).toContain("Technical details");
    expect(document.body.textContent).toContain("Hide log");
    expect(document.body.textContent).toContain("Waiting for assistant output...");
    expect(document.body.textContent).toContain("Queues behind current work");
  });

  it("keeps previous results visible while a follow-up is running", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "running",
        endedAt: null,
        output: "",
        previousExecutions: [
          execution({
            id: "execution-previous",
            status: "succeeded",
            output: "Previous result that should stay visible.",
          }),
        ],
      }),
    });

    expect(document.body.textContent).toContain("No final result yet.");
    expect(document.body.textContent).toContain("Previous results");
    expect(document.body.textContent).toContain("Previous result that should stay visible.");
    expect(document.body.textContent).toContain("Waiting for assistant output...");
  });

  it("runs a next action as a scoped follow-up", async () => {
    const onAskFollowUp = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          status: "succeeded",
          output: "Work completed.\n\n## Next action\n- Check CI results and fix failures.",
          previousExecutions: [
            execution({
              id: "execution-previous",
              output: "Previous result: PR was opened.",
            }),
          ],
        }),
      },
      { onAskFollowUp },
    );

    expect(document.body.textContent).toContain("Next action");
    expect(document.body.textContent).toContain("Check CI results and fix failures.");

    await clickButton("Run as follow-up");

    const prompt = onAskFollowUp.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("Treat this as the full task context");
    expect(prompt).toContain("## Source task");
    expect(prompt).toContain("Title: Find Lviv");
    expect(prompt).toContain("Status: In Progress");
    expect(prompt).toContain("Notes:\nWhere is Lviv located?");
    expect(prompt).toContain("## Latest result");
    expect(prompt).toContain("Work completed.");
    expect(prompt).toContain("## Previous results");
    expect(prompt).toContain("Previous result: PR was opened.");
    expect(prompt).toContain("## Next action to complete\nCheck CI results and fix failures.");
    expect(getButton("Run as follow-up").disabled).toBe(true);
    expect(getButton("Draft task").disabled).toBe(true);
  });

  it("creates a draft task from a next action", async () => {
    const onCreateDraft = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          status: "succeeded",
          output: "Work completed.\n\n**Next action:** Draft the release checklist.",
        }),
      },
      { onCreateDraft },
    );

    await clickButton("Draft task");

    expect(onCreateDraft).toHaveBeenCalledWith({
      title: "Draft the release checklist.",
      description: expect.stringContaining(
        "Drafted from an existing task result. This note includes the needed context so the task can stand alone.",
      ),
      status: "draft",
      priority: "medium",
      focusAreaId: null,
      tags: [],
      providerSource: "local",
    });
    const draftInput = onCreateDraft.mock.calls[0]?.[0];
    expect(draftInput?.description).toContain("## Source task");
    expect(draftInput?.description).toContain("Title: Find Lviv");
    expect(draftInput?.description).toContain("Status: In Progress");
    expect(draftInput?.description).toContain("Priority: medium");
    expect(draftInput?.description).toContain("Notes:\nWhere is Lviv located?");
    expect(draftInput?.description).toContain("## Latest result");
    expect(draftInput?.description).toContain("## Next action to complete\nDraft the release checklist.");
    expect(getButton("Run as follow-up").disabled).toBe(true);
    expect(getButton("Draft task").disabled).toBe(true);
  });

  it("labels editable select controls for assistive technology", async () => {
    await renderTaskModal(task());

    expect(document.body.querySelector('button[aria-label="Status"]')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="Priority"]')).toBeTruthy();
    expect(document.body.querySelector('button[aria-label="Focus area"]')).toBeTruthy();
  });
});

async function renderTaskModal(
  task: Task,
  overrides: Partial<Parameters<typeof TaskModal>[0]> = {},
) {
  await act(async () => {
    root.render(
      <TaskModal
        task={task}
        title="Edit task"
        focusAreas={[]}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onAskFollowUp={vi.fn()}
        onCreateDraft={vi.fn()}
        onSave={vi.fn()}
        {...overrides}
      />,
    );
  });
}

async function clickButton(label: string) {
  const button = getButton(label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getButton(label: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
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
