import type { AssistantMessage, Context, Message, ToolCall } from "@mariozechner/pi-ai";
import type {
  ProviderId,
  Task,
  TaskExecution,
  TaskExecutionArtifact,
  TaskExecutionEvent,
} from "../shared/types";
import type { BoardStore } from "./db";
import { executeLocalToolCall, LOCAL_AGENT_TOOLS } from "./local-agent-tools";
import {
  buildMemoryContextBlock,
  reviewAndApplyMemory,
  type MemoryReviewLogger,
} from "./memory";
import type { ProviderRouter } from "./providers/router";
import { redactedErrorMessage } from "./redaction";
import {
  extractTaskExecutionArtifacts,
  mergeTaskExecutionArtifacts,
} from "./task-artifacts";

const MAX_LOCAL_TOOL_ROUNDS = 24;
const CANCELLED_BY_USER_MESSAGE = "Cancelled by user.";
const CANCELLED_PROGRESS_SUMMARY = "Work cancelled.";
const taskExecutionQueues = new Map<string, Promise<void>>();
const activeTaskExecutionRuns = new Map<string, TaskExecutionRunRecord>();

type TaskExecutionRunRecord = {
  taskId: string;
  executionId: string;
  controller: AbortController;
};

type StartTaskExecutionInput = {
  store: BoardStore;
  router: ProviderRouter;
  task: Task;
  provider: ProviderId;
  prompt?: string;
  runInline?: boolean;
  memoryRoot?: string;
  memoryLogger?: MemoryReviewLogger;
  interruptExisting?: boolean;
};

export async function startTaskExecutionForTask(
  input: StartTaskExecutionInput,
): Promise<TaskExecution> {
  return startExecution({
    ...input,
    buildPrompt: (task) => input.prompt ?? buildTaskExecutionPrompt(task),
    requestKind: "initial",
    requestPrompt: (task) => input.prompt ?? formatTaskUserRequest(task),
    queuedMessage: "Request queued.",
  });
}

export async function startTaskFollowUpExecutionForTask(
  input: StartTaskExecutionInput & { followUp: string },
): Promise<TaskExecution> {
  return startExecution({
    ...input,
    buildPrompt: (task) => buildTaskFollowUpPrompt(task, input.followUp),
    requestKind: "follow_up",
    requestPrompt: () => input.followUp,
    queuedMessage: input.interruptExisting
      ? "Forced follow-up queued."
      : "Follow-up queued.",
  });
}

type AbortTaskExecutionResult =
  | { found: false; cancelled: false; reason: string }
  | {
      found: true;
      cancelled: boolean;
      reason?: string;
      task: Task;
      execution?: TaskExecution;
    };

type ForceQueuedFollowUpResult =
  | { found: false; forced: false; reason: string }
  | {
      found: true;
      forced: boolean;
      reason?: string;
      task: Task;
      execution?: TaskExecution;
    };

export function abortTaskExecutionForTask(input: {
  store: BoardStore;
  taskId: string;
}): AbortTaskExecutionResult {
  const task = input.store.getTask(input.taskId);
  if (!task) {
    return { found: false, cancelled: false, reason: "Task not found." };
  }
  const executions = getAbortableExecutions(input.store, input.taskId);
  if (executions.length === 0) {
    return {
      found: true,
      cancelled: false,
      reason: "No active task run to cancel.",
      task,
    };
  }
  const cancelledExecutions = executions
    .map((execution) => {
      activeTaskExecutionRuns
        .get(execution.id)
        ?.controller.abort(new Error(CANCELLED_BY_USER_MESSAGE));
      return markTaskExecutionCancelled({
        store: input.store,
        task,
        executionId: execution.id,
        events: execution.events,
      });
    })
    .filter((execution): execution is TaskExecution => Boolean(execution));
  const updatedTask = input.store.getTask(task.id) ?? task;
  return {
    found: true,
    cancelled: true,
    task: updatedTask,
    execution: updatedTask.execution ?? cancelledExecutions[0],
  };
}

