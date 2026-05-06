import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BoardStore } from "./db";
import { buildServer } from "./routes";
import { ProviderRouter } from "./providers/router";
import type { Task } from "../shared/types";
import type {
  CompletionRequest,
  CompletionResult,
  ToolCompletionRequest,
  ToolCompletionResult,
} from "./providers/types";

const tempDirs: string[] = [];

class StubProviderRouter extends ProviderRouter {
  requests: CompletionRequest[] = [];
  toolRequests: ToolCompletionRequest[] = [];
  memoryReviewResponses: string[] = [];

  constructor(store: BoardStore, private readonly toolCwd: string) {
    super(store);
  }

  override async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const prompt = request.messages.at(-1)?.content ?? "";
    if (request.systemPrompt?.includes("durable memory reviewer")) {
      return {
        content: this.memoryReviewResponses.shift() ?? JSON.stringify({ entries: [] }),
        raw: {} as CompletionResult["raw"],
      };
    }
    if (request.systemPrompt?.includes("right-side agent chat") && prompt.includes("Propose launch")) {
      return {
        content: [
          "I found one board change to approve.",
          "",
          "```draftmora-actions",
          JSON.stringify({
            actions: [
              {
                type: "create_task",
                title: "Create launch notes task",
                rationale: "The launch notes are ready to become a task.",
                task: {
                  title: "Draft launch notes",
                  status: "ready",
                  priority: "high",
                },
              },
            ],
          }),
          "```",
        ].join("\n"),
        raw: {} as CompletionResult["raw"],
      };
    }
    if (request.systemPrompt?.includes("right-side agent chat") && prompt.includes("Bad proposal")) {
      return {
        content: [
          "This proposal is malformed.",
          "",
          "```draftmora-actions",
          JSON.stringify({
            actions: [
              {
                type: "create_task",
                title: "",
                task: {
                  description: "Missing required title.",
                },
              },
            ],
          }),
          "```",
        ].join("\n"),
        raw: {} as CompletionResult["raw"],
      };
    }
    if (request.systemPrompt?.includes("right-side agent chat") && prompt.includes("Prose proposal")) {
      return {
        content: "Proposed board change: create a ready task named **Review launch checklist**.",
        raw: {} as CompletionResult["raw"],
      };
    }
    if (request.systemPrompt?.includes("right-side agent chat") && prompt.includes("Natural proposal")) {
      return {
        content: "Proposed one ready QA task with disposable data.",
        raw: {} as CompletionResult["raw"],
      };
    }
    if (request.systemPrompt?.includes("right-side agent chat") && prompt.includes("JSON proposal")) {
      return {
        content: [
          "I drafted one board change.",
          "",
          "```json",
          JSON.stringify({
            actions: [
              {
                type: "create_task",
                title: "Create support checklist",
                task: {
                  title: "Review support checklist",
                  status: "ready",
                  priority: "medium",
                },
              },
            ],
          }),
          "```",
        ].join("\n"),
        raw: {} as CompletionResult["raw"],
      };
    }
    if (
      request.systemPrompt?.includes("right-side agent chat") &&
      request.systemPrompt.includes("The user's name is Andrii.") &&
      prompt.toLowerCase().includes("what is my name")
    ) {
      return {
        content: "Your name is Andrii.",
        raw: {} as CompletionResult["raw"],
      };
    }
    if (prompt.includes("Invalid key failure")) {
      throw new Error(
        "401 Incorrect API key provided: sk-draft***************************5-04. Check your API key.",
      );
    }
    return {
      content: request.systemPrompt?.includes("right-side agent chat")
        ? `Chat response for: ${prompt}`
        : prompt.includes("Follow-up request:")
          ? "Follow-up result from stub provider."
          : "Initial result from stub provider.",
      raw: {} as CompletionResult["raw"],
    };
  }

  override async completeWithTools(
    request: ToolCompletionRequest,
  ): Promise<ToolCompletionResult> {
    this.toolRequests.push(request);
    const firstUserMessage = request.context.messages.find((message) => message.role === "user");
    const prompt =
      firstUserMessage?.role === "user" && typeof firstUserMessage.content === "string"
        ? firstUserMessage.content
        : "";
    if (prompt.includes("Invalid key failure")) {
      throw new Error(
        "401 Incorrect API key provided: sk-draft***************************5-04. Check your API key.",
      );
    }
    if (prompt.includes("Tool-backed local read")) {
      const hasToolResult = request.context.messages.some(
        (message) => message.role === "toolResult" && message.toolName === "read_file",
      );
      return {
        content: hasToolResult
          ? "Read marker.txt through the local tool and used the result."
          : "",
        raw: hasToolResult
          ? assistantMessage("Read marker.txt through the local tool and used the result.")
          : assistantMessageWithToolCall("read_file", {
              path: "marker.txt",
              cwd: this.toolCwd,
            }),
      };
    }
    if (prompt.includes("Artifact-producing write")) {
      const hasToolResult = request.context.messages.some(
        (message) => message.role === "toolResult" && message.toolName === "write_file",
      );
      return {
        content: hasToolResult ? "Created the task report." : "",
        raw: hasToolResult
          ? assistantMessage("Created the task report.")
          : assistantMessageWithToolCall("write_file", {
              path: "artifacts/task-report.md",
              cwd: this.toolCwd,
              content: "# Task report\n",
            }),
      };
    }
    const followUp = prompt.includes("Follow-up request:");
    return {
      content: followUp ? "Follow-up result from stub provider." : "Initial result from stub provider.",
      raw: assistantMessage(
        followUp ? "Follow-up result from stub provider." : "Initial result from stub provider.",
      ),
    };
  }
}

