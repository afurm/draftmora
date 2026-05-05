export const TASK_STATUSES = [
  "draft",
  "ready",
  "in_progress",
  "needs_attention",
  "done",
] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const PROVIDERS = ["openai"] as const;
export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
] as const;
export const MEMORY_TARGETS = ["user", "memory"] as const;
export const OPENAI_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export const OPENAI_REASONING_SUMMARIES = ["auto", "concise", "detailed"] as const;
export const OPENAI_TEXT_VERBOSITIES = ["low", "medium", "high"] as const;
export const OPENAI_CACHE_RETENTIONS = ["none", "short", "long"] as const;
export const OPENAI_CODEX_TRANSPORTS = [
  "auto",
  "sse",
  "websocket",
  "websocket-cached",
] as const;
export const FOCUS_AREA_COLORS = [
  "blue",
  "emerald",
  "amber",
  "rose",
  "violet",
  "cyan",
  "lime",
  "orange",
  "slate",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type ProviderId = (typeof PROVIDERS)[number];
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type MemoryTarget = (typeof MEMORY_TARGETS)[number];
export type FocusAreaColor = (typeof FOCUS_AREA_COLORS)[number];
export type ProviderAuthMode = "oauth" | "api_key";
export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];
export type OpenAiReasoningSummary = (typeof OPENAI_REASONING_SUMMARIES)[number];
export type OpenAiTextVerbosity = (typeof OPENAI_TEXT_VERBOSITIES)[number];
export type OpenAiCacheRetention = (typeof OPENAI_CACHE_RETENTIONS)[number];
export type OpenAiCodexTransport = (typeof OPENAI_CODEX_TRANSPORTS)[number];

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  focusAreaId: string | null;
  tags: string[];
  providerSource: ProviderId | "local" | null;
  execution: TaskExecution | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskCreateInput = {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  focusAreaId?: string | null;
  tags?: string[];
  providerSource?: ProviderId | "local" | null;
};

export type TaskUpdateInput = Partial<TaskCreateInput>;

export type TaskExecutionStatus = "queued" | "running" | "succeeded" | "failed";
export type TaskExecutionEventKind =
  | "queued"
  | "running"
  | "progress"
  | "artifact"
  | "succeeded"
  | "failed";