export async function forceQueuedTaskFollowUpExecutionForTask(input: {
  store: BoardStore;
  router: ProviderRouter;
  taskId: string;
  executionId: string;
  provider: ProviderId;
  runInline?: boolean;
  memoryRoot?: string;
  memoryLogger?: MemoryReviewLogger;
}): Promise<ForceQueuedFollowUpResult> {
  const task = input.store.getTask(input.taskId);
  if (!task) {
    return { found: false, forced: false, reason: "Task not found." };
  }
  const execution = input.store.getTaskExecution(input.executionId);
  if (!execution || execution.taskId !== task.id) {
    return { found: false, forced: false, reason: "Queued follow-up not found." };
  }
  if (execution.requestKind !== "follow_up" || execution.status !== "queued") {
    return {
      found: true,
      forced: false,
      reason: "Only queued follow-ups can be forced.",
      task,
      execution,
    };
  }
  const latestQueuedFollowUp = input.store
    .listTaskExecutions(task.id)
    .filter((candidate) => candidate.requestKind === "follow_up" && candidate.status === "queued")
    .at(-1);
  if (latestQueuedFollowUp?.id !== execution.id) {
    return {
      found: true,
      forced: false,
      reason: "Only the latest queued follow-up can be forced.",
      task,
      execution,
    };
  }

  cancelAbortableExecutions({
    store: input.store,
    task,
    exceptExecutionId: execution.id,
  });
  const taskForRun = input.store.updateTask(task.id, { status: "in_progress" }) ?? task;
  const controller = new AbortController();
  activeTaskExecutionRuns.set(execution.id, {
    taskId: task.id,
    executionId: execution.id,
    controller,
  });
  const updatedExecution =
    input.store.updateTaskExecution(execution.id, {
      progressSummary: "Forced follow-up queued.",
      events: [
        ...execution.events,
        {
          id: "",
          kind: "queued",
          message: "Forced follow-up queued.",
          createdAt: "",
        },
      ],
    }) ?? execution;
  const run = createTaskExecutionRun(
    {
      store: input.store,
      router: input.router,
      task: taskForRun,
      provider: input.provider,
      memoryRoot: input.memoryRoot,
      memoryLogger: input.memoryLogger,
      buildPrompt: (task) => buildTaskFollowUpPrompt(task, updatedExecution.requestPrompt),
    },
    {
      task: taskForRun,
      execution: updatedExecution,
      controller,
      shouldMarkTaskInProgress: true,
      model: updatedExecution.model ?? input.store.getProviderConfig(input.provider).model,
    },
  );
  const queuedRun = enqueueTaskExecution(task.id, run, { replaceExistingQueue: true });
  if (input.runInline) {
    await queuedRun;
  } else {
    void queuedRun.catch((err) => {
      console.warn(err instanceof Error ? err.message : String(err));
    });
  }
  const latestTask = input.store.getTask(task.id) ?? taskForRun;
  return {
    found: true,
    forced: true,
    task: latestTask,
    execution: input.store.getTaskExecution(execution.id) ?? updatedExecution,
  };
}

async function startExecution(
  input: StartTaskExecutionInput & {
    buildPrompt: (task: Task) => string;
    requestKind: "initial" | "follow_up" | "rerun" | "manual";
    requestPrompt: (task: Task) => string;
    queuedMessage: string;
  },
): Promise<TaskExecution> {
  let task = input.task;
  if (input.interruptExisting) {
    abortTaskExecutionForTask({
      store: input.store,
      taskId: input.task.id,
    });
    task = input.store.getTask(input.task.id) ?? input.task;
  }
  const shouldMarkTaskInProgress = task.status !== "done";
  if (shouldMarkTaskInProgress) {
    input.store.updateTask(task.id, { status: "in_progress" });
  }
  const config = input.store.getProviderConfig(input.provider);
  const execution = input.store.createTaskExecution({
    taskId: task.id,
    provider: input.provider,
    model: config.model,
    requestKind: input.requestKind,
    requestPrompt: input.requestPrompt(task),
    status: "queued",
    progressSummary: input.queuedMessage,
    events: [{ id: "", kind: "queued", message: input.queuedMessage, createdAt: "" }],
  });
  const controller = new AbortController();
  activeTaskExecutionRuns.set(execution.id, {
    taskId: task.id,
    executionId: execution.id,
    controller,
  });
  const run = createTaskExecutionRun(input, {
    task,
    execution,
    controller,
    shouldMarkTaskInProgress,
    model: config.model,
  });
  const queuedRun = enqueueTaskExecution(task.id, run, {
    replaceExistingQueue: input.interruptExisting === true,
  });
  if (input.runInline) {
    await queuedRun;
  } else {
    void queuedRun.catch((err) => {
      console.warn(err instanceof Error ? err.message : String(err));
    });
  }
  return input.store.getTaskExecution(execution.id) ?? execution;
}

