import type {
  AssistantChatMessage,
  AssistantProposedAction,
} from "../shared/types";

export type TransientProposedActionCache = Map<string, AssistantProposedAction[]>;

export function rememberTransientProposedActions(
  cache: TransientProposedActionCache,
  messages: AssistantChatMessage[],
) {
  for (const message of messages) {
    if (message.proposedActions?.length) {
      cache.set(message.id, message.proposedActions);
    }
  }
}

export function preserveTransientProposedActions(
  messages: AssistantChatMessage[],
  cache: TransientProposedActionCache,
) {
  return messages.map((message) => {
    if (message.proposedActions?.length) {
      return message;
    }
    const proposedActions = cache.get(message.id);
    return proposedActions?.length ? { ...message, proposedActions } : message;
  });
}

export function removeTransientProposedAction(
  cache: TransientProposedActionCache,
  actionId: string,
) {
  for (const [messageId, proposedActions] of cache) {
    const remaining = proposedActions.filter((action) => action.id !== actionId);
    if (remaining.length === proposedActions.length) {
      continue;
    }
    if (remaining.length === 0) {
      cache.delete(messageId);
    } else {
      cache.set(messageId, remaining);
    }
  }
}

export function removeProposedActionFromMessages(
  messages: AssistantChatMessage[],
  actionId: string,
) {
  return messages.map((message) => {
    if (!message.proposedActions?.length) {
      return message;
    }
    const proposedActions = message.proposedActions.filter((action) => action.id !== actionId);
    return {
      ...message,
      proposedActions: proposedActions.length > 0 ? proposedActions : undefined,
    };
  });
}
