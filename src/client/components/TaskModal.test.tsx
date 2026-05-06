/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskExecution } from "../../shared/types";
import { TaskModal } from "./TaskModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const apiMocks = vi.hoisted(() => ({
  openTaskArtifact: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    openTaskArtifact: apiMocks.openTaskArtifact,
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiMocks.openTaskArtifact.mockReset();
  apiMocks.openTaskArtifact.mockResolvedValue({ ok: true, path: "/tmp/task-report.md" });
  try {
    window.localStorage.clear();
  } catch {
    // Storage can be unavailable in some jsdom origins.
  }
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
  it("shows completed AI work as a locked task conversation", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "succeeded",
        output: [
          "**Lviv** is in western Ukraine.",
          "- It is close to Poland.",
          "PR: https://github.com/afurm/draftmora/pull/13",
          "```ts\nconst city = 'Lviv';\n```",
          "| Check | State |\n| --- | --- |\n| CI | green |",
        ].join("\n\n"),
      }),
    });

    expect(document.body.textContent).toContain("Completed");
    expect(document.body.textContent).toContain("Assistant");
    expect(document.body.textContent).not.toContain("Agent result");
    expect(document.body.textContent).not.toContain("Run 1: Done");
    expect(document.body.textContent).not.toContain("Save details");
    expect(document.body.textContent).toContain("Lviv is in western Ukraine.");
    expect(document.body.textContent).not.toContain("**Lviv**");
    expect(document.body.querySelector("strong")?.textContent).toBe("Lviv");
    expect(document.body.querySelector("li")?.textContent).toBe("It is close to Poland.");
    const link = document.body.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/afurm/draftmora/pull/13"]',
    );
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noreferrer");
    expect(document.body.querySelector("code")?.textContent).toContain("const city = 'Lviv';");
    expect(document.body.querySelector("table")?.textContent).toContain("CIgreen");
    expect(document.body.textContent).toContain("Reply to task");
    expect(document.body.textContent).not.toContain("Work started.");
    expect(document.body.querySelector('aside[aria-label="Task details"]')?.getAttribute("data-state")).toBe(
      "collapsed",
    );
    await clickButtonByLabel("Expand task details");
    expect(document.body.textContent).toContain("Notes");
    expect(document.body.textContent).toContain("Where is Lviv located?");
    expect(document.body.textContent).toContain("Details locked");
    expect(document.body.textContent).toContain("Delete");
    expect(document.body.querySelector<HTMLInputElement>("#task-title-inline")?.readOnly).toBe(
      true,
    );
    expect(document.body.querySelector<HTMLInputElement>("#task-detail-title")?.disabled).toBe(
      true,
    );
    expect(document.body.querySelector<HTMLTextAreaElement>("#task-detail-notes")?.disabled).toBe(
      true,
    );
    expect(document.body.querySelector("#task-follow-up")).not.toBeNull();
    const originalRequest = Array.from(document.body.querySelectorAll('[data-slot="item"]')).find(
      (element) => element.textContent?.includes("Original request"),
    );
    expect(originalRequest?.parentElement?.className).toContain("justify-start");
    expect(originalRequest?.className).not.toContain("max-w");
    expect(originalRequest?.querySelector('[data-slot="item-content"]')?.className).toContain(
      "text-left",
    );
  });

  it("labels the inspector tab as Artifacts and renders useful artifacts as clickable rows", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "succeeded",
        output: "Created useful evidence.",
        artifacts: [
          {
            id: "artifact-issue",
            type: "link",
            title: "GitHub issue #25",
            content: "github.com",
            url: "https://github.com/afurm/draftmora/issues/25",
            createdAt: "2026-05-03T07:01:00.000Z",
          },
          {
            id: "artifact-issue-duplicate",
            type: "link",
            title: "GitHub issue #25",
            content: "github.com",
            url: "https://github.com/afurm/draftmora/issues/25",
            createdAt: "2026-05-03T07:01:01.000Z",
          },
          {
            id: "artifact-file",
            type: "output",
            title: "File: task-report.md",
            content: "/tmp/task-report.md",
            url: "file:///tmp/task-report.md",
            createdAt: "2026-05-03T07:01:02.000Z",
          },
        ],
      }),
    });

    await clickButtonByLabel("Open Artifacts");

    expect(document.body.textContent).toContain("Artifacts");
    expect(document.body.textContent).not.toContain("Files");
    expect(document.body.textContent).toContain("GitHub issue #25");
    expect(document.body.textContent).toContain("File: task-report.md");

    const inspector = document.body.querySelector<HTMLElement>('aside[aria-label="Task details"]');
    expect(inspector).toBeTruthy();
    const issueLinks = inspector!.querySelectorAll<HTMLAnchorElement>(
      'a[href="https://github.com/afurm/draftmora/issues/25"]',
    );
    expect(issueLinks).toHaveLength(1);
    expect(issueLinks[0]?.target).toBe("_blank");
    expect(issueLinks[0]?.rel).toBe("noreferrer");

    const fileLink = inspector!.querySelector<HTMLAnchorElement>('a[href="file:///tmp/task-report.md"]');
    expect(fileLink).toBeNull();

    const fileButton = inspector!.querySelector<HTMLButtonElement>(
      'button[aria-label="Reveal File: task-report.md"]',
    );
    expect(fileButton).toBeTruthy();
    await act(async () => {
      fileButton!.click();
      await Promise.resolve();
    });
    expect(apiMocks.openTaskArtifact).toHaveBeenCalledWith("task-1", "artifact-file");
  });

  it("shows running AI work above locked details", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "running",
        endedAt: null,
        progressSummary: "Preparing the task context.",
      }),
    });

    expect(document.body.textContent).toContain("Running now");
    expect(document.body.textContent).toContain("Current step");
    expect(document.body.textContent).toContain("Assistant");
    expect(document.body.textContent).not.toContain("Agent result");
    expect(document.body.textContent).toContain("No final result yet.");
    expect(document.body.querySelector('aside[aria-label="Task details"]')?.getAttribute("data-state")).toBe(
      "collapsed",
    );
    await clickButtonByLabel("Expand task details");
    expect(document.body.textContent).toContain("Details locked");
    expect(document.body.textContent).toContain("Queues behind current work");
    expect(document.body.querySelector<HTMLInputElement>("#task-title-inline")?.readOnly).toBe(
      true,
    );
    expect(document.body.querySelector<HTMLTextAreaElement>("#task-detail-notes")?.disabled).toBe(
      true,
    );
  });

  it("summarizes raw tool progress in the current step and keeps details in the run log", async () => {
    const rawProgress =
      'run_shell (gh search issues repo:afurm/draftmora "task-executor" --state open) completed in 1582ms';
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "running",
        endedAt: null,
        progressSummary: rawProgress,
        events: [
          {
            id: "event-1",
            kind: "running",
            message: "Work started.",
            createdAt: "2026-05-03T07:00:10.000Z",
          },
          {
            id: "event-2",
            kind: "progress",
            message: rawProgress,
            createdAt: "2026-05-03T07:00:20.000Z",
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("Searching GitHub issues");
    expect(document.body.textContent).not.toContain(rawProgress);

    await clickButtonByLabel("Open Runs");

    expect(document.body.textContent).toContain(rawProgress);
  });

  it("bounds the runs panel and long run logs for independent scrolling", async () => {
    const longRunEvents = Array.from({ length: 12 }, (_, index) => ({
      id: `event-${index + 1}`,
      kind: "progress" as const,
      message: `run_shell (npm test -- --case ${index + 1}) completed in ${index + 1}ms`,
      createdAt: `2026-05-03T07:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    await renderTaskModal({
      ...task(),
      execution: execution({
        id: "execution-latest",
        status: "running",
        endedAt: null,
        events: longRunEvents,
        previousExecutions: [
          execution({ id: "execution-previous-1", status: "succeeded", output: "First result." }),
          execution({ id: "execution-previous-2", status: "succeeded", output: "Second result." }),
          execution({ id: "execution-previous-3", status: "succeeded", output: "Third result." }),
        ],
      }),
    });

    await clickButtonByLabel("Open Runs");

    const tabs = document.body.querySelector<HTMLElement>('[data-slot="tabs"]');
    expect(tabs?.className).toContain("overflow-hidden");
    expect(tabs?.className).toContain("min-h-0");

    const runsScrollArea = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="scroll-area"]'),
    ).find((element) => element.textContent?.includes("Run 4: Running"));
    expect(runsScrollArea?.className).toContain("min-h-0");
    expect(runsScrollArea?.className).toContain("flex-1");

    const runLog = document.body.querySelector<HTMLElement>(
      '[aria-label="Run log for running task run"]',
    );
    expect(runLog?.className).toContain("h-56");
    expect(runLog?.textContent).toContain("run_shell (npm test -- --case 12) completed in 12ms");
  });

  it("lets the user stop active AI work", async () => {
    const onAbortExecution = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          status: "running",
          endedAt: null,
          progressSummary: "Preparing the task context.",
        }),
      },
      { onAbortExecution },
    );

    await clickButton("Stop run");
    await act(async () => {
      await Promise.resolve();
    });

    expect(onAbortExecution).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Run cancelled.");
  });

  it("offers force request on a queued follow-up while active AI work is running", async () => {
    const onForceFollowUp = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          id: "execution-follow-up",
          status: "queued",
          endedAt: null,
          requestKind: "follow_up",
          requestPrompt: "Stop and use this correction.",
          progressSummary: "Follow-up queued.",
          previousExecutions: [
            execution({
              id: "execution-active",
              status: "running",
              endedAt: null,
              progressSummary: "Preparing the task context.",
            }),
          ],
        }),
      },
      { onForceFollowUp },
    );

    expect(findButton("Force request")).toBeTruthy();
    expect(document.body.textContent).toContain("Stop and use this correction.");
    await clickButton("Force request");
    await flushReactPromises();

    expect(onForceFollowUp).toHaveBeenCalledWith("execution-follow-up");
    expect(document.body.textContent).toContain("Forced request queued.");
  });

  it("offers force request only on the latest queued follow-up", async () => {
    const onForceFollowUp = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          id: "execution-follow-up-newer",
          status: "queued",
          endedAt: null,
          requestKind: "follow_up",
          requestPrompt: "Use the newer correction.",
          progressSummary: "Follow-up queued.",
          createdAt: "2026-05-03T07:00:30.000Z",
          previousExecutions: [
            execution({
              id: "execution-active",
              status: "running",
              endedAt: null,
              progressSummary: "Preparing the task context.",
              createdAt: "2026-05-03T07:00:00.000Z",
            }),
            execution({
              id: "execution-follow-up-older",
              status: "queued",
              endedAt: null,
              requestKind: "follow_up",
              requestPrompt: "Use the older correction.",
              progressSummary: "Follow-up queued.",
              createdAt: "2026-05-03T07:00:20.000Z",
            }),
          ],
        }),
      },
      { onForceFollowUp },
    );

    expect(document.body.textContent).toContain("Use the older correction.");
    expect(document.body.textContent).toContain("Use the newer correction.");
    const forceButtons = Array.from(document.body.querySelectorAll("button")).filter(
      (button) => button.textContent === "Force request",
    );
    expect(forceButtons).toHaveLength(1);

    await clickButton("Force request");
    await flushReactPromises();

    expect(onForceFollowUp).toHaveBeenCalledWith("execution-follow-up-newer");
  });

  it("keeps queued follow-ups forceable when force fails", async () => {
    const onForceFollowUp = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network offline"))
      .mockResolvedValueOnce(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          id: "execution-follow-up",
          status: "queued",
          endedAt: null,
          requestKind: "follow_up",
          requestPrompt: "Force with retry context.",
          progressSummary: "Follow-up queued.",
          previousExecutions: [
            execution({
              id: "execution-active",
              status: "running",
              endedAt: null,
              progressSummary: "Preparing the task context.",
            }),
          ],
        }),
      },
      { onForceFollowUp },
    );

    await clickButton("Force request");
    await flushReactPromises();

    expect(document.body.textContent).toContain("Network offline");
    expect(findButton("Force request")).toBeTruthy();

    await clickButton("Force request");
    await flushReactPromises();

    expect(onForceFollowUp).toHaveBeenNthCalledWith(2, "execution-follow-up");
    expect(document.body.textContent).toContain("Forced request queued.");
  });

  it("shows cancelled runs as terminal task history", async () => {
    await renderTaskModal({
      ...task(),
      status: "ready",
      execution: execution({
        status: "cancelled",
        progressSummary: "Work cancelled.",
        error: "Cancelled by user.",
        output: "## Work cancelled\n\nStatus: cancelled",
        events: [
          {
            id: "event-1",
            kind: "queued",
            message: "Request queued.",
            createdAt: "2026-05-03T07:00:00.000Z",
          },
          {
            id: "event-2",
            kind: "cancelled",
            message: "Work cancelled.",
            createdAt: "2026-05-03T07:00:30.000Z",
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("Cancelled");
    expect(document.body.textContent).toContain("Work cancelled");
    expect(document.body.textContent).not.toContain("Current step");
    await clickButtonByLabel("Open Runs");
    expect(document.body.textContent).toContain("Run 1: Cancelled");
    expect(document.body.textContent).toContain("Work was cancelled by the user.");
  });

  it("saves edited title and notes before agent work starts", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        status: "draft",
      },
      { onSave },
    );

    await changeField("#task-title-inline", "Update release notes");
    await changeField("#task-detail-notes", "Document the merged PR and CI result.");
    await clickButton("Save details");

    expect(onSave).toHaveBeenCalledWith({
      title: "Update release notes",
      description: "Document the merged PR and CI result.",
      status: "draft",
      priority: "medium",
      focusAreaId: null,
      tags: [],
    });
  });

  it("locks all details while active work is attached", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          status: "running",
          endedAt: null,
          progressSummary: "Preparing the task context.",
        }),
      },
      { onSave },
    );

    await clickButtonByLabel("Expand task details");

    expect(document.body.querySelector<HTMLInputElement>("#task-title-inline")?.readOnly).toBe(
      true,
    );
    expect(document.body.querySelector<HTMLInputElement>("#task-detail-title")?.disabled).toBe(
      true,
    );
    expect(document.body.querySelector<HTMLTextAreaElement>("#task-detail-notes")?.disabled).toBe(
      true,
    );
    expect(document.body.querySelector('button[aria-label="Status"]')).toBeNull();
    expect(document.body.querySelector('button[aria-label="Priority"]')).toBeNull();
    expect(document.body.querySelector('button[aria-label="Focus area"]')).toBeNull();
    expect(document.body.querySelector<HTMLInputElement>('input[aria-label="Status"]')?.disabled).toBe(
      true,
    );
    expect(
      document.body.querySelector<HTMLInputElement>('input[aria-label="Priority"]')?.disabled,
    ).toBe(true);
    expect(
      document.body.querySelector<HTMLInputElement>('input[aria-label="Focus area"]')?.disabled,
    ).toBe(true);
    expect(findButton("Save details")).toBeUndefined();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps failure technical logs in the runs tab instead of the main thread", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "failed",
        progressSummary: "Work needs attention.",
        error: "WebSocket closed 1006",
        output: [
          "## Failure handoff",
          "",
          "Task: Find Lviv",
          "Status: needs_attention",
          "Failure: WebSocket closed 1006",
          "",
          "### Recent agent log",
          "- progress: run_shell (npm test) completed in 42ms",
          "",
          "### Next assignee step",
          "Open this task and address the concrete blocker.",
        ].join("\n"),
        events: [
          {
            id: "event-1",
            kind: "running",
            message: "Work started.",
            createdAt: "2026-05-03T07:00:10.000Z",
          },
          {
            id: "event-2",
            kind: "progress",
            message: "progress: run_shell (npm test) completed in 42ms",
            createdAt: "2026-05-03T07:00:20.000Z",
          },
          {
            id: "event-3",
            kind: "failed",
            message: "Work needs attention.",
            createdAt: "2026-05-03T07:01:00.000Z",
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("Failure handoff");
    expect(document.body.textContent).toContain("Next action");
    expect(document.body.textContent).toContain("Open this task and address the concrete blocker.");
    expect(document.body.textContent).not.toContain("Next assignee step");
    expect(document.body.textContent).not.toContain("run_shell (npm test)");

    await clickButtonByLabel("Open Context");

    expect(document.body.textContent).toContain("Latest next action");
    expect(document.body.textContent).toContain("Open this task and address the concrete blocker.");

    await clickButtonByLabel("Collapse task details");
    await clickButtonByLabel("Open Runs");

    expect(document.body.textContent).toContain("Technical details");
    expect(document.body.textContent).toContain("progress: run_shell (npm test) completed in 42ms");
    expect(document.body.textContent).toContain("error: WebSocket closed 1006");
  });

  it("collapses and expands the inspector like a sidebar", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({ status: "succeeded", output: "Done." }),
    });

    expect(getInspectorState()).toBe("collapsed");
    expect(document.body.textContent).not.toContain("Details locked");

    await clickButtonByLabel("Expand task details");

    expect(getInspectorState()).toBe("expanded");
    expect(document.body.textContent).toContain("Details locked");

    await clickButtonByLabel("Collapse task details");

    expect(getInspectorState()).toBe("collapsed");
    expect(document.body.textContent).not.toContain("Details locked");
  });

  it("lets the expanded inspector be resized with a pointer", async () => {
    await renderTaskModal(task());

    const workspace = document.body.querySelector<HTMLElement>(
      '[data-slot="task-detail-workspace"]',
    );
    expect(workspace).toBeTruthy();
    vi.spyOn(workspace!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      top: 0,
      right: 1200,
      bottom: 800,
      left: 0,
      toJSON: () => ({}),
    });

    const handle = getResizeHandle();
    expect(handle.getAttribute("aria-valuenow")).toBe("480");

    await act(async () => {
      handle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 820 }),
      );
      window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 700 }));
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(handle.getAttribute("aria-valuenow")).toBe("494");
    expect(workspace?.style.getPropertyValue("--task-inspector-width")).toBe("494px");
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
    expect(document.body.textContent).toContain("Previous result that should stay visible.");
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Previous result that should stay visible.")).toBeLessThan(
      text.indexOf("No final result yet."),
    );
    expect(text).not.toContain("Run 2: Running");
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

  it("does not offer stale next actions from previous executions", async () => {
    await renderTaskModal({
      ...task(),
      execution: execution({
        status: "succeeded",
        output: "Latest follow-up result without any next action.",
        previousExecutions: [
          execution({
            id: "execution-previous",
            output: "Earlier result.\n\n## Next action\n- Check CI results and fix failures.",
          }),
        ],
      }),
    });

    expect(document.body.textContent).toContain("Check CI results and fix failures.");
    expect(document.body.querySelector('section[aria-label="Next action"]')).toBeNull();
    expect(findButton("Run as follow-up")).toBeUndefined();
    expect(findButton("Draft task")).toBeUndefined();

    await clickButtonByLabel("Open Context");

    expect(document.body.textContent).not.toContain("Latest next action");
  });

  it("shows task-note next actions in the context inspector", async () => {
    await renderTaskModal({
      ...task(),
      description: [
        "Original notes for the task.",
        "",
        "Next action:",
        "Address review comments and rerun CI.",
      ].join("\n"),
      execution: execution({
        status: "succeeded",
        output: "Latest result without a next action.",
      }),
    });

    await clickButtonByLabel("Open Context");

    expect(document.body.textContent).toContain("Latest next action");
    expect(document.body.textContent).toContain("Address review comments and rerun CI.");
  });

  it("caps previous next-action context in follow-up prompts", async () => {
    const onAskFollowUp = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(
      {
        ...task(),
        execution: execution({
          status: "succeeded",
          output: `${"Latest release detail. ".repeat(140)}\n\n## Next action\n- Check release logs.`,
          previousExecutions: Array.from({ length: 6 }, (_, index) =>
            execution({
              id: `execution-previous-${index}`,
              output:
                index === 0
                  ? "Oldest previous result that should not be included."
                  : `Recent previous result ${index}. ${index === 5 ? "x".repeat(3_000) : ""}`,
            }),
          ),
        }),
      },
      { onAskFollowUp },
    );

    await clickButton("Run as follow-up");

    const prompt = onAskFollowUp.mock.calls[0]?.[0] ?? "";
    expect(prompt).not.toContain("Oldest previous result that should not be included.");
    expect(prompt).toContain("Recent previous result 2.");
    expect(prompt).toContain("Recent previous result 5.");
    expect(prompt).toContain("...[truncated]");
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

  it("requires explicit confirmation before deleting a task", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    await renderTaskModal(task(), { onDelete });

    await clickButton("Delete");

    expect(document.body.textContent).toContain("Delete this task?");
    expect(document.body.textContent).toContain("Delete permanently");
    expect(onDelete).not.toHaveBeenCalled();

    await clickButton("Delete permanently");

    expect(onDelete).toHaveBeenCalledTimes(1);
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

async function clickButtonByLabel(label: string) {
  const button = getButtonByLabel(label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function changeField(selector: string, value: string) {
  const field = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(field).toBeTruthy();
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    valueSetter?.call(field, value);
    field!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flushReactPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getButton(label: string) {
  const button = findButton(label);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function getButtonByLabel(label: string) {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function findButton(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
}

function getInspectorState() {
  return document.body
    .querySelector('aside[aria-label="Task details"]')
    ?.getAttribute("data-state");
}

function getResizeHandle() {
  const handle = document.body.querySelector<HTMLElement>(
    '[role="separator"][aria-label="Resize task details"]',
  );
  expect(handle).toBeTruthy();
  return handle as HTMLElement;
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
    requestKind: "initial",
    requestPrompt: "Find Lviv\n\nWhere is Lviv located?",
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
  } as TaskExecution;
}
