import { describe, expect, it } from "vitest";
import type { Task } from "../shared/types";
import { buildBoardTaskContext, buildTaskSystemPrompt } from "./task-executor";

describe("task executor board context", () => {
  it("passes task notes and neighboring task outputs as model context", () => {
    const tasks = [
      task({
        id: "task-1",
        title: "[01 Research] Gather launch notes",
        status: "done",
        description: "Owner: Product",
        output: "Accepted scope: use the customer brief and launch checklist.",
      }),
      task({
        id: "task-2",
        title: "[02 QA] Review current result",
        status: "in_progress",
        description: "Owner: QA\nGoal: inspect the latest output and list blockers.",
      }),
      task({
        id: "task-3",
        title: "[03 PM] Decide next action",
        status: "draft",
        description: "Start when QA is done.",
      }),
    ];

    const context = buildBoardTaskContext(tasks, "task-2");

    expect(context).toContain("<board-context>");
    expect(context).toContain("Current task: [02 QA] Review current result");
    expect(context).toContain("Previous task results:");
    expect(context).toContain("Accepted scope: use the customer brief");
    expect(context).toContain("Upcoming tasks:");
    expect(context).toContain("[03 PM] Decide next action");
  });

  it("does not tell task execution to claim unsaved memory", () => {
    const prompt = buildTaskSystemPrompt(
      "Remember the release workflow.",
      "<board-context></board-context>",
      "/tmp/draftmora-empty-memory",
    );

    expect(prompt).toContain("separate memory-review pass");
    expect(prompt).toContain("do not claim anything was saved");
    expect(prompt).not.toContain("state that it was saved to durable memory");
  });
});

function task(input: {
  id: string;
  title: string;
  status: Task["status"];
  description?: string;
  output?: string;
}): Task {
  return {
    id: input.id,
    title: input.title,
    description: input.description ?? "",
    status: input.status,
    priority: "medium",
    focusAreaId: null,
    tags: [],
    providerSource: "openai",
    execution: input.output
      ? {
          id: `${input.id}-execution`,
          taskId: input.id,
          agentRunId: null,
          status: "succeeded",
          provider: "openai",
          model: "gpt-5.5",
          requestKind: "initial",
          requestPrompt: input.title,
          startedAt: null,
          endedAt: null,
          progressSummary: "Work completed.",
          output: input.output,
          error: null,
          artifacts: [],
          events: [],
          createdAt: "2026-05-04T00:00:00.000Z",
          updatedAt: "2026-05-04T00:00:00.000Z",
        }
      : null,
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  };
}
