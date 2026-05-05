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

export const openAiProvider: AiProvider = {
  async complete(request, auth) {
    const model = resolveOpenAiModel(auth, request.model);
    const context = buildContext(model, request.messages, request.systemPrompt);
    const raw = await completeOpenAi(model, context, auth, request.maxTokens);
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
): Promise<AssistantMessage> {
  try {
    return await complete(model, context, {
      ...buildOpenAiOptions(auth, maxTokens),
    });
  } catch (err) {
    throw redactedError(err);
  }
}

function buildOpenAiOptions(
  auth: ProviderAuth,
  requestMaxTokens?: number,
): ProviderStreamOptions {
  const options: ProviderStreamOptions = {
    apiKey: auth.apiKey,
  };
  const maxTokens = auth.maxTokens ?? requestMaxTokens;
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
