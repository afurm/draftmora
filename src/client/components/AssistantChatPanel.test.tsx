/** @vitest-environment jsdom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantChatMessage } from "../../shared/types";
import { AssistantChatPanel } from "./AssistantChatPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type AssistantChatPanelProps = ComponentProps<typeof AssistantChatPanel>;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("AssistantChatPanel", () => {
  it("sends the chat transcript and renders the assistant response", async () => {
    const conversationId = "conversation-1";
    const conversation = {
      id: conversationId,
      title: "Planning",
      createdAt: "2026-05-03T08:58:00.000Z",
      updatedAt: "2026-05-03T09:00:00.000Z",
    };
    const onAsk = vi.fn(async (activeConversationId, messages) => {
      expect(activeConversationId).toBe(conversationId);
      expect(messages).toEqual([{ role: "user", content: "Plan my day" }]);
      return {
        provider: "openai" as const,
        model: "gpt-5.5",
        conversation,
        conversations: [conversation],
        message: {
          id: "assistant-1",
          conversationId,
          role: "assistant" as const,
          content: "**Start** with the ready tasks.",
          createdAt: "2026-05-03T09:00:00.000Z",
        },
        messages: [
          {
            id: "user-1",
            conversationId,
            role: "user" as const,
            content: "Plan my day",
            createdAt: "2026-05-03T08:59:00.000Z",
          },
          {
            id: "assistant-1",
            conversationId,
            role: "assistant" as const,
            content: "**Start** with the ready tasks.",
            createdAt: "2026-05-03T09:00:00.000Z",
          },
        ],
        proposedActions: [],
      };
    });
    const onLoadHistory = vi.fn(async (activeConversationId: string | null) => {
      expect(activeConversationId).toBe(conversationId);
      return {
        conversations: [conversation],
        activeConversationId: conversationId,
        messages: [],
      };
    });
    const onMessagesChange = vi.fn();

    await act(async () => {
      root.render(
        <AssistantChatPanel
          openAiReady
          conversationId={conversationId}
          conversationTitle={conversation.title}
          onOpenSettings={vi.fn()}
          onLoadHistory={onLoadHistory}
          onAsk={onAsk}
          onMessagesChange={onMessagesChange}
        />,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("#assistant-chat-input");
    expect(textarea).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea!, "Plan my day");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector<HTMLFormElement>("form");
    expect(form).not.toBeNull();

    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onLoadHistory).toHaveBeenCalledTimes(1);
    expect(onMessagesChange).toHaveBeenLastCalledWith([
      {
        id: "user-1",
        conversationId,
        role: "user",
        content: "Plan my day",
        createdAt: "2026-05-03T08:59:00.000Z",
      },
      {
        id: "assistant-1",
        conversationId,
        role: "assistant",
        content: "**Start** with the ready tasks.",
        createdAt: "2026-05-03T09:00:00.000Z",
      },
    ]);
    expect(container.textContent).toContain("Plan my day");
    expect(container.textContent).toContain("Start with the ready tasks.");
    expect(container.querySelector("strong")?.textContent).toBe("Start");
  });

  it("sends a proactive prompt starter", async () => {
    const conversation = conversationFixture();
    const onAsk = vi.fn(async (_conversationId, messages) => {
      expect(messages.at(-1)?.content).toContain("Plan my next work session");
      return responseFixture(conversation, messages.at(-1)?.content ?? "Plan today");
    });

    await renderPanel({
      conversation,
      onAsk,
      onLoadHistory: historyLoader(conversation, []),
    });

    await act(async () => {
      getButtonByText("Plan today").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Response for");
  });

  it("renders proposed task actions and requires approval or dismissal", async () => {
    const conversation = conversationFixture();
    const proposedActions = [
      {
        id: "action-1",
        type: "create_task" as const,
        title: "Create launch task",
        rationale: "The draft is ready to become a focused task.",
        task: {
          title: "Draft launch notes",
          status: "ready" as const,
          priority: "high" as const,
          focusAreaId: "work",
        },
      },
      {
        id: "action-2",
        type: "move_task" as const,
        title: "Move stuck work",
        taskId: "task-1",
        status: "ready" as const,
      },
    ];
    const onApproveProposedAction = vi.fn(async () => undefined);

    await renderPanel({
      conversation,
      onApproveProposedAction,
      onLoadHistory: historyLoader(conversation, [
        {
          id: "assistant-1",
          conversationId: conversation.id,
          role: "assistant",
          content: "I found two useful board changes.",
          createdAt: "2026-05-03T09:00:00.000Z",
          proposedActions,
        },
      ]),
    });

    expect(container.textContent).toContain("Create launch task");
    expect(container.textContent).toContain("Draft launch notes");
    expect(container.textContent).toContain("The draft is ready");

    await act(async () => {
      getButtonsByText("Approve")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onApproveProposedAction).toHaveBeenCalledWith(proposedActions[0]);
    expect(container.textContent).toContain("Approved");

    await act(async () => {
      getButtonsByText("Dismiss")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Dismissed");
  });

  it("does not send while OpenAI is not ready", async () => {
    const conversation = conversationFixture();
    const onAsk = vi.fn();

    await renderPanel({
      conversation,
      openAiReady: false,
      onAsk,
      onLoadHistory: historyLoader(conversation, []),
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("#assistant-chat-input");
    expect(textarea).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea!, "Plan my day");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(getButtonByText("Send").hasAttribute("disabled")).toBe(true);

    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onAsk).not.toHaveBeenCalled();
  });
});

async function renderPanel(options: {
  conversation: ReturnType<typeof conversationFixture>;
  openAiReady?: boolean;
  onApproveProposedAction?: AssistantChatPanelProps["onApproveProposedAction"];
  onAsk?: AssistantChatPanelProps["onAsk"];
  onLoadHistory?: AssistantChatPanelProps["onLoadHistory"];
}) {
  await act(async () => {
    root.render(
      <AssistantChatPanel
        openAiReady={options.openAiReady ?? true}
        conversationId={options.conversation.id}
        conversationTitle={options.conversation.title}
        boardCounts={{ draft: 2, ready: 3, in_progress: 1, needs_attention: 0, done: 4 }}
        focusAreas={[{ id: "work", label: "Work", color: "emerald" }]}
        onOpenSettings={vi.fn()}
        onApproveProposedAction={options.onApproveProposedAction}
        onLoadHistory={options.onLoadHistory}
        onAsk={options.onAsk}
      />,
    );
  });
}

function conversationFixture() {
  return {
    id: "conversation-1",
    title: "Planning",
    createdAt: "2026-05-03T08:58:00.000Z",
    updatedAt: "2026-05-03T09:00:00.000Z",
  };
}

function historyLoader(
  conversation: ReturnType<typeof conversationFixture>,
  messages: AssistantChatMessage[],
) {
  return vi.fn(async (activeConversationId: string | null) => {
    expect(activeConversationId).toBe(conversation.id);
    return {
      conversations: [conversation],
      activeConversationId: conversation.id,
      messages,
    };
  });
}

function responseFixture(conversation: ReturnType<typeof conversationFixture>, prompt: string) {
  return {
    provider: "openai" as const,
    model: "gpt-5.5",
    conversation,
    conversations: [conversation],
    message: {
      id: "assistant-1",
      conversationId: conversation.id,
      role: "assistant" as const,
      content: `Response for: ${prompt}`,
      createdAt: "2026-05-03T09:00:00.000Z",
    },
    messages: [
      {
        id: "user-1",
        conversationId: conversation.id,
        role: "user" as const,
        content: prompt,
        createdAt: "2026-05-03T08:59:00.000Z",
      },
      {
        id: "assistant-1",
        conversationId: conversation.id,
        role: "assistant" as const,
        content: `Response for: ${prompt}`,
        createdAt: "2026-05-03T09:00:00.000Z",
      },
    ],
    proposedActions: [],
  };
}

function getButtonByText(text: string): HTMLButtonElement {
  const button = getButtonsByText(text)[0];
  expect(button).toBeDefined();
  return button;
}

function getButtonsByText(text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((button) =>
    button.textContent?.includes(text),
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
}
