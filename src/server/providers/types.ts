import type { AssistantMessage, Context, Tool } from "@mariozechner/pi-ai";
import type {
  OpenAiCacheRetention,
  OpenAiCodexTransport,
  OpenAiReasoningEffort,
  OpenAiReasoningSummary,
  OpenAiTextVerbosity,
  ProviderAuthMode,
  ProviderId,
} from "../../shared/types";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderAuth = {
  provider: ProviderId;
  authMode: ProviderAuthMode;
  apiKey: string;
  source: "env" | "local" | "oauth";
  baseUrl: string;
  headers?: Record<string, string>;
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
};

export type CompletionRequest = {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type CompletionResult = {
  content: string;
  raw: AssistantMessage;
};

export type ToolCompletionRequest = CompletionRequest & {
  context: Context;
  tools: Tool[];
};

export type ToolCompletionResult = CompletionResult;

export type AiProvider = {
  complete: (request: CompletionRequest, auth: ProviderAuth) => Promise<CompletionResult>;
  completeWithTools: (
    request: ToolCompletionRequest,
    auth: ProviderAuth,
  ) => Promise<ToolCompletionResult>;
};
