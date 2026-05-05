import type { AssistantMessage, Context, Message, ToolCall } from "@mariozechner/pi-ai";
import type {
  ProviderId,
  Task,
  TaskExecution,
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

const MAX_LOCAL_TOOL_ROUNDS = 24;
const taskExecutionQueues = new Map<string, Promise<void>>();

type StartTaskExecutionInput = {
  store: BoardStore;
  router: ProviderRouter;
  task: Task;
  provider: ProviderId;
  prompt?: string;
  runInline?: boolean;
  memoryRoot?: string;
  memoryLogger?: MemoryReviewLogger;
};

export async function startTaskExecutionForTask(
  input: StartTaskExecutionInput,
): Promise<TaskExecution> {
  return startExecution({
    ...input,
    buildPrompt: (task) => input.prompt ?? buildTaskExecutionPrompt(task),
    queuedMessage: "Request queued.",
  });
}

export async function startTaskFollowUpExecutionForTask(
  input: StartTaskExecutionInput & { followUp: string },
): Promise<TaskExecution> {
  return startExecution({
    ...input,
    buildPrompt: (task) => buildTaskFollowUpPrompt(task, input.followUp),
    queuedMessage: "Follow-up queued.",
  });
}

async function startExecution(
  input: StartTaskExecutionInput & {
    buildPrompt: (task: Task) => string;
    queuedMessage: string;
  },
): Promise<TaskExecution> {
  const shouldMarkTaskInProgress = input.task.status !== "done";
  if (shouldMarkTaskInProgress) {
    input.store.updateTask(input.task.id, { status: "in_progress" });
  }
  const config = input.store.getProviderConfig(input.provider);
  const execution = input.store.createTaskExecution({
    taskId: input.task.id,
    provider: input.provider,
    model: config.model,
    status: "queued",
    progressSummary: input.queuedMessage,
    events: [{ id: "", kind: "queued", message: input.queuedMessage, createdAt: "" }],
  });
  const run = async () => {
    if (shouldMarkTaskInProgress) {
      input.store.updateTask(input.task.id, { status: "in_progress" });
    }
    const taskAtStart = input.store.getTask(input.task.id) ?? input.task;
    const prompt = input.buildPrompt(taskAtStart);
    const startedAt = new Date().toISOString();
    let events = execution.events;
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
    try {
      const boardContext = buildBoardTaskContext(input.store.listTasks(), input.task.id);
      const systemPrompt = buildTaskSystemPrompt(prompt, boardContext, input.memoryRoot);
      const result = await completeTaskWithLocalTools({
        router: input.router,
        provider: input.provider,
        model: config.model,
        systemPrompt,
        prompt,
        onToolProgress: (message) => appendProgressEvent("progress", message),
      });
      input.store.updateTaskExecution(execution.id, {
        status: "succeeded",
        endedAt: new Date().toISOString(),
        progressSummary: "Work completed.",
        output: result || "Finished.",
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
      input.store.updateTask(input.task.id, { status: "done" });
      await reviewAndApplyMemory({
        providerRouter: input.router,
        provider: input.provider,
        model: config.model,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: result || "Finished." },
        ],
        query: prompt,
        memoryRoot: input.memoryRoot,
        source: "task",
        logger: input.memoryLogger,
      });
    } catch (err) {
      const failureMessage = redactedErrorMessage(err);
      const handoff = buildFailureHandoff({
        task: taskAtStart,
        failureMessage,
        events,
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
      input.store.updateTask(input.task.id, { status: "needs_attention" });
    }
  };
  const queuedRun = enqueueTaskExecution(input.task.id, run);
  if (input.runInline) {
    await queuedRun;
  } else {
    void queuedRun.catch((err) => {
      console.warn(err instanceof Error ? err.message : String(err));
    });
  }
  return input.store.getTaskExecution(execution.id) ?? execution;
}

function enqueueTaskExecution(taskId: string, run: () => Promise<void>): Promise<void> {
  const previous = taskExecutionQueues.get(taskId) ?? Promise.resolve();
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
  onToolProgress?: (message: string) => void;
}): Promise<string> {
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
    const result = await input.router.completeWithTools({
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt,
      messages: [{ role: "user", content: input.prompt }],
      context,
      tools: LOCAL_AGENT_TOOLS,
    });
    const toolCalls = extractToolCalls(result.raw);
    if (toolCalls.length === 0) {
      const content = result.content.trim();
      if (!content) {
        throw new Error("OpenAI finished without a usable task result.");
      }
      return content;
    }

    context.messages.push(result.raw);
    for (const call of toolCalls) {
      const toolResult = await executeLocalToolCall(call);
      context.messages.push(toolResult.message);
      input.onToolProgress?.(toolResult.summary);
    }
  }

  throw new Error("OpenAI used local tools too many times without producing a final result.");
}

function buildFailureHandoff(input: {
  task: Task;
  failureMessage: string;
  events: TaskExecutionEvent[];
}): string {
  const recentEvents = input.events
    .slice(-8)
    .map((event) => `- ${event.kind}: ${event.message}`)
    .join("\n");
  return [
    "## Failure handoff",
    "",
    `Task: ${input.task.title}`,
    `Status: needs_attention`,
    `Failure: ${input.failureMessage}`,
    "",
    "### Recent agent log",
    recentEvents || "- No progress events were recorded.",
    "",
    "### Next assignee step",
    "Open this task, read the failed output above, address the concrete blocker using the task notes and board context, then move the task back to In Progress to rerun the agent.",
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
