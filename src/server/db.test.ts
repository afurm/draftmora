import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoardStore } from "./db";

const tempDirs: string[] = [];

function createStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "local-board-"));
  tempDirs.push(dir);
  return new BoardStore(path.join(dir, "board.db"));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("BoardStore", () => {
  it("starts a new board without seeded tasks", () => {
    const store = createStore();
    expect(store.listTasks()).toEqual([]);
    store.close();
  });

  it("creates, updates, moves, and deletes tasks", () => {
    const store = createStore();
    const workArea = store
      .getSettings()
      .userProfile.focusAreas.find((area) => area.id === "work");
    const task = store.createTask({
      title: "Ship local board",
      priority: "high",
      focusAreaId: workArea?.id,
      tags: ["feature"],
    });

    expect(task.status).toBe("draft");
    expect(task.focusAreaId).toBe(workArea?.id);
    expect(store.listTasks().some((entry) => entry.id === task.id)).toBe(true);

    const moved = store.updateTask(task.id, { status: "in_progress", focusAreaId: null });
    expect(moved?.status).toBe("in_progress");
    expect(moved?.focusAreaId).toBeNull();

    expect(store.deleteTask(task.id)).toBe(true);
    expect(store.getTask(task.id)).toBeNull();
    store.close();
  });

  it("moves tasks with failed latest executions into needs attention on reopen", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "local-board-failed-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "board.db");
    const store = new BoardStore(dbPath);
    const task = store.createTask({
      title: "Failed agent work",
      status: "in_progress",
    });
    store.createTaskExecution({
      taskId: task.id,
      provider: "openai",
      status: "failed",
      progressSummary: "Work needs attention.",
      error: "Command failed.",
    });
    store.close();

    const reopened = new BoardStore(dbPath);
    expect(reopened.getTask(task.id)?.status).toBe("needs_attention");
    expect(reopened.getTask(task.id)?.execution?.output).toContain("Failure handoff");
    expect(reopened.getTask(task.id)?.execution?.output).toContain("Move the task back to In Progress");
    reopened.close();
  });

  it("keeps execution history out of task lists but available on task detail", () => {
    const store = createStore();
    const task = store.createTask({
      title: "Review deployment",
      status: "done",
    });

    store.createTaskExecution({
      taskId: task.id,
      provider: "openai",
      status: "succeeded",
      output: "First result.",
    });
    store.createTaskExecution({
      taskId: task.id,
      provider: "openai",
      status: "succeeded",
      output: "Second result.",
      requestKind: "follow_up",
      requestPrompt: "Add deployment notes.",
    });

    const listed = store.listTasks().find((entry) => entry.id === task.id);
    expect(listed?.execution?.output).toBe("Second result.");
    expect(listed?.execution?.previousExecutions).toBeUndefined();

    const detailed = store.getTask(task.id);
    expect(detailed?.execution?.output).toBe("Second result.");
    expect(detailed?.execution?.requestKind).toBe("follow_up");
    expect(detailed?.execution?.requestPrompt).toBe("Add deployment notes.");
    expect(detailed?.execution?.previousExecutions).toHaveLength(1);
    expect(detailed?.execution?.previousExecutions?.[0]?.output).toBe("First result.");
    expect(detailed?.execution?.previousExecutions?.[0]?.requestKind).toBe("initial");
    expect(detailed?.execution?.previousExecutions?.[0]?.requestPrompt).toBe("");
    store.close();
  });

  it("persists configurable focus areas in settings", () => {
    const store = createStore();

    const settings = store.patchSettings({
      userProfile: {
        workAreas: ["Client"],
        focusAreas: [{ id: "client", label: "Client", color: "rose" }],
      },
    });

    expect(settings.userProfile.workAreas).toEqual(["Client"]);
    expect(settings.userProfile.focusAreas).toEqual([
      { id: "client", label: "Client", color: "rose" },
    ]);
    store.close();
  });

  it("persists advanced OpenAI provider configuration", () => {
    const previousOrgId = process.env.OPENAI_ORG_ID;
    const previousOrganization = process.env.OPENAI_ORGANIZATION;
    const previousProjectId = process.env.OPENAI_PROJECT_ID;
    const previousProject = process.env.OPENAI_PROJECT;
    delete process.env.OPENAI_ORG_ID;
    delete process.env.OPENAI_ORGANIZATION;
    delete process.env.OPENAI_PROJECT_ID;
    delete process.env.OPENAI_PROJECT;
    const store = createStore();

    try {
      const settings = store.patchSettings({
        providerConfigs: [
          {
            provider: "openai",
            authMode: "api_key",
            model: "gpt-5.5",
            maxTokens: 8192,
            temperature: 0.3,
            reasoningEffort: "high",
            reasoningSummary: "concise",
            textVerbosity: "medium",
            timeoutMs: 90_000,
            maxRetries: 4,
            maxRetryDelayMs: 20_000,
            cacheRetention: "long",
            transport: "websocket",
            organizationId: "org_local",
            projectId: "proj_local",
          },
        ],
      });

      expect(settings.providerConfigs[0]).toMatchObject({
        authMode: "api_key",
        maxTokens: 8192,
        temperature: 0.3,
        reasoningEffort: "high",
        reasoningSummary: "concise",
        textVerbosity: "medium",
        timeoutMs: 90_000,
        maxRetries: 4,
        maxRetryDelayMs: 20_000,
        cacheRetention: "long",
        transport: "websocket",
        organizationId: "org_local",
        projectId: "proj_local",
      });
      expect(store.resolveHeadersForProvider("openai")).toEqual({
        "OpenAI-Organization": "org_local",
        "OpenAI-Project": "proj_local",
      });
    } finally {
      store.close();
      restoreEnv("OPENAI_ORG_ID", previousOrgId);
      restoreEnv("OPENAI_ORGANIZATION", previousOrganization);
      restoreEnv("OPENAI_PROJECT_ID", previousProjectId);
      restoreEnv("OPENAI_PROJECT", previousProject);
    }
  });

  it("ignores focus areas that are not in settings", () => {
    const store = createStore();
    const task = store.createTask({
      title: "Unknown focus area",
      focusAreaId: "does-not-exist",
    });

    expect(task.focusAreaId).toBeNull();
    store.close();
  });

  it("persists assistant chat messages", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "local-board-chat-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "board.db");
    const store = new BoardStore(dbPath);
    const conversation = store.createAssistantChatConversation({ title: "Planning" });

    const user = store.appendAssistantChatMessage({
      conversationId: conversation.id,
      role: "user",
      content: "What should I do next?",
    });
    const assistant = store.appendAssistantChatMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Start with the ready task.",
    });
    store.close();

    const reopened = new BoardStore(dbPath);
    expect(reopened.listAssistantChatConversations()).toMatchObject([
      { id: conversation.id, title: "Planning" },
    ]);
    expect(reopened.listAssistantChatMessages(conversation.id)).toMatchObject([
      {
        id: user.id,
        conversationId: conversation.id,
        role: "user",
        content: "What should I do next?",
      },
      {
        id: assistant.id,
        conversationId: conversation.id,
        role: "assistant",
        content: "Start with the ready task.",
      },
    ]);
    reopened.close();
  });

  it("keeps assistant chat histories scoped to their conversation", () => {
    const store = createStore();
    const planning = store.createAssistantChatConversation({ title: "Planning" });
    const writing = store.createAssistantChatConversation({ title: "Writing" });

    store.appendAssistantChatMessage({
      conversationId: planning.id,
      role: "user",
      content: "Plan my day",
    });
    store.appendAssistantChatMessage({
      conversationId: writing.id,
      role: "user",
      content: "Draft the launch note",
    });

    expect(store.listAssistantChatMessages(planning.id)).toMatchObject([
      { conversationId: planning.id, content: "Plan my day" },
    ]);
    expect(store.listAssistantChatMessages(writing.id)).toMatchObject([
      { conversationId: writing.id, content: "Draft the launch note" },
    ]);
    store.close();
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
