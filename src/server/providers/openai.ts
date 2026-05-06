import {
  complete,
  getModels,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ProviderStreamOptions,
  type Usage,
} from "@mariozechner/pi-ai";
import type { AiProvider, ChatMessage, CompletionRequest, ProviderAuth } from "./types";
import { redactedError, redactSensitiveErrorMessage } from "../redaction";

const DEFAULT_TRANSIENT_ERROR_RETRIES = 2;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 1_000;
const MAX_TRANSIENT_RETRY_DELAY_MS = 30_000;

export const openAiProvider: AiProvider = {
  async complete(request, auth) {
    const model = resolveOpenAiModel(auth, request.model);
    const context = buildContext(model, request.messages, request.systemPrompt);
    const raw = await completeOpenAi(model, context, auth, request.maxTokens, request.signal);
    return {
      content: extractAssistantText(assertUsableAssistantMessage(raw)),
      raw,
    };
  },

  async completeWithTools(request, auth) {
    const model = resolveOpenAiModel(auth, request.model);
    const raw = assertNonErrorAssistantMessage(
      await completeOpenAi(
        model,
        { ...request.context, tools: request.context.tools ?? request.tools },
        auth,
        request.maxTokens,
        request.signal,
      ),
    );
    return {
      content: extractAssistantText(raw),
      raw,
    };
  },
};

async function completeOpenAi(
  model: Model<Api>,
  context: Context,
  auth: ProviderAuth,
  maxTokens?: number,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  const options = buildOpenAiOptions(auth, maxTokens, signal);
  const retryCount = resolveTransientRetryCount(auth);
  let lastRetryableError: Error | undefined;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    throwIfRequestCancelled(signal);
    try {
      const message = await completeOpenAiOnce(model, context, auth, options);
      throwIfRequestCancelled(signal);
      if (!isRetryableOpenAiError(message)) {
        return message;
      }
      lastRetryableError = new Error(
        redactSensitiveErrorMessage(message.errorMessage || "OpenAI request failed."),
      );
    } catch (err) {
      const error = redactedError(err);
      if (!isRetryableOpenAiError(error)) {
        throw error;
      }
      lastRetryableError = error;
    }
    if (attempt >= retryCount) {
      break;
    }
    await waitBeforeTransientRetry(attempt, auth, signal);
  }
  throw lastRetryableError ?? new Error("OpenAI request failed.");
}

async function completeOpenAiOnce(
  model: Model<Api>,
  context: Context,
  auth: ProviderAuth,
  options: ProviderStreamOptions,
): Promise<AssistantMessage> {
  try {
    const message = await complete(model, context, options);
    if (shouldRetryCodexOverSse(message, auth, options)) {
      return await complete(model, context, { ...options, transport: "sse" });
    }
    return message;
  } catch (err) {
    const error = redactedError(err);
    if (shouldRetryCodexOverSse(error, auth, options)) {
      try {
        return await complete(model, context, { ...options, transport: "sse" });
      } catch (retryErr) {
        throw redactedError(retryErr);
      }
    }
    throw error;
  }
}

function resolveTransientRetryCount(auth: ProviderAuth) {
  return Math.max(0, auth.maxRetries ?? DEFAULT_TRANSIENT_ERROR_RETRIES);
}

async function waitBeforeTransientRetry(
  attempt: number,
  auth: ProviderAuth,
  signal?: AbortSignal,
): Promise<void> {
  const maxDelayMs = auth.maxRetryDelayMs ?? MAX_TRANSIENT_RETRY_DELAY_MS;
  const delayMs = Math.min(DEFAULT_TRANSIENT_RETRY_DELAY_MS * 2 ** attempt, maxDelayMs);
  if (delayMs <= 0) {
    return;
  }
  await waitWithCancellation(delayMs, signal);
}

function buildOpenAiOptions(
  auth: ProviderAuth,
  requestMaxTokens?: number,
  signal?: AbortSignal,
): ProviderStreamOptions {
  const options: ProviderStreamOptions = {
    apiKey: auth.apiKey,
  };
  if (signal) {
    options.signal = signal;
  }
  const maxTokens = requestMaxTokens ?? auth.maxTokens;
  if (maxTokens !== undefined) {
    options.maxTokens = maxTokens;
  }
  if (auth.temperature !== undefined) {
    options.temperature = auth.temperature;
  }
  if (auth.authMode === "oauth") {
    options.transport = auth.transport ?? "auto";
  } else if (auth.transport) {
    options.transport = auth.transport;
  }
  if (auth.cacheRetention) {
    options.cacheRetention = auth.cacheRetention;
  }
  if (auth.timeoutMs !== undefined) {
    options.timeoutMs = auth.timeoutMs;
  }
  if (auth.maxRetries !== undefined) {
    options.maxRetries = auth.maxRetries;
  }
  if (auth.maxRetryDelayMs !== undefined) {
    options.maxRetryDelayMs = auth.maxRetryDelayMs;
  }
  if (auth.headers) {
    options.headers = auth.headers;
  }
  if (auth.reasoningEffort) {
    options.reasoningEffort = auth.reasoningEffort;
  }
  if (auth.reasoningSummary) {
    options.reasoningSummary = auth.reasoningSummary;
  }
  if (auth.textVerbosity) {
    options.textVerbosity = auth.textVerbosity;
  }
  return options;
}

