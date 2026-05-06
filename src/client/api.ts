import type {
  AppSettings,
  AssistantChatHistoryResponse,
  AssistantChatRequest,
  AssistantChatResponse,
  OpenAiAccountInfo,
  OpenAiAuthState,
  ProviderConfigPatch,
  ProviderStatus,
  Task,
  TaskCreateInput,
  TaskExecution,
  TaskFollowUpInput,
  TaskFollowUpMode,
  TaskUpdateInput,
} from "../shared/types";

export type TaskMutationResponse = {
  task: Task;
  execution?: TaskExecution;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    headers,
    ...init,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  async listTasks() {
    return request<{ tasks: Task[] }>("/api/tasks");
  },
  async getTask(id: string) {
    return request<{ task: Task }>(`/api/tasks/${id}`);
  },
  async createTask(input: TaskCreateInput) {
    return request<TaskMutationResponse>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async updateTask(id: string, input: TaskUpdateInput) {
    return request<TaskMutationResponse>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  async createTaskFollowUp(id: string, prompt: string, mode: TaskFollowUpMode = "queue") {
    const input: TaskFollowUpInput = { prompt, mode };
    return request<TaskMutationResponse>(`/api/tasks/${id}/follow-up`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async abortTaskRun(id: string) {
    return request<TaskMutationResponse>(`/api/tasks/${id}/abort`, { method: "POST" });
  },
  async forceTaskFollowUp(id: string, executionId: string) {
    return request<TaskMutationResponse>(`/api/tasks/${id}/follow-up/${executionId}/force`, {
      method: "POST",
    });
  },
  async deleteTask(id: string) {
    return request<void>(`/api/tasks/${id}`, { method: "DELETE" });
  },
  async openTaskArtifact(id: string, artifactId: string) {
    return request<{ ok: boolean; path: string }>(
      `/api/tasks/${id}/artifacts/${artifactId}/open`,
      { method: "POST" },
    );
  },
  async settings() {
    return request<AppSettings>("/api/settings");
  },
  async patchSettings(input: {
    selectedProvider?: AppSettings["selectedProvider"];
    userProfile?: AppSettings["userProfile"];
    providerConfigs?: ProviderConfigPatch[];
  }) {
    return request<AppSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  async providerStatus() {
    return request<{ providers: ProviderStatus[] }>("/api/providers/status");
  },
  async openAiAuth() {
    return request<OpenAiAuthState>("/api/providers/openai/auth");
  },
  async openAiAccountInfo() {
    return request<OpenAiAccountInfo>("/api/providers/openai/account-info");
  },
  async startOpenAiAuth() {
    return request<OpenAiAuthState>("/api/providers/openai/auth/start", { method: "POST" });
  },
  async submitOpenAiAuthInput(loginId: string, input: string) {
    return request<OpenAiAuthState>("/api/providers/openai/auth/input", {
      method: "POST",
      body: JSON.stringify({ loginId, input }),
    });
  },
  async logoutOpenAiAuth() {
    return request<OpenAiAuthState>("/api/providers/openai/auth/logout", { method: "POST" });
  },
  async assistantChatHistory(conversationId?: string | null) {
    const search = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
    return request<AssistantChatHistoryResponse>(`/api/assistant/chat${search}`);
  },
  async createAssistantChatConversation(title?: string) {
    return request<AssistantChatHistoryResponse>("/api/assistant/chat/conversations", {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    });
  },
  async askAssistant(
    messages: AssistantChatRequest["messages"],
    conversationId?: string | null,
  ) {
    return request<AssistantChatResponse>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId, messages } satisfies AssistantChatRequest),
    });
  },
};
