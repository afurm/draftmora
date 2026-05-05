import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  FOCUS_AREA_COLORS,
  PRIORITIES,
  PROVIDERS,
  TASK_STATUSES,
  type AssistantProposedAction,
  type ProviderId,
  type Task,
} from "../shared/types";
import { BoardStore } from "./db";
import {
  buildMemoryContextBlock,
  reviewAndApplyMemory,
  type MemoryReviewLogger,
} from "./memory";
import {
  clearOpenAiOAuthLogin,
  getOpenAiAccountInfo,
  getOpenAiAuthState,
  startOpenAiOAuthLogin,
  submitOpenAiOAuthInput,
} from "./providers/openai-auth";
import { ProviderRouter } from "./providers/router";
import {
  startTaskExecutionForTask,
  startTaskFollowUpExecutionForTask,
} from "./task-executor";

const taskCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional().default(""),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  focusAreaId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  providerSource: z.union([z.enum(PROVIDERS), z.literal("local")]).nullable().optional(),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  title: z.string().trim().min(1).optional(),
});

const taskFollowUpSchema = z.object({
  prompt: z.string().trim().min(1),
});

const settingsPatchSchema = z.object({
  selectedProvider: z.enum(PROVIDERS).optional(),
  providerConfigs: z
    .array(
      z.object({
        provider: z.enum(PROVIDERS),
        label: z.string().optional(),
        model: z.string().optional(),
        baseUrl: z.string().nullable().optional(),
        authMode: z.enum(["oauth", "api_key"]).optional(),
        enabled: z.boolean().optional(),
        fallbackRank: z.number().optional(),
        apiKey: z.string().nullable().optional(),
      }),
    )
    .optional(),
  userProfile: z
    .object({
      workAreas: z.array(z.string()),
      focusAreas: z
        .array(
          z.object({
            id: z.string().optional(),
            label: z.string(),
            color: z.enum(FOCUS_AREA_COLORS).optional(),
          }),
        )
        .optional(),
      preferredPlanningStyle: z.string().optional(),
      recurringCommitments: z.array(z.string()).optional(),
      learnedPreferences: z.array(z.string()).optional(),
    })
    .optional(),
});

const openAiOAuthInputSchema = z.object({
  loginId: z.string(),
  input: z.string(),
});

const assistantChatSchema = z.object({
  conversationId: z.string().trim().min(1).nullable().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .min(1)
    .max(24),
});

const assistantChatHistoryQuerySchema = z.object({
  conversationId: z.string().trim().min(1).optional(),
});

const assistantChatConversationCreateSchema = z.object({
  title: z.string().trim().min(1).max(72).optional(),
});

const taskPatchProposalSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  focusAreaId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  providerSource: z.union([z.enum(PROVIDERS), z.literal("local")]).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one task field is required.",
});

const proposedActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    title: z.string().trim().min(1).max(120),
    rationale: z.string().trim().max(600).optional(),
    task: taskCreateSchema,
  }),
  z.object({
    type: z.literal("update_task"),
    title: z.string().trim().min(1).max(120),
    rationale: z.string().trim().max(600).optional(),
    taskId: z.string().trim().min(1),
    patch: taskPatchProposalSchema,
  }),
  z.object({
    type: z.literal("move_task"),
    title: z.string().trim().min(1).max(120),
    rationale: z.string().trim().max(600).optional(),
    taskId: z.string().trim().min(1),
    status: z.enum(TASK_STATUSES),
  }),
]);

const proposedActionsEnvelopeSchema = z.object({
  actions: z.array(proposedActionSchema).max(6),
});

