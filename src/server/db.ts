import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import {
  FOCUS_AREA_COLORS,
  OPENAI_CACHE_RETENTIONS,
  OPENAI_CODEX_TRANSPORTS,
  OPENAI_REASONING_EFFORTS,
  OPENAI_REASONING_SUMMARIES,
  OPENAI_TEXT_VERBOSITIES,
  PRIORITIES,
  PROVIDERS,
  TASK_STATUSES,
  type AppSettings,
  type AssistantChatConversation,
  type AssistantChatMessage,
  type AssistantChatRole,
  type FocusArea,
  type FocusAreaColor,
  type ProviderConfig,
  type ProviderConfigPatch,
  type ProviderId,
  type ProviderStatus,
  type Priority,
  type Task,
  type TaskCreateInput,
  type TaskExecution,
  type TaskExecutionArtifact,
  type TaskExecutionEvent,
  type TaskExecutionStatus,
  type TaskStatus,
  type TaskUpdateInput,
  type UserProfile,
} from "../shared/types";

type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  focus_area_id: string | null;
  tags: string;
  provider_source: string | null;
  created_at: string;
  updated_at: string;
};

type TaskExecutionRow = {
  id: string;
  task_id: string;
  agent_run_id: string | null;
  status: string;
  provider: string;
  model: string | null;
  started_at: string | null;
  ended_at: string | null;
  progress_summary: string;
  output: string;
  error: string | null;
  artifacts: string;
  events: string;
  created_at: string;
  updated_at: string;
};

type AssistantChatMessageRow = {
  id: string;
  conversation_id: string | null;
  role: string;
  content: string;
  created_at: string;
};

type AssistantChatConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type StoredProviderConfig = ProviderConfig & {
  apiKey?: string;
};

type UserProfilePatch = Partial<Omit<UserProfile, "focusAreas">> & {
  focusAreas?: Array<Partial<FocusArea>>;
};

export type ApiKeyResolution =
  | { apiKey: string; source: "env" | "local" }
  | { source: "missing" };

export type BaseUrlResolution = {
  baseUrl: string;
  source: ProviderStatus["baseUrlSource"];
};

export type OpenAiOAuthCredential = OAuthCredentials & {
  accountId?: string;
};

type TaskExecutionCreateInput = {
  taskId: string;
  provider: ProviderId | "local";
  model?: string | null;
  status?: TaskExecutionStatus;
  progressSummary?: string;
  output?: string;
  error?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  events?: TaskExecutionEvent[];
  artifacts?: TaskExecutionArtifact[];
};

type TaskExecutionPatch = Partial<
  Pick<
    TaskExecution,
    "status" | "model" | "startedAt" | "endedAt" | "progressSummary" | "output" | "error"
  >
> & {
  events?: TaskExecutionEvent[];
  artifacts?: TaskExecutionArtifact[];
};

type AssistantChatMessageCreateInput = {
  conversationId: string;
  role: AssistantChatRole;
  content: string;
};

type AssistantChatConversationCreateInput = {
  title?: string;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type DatabaseHandle = InstanceType<typeof DatabaseSync>;

const DEFAULT_PROFILE: UserProfile = {
  workAreas: ["Personal", "Work", "Learning", "Home", "Side Projects"],
  focusAreas: [
    { id: "personal", label: "Personal", color: "blue" },
    { id: "work", label: "Work", color: "emerald" },
    { id: "learning", label: "Learning", color: "violet" },
    { id: "home", label: "Home", color: "amber" },
    { id: "side-projects", label: "Side Projects", color: "rose" },
  ],
  preferredPlanningStyle: "Clear next steps with short notes.",
  recurringCommitments: [],
  learnedPreferences: [],
};

const DEFAULT_PROVIDER_CONFIGS: StoredProviderConfig[] = [
  {
    provider: "openai",
    label: "OpenAI",
    model: "gpt-5.5",
    baseUrl: "https://api.openai.com/v1",
    authMode: "oauth",
    enabled: true,
    fallbackRank: 1,
  },
];

const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  inbox: "draft",
  next: "ready",
  doing: "in_progress",
  waiting: "ready",
  done: "done",
};