function shouldRetryCodexOverSse(
  result: AssistantMessage | Error,
  auth: ProviderAuth,
  options: ProviderStreamOptions,
) {
  return (
    auth.authMode === "oauth" &&
    options.transport !== "sse" &&
    isWebSocketCloseError(result)
  );
}

function isRetryableOpenAiError(result: AssistantMessage | Error) {
  const message =
    result instanceof Error
      ? result.message
      : result.stopReason === "error" || result.stopReason === "aborted"
        ? result.errorMessage
        : undefined;
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  if (/\b(abort|aborted|cancelled|canceled)\b/.test(normalized)) {
    return false;
  }
  if (
    /\b(authentication_error|invalid_request_error|permission_denied|insufficient_quota)\b/.test(
      normalized,
    ) ||
    /\b(billing|context window|invalid api key|unsupported)\b/.test(normalized)
  ) {
    return false;
  }
  return (
    /\b(service_unavailable_error|server_is_overloaded|overloaded_error|server_error|rate_limit_error)\b/.test(
      normalized,
    ) ||
    /\b(temporarily overloaded|currently overloaded|try again later|gateway timeout|service unavailable|websocket closed)\b/.test(
      normalized,
    ) ||
    /\b(429|500|502|503|504|529)\b/.test(normalized)
  );
}

function throwIfRequestCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const error = new Error(typeof reason === "string" ? reason : "Request cancelled.");
  error.name = "AbortError";
  throw error;
}

function waitWithCancellation(delayMs: number, signal?: AbortSignal) {
  throwIfRequestCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    function onAbort() {
      cleanup();
      try {
        throwIfRequestCancelled(signal);
      } catch (err) {
        reject(err);
      }
    }
    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isWebSocketCloseError(result: AssistantMessage | Error) {
  const message =
    result instanceof Error
      ? result.message
      : result.stopReason === "error"
        ? result.errorMessage
        : undefined;
  return /\bWebSocket closed(?:\s+\d+)?\b/i.test(message ?? "");
}

function resolveOpenAiModel(auth: ProviderAuth, modelId: string): Model<Api> {
  const provider = auth.authMode === "oauth" ? "openai-codex" : "openai";
  const models = getModels(provider);
  const fallbackId = auth.authMode === "oauth" ? "gpt-5.5" : "gpt-5.5";
  const model = models.find((entry) => entry.id === modelId) ?? models.find((entry) => entry.id === fallbackId) ?? models[0];
  if (!model) {
    throw new Error("No OpenAI models are available.");
  }
  return {
    ...model,
    baseUrl: auth.authMode === "api_key" ? auth.baseUrl : model.baseUrl,
  } as Model<Api>;
}

export function buildContext(
  model: Model<Api>,
  messages: ChatMessage[],
  systemPrompt?: string,
): Context {
  const systemMessages = messages.filter((message) => message.role === "system");
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  return {
    systemPrompt:
      systemPrompt ??
      systemMessages.map((message) => message.content).filter(Boolean).join("\n\n") ??
      undefined,
    messages: nonSystemMessages.map((message, index) =>
      toContextMessage(model, message, Date.now() + index),
    ),
  };
}

function toContextMessage(
  model: Model<Api>,
  message: Exclude<ChatMessage, { role: "system" }>,
  timestamp: number,
): Message {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp,
    };
  }
  return {
    role: "user",
    content: message.content,
    timestamp,
  };
}

function assertUsableAssistantMessage(message: AssistantMessage): AssistantMessage {
  const usable = assertNonErrorAssistantMessage(message);
  if (!extractAssistantText(usable)) {
    throw new Error("OpenAI returned an empty assistant response.");
  }
  return usable;
}

function assertNonErrorAssistantMessage(message: AssistantMessage): AssistantMessage {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(
      redactSensitiveErrorMessage(message.errorMessage || "OpenAI request failed."),
    );
  }
  return message;
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

export function listOpenAiCodexModels() {
  return getModels("openai-codex");
}