export interface TaskExecution {
  id: string;
  taskId: string;
  agentRunId: string | null;
  status: TaskExecutionStatus;
  provider: ProviderId | "local";
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  progressSummary: string;
  output: string;
  error: string | null;
  artifacts: TaskExecutionArtifact[];
  events: TaskExecutionEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskExecutionEvent {
  id: string;
  kind: TaskExecutionEventKind;
  message: string;
  createdAt: string;
}

export interface TaskExecutionArtifact {
  id: string;
  type: "link" | "evidence" | "note" | "output";
  title: string;
  content?: string;
  url?: string;
  createdAt: string;
}

export interface UserProfile {
  workAreas: string[];
  focusAreas: FocusArea[];
  preferredPlanningStyle?: string;
  recurringCommitments?: string[];
  learnedPreferences?: string[];
}

export interface FocusArea {
  id: string;
  label: string;
  color: FocusAreaColor;
}

export interface ProviderConfig {
  provider: ProviderId;
  label: string;
  model: string;
  baseUrl?: string;
  authMode: ProviderAuthMode;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: OpenAiReasoningEffort;
  reasoningSummary?: OpenAiReasoningSummary;
  textVerbosity?: OpenAiTextVerbosity;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  cacheRetention?: OpenAiCacheRetention;
  transport?: OpenAiCodexTransport;
  organizationId?: string;
  projectId?: string;
  enabled: boolean;
  fallbackRank: number;
}

type NullableProviderConfigFields = {
  maxTokens?: number | null;
  temperature?: number | null;
  reasoningEffort?: OpenAiReasoningEffort | null;
  reasoningSummary?: OpenAiReasoningSummary | null;
  textVerbosity?: OpenAiTextVerbosity | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  maxRetryDelayMs?: number | null;
  cacheRetention?: OpenAiCacheRetention | null;
  transport?: OpenAiCodexTransport | null;
  organizationId?: string | null;
  projectId?: string | null;
};

export type ProviderConfigPatch = Partial<
  Omit<ProviderConfig, "provider" | "baseUrl" | keyof NullableProviderConfigFields>
> &
  NullableProviderConfigFields & {
  provider: ProviderId;
  baseUrl?: string | null;
  apiKey?: string | null;
};

export interface ProviderStatus {
  provider: ProviderId;
  label: string;
  model: string;
  authMode: ProviderAuthMode;
  baseUrl: string;
  enabled: boolean;
  configured: boolean;
  source: "env" | "local" | "missing" | "oauth";
  baseUrlSource: "default" | "env" | "local";
  fallbackRank: number;
  accountId?: string;
  oauthExpiresAt?: string;
}

export interface AppSettings {
  selectedProvider: ProviderId;
  providerConfigs: Array<
    ProviderConfig & {
      hasApiKey: boolean;
      hasOAuth: boolean;
      oauthAccountId?: string;
      oauthExpiresAt?: string;
    }
  >;
  userProfile: UserProfile;
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  rationale: string;
  proposedTaskPatch: TaskCreateInput;
  status: SuggestionStatus;
  createdAt: string;
}

export type SuggestionKind = "plan_day" | "break_down" | "project_tasks" | "manual";
export type SuggestionStatus = "pending" | "approved" | "dismissed";

export interface AssistantSuggestResponse {
  suggestions: Suggestion[];
}

export type AssistantChatRole = "user" | "assistant";

export interface AssistantChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantChatTurn {
  role: AssistantChatRole;
  content: string;
}

export interface AssistantChatMessage extends AssistantChatTurn {
  id: string;
  conversationId: string;
  createdAt: string;
  proposedActions?: AssistantProposedAction[];
}

export interface AssistantChatRequest {
  conversationId?: string | null;
  messages: AssistantChatTurn[];
}

export interface AssistantChatHistoryResponse {
  conversations: AssistantChatConversation[];
  activeConversationId: string | null;
  messages: AssistantChatMessage[];
}

export interface AssistantChatResponse {
  conversation: AssistantChatConversation;
  conversations: AssistantChatConversation[];
  message: AssistantChatMessage;
  messages: AssistantChatMessage[];
  proposedActions: AssistantProposedAction[];
  provider: ProviderId;
  model: string;
}

export type AssistantProposedAction =
  | {
      id: string;
      type: "create_task";
      title: string;
      rationale?: string;
      task: TaskCreateInput;
    }
  | {
      id: string;
      type: "update_task";
      title: string;
      rationale?: string;
      taskId: string;
      patch: TaskUpdateInput;
    }
  | {
      id: string;
      type: "move_task";
      title: string;
      rationale?: string;
      taskId: string;
      status: TaskStatus;
    };

export interface ModelCapability {
  provider: ProviderId;
  model: string;
  supportsTools: boolean;
  supportsFilesystem: boolean;
  supportsShell: boolean;
  supportsMemory: boolean;
  supportsEmbeddings: boolean;
  checkedAt: string;
  reason?: string | null;
}

export interface WorkspaceConfig {
  id: string;
  path: string;
  label: string;
  isDefault: boolean;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string | null;
  executionId: string | null;
  prompt: string;
  status: AgentRunStatus;
  provider: ProviderId | "local";
  model: string | null;
  workspaceRoot: string;
  title: string;
  finalAnswer: string;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  events?: AgentRunEvent[];
  createdAt: string;
  updatedAt: string;
}

export type AgentRunEventKind = "lifecycle" | "assistant" | "tool" | "error";

export interface AgentRunEvent {
  id: string;
  runId: string;
  kind: AgentRunEventKind;
  message: string;
  toolCallId: string | null;
  toolName: string | null;
  toolArgs: Record<string, unknown> | null;
  toolResult?: unknown;
  exitCode: number | null;
  createdAt: string;
}

export interface OpenAiOAuthLoginState {
  phase: "idle" | "starting" | "waiting" | "complete" | "failed";
  loginId?: string;
  authUrl?: string;
  progress?: string;
  error?: string;
  manualInputAllowed?: boolean;
}

export interface OpenAiAuthState {
  configured: boolean;
  accountId?: string;
  oauthExpiresAt?: string;
  login: OpenAiOAuthLoginState;
}

export interface OpenAiUsageWindow {
  label: string;
  usedPercent: number;
  resetAt?: string;
}

export interface OpenAiAccountInfo {
  configured: boolean;
  accountId?: string;
  oauthExpiresAt?: string;
  prefetchedAt: string;
  recommendedModel: string;
  currentModel: string;
  currentModelSupported: boolean;
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: string[];
    recommended: boolean;
    current: boolean;
  }>;
  usage?: {
    plan?: string;
    windows: OpenAiUsageWindow[];
    error?: string;
  };
}

export const COLUMN_LABELS: Record<TaskStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  in_progress: "In Progress",
  needs_attention: "Needs Attention",
  done: "Done",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