function createTaskExecutionRun(
  input: StartTaskExecutionInput & {
    buildPrompt: (task: Task) => string;
  },
  runInput: {
    task: Task;
    execution: TaskExecution;
    controller: AbortController;
    shouldMarkTaskInProgress: boolean;
    model: string;
  },
): () => Promise<void> {
  const { task, execution, controller, shouldMarkTaskInProgress, model } = runInput;
  return async () => {
    let taskAtStart: Task = task;
    let events = execution.events;
    try {
      const existingTask = input.store.getTask(task.id);
      if (!existingTask) {
        return;
      }
      const existingExecution = input.store.getTaskExecution(execution.id);
      if (!existingExecution || existingExecution.status !== "queued") {
        return;
      }
      taskAtStart = existingTask;
      events = existingExecution.events.length > 0 ? existingExecution.events : execution.events;
      if (
        isTaskRunCancelled(controller.signal) ||
        isTaskExecutionAlreadyCancelled(input.store, execution.id)
      ) {
        markTaskExecutionCancelled({
          store: input.store,
          task: taskAtStart,
          executionId: execution.id,
          events,
        });
        return;
      }
      if (shouldMarkTaskInProgress) {
        const updatedTask = input.store.updateTask(task.id, { status: "in_progress" });
        if (!updatedTask) {
          return;
        }
        taskAtStart = updatedTask;
      }
      const prompt = input.buildPrompt(taskAtStart);
      const startedAt = new Date().toISOString();
      const running = input.store.updateTaskExecution(execution.id, {
        status: "running",
        startedAt,
        progressSummary: "Preparing the task context.",
        events: [
          ...events,
          {
            id: "",
            kind: "running",
            message: "Work started.",
            createdAt: "",
          },
        ],
      });
      events = running?.events ?? events;
      const appendProgressEvent = (kind: TaskExecutionEvent["kind"], message: string) => {
        if (
          isTaskRunCancelled(controller.signal) ||
          isTaskExecutionAlreadyCancelled(input.store, execution.id)
        ) {
          return;
        }
        events = [
          ...events,
          {
            id: "",
            kind,
            message,
            createdAt: "",
          },
        ];
        const updated = input.store.updateTaskExecution(execution.id, {
          progressSummary: message,
          events,
        });
        events = updated?.events ?? events;
      };
      const boardContext = buildBoardTaskContext(input.store.listTasks(), task.id);
      const systemPrompt = buildTaskSystemPrompt(prompt, boardContext, input.memoryRoot);
      const result = await completeTaskWithLocalTools({
        router: input.router,
        provider: input.provider,
        model,
        systemPrompt,
        prompt,
        signal: controller.signal,
        onToolProgress: (message) => appendProgressEvent("progress", message),
      });
      if (
        isTaskRunCancelled(controller.signal) ||
        isTaskExecutionAlreadyCancelled(input.store, execution.id)
      ) {
        markTaskExecutionCancelled({
          store: input.store,
          task: taskAtStart,
          executionId: execution.id,
          events,
        });
        return;
      }
      const output = result.content || "Finished.";
      input.store.updateTaskExecution(execution.id, {
        status: "succeeded",
        endedAt: new Date().toISOString(),
        progressSummary: "Work completed.",
        output,
        artifacts: mergeTaskExecutionArtifacts([
          ...result.artifacts,
          ...extractTaskExecutionArtifacts(output),
        ]),
        events: [
          ...events,
          {
            id: "",
            kind: "succeeded",
            message: "Work completed.",
            createdAt: "",
          },
        ],
      });
      input.store.updateTask(task.id, { status: "done" });
      throwIfTaskRunCancelled(controller.signal);
      await reviewAndApplyMemory({
        providerRouter: input.router,
        provider: input.provider,
        model,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: output },
        ],
        query: prompt,
        memoryRoot: input.memoryRoot,
        source: "task",
        logger: input.memoryLogger,
      });
    } catch (err) {
      if (
        isTaskRunCancelled(controller.signal) ||
        (controller.signal.aborted && isTaskRunCancellationError(err))
      ) {
        const task = input.store.getTask(taskAtStart.id) ?? taskAtStart;
        markTaskExecutionCancelled({
          store: input.store,
          task,
          executionId: execution.id,
          events: input.store.getTaskExecution(execution.id)?.events ?? execution.events,
        });
        return;
      }
      const failureMessage = redactedErrorMessage(err);
      const handoff = buildFailureHandoff({
        task: taskAtStart,
        failureMessage,
      });
      input.store.updateTaskExecution(execution.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        progressSummary: "Work needs attention.",
        output: handoff,
        error: failureMessage,
        events: [
          ...events,
          {
            id: "",
            kind: "failed",
            message: "Work needs attention.",
            createdAt: "",
          },
        ],
      });
      input.store.updateTask(task.id, { status: "needs_attention" });
    } finally {
      const activeRun = activeTaskExecutionRuns.get(execution.id);
      if (activeRun?.executionId === execution.id && activeRun.controller === controller) {
        activeTaskExecutionRuns.delete(execution.id);
      }
    }
  };
}

