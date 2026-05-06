import { describe, expect, it } from "vitest";
import type { Task } from "../shared/types";
import { resolveArtifactFilePath, resolveArtifactRevealCommand } from "./artifact-file-opener";
import {
  extractLocalToolResultArtifacts,
  extractTaskExecutionArtifacts,
  mergeTaskExecutionArtifacts,
} from "./task-artifacts";
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

describe("task execution artifacts", () => {
  it("extracts useful links and files from assistant output", () => {
    const artifacts = extractTaskExecutionArtifacts(
      [
        "Created [Tracking ticket](https://linear.app/acme/issue/ENG-42/fix-login).",
        "Duplicate: https://linear.app/acme/issue/ENG-42/fix-login",
        "Wrote `PR_DESCRIPTION.md`.",
        "MEDIA:/tmp/screenshot.png",
      ].join("\n"),
    );

    expect(artifacts).toEqual([
      expect.objectContaining({
        type: "link",
        title: "Tracking ticket",
        url: "https://linear.app/acme/issue/ENG-42/fix-login",
      }),
      expect.objectContaining({
        type: "output",
        title: "File: PR_DESCRIPTION.md",
        content: "PR_DESCRIPTION.md",
      }),
      expect.objectContaining({
        type: "output",
        title: "File: screenshot.png",
        content: "/tmp/screenshot.png",
        url: "file:///tmp/screenshot.png",
      }),
    ]);
  });

  it("extracts OpenClaw-style artifacts from local tool results", () => {
    expect(
      extractLocalToolResultArtifacts(
        "write_file",
        JSON.stringify({ ok: true, path: "/tmp/draftmora-report.md" }),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "output",
        title: "File: draftmora-report.md",
        content: "/tmp/draftmora-report.md",
        url: "file:///tmp/draftmora-report.md",
      }),
    ]);

    expect(
      extractLocalToolResultArtifacts(
        "run_shell",
        JSON.stringify({
          ok: true,
          stdout:
            "https://forge.example.test/team/project/issues/25\nhttps://forge.example.test/team/project/issues/25",
          stderr: "",
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "link",
        title: "Issue #25",
        url: "https://forge.example.test/team/project/issues/25",
      }),
    ]);
  });

  it("keeps URL casing distinct when deduping artifacts", () => {
    const artifacts = mergeTaskExecutionArtifacts([
      {
        id: "",
        type: "link",
        title: "Upper report",
        content: "example.test/Report",
        url: "https://example.test/Report",
        createdAt: "",
      },
      {
        id: "",
        type: "link",
        title: "Lower report",
        content: "example.test/report",
        url: "https://example.test/report",
        createdAt: "",
      },
      {
        id: "",
        type: "link",
        title: "Duplicate lower report",
        content: "example.test/report",
        url: "https://example.test/report",
        createdAt: "",
      },
    ]);

    expect(artifacts.map((artifact) => artifact.url)).toEqual([
      "https://example.test/Report",
      "https://example.test/report",
    ]);
  });
});

describe("artifact file opener", () => {
  it("resolves local file artifacts and reveal commands without shell interpolation", () => {
    expect(
      resolveArtifactFilePath({
        id: "artifact-1",
        type: "output",
        title: "File: report.md",
        content: "/tmp/report.md",
        url: "file:///tmp/report.md",
        createdAt: "2026-05-06T00:00:00.000Z",
      }),
    ).toBe("/tmp/report.md");

    expect(resolveArtifactRevealCommand("/tmp/report $(touch nope).md", "darwin")).toEqual({
      command: "open",
      args: ["-R", "/tmp/report $(touch nope).md"],
    });
    expect(resolveArtifactRevealCommand("/tmp/report.md", "linux")).toEqual({
      command: "xdg-open",
      args: ["/tmp"],
    });
    expect(resolveArtifactRevealCommand("/tmp/results", "linux", true)).toEqual({
      command: "xdg-open",
      args: ["/tmp/results"],
    });
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