class BlockingTaskProviderRouter extends ProviderRouter {
  requests: CompletionRequest[] = [];
  toolRequests: ToolCompletionRequest[] = [];
  toolRequestSignals: AbortSignal[] = [];
  private toolCompletions: Array<(content: string) => void> = [];

  override async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    return {
      content: JSON.stringify({ entries: [] }),
      raw: {} as CompletionResult["raw"],
    };
  }

  override async completeWithTools(
    request: ToolCompletionRequest,
  ): Promise<ToolCompletionResult> {
    this.toolRequests.push(request);
    if (request.signal) {
      this.toolRequestSignals.push(request.signal);
    }
    return new Promise<ToolCompletionResult>((resolve) => {
      this.toolCompletions.push((content) => {
        resolve({
          content,
          raw: assistantMessage(content),
        });
      });
    });
  }

  resolveNextToolRequest(content: string): void {
    const resolve = this.toolCompletions.shift();
    if (!resolve) {
      throw new Error("No pending tool request to resolve.");
    }
    resolve(content);
  }
}

function assistantMessage(content: string): ToolCompletionResult["raw"] {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function assistantMessageWithToolCall(
  name: string,
  args: Record<string, unknown>,
): ToolCompletionResult["raw"] {
  return {
    ...assistantMessage(""),
    content: [{ type: "toolCall", id: "call-read-marker", name, arguments: args }],
    stopReason: "toolUse",
  };
}

function createTestApp(options: {
  runTaskExecutionsInline?: boolean;
  artifactFileOpener?: (filePath: string) => Promise<{ ok: true; path: string }>;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "routes-"));
  tempDirs.push(dir);
  const store = new BoardStore(path.join(dir, "board.db"));
  const providerRouter = new StubProviderRouter(store, dir);
  const app = buildServer({
    store,
    providerRouter,
    runTaskExecutionsInline: options.runTaskExecutionsInline,
    memoryRoot: dir,
    artifactFileOpener: options.artifactFileOpener,
  });
  return { app, store, dir, providerRouter };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition.");
}

