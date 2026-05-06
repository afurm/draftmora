import type { ProviderId, ProviderStatus } from "../../shared/types";
import type { BoardStore } from "../db";
import { resolveOpenAiOAuthAccess } from "./openai-auth";
import { openAiProvider } from "./openai";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderAuth,
  ToolCompletionRequest,
  ToolCompletionResult,
} from "./types";

export class ProviderRouter {
  constructor(private readonly store: BoardStore) {}

  statuses(): ProviderStatus[] {
    const settings = this.store.getSettings();
    return settings.providerConfigs.map((config) => {
      const apiKey = this.store.resolveApiKeyForProvider(config.provider);
      const baseUrl = this.store.resolveBaseUrlForProvider(config.provider);
      const configured =
        config.authMode === "oauth" ? config.hasOAuth : apiKey.source !== "missing";
      return {
        provider: config.provider,
        label: config.label,
        model: config.model,
        authMode: config.authMode,
        baseUrl: baseUrl.baseUrl,
        enabled: config.enabled,
        configured,
        source: config.authMode === "oauth" && config.hasOAuth ? "oauth" : apiKey.source,
        baseUrlSource: baseUrl.source,
        fallbackRank: config.fallbackRank,
        accountId: config.oauthAccountId,
        oauthExpiresAt: config.oauthExpiresAt,
      };
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const auth = await this.resolveProviderAuth(request.provider);
    return openAiProvider.complete(request, auth);
  }

  async completeWithTools(request: ToolCompletionRequest): Promise<ToolCompletionResult> {
    const auth = await this.resolveProviderAuth(request.provider);
    return openAiProvider.completeWithTools(request, auth);
  }

  async resolveProviderAuth(provider: ProviderId): Promise<ProviderAuth> {
    const config = this.store.getProviderConfig(provider);
    const baseUrl = this.store.resolveBaseUrlForProvider(provider);
    if (config.authMode === "oauth") {
      const oauth = await resolveOpenAiOAuthAccess(this.store);
      if (!oauth) {
        throw new Error("Connect OpenAI in Settings before starting AI work.");
      }
      return {
        provider,
        authMode: "oauth",
        apiKey: oauth.apiKey,
        source: "oauth",
        baseUrl: "https://chatgpt.com/backend-api",
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort,
        reasoningSummary: config.reasoningSummary,
        textVerbosity: config.textVerbosity,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        maxRetryDelayMs: config.maxRetryDelayMs,
        cacheRetention: config.cacheRetention,
        transport: config.transport,
      };
    }
    const apiKey = this.store.resolveApiKeyForProvider(provider);
    if (apiKey.source === "missing") {
      throw new Error("Add an OpenAI API key in Settings before starting AI work.");
    }
    return {
      provider,
      authMode: "api_key",
      apiKey: apiKey.apiKey,
      source: apiKey.source,
      baseUrl: baseUrl.baseUrl,
      headers: this.store.resolveHeadersForProvider(provider),
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      reasoningEffort: config.reasoningEffort,
      reasoningSummary: config.reasoningSummary,
      textVerbosity: config.textVerbosity,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      maxRetryDelayMs: config.maxRetryDelayMs,
      cacheRetention: config.cacheRetention,
      transport: config.transport,
    };
  }
}
