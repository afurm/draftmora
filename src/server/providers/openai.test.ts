import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAiProvider } from "./openai";
import type { CompletionRequest, ProviderAuth, ToolCompletionRequest } from "./types";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: mocks.complete,
  getModels: mocks.getModels,
}));

const model = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 100000,
};

const auth: ProviderAuth = {
  provider: "openai",
  authMode: "oauth",
  apiKey: "test-token",
  source: "oauth",
  baseUrl: "https://chatgpt.com/backend-api",
};

function makeRequest(messages: CompletionRequest["messages"]): CompletionRequest {
  return {
    provider: "openai",
    model: "gpt-5.5",
    messages,
    systemPrompt: "Answer in Markdown.",
  };
}

function assistantMessage(content = "Scoped follow-up answer.") {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function assistantErrorMessage(errorMessage: string) {
  return {
    ...assistantMessage(""),
    content: [],
    stopReason: "error",
    errorMessage,
  };
}

function assistantMessageWithToolCall() {
  return {
    ...assistantMessage(""),
    content: [
      {
        type: "toolCall",
        id: "call-1",
        name: "read_file",
        arguments: { path: "README.md" },
      },
    ],
    stopReason: "toolUse",
  };
}

describe("openAiProvider", () => {
  beforeEach(() => {
    mocks.complete.mockReset();
    mocks.getModels.mockReset();
    mocks.getModels.mockReturnValue([model]);
  });

  it("serializes prior assistant turns as structured SDK messages", async () => {
    let capturedContext: unknown;
    mocks.complete.mockImplementation(async (_model, context) => {
      capturedContext = context;
      return assistantMessage();
    });

    const response = await openAiProvider.complete(
      makeRequest([
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hi! How can I help?" },
        { role: "user", content: "what do you know about me?" },
      ]),
      auth,
    );

    expect(response.content).toBe("Scoped follow-up answer.");
    expect(capturedContext).toMatchObject({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi! How can I help?" }],
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-5.5",
        },
        { role: "user", content: "what do you know about me?" },
      ],
    });
  });

  it("surfaces SDK error responses instead of storing an empty fallback", async () => {
    mocks.complete.mockResolvedValue({
      ...assistantMessage(""),
      content: [],
      stopReason: "error",
      errorMessage: "assistantMsg.content.flatMap is not a function",
    });

    await expect(
      openAiProvider.complete(
        makeRequest([
          { role: "user", content: "hi" },
          { role: "assistant", content: "Hi! How can I help?" },
          { role: "user", content: "follow up" },
        ]),
        auth,
      ),
    ).rejects.toThrow("assistantMsg.content.flatMap is not a function");
  });

  it("retries OAuth Codex WebSocket closes over SSE", async () => {
    mocks.complete
      .mockResolvedValueOnce({
        ...assistantMessage(""),
        content: [],
        stopReason: "error",
        errorMessage: "WebSocket closed 1006",
      })
      .mockResolvedValueOnce(assistantMessage("Recovered over SSE."));

    const response = await openAiProvider.complete(
      makeRequest([{ role: "user", content: "continue the task" }]),
      { ...auth, transport: "auto" },
    );

    expect(response.content).toBe("Recovered over SSE.");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({ transport: "auto" });
    expect(mocks.complete.mock.calls[1][2]).toMatchObject({ transport: "sse" });
  });

  it("retries transient Codex assistant error payloads", async () => {
    mocks.complete
      .mockResolvedValueOnce(
        assistantErrorMessage(
          'Codex error: {"type":"error","error":{"type":"service_unavailable_error","code":"server_is_overloaded","message":"Our servers are currently overloaded. Please try again later."},"sequence_number":2}',
        ),
      )
      .mockResolvedValueOnce(assistantMessage("Recovered after overload retry."));

    const response = await openAiProvider.complete(
      makeRequest([{ role: "user", content: "continue the task" }]),
      { ...auth, maxRetries: 2, maxRetryDelayMs: 0 },
    );

    expect(response.content).toBe("Recovered after overload retry.");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient assistant error payloads", async () => {
    mocks.complete.mockResolvedValue(
      assistantErrorMessage(
        'Codex error: {"type":"error","error":{"type":"invalid_request_error","message":"Request size exceeds model context window"}}',
      ),
    );

    await expect(
      openAiProvider.complete(
        makeRequest([{ role: "user", content: "continue the task" }]),
        { ...auth, maxRetries: 2, maxRetryDelayMs: 0 },
      ),
    ).rejects.toThrow("Request size exceeds model context window");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("passes saved OpenAI request configuration to the SDK", async () => {
    let capturedOptions: unknown;
    mocks.complete.mockImplementation(async (_model, _context, options) => {
      capturedOptions = options;
      return assistantMessage();
    });

    await openAiProvider.complete(
      makeRequest([{ role: "user", content: "ship it" }]),
      {
        ...auth,
        authMode: "api_key",
        source: "local",
        baseUrl: "https://api.openai.com/v1",
        headers: {
          "OpenAI-Organization": "org_test",
          "OpenAI-Project": "proj_test",
        },
        maxTokens: 4000,
        temperature: 0.2,
        reasoningEffort: "medium",
        reasoningSummary: "concise",
        textVerbosity: "high",
        timeoutMs: 45_000,
        maxRetries: 3,
        maxRetryDelayMs: 10_000,
        cacheRetention: "long",
      },
    );

    expect(capturedOptions).toMatchObject({
      apiKey: "test-token",
      maxTokens: 4000,
      temperature: 0.2,
      reasoningEffort: "medium",
      reasoningSummary: "concise",
      textVerbosity: "high",
      timeoutMs: 45_000,
      maxRetries: 3,
      maxRetryDelayMs: 10_000,
      cacheRetention: "long",
      headers: {
        "OpenAI-Organization": "org_test",
        "OpenAI-Project": "proj_test",
      },
    });
  });

  it("preserves request token caps over saved provider defaults", async () => {
    let capturedOptions: unknown;
    mocks.complete.mockImplementation(async (_model, _context, options) => {
      capturedOptions = options;
      return assistantMessage();
    });

    await openAiProvider.complete(
      {
        ...makeRequest([{ role: "user", content: "keep this bounded" }]),
        maxTokens: 1200,
      },
      {
        ...auth,
        maxTokens: 4000,
      },
    );

    expect(capturedOptions).toMatchObject({
      maxTokens: 1200,
    });
  });

  it("allows tool-use responses through completeWithTools", async () => {
    mocks.complete.mockResolvedValue(assistantMessageWithToolCall());

    const response = await openAiProvider.completeWithTools(
      {
        ...makeRequest([{ role: "user", content: "inspect the repo" }]),
        context: {
          systemPrompt: "Use tools.",
          messages: [{ role: "user", content: "inspect the repo", timestamp: Date.now() }],
          tools: [
            {
              name: "read_file",
              description: "Read a file.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          ],
        },
        tools: [],
      } satisfies ToolCompletionRequest,
      auth,
    );

    expect(response.content).toBe("");
    expect(response.raw.stopReason).toBe("toolUse");
    expect(response.raw.content[0]).toMatchObject({
      type: "toolCall",
      name: "read_file",
    });
  });
});