export function buildServer(options: {
  store?: BoardStore;
  providerRouter?: ProviderRouter;
  runTaskExecutionsInline?: boolean;
  memoryRoot?: string;
} = {}) {
  const store = options.store ?? new BoardStore();
  const providerRouter = options.providerRouter ?? new ProviderRouter(store);
  const memoryRoot = options.memoryRoot ?? process.cwd();
  const app = Fastify({ logger: false });
  const memoryReviewLogger: MemoryReviewLogger = {
    warn: (message) => console.warn(message),
  };

  void app.register(cors, {
    origin: true,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Invalid request", details: error.flatten() });
    }
    return reply.status(500).send({
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  });

  app.get("/api/tasks", async () => ({ tasks: store.listTasks() }));

  app.post("/api/tasks", async (request, reply) => {
    const input = taskCreateSchema.parse(request.body);
    const task = store.createTask(input);
    const execution = await maybeStartTaskExecution(task);
    const latestTask = store.getTask(task.id) ?? task;
    const latestExecution = latestTask.execution ?? execution;
    return reply
      .status(201)
      .send(latestExecution ? { task: latestTask, execution: latestExecution } : { task });
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const input = taskUpdateSchema.parse(request.body);
    const previous = store.getTask(request.params.id);
    const task = store.updateTask(request.params.id, input);
    if (!task) {
      return reply.status(404).send({ error: "Task not found" });
    }
    const execution =
      previous?.status !== "in_progress" && input.status === "in_progress"
        ? await maybeStartTaskExecution(task)
        : null;
    const latestTask = store.getTask(task.id) ?? task;
    const latestExecution = latestTask.execution ?? execution;
    return latestExecution ? { task: latestTask, execution: latestExecution } : { task: latestTask };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/follow-up", async (request, reply) => {
    const input = taskFollowUpSchema.parse(request.body);
    const task = store.getTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: "Task not found" });
    }
    const followUpTask =
      task.status === "done" || task.execution?.status === "succeeded"
        ? (store.updateTask(task.id, { status: "done" }) ?? task)
        : task;
    const execution = await startTaskFollowUpExecutionForTask({
      store,
      router: providerRouter,
      task: followUpTask,
      provider: store.getSettings().selectedProvider,
      followUp: input.prompt,
      runInline: options.runTaskExecutionsInline,
      memoryRoot,
      memoryLogger: memoryReviewLogger,
    });
    const latestTask = store.getTask(followUpTask.id) ?? followUpTask;
    return reply.status(201).send({
      task: latestTask,
      execution: latestTask.execution ?? execution,
    });
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    if (!store.deleteTask(request.params.id)) {
      return reply.status(404).send({ error: "Task not found" });
    }
    return reply.status(204).send();
  });

  app.get("/api/settings", async () => store.getSettings());

  app.patch("/api/settings", async (request) => {
    const input = settingsPatchSchema.parse(request.body);
    return store.patchSettings(input as Parameters<BoardStore["patchSettings"]>[0]);
  });

  app.get("/api/providers/status", async () => ({
    providers: providerRouter.statuses(),
  }));

  app.get("/api/providers/openai/auth", async () => getOpenAiAuthState(store));

  app.get("/api/providers/openai/account-info", async () => getOpenAiAccountInfo(store));

  app.post("/api/providers/openai/auth/start", async () => startOpenAiOAuthLogin(store));

  app.post("/api/providers/openai/auth/input", async (request) => {
    const input = openAiOAuthInputSchema.parse(request.body);
    return submitOpenAiOAuthInput(store, input);
  });

  app.post("/api/providers/openai/auth/logout", async () => clearOpenAiOAuthLogin(store));

  app.post("/api/assistant/chat/conversations", async (request, reply) => {
    const input = assistantChatConversationCreateSchema.parse(request.body ?? {});
    const conversation = store.createAssistantChatConversation(input);
    return reply.status(201).send({
      conversations: store.listAssistantChatConversations(),
      activeConversationId: conversation.id,
      messages: [],
    });
  });

  app.get("/api/assistant/chat", async (request, reply) => {
    const query = assistantChatHistoryQuerySchema.parse(request.query);
    const history = getAssistantChatHistory(query.conversationId);
    if (!history) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    return history;
  });

  app.post("/api/assistant/chat", async (request, reply) => {
    const input = assistantChatSchema.parse(request.body);
    if (input.messages.at(-1)?.role !== "user") {
      return reply.status(400).send({ error: "Last chat message must come from the user." });
    }
    const userTurn = input.messages.at(-1)!;
    const conversation =
      input.conversationId === null || input.conversationId === undefined
        ? store.createAssistantChatConversation({ title: userTurn.content })
        : store.getAssistantChatConversation(input.conversationId);
    if (!conversation) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    store.appendAssistantChatMessage({
      conversationId: conversation.id,
      role: userTurn.role,
      content: userTurn.content,
    });
    const provider = store.getSettings().selectedProvider as ProviderId;
    const config = store.getProviderConfig(provider);
    await reviewAndSaveMemory(userTurn.content, conversation.id, provider, config.model);
    const history = store.listAssistantChatMessages(conversation.id, 24);
    const result = await providerRouter.complete({
      provider,
      model: config.model,
      systemPrompt: buildAssistantChatSystemPrompt(store, userTurn.content, memoryRoot),
      messages: history.map((message) => ({ role: message.role, content: message.content })),
      maxTokens: 1400,
    });
    const parsedResult = parseAssistantChatResult(result.content || "I did not get a usable response.");
    const message = store.appendAssistantChatMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: parsedResult.content,
    });
    const messageWithActions = {
      ...message,
      proposedActions: parsedResult.proposedActions,
    };
    const updatedConversation = store.getAssistantChatConversation(conversation.id) ?? conversation;
    const messages = store.listAssistantChatMessages(conversation.id).map((historyMessage) =>
      historyMessage.id === message.id ? messageWithActions : historyMessage,
    );
    return reply.status(201).send({
      conversation: updatedConversation,
      conversations: store.listAssistantChatConversations(),
      message: messageWithActions,
      messages,
      proposedActions: parsedResult.proposedActions,
      provider,
      model: config.model,
    });
  });

  function getAssistantChatHistory(conversationId?: string | null) {
    const conversations = store.listAssistantChatConversations();
    const conversation = conversationId
      ? store.getAssistantChatConversation(conversationId)
      : conversations[0] ?? null;
    if (conversationId && !conversation) {
      return null;
    }
    return {
      conversations,
      activeConversationId: conversation?.id ?? null,
      messages: conversation ? store.listAssistantChatMessages(conversation.id) : [],
    };
  }

  async function maybeStartTaskExecution(task: Task) {
    if (task.status !== "in_progress") {
      return null;
    }
    return startTaskExecutionForTask({
      store,
      router: providerRouter,
      task,
      provider: store.getSettings().selectedProvider as ProviderId,
      runInline: options.runTaskExecutionsInline,
      memoryRoot,
      memoryLogger: memoryReviewLogger,
    });
  }

  async function reviewAndSaveMemory(
    userMessage: string,
    conversationId: string,
    provider: ProviderId,
    model: string,
  ): Promise<void> {
    const messages = store
      .listAssistantChatMessages(conversationId, 12)
      .map((message) => ({ role: message.role, content: message.content }));
    if (!messages.some((message) => message.role === "user" && message.content === userMessage)) {
      messages.push({ role: "user", content: userMessage });
    }
    await reviewAndApplyMemory({
      providerRouter,
      provider,
      model,
      messages,
      query: userMessage,
      memoryRoot,
      source: "chat",
      logger: memoryReviewLogger,
    });
  }

  return app;
}