function getAbortableExecutions(store: BoardStore, taskId: string): TaskExecution[] {
  return store
    .listTaskExecutions(taskId)
    .filter((execution) => execution.status === "running" || execution.status === "queued")
    .reverse();
}

function cancelAbortableExecutions(input: {
  store: BoardStore;
  task: Task;
  exceptExecutionId?: string;
}): TaskExecution[] {
  return getAbortableExecutions(input.store, input.task.id)
    .filter((execution) => execution.id !== input.exceptExecutionId)
    .map((execution) => {
      activeTaskExecutionRuns
        .get(execution.id)
        ?.controller.abort(new Error(CANCELLED_BY_USER_MESSAGE));
      return markTaskExecutionCancelled({
        store: input.store,
        task: input.task,
        executionId: execution.id,
        events: execution.events,
      });
    })
    .filter((execution): execution is TaskExecution => Boolean(execution));
}

function isTaskExecutionAlreadyCancelled(store: BoardStore, executionId: string) {
  return store.getTaskExecution(executionId)?.status === "cancelled";
}

function markTaskExecutionCancelled(input: {
  store: BoardStore;
  task: Task;
  executionId: string;
  events: TaskExecutionEvent[];
}): TaskExecution | null {
  const existing = input.store.getTaskExecution(input.executionId);
  if (!existing) {
    return null;
  }
  if (existing.status === "cancelled") {
    releaseCancelledTask(input.store, input.task);
    return existing;
  }
  if (existing.status !== "queued" && existing.status !== "running") {
    return existing;
  }
  const events = existing.events.length > 0 ? existing.events : input.events;
  const cancelled = input.store.updateTaskExecution(input.executionId, {
    status: "cancelled",
    endedAt: new Date().toISOString(),
    progressSummary: CANCELLED_PROGRESS_SUMMARY,
    output: buildCancellationHandoff(input.task),
    error: CANCELLED_BY_USER_MESSAGE,
    events: [
      ...events,
      {
        id: "",
        kind: "cancelled",
        message: CANCELLED_PROGRESS_SUMMARY,
        createdAt: "",
      },
    ],
  });
  releaseCancelledTask(input.store, input.task);
  return cancelled;
}

function releaseCancelledTask(store: BoardStore, task: Task) {
  const latestTask = store.getTask(task.id) ?? task;
  if (latestTask.status === "in_progress" && !hasAbortableTaskExecution(store, task.id)) {
    store.updateTask(task.id, { status: "ready" });
  }
}

