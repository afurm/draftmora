/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, ProviderStatus, Task } from "../shared/types";
import { App } from "./App";
import { api } from "./api";

vi.mock("./api", () => ({
  api: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    createTaskFollowUp: vi.fn(),
    forceTaskFollowUp: vi.fn(),
    deleteTask: vi.fn(),
    settings: vi.fn(),
    patchSettings: vi.fn(),
    providerStatus: vi.fn(),
    openAiAuth: vi.fn(),
    openAiAccountInfo: vi.fn(),
    startOpenAiAuth: vi.fn(),
    submitOpenAiAuthInput: vi.fn(),
    logoutOpenAiAuth: vi.fn(),
    assistantChatHistory: vi.fn(),
    createAssistantChatConversation: vi.fn(),
    askAssistant: vi.fn(),
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task()] });
  vi.mocked(api.getTask).mockResolvedValue({ task: task({ title: "Detailed task" }) });
  vi.mocked(api.settings).mockResolvedValue(settings());
  vi.mocked(api.providerStatus).mockResolvedValue({ providers: [providerStatus()] });
  vi.mocked(api.assistantChatHistory).mockResolvedValue({
    conversations: [],
    activeConversationId: null,
    messages: [],
  });
  vi.mocked(api.openAiAuth).mockResolvedValue({ configured: false, login: { phase: "idle" } });
  vi.mocked(api.openAiAccountInfo).mockResolvedValue({
    configured: false,
    prefetchedAt: "2026-05-02T00:00:00.000Z",
    recommendedModel: "gpt-5.5",
    currentModel: "gpt-5.5",
    currentModelSupported: true,
    models: [],
  });
  vi.mocked(api.startOpenAiAuth).mockResolvedValue({ configured: false, login: { phase: "idle" } });
  vi.mocked(api.submitOpenAiAuthInput).mockResolvedValue({
    configured: false,
    login: { phase: "idle" },
  });
  vi.mocked(api.logoutOpenAiAuth).mockResolvedValue({
    configured: false,
    login: { phase: "idle" },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("App task detail routing", () => {
  it("opens a task detail from the task search param", async () => {
    window.history.replaceState({}, "", "/?task=task-1");

    await renderApp();

    await waitFor(() => expect(api.getTask).toHaveBeenCalledWith("task-1"));
    await waitFor(() => {
      expect(document.body.querySelector<HTMLInputElement>("#task-title-inline")?.value).toBe(
        "Detailed task",
      );
    });
    expect(window.location.search).toBe("?task=task-1");
  });

  it("writes and removes the task search param as the detail opens and closes", async () => {
    await renderApp();

    await waitFor(() =>
      expect(
        document.body.querySelector('[role="button"][aria-label="Open task Route task"]'),
      ).toBeTruthy(),
    );
    await clickSelector('[role="button"][aria-label="Open task Route task"]');

    expect(window.location.search).toBe("?task=task-1");
    await waitFor(() => expect(api.getTask).toHaveBeenCalledWith("task-1"));
    await waitFor(() =>
      expect(document.body.querySelector('button[aria-label="Close task"]')).toBeTruthy(),
    );

    await clickSelector('button[aria-label="Close task"]');

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(document.body.querySelector("#task-title-inline")).toBeNull();
  });
});

describe("App settings view", () => {
  it("hides board actions and uses settings-specific copy", async () => {
    await renderApp();

    await waitFor(() =>
      expect(
        document.body.querySelector('[role="button"][aria-label="Open task Route task"]'),
      ).toBeTruthy(),
    );
    await clickButtonByText("Settings");

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        "Connect OpenAI and manage local board preferences.",
      );
      expect(document.body.textContent).toContain("OpenAI connection");
    });

    expect(document.body.querySelector('[aria-label="Search tasks"]')).toBeNull();
    expect(document.body.querySelector('button[aria-label="New task"]')).toBeNull();
  });

  it("lets the sidebar Chat toggle leave settings cleanly", async () => {
    await renderApp();

    await waitFor(() =>
      expect(
        document.body.querySelector('[role="button"][aria-label="Open task Route task"]'),
      ).toBeTruthy(),
    );
    await clickButtonByText("Settings");

    await waitFor(() => {
      expect(document.body.textContent).toContain("OpenAI connection");
    });

    await clickSelector('button[aria-label="Show chat"]');

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        "Talk with the agent. Each conversation keeps its own saved history.",
      );
      expect(document.body.textContent).toContain("Ask about priorities");
      expect(document.body.textContent).not.toContain("OpenAI connection");
    });
    expect(
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[aria-current="page"]'))
        .some((button) => button.textContent?.includes("Settings")),
    ).toBe(false);
  });
});

async function renderApp() {
  await act(async () => {
    root.render(<App />);
  });
}

async function clickSelector(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector);
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickButtonByText(text: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let index = 0; index < 120; index += 1) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Route task",
    description: "Open this task from the URL.",
    status: "ready",
    priority: "medium",
    focusAreaId: null,
    tags: [],
    providerSource: "local",
    execution: null,
    createdAt: "2026-05-06T10:00:00.000Z",
    updatedAt: "2026-05-06T10:00:00.000Z",
    ...patch,
  };
}

function settings(): AppSettings {
  return {
    selectedProvider: "openai",
    providerConfigs: [],
    userProfile: {
      workAreas: [],
      focusAreas: [],
    },
  };
}

function providerStatus(): ProviderStatus {
  return {
    provider: "openai",
    label: "OpenAI",
    model: "gpt-5.5",
    authMode: "oauth",
    baseUrl: "https://api.openai.com/v1",
    enabled: true,
    configured: false,
    source: "missing",
    baseUrlSource: "default",
    fallbackRank: 0,
  };
}