function buildAssistantChatSystemPrompt(
  store: BoardStore,
  query: string,
  memoryRoot: string,
): string {
  const settings = store.getSettings();
  const tasks = store.listTasks();
  const counts = Object.fromEntries(
    TASK_STATUSES.map((status) => [
      status,
      tasks.filter((task) => task.status === status).length,
    ]),
  ) as Record<Task["status"], number>;
  const activeTasks = tasks
    .filter((task) => task.status !== "done")
    .slice(-12)
    .map((task) => {
      const focusArea = settings.userProfile.focusAreas.find((area) => area.id === task.focusAreaId);
      return [
        `- ${task.title}`,
        `id: ${task.id}`,
        `status: ${task.status}`,
        `priority: ${task.priority}`,
        `focus: ${focusArea?.label ?? "none"}`,
      ].join(" | ");
    })
    .join("\n");
  const focusAreas = settings.userProfile.focusAreas
    .map((area) => `${area.label} (${area.id})`)
    .join(", ");

  return [
    "You are Draftmora's right-side agent chat.",
    "Answer the user's question in concise Markdown.",
    "Use the local task board context when it helps.",
    "You may propose task changes, but you must never say they were applied. The app will show proposals for explicit user approval.",
    "If the user asks you to propose, add, create, update, move, clean up, or plan board changes, always include the draftmora-actions code block for those changes.",
    "When proposing board changes, append one fenced code block with language draftmora-actions and JSON shaped as {\"actions\":[...]} after the readable answer.",
    "Allowed action types are create_task with task, update_task with taskId and patch, and move_task with taskId and status. Use only task IDs shown in Active tasks for update_task or move_task.",
    "Keep proposal JSON out of the prose. Do not include more than 6 actions.",
    "You have persistent local memory. Use recalled memory only when it is relevant. Do not claim a fact was saved unless the relevant fact is present in the recalled memory context.",
    "Do not claim to create, update, delete, or move tasks. If the user asks for that, provide the exact task details to add or change.",
    `Focus areas: ${focusAreas || "none"}.`,
    `Board counts: draft ${counts.draft}, ready ${counts.ready}, in progress ${counts.in_progress}, needs attention ${counts.needs_attention}, done ${counts.done}.`,
    activeTasks ? `Active tasks:\n${activeTasks}` : "Active tasks: none.",
    buildMemoryContextBlock({ query, rootDir: memoryRoot }),
  ].join("\n");
}