function hasAbortableTaskExecution(store: BoardStore, taskId: string) {
  return store
    .listTaskExecutions(taskId)
    .some((execution) => execution.status === "running" || execution.status === "queued");
}

function isTaskRunCancelled(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

function throwIfTaskRunCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const error = new Error(typeof reason === "string" ? reason : CANCELLED_BY_USER_MESSAGE);
  error.name = "AbortError";
  throw error;
}

function isTaskRunCancellationError(err: unknown) {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.name === "AbortError" || /\b(abort|aborted|cancelled|canceled)\b/i.test(err.message);
}

function enqueueTaskExecution(
  taskId: string,
  run: () => Promise<void>,
  options: { replaceExistingQueue?: boolean } = {},
): Promise<void> {
  const previous = options.replaceExistingQueue
    ? Promise.resolve()
    : taskExecutionQueues.get(taskId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  const tracked = current.finally(() => {
    if (taskExecutionQueues.get(taskId) === tracked) {
      taskExecutionQueues.delete(taskId);
    }
  });
  taskExecutionQueues.set(taskId, tracked);
  return current;
}

async function completeTaskWithLocalTools(input: {
  router: ProviderRouter;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
  onToolProgress?: (message: string) => void;
}): Promise<{ content: string; artifacts: TaskExecutionArtifact[] }> {
  let artifacts: TaskExecutionArtifact[] = [];
  const messages: Message[] = [
    {
      role: "user",
      content: input.prompt,
      timestamp: Date.now(),
    },
  ];
  const context: Context = {
    systemPrompt: input.systemPrompt,
    messages,
    tools: LOCAL_AGENT_TOOLS,
  };

  for (let round = 0; round < MAX_LOCAL_TOOL_ROUNDS; round += 1) {
    throwIfTaskRunCancelled(input.signal);
    const result = await input.router.completeWithTools({
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt,
      messages: [{ role: "user", content: input.prompt }],
      context,
      tools: LOCAL_AGENT_TOOLS,
      signal: input.signal,
    });
    throwIfTaskRunCancelled(input.signal);
    const toolCalls = extractToolCalls(result.raw);
    if (toolCalls.length === 0) {
      const content = result.content.trim();
      if (!content) {
        throw new Error("OpenAI finished without a usable task result.");
      }
      return { content, artifacts };
    }

    context.messages.push(result.raw);
    for (const call of toolCalls) {
      throwIfTaskRunCancelled(input.signal);
      const toolResult = await executeLocalToolCall(call, { signal: input.signal });
      throwIfTaskRunCancelled(input.signal);
      context.messages.push(toolResult.message);
      artifacts = mergeTaskExecutionArtifacts([...artifacts, ...toolResult.artifacts]);
      input.onToolProgress?.(toolResult.summary);
    }
  }

  throw new Error("OpenAI used local tools too many times without producing a final result.");
}

function buildFailureHandoff(input: {
  task: Task;
  failureMessage: string;
}): string {
  return [
    "## Failure handoff",
    "",
    `Task: ${input.task.title}`,
    `Status: needs_attention`,
    `Failure: ${input.failureMessage}`,
    "",
    "### Next assignee step",
    "Open this task, read the failed output above, address the concrete blocker using the task notes and board context, then move the task back to In Progress to rerun the agent.",
  ].join("\n");
}

function buildCancellationHandoff(task: Task): string {
  return [
    "## Work cancelled",
    "",
    `Task: ${task.title}`,
    "Status: cancelled",
    `Reason: ${CANCELLED_BY_USER_MESSAGE}`,
  ].join("\n");
}

function extractToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

export function buildTaskSystemPrompt(
  prompt: string,
  boardContext: string,
  memoryRoot?: string,
): string {
  const memoryContext = buildMemoryContextBlock({ query: prompt, rootDir: memoryRoot });
  return [
    "You help turn local task-board notes into a concrete result. Respond in Markdown, be concise, and use headings, bullets, bold text, and links only when they make the result easier to scan. Do not return raw HTML.",
    "The current task, surrounding board context, previous task outputs, and task notes are the source of truth for what to do. Infer the task type from that context instead of relying on built-in workflow assumptions.",
    "You can use local tools to inspect files, write files, and run shell commands when the task requires real execution. Do not modify files unless the task asks for implementation or artifact work. For non-implementation tasks, use tools only when they materially improve the result.",
    "Honor explicit task notes about target workspaces, boundaries, live URLs, ordering, roles, and done criteria. If a task provides a workspace path, pass it as cwd to local tools. Do not invent project-specific paths or durable preferences when the task does not provide them.",
    "Do not claim a file was changed, command passed, or website is live unless a local tool result confirms it. If you are blocked, explain the exact blocker and the next task or setup needed.",
    "When a local tool call succeeds, use that result instead of repeating the same tool call with the same arguments. Re-check only when a later change could have invalidated the result.",
    "After a validation command passes, stop using tools and return the final task summary immediately. If validation fails, fix the specific failure, rerun the same validation once, then summarize the result.",
    "You have local persistent memory. Use recalled memory only when it is relevant to the task. A separate memory-review pass may save durable facts after successful task execution; do not claim anything was saved unless the relevant fact is already present in the recalled memory context.",
    boardContext,
    memoryContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildBoardTaskContext(tasks: Task[], currentTaskId: string): string {
  const currentIndex = tasks.findIndex((task) => task.id === currentTaskId);
  const previousTasks = currentIndex === -1 ? [] : tasks.slice(0, currentIndex);
  const nextTasks = currentIndex === -1 ? [] : tasks.slice(currentIndex + 1, currentIndex + 4);
  const currentTask = tasks.find((task) => task.id === currentTaskId);
  return [
    "<board-context>",
    currentTask ? formatBoardTask(currentTask, "Current task") : "",
    previousTasks.length ? ["Previous task results:", ...previousTasks.map(formatCompletedTask)].join("\n\n") : "",
    nextTasks.length ? ["Upcoming tasks:", ...nextTasks.map((task) => formatBoardTask(task))].join("\n\n") : "",
    "</board-context>",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatCompletedTask(task: Task): string {
  const output = task.execution?.output?.trim();
  return [
    formatBoardTask(task),
    output ? `Latest result:\n${truncateForPrompt(output, 2_500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBoardTask(task: Task, label = "Task"): string {
  return [
    `${label}: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    task.description ? `Notes:\n${truncateForPrompt(task.description, 2_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function truncateForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

function buildTaskExecutionPrompt(task: Task): string {
  return [
    "Work on this task.",
    `Title: ${task.title}`,
    task.description ? `Notes: ${task.description}` : "",
    `Priority: ${task.priority}`,
    "Return the useful result and any next action in Markdown.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTaskUserRequest(task: Task): string {
  return [task.title, task.description].map((value) => value.trim()).filter(Boolean).join("\n\n");
}

function buildTaskFollowUpPrompt(task: Task, prompt: string): string {
  return [
    "Follow up on this task.",
    `Title: ${task.title}`,
    task.description ? `Notes: ${task.description}` : "",
    `Priority: ${task.priority}`,
    formatTaskExecutionScope(task),
    `Follow-up request: ${prompt}`,
    "Continue from the existing task context and reply in Markdown.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTaskExecutionScope(task: Task): string {
  const executions = getTaskExecutionHistory(task).filter((execution) => execution.output.trim());
  if (executions.length === 0) {
    return "";
  }
  return [
    "Existing task results:",
    ...executions.slice(-5).map((execution, index) =>
      [
        `Result ${index + 1}: ${formatTaskExecutionWindow(execution)}`,
        truncateForPrompt(execution.output.trim(), 2_500),
      ].join("\n"),
    ),
  ].join("\n\n");
}

function getTaskExecutionHistory(task: Task): TaskExecution[] {
  const previous = task.execution?.previousExecutions ?? [];
  return task.execution ? [...previous, task.execution] : previous;
}

function formatTaskExecutionWindow(execution: TaskExecution): string {
  if (execution.endedAt) {
    return `finished ${execution.endedAt}`;
  }
  if (execution.startedAt) {
    return `started ${execution.startedAt}`;
  }
  return `created ${execution.createdAt}`;
}
