import { describe, expect, it } from "vitest";
import type {
  AssistantChatMessage,
  AssistantProposedAction,
} from "../shared/types";
import {
  preserveTransientProposedActions,
  rememberTransientProposedActions,
  removeProposedActionFromMessages,
  removeTransientProposedAction,
} from "./chat-proposals";

const proposedAction: AssistantProposedAction = {
  id: "action-1",
  type: "create_task",
  title: "Create launch task",
  task: {
    title: "Draft launch notes",
    status: "ready",
  },
};

const assistantMessage: AssistantChatMessage = {
  id: "message-1",
  conversationId: "conversation-1",
  role: "assistant",
  content: "I found one useful board change.",
  createdAt: "2026-05-04T10:00:00.000Z",
};

describe("chat proposal helpers", () => {
  it("preserves transient proposal actions when saved history reloads", () => {
    const cache = new Map();
    rememberTransientProposedActions(cache, [
      {
        ...assistantMessage,
        proposedActions: [proposedAction],
      },
    ]);

    expect(preserveTransientProposedActions([assistantMessage], cache)).toEqual([
      {
        ...assistantMessage,
        proposedActions: [proposedAction],
      },
    ]);
  });

  it("removes resolved proposal actions from cache and messages", () => {
    const cache = new Map();
    const messages = [
      {
        ...assistantMessage,
        proposedActions: [proposedAction],
      },
    ];
    rememberTransientProposedActions(cache, messages);

    removeTransientProposedAction(cache, proposedAction.id);

    expect(cache.size).toBe(0);
    expect(removeProposedActionFromMessages(messages, proposedAction.id)).toEqual([
      {
        ...assistantMessage,
        proposedActions: undefined,
      },
    ]);
  });
});