function parseAssistantChatResult(rawContent: string): {
  content: string;
  proposedActions: AssistantProposedAction[];
} {
  const blocks: string[] = [];
  const content = rawContent
    .replace(/```([a-z0-9_-]*)\s*([\s\S]*?)```/gi, (match, language: string, block: string) => {
      const normalizedLanguage = language.trim().toLowerCase();
      if (normalizedLanguage === "draftmora-actions" || block.includes('"actions"')) {
        blocks.push(block);
        return "";
      }
      return match;
    })
    .trim();
  const blockActions = blocks.flatMap((block) => parseProposedActionsBlock(block));
  const proposedActions =
    blockActions.length > 0 ? blockActions : parseReadableProposedActions(content);
  return {
    content: content || (proposedActions.length > 0
      ? "I drafted board changes for your approval."
      : "I did not get a usable response."),
    proposedActions,
  };
}

function parseProposedActionsBlock(block: string): AssistantProposedAction[] {
  try {
    const parsed = proposedActionsEnvelopeSchema.safeParse(JSON.parse(block));
    if (!parsed.success) {
      return [];
    }
    return parsed.data.actions.map((action) => ({ ...action, id: randomUUID() }));
  } catch {
    return [];
  }
}

function parseReadableProposedActions(content: string): AssistantProposedAction[] {
  const actions: AssistantProposedAction[] = [];
  const seen = new Set<string>();
  const addCreateTaskAction = (titleValue: string, statusValue?: string) => {
    const title = normalizeReadableTaskTitle(titleValue);
    if (!title || seen.has(title.toLowerCase()) || actions.length >= 6) {
      return;
    }
    const status = normalizeReadableTaskStatus(statusValue);
    const parsed = proposedActionSchema.safeParse({
      type: "create_task",
      title: `Create ${title}`,
      rationale: "Assistant proposed this board change.",
      task: {
        title,
        status,
        priority: "medium",
        providerSource: "local",
      },
    });
    if (parsed.success) {
      seen.add(title.toLowerCase());
      actions.push({ ...parsed.data, id: randomUUID() });
    }
  };

  const namedCreateTaskPatterns = [
    /(?:Proposed board change|Proposed action|Proposal)\s*:\s*create\s+(?:a\s+)?(?:(draft|ready|in progress|in_progress|needs attention|needs_attention|done)\s+)?task\s+(?:named|called|titled)\s+(?:"([^"]+)"|'([^']+)'|“([^”]+)”|\*\*([^*]+)\*\*|`([^`]+)`|([^.\n]+))/gi,
    /(?:I\s+)?(?:propose|proposed|suggest|suggested|recommend|recommended)\s+(?:one\s+|a\s+)?(?:board\s+change\s+to\s+)?(?:create|add)\s+(?:a\s+|one\s+)?(?:(draft|ready|in progress|in_progress|needs attention|needs_attention|done)\s+)?task\s+(?:named|called|titled)\s+(?:"([^"]+)"|'([^']+)'|“([^”]+)”|\*\*([^*]+)\*\*|`([^`]+)`|([^.\n]+))/gi,
    /(?:create|add)\s+(?:a\s+|one\s+)?(?:(draft|ready|in progress|in_progress|needs attention|needs_attention|done)\s+)?task\s+(?:named|called|titled)\s+(?:"([^"]+)"|'([^']+)'|“([^”]+)”|\*\*([^*]+)\*\*|`([^`]+)`|([^.\n]+))/gi,
  ];

  for (const pattern of namedCreateTaskPatterns) {
    for (const match of content.matchAll(pattern)) {
      const status = normalizeReadableTaskStatusCandidate(match);
      const title =
        match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? "";
      addCreateTaskAction(title, status);
    }
  }

  const descriptiveTaskPattern =
    /\b(?:proposed|suggested|recommended)\s+(?:one|a)\s+(draft|ready|in progress|in_progress|needs attention|needs_attention|done)\s+([A-Za-z0-9][^.\n]{1,80}?)\s+task(?:\s+with\s+([^.\n]+))?[.!?。]?/gi;
  for (const match of content.matchAll(descriptiveTaskPattern)) {
    const descriptor = normalizeReadableTaskTitle(match[2] ?? "");
    const qualifier = normalizeReadableTaskTitle(match[3] ?? "");
    const title = [descriptor, "task", qualifier ? `with ${qualifier}` : ""]
      .filter(Boolean)
      .join(" ");
    addCreateTaskAction(title, match[1]);
  }
  return actions;
}

function normalizeReadableTaskStatusCandidate(match: RegExpMatchArray): string | undefined {
  return Array.from(match)
    .slice(1)
    .find((value) =>
      /^(draft|ready|in progress|in_progress|needs attention|needs_attention|done)$/i.test(
        value ?? "",
      ),
    );
}

function normalizeReadableTaskTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[`*_“"'\s]+|[`*_”"'\s]+$/g, "")
    .replace(/[.。!?]+$/g, "")
    .trim()
    .slice(0, 160);
}

function normalizeReadableTaskStatus(value: string | undefined): string {
  return value?.toLowerCase().replace(/\s+/g, "_") || "draft";
}