const TASK_STATUS_VALUES = new Set<string>(TASK_STATUSES);
const PRIORITY_VALUES = new Set<string>(PRIORITIES);
const PROVIDER_VALUES = new Set<string>(PROVIDERS);
const FOCUS_AREA_COLOR_VALUES = new Set<string>(FOCUS_AREA_COLORS);
const OPENAI_REASONING_EFFORT_VALUES = new Set<string>(OPENAI_REASONING_EFFORTS);
const OPENAI_REASONING_SUMMARY_VALUES = new Set<string>(OPENAI_REASONING_SUMMARIES);
const OPENAI_TEXT_VERBOSITY_VALUES = new Set<string>(OPENAI_TEXT_VERBOSITIES);
const OPENAI_CACHE_RETENTION_VALUES = new Set<string>(OPENAI_CACHE_RETENTIONS);
const OPENAI_CODEX_TRANSPORT_VALUES = new Set<string>(OPENAI_CODEX_TRANSPORTS);
const TASK_EXECUTION_STATUS_VALUES = new Set<string>([
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export class BoardStore {
  private db: DatabaseHandle;

  constructor(dbPath = resolveDefaultDbPath()) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.init();
    this.migrateLegacyBoardState();
    this.migrateLegacyAssistantChatMessages();
    this.migrateFailedTasksToNeedsAttention();
    this.backfillFailedExecutionHandoffs();
    this.ensureDefaultSettings();
  }

  close(): void {
    this.db.close();
  }

  listTasks(): Task[] {
    return this.db
      .prepare(
        `SELECT id, title, description, status, priority, focus_area_id, tags,
                provider_source, created_at, updated_at
         FROM tasks
         ORDER BY created_at ASC`,
      )
      .all()
      .map((row) => this.mapTask(row as TaskRow));
  }

  getTask(id: string): Task | null {
    const row = this.db
      .prepare(
        `SELECT id, title, description, status, priority, focus_area_id, tags,
                provider_source, created_at, updated_at
         FROM tasks
         WHERE id = ?`,
      )
      .get(id);
    return row ? this.mapTask(row as TaskRow) : null;
  }

  createTask(input: TaskCreateInput): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status: normalizeTaskStatus(input.status),
      priority: normalizePriority(input.priority),
      focusAreaId: normalizeFocusAreaId(
        input.focusAreaId,
        this.getSettings().userProfile.focusAreas,
      ),
      tags: normalizeTags(input.tags),
      providerSource: normalizeProviderSource(input.providerSource),
      execution: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, title, description, status, priority, focus_area_id, tags,
           provider_source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.description,
        task.status,
        task.priority,
        task.focusAreaId,
        JSON.stringify(task.tags),
        task.providerSource,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  updateTask(id: string, input: TaskUpdateInput): Task | null {
    const existing = this.getTask(id);
    if (!existing) {
      return null;
    }
    const updated: Task = {
      ...existing,
      ...input,
      title: input.title === undefined ? existing.title : input.title.trim(),
      description:
        input.description === undefined ? existing.description : input.description.trim(),
      status: input.status === undefined ? existing.status : normalizeTaskStatus(input.status),
      priority:
        input.priority === undefined ? existing.priority : normalizePriority(input.priority),
      focusAreaId:
        input.focusAreaId === undefined
          ? existing.focusAreaId
          : normalizeFocusAreaId(input.focusAreaId, this.getSettings().userProfile.focusAreas),
      tags: input.tags === undefined ? existing.tags : normalizeTags(input.tags),
      providerSource:
        input.providerSource === undefined
          ? existing.providerSource
          : normalizeProviderSource(input.providerSource),
      execution: existing.execution,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE tasks
         SET title = ?, description = ?, status = ?, priority = ?, focus_area_id = ?,
             tags = ?, provider_source = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.title,
        updated.description,
        updated.status,
        updated.priority,
        updated.focusAreaId,
        JSON.stringify(updated.tags),
        updated.providerSource,
        updated.updatedAt,
        id,
      );
    return this.getTask(id);
  }

  deleteTask(id: string): boolean {
    const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }

  createTaskExecution(input: TaskExecutionCreateInput): TaskExecution {
    const now = new Date().toISOString();
    const execution: TaskExecution = {
      id: randomUUID(),
      taskId: input.taskId,
      agentRunId: null,
      status: input.status ?? "queued",
      provider: input.provider,
      model: input.model ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      progressSummary: input.progressSummary ?? "Request queued.",
      output: input.output ?? "",
      error: input.error ?? null,
      artifacts: normalizeExecutionArtifacts(input.artifacts ?? [], now),
      events: normalizeExecutionEvents(input.events ?? [], now),
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO task_executions
          (id, task_id, agent_run_id, status, provider, model, started_at, ended_at,
           progress_summary, output, error, artifacts, events, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        execution.id,
        execution.taskId,
        execution.agentRunId,
        execution.status,
        execution.provider,
        execution.model,
        execution.startedAt,
        execution.endedAt,
        execution.progressSummary,
        execution.output,
        execution.error,
        JSON.stringify(execution.artifacts),
        JSON.stringify(execution.events),
        execution.createdAt,
        execution.updatedAt,
      );
    return execution;
  }

  updateTaskExecution(id: string, patch: TaskExecutionPatch): TaskExecution | null {
    const existing = this.getTaskExecution(id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const execution: TaskExecution = {
      ...existing,
      ...patch,
      artifacts: patch.artifacts
        ? normalizeExecutionArtifacts(patch.artifacts, now)
        : existing.artifacts,
      events: patch.events ? normalizeExecutionEvents(patch.events, now) : existing.events,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE task_executions
         SET status = ?, model = ?, started_at = ?, ended_at = ?, progress_summary = ?,
             output = ?, error = ?, artifacts = ?, events = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        execution.status,
        execution.model,
        execution.startedAt,
        execution.endedAt,
        execution.progressSummary,
        execution.output,
        execution.error,
        JSON.stringify(execution.artifacts),
        JSON.stringify(execution.events),
        execution.updatedAt,
        execution.id,
      );
    return execution;
  }

  getTaskExecution(id: string): TaskExecution | null {
    const row = this.db
      .prepare(
        `SELECT id, task_id, agent_run_id, status, provider, model, started_at, ended_at,
                progress_summary, output, error, artifacts, events, created_at, updated_at
         FROM task_executions
         WHERE id = ?`,
      )
      .get(id);
    return row ? this.mapTaskExecution(row as TaskExecutionRow) : null;
  }

  getLatestTaskExecution(taskId: string): TaskExecution | null {
    const row = this.db
      .prepare(
        `SELECT id, task_id, agent_run_id, status, provider, model, started_at, ended_at,
                progress_summary, output, error, artifacts, events, created_at, updated_at
         FROM task_executions
         WHERE task_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(taskId);
    return row ? this.mapTaskExecution(row as TaskExecutionRow) : null;
  }

  listAssistantChatConversations(limit = 60): AssistantChatConversation[] {
    return this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM assistant_chat_conversations
         ORDER BY updated_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 200)))
      .map((row) => this.mapAssistantChatConversation(row as AssistantChatConversationRow));
  }

  getAssistantChatConversation(id: string): AssistantChatConversation | null {
    const row = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM assistant_chat_conversations
         WHERE id = ?`,
      )
      .get(id);
    return row ? this.mapAssistantChatConversation(row as AssistantChatConversationRow) : null;
  }

  getLatestAssistantChatConversation(): AssistantChatConversation | null {
    const row = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM assistant_chat_conversations
         ORDER BY updated_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get();
    return row ? this.mapAssistantChatConversation(row as AssistantChatConversationRow) : null;
  }

  createAssistantChatConversation(
    input: AssistantChatConversationCreateInput = {},
  ): AssistantChatConversation {
    const now = new Date().toISOString();
    const conversation: AssistantChatConversation = {
      id: randomUUID(),
      title: normalizeAssistantChatConversationTitle(input.title),
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO assistant_chat_conversations (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
    return conversation;
  }

  listAssistantChatMessages(
    conversationId = this.getLatestAssistantChatConversation()?.id ?? null,
    limit = 80,
  ): AssistantChatMessage[] {
    if (!conversationId) {
      return [];
    }
    return this.db
      .prepare(
        `SELECT id, conversation_id, role, content, created_at
         FROM assistant_chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(conversationId, Math.max(1, Math.min(limit, 200)))
      .map((row) => this.mapAssistantChatMessage(row as AssistantChatMessageRow))
      .reverse();
  }

  appendAssistantChatMessage(input: AssistantChatMessageCreateInput): AssistantChatMessage {
    const conversation = this.getAssistantChatConversation(input.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    const message: AssistantChatMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: normalizeAssistantChatRole(input.role),
      content: input.content.trim(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO assistant_chat_messages (id, conversation_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(message.id, message.conversationId, message.role, message.content, message.createdAt);
    this.touchAssistantChatConversation(conversation.id, message.createdAt);
    if (message.role === "user" && shouldReplaceAssistantChatConversationTitle(conversation.title)) {
      this.updateAssistantChatConversationTitle(
        conversation.id,
        titleFromAssistantChatMessage(message.content),
      );
    }
    return message;
  }

  getSettings(): AppSettings {
    const providerConfigs = this.getStoredProviderConfigs();
    const oauth = this.getOpenAiOAuthCredential();
    return {
      selectedProvider: normalizeProviderId(this.getSetting<ProviderId>("selectedProvider")),
      providerConfigs: providerConfigs.map(({ apiKey: _apiKey, ...config }) => ({
        ...config,
        hasApiKey: Boolean(this.resolveApiKeyForProvider(config.provider).source !== "missing"),
        hasOAuth: Boolean(oauth),
        oauthAccountId: formatPublicAccountIdentifier(oauth?.accountId),
        oauthExpiresAt: formatOAuthExpiresAt(oauth),
      })),
      userProfile: normalizeUserProfile(this.getSetting<UserProfilePatch>("userProfile")),
    };
  }

  patchSettings(input: {
    selectedProvider?: ProviderId;
    providerConfigs?: ProviderConfigPatch[];
    userProfile?: UserProfilePatch;
  }): AppSettings {
    if (input.selectedProvider) {
      this.setSetting("selectedProvider", normalizeProviderId(input.selectedProvider));
    }
    if (input.providerConfigs) {
      this.patchProviderConfigs(input.providerConfigs);
    }
    if (input.userProfile) {
      this.setSetting("userProfile", normalizeUserProfile(input.userProfile));
    }
    return this.getSettings();
  }

  getProviderConfig(provider: ProviderId): ProviderConfig {
    const config = this.getStoredProviderConfigs().find((entry) => entry.provider === provider);
    if (config) {
      const { apiKey: _apiKey, ...publicConfig } = config;
      return publicConfig;
    }
    return DEFAULT_PROVIDER_CONFIGS[0];
  }

  resolveApiKeyForProvider(provider: ProviderId): ApiKeyResolution {
    const envKey = process.env[provider === "openai" ? "OPENAI_API_KEY" : ""];
    if (envKey?.trim()) {
      return { apiKey: envKey.trim(), source: "env" };
    }
    const localKey = this.getStoredProviderConfigs().find((entry) => entry.provider === provider)
      ?.apiKey;
    return localKey?.trim()
      ? { apiKey: localKey.trim(), source: "local" }
      : { source: "missing" };
  }

  resolveBaseUrlForProvider(provider: ProviderId): BaseUrlResolution {
    const defaultBaseUrl = provider === "openai" ? "https://api.openai.com/v1" : "";
    const envBaseUrl = process.env[provider === "openai" ? "OPENAI_BASE_URL" : ""];
    if (envBaseUrl?.trim()) {
      return { baseUrl: envBaseUrl.trim(), source: "env" };
    }
    const localBaseUrl = this.getStoredProviderConfigs().find((entry) => entry.provider === provider)
      ?.baseUrl;
    return localBaseUrl?.trim()
      ? { baseUrl: localBaseUrl.trim(), source: "local" }
      : { baseUrl: defaultBaseUrl, source: "default" };
  }

  resolveHeadersForProvider(provider: ProviderId): Record<string, string> | undefined {
    if (provider !== "openai") {
      return undefined;
    }
    const config = this.getStoredProviderConfigs().find((entry) => entry.provider === provider);
    const organizationId =
      firstNonEmptyString(process.env.OPENAI_ORG_ID, process.env.OPENAI_ORGANIZATION) ??
      config?.organizationId;
    const projectId =
      firstNonEmptyString(process.env.OPENAI_PROJECT_ID, process.env.OPENAI_PROJECT) ??
      config?.projectId;
    const headers: Record<string, string> = {};
    if (organizationId) {
      headers["OpenAI-Organization"] = organizationId;
    }
    if (projectId) {
      headers["OpenAI-Project"] = projectId;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  getOpenAiOAuthCredential(): OpenAiOAuthCredential | null {
    return normalizeOpenAiOAuthCredential(this.getSetting<OpenAiOAuthCredential>("openAiOAuth"));
  }

  setOpenAiOAuthCredential(credential: OpenAiOAuthCredential): void {
    this.setSetting("openAiOAuth", credential);
  }

  clearOpenAiOAuthCredential(): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run("openAiOAuth");
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        focus_area_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        provider_source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_run_id TEXT,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        started_at TEXT,
        ended_at TEXT,
        progress_summary TEXT NOT NULL DEFAULT '',
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        artifacts TEXT NOT NULL DEFAULT '[]',
        events TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistant_chat_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistant_chat_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES assistant_chat_conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_assistant_chat_messages_created_at
        ON assistant_chat_messages(created_at);

      CREATE INDEX IF NOT EXISTS idx_assistant_chat_conversations_updated_at
        ON assistant_chat_conversations(updated_at);

    `);
    this.ensureColumn("tasks", "description", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("tasks", "priority", "TEXT NOT NULL DEFAULT 'medium'");
    this.ensureColumn("tasks", "focus_area_id", "TEXT");
    this.ensureColumn("tasks", "tags", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("tasks", "provider_source", "TEXT");
    this.ensureColumn("tasks", "created_at", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("tasks", "updated_at", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("assistant_chat_messages", "conversation_id", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_assistant_chat_messages_conversation_created_at
        ON assistant_chat_messages(conversation_id, created_at);
    `);
  }

  private ensureDefaultSettings(): void {
    if (!this.getSetting("userProfile")) {
      this.setSetting("userProfile", DEFAULT_PROFILE);
    }
    if (!this.getSetting("selectedProvider")) {
      this.setSetting("selectedProvider", "openai");
    }
    if (!this.getSetting("providerConfigs")) {
      this.setSetting("providerConfigs", DEFAULT_PROVIDER_CONFIGS);
    }
  }

  private migrateLegacyBoardState(): void {
    for (const [legacy, next] of Object.entries(LEGACY_STATUS_MAP)) {
      this.db.prepare("UPDATE tasks SET status = ? WHERE status = ?").run(next, legacy);
    }
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE tasks SET created_at = ? WHERE created_at = '' OR created_at IS NULL")
      .run(now);
    this.db
      .prepare("UPDATE tasks SET updated_at = ? WHERE updated_at = '' OR updated_at IS NULL")
      .run(now);
  }

  private migrateLegacyAssistantChatMessages(): void {
    const legacy = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM assistant_chat_messages
         WHERE conversation_id IS NULL OR conversation_id = ''`,
      )
      .get() as { count: number } | undefined;
    if (!legacy?.count) {
      return;
    }
    const firstMessage = this.db
      .prepare(
        `SELECT content, created_at
         FROM assistant_chat_messages
         WHERE conversation_id IS NULL OR conversation_id = ''
         ORDER BY created_at ASC, rowid ASC
         LIMIT 1`,
      )
      .get() as { content: string; created_at: string } | undefined;
    const range = this.db
      .prepare(
        `SELECT MIN(created_at) AS created_at, MAX(created_at) AS updated_at
         FROM assistant_chat_messages
         WHERE conversation_id IS NULL OR conversation_id = ''`,
      )
      .get() as { created_at: string | null; updated_at: string | null } | undefined;
    const now = new Date().toISOString();
    const conversation = {
      id: randomUUID(),
      title: titleFromAssistantChatMessage(firstMessage?.content ?? "Saved chat"),
      createdAt: range?.created_at || firstMessage?.created_at || now,
      updatedAt: range?.updated_at || firstMessage?.created_at || now,
    };
    this.db
      .prepare(
        `INSERT INTO assistant_chat_conversations (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
    this.db
      .prepare(
        `UPDATE assistant_chat_messages
         SET conversation_id = ?
         WHERE conversation_id IS NULL OR conversation_id = ''`,
      )
      .run(conversation.id);
  }

  private migrateFailedTasksToNeedsAttention(): void {
    this.db.exec(`
      UPDATE tasks
      SET status = 'needs_attention'
      WHERE status = 'in_progress'
        AND (
          SELECT status
          FROM task_executions
          WHERE task_executions.task_id = tasks.id
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1
        ) = 'failed'
    `);
  }

  private backfillFailedExecutionHandoffs(): void {
    this.db.exec(`
      UPDATE task_executions
      SET output =
        '## Failure handoff' || char(10) || char(10) ||
        'Task: ' || COALESCE((SELECT title FROM tasks WHERE tasks.id = task_executions.task_id), task_id) || char(10) ||
        'Status: needs_attention' || char(10) ||
        'Failure: ' || COALESCE(NULLIF(error, ''), progress_summary, 'The agent failed before producing a final result.') || char(10) || char(10) ||
        '### What happened' || char(10) ||
        'This run failed before producing a final task summary. It was recorded before detailed failed-command output capture was available.' || char(10) || char(10) ||
        '### Next developer or QA step' || char(10) ||
        'Move the task back to In Progress to rerun it with the patched agent. New failed shell commands will show exit code plus stdout and stderr snippets in the work log.',
        updated_at = datetime('now')
      WHERE status = 'failed'
        AND (output = '' OR output IS NULL)
    `);
  }

  private getSetting<T = unknown>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row) {
      return null;
    }
    return safeJsonParse<T | null>(row.value, null);
  }

  private setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  }

  private patchProviderConfigs(patches: ProviderConfigPatch[]): void {
    const current = new Map(
      this.getStoredProviderConfigs().map((config) => [config.provider, config]),
    );
    for (const patch of patches) {
      if (!PROVIDER_VALUES.has(patch.provider)) {
        continue;
      }
      const existing =
        current.get(patch.provider) ??
        DEFAULT_PROVIDER_CONFIGS.find((config) => config.provider === patch.provider)!;
      current.set(patch.provider, {
        ...existing,
        label: patch.label?.trim() || existing.label,
        model: patch.model?.trim() || existing.model,
        baseUrl:
          patch.baseUrl === null
            ? undefined
            : patch.baseUrl === undefined
              ? existing.baseUrl
              : patch.baseUrl.trim() || undefined,
        authMode: patch.authMode ?? existing.authMode,
        maxTokens:
          patch.maxTokens === null
            ? undefined
            : patch.maxTokens === undefined
              ? existing.maxTokens
              : normalizeIntegerInRange(patch.maxTokens, 1, 1_000_000),
        temperature:
          patch.temperature === null
            ? undefined
            : patch.temperature === undefined
              ? existing.temperature
              : normalizeNumberInRange(patch.temperature, 0, 2),
        reasoningEffort:
          patch.reasoningEffort === null
            ? undefined
            : patch.reasoningEffort === undefined
              ? existing.reasoningEffort
              : normalizeOpenAiReasoningEffort(patch.reasoningEffort),
        reasoningSummary:
          patch.reasoningSummary === null
            ? undefined
            : patch.reasoningSummary === undefined
              ? existing.reasoningSummary
              : normalizeOpenAiReasoningSummary(patch.reasoningSummary),
        textVerbosity:
          patch.textVerbosity === null
            ? undefined
            : patch.textVerbosity === undefined
              ? existing.textVerbosity
              : normalizeOpenAiTextVerbosity(patch.textVerbosity),
        timeoutMs:
          patch.timeoutMs === null
            ? undefined
            : patch.timeoutMs === undefined
              ? existing.timeoutMs
              : normalizeIntegerInRange(patch.timeoutMs, 1_000, 3_600_000),
        maxRetries:
          patch.maxRetries === null
            ? undefined
            : patch.maxRetries === undefined
              ? existing.maxRetries
              : normalizeIntegerInRange(patch.maxRetries, 0, 10),
        maxRetryDelayMs:
          patch.maxRetryDelayMs === null
            ? undefined
            : patch.maxRetryDelayMs === undefined
              ? existing.maxRetryDelayMs
              : normalizeIntegerInRange(patch.maxRetryDelayMs, 0, 600_000),
        cacheRetention:
          patch.cacheRetention === null
            ? undefined
            : patch.cacheRetention === undefined
              ? existing.cacheRetention
              : normalizeOpenAiCacheRetention(patch.cacheRetention),
        transport:
          patch.transport === null
            ? undefined
            : patch.transport === undefined
              ? existing.transport
              : normalizeOpenAiCodexTransport(patch.transport),
        organizationId:
          patch.organizationId === null
            ? undefined
            : patch.organizationId === undefined
              ? existing.organizationId
              : normalizeOptionalString(patch.organizationId),
        projectId:
          patch.projectId === null
            ? undefined
            : patch.projectId === undefined
              ? existing.projectId
              : normalizeOptionalString(patch.projectId),
        enabled: patch.enabled ?? existing.enabled,
        fallbackRank: patch.fallbackRank ?? existing.fallbackRank,
        apiKey:
          patch.apiKey === undefined
            ? existing.apiKey
            : patch.apiKey?.trim() || undefined,
      });
    }
    this.setSetting("providerConfigs", [...current.values()]);
  }

  private getStoredProviderConfigs(): StoredProviderConfig[] {
    const raw = this.getSetting<StoredProviderConfig[]>("providerConfigs");
    const byProvider = new Map(DEFAULT_PROVIDER_CONFIGS.map((entry) => [entry.provider, entry]));
    for (const entry of raw ?? []) {
      if (!entry || !PROVIDER_VALUES.has(entry.provider)) {
        continue;
      }
      const fallback = byProvider.get(entry.provider)!;
      byProvider.set(entry.provider, {
        ...fallback,
        ...entry,
        provider: entry.provider,
        label: entry.label?.trim() || fallback.label,
        model: entry.model?.trim() || fallback.model,
        baseUrl: entry.baseUrl?.trim() || fallback.baseUrl,
        authMode: entry.authMode === "api_key" ? "api_key" : "oauth",
        maxTokens: normalizeIntegerInRange(entry.maxTokens, 1, 1_000_000),
        temperature: normalizeNumberInRange(entry.temperature, 0, 2),
        reasoningEffort: normalizeOpenAiReasoningEffort(entry.reasoningEffort),
        reasoningSummary: normalizeOpenAiReasoningSummary(entry.reasoningSummary),
        textVerbosity: normalizeOpenAiTextVerbosity(entry.textVerbosity),
        timeoutMs: normalizeIntegerInRange(entry.timeoutMs, 1_000, 3_600_000),
        maxRetries: normalizeIntegerInRange(entry.maxRetries, 0, 10),
        maxRetryDelayMs: normalizeIntegerInRange(entry.maxRetryDelayMs, 0, 600_000),
        cacheRetention: normalizeOpenAiCacheRetention(entry.cacheRetention),
        transport: normalizeOpenAiCodexTransport(entry.transport),
        organizationId: normalizeOptionalString(entry.organizationId),
        projectId: normalizeOptionalString(entry.projectId),
        enabled: entry.enabled ?? fallback.enabled,
        fallbackRank: Number.isFinite(entry.fallbackRank)
          ? entry.fallbackRank
          : fallback.fallbackRank,
        apiKey: entry.apiKey?.trim() || undefined,
      });
    }
    return [...byProvider.values()].sort((a, b) => a.fallbackRank - b.fallbackRank);
  }

  private mapTask(row: TaskRow): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: normalizeTaskStatus(row.status),
      priority: normalizePriority(row.priority),
      focusAreaId: row.focus_area_id || null,
      tags: safeJsonParse<string[]>(row.tags, []),
      providerSource: normalizeProviderSource(row.provider_source),
      execution: this.getLatestTaskExecution(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTaskExecution(row: TaskExecutionRow): TaskExecution {
    return {
      id: row.id,
      taskId: row.task_id,
      agentRunId: row.agent_run_id,
      status: normalizeTaskExecutionStatus(row.status),
      provider: normalizeProviderSource(row.provider) ?? "local",
      model: row.model,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      progressSummary: row.progress_summary,
      output: row.output,
      error: row.error,
      artifacts: safeJsonParse<TaskExecutionArtifact[]>(row.artifacts, []),
      events: safeJsonParse<TaskExecutionEvent[]>(row.events, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAssistantChatConversation(
    row: AssistantChatConversationRow,
  ): AssistantChatConversation {
    return {
      id: row.id,
      title: normalizeAssistantChatConversationTitle(row.title),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAssistantChatMessage(row: AssistantChatMessageRow): AssistantChatMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id ?? "",
      role: normalizeAssistantChatRole(row.role),
      content: row.content,
      createdAt: row.created_at,
    };
  }

  private touchAssistantChatConversation(id: string, updatedAt: string): void {
    this.db
      .prepare("UPDATE assistant_chat_conversations SET updated_at = ? WHERE id = ?")
      .run(updatedAt, id);
  }

  private updateAssistantChatConversationTitle(id: string, title: string): void {
    this.db
      .prepare("UPDATE assistant_chat_conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, new Date().toISOString(), id);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export function formatPublicAccountIdentifier(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return `...${normalized.slice(-6)}`;
}

function resolveDefaultDbPath(): string {
  return path.resolve(process.env.BOARD_DB_PATH ?? "./data/board.db");
}

function normalizeProviderId(value: string | null | undefined): ProviderId {
  return PROVIDER_VALUES.has(value ?? "") ? (value as ProviderId) : "openai";
}

function normalizeProviderSource(
  value: string | null | undefined,
): ProviderId | "local" | null {
  if (!value) {
    return "local";
  }
  if (value === "local") {
    return "local";
  }
  return PROVIDER_VALUES.has(value) ? (value as ProviderId) : null;
}

function normalizeTaskStatus(
  value: string | null | undefined,
  fallback: TaskStatus = "draft",
): TaskStatus {
  const status = value?.trim();
  if (status && TASK_STATUS_VALUES.has(status)) {
    return status as TaskStatus;
  }
  return status ? (LEGACY_STATUS_MAP[status] ?? fallback) : fallback;
}

function normalizeTaskExecutionStatus(value: string | null | undefined): TaskExecutionStatus {
  return TASK_EXECUTION_STATUS_VALUES.has(value ?? "")
    ? (value as TaskExecutionStatus)
    : "queued";
}

function normalizeAssistantChatRole(value: string | null | undefined): AssistantChatRole {
  return value === "assistant" ? "assistant" : "user";
}

function normalizeAssistantChatConversationTitle(value: string | null | undefined): string {
  const title = value?.replace(/\s+/g, " ").trim();
  if (!title) {
    return "New conversation";
  }
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

function titleFromAssistantChatMessage(content: string): string {
  return normalizeAssistantChatConversationTitle(content);
}

function shouldReplaceAssistantChatConversationTitle(title: string): boolean {
  return title === "New conversation";
}

function normalizePriority(value: string | null | undefined): Priority {
  return PRIORITY_VALUES.has(value ?? "") ? (value as Priority) : "medium";
}

function normalizeUserProfile(input: UserProfilePatch | null | undefined): UserProfile {
  const fallbackLabels = DEFAULT_PROFILE.focusAreas.map((area) => area.label);
  const inputWorkAreas = normalizeStringList(input?.workAreas ?? []);
  const workAreaLabels =
    input?.focusAreas || !matchesLegacyDefaultWorkAreas(inputWorkAreas)
      ? normalizeStringList(input?.workAreas ?? fallbackLabels)
      : fallbackLabels;
  const focusAreas = normalizeFocusAreas(input?.focusAreas, workAreaLabels);
  return {
    workAreas: focusAreas.map((area) => area.label),
    focusAreas,
    preferredPlanningStyle:
      input?.preferredPlanningStyle?.trim() || DEFAULT_PROFILE.preferredPlanningStyle,
    recurringCommitments: normalizeStringList(input?.recurringCommitments ?? []),
    learnedPreferences: normalizeStringList(input?.learnedPreferences ?? []),
  };
}

function matchesLegacyDefaultWorkAreas(values: string[]): boolean {
  return (
    values.length === 3 &&
    values[0] === "Personal" &&
    values[1] === "Work" &&
    values[2] === "Learning"
  );
}

function normalizeFocusAreas(
  input: Array<Partial<FocusArea>> | undefined,
  fallbackLabels: string[],
): FocusArea[] {
  const source =
    input && input.length > 0
      ? input
      : fallbackLabels.map((label, index) => ({
          id: createFocusAreaId(label, []),
          label,
          color: FOCUS_AREA_COLORS[index % FOCUS_AREA_COLORS.length],
        }));
  const seenIds = new Set<string>();
  const normalized: FocusArea[] = [];
  for (const area of source) {
    const label = area.label?.trim();
    if (!label) {
      continue;
    }
    const id = uniqueFocusAreaId(area.id || createFocusAreaId(label, normalized), seenIds);
    seenIds.add(id);
    normalized.push({
      id,
      label,
      color: normalizeFocusAreaColor(area.color),
    });
  }
  return normalized.length > 0 ? normalized.slice(0, 12) : DEFAULT_PROFILE.focusAreas;
}

function normalizeFocusAreaColor(value: string | undefined): FocusAreaColor {
  return FOCUS_AREA_COLOR_VALUES.has(value ?? "")
    ? (value as FocusAreaColor)
    : FOCUS_AREA_COLORS[0];
}

function normalizeFocusAreaId(
  value: string | null | undefined,
  focusAreas: FocusArea[],
): string | null {
  if (!value) {
    return null;
  }
  return focusAreas.some((area) => area.id === value) ? value : null;
}

function createFocusAreaId(label: string, existing: FocusArea[]): string {
  const base = slugifyFocusAreaId(label) || "area";
  const used = new Set(existing.map((area) => area.id));
  return uniqueFocusAreaId(base, used);
}

function uniqueFocusAreaId(base: string, used: Set<string>): string {
  let candidate = slugifyFocusAreaId(base) || "area";
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${slugifyFocusAreaId(base) || "area"}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyFocusAreaId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeTags(tags: string[] | undefined): string[] {
  return normalizeStringList(tags ?? []).slice(0, 8);
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function normalizeIntegerInRange(
  value: number | null | undefined,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeNumberInRange(
  value: number | null | undefined,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeOpenAiReasoningEffort(
  value: string | null | undefined,
): StoredProviderConfig["reasoningEffort"] {
  return OPENAI_REASONING_EFFORT_VALUES.has(value ?? "")
    ? (value as StoredProviderConfig["reasoningEffort"])
    : undefined;
}

function normalizeOpenAiReasoningSummary(
  value: string | null | undefined,
): StoredProviderConfig["reasoningSummary"] {
  return OPENAI_REASONING_SUMMARY_VALUES.has(value ?? "")
    ? (value as StoredProviderConfig["reasoningSummary"])
    : undefined;
}

function normalizeOpenAiTextVerbosity(
  value: string | null | undefined,
): StoredProviderConfig["textVerbosity"] {
  return OPENAI_TEXT_VERBOSITY_VALUES.has(value ?? "")
    ? (value as StoredProviderConfig["textVerbosity"])
    : undefined;
}

function normalizeOpenAiCacheRetention(
  value: string | null | undefined,
): StoredProviderConfig["cacheRetention"] {
  return OPENAI_CACHE_RETENTION_VALUES.has(value ?? "")
    ? (value as StoredProviderConfig["cacheRetention"])
    : undefined;
}

function normalizeOpenAiCodexTransport(
  value: string | null | undefined,
): StoredProviderConfig["transport"] {
  return OPENAI_CODEX_TRANSPORT_VALUES.has(value ?? "")
    ? (value as StoredProviderConfig["transport"])
    : undefined;
}

function normalizeExecutionEvents(
  events: TaskExecutionEvent[],
  fallbackCreatedAt: string,
): TaskExecutionEvent[] {
  return events.map((event) => ({
    ...event,
    id: event.id || randomUUID(),
    createdAt: event.createdAt || fallbackCreatedAt,
  }));
}

function normalizeExecutionArtifacts(
  artifacts: TaskExecutionArtifact[],
  fallbackCreatedAt: string,
): TaskExecutionArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    id: artifact.id || randomUUID(),
    createdAt: artifact.createdAt || fallbackCreatedAt,
  }));
}

function normalizeOpenAiOAuthCredential(
  value: OpenAiOAuthCredential | null | undefined,
): OpenAiOAuthCredential | null {
  if (!value?.access || !value.refresh || !Number.isFinite(value.expires)) {
    return null;
  }
  return value;
}

function formatOAuthExpiresAt(value: OpenAiOAuthCredential | null): string | undefined {
  return value?.expires ? new Date(value.expires).toISOString() : undefined;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