async function flushQueuedPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("routes", () => {
  it("supports task CRUD over Fastify", async () => {
    const { app, store } = createTestApp();
    const workArea = store
      .getSettings()
      .userProfile.focusAreas.find((area) => area.id === "work");
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Write tests",
        description: "Keep this note when the card moves.",
        status: "ready",
        priority: "high",
        focusAreaId: workArea?.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const task = created.json().task;
    expect(task.focusAreaId).toBe(workArea?.id);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      payload: { status: "done" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().task.status).toBe("done");
    expect(patched.json().task.description).toBe("Keep this note when the card moves.");

    const deleted = await app.inject({ method: "DELETE", url: `/api/tasks/${task.id}` });
    expect(deleted.statusCode).toBe(204);
    await app.close();
    store.close();
  });

  it("updates focus areas through settings routes", async () => {
    const { app, store } = createTestApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: {
        userProfile: {
          workAreas: ["Client"],
          focusAreas: [{ id: "client", label: "Client", color: "rose" }],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().userProfile.focusAreas).toEqual([
      { id: "client", label: "Client", color: "rose" },
    ]);
    await app.close();
    store.close();
  });

  it("starts execution when a task moves into progress", async () => {
    const { app, store } = createTestApp({ runTaskExecutionsInline: true });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Draft launch plan",
        status: "ready",
      },
    });
    const task = created.json().task;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      payload: { status: "in_progress" },
    });

    expect(patched.statusCode).toBe(200);
    const body = patched.json();
    expect(body.task.status).toBe("done");
    expect(body.task.execution.status).toBe("succeeded");
    expect(body.task.execution.output).toBe("Initial result from stub provider.");
    expect(body.task.execution.events.map((event: { kind: string }) => event.kind)).toEqual([
      "queued",
      "running",
      "succeeded",
    ]);
    await app.close();
    store.close();
  });

  it("executes model-requested local tools before completing task work", async () => {
    const { app, store, dir, providerRouter } = createTestApp({
      runTaskExecutionsInline: true,
    });
    writeFileSync(path.join(dir, "marker.txt"), "tool evidence", "utf8");

    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Tool-backed local read",
        status: "in_progress",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.task.status).toBe("done");
    expect(body.task.execution.status).toBe("succeeded");
    expect(body.task.execution.output).toBe(
      "Read marker.txt through the local tool and used the result.",
    );
    expect(providerRouter.toolRequests).toHaveLength(2);
    expect(
      body.task.execution.events.some((event: { message: string }) =>
        event.message.includes("read_file (marker.txt) completed"),
      ),
    ).toBe(true);
    await app.close();
    store.close();
  });

  it("records artifacts produced by local tool results", async () => {
    const { app, store, dir } = createTestApp({
      runTaskExecutionsInline: true,
    });
    const artifactPath = path.join(dir, "artifacts/task-report.md");

    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Artifact-producing write",
        status: "in_progress",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(readFileSync(artifactPath, "utf8")).toBe("# Task report\n");
    expect(body.task.execution.output).toBe("Created the task report.");
    expect(body.task.execution.artifacts).toEqual([
      expect.objectContaining({
        type: "output",
        title: "File: task-report.md",
        content: artifactPath,
        url: pathToFileURL(artifactPath).href,
      }),
    ]);
    await app.close();
    store.close();
  });

  it("reveals recorded local artifact files through the backend", async () => {
    const openArtifactFile = vi.fn(async (filePath: string) => ({
      ok: true as const,
      path: filePath,
    }));
    const { app, store, dir } = createTestApp({
      runTaskExecutionsInline: true,
      artifactFileOpener: openArtifactFile,
    });
    const artifactPath = path.join(dir, "artifacts/task-report.md");

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Artifact-producing write",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;
    const artifact = task.execution?.artifacts[0];

    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/artifacts/${artifact?.id}/open`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, path: artifactPath });
    expect(openArtifactFile).toHaveBeenCalledWith(artifactPath);
    await app.close();
    store.close();
  });

  it("runs memory review after successful task execution without promising unsaved memory", async () => {
    const { app, store, dir, providerRouter } = createTestApp({
      runTaskExecutionsInline: true,
    });
    providerRouter.memoryReviewResponses.push(
      JSON.stringify({
        entries: [
          {
            target: "memory",
            content: "Draftmora successful task execution can save durable project facts.",
          },
        ],
        remove: [],
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Capture durable task result",
        status: "in_progress",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().task.status).toBe("done");
    expect(providerRouter.toolRequests[0]?.systemPrompt).toContain(
      "separate memory-review pass",
    );
    expect(providerRouter.toolRequests[0]?.systemPrompt).toContain(
      "do not claim anything was saved",
    );
    expect(
      providerRouter.requests.find((request) =>
        request.systemPrompt?.includes("durable memory reviewer"),
      )?.messages.at(-1)?.content,
    ).toContain("completed Draftmora task execution");
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain(
      "successful task execution can save durable project facts",
    );
    await app.close();
    store.close();
  });

  it("injects local memory files into task execution context", async () => {
    const { app, store, dir, providerRouter } = createTestApp({
      runTaskExecutionsInline: true,
    });
    writeFileSync(
      path.join(dir, "USER.md"),
      "The user wants task agents to use concise release summaries.",
      "utf8",
    );
    writeFileSync(
      path.join(dir, "MEMORY.md"),
      "Draftmora board tasks should reuse the release validation checklist.",
      "utf8",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Run release validation task",
        status: "in_progress",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().task.status).toBe("done");
    expect(providerRouter.toolRequests[0]?.systemPrompt).toContain("<memory-context>");
    expect(providerRouter.toolRequests[0]?.systemPrompt).toContain(
      "concise release summaries",
    );
    expect(providerRouter.toolRequests[0]?.systemPrompt).toContain(
      "release validation checklist",
    );
    await app.close();
    store.close();
  });

  it("keeps follow-up work attached to the task execution history", async () => {
    const { app, store, providerRouter } = createTestApp({ runTaskExecutionsInline: true });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Explain release risk",
        status: "in_progress",
      },
    });
    const task = created.json().task;

    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Can you also list blockers?" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.task.status).toBe("done");
    expect(body.task.execution.status).toBe("succeeded");
    expect(body.task.execution.requestKind).toBe("follow_up");
    expect(body.task.execution.requestPrompt).toBe("Can you also list blockers?");
    expect(body.task.execution.output).toBe("Follow-up result from stub provider.");
    expect(body.task.execution.previousExecutions).toHaveLength(1);
    expect(body.task.execution.previousExecutions[0].requestKind).toBe("initial");
    expect(body.task.execution.previousExecutions[0].requestPrompt).toBe("Explain release risk");
    expect(body.task.execution.previousExecutions[0].output).toBe(
      "Initial result from stub provider.",
    );
    expect(body.task.execution.events.map((event: { message: string }) => event.message)).toEqual([
      "Follow-up queued.",
      "Work started.",
      "Work completed.",
    ]);
    const followUpPrompt = providerRouter.toolRequests.at(-1)?.context.messages.find(
      (message) => message.role === "user",
    );
    const followUpPromptContent =
      followUpPrompt?.role === "user" && typeof followUpPrompt.content === "string"
        ? followUpPrompt.content
        : "";
    expect(followUpPromptContent).toContain("Existing task results:");
    expect(followUpPromptContent).toContain("Initial result from stub provider.");
    await app.close();
    store.close();
  });

  it("cancels an active task run and ignores late provider output", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routes-abort-"));
    tempDirs.push(dir);
    const store = new BoardStore(path.join(dir, "board.db"));
    const providerRouter = new BlockingTaskProviderRouter(store);
    const app = buildServer({
      store,
      providerRouter,
      memoryRoot: dir,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Stop this run",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;

    await waitUntil(() => providerRouter.toolRequests.length === 1);

    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/abort`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().task.status).toBe("ready");
    expect(response.json().task.execution.status).toBe("cancelled");
    expect(response.json().task.execution.progressSummary).toBe("Work cancelled.");
    expect(response.json().task.execution.error).toBe("Cancelled by user.");
    expect(
      response
        .json()
        .task.execution.events.map((event: { kind: string }) => event.kind),
    ).toEqual(["queued", "running", "cancelled"]);
    expect(providerRouter.toolRequestSignals[0]?.aborted).toBe(true);

    providerRouter.resolveNextToolRequest("Late result that should not overwrite cancellation.");
    await flushQueuedPromises();

    const detailed = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(detailed.json().task.status).toBe("ready");
    expect(detailed.json().task.execution.status).toBe("cancelled");
    expect(detailed.json().task.execution.output).toContain("## Work cancelled");
    expect(detailed.json().task.execution.output).not.toContain("Late result");
    await app.close();
    store.close();
  });

  it("cancels a queued task execution even when no in-memory run owns it", async () => {
    const { app, store } = createTestApp();
    const task = store.createTask({
      title: "Queued run",
      status: "in_progress",
    });
    store.createTaskExecution({
      taskId: task.id,
      provider: "openai",
      model: "gpt-5.5",
      status: "queued",
      progressSummary: "Request queued.",
      events: [{ id: "", kind: "queued", message: "Request queued.", createdAt: "" }],
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/abort`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().task.status).toBe("ready");
    expect(response.json().task.execution.status).toBe("cancelled");
    expect(
      response
        .json()
        .task.execution.events.map((event: { kind: string }) => event.kind),
    ).toEqual(["queued", "cancelled"]);
    await app.close();
    store.close();
  });

  it("omits previous execution outputs from list responses but returns them on task detail", async () => {
    const { app, store } = createTestApp({ runTaskExecutionsInline: true });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Summarize release",
        status: "in_progress",
      },
    });
    const task = created.json().task;

    await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Add deployment notes." },
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/tasks",
    });
    const listedTask = listed.json().tasks.find((entry: { id: string }) => entry.id === task.id);
    expect(listedTask.execution.output).toBe("Follow-up result from stub provider.");
    expect(listedTask.execution.previousExecutions).toBeUndefined();

    const detailed = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(detailed.statusCode).toBe(200);
    expect(detailed.json().task.execution.previousExecutions).toHaveLength(1);
    await app.close();
    store.close();
  });

  it("queues a task follow-up until the active task run finishes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routes-queue-"));
    tempDirs.push(dir);
    const store = new BoardStore(path.join(dir, "board.db"));
    const providerRouter = new BlockingTaskProviderRouter(store);
    const app = buildServer({
      store,
      providerRouter,
      memoryRoot: dir,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Explain release risk",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;

    await waitUntil(() => providerRouter.toolRequests.length === 1);

    const followUp = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Can you also list blockers?" },
    });

    expect(followUp.statusCode).toBe(201);
    expect(followUp.json().task.execution.status).toBe("queued");
    expect(followUp.json().task.execution.requestKind).toBe("follow_up");
    expect(followUp.json().task.execution.requestPrompt).toBe("Can you also list blockers?");
    expect(followUp.json().task.execution.progressSummary).toBe("Follow-up queued.");
    expect(providerRouter.toolRequests).toHaveLength(1);

    providerRouter.resolveNextToolRequest("Initial result from delayed provider.");
    await waitUntil(() => providerRouter.toolRequests.length === 2);

    const followUpPrompt = providerRouter.toolRequests[1]?.context.messages.find(
      (message) => message.role === "user",
    );
    const followUpPromptContent =
      followUpPrompt?.role === "user" && typeof followUpPrompt.content === "string"
        ? followUpPrompt.content
        : "";
    expect(followUpPromptContent).toContain("Follow-up request: Can you also list blockers?");
    expect(followUpPromptContent).toContain("Existing task results:");
    expect(followUpPromptContent).toContain("Initial result from delayed provider.");

    providerRouter.resolveNextToolRequest("Follow-up result from delayed provider.");
    await waitUntil(
      () => store.getTask(task.id)?.execution?.output === "Follow-up result from delayed provider.",
    );

    expect(store.getTask(task.id)?.status).toBe("done");
    await app.close();
    store.close();
  });

  it("forces a queued follow-up without waiting behind the active task run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routes-force-follow-up-"));
    tempDirs.push(dir);
    const store = new BoardStore(path.join(dir, "board.db"));
    const providerRouter = new BlockingTaskProviderRouter(store);
    const app = buildServer({
      store,
      providerRouter,
      memoryRoot: dir,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Correct active work",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;
    await waitUntil(() => providerRouter.toolRequests.length === 1);

    const queued = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Use this correction immediately." },
    });
    expect(queued.statusCode).toBe(201);
    expect(queued.json().task.execution.status).toBe("queued");
    const queuedExecutionId = queued.json().task.execution.id;

    const forced = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up/${queuedExecutionId}/force`,
    });

    expect(forced.statusCode).toBe(200);
    expect(forced.json().task.execution.requestPrompt).toBe("Use this correction immediately.");
    expect(forced.json().task.execution.status).toBe("queued");
    expect(
      forced
        .json()
        .task.execution.events.map((event: { message: string }) => event.message),
    ).toContain("Forced follow-up queued.");
    expect(providerRouter.toolRequestSignals[0]?.aborted).toBe(true);
    await waitUntil(() => providerRouter.toolRequests.length === 2);
    expect(store.getTaskExecution(queuedExecutionId)?.status).toBe("running");

    const forcedPrompt = providerRouter.toolRequests[1]?.context.messages.find(
      (message) => message.role === "user",
    );
    const forcedPromptContent =
      forcedPrompt?.role === "user" && typeof forcedPrompt.content === "string"
        ? forcedPrompt.content
        : "";
    expect(forcedPromptContent).toContain("Follow-up request: Use this correction immediately.");

    providerRouter.resolveNextToolRequest("Late result that should remain cancelled.");
    await flushQueuedPromises();
    expect(store.getTask(task.id)?.status).toBe("in_progress");
    expect(providerRouter.toolRequests).toHaveLength(2);

    providerRouter.resolveNextToolRequest("Forced follow-up result.");
    await waitUntil(() => store.getTask(task.id)?.execution?.output === "Forced follow-up result.");

    const detailed = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(detailed.json().task.status).toBe("done");
    expect(detailed.json().task.execution.status).toBe("succeeded");
    expect(detailed.json().task.execution.id).toBe(queuedExecutionId);
    expect(detailed.json().task.execution.previousExecutions).toHaveLength(1);
    expect(
      detailed
        .json()
        .task.execution.previousExecutions.map((execution: { status: string }) => execution.status),
    ).toEqual(["cancelled"]);
    await app.close();
    store.close();
  });

  it("rejects forcing an older queued follow-up when a newer follow-up is queued", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routes-force-stale-follow-up-"));
    tempDirs.push(dir);
    const store = new BoardStore(path.join(dir, "board.db"));
    const providerRouter = new BlockingTaskProviderRouter(store);
    const app = buildServer({
      store,
      providerRouter,
      memoryRoot: dir,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Choose the latest correction",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;
    await waitUntil(() => providerRouter.toolRequests.length === 1);

    const firstQueued = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Older correction." },
    });
    expect(firstQueued.statusCode).toBe(201);
    const firstQueuedExecutionId = firstQueued.json().task.execution.id;

    const secondQueued = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Newer correction." },
    });
    expect(secondQueued.statusCode).toBe(201);
    const secondQueuedExecutionId = secondQueued.json().task.execution.id;
    expect(secondQueuedExecutionId).not.toBe(firstQueuedExecutionId);

    const forced = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up/${firstQueuedExecutionId}/force`,
    });

    expect(forced.statusCode).toBe(409);
    expect(forced.json().error).toBe("Only the latest queued follow-up can be forced.");
    expect(providerRouter.toolRequests).toHaveLength(1);
    expect(providerRouter.toolRequestSignals[0]?.aborted).toBe(false);

    const detailed = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(detailed.json().task.execution.id).toBe(secondQueuedExecutionId);
    expect(detailed.json().task.execution.requestPrompt).toBe("Newer correction.");
    expect(detailed.json().task.execution.status).toBe("queued");
    expect(store.getTaskExecution(firstQueuedExecutionId)?.status).toBe("queued");

    const abort = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/abort`,
    });
    expect(abort.statusCode).toBe(200);
    providerRouter.resolveNextToolRequest("Late result after stale force rejection.");
    await flushQueuedPromises();

    await app.close();
    store.close();
  });

  it("skips queued follow-up work when the task is deleted before it starts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routes-queue-delete-"));
    tempDirs.push(dir);
    const store = new BoardStore(path.join(dir, "board.db"));
    const providerRouter = new BlockingTaskProviderRouter(store);
    const app = buildServer({
      store,
      providerRouter,
      memoryRoot: dir,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Explain release risk",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;

    await waitUntil(() => providerRouter.toolRequests.length === 1);

    const followUp = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "Can you also list blockers?" },
    });
    expect(followUp.statusCode).toBe(201);
    expect(followUp.json().task.execution.status).toBe("queued");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
    });
    expect(deleted.statusCode).toBe(204);
    expect(store.getTask(task.id)).toBeNull();

    providerRouter.resolveNextToolRequest("Initial result from delayed provider.");
    await waitUntil(() => providerRouter.requests.length === 1);
    await flushQueuedPromises();

    expect(providerRouter.toolRequests).toHaveLength(1);
    expect(providerRouter.requests).toHaveLength(1);
    expect(store.getTask(task.id)).toBeNull();
    await app.close();
    store.close();
  });

  it("answers assistant chat requests with board context", async () => {
    const { app, store } = createTestApp();
    store.createTask({
      title: "Prioritize launch notes",
      status: "ready",
      priority: "high",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "What should I do next?" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.provider).toBe("openai");
    expect(body.model).toBe(store.getProviderConfig("openai").model);
    expect(body.conversation.title).toBe("What should I do next?");
    expect(body.conversations).toHaveLength(1);
    expect(body.message.role).toBe("assistant");
    expect(body.message.content).toBe("Chat response for: What should I do next?");
    expect(body.proposedActions).toEqual([]);
    expect(
      body.messages.map((message: { role: string; content: string }) => ({
        role: message.role,
        content: message.content,
      })),
    ).toEqual([
      { role: "user", content: "What should I do next?" },
      { role: "assistant", content: "Chat response for: What should I do next?" },
    ]);

    const history = await app.inject({
      method: "GET",
      url: "/api/assistant/chat",
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().activeConversationId).toBe(body.conversation.id);
    expect(history.json().messages).toHaveLength(2);
    await app.close();
    store.close();
  });

  it("extracts validated proposed task actions from assistant chat", async () => {
    const { app, store } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "Propose launch cleanup" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.message.content).toBe("I found one board change to approve.");
    expect(body.message.content).not.toContain("draftmora-actions");
    expect(body.proposedActions).toHaveLength(1);
    expect(body.proposedActions[0]).toMatchObject({
      type: "create_task",
      title: "Create launch notes task",
      rationale: "The launch notes are ready to become a task.",
      task: {
        title: "Draft launch notes",
        status: "ready",
        priority: "high",
      },
    });
    expect(body.message.proposedActions[0].id).toBe(body.proposedActions[0].id);
    expect(body.messages.at(-1).proposedActions[0].id).toBe(body.proposedActions[0].id);

    const history = await app.inject({ method: "GET", url: "/api/assistant/chat" });
    expect(history.json().messages.at(-1).content).toBe("I found one board change to approve.");
    expect(history.json().messages.at(-1).proposedActions).toBeUndefined();
    await app.close();
    store.close();
  });

  it("rejects malformed proposed task patches before returning actions", async () => {
    const { app, store } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "Bad proposal please" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.message.content).toBe("This proposal is malformed.");
    expect(body.message.content).not.toContain("draftmora-actions");
    expect(body.proposedActions).toEqual([]);
    expect(body.message.proposedActions).toEqual([]);
    await app.close();
    store.close();
  });

  it("extracts conservative prose task proposals when action JSON is missing", async () => {
    const { app, store } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "Prose proposal please" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.proposedActions).toHaveLength(1);
    expect(body.proposedActions[0]).toMatchObject({
      type: "create_task",
      title: "Create Review launch checklist",
      rationale: "Assistant proposed this board change.",
      task: {
        title: "Review launch checklist",
        status: "ready",
        priority: "medium",
        providerSource: "local",
      },
    });
    expect(body.message.proposedActions[0].id).toBe(body.proposedActions[0].id);
    await app.close();
    store.close();
  });

  it("extracts natural proposal phrasing into an approval action", async () => {
    const { app, store } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "Natural proposal please" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.proposedActions).toHaveLength(1);
    expect(body.proposedActions[0]).toMatchObject({
      type: "create_task",
      title: "Create QA task with disposable data",
      task: {
        title: "QA task with disposable data",
        status: "ready",
        priority: "medium",
        providerSource: "local",
      },
    });
    await app.close();
    store.close();
  });

  it("extracts action envelopes from generic JSON code blocks", async () => {
    const { app, store } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "JSON proposal please" }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.message.content).toBe("I drafted one board change.");
    expect(body.proposedActions).toHaveLength(1);
    expect(body.proposedActions[0]).toMatchObject({
      type: "create_task",
      title: "Create support checklist",
      task: {
        title: "Review support checklist",
        status: "ready",
      },
    });
    await app.close();
    store.close();
  });

  it("keeps assistant chat history isolated by conversation", async () => {
    const { app, store, providerRouter } = createTestApp();

    const first = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "First conversation" }],
      },
    });
    const firstConversationId = first.json().conversation.id as string;

    const second = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "Second conversation" }],
      },
    });
    const secondConversationId = second.json().conversation.id as string;

    const followUp = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        conversationId: firstConversationId,
        messages: [
          { role: "user", content: "First conversation" },
          { role: "assistant", content: "Chat response for: First conversation" },
          { role: "user", content: "Follow the first thread" },
        ],
      },
    });

    expect(followUp.statusCode).toBe(201);
    expect(
      providerRouter.requests.at(-1)?.messages.map((message) => message.content),
    ).toEqual([
      "First conversation",
      "Chat response for: First conversation",
      "Follow the first thread",
    ]);

    const firstHistory = await app.inject({
      method: "GET",
      url: `/api/assistant/chat?conversationId=${firstConversationId}`,
    });
    const secondHistory = await app.inject({
      method: "GET",
      url: `/api/assistant/chat?conversationId=${secondConversationId}`,
    });

    expect(firstHistory.json().messages.map((message: { content: string }) => message.content)).toEqual([
      "First conversation",
      "Chat response for: First conversation",
      "Follow the first thread",
      "Chat response for: Follow the first thread",
    ]);
    expect(secondHistory.json().messages.map((message: { content: string }) => message.content)).toEqual([
      "Second conversation",
      "Chat response for: Second conversation",
    ]);
    await app.close();
    store.close();
  });

  it("injects local memory files into assistant chat context", async () => {
    const { app, store, dir, providerRouter } = createTestApp();
    store.createTask({
      title: "Prepare remembered release checklist",
      status: "ready",
      priority: "high",
    });
    writeFileSync(
      path.join(dir, "USER.md"),
      [
        "User prefers concise repo status summaries.",
        "§",
        "When the user asks to work with repos, use the workspace path from the task notes.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(dir, "MEMORY.md"),
      [
        "Draftmora uses the local memory file pattern.",
        "§",
        "The validation command set is npm run typecheck, npm test, and npm run build.",
      ].join("\n"),
      "utf8",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "Where is the Ruby repo?" }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(providerRouter.requests.at(-1)?.systemPrompt).toContain(
      "Prepare remembered release checklist",
    );
    expect(providerRouter.requests.at(-1)?.systemPrompt).toContain("workspace path from the task notes");
    expect(providerRouter.requests.at(-1)?.systemPrompt).toContain(
      "USER PROFILE (who the user is)",
    );
    expect(providerRouter.requests.at(-1)?.systemPrompt).toContain(
      "MEMORY (your personal notes)",
    );
    expect(providerRouter.requests.at(-1)?.systemPrompt).toContain("<memory-context>");
    await app.close();
    store.close();
  });

  it("saves reviewer-approved durable memory before responding", async () => {
    const { app, store, dir, providerRouter } = createTestApp();
    providerRouter.memoryReviewResponses.push(
      JSON.stringify({
        entries: [
          {
            target: "user",
            content:
              "When the user asks to work with repos, use the workspace path from the task notes.",
          },
        ],
      }),
      JSON.stringify({
        entries: [
          {
            target: "user",
            content: "The user prefers concise repo status summaries.",
          },
        ],
      }),
      JSON.stringify({
        entries: [
          {
            target: "memory",
            content:
              "Draftmora validation workflow uses npm run typecheck, npm test, and npm run build.",
          },
        ],
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [
          {
            role: "user",
            content:
              "For repo work, I use the workspace path from the task notes.",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(201);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [
          {
            role: "user",
            content: "I prefer concise repo status summaries.",
          },
        ],
      },
    });
    expect(secondResponse.statusCode).toBe(201);

    const thirdResponse = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [
          {
            role: "user",
            content: "Draftmora validation workflow uses npm run typecheck, npm test, and npm run build.",
          },
        ],
      },
    });
    expect(thirdResponse.statusCode).toBe(201);

    const userMemory = readFileSync(path.join(dir, "USER.md"), "utf8");
    expect(userMemory).toContain("workspace path from the task notes");
    expect(userMemory).toContain("\n§\n");
    expect(userMemory).not.toContain("##");
    const memory = readFileSync(path.join(dir, "MEMORY.md"), "utf8");
    expect(memory).toContain("validation workflow uses npm run typecheck");
    expect(memory).not.toContain("##");
    await app.close();
    store.close();
  });

  it("uses automatic memory review for durable user facts across conversations", async () => {
    const { app, store, dir, providerRouter } = createTestApp();
    providerRouter.memoryReviewResponses.push(
      JSON.stringify({
        entries: [{ target: "user", content: "The user's name is Andrii." }],
      }),
    );

    const saved = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "my name is andrii" }],
      },
    });
    expect(saved.statusCode).toBe(201);
    expect(readFileSync(path.join(dir, "USER.md"), "utf8")).toContain(
      "The user's name is Andrii.",
    );

    const recalled = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "what is my name?" }],
      },
    });

    expect(recalled.statusCode).toBe(201);
    expect(recalled.json().message.content).toBe("Your name is Andrii.");
    expect(
      providerRouter.requests.some((request) =>
        request.systemPrompt?.includes("durable memory reviewer"),
      ),
    ).toBe(true);
    expect(
      providerRouter.requests
        .filter((request) => request.systemPrompt?.includes("durable memory reviewer"))
        .at(-1)
        ?.messages.at(-1)?.content,
    ).toContain("The user's name is Andrii.");
    expect(providerRouter.requests.at(-1)?.systemPrompt).toContain("The user's name is Andrii.");
    await app.close();
    store.close();
  });

  it("applies reviewer removals when durable memory is corrected", async () => {
    const { app, store, dir, providerRouter } = createTestApp();
    providerRouter.memoryReviewResponses.push(
      JSON.stringify({
        entries: [{ target: "user", content: "The user's name is Andrii." }],
        remove: [],
      }),
      JSON.stringify({
        remove: [{ target: "user", content: "The user's name is Andrii." }],
        entries: [{ target: "user", content: "The user's name is Bohdan." }],
      }),
    );

    const saved = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "my name is andrii" }],
      },
    });
    expect(saved.statusCode).toBe(201);

    const corrected = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [{ role: "user", content: "actually my name is Bohdan" }],
      },
    });
    expect(corrected.statusCode).toBe(201);

    const userMemory = readFileSync(path.join(dir, "USER.md"), "utf8");
    expect(userMemory).not.toContain("Andrii");
    expect(userMemory).toContain("The user's name is Bohdan.");
    await app.close();
    store.close();
  });

  it("saves only reviewer-approved memory content from a mixed user turn", async () => {
    const { app, store, dir, providerRouter } = createTestApp();
    providerRouter.memoryReviewResponses.push(
      JSON.stringify({
        entries: [
          {
            target: "memory",
            content: "Draftmora release checks use typecheck, tests, and build.",
          },
        ],
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      payload: {
        messages: [
          {
            role: "user",
            content:
              "please remember that Draftmora release checks use typecheck, tests, and build. Then reply in one short sentence.",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const memory = readFileSync(path.join(dir, "MEMORY.md"), "utf8");
    expect(memory).toContain("Draftmora release checks use typecheck, tests, and build");
    expect(memory).not.toContain("Then reply");
    expect(
      providerRouter.requests.find((request) =>
        request.systemPrompt?.includes("durable memory reviewer"),
      )?.messages.at(-1)?.content,
    ).toContain("Then reply in one short sentence");
    await app.close();
    store.close();
  });

  it("cancels queued follow-ups together with the active task run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routes-abort-queue-"));
    tempDirs.push(dir);
    const store = new BoardStore(path.join(dir, "board.db"));
    const providerRouter = new BlockingTaskProviderRouter(store);
    const app = buildServer({
      store,
      providerRouter,
      memoryRoot: dir,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Stop queued follow-up",
        status: "in_progress",
      },
    });
    const task = created.json().task as Task;
    await waitUntil(() => providerRouter.toolRequests.length === 1);

    const followUp = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/follow-up`,
      payload: { prompt: "This should not run after cancellation." },
    });
    expect(followUp.statusCode).toBe(201);
    expect(followUp.json().task.execution.status).toBe("queued");

    const abort = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/abort`,
    });
    expect(abort.statusCode).toBe(200);
    expect(abort.json().task.status).toBe("ready");
    expect(abort.json().task.execution.status).toBe("cancelled");
    expect(abort.json().task.execution.previousExecutions[0].status).toBe("cancelled");

    providerRouter.resolveNextToolRequest("Late result.");
    await flushQueuedPromises();
    expect(providerRouter.toolRequests).toHaveLength(1);

    const detailed = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(detailed.json().task.execution.status).toBe("cancelled");
    expect(detailed.json().task.execution.previousExecutions[0].status).toBe("cancelled");
    await app.close();
    store.close();
  });

  it("redacts API-key shaped provider errors before storing task execution failures", async () => {
    const { app, store } = createTestApp({ runTaskExecutionsInline: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "Invalid key failure",
        status: "in_progress",
      },
    });

    expect(response.statusCode).toBe(201);
    const error = response.json().task.execution.error as string;
    expect(response.json().task.status).toBe("needs_attention");
    expect(error).toContain("sk-[redacted]");
    expect(error).not.toContain("sk-draft");
    expect(error).not.toContain("5-04");
    expect(response.json().task.execution.output).toContain("Failure handoff");
    expect(response.json().task.execution.output).toContain("Status: needs_attention");
    expect(response.json().task.execution.output).not.toContain("Recent agent log");
    await app.close();
    store.close();
  });

  it("does not expose manual memory management routes", async () => {
    const { app, store } = createTestApp();

    const response = await app.inject({ method: "GET", url: "/api/memory" });

    expect(response.statusCode).toBe(404);
    await app.close();
    store.close();
  });
});
